# Stage 2 — Domain Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full data model, pure pricing/timing domain logic, session/payment/business-day services, `PlugDriver` + manual driver, and the minimal API needed so that domain logic is covered by tests without a database, and a complete cycle — start a package, extend with open time, stop, pay in parts — can be driven end-to-end through the HTTP API.

**Architecture:** `core/db/models/` holds SQLAlchemy 2 models split by aggregate (zones/consoles, tariffs, settings/business days, sessions/segments, bar/payments/audit). `core/domain/` holds pure functions (no DB, no datetime.now(), every timestamp passed in) for pricing and segment timing — these are the only things the done-criterion requires to be DB-free. `core/services/` orchestrates: it calls domain functions, reads/writes ORM models, and raises three typed errors (`NotFoundError`, `ConflictError`, `ValidationError`) that the API layer translates to HTTP status codes. `core/plugs/` gets the driver interface plus a manual (no-op, Phase 1) and a fake (in-memory, for tests) implementation — not yet wired into the services, since the screen that triggers plug actions is Stage 3. `core/api/` gets request/response schemas, session/business-day routes, and SQLAdmin registration for the tables an operator configures (zones, consoles, tariffs, products, settings).

**Tech Stack:** SQLAlchemy 2 (async, asyncpg), Alembic, Pydantic v2, FastAPI, SQLAdmin, pytest + pytest-asyncio, httpx `ASGITransport`.

**Spec:** `docs/PLAN.md` (stage "2. Доменное ядро"), `docs/SPEC.md` (sections 3.2–3.6, 3.8, 7), `CLAUDE.md` (domain rules 1–13, engineering rules).

## Global Constraints

- **Absolute timestamps for deadlines** (`CLAUDE.md` rule 1): segment ends and session deadlines are columns holding real timestamps, never "minutes remaining" counters. No domain or service function calls `datetime.now()` internally — every function that needs the current time takes `now: datetime` as a parameter, passed down from the API route (`datetime.now(ZoneInfo(settings.timezone))`). This is what makes the tests deterministic and restarts safe.
- **A session is made of segments** (rule 2): package = fixed duration + price; open = no end, billed per minute. Every extension is a new `session_segments` row, never a mutation of an existing one's price.
- **Switching to open time while a package is still running** (rule 3): the open segment starts at the package's end, not at the moment of the click.
- **Grace period** (rule 4, default 3 min, from `settings.grace_minutes`) applies only at session start, never on extension.
- **Price snapshot on every segment** (rule 5): `tariff_id` may be null (free/service sessions), but `price_snapshot` is always set at segment-creation time from the tariff as it existed then. Changing a tariff later never rewrites history.
- **Open time is per-minute, rounded to a whole som** (rule 6). This plan makes an explicit rounding assumption the spec doesn't pin down: round-half-up on the final som total (`ROUND_HALF_UP`), because that is the conventional rule for cash. Flag this to the owner when reviewed — it is the one place this plan invents a rule the spec left open.
- **Reports are per business day** (rule 7): `sessions.business_day_id` / `payments.business_day_id` are set from whichever `business_days` row has `closed_at IS NULL`. Days are never auto-closed.
- **Tariffs belong to a zone** (rule 8): every `Tariff` and `Console` carries `zone_id`. One zone exists today.
- **Every manual override goes to `audit_log`** (rule 9): this stage logs exactly the two cases the spec calls out as needing a record — starting a free session, and an early stop of a package (guest leaves before the paid segment's `ends_at`) — plus cancel-within-grace, since it discards an already-created paid segment's price. Extend and a normal on-time stop are not overrides and are not logged.
- **Cash and non-cash always reported separately** (rule 10): `payments.method` is `cash | qr | transfer`; business-day close sums cash payments only for `expected_cash`.
- **Plugs control the TV only** (rule 11): `PlugDriver` never touches the console. Not exercised by any service in this stage — wiring it to session start/stop is Stage 3 (screen) / Stage 8 (agent) work.
- **The plug layer is behind `PlugDriver`** (rule 12): no vendor types outside `core/plugs/`. Phase 1 ships the manual driver only; a fake driver is added too because `SPEC.md` §5.3 calls for one "для тестов" and it costs nothing to add alongside the interface.
- **DB is the source of truth** (rule 13): not exercised yet (no agent in this stage) — noted for completeness.
- **`domain/` is pure**: no SQLAlchemy imports, no `AsyncSession` parameter, ever. It is covered by tests that don't touch a database — this is the literal wording of the stage's done-criterion.
- **Enums stored as `VARCHAR`** (`native_enum=False` on every `sqlalchemy.Enum`): adding a new kind later is a plain data migration, not `ALTER TYPE ... ADD VALUE`.
- **Placeholder tariff prices**: the owner has not answered `docs/OWNER_QUESTIONS.md` question 2 (package prices, hourly rate, package names). Every price this plan writes into tests or the dev seed script is an arbitrary placeholder, clearly commented as such, existing only to make the pricing math testable. Nothing hardcodes a price outside `tariffs` rows — the schema is fully data-driven, so the real numbers are a SQLAdmin data-entry task for the owner, not a code change.
- **Bar is out of scope for this stage.** `products` and `orders` tables are created (per the PLAN.md model list) but no service or API touches them — that's Stage 4. `session_charge_total` already sums `orders` so Stage 4 doesn't have to change its signature, but the sum is always zero right now since nothing inserts an order yet.
- Python 3.12, `uv`-managed deps, commit messages in English/imperative, one logical change per commit, no AI attribution — same conventions as Stage 1.

---

### Task 1: Zones and consoles

**Files:**
- Create: `core/db/models/__init__.py`
- Create: `core/db/models/zones.py`
- Modify: `core/db/alembic/env.py`
- Create: migration under `core/db/alembic/versions/` (generated)

**Interfaces:**
- Produces: `core.db.models.Zone`, `core.db.models.Console` — every later task that references a zone or console imports these from `core.db.models`.

- [ ] **Step 1: Start a throwaway dev Postgres on a non-default port**

The project's own `docker-compose.yml` binds Postgres to host port 5432, and another local project may already hold that port (see prior port-conflict notes for this machine) — use 5433 for this stage's standalone iteration container so it never collides with either:

```bash
docker run --rm -d --name psclub-db-stage2 \
  -e POSTGRES_DB=psclub -e POSTGRES_USER=psclub -e POSTGRES_PASSWORD=psclub \
  -p 5433:5432 postgres:16-alpine
```

Wait a few seconds, then: `docker exec psclub-db-stage2 pg_isready -U psclub` → expects `accepting connections`. Leave this container running for the rest of this stage; it is stopped in Task 18.

Every `alembic`/`pytest` command in this plan that touches the database is prefixed with:

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub
```

- [ ] **Step 2: Write `core/db/models/zones.py`**

```python
from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(default=True)


class Console(Base):
    __tablename__ = "consoles"

    id: Mapped[int] = mapped_column(primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id"))
    name: Mapped[str] = mapped_column(String(100))
    plug_driver: Mapped[str] = mapped_column(String(50), default="manual")
    plug_address: Mapped[str | None] = mapped_column(String(200), default=None)
    is_active: Mapped[bool] = mapped_column(default=True)
```

- [ ] **Step 3: Write `core/db/models/__init__.py`**

```python
from core.db.models.zones import Console, Zone

__all__ = ["Console", "Zone"]
```

- [ ] **Step 4: Wire the models package into Alembic's autogenerate**

In `core/db/alembic/env.py`, add the import right after `from core.db.base import Base` (Alembic reads `Base.metadata`, which is only populated once the model modules have been imported):

```python
from core.db.base import Base
from core.db import models  # noqa: F401 — populates Base.metadata for autogenerate
```

- [ ] **Step 5: Generate the migration**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
  uv run alembic revision --autogenerate -m "add zones and consoles"
```

- [ ] **Step 6: Check the generated file's body against this**

```python
def upgrade() -> None:
    op.create_table(
        "zones",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "consoles",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("zone_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("plug_driver", sa.String(length=50), nullable=False),
        sa.Column("plug_address", sa.String(length=200), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["zone_id"], ["zones.id"]),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade() -> None:
    op.drop_table("consoles")
    op.drop_table("zones")
```

- [ ] **Step 7: Apply and verify**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head
docker exec psclub-db-stage2 psql -U psclub -d psclub -c "\d zones"
docker exec psclub-db-stage2 psql -U psclub -d psclub -c "\d consoles"
```

- [ ] **Step 8: Commit**

```bash
git add core/db/models core/db/alembic
git commit -m "feat: add zone and console models"
```

---

### Task 2: Tariffs

**Files:**
- Create: `core/db/models/tariffs.py`
- Modify: `core/db/models/__init__.py`
- Create: migration (generated)

**Interfaces:**
- Consumes: `Zone` (Task 1).
- Produces: `core.db.models.Tariff`, `core.db.models.TariffKind` — used by the domain segment-timing tests (Task 7), the session services (Tasks 11–12), and the dev seed script (Task 17).

- [ ] **Step 1: Write `core/db/models/tariffs.py`**

A package tariff always has `duration_min` + `price` and never `hourly_rate`; an open tariff is the reverse. The check constraint makes an inconsistent row impossible at the DB level, not just in application code:

```python
import enum

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class TariffKind(str, enum.Enum):
    package = "package"
    open = "open"


class Tariff(Base):
    __tablename__ = "tariffs"
    __table_args__ = (
        CheckConstraint(
            "(kind = 'package' AND duration_min IS NOT NULL AND price IS NOT NULL AND hourly_rate IS NULL) OR "
            "(kind = 'open' AND duration_min IS NULL AND price IS NULL AND hourly_rate IS NOT NULL)",
            name="ck_tariffs_kind_fields",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id"))
    kind: Mapped[TariffKind] = mapped_column(
        __import__("sqlalchemy").Enum(TariffKind, native_enum=False, length=20)
    )
    name: Mapped[str] = mapped_column(String(100))
    duration_min: Mapped[int | None] = mapped_column(default=None)
    price: Mapped[int | None] = mapped_column(default=None)
    hourly_rate: Mapped[int | None] = mapped_column(default=None)
    is_active: Mapped[bool] = mapped_column(default=True)
```

Replace the `__import__("sqlalchemy")` trick with a proper import — it's written that way above only to keep the snippet copy-pasteable as one block; the real file must import `Enum` normally:

```python
from sqlalchemy import CheckConstraint, Enum, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class TariffKind(str, enum.Enum):
    package = "package"
    open = "open"


class Tariff(Base):
    __tablename__ = "tariffs"
    __table_args__ = (
        CheckConstraint(
            "(kind = 'package' AND duration_min IS NOT NULL AND price IS NOT NULL AND hourly_rate IS NULL) OR "
            "(kind = 'open' AND duration_min IS NULL AND price IS NULL AND hourly_rate IS NOT NULL)",
            name="ck_tariffs_kind_fields",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("zones.id"))
    kind: Mapped[TariffKind] = mapped_column(Enum(TariffKind, native_enum=False, length=20))
    name: Mapped[str] = mapped_column(String(100))
    duration_min: Mapped[int | None] = mapped_column(default=None)
    price: Mapped[int | None] = mapped_column(default=None)
    hourly_rate: Mapped[int | None] = mapped_column(default=None)
    is_active: Mapped[bool] = mapped_column(default=True)
```

(Add `import enum` at the top.) Use this second version as the actual file content.

- [ ] **Step 2: Register in `core/db/models/__init__.py`**

```python
from core.db.models.tariffs import Tariff, TariffKind
from core.db.models.zones import Console, Zone

__all__ = ["Console", "Tariff", "TariffKind", "Zone"]
```

- [ ] **Step 3: Generate, apply, verify**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
  uv run alembic revision --autogenerate -m "add tariffs"
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head
docker exec psclub-db-stage2 psql -U psclub -d psclub -c "\d tariffs"
```

Expected: `tariffs` table with the six columns above plus `ck_tariffs_kind_fields` listed under "Check constraints".

- [ ] **Step 4: Prove the constraint actually rejects a bad row**

```bash
docker exec psclub-db-stage2 psql -U psclub -d psclub -c \
  "INSERT INTO tariffs (zone_id, kind, name, duration_min, price, hourly_rate, is_active) VALUES (1, 'package', 'bad', NULL, 100, NULL, true);"
```

Expected: fails with `new row for relation "tariffs" violates check constraint "ck_tariffs_kind_fields"` (the insert also fails on the missing zone FK if no zone exists yet — either failure is fine here, this step only needs to confirm the constraint exists; Task 11's tests are what actually prove the happy path).

- [ ] **Step 5: Commit**

```bash
git add core/db/models
git commit -m "feat: add tariff model with kind-field check constraint"
```

---

### Task 3: Settings and business days

**Files:**
- Create: `core/db/models/settings.py`
- Create: `core/db/models/business_days.py`
- Modify: `core/db/models/__init__.py`
- Create: migration (generated)

**Interfaces:**
- Produces: `core.db.models.Setting`, `core.db.models.BusinessDay` — `Setting` is read by `core/services/settings.py` (Task 10); `BusinessDay` is read/written by `core/services/business_days.py` (Task 10) and referenced by `sessions.business_day_id` / `payments.business_day_id` (Task 4, Task 5).

- [ ] **Step 1: Write `core/db/models/settings.py`**

```python
from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
```

- [ ] **Step 2: Write `core/db/models/business_days.py`**

```python
from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class BusinessDay(Base):
    __tablename__ = "business_days"

    id: Mapped[int] = mapped_column(primary_key=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    opening_cash: Mapped[int] = mapped_column()
    expected_cash: Mapped[int | None] = mapped_column(default=None)
    counted_cash: Mapped[int | None] = mapped_column(default=None)
```

- [ ] **Step 3: Register in `__init__.py`**

```python
from core.db.models.business_days import BusinessDay
from core.db.models.settings import Setting
from core.db.models.tariffs import Tariff, TariffKind
from core.db.models.zones import Console, Zone

__all__ = ["BusinessDay", "Console", "Setting", "Tariff", "TariffKind", "Zone"]
```

- [ ] **Step 4: Generate, apply, verify**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
  uv run alembic revision --autogenerate -m "add settings and business days"
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head
docker exec psclub-db-stage2 psql -U psclub -d psclub -c "\d settings"
docker exec psclub-db-stage2 psql -U psclub -d psclub -c "\d business_days"
```

- [ ] **Step 5: Commit**

```bash
git add core/db/models
git commit -m "feat: add settings and business day models"
```

---

### Task 4: Sessions and segments

**Files:**
- Create: `core/db/models/sessions.py`
- Modify: `core/db/models/__init__.py`
- Create: migration (generated)

**Interfaces:**
- Consumes: `Console` (Task 1), `BusinessDay` (Task 3), `Tariff` (Task 2).
- Produces: `core.db.models.Session`, `core.db.models.SessionSegment`, `core.db.models.SessionKind`, `core.db.models.SessionStatus`, `core.db.models.SegmentKind` — the central types every service and route from Task 11 onward imports.

- [ ] **Step 1: Write `core/db/models/sessions.py`**

The `Session.segments` relationship uses `lazy="selectin"`: under the async engine, the default lazy-load strategy raises `MissingGreenlet` the moment code accesses `.segments` outside the original query's awaited call — `selectin` is one of the two strategies safe to use with `AsyncSession`, and every service in this stage reads `.segments` after a fresh `db.get()`.

```python
import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.db.base import Base


class SessionKind(str, enum.Enum):
    paid = "paid"
    free = "free"
    service = "service"


class SessionStatus(str, enum.Enum):
    active = "active"
    finished = "finished"
    cancelled = "cancelled"


class SegmentKind(str, enum.Enum):
    package = "package"
    open = "open"


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    console_id: Mapped[int | None] = mapped_column(ForeignKey("consoles.id"), default=None)
    business_day_id: Mapped[int] = mapped_column(ForeignKey("business_days.id"))
    kind: Mapped[SessionKind] = mapped_column(Enum(SessionKind, native_enum=False, length=20))
    reason: Mapped[str | None] = mapped_column(String(200), default=None)
    status: Mapped[SessionStatus] = mapped_column(
        Enum(SessionStatus, native_enum=False, length=20), default=SessionStatus.active
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    grace_until: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    comment: Mapped[str | None] = mapped_column(Text, default=None)

    segments: Mapped[list["SessionSegment"]] = relationship(
        "SessionSegment", order_by="SessionSegment.starts_at", lazy="selectin"
    )


class SessionSegment(Base):
    __tablename__ = "session_segments"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    tariff_id: Mapped[int | None] = mapped_column(ForeignKey("tariffs.id"), default=None)
    kind: Mapped[SegmentKind] = mapped_column(Enum(SegmentKind, native_enum=False, length=20))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    price_snapshot: Mapped[int] = mapped_column()
    amount: Mapped[int | None] = mapped_column(default=None)
```

- [ ] **Step 2: Register in `__init__.py`**

```python
from core.db.models.business_days import BusinessDay
from core.db.models.sessions import SegmentKind, Session, SessionKind, SessionSegment, SessionStatus
from core.db.models.settings import Setting
from core.db.models.tariffs import Tariff, TariffKind
from core.db.models.zones import Console, Zone

__all__ = [
    "BusinessDay",
    "Console",
    "SegmentKind",
    "Session",
    "SessionKind",
    "SessionSegment",
    "SessionStatus",
    "Setting",
    "Tariff",
    "TariffKind",
    "Zone",
]
```

- [ ] **Step 3: Generate, apply, verify**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
  uv run alembic revision --autogenerate -m "add sessions and session segments"
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head
docker exec psclub-db-stage2 psql -U psclub -d psclub -c "\d sessions"
docker exec psclub-db-stage2 psql -U psclub -d psclub -c "\d session_segments"
```

- [ ] **Step 4: Commit**

```bash
git add core/db/models
git commit -m "feat: add session and session segment models"
```

---

### Task 5: Products, orders, payments, audit log

**Files:**
- Create: `core/db/models/bar.py`
- Create: `core/db/models/payments.py`
- Create: `core/db/models/audit.py`
- Modify: `core/db/models/__init__.py`
- Create: migration (generated)

**Interfaces:**
- Consumes: `Session` (Task 4), `BusinessDay` (Task 3).
- Produces: `core.db.models.Product`, `core.db.models.Order`, `core.db.models.Payment`, `core.db.models.PaymentMethod`, `core.db.models.AuditLog` — `Payment`/`PaymentMethod` are used from Task 13 on; `AuditLog` from Task 11 on; `Product`/`Order` are schema-only in this stage (Stage 4 adds their service).

- [ ] **Step 1: Write `core/db/models/bar.py`**

```python
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    price: Mapped[int] = mapped_column()
    is_active: Mapped[bool] = mapped_column(default=True)


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"))
    qty: Mapped[int] = mapped_column()
    unit_price: Mapped[int] = mapped_column()
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
```

- [ ] **Step 2: Write `core/db/models/payments.py`**

```python
import enum
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class PaymentMethod(str, enum.Enum):
    cash = "cash"
    qr = "qr"
    transfer = "transfer"


class Payment(Base):
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id"))
    business_day_id: Mapped[int] = mapped_column(ForeignKey("business_days.id"))
    amount: Mapped[int] = mapped_column()
    method: Mapped[PaymentMethod] = mapped_column(Enum(PaymentMethod, native_enum=False, length=20))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
```

- [ ] **Step 3: Write `core/db/models/audit.py`**

```python
from datetime import datetime

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    action: Mapped[str] = mapped_column(String(100))
    entity: Mapped[str] = mapped_column(String(100))
    entity_id: Mapped[int] = mapped_column()
    details: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
```

- [ ] **Step 4: Register in `__init__.py`**

```python
from core.db.models.audit import AuditLog
from core.db.models.bar import Order, Product
from core.db.models.business_days import BusinessDay
from core.db.models.payments import Payment, PaymentMethod
from core.db.models.sessions import SegmentKind, Session, SessionKind, SessionSegment, SessionStatus
from core.db.models.settings import Setting
from core.db.models.tariffs import Tariff, TariffKind
from core.db.models.zones import Console, Zone

__all__ = [
    "AuditLog",
    "BusinessDay",
    "Console",
    "Order",
    "Payment",
    "PaymentMethod",
    "Product",
    "SegmentKind",
    "Session",
    "SessionKind",
    "SessionSegment",
    "SessionStatus",
    "Setting",
    "Tariff",
    "TariffKind",
    "Zone",
]
```

- [ ] **Step 5: Generate, apply, verify**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
  uv run alembic revision --autogenerate -m "add products, orders, payments and audit log"
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head
docker exec psclub-db-stage2 psql -U psclub -d psclub -c "\dt"
```

Expected: `\dt` lists all eleven tables — `zones`, `consoles`, `tariffs`, `settings`, `business_days`, `sessions`, `session_segments`, `products`, `orders`, `payments`, `audit_log` — plus `alembic_version`.

- [ ] **Step 6: Roll every migration back to prove the chain is sound, then reapply**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic downgrade base
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head
```

Expected: both succeed with no errors.

- [ ] **Step 7: Commit**

```bash
git add core/db/models
git commit -m "feat: add product, order, payment and audit log models"
```

---

### Task 6: Domain — money and rounding

**Files:**
- Create: `core/domain/money.py`
- Test: `tests/domain/test_money.py`

**Interfaces:**
- Produces: `core.domain.money.round_som(amount: Decimal) -> int`, `core.domain.money.open_time_amount(elapsed_seconds: float, hourly_rate: int) -> int`. Consumed by `core/services/sessions.py` and `core/services/payments.py` (Tasks 11–13).

- [ ] **Step 1: Write the failing tests — `tests/domain/test_money.py`**

```python
from decimal import Decimal

from core.domain.money import open_time_amount, round_som


def test_round_som_rounds_half_up():
    assert round_som(Decimal("2.5")) == 3
    assert round_som(Decimal("2.4")) == 2
    assert round_som(Decimal("2.5001")) == 3


def test_open_time_amount_zero_elapsed_is_free():
    assert open_time_amount(0, hourly_rate=120) == 0


def test_open_time_amount_exact_half_hour():
    # 1800s = 30 min, ставка 120 сом/час -> 60 сом ровно
    assert open_time_amount(1800, hourly_rate=120) == 60


def test_open_time_amount_rounds_the_final_total():
    # 1 минута при ставке 150 сом/час -> 2.5 сом -> округление до 3
    assert open_time_amount(60, hourly_rate=150) == 3
    # 90 секунд при ставке 60 сом/час -> 1.5 сом -> округление до 2
    assert open_time_amount(90, hourly_rate=60) == 2
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/domain/test_money.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.domain.money'`.

- [ ] **Step 3: Write `core/domain/money.py`**

```python
from decimal import ROUND_HALF_UP, Decimal


def round_som(amount: Decimal) -> int:
    return int(amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def open_time_amount(elapsed_seconds: float, hourly_rate: int) -> int:
    """SPEC 3.2: открытое время поминутно, ставка/мин = ставка/час / 60,
    округляется только итог, а не каждая минута."""
    if elapsed_seconds <= 0:
        return 0
    elapsed_minutes = Decimal(str(elapsed_seconds)) / Decimal(60)
    per_minute_rate = Decimal(hourly_rate) / Decimal(60)
    return round_som(elapsed_minutes * per_minute_rate)
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/domain/test_money.py -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add core/domain/money.py tests/domain/test_money.py
git commit -m "feat: add pure open-time pricing and som rounding"
```

---

### Task 7: Domain — segment timing

**Files:**
- Create: `core/domain/segments.py`
- Test: `tests/domain/test_segments.py`

**Interfaces:**
- Produces: `core.domain.segments.ActiveSegment` (dataclass), `grace_until(started_at, grace_minutes) -> datetime`, `package_segment_end(start, duration_min) -> datetime`, `next_segment_start(now, active) -> datetime`, `is_within_grace(now, grace_until_at) -> bool`. Consumed by `core/services/sessions.py` (Tasks 11–12).

- [ ] **Step 1: Write the failing tests — `tests/domain/test_segments.py`**

```python
from datetime import datetime, timedelta, timezone

from core.domain.segments import (
    ActiveSegment,
    grace_until,
    is_within_grace,
    next_segment_start,
    package_segment_end,
)

T = datetime(2026, 9, 23, 12, 0, 0, tzinfo=timezone.utc)


def test_grace_until_shifts_by_grace_minutes():
    assert grace_until(T, grace_minutes=3) == T + timedelta(minutes=3)


def test_package_segment_end_adds_duration():
    assert package_segment_end(T, duration_min=180) == T + timedelta(hours=3)


def test_is_within_grace():
    deadline = T + timedelta(minutes=3)
    assert is_within_grace(deadline - timedelta(seconds=1), deadline) is True
    assert is_within_grace(deadline, deadline) is True
    assert is_within_grace(deadline + timedelta(seconds=1), deadline) is False


def test_next_segment_start_with_no_active_segment_is_now():
    assert next_segment_start(T, active=None) == T


def test_next_segment_start_chains_at_package_end_while_still_running():
    # Пакет идёт с T до T+60мин, продлеваем в T+10мин -> новый отрезок с T+60мин,
    # иначе гость платит дважды за одни и те же минуты (SPEC 3.2).
    active = ActiveSegment(kind="package", starts_at=T, ends_at=T + timedelta(minutes=60))
    assert next_segment_start(T + timedelta(minutes=10), active) == T + timedelta(minutes=60)


def test_next_segment_start_uses_now_once_package_already_ended():
    active = ActiveSegment(kind="package", starts_at=T, ends_at=T + timedelta(minutes=60))
    now = T + timedelta(minutes=70)
    assert next_segment_start(now, active) == now


def test_next_segment_start_closes_open_segment_at_now():
    active = ActiveSegment(kind="open", starts_at=T, ends_at=None)
    now = T + timedelta(minutes=15)
    assert next_segment_start(now, active) == now
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/domain/test_segments.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.domain.segments'`.

- [ ] **Step 3: Write `core/domain/segments.py`**

```python
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class ActiveSegment:
    kind: str  # "package" | "open"
    starts_at: datetime
    ends_at: datetime | None  # None для ещё идущего открытого отрезка


def grace_until(started_at: datetime, grace_minutes: int) -> datetime:
    """Время на выбор игры (SPEC 3.2): конец пакета сдвигается на эту величину,
    у открытого времени деньги начинают считаться с этого момента, и до него же
    можно бесплатно отменить сессию."""
    return started_at + timedelta(minutes=grace_minutes)


def package_segment_end(start: datetime, duration_min: int) -> datetime:
    return start + timedelta(minutes=duration_min)


def next_segment_start(now: datetime, active: ActiveSegment | None) -> datetime:
    """Где начинается новый отрезок при продлении или переключении на открытое время.

    Пакет, который ещё не закончился, отдаёт своё оставшееся время новому отрезку —
    иначе гость платит дважды за одни и те же минуты (SPEC 3.2, CLAUDE.md rule 3).
    Открытое время закрывается прямо сейчас — оно уже посчитано поминутно до этой секунды.
    """
    if active is None:
        return now
    if active.kind == "package":
        assert active.ends_at is not None
        return max(active.ends_at, now)
    return now


def is_within_grace(now: datetime, grace_until_at: datetime) -> bool:
    return now <= grace_until_at
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/domain/test_segments.py -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add core/domain/segments.py tests/domain/test_segments.py
git commit -m "feat: add pure segment timing and grace-period domain logic"
```

---

### Task 8: PlugDriver interface, manual and fake drivers

**Files:**
- Create: `core/plugs/base.py`
- Create: `core/plugs/manual.py`
- Create: `core/plugs/fake.py`
- Test: `tests/plugs/test_drivers.py`

**Interfaces:**
- Produces: `core.plugs.base.PlugDriver` (ABC), `core.plugs.base.PlugState`, `core.plugs.manual.ManualPlugDriver`, `core.plugs.fake.FakePlugDriver`. Not consumed anywhere else in this stage — Stage 3/8 wire a driver into the session screen and the agent.

- [ ] **Step 1: Write `core/plugs/base.py`**

```python
import enum
from abc import ABC, abstractmethod


class PlugState(str, enum.Enum):
    on = "on"
    off = "off"
    unknown = "unknown"


class PlugDriver(ABC):
    """SPEC 5.3: turn_on/turn_off/get_state/get_power. Implementations: manual
    (Phase 1), Tapo/Shelly (Phase 2), fake (tests). No vendor types leak past
    this interface (CLAUDE.md rule 12)."""

    @abstractmethod
    async def turn_on(self, address: str) -> None: ...

    @abstractmethod
    async def turn_off(self, address: str) -> None: ...

    @abstractmethod
    async def get_state(self, address: str) -> PlugState: ...

    @abstractmethod
    async def get_power(self, address: str) -> float | None: ...
```

- [ ] **Step 2: Write `core/plugs/manual.py`**

```python
import logging

from core.plugs.base import PlugDriver, PlugState

logger = logging.getLogger("plugs.manual")


class ManualPlugDriver(PlugDriver):
    """Розеток нет (Phase 1, SPEC 3.8): вместо команды розетке — подсказка
    админу выключить/включить ТВ рукой. Состояние неизвестно, потому что
    железа не существует."""

    async def turn_on(self, address: str) -> None:
        logger.info("manual driver: turn ON console %s by hand", address)

    async def turn_off(self, address: str) -> None:
        logger.info("manual driver: turn OFF console %s by hand", address)

    async def get_state(self, address: str) -> PlugState:
        return PlugState.unknown

    async def get_power(self, address: str) -> float | None:
        return None
```

- [ ] **Step 3: Write `core/plugs/fake.py`**

```python
from core.plugs.base import PlugDriver, PlugState


class FakePlugDriver(PlugDriver):
    """In-memory driver for tests (SPEC 5.3) — no real hardware or network."""

    def __init__(self) -> None:
        self._state: dict[str, PlugState] = {}

    async def turn_on(self, address: str) -> None:
        self._state[address] = PlugState.on

    async def turn_off(self, address: str) -> None:
        self._state[address] = PlugState.off

    async def get_state(self, address: str) -> PlugState:
        return self._state.get(address, PlugState.unknown)

    async def get_power(self, address: str) -> float | None:
        return 45.0 if self._state.get(address) == PlugState.on else 0.0
```

- [ ] **Step 4: Write `tests/plugs/test_drivers.py`**

```python
import pytest

from core.plugs.base import PlugState
from core.plugs.fake import FakePlugDriver
from core.plugs.manual import ManualPlugDriver


@pytest.mark.asyncio
async def test_manual_driver_never_reports_a_known_state():
    driver = ManualPlugDriver()
    await driver.turn_on("console-1")
    await driver.turn_off("console-1")
    assert await driver.get_state("console-1") == PlugState.unknown
    assert await driver.get_power("console-1") is None


@pytest.mark.asyncio
async def test_fake_driver_tracks_state_and_power():
    driver = FakePlugDriver()
    assert await driver.get_state("console-1") == PlugState.unknown

    await driver.turn_on("console-1")
    assert await driver.get_state("console-1") == PlugState.on
    assert await driver.get_power("console-1") == 45.0

    await driver.turn_off("console-1")
    assert await driver.get_state("console-1") == PlugState.off
    assert await driver.get_power("console-1") == 0.0
```

- [ ] **Step 5: Run**

Run: `uv run pytest tests/plugs -v`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add core/plugs tests/plugs
git commit -m "feat: add PlugDriver interface with manual and fake implementations"
```

---

### Task 9: Test database fixtures

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/api/conftest.py`
- Test: `tests/services/test_fixtures_smoke.py`

**Interfaces:**
- Consumes: `core.db.base.Base`, `core.db.models` (Tasks 1–5), `core.db.session.get_session`, `core.api.main.app` (Stage 1).
- Produces: `db_session` fixture (a real `AsyncSession` against a scratch database, schema recreated per test) used by every service test from Task 10 on; `client` fixture (an `httpx.AsyncClient` wired to the same scratch database via FastAPI dependency override) used by API tests in Task 18.

- [ ] **Step 1: Create the `psclub_test` database once**

```bash
docker exec psclub-db-stage2 psql -U psclub -d psclub -tc \
  "SELECT 1 FROM pg_database WHERE datname = 'psclub_test'" | grep -q 1 || \
  docker exec psclub-db-stage2 psql -U psclub -d psclub -c "CREATE DATABASE psclub_test"
```

- [ ] **Step 2: Write `tests/conftest.py`**

```python
import pytest_asyncio
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.db.base import Base
from core.db.models import *  # noqa: F401,F403 — registers every model on Base.metadata

TEST_DATABASE_URL = "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as session:
        yield session

    await engine.dispose()
```

- [ ] **Step 3: Write `tests/api/conftest.py`**

```python
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.api.main import app
from core.db.base import Base
from core.db.models import *  # noqa: F401,F403
from core.db.session import get_session

TEST_DATABASE_URL = "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"


@pytest_asyncio.fixture
async def client():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async def override_get_session():
        async with session_factory() as session:
            yield session

    app.dependency_overrides[get_session] = override_get_session
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()
    await engine.dispose()
```

- [ ] **Step 4: Write a smoke test proving the fixture works — `tests/services/test_fixtures_smoke.py`**

```python
import pytest

from core.db.models import Zone


@pytest.mark.asyncio
async def test_db_session_fixture_persists_a_row(db_session):
    db_session.add(Zone(name="Зал", is_active=True))
    await db_session.commit()

    zone = (await db_session.execute(__import__("sqlalchemy").select(Zone))).scalar_one()
    assert zone.name == "Зал"
```

Replace the inline `__import__` with a normal import — written that way above only to keep the block copy-pasteable; the real file is:

```python
import pytest
from sqlalchemy import select

from core.db.models import Zone


@pytest.mark.asyncio
async def test_db_session_fixture_persists_a_row(db_session):
    db_session.add(Zone(name="Зал", is_active=True))
    await db_session.commit()

    zone = (await db_session.execute(select(Zone))).scalar_one()
    assert zone.name == "Зал"
```

Use this second version as the actual file content.

- [ ] **Step 5: Run — this needs `DATABASE_URL` pointed at the stage-2 Postgres for the app's own settings too, since `core/api/main.py` imports `core.config.settings` at import time**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
  uv run pytest tests/services/test_fixtures_smoke.py -v
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add tests/conftest.py tests/api/conftest.py tests/services/test_fixtures_smoke.py
git commit -m "test: add Postgres-backed fixtures for service and API tests"
```

---

### Task 10: Services — settings and business days

**Files:**
- Create: `core/services/errors.py`
- Create: `core/services/settings.py`
- Create: `core/services/business_days.py`
- Test: `tests/services/test_business_days.py`

**Interfaces:**
- Consumes: `Setting`, `BusinessDay`, `Session`, `SessionStatus`, `Payment`, `PaymentMethod` (Tasks 3–5).
- Produces: `core.services.errors.{ServiceError,NotFoundError,ConflictError,ValidationError}`; `core.services.settings.{get_setting,get_grace_minutes,get_warn_minutes}`; `core.services.business_days.{open_business_day,get_open_business_day,close_business_day}`. Consumed by `core/services/sessions.py` (Task 11) and `core/api/routes/business_days.py` (Task 14).

- [ ] **Step 1: Write `core/services/errors.py`**

```python
class ServiceError(Exception):
    """Base for service-layer failures. core/api/errors.py maps the three
    subclasses below to HTTP status codes; domain/ never raises these."""


class NotFoundError(ServiceError):
    pass


class ConflictError(ServiceError):
    pass


class ValidationError(ServiceError):
    pass
```

- [ ] **Step 2: Write `core/services/settings.py`**

```python
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import Setting

DEFAULT_GRACE_MINUTES = 3
DEFAULT_WARN_MINUTES = 5


async def get_setting(db: AsyncSession, key: str) -> str | None:
    row = await db.get(Setting, key)
    return row.value if row else None


async def get_grace_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "grace_minutes")
    return int(value) if value is not None else DEFAULT_GRACE_MINUTES


async def get_warn_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "warn_minutes")
    return int(value) if value is not None else DEFAULT_WARN_MINUTES
```

- [ ] **Step 3: Write `core/services/business_days.py`**

```python
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import BusinessDay, Payment, PaymentMethod
from core.db.models import Session as SessionModel
from core.db.models import SessionStatus
from core.services.errors import ConflictError, NotFoundError


async def get_open_business_day(db: AsyncSession) -> BusinessDay | None:
    result = await db.execute(select(BusinessDay).where(BusinessDay.closed_at.is_(None)))
    return result.scalar_one_or_none()


async def open_business_day(db: AsyncSession, *, opening_cash: int, now: datetime) -> BusinessDay:
    if await get_open_business_day(db) is not None:
        raise ConflictError("business day already open")

    day = BusinessDay(opened_at=now, opening_cash=opening_cash)
    db.add(day)
    await db.commit()
    await db.refresh(day)
    return day


async def close_business_day(
    db: AsyncSession, *, business_day_id: int, counted_cash: int, now: datetime
) -> BusinessDay:
    day = await db.get(BusinessDay, business_day_id)
    if day is None:
        raise NotFoundError(f"business day {business_day_id} not found")
    if day.closed_at is not None:
        raise ConflictError("business day already closed")

    active = await db.execute(
        select(SessionModel).where(
            SessionModel.business_day_id == business_day_id,
            SessionModel.status == SessionStatus.active,
        )
    )
    if active.scalars().first() is not None:
        raise ConflictError("business day has active sessions, finish them first")

    cash_result = await db.execute(
        select(Payment.amount).where(
            Payment.business_day_id == business_day_id,
            Payment.method == PaymentMethod.cash,
        )
    )
    cash_total = sum(cash_result.scalars().all())

    day.closed_at = now
    day.expected_cash = day.opening_cash + cash_total
    day.counted_cash = counted_cash
    await db.commit()
    await db.refresh(day)
    return day
```

- [ ] **Step 4: Write `tests/services/test_business_days.py`**

```python
from datetime import datetime, timedelta, timezone

import pytest

from core.services.business_days import close_business_day, get_open_business_day, open_business_day
from core.services.errors import ConflictError, NotFoundError

T = datetime(2026, 9, 23, 10, 0, 0, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_open_business_day_sets_opening_cash(db_session):
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    assert day.opening_cash == 5000
    assert day.closed_at is None
    assert await get_open_business_day(db_session) is not None


@pytest.mark.asyncio
async def test_cannot_open_a_second_business_day(db_session):
    await open_business_day(db_session, opening_cash=5000, now=T)
    with pytest.raises(ConflictError):
        await open_business_day(db_session, opening_cash=1000, now=T)


@pytest.mark.asyncio
async def test_close_business_day_computes_expected_cash_from_cash_payments_only(db_session):
    from core.db.models import Payment, PaymentMethod

    day = await open_business_day(db_session, opening_cash=5000, now=T)
    db_session.add(Payment(session_id=1, business_day_id=day.id, amount=300, method=PaymentMethod.cash, created_at=T))
    db_session.add(Payment(session_id=1, business_day_id=day.id, amount=999, method=PaymentMethod.qr, created_at=T))
    await db_session.commit()

    closed = await close_business_day(db_session, business_day_id=day.id, counted_cash=5300, now=T + timedelta(hours=8))
    assert closed.expected_cash == 5300  # 5000 opening + 300 cash, QR excluded
    assert closed.counted_cash == 5300
    assert closed.closed_at is not None


@pytest.mark.asyncio
async def test_close_unknown_business_day_raises_not_found(db_session):
    with pytest.raises(NotFoundError):
        await close_business_day(db_session, business_day_id=999, counted_cash=0, now=T)
```

Note: this test inserts a `Payment` with `session_id=1` that doesn't reference a real `sessions` row. That's fine here — Postgres enforces the FK, and there's no session with id 1 in a freshly created schema, so this would actually fail. Fix the test to create a real session first, or drop the FK check for this narrow case. Use the corrected version below as the actual file content for Step 4:

```python
from datetime import datetime, timedelta, timezone

import pytest

from core.db.models import BusinessDay, Console, Payment, PaymentMethod, Session, SessionKind, SessionStatus, Zone
from core.services.business_days import close_business_day, get_open_business_day, open_business_day
from core.services.errors import ConflictError, NotFoundError

T = datetime(2026, 9, 23, 10, 0, 0, tzinfo=timezone.utc)


async def _make_finished_session(db_session, business_day_id: int) -> int:
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    db_session.add(console)
    await db_session.flush()
    session = Session(
        console_id=console.id,
        business_day_id=business_day_id,
        kind=SessionKind.paid,
        status=SessionStatus.finished,
        started_at=T,
        grace_until=T,
        ended_at=T,
    )
    db_session.add(session)
    await db_session.flush()
    return session.id


@pytest.mark.asyncio
async def test_open_business_day_sets_opening_cash(db_session):
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    assert day.opening_cash == 5000
    assert day.closed_at is None
    assert await get_open_business_day(db_session) is not None


@pytest.mark.asyncio
async def test_cannot_open_a_second_business_day(db_session):
    await open_business_day(db_session, opening_cash=5000, now=T)
    with pytest.raises(ConflictError):
        await open_business_day(db_session, opening_cash=1000, now=T)


@pytest.mark.asyncio
async def test_close_business_day_computes_expected_cash_from_cash_payments_only(db_session):
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    session_id = await _make_finished_session(db_session, day.id)
    db_session.add(Payment(session_id=session_id, business_day_id=day.id, amount=300, method=PaymentMethod.cash, created_at=T))
    db_session.add(Payment(session_id=session_id, business_day_id=day.id, amount=999, method=PaymentMethod.qr, created_at=T))
    await db_session.commit()

    closed = await close_business_day(db_session, business_day_id=day.id, counted_cash=5300, now=T + timedelta(hours=8))
    assert closed.expected_cash == 5300  # 5000 opening + 300 cash, QR excluded
    assert closed.counted_cash == 5300
    assert closed.closed_at is not None


@pytest.mark.asyncio
async def test_close_unknown_business_day_raises_not_found(db_session):
    with pytest.raises(NotFoundError):
        await close_business_day(db_session, business_day_id=999, counted_cash=0, now=T)


@pytest.mark.asyncio
async def test_close_business_day_with_active_session_is_a_conflict(db_session):
    day = await open_business_day(db_session, opening_cash=5000, now=T)
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    db_session.add(console)
    await db_session.flush()
    db_session.add(Session(
        console_id=console.id, business_day_id=day.id, kind=SessionKind.paid,
        status=SessionStatus.active, started_at=T, grace_until=T,
    ))
    await db_session.commit()

    with pytest.raises(ConflictError):
        await close_business_day(db_session, business_day_id=day.id, counted_cash=5000, now=T)
```

- [ ] **Step 5: Run**

Run: `uv run pytest tests/services/test_business_days.py -v`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add core/services/errors.py core/services/settings.py core/services/business_days.py tests/services/test_business_days.py
git commit -m "feat: add settings and business day services"
```

---

### Task 11: Services — starting sessions

**Files:**
- Create: `core/services/sessions.py`
- Test: `tests/services/test_sessions_start.py`

**Interfaces:**
- Consumes: `core.domain.segments.{grace_until,package_segment_end}` (Task 7), `core.services.business_days.get_open_business_day` and `core.services.settings.get_grace_minutes` (Task 10), all session/tariff/console models (Tasks 1–5).
- Produces: `core.services.sessions.start_session(db, *, console_id, kind, tariff_id, reason, comment, now) -> Session`, and the private helper `_new_segment_from_tariff` that Task 12's `extend_session` also uses. Consumed by `core/api/routes/sessions.py` (Task 15).

- [ ] **Step 1: Write the failing tests — `tests/services/test_sessions_start.py`**

```python
from datetime import datetime, timezone

import pytest

from core.db.models import Console, SegmentKind, SessionKind, SessionStatus, Tariff, TariffKind, Zone
from core.services.business_days import open_business_day
from core.services.errors import ConflictError, NotFoundError, ValidationError
from core.services.sessions import start_session

T = datetime(2026, 9, 23, 12, 0, 0, tzinfo=timezone.utc)


async def _setup(db_session, *, open_day: bool = True):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    db_session.add(console)
    package = Tariff(zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150)
    open_tariff = Tariff(zone_id=zone.id, kind=TariffKind.open, name="Открытое время", hourly_rate=120)
    db_session.add_all([package, open_tariff])
    await db_session.flush()
    if open_day:
        await open_business_day(db_session, opening_cash=5000, now=T)
    await db_session.commit()
    return console.id, package.id, open_tariff.id


@pytest.mark.asyncio
async def test_start_paid_package_session_shifts_end_by_grace(db_session):
    console_id, package_id, _ = await _setup(db_session)

    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=package_id,
        reason=None, comment=None, now=T,
    )

    assert session.status == SessionStatus.active
    assert session.grace_until == T.replace(minute=3) if False else True  # placeholder guard removed below
    assert len(session.segments) == 1
    segment = session.segments[0]
    assert segment.kind == SegmentKind.package
    assert segment.price_snapshot == 150
    assert segment.amount == 150
    from datetime import timedelta
    assert segment.starts_at == T + timedelta(minutes=3)
    assert segment.ends_at == T + timedelta(minutes=3) + timedelta(minutes=60)


@pytest.mark.asyncio
async def test_start_open_session_billing_starts_after_grace(db_session):
    from datetime import timedelta

    console_id, _, open_id = await _setup(db_session)

    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=open_id,
        reason=None, comment=None, now=T,
    )

    segment = session.segments[0]
    assert segment.kind == SegmentKind.open
    assert segment.ends_at is None
    assert segment.amount is None
    assert segment.price_snapshot == 120
    assert segment.starts_at == T + timedelta(minutes=3)


@pytest.mark.asyncio
async def test_start_free_session_requires_a_reason(db_session):
    console_id, package_id, _ = await _setup(db_session)

    with pytest.raises(ValidationError):
        await start_session(
            db_session, console_id=console_id, kind=SessionKind.free, tariff_id=None,
            reason=None, comment=None, now=T,
        )


@pytest.mark.asyncio
async def test_start_free_session_writes_an_audit_log_entry(db_session):
    from sqlalchemy import select

    from core.db.models import AuditLog

    console_id, _, _ = await _setup(db_session)

    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.free, tariff_id=None,
        reason="друг владельца", comment=None, now=T,
    )

    entries = (await db_session.execute(select(AuditLog).where(AuditLog.entity_id == session.id))).scalars().all()
    assert len(entries) == 1
    assert entries[0].action == "free_session_start"
    assert entries[0].details["reason"] == "друг владельца"


@pytest.mark.asyncio
async def test_start_session_on_occupied_console_is_a_conflict(db_session):
    console_id, package_id, _ = await _setup(db_session)
    await start_session(
        db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=package_id,
        reason=None, comment=None, now=T,
    )

    with pytest.raises(ConflictError):
        await start_session(
            db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=package_id,
            reason=None, comment=None, now=T,
        )


@pytest.mark.asyncio
async def test_start_session_without_an_open_business_day_is_a_conflict(db_session):
    console_id, package_id, _ = await _setup(db_session, open_day=False)

    with pytest.raises(ConflictError):
        await start_session(
            db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=package_id,
            reason=None, comment=None, now=T,
        )


@pytest.mark.asyncio
async def test_start_session_with_unknown_tariff_is_not_found(db_session):
    console_id, _, _ = await _setup(db_session)

    with pytest.raises(NotFoundError):
        await start_session(
            db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=999,
            reason=None, comment=None, now=T,
        )
```

Drop the broken placeholder line in the first test (`assert session.grace_until == ... if False else True`) — it was left in accidentally. Use this corrected version of that one assertion block:

```python
@pytest.mark.asyncio
async def test_start_paid_package_session_shifts_end_by_grace(db_session):
    from datetime import timedelta

    console_id, package_id, _ = await _setup(db_session)

    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=package_id,
        reason=None, comment=None, now=T,
    )

    assert session.status == SessionStatus.active
    assert session.grace_until == T + timedelta(minutes=3)
    assert len(session.segments) == 1
    segment = session.segments[0]
    assert segment.kind == SegmentKind.package
    assert segment.price_snapshot == 150
    assert segment.amount == 150
    assert segment.starts_at == T + timedelta(minutes=3)
    assert segment.ends_at == T + timedelta(minutes=3) + timedelta(minutes=60)
```

Use this corrected version in the actual test file, replacing the earlier broken one.

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/services/test_sessions_start.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.services.sessions'`.

- [ ] **Step 3: Write `core/services/sessions.py`**

```python
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import AuditLog, Console, SegmentKind, Tariff, TariffKind
from core.db.models import Session as SessionModel
from core.db.models import SessionKind, SessionSegment, SessionStatus
from core.domain import segments as domain_segments
from core.services import business_days, settings as settings_service
from core.services.errors import ConflictError, NotFoundError, ValidationError


def _new_segment_from_tariff(tariff: Tariff, *, starts_at: datetime) -> SessionSegment:
    if tariff.kind == TariffKind.package:
        ends_at = domain_segments.package_segment_end(starts_at, tariff.duration_min)
        return SessionSegment(
            tariff_id=tariff.id, kind=SegmentKind.package, starts_at=starts_at, ends_at=ends_at,
            price_snapshot=tariff.price, amount=tariff.price,
        )
    return SessionSegment(
        tariff_id=tariff.id, kind=SegmentKind.open, starts_at=starts_at, ends_at=None,
        price_snapshot=tariff.hourly_rate, amount=None,
    )


async def start_session(
    db: AsyncSession,
    *,
    console_id: int,
    kind: SessionKind,
    tariff_id: int | None,
    reason: str | None,
    comment: str | None,
    now: datetime,
) -> SessionModel:
    console = await db.get(Console, console_id)
    if console is None or not console.is_active:
        raise NotFoundError(f"console {console_id} not found or inactive")

    occupied = await db.execute(
        select(SessionModel).where(
            SessionModel.console_id == console_id,
            SessionModel.status == SessionStatus.active,
        )
    )
    if occupied.scalars().first() is not None:
        raise ConflictError(f"console {console_id} already has an active session")

    if kind == SessionKind.free and not reason:
        raise ValidationError("free session requires a reason")

    day = await business_days.get_open_business_day(db)
    if day is None:
        raise ConflictError("no open business day")

    grace_minutes = await settings_service.get_grace_minutes(db)
    grace_until = domain_segments.grace_until(now, grace_minutes)

    session = SessionModel(
        console_id=console_id,
        business_day_id=day.id,
        kind=kind,
        reason=reason,
        status=SessionStatus.active,
        started_at=now,
        grace_until=grace_until,
        comment=comment,
    )

    if kind == SessionKind.paid:
        tariff = await db.get(Tariff, tariff_id) if tariff_id else None
        if tariff is None or not tariff.is_active:
            raise NotFoundError(f"tariff {tariff_id} not found or inactive")
        segment = _new_segment_from_tariff(tariff, starts_at=grace_until)
    else:
        segment = SessionSegment(
            tariff_id=None, kind=SegmentKind.open, starts_at=grace_until, ends_at=None,
            price_snapshot=0, amount=None,
        )

    session.segments.append(segment)
    db.add(session)
    await db.flush()  # assigns session.id, needed below before it's committed

    if kind == SessionKind.free:
        db.add(AuditLog(
            action="free_session_start", entity="session", entity_id=session.id,
            details={"console_id": console_id, "reason": reason}, created_at=now,
        ))

    await db.commit()
    await db.refresh(session)
    return session
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/services/test_sessions_start.py -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add core/services/sessions.py tests/services/test_sessions_start.py
git commit -m "feat: add start_session with grace period and free-session audit log"
```

---

### Task 12: Services — extending, stopping, cancelling sessions

**Files:**
- Modify: `core/services/sessions.py`
- Test: `tests/services/test_sessions_lifecycle.py`

**Interfaces:**
- Consumes: `_new_segment_from_tariff`, `start_session` (Task 11); `core.domain.segments.{next_segment_start,is_within_grace,ActiveSegment}` (Task 7); `core.domain.money.open_time_amount` (Task 6).
- Produces: `extend_session(db, *, session_id, tariff_id, now) -> Session`, `stop_session(db, *, session_id, now) -> Session`, `cancel_session(db, *, session_id, now) -> Session`. Consumed by `core/api/routes/sessions.py` (Task 15).

- [ ] **Step 1: Write the failing tests — `tests/services/test_sessions_lifecycle.py`**

```python
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from core.db.models import AuditLog, Console, SegmentKind, SessionKind, SessionStatus, Tariff, TariffKind, Zone
from core.services.business_days import open_business_day
from core.services.errors import ConflictError, ValidationError
from core.services.sessions import cancel_session, extend_session, start_session, stop_session

T = datetime(2026, 9, 23, 12, 0, 0, tzinfo=timezone.utc)


async def _setup(db_session):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    db_session.add(console)
    package = Tariff(zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150)
    open_tariff = Tariff(zone_id=zone.id, kind=TariffKind.open, name="Открытое время", hourly_rate=120)
    db_session.add_all([package, open_tariff])
    await db_session.flush()
    await open_business_day(db_session, opening_cash=5000, now=T)
    await db_session.commit()
    return console.id, package.id, open_tariff.id


@pytest.mark.asyncio
async def test_extend_with_open_time_chains_at_running_packages_end(db_session):
    console_id, package_id, open_id = await _setup(db_session)
    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=package_id,
        reason=None, comment=None, now=T,
    )
    package_end = session.segments[0].ends_at  # T + 3min + 60min

    extended = await extend_session(db_session, session_id=session.id, tariff_id=open_id, now=T + timedelta(minutes=10))

    assert len(extended.segments) == 2
    new_segment = extended.segments[1]
    assert new_segment.kind == SegmentKind.open
    assert new_segment.starts_at == package_end
    assert new_segment.ends_at is None
    # старый пакетный отрезок не тронут
    assert extended.segments[0].ends_at == package_end
    assert extended.segments[0].amount == 150


@pytest.mark.asyncio
async def test_extend_non_paid_session_is_a_validation_error(db_session):
    console_id, _, open_id = await _setup(db_session)
    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.free, tariff_id=None,
        reason="друг", comment=None, now=T,
    )

    with pytest.raises(ValidationError):
        await extend_session(db_session, session_id=session.id, tariff_id=open_id, now=T)


@pytest.mark.asyncio
async def test_stop_closes_a_running_open_segment_and_computes_its_amount(db_session):
    console_id, _, open_id = await _setup(db_session)
    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=open_id,
        reason=None, comment=None, now=T,
    )
    billing_start = session.segments[0].starts_at  # T + 3min

    stopped = await stop_session(db_session, session_id=session.id, now=billing_start + timedelta(minutes=30))

    assert stopped.status == SessionStatus.finished
    segment = stopped.segments[0]
    assert segment.ends_at == billing_start + timedelta(minutes=30)
    assert segment.amount == 60  # 30 минут по 120 сом/час


@pytest.mark.asyncio
async def test_early_stop_of_a_running_package_writes_an_audit_log_entry(db_session):
    console_id, package_id, _ = await _setup(db_session)
    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=package_id,
        reason=None, comment=None, now=T,
    )

    await stop_session(db_session, session_id=session.id, now=T + timedelta(minutes=10))

    entries = (await db_session.execute(select(AuditLog).where(AuditLog.entity_id == session.id))).scalars().all()
    assert len(entries) == 1
    assert entries[0].action == "early_stop"


@pytest.mark.asyncio
async def test_stop_after_package_naturally_ended_writes_no_audit_entry(db_session):
    console_id, package_id, _ = await _setup(db_session)
    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=package_id,
        reason=None, comment=None, now=T,
    )
    package_end = session.segments[0].ends_at

    await stop_session(db_session, session_id=session.id, now=package_end + timedelta(minutes=1))

    entries = (await db_session.execute(select(AuditLog).where(AuditLog.entity_id == session.id))).scalars().all()
    assert len(entries) == 0


@pytest.mark.asyncio
async def test_cancel_within_grace_zeroes_the_segment_and_logs_it(db_session):
    console_id, package_id, _ = await _setup(db_session)
    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=package_id,
        reason=None, comment=None, now=T,
    )

    cancelled = await cancel_session(db_session, session_id=session.id, now=T + timedelta(minutes=2))

    assert cancelled.status == SessionStatus.cancelled
    assert cancelled.segments[0].amount == 0
    entries = (await db_session.execute(select(AuditLog).where(AuditLog.entity_id == session.id))).scalars().all()
    assert any(e.action == "cancel" for e in entries)


@pytest.mark.asyncio
async def test_cancel_after_grace_window_is_a_conflict(db_session):
    console_id, package_id, _ = await _setup(db_session)
    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=package_id,
        reason=None, comment=None, now=T,
    )

    with pytest.raises(ConflictError):
        await cancel_session(db_session, session_id=session.id, now=T + timedelta(minutes=10))
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/services/test_sessions_lifecycle.py -v`
Expected: FAIL with `ImportError: cannot import name 'extend_session'`.

- [ ] **Step 3: Append to `core/services/sessions.py`**

Add these imports to the top of the existing file (merge with the Task 11 import block — the final file has one import section, not two):

```python
from core.domain import money
```

Add these functions at the end of the file:

```python
async def _last_segment(db: AsyncSession, session_id: int) -> SessionSegment | None:
    result = await db.execute(
        select(SessionSegment)
        .where(SessionSegment.session_id == session_id)
        .order_by(SessionSegment.starts_at.desc())
        .limit(1)
    )
    return result.scalars().first()


def _snapshot(segment: SessionSegment) -> domain_segments.ActiveSegment:
    return domain_segments.ActiveSegment(kind=segment.kind.value, starts_at=segment.starts_at, ends_at=segment.ends_at)


async def extend_session(db: AsyncSession, *, session_id: int, tariff_id: int, now: datetime) -> SessionModel:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    if session.status != SessionStatus.active:
        raise ConflictError(f"session {session_id} is not active")
    if session.kind != SessionKind.paid:
        raise ValidationError("only paid sessions can be extended with a tariff")

    tariff = await db.get(Tariff, tariff_id)
    if tariff is None or not tariff.is_active:
        raise NotFoundError(f"tariff {tariff_id} not found or inactive")

    last = await _last_segment(db, session_id)
    start = domain_segments.next_segment_start(now, _snapshot(last) if last else None)

    if last is not None and last.kind == SegmentKind.open and last.ends_at is None:
        last.ends_at = start
        last.amount = money.open_time_amount((start - last.starts_at).total_seconds(), last.price_snapshot)

    session.segments.append(_new_segment_from_tariff(tariff, starts_at=start))
    await db.commit()
    await db.refresh(session)
    return session


async def stop_session(db: AsyncSession, *, session_id: int, now: datetime) -> SessionModel:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    if session.status != SessionStatus.active:
        raise ConflictError(f"session {session_id} is not active")

    last = await _last_segment(db, session_id)
    if last is not None:
        if last.kind == SegmentKind.open and last.ends_at is None:
            last.ends_at = now
            last.amount = (
                money.open_time_amount((now - last.starts_at).total_seconds(), last.price_snapshot)
                if session.kind == SessionKind.paid
                else 0
            )
        elif last.kind == SegmentKind.package and last.ends_at is not None and now < last.ends_at:
            db.add(AuditLog(
                action="early_stop", entity="session", entity_id=session_id,
                details={
                    "segment_id": last.id,
                    "planned_end": last.ends_at.isoformat(),
                    "stopped_at": now.isoformat(),
                },
                created_at=now,
            ))

    session.status = SessionStatus.finished
    session.ended_at = now
    await db.commit()
    await db.refresh(session)
    return session


async def cancel_session(db: AsyncSession, *, session_id: int, now: datetime) -> SessionModel:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    if session.status != SessionStatus.active:
        raise ConflictError(f"session {session_id} is not active")
    if not domain_segments.is_within_grace(now, session.grace_until):
        raise ConflictError("cancel window has expired")

    for segment in session.segments:
        segment.amount = 0
        if segment.kind == SegmentKind.open and segment.ends_at is None:
            segment.ends_at = now

    session.status = SessionStatus.cancelled
    session.ended_at = now
    db.add(AuditLog(
        action="cancel", entity="session", entity_id=session_id,
        details={"cancelled_at": now.isoformat()}, created_at=now,
    ))
    await db.commit()
    await db.refresh(session)
    return session
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/services/test_sessions_lifecycle.py -v`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the full session test suite together to catch any regression from the shared file**

Run: `uv run pytest tests/services/test_sessions_start.py tests/services/test_sessions_lifecycle.py -v`
Expected: PASS (14 tests).

- [ ] **Step 6: Commit**

```bash
git add core/services/sessions.py tests/services/test_sessions_lifecycle.py
git commit -m "feat: add extend, stop and cancel session lifecycle operations"
```

---

### Task 13: Services — payments

**Files:**
- Create: `core/services/payments.py`
- Test: `tests/services/test_payments.py`

**Interfaces:**
- Consumes: `core.domain.money.open_time_amount` (Task 6), `Session`, `SessionKind`, `Payment`, `PaymentMethod` (Tasks 4–5).
- Produces: `session_charge_total(db, session_id, now) -> int`, `session_paid_total(db, session_id) -> int`, `session_balance(db, session_id, now) -> int`, `add_payment(db, *, session_id, amount, method, now) -> Payment`. Consumed by `core/api/routes/sessions.py` (Task 15).

- [ ] **Step 1: Write the failing tests — `tests/services/test_payments.py`**

```python
from datetime import datetime, timedelta, timezone

import pytest

from core.db.models import Console, PaymentMethod, SessionKind, Tariff, TariffKind, Zone
from core.services.business_days import open_business_day
from core.services.errors import NotFoundError
from core.services.payments import add_payment, session_balance, session_charge_total, session_paid_total
from core.services.sessions import start_session, stop_session

T = datetime(2026, 9, 23, 12, 0, 0, tzinfo=timezone.utc)


async def _setup(db_session):
    zone = Zone(name="Зал", is_active=True)
    db_session.add(zone)
    await db_session.flush()
    console = Console(zone_id=zone.id, name="PS5-1")
    db_session.add(console)
    package = Tariff(zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150)
    db_session.add(package)
    await db_session.flush()
    await open_business_day(db_session, opening_cash=5000, now=T)
    await db_session.commit()
    return console.id, package.id


@pytest.mark.asyncio
async def test_charge_total_for_a_package_is_its_price_even_while_running(db_session):
    console_id, package_id = await _setup(db_session)
    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=package_id,
        reason=None, comment=None, now=T,
    )

    assert await session_charge_total(db_session, session.id, now=T + timedelta(minutes=5)) == 150


@pytest.mark.asyncio
async def test_charge_total_and_balance_after_partial_cash_and_qr_payment(db_session):
    console_id, package_id = await _setup(db_session)
    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=package_id,
        reason=None, comment=None, now=T,
    )

    await add_payment(db_session, session_id=session.id, amount=100, method=PaymentMethod.cash, now=T)
    await add_payment(db_session, session_id=session.id, amount=50, method=PaymentMethod.qr, now=T)

    assert await session_paid_total(db_session, session.id) == 150
    assert await session_balance(db_session, session.id, now=T) == 0


@pytest.mark.asyncio
async def test_balance_is_positive_before_full_payment(db_session):
    console_id, package_id = await _setup(db_session)
    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.paid, tariff_id=package_id,
        reason=None, comment=None, now=T,
    )

    await add_payment(db_session, session_id=session.id, amount=100, method=PaymentMethod.cash, now=T)

    assert await session_balance(db_session, session.id, now=T) == 50


@pytest.mark.asyncio
async def test_add_payment_to_unknown_session_is_not_found(db_session):
    with pytest.raises(NotFoundError):
        await add_payment(db_session, session_id=999, amount=100, method=PaymentMethod.cash, now=T)


@pytest.mark.asyncio
async def test_free_session_always_has_zero_charge_total(db_session):
    console_id, _ = await _setup(db_session)
    session = await start_session(
        db_session, console_id=console_id, kind=SessionKind.free, tariff_id=None,
        reason="друг владельца", comment=None, now=T,
    )

    assert await session_charge_total(db_session, session.id, now=T + timedelta(hours=1)) == 0
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/services/test_payments.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.services.payments'`.

- [ ] **Step 3: Write `core/services/payments.py`**

```python
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import Payment, PaymentMethod
from core.db.models import Session as SessionModel
from core.db.models import SessionKind
from core.domain import money
from core.services.errors import NotFoundError


async def session_charge_total(db: AsyncSession, session_id: int, now: datetime) -> int:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")

    if session.kind != SessionKind.paid:
        return 0  # бесплатные и служебные сессии никогда не выставляют счёт

    total = 0
    for segment in session.segments:
        if segment.amount is not None:
            total += segment.amount
        elif segment.ends_at is None:
            total += money.open_time_amount((now - segment.starts_at).total_seconds(), segment.price_snapshot)
    return total


async def session_paid_total(db: AsyncSession, session_id: int) -> int:
    result = await db.execute(select(Payment.amount).where(Payment.session_id == session_id))
    return sum(result.scalars().all())


async def session_balance(db: AsyncSession, session_id: int, now: datetime) -> int:
    charge = await session_charge_total(db, session_id, now)
    paid = await session_paid_total(db, session_id)
    return charge - paid


async def add_payment(
    db: AsyncSession, *, session_id: int, amount: int, method: PaymentMethod, now: datetime
) -> Payment:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")

    payment = Payment(
        session_id=session_id, business_day_id=session.business_day_id,
        amount=amount, method=method, created_at=now,
    )
    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    return payment
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/services/test_payments.py -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add core/services/payments.py tests/services/test_payments.py
git commit -m "feat: add payment service with charge and balance calculation"
```

---

### Task 14: API — business days routes and error mapping

**Files:**
- Create: `core/api/errors.py`
- Create: `core/api/schemas/__init__.py`
- Create: `core/api/schemas/business_days.py`
- Create: `core/api/routes/business_days.py`
- Modify: `core/api/main.py`
- Test: `tests/api/test_business_days.py`

**Interfaces:**
- Consumes: `core.services.business_days.*` (Task 10), `core.services.errors.*` (Task 10).
- Produces: `POST /api/business-days/open`, `GET /api/business-days/current`, `POST /api/business-days/{id}/close`; `register_exception_handlers(app)` used by every later route file.

- [ ] **Step 1: Write `core/api/errors.py`**

```python
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from core.services.errors import ConflictError, NotFoundError, ValidationError


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(NotFoundError)
    async def _not_found(request: Request, exc: NotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(ConflictError)
    async def _conflict(request: Request, exc: ConflictError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(ValidationError)
    async def _validation(request: Request, exc: ValidationError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})
```

- [ ] **Step 2: Write `core/api/schemas/__init__.py`** (empty, marks the package)

```python
```

- [ ] **Step 3: Write `core/api/schemas/business_days.py`**

```python
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class BusinessDayOpenRequest(BaseModel):
    opening_cash: int


class BusinessDayCloseRequest(BaseModel):
    counted_cash: int


class BusinessDayResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    opened_at: datetime
    closed_at: datetime | None
    opening_cash: int
    expected_cash: int | None
    counted_cash: int | None
```

- [ ] **Step 4: Write `core/api/routes/business_days.py`**

```python
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.schemas.business_days import BusinessDayCloseRequest, BusinessDayOpenRequest, BusinessDayResponse
from core.config import settings
from core.db.session import get_session
from core.services import business_days
from core.services.errors import NotFoundError

router = APIRouter(prefix="/business-days", tags=["business-days"])


def _now() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))


@router.post("/open", response_model=BusinessDayResponse)
async def open_day(body: BusinessDayOpenRequest, db: AsyncSession = Depends(get_session)):
    return await business_days.open_business_day(db, opening_cash=body.opening_cash, now=_now())


@router.get("/current", response_model=BusinessDayResponse)
async def current_day(db: AsyncSession = Depends(get_session)):
    day = await business_days.get_open_business_day(db)
    if day is None:
        raise NotFoundError("no open business day")
    return day


@router.post("/{business_day_id}/close", response_model=BusinessDayResponse)
async def close_day(business_day_id: int, body: BusinessDayCloseRequest, db: AsyncSession = Depends(get_session)):
    return await business_days.close_business_day(
        db, business_day_id=business_day_id, counted_cash=body.counted_cash, now=_now(),
    )
```

- [ ] **Step 5: Modify `core/api/main.py`**

Current content (from Stage 1):

```python
from fastapi import FastAPI

from core.api.routes.health import router as health_router


def create_app() -> FastAPI:
    app = FastAPI(title="PS Club API")
    app.include_router(health_router, prefix="/api")
    return app


app = create_app()
```

New content:

```python
from fastapi import FastAPI

from core.api.errors import register_exception_handlers
from core.api.routes.business_days import router as business_days_router
from core.api.routes.health import router as health_router


def create_app() -> FastAPI:
    app = FastAPI(title="PS Club API")
    register_exception_handlers(app)
    app.include_router(health_router, prefix="/api")
    app.include_router(business_days_router, prefix="/api")
    return app


app = create_app()
```

- [ ] **Step 6: Write `tests/api/test_business_days.py`**

```python
import pytest


@pytest.mark.asyncio
async def test_open_then_get_current_business_day(client):
    response = await client.post("/api/business-days/open", json={"opening_cash": 5000})
    assert response.status_code == 200
    body = response.json()
    assert body["opening_cash"] == 5000
    assert body["closed_at"] is None

    current = await client.get("/api/business-days/current")
    assert current.status_code == 200
    assert current.json()["id"] == body["id"]


@pytest.mark.asyncio
async def test_opening_a_second_business_day_is_409(client):
    await client.post("/api/business-days/open", json={"opening_cash": 5000})
    response = await client.post("/api/business-days/open", json={"opening_cash": 1000})
    assert response.status_code == 409


@pytest.mark.asyncio
async def test_current_business_day_is_404_when_none_open(client):
    response = await client.get("/api/business-days/current")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_close_business_day(client):
    opened = (await client.post("/api/business-days/open", json={"opening_cash": 5000})).json()

    closed = await client.post(f"/api/business-days/{opened['id']}/close", json={"counted_cash": 5000})
    assert closed.status_code == 200
    assert closed.json()["expected_cash"] == 5000
```

- [ ] **Step 7: Run**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
  uv run pytest tests/api/test_business_days.py -v
```

Expected: PASS (4 tests).

- [ ] **Step 8: Commit**

```bash
git add core/api tests/api/test_business_days.py
git commit -m "feat: add business day API routes and service-error-to-HTTP mapping"
```

---

### Task 15: API — session and payment routes

**Files:**
- Create: `core/api/schemas/sessions.py`
- Create: `core/api/schemas/payments.py`
- Create: `core/api/routes/sessions.py`
- Modify: `core/api/main.py`
- Test: `tests/api/test_sessions.py`

**Interfaces:**
- Consumes: `core.services.sessions.*` (Tasks 11–12), `core.services.payments.*` (Task 13).
- Produces: `POST /api/sessions`, `GET /api/sessions/{id}`, `POST /api/sessions/{id}/extend`, `POST /api/sessions/{id}/stop`, `POST /api/sessions/{id}/cancel`, `POST /api/sessions/{id}/payments`.

- [ ] **Step 1: Write `core/api/schemas/payments.py`**

```python
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from core.db.models import PaymentMethod


class PaymentRequest(BaseModel):
    amount: int
    method: PaymentMethod


class PaymentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: int
    amount: int
    method: PaymentMethod
    created_at: datetime
```

- [ ] **Step 2: Write `core/api/schemas/sessions.py`**

```python
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from core.db.models import SegmentKind, SessionKind, SessionStatus


class SessionStartRequest(BaseModel):
    console_id: int
    kind: SessionKind = SessionKind.paid
    tariff_id: int | None = None
    reason: str | None = None
    comment: str | None = None


class SessionExtendRequest(BaseModel):
    tariff_id: int


class SegmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    tariff_id: int | None
    kind: SegmentKind
    starts_at: datetime
    ends_at: datetime | None
    price_snapshot: int
    amount: int | None


class SessionResponse(BaseModel):
    id: int
    console_id: int | None
    business_day_id: int
    kind: SessionKind
    reason: str | None
    status: SessionStatus
    started_at: datetime
    grace_until: datetime
    ended_at: datetime | None
    comment: str | None
    segments: list[SegmentResponse]
    charge_total: int
    paid_total: int
    balance: int
```

`SessionResponse` deliberately has no `from_attributes` config — it isn't built directly from the ORM object (`charge_total`/`paid_total`/`balance` aren't columns), it's assembled field-by-field in the route.

- [ ] **Step 3: Write `core/api/routes/sessions.py`**

```python
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.schemas.payments import PaymentRequest, PaymentResponse
from core.api.schemas.sessions import SegmentResponse, SessionExtendRequest, SessionResponse, SessionStartRequest
from core.config import settings
from core.db.models import Session as SessionModel
from core.db.session import get_session
from core.services import payments as payments_service
from core.services import sessions as sessions_service
from core.services.errors import NotFoundError

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _now() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))


async def _to_response(db: AsyncSession, session: SessionModel, now: datetime) -> SessionResponse:
    charge = await payments_service.session_charge_total(db, session.id, now)
    paid = await payments_service.session_paid_total(db, session.id)
    return SessionResponse(
        id=session.id,
        console_id=session.console_id,
        business_day_id=session.business_day_id,
        kind=session.kind,
        reason=session.reason,
        status=session.status,
        started_at=session.started_at,
        grace_until=session.grace_until,
        ended_at=session.ended_at,
        comment=session.comment,
        segments=[SegmentResponse.model_validate(s) for s in session.segments],
        charge_total=charge,
        paid_total=paid,
        balance=charge - paid,
    )


@router.post("", response_model=SessionResponse)
async def start(body: SessionStartRequest, db: AsyncSession = Depends(get_session)):
    now = _now()
    session = await sessions_service.start_session(
        db, console_id=body.console_id, kind=body.kind, tariff_id=body.tariff_id,
        reason=body.reason, comment=body.comment, now=now,
    )
    return await _to_response(db, session, now)


@router.get("/{session_id}", response_model=SessionResponse)
async def get(session_id: int, db: AsyncSession = Depends(get_session)):
    now = _now()
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    return await _to_response(db, session, now)


@router.post("/{session_id}/extend", response_model=SessionResponse)
async def extend(session_id: int, body: SessionExtendRequest, db: AsyncSession = Depends(get_session)):
    now = _now()
    session = await sessions_service.extend_session(db, session_id=session_id, tariff_id=body.tariff_id, now=now)
    return await _to_response(db, session, now)


@router.post("/{session_id}/stop", response_model=SessionResponse)
async def stop(session_id: int, db: AsyncSession = Depends(get_session)):
    now = _now()
    session = await sessions_service.stop_session(db, session_id=session_id, now=now)
    return await _to_response(db, session, now)


@router.post("/{session_id}/cancel", response_model=SessionResponse)
async def cancel(session_id: int, db: AsyncSession = Depends(get_session)):
    now = _now()
    session = await sessions_service.cancel_session(db, session_id=session_id, now=now)
    return await _to_response(db, session, now)


@router.post("/{session_id}/payments", response_model=PaymentResponse)
async def pay(session_id: int, body: PaymentRequest, db: AsyncSession = Depends(get_session)):
    now = _now()
    return await payments_service.add_payment(
        db, session_id=session_id, amount=body.amount, method=body.method, now=now,
    )
```

- [ ] **Step 4: Modify `core/api/main.py`**

```python
from fastapi import FastAPI

from core.api.errors import register_exception_handlers
from core.api.routes.business_days import router as business_days_router
from core.api.routes.health import router as health_router
from core.api.routes.sessions import router as sessions_router


def create_app() -> FastAPI:
    app = FastAPI(title="PS Club API")
    register_exception_handlers(app)
    app.include_router(health_router, prefix="/api")
    app.include_router(business_days_router, prefix="/api")
    app.include_router(sessions_router, prefix="/api")
    return app


app = create_app()
```

- [ ] **Step 5: Write `tests/api/test_sessions.py`**

```python
import pytest


async def _setup(client):
    await client.post("/api/business-days/open", json={"opening_cash": 5000})
    # SQLAdmin isn't wired in yet (Task 16) — insert reference data straight through the ORM
    # via the same DB the `client` fixture points at is not available here, so this test
    # seeds through a second, direct DB connection instead.
    from sqlalchemy import select
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Console, Tariff, TariffKind, Zone

    engine = create_async_engine("postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        console = Console(zone_id=zone.id, name="PS5-1")
        package = Tariff(zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150)
        db.add_all([console, package])
        await db.commit()
        await db.refresh(console)
        await db.refresh(package)
        console_id, package_id = console.id, package.id
    await engine.dispose()
    return console_id, package_id


@pytest.mark.asyncio
async def test_start_session_through_api(client):
    console_id, package_id = await _setup(client)

    response = await client.post("/api/sessions", json={"console_id": console_id, "tariff_id": package_id})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "active"
    assert body["charge_total"] == 150
    assert body["balance"] == 150


@pytest.mark.asyncio
async def test_starting_a_session_without_an_open_business_day_is_409(client):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Console, Tariff, TariffKind, Zone

    engine = create_async_engine("postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test")
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        console = Console(zone_id=zone.id, name="PS5-1")
        package = Tariff(zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150)
        db.add_all([console, package])
        await db.commit()
        await db.refresh(console)
        await db.refresh(package)
        console_id, package_id = console.id, package.id
    await engine.dispose()

    response = await client.post("/api/sessions", json={"console_id": console_id, "tariff_id": package_id})
    assert response.status_code == 409
```

- [ ] **Step 6: Run**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
  uv run pytest tests/api/test_sessions.py -v
```

Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add core/api tests/api/test_sessions.py
git commit -m "feat: add session and payment API routes"
```

---

### Task 16: SQLAdmin for settings

**Files:**
- Modify: `pyproject.toml`
- Create: `core/api/admin.py`
- Modify: `core/api/main.py`

**Interfaces:**
- Consumes: `Zone`, `Console`, `Tariff`, `Product`, `Setting` (Tasks 1–5), the async `engine` from `core/db/session.py` (Stage 1).
- Produces: `register_admin(app)`, mounted at `/admin` — this is where the owner will type in the real prices once they answer `docs/OWNER_QUESTIONS.md` question 2.

- [ ] **Step 1: Add dependencies to `pyproject.toml`**

Add to the `dependencies` list (SQLAdmin needs `python-multipart` for its forms):

```toml
    "sqladmin>=0.19,<0.20",
    "python-multipart>=0.0.9,<0.1",
```

- [ ] **Step 2: Sync**

```bash
uv sync
```

- [ ] **Step 3: Write `core/api/admin.py`**

```python
from fastapi import FastAPI
from sqladmin import Admin, ModelView

from core.db.models import Console, Product, Setting, Tariff, Zone
from core.db.session import engine


class ZoneAdmin(ModelView, model=Zone):
    column_list = [Zone.id, Zone.name, Zone.is_active]


class ConsoleAdmin(ModelView, model=Console):
    column_list = [
        Console.id, Console.zone_id, Console.name,
        Console.plug_driver, Console.plug_address, Console.is_active,
    ]


class TariffAdmin(ModelView, model=Tariff):
    column_list = [
        Tariff.id, Tariff.zone_id, Tariff.kind, Tariff.name,
        Tariff.duration_min, Tariff.price, Tariff.hourly_rate, Tariff.is_active,
    ]


class ProductAdmin(ModelView, model=Product):
    column_list = [Product.id, Product.name, Product.price, Product.is_active]


class SettingAdmin(ModelView, model=Setting):
    column_list = [Setting.key, Setting.value]


def register_admin(app: FastAPI) -> Admin:
    admin = Admin(app, engine)
    admin.add_view(ZoneAdmin)
    admin.add_view(ConsoleAdmin)
    admin.add_view(TariffAdmin)
    admin.add_view(ProductAdmin)
    admin.add_view(SettingAdmin)
    return admin
```

No authentication backend yet — deliberately out of scope here. `SPEC.md` §2 requires login only once the system is reachable from the internet, which is the Stage 7 deploy decision; today it's a single operator on a single local machine.

- [ ] **Step 4: Modify `core/api/main.py`**

```python
from fastapi import FastAPI

from core.api.admin import register_admin
from core.api.errors import register_exception_handlers
from core.api.routes.business_days import router as business_days_router
from core.api.routes.health import router as health_router
from core.api.routes.sessions import router as sessions_router


def create_app() -> FastAPI:
    app = FastAPI(title="PS Club API")
    register_exception_handlers(app)
    register_admin(app)
    app.include_router(health_router, prefix="/api")
    app.include_router(business_days_router, prefix="/api")
    app.include_router(sessions_router, prefix="/api")
    return app


app = create_app()
```

- [ ] **Step 5: Verify by hand**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
  uv run uvicorn core.api.main:app --reload
```

Open `http://127.0.0.1:8000/admin` in a browser. Expected: SQLAdmin's dashboard listing Zone, Console, Tariff, Product, Setting; clicking into "Tariff" shows the columns from `column_list` and a working "create" form. Stop the server (Ctrl+C).

- [ ] **Step 6: Run the full test suite to confirm nothing broke**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest -v
```

Expected: all tests from Tasks 6–15 still pass.

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml uv.lock core/api/admin.py core/api/main.py
git commit -m "feat: add SQLAdmin for zones, consoles, tariffs, products and settings"
```

---

### Task 17: Dev seed data

**Files:**
- Create: `core/db/seed.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: `Zone`, `Console`, `Tariff`, `TariffKind`, `Setting` (Tasks 1–3), `async_session_factory` (Stage 1).
- Produces: `core.db.seed.seed_dev_data()`, runnable as `uv run python -m core.db.seed` — the only place in this stage that writes a concrete price, and it's explicitly marked as a placeholder.

- [ ] **Step 1: Write `core/db/seed.py`**

```python
import asyncio

from core.db.models import Console, Setting, Tariff, TariffKind, Zone
from core.db.session import async_session_factory


async def seed_dev_data() -> None:
    async with async_session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()

        for i in range(1, 4):
            db.add(Console(zone_id=zone.id, name=f"PS5-{i}", plug_driver="manual", is_active=True))

        # ЗАГЛУШКИ: владелец ещё не ответил на docs/OWNER_QUESTIONS.md, вопрос 2
        # (цены пакетов, часовая ставка, названия). Поправить в /admin, когда ответит.
        db.add(Tariff(zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150))
        db.add(Tariff(zone_id=zone.id, kind=TariffKind.package, name="3 часа", duration_min=180, price=400))
        db.add(Tariff(zone_id=zone.id, kind=TariffKind.package, name="5 часов", duration_min=300, price=600))
        db.add(Tariff(zone_id=zone.id, kind=TariffKind.open, name="Открытое время", hourly_rate=120))

        db.add(Setting(key="grace_minutes", value="3"))
        db.add(Setting(key="warn_minutes", value="5"))

        await db.commit()


if __name__ == "__main__":
    asyncio.run(seed_dev_data())
```

- [ ] **Step 2: Run it against the stage-2 dev database and verify**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run python -m core.db.seed
docker exec psclub-db-stage2 psql -U psclub -d psclub -c "select name, kind, price, hourly_rate from tariffs;"
```

Expected: 4 rows — three packages with prices, one open tariff with an hourly rate.

- [ ] **Step 3: Add a short section to `README.md`**

Insert after the existing "## Миграции" section:

```markdown
## Тестовые данные для разработки

    uv run python -m core.db.seed

Создаёт одну зону, три консоли и тарифы-заглушки (цены не согласованы с
владельцем — см. `docs/OWNER_QUESTIONS.md`). Реальные цены правятся в
`/admin` (SQLAdmin), без изменения кода.

## Админка

`/admin` — SQLAdmin: зоны, консоли, тарифы, товары, настройки. Пока без
авторизации (нужна только для гибридного варианта, см. этап 7).
```

- [ ] **Step 4: Commit**

```bash
git add core/db/seed.py README.md
git commit -m "feat: add dev seed script with placeholder tariffs"
```

---

### Task 18: Full-stage verification against the PLAN.md done-criterion

**Files:** none created — this task only runs and confirms.

**Interfaces:** consumes the entire stack from Tasks 1–17.

- [ ] **Step 1: Write the end-to-end test that mirrors the literal done-criterion — `tests/api/test_full_cycle.py`**

> «через API проходит полный цикл: старт пакета → продление открытым временем → стоп → оплата частями»

```python
from datetime import timedelta

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.db.models import Console, Tariff, TariffKind, Zone

TEST_DATABASE_URL = "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"


async def _seed_reference_data():
    engine = create_async_engine(TEST_DATABASE_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        console = Console(zone_id=zone.id, name="PS5-1")
        package = Tariff(zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150)
        open_tariff = Tariff(zone_id=zone.id, kind=TariffKind.open, name="Открытое время", hourly_rate=120)
        db.add_all([console, package, open_tariff])
        await db.commit()
        await db.refresh(console)
        await db.refresh(package)
        await db.refresh(open_tariff)
        ids = (console.id, package.id, open_tariff.id)
    await engine.dispose()
    return ids


@pytest.mark.asyncio
async def test_full_session_cycle_through_the_api(client):
    console_id, package_id, open_id = await _seed_reference_data()

    await client.post("/api/business-days/open", json={"opening_cash": 5000})

    # старт пакета
    started = await client.post("/api/sessions", json={"console_id": console_id, "tariff_id": package_id})
    assert started.status_code == 200
    session_id = started.json()["id"]
    assert started.json()["segments"][0]["kind"] == "package"
    assert started.json()["charge_total"] == 150

    # продление открытым временем
    extended = await client.post(f"/api/sessions/{session_id}/extend", json={"tariff_id": open_id})
    assert extended.status_code == 200
    segments = extended.json()["segments"]
    assert len(segments) == 2
    assert segments[1]["kind"] == "open"
    assert segments[1]["starts_at"] == segments[0]["ends_at"]  # чейнится на конец пакета, SPEC 3.2

    # стоп
    stopped = await client.post(f"/api/sessions/{session_id}/stop")
    assert stopped.status_code == 200
    assert stopped.json()["status"] == "finished"
    balance_due = stopped.json()["balance"]
    assert balance_due > 150  # пакет + какое-то открытое время

    # оплата частями: наличные, потом QR на остаток
    first_payment = balance_due // 2
    remainder = balance_due - first_payment
    pay1 = await client.post(f"/api/sessions/{session_id}/payments", json={"amount": first_payment, "method": "cash"})
    assert pay1.status_code == 200
    pay2 = await client.post(f"/api/sessions/{session_id}/payments", json={"amount": remainder, "method": "qr"})
    assert pay2.status_code == 200

    final = await client.get(f"/api/sessions/{session_id}")
    assert final.json()["balance"] == 0
    assert final.json()["paid_total"] == balance_due
```

- [ ] **Step 2: Run it**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
  uv run pytest tests/api/test_full_cycle.py -v
```

Expected: PASS.

- [ ] **Step 3: Run every test in the repo, plus linters**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest -v
uv run ruff check .
cd web && npm run lint && npx tsc -b --noEmit && cd ..
```

Expected: all green. (The frontend hasn't changed in this stage — this step only guards against an unrelated regression.)

- [ ] **Step 4: Confirm the DB-free part of the done-criterion explicitly**

> «доменная логика покрыта тестами без БД»

```bash
uv run pytest tests/domain tests/plugs -v
```

Run this *without* the `DATABASE_URL` prefix and *without* the stage-2 container running, to prove it truly doesn't touch a database:

```bash
docker stop psclub-db-stage2
uv run pytest tests/domain tests/plugs -v
```

Expected: still PASS — `core/domain/` and `core/plugs/` import nothing from `core.db` or `sqlalchemy`.

- [ ] **Step 5: Restart the container and run the full suite one last time to confirm Step 4's stop didn't corrupt anything**

```bash
docker start psclub-db-stage2
sleep 2
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest -v
```

Expected: all green again.

- [ ] **Step 6: Tear down the stage-2 throwaway container for good**

```bash
docker stop psclub-db-stage2
```

- [ ] **Step 7: No commit needed — this task only verifies.** If any check in Steps 2–5 failed, fix it in the relevant earlier task's files and re-run this task before moving on.

---

## Self-Review Notes

- **Spec coverage:** all eleven `docs/SPEC.md` §7 tables get a model (Tasks 1–5). All five domain rules in the PLAN.md stage-2 bullet — cost calculation, segments, 3-minute grace, switch-to-open-during-package, som rounding — are pure-tested in Tasks 6–7. All five services in the bullet — start, extend, stop, cancel, payment — are built and DB-tested in Tasks 11–13, including the free/service session path. `PlugDriver` + manual driver (Task 8) matches the bullet exactly, with a fake driver added per `SPEC.md` §5.3. "API и SQLAdmin для настроек" is Tasks 14–16. The done-criterion's literal sentence is Task 18's `test_full_session_cycle_through_the_api`, and the "no DB" half is re-verified by killing the database and re-running the domain/plugs suite.
- **Explicitly out of scope, confirmed against `CLAUDE.md`/`SPEC.md`/`PLAN.md`:** bar service and API (Stage 4 — only the `products`/`orders` tables exist), зал screen and WebSocket timers (Stage 3), Telegram bot content (Stage 6), `agent/` and real plug hardware (Phase 2), SQLAdmin authentication (Stage 7, hybrid-only).
- **Two deliberate assumptions flagged for the owner, beyond the already-known price gap:** (1) rounding of the open-time total uses `ROUND_HALF_UP`, which the spec doesn't pin down; (2) package-to-package or package-to-open extension chains at the running package's `ends_at`, generalizing the one example `SPEC.md` gives (switching to open time) to every extension, on the reasoning that the alternative would silently discard paid-for time.
- **Type/name consistency check:** `core.db.models.Session` is imported as `SessionModel` everywhere it's used alongside `sqlalchemy.ext.asyncio.AsyncSession`, to avoid the name collision — consistent across `core/services/sessions.py`, `core/services/payments.py`, `core/api/routes/sessions.py`, and every test file. `ActiveSegment`/`next_segment_start`/`grace_until`/`package_segment_end`/`is_within_grace` (Task 7) are the exact names `core/services/sessions.py` imports in Tasks 11–12. `session_charge_total`/`session_paid_total`/`session_balance`/`add_payment` (Task 13) are the exact names `core/api/routes/sessions.py` imports in Task 15. `ServiceError`/`NotFoundError`/`ConflictError`/`ValidationError` (Task 10) are the only three exception types raised anywhere in `core/services/`, and `core/api/errors.py` (Task 14) handles exactly those three.
