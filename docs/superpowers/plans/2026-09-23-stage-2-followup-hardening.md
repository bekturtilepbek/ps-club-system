# Stage 2 Follow-Up Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six Important findings and two Minor findings that the Stage 2 final whole-branch review deliberately deferred as a fast-follow ("belong before Stage 3 starts", per the reviewer's own merge-gate calibration) — payment/business-day attribution, payment amount validation, race-condition protection at the database level, `audit_log` column type, test onboarding, a small dedup, settings robustness, and SQLAdmin delete/audit hardening.

**Architecture:** No new layers — every change lands inside the existing `core/domain` / `core/services` / `core/api` split from Stage 2. One new Alembic migration adds two partial unique indexes (Postgres-level backstops for the check-then-insert races in `start_session` and `open_business_day`) and converts `audit_log.details` from `JSON` to `JSONB`. Two service functions gain an `IntegrityError → ConflictError` mapping so the new constraints degrade gracefully instead of 500ing. SQLAdmin gains `after_model_change`/`after_model_delete` hooks on `TariffAdmin` and `SettingAdmin` to satisfy CLAUDE.md rule 9's "tariff change" audit requirement, and `can_delete = False` on the views whose rows are FK-referenced elsewhere.

**Tech Stack:** Same as Stage 2 — FastAPI, Pydantic v2, SQLAlchemy 2 (async), Alembic, SQLAdmin, pytest + pytest-asyncio.

**Spec:** This plan's tasks are pre-scoped by the Stage 2 final review's own findings (see that review's Important/Minor sections) and the controller's rulings recorded in the now-deleted SDD ledger for `2026-09-23-stage-2-domain-core`; the rulings are restated in each task below so this plan is self-contained. Underlying spec: `docs/SPEC.md` §3.4 (payments), §7 (data model), CLAUDE.md domain rules 9 (audit log) and 10 (cash/non-cash separation).

## Global Constraints

- **No scope beyond the eight findings below.** This is a hardening pass, not new feature work — do not add anything the findings don't call for.
- **`core/domain/` stays pure.** None of these changes touch `core/domain/` — if a task seems to require it, stop and ask.
- **Enums stored as VARCHAR** (existing convention) — the new partial unique index on `sessions.status = 'active'` relies on this: `SessionStatus.active.value == "active"` is the literal string stored in the column.
- **Python 3.12, `uv`-managed deps, commit messages in English/imperative, no AI attribution, one logical change per commit** — same conventions as Stage 2.
- **Code comments in English; only genuine UI-facing data (zone/tariff names, free-session reasons) stays Russian** — the CLAUDE.md rule Stage 2 had to fix repeatedly. Nothing in this plan's code blocks is in Russian, so this should be moot, but stay alert while writing anything not given verbatim here.
- The throwaway dev Postgres from Stage 2 no longer exists (stopped after the stage's merge). Every task that touches the database starts one fresh on host port 5433, exactly as Stage 2's tasks did.

---

### Task 1: Attribute payments to the currently-open business day

**Files:**
- Modify: `core/services/payments.py`
- Modify: `tests/services/test_payments.py`

**Interfaces:**
- Consumes: `core.services.business_days.get_open_business_day` (existing).
- Produces: no interface change — `add_payment`'s signature is unchanged, only its `business_day_id` source and error behavior change.

**Ruling being implemented:** Stage 2's plan stated in its own Global Constraints that `payments.business_day_id` is set "from whichever `business_days` row has `closed_at IS NULL`", but the plan's own code sample (and the shipped code) instead copied `session.business_day_id`. The prose constraint is correct and binding: a payment is money that lands in whichever day's cash register is open *when the payment happens*, not necessarily the day the session started (a guest can settle a balance on a later day). `add_payment` must look up the open day itself and refuse if none is open.

- [ ] **Step 1: Write the new/changed tests in `tests/services/test_payments.py`**

Add this import to the existing import block (alongside the other `core.services.errors` import):

```python
from core.services.errors import ConflictError, NotFoundError
```

Add these two test functions at the end of the file:

```python
@pytest.mark.asyncio
async def test_add_payment_attributes_to_the_currently_open_business_day_not_the_sessions(
    db_session,
):
    console_id, package_id = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )
    first_day_id = session.business_day_id

    from core.services.business_days import close_business_day, open_business_day

    # finish the session so the first day can close, then open a second day
    from core.services.sessions import stop_session

    await stop_session(db_session, session_id=session.id, now=T + timedelta(hours=1))
    await close_business_day(
        db_session, business_day_id=first_day_id, counted_cash=150, now=T + timedelta(hours=2)
    )
    second_day = await open_business_day(db_session, opening_cash=1000, now=T + timedelta(days=1))

    payment = await add_payment(
        db_session,
        session_id=session.id,
        amount=150,
        method=PaymentMethod.cash,
        now=T + timedelta(days=1, hours=1),
    )

    assert payment.business_day_id == second_day.id
    assert payment.business_day_id != first_day_id


@pytest.mark.asyncio
async def test_add_payment_without_an_open_business_day_is_a_conflict(db_session):
    console_id, package_id = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )

    from core.services.business_days import close_business_day
    from core.services.sessions import stop_session

    await stop_session(db_session, session_id=session.id, now=T + timedelta(hours=1))
    await close_business_day(
        db_session, business_day_id=session.business_day_id, counted_cash=150, now=T + timedelta(hours=2)
    )

    with pytest.raises(ConflictError):
        await add_payment(
            db_session, session_id=session.id, amount=150, method=PaymentMethod.cash, now=T
        )
```

Run: `DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest tests/services/test_payments.py -v`
Expected: FAIL — `test_add_payment_attributes_to_the_currently_open_business_day_not_the_sessions` fails because `payment.business_day_id == first_day_id` (the current, wrong behavior); `test_add_payment_without_an_open_business_day_is_a_conflict` fails because no `ConflictError` is raised.

- [ ] **Step 2: Fix `core/services/payments.py`**

Change the imports at the top from:

```python
from core.db.models import Payment, PaymentMethod, SessionKind
from core.db.models import Session as SessionModel
from core.domain import money
from core.services.errors import NotFoundError
```

to:

```python
from core.db.models import Payment, PaymentMethod, SessionKind
from core.db.models import Session as SessionModel
from core.domain import money
from core.services import business_days
from core.services.errors import ConflictError, NotFoundError
```

Change `add_payment` from:

```python
async def add_payment(
    db: AsyncSession, *, session_id: int, amount: int, method: PaymentMethod, now: datetime
) -> Payment:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")

    payment = Payment(
        session_id=session_id,
        business_day_id=session.business_day_id,
        amount=amount,
        method=method,
        created_at=now,
    )
    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    return payment
```

to:

```python
async def add_payment(
    db: AsyncSession, *, session_id: int, amount: int, method: PaymentMethod, now: datetime
) -> Payment:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")

    day = await business_days.get_open_business_day(db)
    if day is None:
        raise ConflictError("no open business day")

    payment = Payment(
        session_id=session_id,
        business_day_id=day.id,
        amount=amount,
        method=method,
        created_at=now,
    )
    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    return payment
```

- [ ] **Step 3: Run and verify**

Run: `DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest tests/services/test_payments.py -v`
Expected: all tests PASS (5 existing + 2 new = 7). The existing tests still pass unchanged because `_setup` always opens a business day before starting a session, so `get_open_business_day` finds the same day `session.business_day_id` already pointed to in those simpler scenarios.

- [ ] **Step 4: Commit**

```bash
git add core/services/payments.py tests/services/test_payments.py
git commit -m "fix: attribute payments to the currently open business day"
```

---

### Task 2: Validate payment amounts

**Files:**
- Modify: `core/api/schemas/payments.py`
- Modify: `core/services/payments.py`
- Modify: `tests/services/test_payments.py`
- Modify: `tests/api/test_sessions.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: `add_payment` now raises `ValidationError` for `amount <= 0`; `PaymentRequest` now rejects `amount <= 0` at the HTTP boundary with a 422 before the service is ever called.

**Ruling being implemented:** payment amounts were unvalidated — zero and negative amounts were silently accepted, letting anyone offset cash totals. Both the API schema (fast, user-facing 422) and the service (defense in depth for any future non-HTTP caller, e.g. the bot in a later stage) must reject non-positive amounts.

- [ ] **Step 1: Write the failing tests**

In `tests/services/test_payments.py`, add this test at the end of the file:

```python
@pytest.mark.asyncio
async def test_add_payment_rejects_a_non_positive_amount(db_session):
    from core.services.errors import ValidationError

    console_id, package_id = await _setup(db_session)
    session = await start_session(
        db_session,
        console_id=console_id,
        kind=SessionKind.paid,
        tariff_id=package_id,
        reason=None,
        comment=None,
        now=T,
    )

    with pytest.raises(ValidationError):
        await add_payment(db_session, session_id=session.id, amount=0, method=PaymentMethod.cash, now=T)
    with pytest.raises(ValidationError):
        await add_payment(
            db_session, session_id=session.id, amount=-10, method=PaymentMethod.cash, now=T
        )
```

In `tests/api/test_sessions.py`, add this test at the end of the file:

```python
@pytest.mark.asyncio
async def test_paying_a_non_positive_amount_is_422(client):
    console_id, package_id = await _setup(client)
    started = await client.post(
        "/api/sessions", json={"console_id": console_id, "tariff_id": package_id}
    )
    session_id = started.json()["id"]

    response = await client.post(
        f"/api/sessions/{session_id}/payments", json={"amount": 0, "method": "cash"}
    )
    assert response.status_code == 422
```

Run: `DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest tests/services/test_payments.py tests/api/test_sessions.py -v`
Expected: FAIL — neither guard exists yet.

- [ ] **Step 2: Add the schema-level guard — `core/api/schemas/payments.py`**

Change:

```python
from datetime import datetime

from pydantic import BaseModel, ConfigDict

from core.db.models import PaymentMethod


class PaymentRequest(BaseModel):
    amount: int
    method: PaymentMethod
```

to:

```python
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from core.db.models import PaymentMethod


class PaymentRequest(BaseModel):
    amount: int = Field(gt=0)
    method: PaymentMethod
```

- [ ] **Step 3: Add the service-level guard — `core/services/payments.py`**

Add `ValidationError` to the existing `core.services.errors` import (from Task 1's edit, it currently reads `from core.services.errors import ConflictError, NotFoundError`):

```python
from core.services.errors import ConflictError, NotFoundError, ValidationError
```

At the top of `add_payment`, right after the `NotFoundError` check, add:

```python
    if amount <= 0:
        raise ValidationError("payment amount must be positive")
```

So the function's opening lines read:

```python
async def add_payment(
    db: AsyncSession, *, session_id: int, amount: int, method: PaymentMethod, now: datetime
) -> Payment:
    session = await db.get(SessionModel, session_id)
    if session is None:
        raise NotFoundError(f"session {session_id} not found")
    if amount <= 0:
        raise ValidationError("payment amount must be positive")

    day = await business_days.get_open_business_day(db)
    ...
```

- [ ] **Step 4: Run and verify**

Run: `DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest tests/services/test_payments.py tests/api/test_sessions.py -v`
Expected: all PASS (8 in test_payments.py, 3 in test_sessions.py).

- [ ] **Step 5: Commit**

```bash
git add core/api/schemas/payments.py core/services/payments.py tests/services/test_payments.py tests/api/test_sessions.py
git commit -m "fix: reject non-positive payment amounts"
```

---

### Task 3: Database-level race protection and `audit_log` as JSONB

**Files:**
- Create: migration under `core/db/alembic/versions/` (hand-written, not autogenerated)
- Modify: `core/db/models/audit.py`
- Modify: `core/services/sessions.py`
- Modify: `core/services/business_days.py`
- Modify: `tests/services/test_sessions_start.py`
- Modify: `tests/services/test_business_days.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: no interface change — `start_session` and `open_business_day` already raise `ConflictError` for the same situations at the application level; this task adds a database-level backstop for the race window between that check and the insert, mapped to the same `ConflictError`.

**Ruling being implemented:** `start_session`'s "is this console occupied" check and `open_business_day`'s "is a day already open" check are both check-then-insert with no database backing. Two concurrent requests (a double-tap in a future touch UI) can both pass the check before either inserts, creating two active sessions on one console or two open business days — after which `get_open_business_day`'s `scalar_one_or_none()` raises `MultipleResultsFound` and every later call 500s until someone fixes the database by hand. Fix with partial unique indexes plus `IntegrityError → ConflictError` mapping. Bundled in the same migration: `audit_log.details` becomes `JSONB` (SPEC §7 says `jsonb`; Stage 2 shipped plain `JSON`).

- [ ] **Step 1: Start the throwaway dev Postgres**

```bash
docker run --rm -d --name psclub-db-followup \
  -e POSTGRES_DB=psclub -e POSTGRES_USER=psclub -e POSTGRES_PASSWORD=psclub \
  -p 5433:5432 postgres:16-alpine
```

Wait for it, then create the test database and apply all existing migrations:

```bash
docker exec psclub-db-followup pg_isready -U psclub
docker exec psclub-db-followup psql -U psclub -d psclub -c "CREATE DATABASE psclub_test"
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head
```

- [ ] **Step 2: Update `core/db/models/audit.py`**

Change:

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

to:

```python
from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from core.db.base import Base


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(primary_key=True)
    action: Mapped[str] = mapped_column(String(100))
    entity: Mapped[str] = mapped_column(String(100))
    entity_id: Mapped[int] = mapped_column()
    details: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
```

- [ ] **Step 3: Generate an empty migration and fill it in by hand**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
  uv run alembic revision -m "add uniqueness constraints and jsonb audit details"
```

This creates a file with empty `upgrade()`/`downgrade()` bodies (do NOT use `--autogenerate` here — expression-based partial unique indexes aren't reliably autogenerated, so this migration is hand-written, same as the Stage 1 baseline). Find the generated file under `core/db/alembic/versions/`, note its `down_revision` — it should already read `down_revision: Union[str, None] = 'fc0da24014d6'` (the head from Stage 2). Replace its `upgrade()`/`downgrade()` functions with:

```python
def upgrade() -> None:
    op.execute(
        "CREATE UNIQUE INDEX ux_sessions_one_active_per_console "
        "ON sessions (console_id) WHERE status = 'active'"
    )
    op.execute(
        "CREATE UNIQUE INDEX ux_business_days_one_open "
        "ON business_days ((1)) WHERE closed_at IS NULL"
    )
    op.execute("ALTER TABLE audit_log ALTER COLUMN details TYPE JSONB USING details::jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE audit_log ALTER COLUMN details TYPE JSON USING details::json")
    op.execute("DROP INDEX ux_business_days_one_open")
    op.execute("DROP INDEX ux_sessions_one_active_per_console")
```

- [ ] **Step 4: Apply and verify the constraints exist**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head
docker exec psclub-db-followup psql -U psclub -d psclub -c "\d sessions"
docker exec psclub-db-followup psql -U psclub -d psclub -c "\d business_days"
docker exec psclub-db-followup psql -U psclub -d psclub -c "\d audit_log"
```

Expected: `sessions` lists `ux_sessions_one_active_per_console` under indexes; `business_days` lists `ux_business_days_one_open`; `audit_log.details` shows type `jsonb`.

- [ ] **Step 5: Round-trip the migration**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic downgrade -1
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head
```

Expected: both succeed with no errors.

- [ ] **Step 6: Map `IntegrityError` to `ConflictError` in `core/services/sessions.py`**

Add to the imports:

```python
from sqlalchemy.exc import IntegrityError
```

In `start_session`, change:

```python
    session.segments.append(segment)
    db.add(session)
    await db.flush()  # assigns session.id, needed below before it's committed
```

to:

```python
    session.segments.append(segment)
    db.add(session)
    try:
        await db.flush()  # assigns session.id, needed below before it's committed
    except IntegrityError:
        await db.rollback()
        raise ConflictError(f"console {console_id} already has an active session") from None
```

- [ ] **Step 7: Map `IntegrityError` to `ConflictError` in `core/services/business_days.py`**

Add to the imports:

```python
from sqlalchemy.exc import IntegrityError
```

Change `open_business_day` from:

```python
async def open_business_day(db: AsyncSession, *, opening_cash: int, now: datetime) -> BusinessDay:
    if await get_open_business_day(db) is not None:
        raise ConflictError("business day already open")

    day = BusinessDay(opened_at=now, opening_cash=opening_cash)
    db.add(day)
    await db.commit()
    await db.refresh(day)
    return day
```

to:

```python
async def open_business_day(db: AsyncSession, *, opening_cash: int, now: datetime) -> BusinessDay:
    if await get_open_business_day(db) is not None:
        raise ConflictError("business day already open")

    day = BusinessDay(opened_at=now, opening_cash=opening_cash)
    db.add(day)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ConflictError("business day already open") from None
    await db.refresh(day)
    return day
```

- [ ] **Step 8: Write the race-condition tests**

These tests prove the database constraint catches what the application-level check alone cannot: two concurrent requests (two independent `AsyncSession`s, like two real HTTP requests) both passing the "is this free?" check before either finishes inserting. The test doesn't assert *which* mechanism caught the loser (app-level check or DB constraint) — whichever coroutine's DB operations happen to interleave first, the outcome is always exactly one success and one `ConflictError`, so the test is not flaky regardless of exact `asyncio` scheduling.

Add to `tests/services/test_sessions_start.py` (add `import asyncio` and `import os` at the top of the file, and add `from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine` alongside the existing imports if not already present):

```python
import asyncio
import os

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"
)


@pytest.mark.asyncio
async def test_concurrent_starts_on_the_same_console_only_one_succeeds(db_session):
    console_id, package_id, _ = await _setup(db_session)

    engine2 = create_async_engine(TEST_DATABASE_URL)
    session_factory2 = async_sessionmaker(engine2, expire_on_commit=False)
    async with session_factory2() as db_session2:
        results = await asyncio.gather(
            start_session(
                db_session,
                console_id=console_id,
                kind=SessionKind.paid,
                tariff_id=package_id,
                reason=None,
                comment=None,
                now=T,
            ),
            start_session(
                db_session2,
                console_id=console_id,
                kind=SessionKind.paid,
                tariff_id=package_id,
                reason=None,
                comment=None,
                now=T,
            ),
            return_exceptions=True,
        )
    await engine2.dispose()

    successes = [r for r in results if not isinstance(r, BaseException)]
    failures = [r for r in results if isinstance(r, BaseException)]
    assert len(successes) == 1
    assert len(failures) == 1
    assert isinstance(failures[0], ConflictError)
```

(`ConflictError` needs to be imported in this test file — check the existing imports at the top; add `from core.services.errors import ConflictError` if it isn't already there, merging with whatever's already imported from that module.)

Add the equivalent for business days to `tests/services/test_business_days.py` (same `os`/`asyncio`/engine imports pattern):

```python
import asyncio
import os

from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"
)


@pytest.mark.asyncio
async def test_concurrent_opens_only_one_succeeds(db_session):
    engine2 = create_async_engine(TEST_DATABASE_URL)
    session_factory2 = async_sessionmaker(engine2, expire_on_commit=False)
    async with session_factory2() as db_session2:
        results = await asyncio.gather(
            open_business_day(db_session, opening_cash=5000, now=T),
            open_business_day(db_session2, opening_cash=1000, now=T),
            return_exceptions=True,
        )
    await engine2.dispose()

    successes = [r for r in results if not isinstance(r, BaseException)]
    failures = [r for r in results if isinstance(r, BaseException)]
    assert len(successes) == 1
    assert len(failures) == 1
    assert isinstance(failures[0], ConflictError)
```

- [ ] **Step 9: Run and verify**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
  uv run pytest tests/services/test_sessions_start.py tests/services/test_business_days.py -v
```

Expected: all PASS, including the two new concurrency tests. Run them a few extra times in a loop to build confidence they aren't flaky:

```bash
for i in 1 2 3; do
  DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
    uv run pytest tests/services/test_sessions_start.py::test_concurrent_starts_on_the_same_console_only_one_succeeds \
    tests/services/test_business_days.py::test_concurrent_opens_only_one_succeeds -v
done
```

- [ ] **Step 10: Commit**

```bash
git add core/db/alembic core/db/models/audit.py core/services/sessions.py core/services/business_days.py tests/services/test_sessions_start.py tests/services/test_business_days.py
git commit -m "feat: add DB-level race protection for session/business-day uniqueness and JSONB audit details"
```

---

### Task 4: Test database URL from environment, and document it

**Files:**
- Modify: `tests/conftest.py`
- Modify: `tests/api/conftest.py`
- Modify: `tests/api/test_full_cycle.py`
- Modify: `tests/api/test_sessions.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing new.
- Produces: no interface change — `TEST_DATABASE_URL` still defaults to the exact same value, just overridable via the `TEST_DATABASE_URL` environment variable.

**Ruling being implemented:** the test database URL (`postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test`) was hardcoded in five files. A fresh contributor following the README's existing "Тесты и линтеры" section has no throwaway Postgres on port 5433 and `uv run pytest` fails outright with connection errors on every DB-backed test.

- [ ] **Step 1: `tests/conftest.py`**

Change:

```python
TEST_DATABASE_URL = "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"
```

to:

```python
import os

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"
)
```

(Add the `import os` in the correct position at the top of the file, alongside the existing imports — don't just paste it mid-file.)

- [ ] **Step 2: `tests/api/conftest.py`**

Same change as Step 1, same two lines, same import placement.

- [ ] **Step 3: `tests/api/test_full_cycle.py`**

Same change — this file also declares its own `TEST_DATABASE_URL` module-level constant for the `_seed_reference_data` helper's direct engine.

- [ ] **Step 4: `tests/api/test_sessions.py`**

This file inlines the URL literally twice (once in `_setup`, once in `test_starting_a_session_without_an_open_business_day_is_409`) rather than declaring a module constant. Add the same `os.environ.get(...)` pattern as a module-level `TEST_DATABASE_URL` constant near the top of the file (after the `import pytest` line), then replace both inline literal URL strings with `TEST_DATABASE_URL`.

- [ ] **Step 5: Document it in `README.md`**

In the "## Тесты и линтеры" section, replace:

```markdown
## Тесты и линтеры

    uv run pytest
    uv run ruff check .

    cd web
    npm run test
    npm run lint
```

with:

```markdown
## Тесты и линтеры

Тесты, которые трогают БД (`services`, `api`), ждут одноразовый Postgres на
порту 5433 и базу `psclub_test` в нём:

    docker run --rm -d --name psclub-db-dev \
      -e POSTGRES_DB=psclub -e POSTGRES_USER=psclub -e POSTGRES_PASSWORD=psclub \
      -p 5433:5432 postgres:16-alpine
    docker exec psclub-db-dev psql -U psclub -d psclub -c "CREATE DATABASE psclub_test"
    DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head

Порт 5433, а не 5432 — чтобы не конфликтовать с `docker-compose.yml`. Адрес
тестовой базы можно переопределить переменной `TEST_DATABASE_URL`, если
5433 занят.

    uv run pytest
    uv run ruff check .

    cd web
    npm run test
    npm run lint
```

- [ ] **Step 6: Run and verify**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest -v
```

Expected: full suite still green (should be at or above the count from the end of Task 3, since this task adds no new tests, only changes how the URL is sourced).

Also verify the override actually works — point it somewhere nonexistent and confirm it fails to connect (proving the env var is actually read, not silently ignored):

```bash
TEST_DATABASE_URL=postgresql+asyncpg://nope:nope@localhost:1/nope \
  DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub \
  uv run pytest tests/services/test_fixtures_smoke.py -v
```

Expected: FAILS with a connection error (`ConnectionRefusedError` or similar) mentioning port 1 — proves `TEST_DATABASE_URL` is genuinely read from the environment.

- [ ] **Step 7: Commit**

```bash
git add tests/conftest.py tests/api/conftest.py tests/api/test_full_cycle.py tests/api/test_sessions.py README.md
git commit -m "fix: read test database URL from environment, document the throwaway Postgres setup"
```

---

### Task 5: Deduplicate the API's `_now()` helper

**Files:**
- Create: `core/api/clock.py`
- Modify: `core/api/routes/business_days.py`
- Modify: `core/api/routes/sessions.py`

**Interfaces:**
- Produces: `core.api.clock.now() -> datetime`, replacing the two identical private `_now()` functions.
- Consumes nothing new.

**Ruling being implemented:** `_now()` (`datetime.now(ZoneInfo(settings.timezone))`) was defined identically in both route files. Factor into one shared helper.

- [ ] **Step 1: Write `core/api/clock.py`**

```python
from datetime import datetime
from zoneinfo import ZoneInfo

from core.config import settings


def now() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))
```

- [ ] **Step 2: Update `core/api/routes/business_days.py`**

Change:

```python
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.schemas.business_days import (
    BusinessDayCloseRequest,
    BusinessDayOpenRequest,
    BusinessDayResponse,
)
from core.config import settings
from core.db.session import get_session
from core.services import business_days
from core.services.errors import NotFoundError

router = APIRouter(prefix="/business-days", tags=["business-days"])


def _now() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))
```

to:

```python
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.clock import now as _now
from core.api.schemas.business_days import (
    BusinessDayCloseRequest,
    BusinessDayOpenRequest,
    BusinessDayResponse,
)
from core.db.session import get_session
from core.services import business_days
from core.services.errors import NotFoundError

router = APIRouter(prefix="/business-days", tags=["business-days"])
```

(Every call site in the rest of the file already says `_now()` — importing `now` under the alias `_now` means nothing below this needs to change. `datetime`, `ZoneInfo`, and `settings` are no longer used directly in this file, hence dropped from the imports.)

- [ ] **Step 3: Update `core/api/routes/sessions.py`**

Same pattern. Change:

```python
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.schemas.payments import PaymentRequest, PaymentResponse
from core.api.schemas.sessions import (
    SegmentResponse,
    SessionExtendRequest,
    SessionResponse,
    SessionStartRequest,
)
from core.config import settings
from core.db.models import Session as SessionModel
from core.db.session import get_session
from core.services import payments as payments_service
from core.services import sessions as sessions_service
from core.services.errors import NotFoundError

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _now() -> datetime:
    return datetime.now(ZoneInfo(settings.timezone))
```

to:

```python
from datetime import datetime

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.clock import now as _now
from core.api.schemas.payments import PaymentRequest, PaymentResponse
from core.api.schemas.sessions import (
    SegmentResponse,
    SessionExtendRequest,
    SessionResponse,
    SessionStartRequest,
)
from core.db.models import Session as SessionModel
from core.db.session import get_session
from core.services import payments as payments_service
from core.services import sessions as sessions_service
from core.services.errors import NotFoundError

router = APIRouter(prefix="/sessions", tags=["sessions"])
```

(`datetime` stays imported here — `_to_response`'s signature uses `datetime` as a type annotation. `ZoneInfo` and `settings` are dropped, no longer used directly.)

- [ ] **Step 4: Run and verify**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest tests/api -v
uv run ruff check .
```

Expected: all API tests still pass, `ruff check` clean (no unused-import warnings on either route file).

- [ ] **Step 5: Commit**

```bash
git add core/api/clock.py core/api/routes/business_days.py core/api/routes/sessions.py
git commit -m "refactor: deduplicate the API's wall-clock helper into core/api/clock.py"
```

---

### Task 6: Tolerate a corrupted grace/warn-minutes setting

**Files:**
- Modify: `core/services/settings.py`
- Create: `tests/services/test_settings.py`

**Interfaces:**
- Consumes: nothing new.
- Produces: no interface change — `get_grace_minutes`/`get_warn_minutes` keep their signatures; they just stop raising `ValueError` on a bad stored value.

**Ruling being implemented:** `int(value)` on a `grace_minutes`/`warn_minutes` row that an operator has edited in SQLAdmin to something non-numeric currently raises an uncaught `ValueError`, which means every `start_session` call 500s until someone fixes the row by hand. Fall back to the default and log a warning instead.

- [ ] **Step 1: Write the failing tests — `tests/services/test_settings.py`**

```python
import pytest

from core.db.models import Setting
from core.services.settings import (
    DEFAULT_GRACE_MINUTES,
    DEFAULT_WARN_MINUTES,
    get_grace_minutes,
    get_warn_minutes,
)


@pytest.mark.asyncio
async def test_get_grace_minutes_falls_back_to_default_when_unset(db_session):
    assert await get_grace_minutes(db_session) == DEFAULT_GRACE_MINUTES


@pytest.mark.asyncio
async def test_get_grace_minutes_falls_back_to_default_on_a_non_numeric_value(db_session):
    db_session.add(Setting(key="grace_minutes", value="not-a-number"))
    await db_session.commit()

    assert await get_grace_minutes(db_session) == DEFAULT_GRACE_MINUTES


@pytest.mark.asyncio
async def test_get_grace_minutes_reads_a_valid_value(db_session):
    db_session.add(Setting(key="grace_minutes", value="7"))
    await db_session.commit()

    assert await get_grace_minutes(db_session) == 7


@pytest.mark.asyncio
async def test_get_warn_minutes_falls_back_to_default_on_a_non_numeric_value(db_session):
    db_session.add(Setting(key="warn_minutes", value="soon"))
    await db_session.commit()

    assert await get_warn_minutes(db_session) == DEFAULT_WARN_MINUTES
```

Run: `DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest tests/services/test_settings.py -v`
Expected: `test_get_grace_minutes_falls_back_to_default_when_unset` and `test_get_grace_minutes_reads_a_valid_value` PASS already (existing behavior); the two non-numeric-value tests FAIL with an uncaught `ValueError`.

- [ ] **Step 2: Fix `core/services/settings.py`**

Change:

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

to:

```python
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import Setting

logger = logging.getLogger(__name__)

DEFAULT_GRACE_MINUTES = 3
DEFAULT_WARN_MINUTES = 5


async def get_setting(db: AsyncSession, key: str) -> str | None:
    row = await db.get(Setting, key)
    return row.value if row else None


def _parse_int_setting(key: str, value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        logger.warning("setting %r has a non-numeric value %r, using default %d", key, value, default)
        return default


async def get_grace_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "grace_minutes")
    return _parse_int_setting("grace_minutes", value, DEFAULT_GRACE_MINUTES)


async def get_warn_minutes(db: AsyncSession) -> int:
    value = await get_setting(db, "warn_minutes")
    return _parse_int_setting("warn_minutes", value, DEFAULT_WARN_MINUTES)
```

- [ ] **Step 3: Run and verify**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest tests/services/test_settings.py -v
```

Expected: all 4 PASS.

- [ ] **Step 4: Commit**

```bash
git add core/services/settings.py tests/services/test_settings.py
git commit -m "fix: fall back to defaults instead of crashing on a corrupted grace/warn-minutes setting"
```

---

### Task 7: Prevent SQLAdmin deletes that would 500 on a foreign-key violation

**Files:**
- Modify: `core/api/admin.py`

**Interfaces:** none — pure configuration change on existing `ModelView` classes.

**Ruling being implemented:** deleting a `Zone`, `Console`, `Tariff`, or `Product` row that's referenced by a `Console`/`Session`/`SessionSegment`/`Order` foreign key raises an uncaught `IntegrityError` in SQLAdmin, surfacing as a 500. The operator-facing way to retire something is `is_active = false`, not delete. `Setting` has no incoming foreign keys and stays deletable.

- [ ] **Step 1: Modify `core/api/admin.py`**

Add `can_delete = False` to each of the four `ModelView` classes that can be FK-referenced. Change:

```python
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
```

to:

```python
class ZoneAdmin(ModelView, model=Zone):
    column_list = [Zone.id, Zone.name, Zone.is_active]
    can_delete = False


class ConsoleAdmin(ModelView, model=Console):
    column_list = [
        Console.id, Console.zone_id, Console.name,
        Console.plug_driver, Console.plug_address, Console.is_active,
    ]
    can_delete = False


class TariffAdmin(ModelView, model=Tariff):
    column_list = [
        Tariff.id, Tariff.zone_id, Tariff.kind, Tariff.name,
        Tariff.duration_min, Tariff.price, Tariff.hourly_rate, Tariff.is_active,
    ]
    can_delete = False


class ProductAdmin(ModelView, model=Product):
    column_list = [Product.id, Product.name, Product.price, Product.is_active]
    can_delete = False
```

`SettingAdmin` is unchanged — it stays deletable, since nothing references a `Setting` row by foreign key and a missing key just falls back to its default (per Task 6).

- [ ] **Step 2: Verify by hand**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run uvicorn core.api.main:app --reload
```

Open `http://127.0.0.1:8000/admin/tariff/list` (or curl it) and confirm no "Delete" action is offered/reachable for a tariff row; confirm "Delete" is still offered for a setting row at `http://127.0.0.1:8000/admin/setting/list`. Stop the server (Ctrl+C).

- [ ] **Step 3: Run the full suite**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest -v
uv run ruff check .
```

Expected: everything still green — this task doesn't touch anything tests exercise directly, it's a UI-level configuration change, so this run is a regression guard.

- [ ] **Step 4: Commit**

```bash
git add core/api/admin.py
git commit -m "fix: disable SQLAdmin delete for FK-referenced zone/console/tariff/product rows"
```

---

### Task 8: Audit tariff and setting changes made through SQLAdmin

**Files:**
- Modify: `core/api/admin.py`

**Interfaces:** none — internal hooks on existing `ModelView` classes.

**Ruling being implemented:** CLAUDE.md domain rule 9 explicitly lists "изменение тарифа" (tariff change) among the manual overrides that must go to `audit_log`; SQLAdmin — the only way to edit a tariff in this stage — writes no such entry today. `Setting` changes (especially `grace_minutes`, which directly affects billing) get the same treatment for the same reason.

- [ ] **Step 1: Modify `core/api/admin.py`**

Add these imports at the top of the file:

```python
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Request
from sqladmin import Admin, ModelView

from core.config import settings
from core.db.models import AuditLog, Console, Product, Setting, Tariff, Zone
from core.db.session import async_session_factory, engine
```

(This replaces the existing `from fastapi import FastAPI` / `from sqladmin import Admin, ModelView` / `from core.db.models import Console, Product, Setting, Tariff, Zone` / `from core.db.session import engine` lines — merge into one clean import block as shown, don't leave duplicates.)

Add this helper function after the imports, before `ZoneAdmin`:

```python
async def _write_audit_log(action: str, entity: str, entity_id: Any, details: dict) -> None:
    async with async_session_factory() as session:
        session.add(
            AuditLog(
                action=action,
                entity=entity,
                entity_id=entity_id,
                details=details,
                created_at=datetime.now(ZoneInfo(settings.timezone)),
            )
        )
        await session.commit()
```

Add these two hook methods to `TariffAdmin` (after its `can_delete = False` line from Task 7):

```python
    async def after_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        await _write_audit_log(
            action="tariff_create" if is_created else "tariff_update",
            entity="tariff",
            entity_id=model.id,
            details={k: v for k, v in data.items() if k != "id"},
        )

    async def after_model_delete(self, model: Any, request: Request) -> None:
        await _write_audit_log(
            action="tariff_delete", entity="tariff", entity_id=model.id, details={}
        )
```

Add the equivalent to `SettingAdmin`:

```python
class SettingAdmin(ModelView, model=Setting):
    column_list = [Setting.key, Setting.value]

    async def after_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        await _write_audit_log(
            action="setting_create" if is_created else "setting_update",
            entity="setting",
            entity_id=model.key,
            details={"key": model.key, "value": model.value},
        )
```

(`SettingAdmin` stays deletable per Task 7, but a `Setting`'s primary key is its `key` string, not an autoincrement id — `after_model_delete` isn't added here since there's no realistic scenario where an operator deletes a setting row and needs an audit trail more than the update case already provides; if you think this is wrong, flag it rather than guessing.)

- [ ] **Step 2: Verify by hand**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run uvicorn core.api.main:app --reload
```

In a browser (or via curl against the form), edit an existing tariff's price through `/admin/tariff/edit/<id>` and confirm the app doesn't error. Then check the database:

```bash
docker exec psclub-db-followup psql -U psclub -d psclub -c "select action, entity, entity_id, details from audit_log order by id desc limit 5;"
```

Expected: a `tariff_update` row with the new field values in `details`. Stop the server (Ctrl+C).

If there's no tariff to edit in this database yet (`psclub`, not `psclub_test` — this dev DB never had `uv run python -m core.db.seed` run against it in this task), run `DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run python -m core.db.seed` first, then repeat the edit-and-check above.

- [ ] **Step 3: Run the full suite**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest -v
uv run ruff check .
```

Expected: everything still green (this task adds no automated test — SQLAdmin's own request/form-handling stack isn't exercised by this project's test suite anywhere, matching the existing pattern from Stage 2's Task 16, which also verified SQLAdmin by hand rather than with a test).

- [ ] **Step 4: Commit**

```bash
git add core/api/admin.py
git commit -m "feat: audit tariff and setting changes made through SQLAdmin"
```

---

### Task 9: Full verification

**Files:** none created — this task only runs and confirms.

**Interfaces:** consumes the entire stack from Tasks 1–8.

- [ ] **Step 1: Run the full suite and linters**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest -v
uv run ruff check .
```

Expected: all green. Compare the total test count against what Task 8 reported — should be Stage 2's 50 plus: 2 (Task 1) + 2 (Task 2) + 2 (Task 3) + 0 (Task 4) + 0 (Task 5) + 4 (Task 6) + 0 (Task 7) + 0 (Task 8) = 60.

- [ ] **Step 2: Confirm the migration chain round-trips cleanly end to end**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic downgrade base
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest -v
```

Expected: downgrade/upgrade succeed with no errors, and the full suite is still green afterward (proves the DB-free domain/plugs tests plus everything else survive a full schema rebuild).

- [ ] **Step 3: Tear down the throwaway container**

```bash
docker stop psclub-db-followup
```

- [ ] **Step 4: No commit needed — this task only verifies.** If any check in Steps 1–2 failed, fix it in the relevant earlier task's files and re-run this task before moving on.

---

## Self-Review Notes

- **Finding coverage:** I3 → Task 1. I4 → Task 2. I6 + M6 → Task 3. I7 → Task 4. M9 → Task 5. M4 → Task 6. M5 → Task 7. I5 → Task 8. All eight items the Stage 2 final review deferred as "before Stage 3 starts" are covered; nothing else from that review (the parked M1/M2/M3/M7/M8/M10 items) is touched, per those items' own rulings (either correct-as-is, or explicitly a later stage's problem).
- **Explicitly out of scope:** any new feature work, any change to `core/domain/`, any change to the Stage 3 screen (doesn't exist yet), the M8 `ValidationError` rename (ruled too large/low-value for its severity), M7 FK indexes (cosmetic at this data scale), M10 price-snapshot-immutability test (nice-to-have, not a gap in shipped behavior).
- **Type/name consistency check:** Task 1's `add_payment` and Task 2's amount guard both live in the same function in `core/services/payments.py` — Task 2's step 3 shows the guard placed correctly relative to Task 1's already-edited version of the function (right after the `NotFoundError` check, before the `business_days.get_open_business_day` call Task 1 added). Task 3's `IntegrityError` import and try/except in `start_session` don't disturb the `lazy="selectin"` / lazy-load patterns from Stage 2. Task 5's `core.api.clock.now` is imported under the alias `_now` specifically so every existing call site in both route files needs zero further changes — verified against the current file contents above, not assumed.
