# Follow-Up Backlog Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the six Minor findings the previous branch's ("stage-2-followup-hardening") final whole-branch review flagged as non-blocking backlog, plus one documentation gap it recommended — all explicitly rated "Stage 3 backlog" rather than merge-blockers, now being swept up before Stage 3 starts.

**Architecture:** No new layers. Every change lands inside the existing `core/api/admin.py`, `core/services/settings.py`, `core/services/sessions.py`, `core/services/business_days.py`, `README.md`, `docs/SPEC.md`.

**Tech Stack:** Same as the prior two branches — FastAPI, SQLAlchemy 2 (async), SQLAdmin, pytest + pytest-asyncio.

**Spec:** This plan's tasks restate exactly which finding from the prior branch's final review each one closes (see each task's "Finding being closed" note) — self-contained, no need to read that branch's now-deleted review artifacts. Underlying spec: `docs/SPEC.md` §3.4 (payments), CLAUDE.md domain rule 9 (audit log).

## Global Constraints

- **No scope beyond the seven items below.** This is a small cleanup pass, not new feature work.
- **`core/domain/` stays pure** — none of these changes touch it.
- **Code comments in English; only genuine UI-facing data / docs stay Russian** (CLAUDE.md's language rule) — `docs/SPEC.md` and `README.md` prose is correctly Russian; everything else is code, correctly English.
- **Python 3.12, `uv`-managed deps, commit messages in English/imperative, no AI attribution, one logical change per commit.**
- The throwaway dev Postgres from the prior branch no longer exists. Every task that touches the database starts one fresh on host port 5433, same as the prior two plans.

---

### Task 1: SQLAdmin — remove dead code, close the settings-delete gap

**Files:**
- Modify: `core/api/admin.py`

**Interfaces:** none — pure configuration/cleanup, no new interface.

**Finding being closed:** two related SQLAdmin findings. First: `TariffAdmin.after_model_delete` can never run — `TariffAdmin.can_delete = False` (set in the prior branch's own Task 7) means SQLAdmin never offers or accepts a delete for a tariff, so this hook is dead code that misleads a future reader into thinking tariff deletes are audited. Second: `SettingAdmin` has no `can_delete = False` and no delete hook — deleting a `grace_minutes` row silently falls back to the default (per the prior branch's Task 6) with zero audit trail, which is exactly the kind of change `audit_log` exists to catch. Fix both by giving `SettingAdmin` the same `can_delete = False` protection the other four admin views already have — this closes the audit gap by removing the ability to delete at all, consistent with the existing "retire via `is_active`/edit the value, don't delete the row" pattern, and makes `TariffAdmin.after_model_delete` unreachable-and-therefore-removable for a clean, honest reason rather than leaving dead code that could be confused with real behavior.

- [ ] **Step 1: Read the current `core/api/admin.py`**

Confirm it matches this (the state after the prior branch's Tasks 7-8):

```python
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Request
from sqladmin import Admin, ModelView

from core.config import settings
from core.db.models import AuditLog, Console, Product, Setting, Tariff, Zone
from core.db.session import async_session_factory, engine


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


class ProductAdmin(ModelView, model=Product):
    column_list = [Product.id, Product.name, Product.price, Product.is_active]
    can_delete = False


class SettingAdmin(ModelView, model=Setting):
    column_list = [Setting.key, Setting.value]

    async def after_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        # audit_log.entity_id is a NOT NULL integer (every other writer passes a
        # session id); Setting's primary key is the `key` string, which has no
        # integer counterpart, so a real id can't be supplied here. Using a fixed
        # sentinel keeps the insert schema-valid without losing traceability — the
        # actual key is still recorded in `details` below. Confirmed by hand: passing
        # `model.key` as entity_id raises asyncpg.exceptions.DataError and silently
        # drops the audit row while the underlying setting update still commits.
        # Workaround, not a root-cause fix — the root cause is entity_id's type not
        # accommodating non-integer entity keys; widening it needs its own migration.
        await _write_audit_log(
            action="setting_create" if is_created else "setting_update",
            entity="setting",
            entity_id=0,
            details={"key": model.key, "value": model.value},
        )


def register_admin(app: FastAPI) -> Admin:
    admin = Admin(app, engine)
    admin.add_view(ZoneAdmin)
    admin.add_view(ConsoleAdmin)
    admin.add_view(TariffAdmin)
    admin.add_view(ProductAdmin)
    admin.add_view(SettingAdmin)
    return admin
```

If it doesn't match, stop and ask rather than guessing at a merge.

- [ ] **Step 2: Remove `TariffAdmin.after_model_delete`**

Delete these lines from `TariffAdmin` (the whole method, including the blank line above it):

```python

    async def after_model_delete(self, model: Any, request: Request) -> None:
        await _write_audit_log(
            action="tariff_delete", entity="tariff", entity_id=model.id, details={}
        )
```

`TariffAdmin.after_model_change` stays untouched by this step (Task 2 modifies it next).

- [ ] **Step 3: Add `can_delete = False` to `SettingAdmin`**

Change:

```python
class SettingAdmin(ModelView, model=Setting):
    column_list = [Setting.key, Setting.value]

    async def after_model_change(
```

to:

```python
class SettingAdmin(ModelView, model=Setting):
    column_list = [Setting.key, Setting.value]
    can_delete = False

    async def after_model_change(
```

- [ ] **Step 4: Start the throwaway Postgres and verify by hand**

```bash
docker run --rm -d --name psclub-db-cleanup \
  -e POSTGRES_DB=psclub -e POSTGRES_USER=psclub -e POSTGRES_PASSWORD=psclub \
  -p 5433:5432 postgres:16-alpine
docker exec psclub-db-cleanup pg_isready -U psclub
docker exec psclub-db-cleanup psql -U psclub -d psclub -c "CREATE DATABASE psclub_test"
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run uvicorn core.api.main:app --reload
```

Open `http://127.0.0.1:8000/admin/setting/list` (or curl it) and confirm no "Delete" action is offered/reachable for a setting row — same as the other four views. Stop the server (Ctrl+C). Leave the container running for later tasks.

- [ ] **Step 5: Run the full suite and ruff**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest -v
uv run ruff check .
```

Expected: everything still green — this task removes dead code and locks down one more admin view, nothing tests exercise directly, so this is a regression guard.

- [ ] **Step 6: Commit**

```bash
git add core/api/admin.py
git commit -m "fix: disable SQLAdmin delete for settings, remove unreachable tariff-delete audit hook"
```

---

### Task 2: Capture before/after values on tariff audit rows

**Files:**
- Modify: `core/api/admin.py`

**Interfaces:** none — internal hook addition on `TariffAdmin`.

**Finding being closed:** `TariffAdmin.after_model_change` (from the prior branch's Task 8) records only the *new* field values in `details` — a tariff price change shows what the tariff became, never what it was. `audit_log`'s whole purpose (SPEC §7, CLAUDE.md rule 9) is investigating discrepancies, which needs the before/after pair, not just "after."

SQLAdmin's `on_model_change` hook runs *before* the change is committed — at that point `model` still holds the row's old values. This task captures that snapshot on `request.state` (a per-HTTP-request object, safe under concurrent admin edits — an instance attribute on `TariffAdmin` itself would NOT be safe, since SQLAdmin reuses one `TariffAdmin` instance across every request) and reads it back in `after_model_change` to build a `{"before": ..., "after": ...}` details payload.

- [ ] **Step 1: Add the `on_model_change` hook and update `after_model_change` on `TariffAdmin`**

Change:

```python
class TariffAdmin(ModelView, model=Tariff):
    column_list = [
        Tariff.id, Tariff.zone_id, Tariff.kind, Tariff.name,
        Tariff.duration_min, Tariff.price, Tariff.hourly_rate, Tariff.is_active,
    ]
    can_delete = False

    async def after_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        await _write_audit_log(
            action="tariff_create" if is_created else "tariff_update",
            entity="tariff",
            entity_id=model.id,
            details={k: v for k, v in data.items() if k != "id"},
        )
```

to:

```python
class TariffAdmin(ModelView, model=Tariff):
    column_list = [
        Tariff.id, Tariff.zone_id, Tariff.kind, Tariff.name,
        Tariff.duration_min, Tariff.price, Tariff.hourly_rate, Tariff.is_active,
    ]
    can_delete = False

    async def on_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        # Runs before the change is committed — model still holds the old values
        # here. Stashed on request.state (per-request, safe under concurrent admin
        # edits) so after_model_change can build a before/after pair below; a plain
        # instance attribute on TariffAdmin would leak between concurrent requests,
        # since SQLAdmin reuses one TariffAdmin instance for every request.
        if not is_created:
            request.state.tariff_before = {
                "name": model.name,
                "kind": model.kind.value if model.kind else None,
                "duration_min": model.duration_min,
                "price": model.price,
                "hourly_rate": model.hourly_rate,
                "is_active": model.is_active,
            }

    async def after_model_change(
        self, data: dict, model: Any, is_created: bool, request: Request
    ) -> None:
        details: dict[str, Any] = {"after": {k: v for k, v in data.items() if k != "id"}}
        before = getattr(request.state, "tariff_before", None)
        if before is not None:
            details["before"] = before
        await _write_audit_log(
            action="tariff_create" if is_created else "tariff_update",
            entity="tariff",
            entity_id=model.id,
            details=details,
        )
```

- [ ] **Step 2: Verify by hand**

The throwaway Postgres from Task 1 should still be running.

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run python -m core.db.seed
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run uvicorn core.api.main:app --reload
```

Edit an existing tariff's price through `/admin/tariff/edit/<id>` (any id the seed script created), then:

```bash
docker exec psclub-db-cleanup psql -U psclub -d psclub -c "select details from audit_log where entity='tariff' order by id desc limit 1;"
```

Expected: the row's `details` JSON has both a `"before"` key (with the tariff's prior `price`) and an `"after"` key (with the new value). Stop the server (Ctrl+C).

- [ ] **Step 3: Run the full suite and ruff**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest -v
uv run ruff check .
```

Expected: everything green — no automated test covers SQLAdmin itself, matching the existing precedent (hand-verification only, same as Tasks 1, 7 and 8 of the prior branch).

- [ ] **Step 4: Commit**

```bash
git add core/api/admin.py
git commit -m "feat: capture before/after values on tariff audit log entries"
```

---

### Task 3: Reject a negative grace/warn-minutes setting

**Files:**
- Modify: `core/services/settings.py`
- Modify: `tests/services/test_settings.py`

**Interfaces:** none — `get_grace_minutes`/`get_warn_minutes` keep their signatures; the existing `_parse_int_setting` helper gains one more fallback case.

**Finding being closed:** `_parse_int_setting` (added by the prior branch's Task 6 to fall back on a *non-numeric* setting value) still accepts a syntactically-valid negative integer like `"-5"`. A negative `grace_minutes` would make a session's `grace_until` earlier than its `started_at`, which nothing downstream expects. `0` is a legitimate configuration (an owner who wants no "time to choose a game" buffer at all) and must stay accepted — only negative values are new-invalid.

- [ ] **Step 1: Write the failing test**

Add to `tests/services/test_settings.py`:

```python
@pytest.mark.asyncio
async def test_get_grace_minutes_falls_back_to_default_on_a_negative_value(db_session):
    db_session.add(Setting(key="grace_minutes", value="-5"))
    await db_session.commit()

    assert await get_grace_minutes(db_session) == DEFAULT_GRACE_MINUTES


@pytest.mark.asyncio
async def test_get_grace_minutes_accepts_zero(db_session):
    db_session.add(Setting(key="grace_minutes", value="0"))
    await db_session.commit()

    assert await get_grace_minutes(db_session) == 0
```

Run: `DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest tests/services/test_settings.py -v`
Expected: `test_get_grace_minutes_falls_back_to_default_on_a_negative_value` FAILS (current code returns `-5`, not the default); `test_get_grace_minutes_accepts_zero` already PASSES (existing behavior).

- [ ] **Step 2: Fix `core/services/settings.py`**

Change:

```python
def _parse_int_setting(key: str, value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        return int(value)
    except ValueError:
        logger.warning(
            "setting %r has a non-numeric value %r, using default %d",
            key,
            value,
            default,
        )
        return default
```

to:

```python
def _parse_int_setting(key: str, value: str | None, default: int) -> int:
    if value is None:
        return default
    try:
        parsed = int(value)
    except ValueError:
        logger.warning(
            "setting %r has a non-numeric value %r, using default %d",
            key,
            value,
            default,
        )
        return default
    if parsed < 0:
        logger.warning(
            "setting %r has a negative value %r, using default %d",
            key,
            value,
            default,
        )
        return default
    return parsed
```

- [ ] **Step 3: Run and verify**

Run: `DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest tests/services/test_settings.py -v`
Expected: all 6 tests PASS (4 existing + 2 new).

- [ ] **Step 4: Commit**

```bash
git add core/services/settings.py tests/services/test_settings.py
git commit -m "fix: reject a negative grace/warn-minutes setting value"
```

---

### Task 4: Narrow the IntegrityError-to-ConflictError mapping to the specific constraint

**Files:**
- Modify: `core/services/sessions.py`
- Modify: `core/services/business_days.py`

**Interfaces:** none — `start_session`/`open_business_day` keep their signatures and their existing `ConflictError` messages for the case they already handle correctly.

**Finding being closed:** `start_session` and `open_business_day` (prior branch's Task 3) catch a bare `IntegrityError` at their insert/flush and always translate it to the SAME specific `ConflictError` message ("console already has an active session" / "business day already open"). Today only one unique constraint can realistically fire at each of those two call sites, so this is correct in practice — but it's not *guaranteed* to stay that way, and mislabeling an unrelated integrity violation with a specific, wrong error message would be confusing to debug. Narrow the catch to check the constraint name actually named in the exception before mapping it; anything else re-raises unchanged.

- [ ] **Step 1: Read the current exception handling in both files**

In `core/services/sessions.py`, confirm the `start_session` function has:

```python
    try:
        await db.flush()  # assigns session.id, needed below before it's committed
    except IntegrityError:
        await db.rollback()
        raise ConflictError(f"console {console_id} already has an active session") from None
```

In `core/services/business_days.py`, confirm `open_business_day` has:

```python
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ConflictError("business day already open") from None
```

If either doesn't match, stop and ask.

- [ ] **Step 2: Narrow the catch in `core/services/sessions.py`**

Change:

```python
    try:
        await db.flush()  # assigns session.id, needed below before it's committed
    except IntegrityError:
        await db.rollback()
        raise ConflictError(f"console {console_id} already has an active session") from None
```

to:

```python
    try:
        await db.flush()  # assigns session.id, needed below before it's committed
    except IntegrityError as exc:
        await db.rollback()
        if "ux_sessions_one_active_per_console" not in str(exc.orig):
            raise
        raise ConflictError(f"console {console_id} already has an active session") from None
```

- [ ] **Step 3: Narrow the catch in `core/services/business_days.py`**

Change:

```python
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ConflictError("business day already open") from None
```

to:

```python
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if "ux_business_days_one_open" not in str(exc.orig):
            raise
        raise ConflictError("business day already open") from None
```

- [ ] **Step 4: Run the full suite**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest -v
```

Expected: all tests still green, specifically `tests/services/test_sessions_start.py::test_concurrent_starts_on_the_same_console_only_one_succeeds` and `tests/services/test_business_days.py::test_concurrent_opens_only_one_succeeds` — both still exercise the app-level check winning the race in this environment (a known, disclosed platform limitation from the prior branch — asyncpg's exception message does include the constraint name in the case that DOES reach the database, which is what these narrowed checks rely on; this doesn't change under normal test execution).

There is no test constructing a *different* integrity violation at either call site to prove the narrowed check correctly re-raises something unrelated — the public API doesn't offer a way to trigger one (console/tariff/business-day existence is already validated earlier in both functions). This is a defensive narrowing verified by code inspection, not by a new test; say so plainly in your report rather than inventing a test that doesn't prove what it claims to.

- [ ] **Step 5: Commit**

```bash
git add core/services/sessions.py core/services/business_days.py
git commit -m "fix: only convert the expected unique-constraint violation to ConflictError"
```

---

### Task 5: Documentation — README clarity and the SPEC payment-attribution rule

**Files:**
- Modify: `README.md`
- Modify: `docs/SPEC.md`

**Interfaces:** none — documentation only.

**Finding being closed:** two related documentation gaps. First (README): the "## Тесты и линтеры" section's `alembic upgrade head` step actually prepares `psclub` (useful for manual API/SQLAdmin/seed work), not `psclub_test` (which the test fixtures build themselves via `Base.metadata.create_all()` on every run) — a new contributor could read it as a required step to "prepare the test database," which it isn't. It also doesn't say that `TEST_DATABASE_URL` is a plain shell environment variable, not something read from `.env` (the app's own `DATABASE_URL` IS read from `.env` via pydantic-settings, which makes the distinction easy to miss). Second (SPEC): the prior branch's Task 1 made a real, spec-affecting behavior decision — a payment counts toward whichever business day is open *when the payment is made*, not the day the session started on — and `docs/SPEC.md` §3.4 never states this rule. CLAUDE.md says to point out changes that affect documented behavior; this documents it after the fact.

- [ ] **Step 1: Update `README.md`'s "## Тесты и линтеры" section**

Change:

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

to:

```markdown
## Тесты и линтеры

Тесты, которые трогают БД (`services`, `api`), ждут одноразовый Postgres на
порту 5433:

    docker run --rm -d --name psclub-db-dev \
      -e POSTGRES_DB=psclub -e POSTGRES_USER=psclub -e POSTGRES_PASSWORD=psclub \
      -p 5433:5432 postgres:16-alpine
    docker exec psclub-db-dev psql -U psclub -d psclub -c "CREATE DATABASE psclub_test"

Схему `psclub_test` создают сами тестовые фикстуры (`Base.metadata.create_all`)
при каждом запуске — накатывать туда миграции вручную не нужно. Команда ниже
готовит саму `psclub` (для ручной работы с API, SQLAdmin, сид-данными), а не
тестовую базу, и для одного `pytest` не обязательна:

    DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head

Порт 5433, а не 5432 — чтобы не конфликтовать с `docker-compose.yml`. Адрес
тестовой базы можно переопределить переменной окружения `TEST_DATABASE_URL`
(именно переменной окружения — pytest не читает её из `.env`), если 5433 занят.

    uv run pytest
    uv run ruff check .

    cd web
    npm run test
    npm run lint
```

- [ ] **Step 2: Update `docs/SPEC.md` §3.4**

Change:

```markdown
### 3.4 Счёт и оплата

Счёт сессии = отрезки времени + заказы из бара.

- Платежи гасят счёт в любой момент: пакет обычно вперёд, открытое время и бар — при уходе.
- Можно платить частями и разными способами.
```

to:

```markdown
### 3.4 Счёт и оплата

Счёт сессии = отрезки времени + заказы из бара.

- Платежи гасят счёт в любой момент: пакет обычно вперёд, открытое время и бар — при уходе.
- Платёж относится к тому рабочему дню, который открыт в момент оплаты, а не к
  дню, когда началась сессия — если гость доплачивает на следующий день, деньги
  идут в кассу текущего дня.
- Можно платить частями и разными способами.
```

- [ ] **Step 3: Verify the docs render sensibly**

No automated check for prose — read both changed sections back and confirm the Markdown isn't broken (matching indentation, no stray blank lines inside the code fences).

- [ ] **Step 4: Commit**

```bash
git add README.md docs/SPEC.md
git commit -m "docs: clarify test-database setup, document payment-to-open-day attribution"
```

---

### Task 6: Full verification

**Files:** none created — this task only runs and confirms.

**Interfaces:** consumes the entire stack from Tasks 1–5.

- [ ] **Step 1: Run the full suite and linters**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest -v
uv run ruff check .
```

Expected: all green. Test count should be the prior branch's 60 plus 2 new from Task 3 = 62.

- [ ] **Step 2: Confirm the migration chain still round-trips cleanly**

```bash
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic downgrade base
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run alembic upgrade head
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5433/psclub uv run pytest -v
```

Expected: downgrade/upgrade succeed with no errors (this task added no new migration, so this just re-confirms nothing regressed), and the full suite is still green afterward.

- [ ] **Step 3: Tear down the throwaway container**

```bash
docker stop psclub-db-cleanup
```

- [ ] **Step 4: No commit needed — this task only verifies.** If any check in Steps 1–2 failed, fix it in the relevant earlier task's files and re-run this task before moving on.

---

## Self-Review Notes

- **Finding coverage:** the "TariffAdmin.after_model_delete unreachable" + "SettingAdmin has no audit-on-delete" pair → Task 1 (closed by disabling delete entirely, which is simpler and more consistent with the other four admin views than adding a delete-audit hook with the same `entity_id` type problem Task 8 of the prior branch already worked around once). "Tariff audit rows record only new values" → Task 2. "Negative grace/warn-minutes accepted" → Task 3. "Broad IntegrityError catch" → Task 4. "README test-section clarity" + "SPEC payment-attribution rule undocumented" → Task 5.
- **Explicitly out of scope:** the prior review's two Stage-3-scoped recommendations (a "День не открыт. Открыть?" prompt for the payment flow, and anything about the зал screen) aren't implemented here — that UI doesn't exist yet, it's Stage 3's job. The `_write_audit_log` separate-session failure-masking risk (flagged on Task 8 of the prior branch, inherited from that task's own design) also stays out — fixing it would mean redesigning how admin hooks write audit rows, which is a larger, riskier change than this cleanup pass is scoped for; flag it again for whoever picks up Stage 3/4 admin work next.
- **Type/name consistency check:** Task 2's `on_model_change`/`after_model_change` pair on `TariffAdmin` use the exact hook names and signatures SQLAdmin 0.19.0 defines (already verified against the installed package by the prior branch's Task 8) — no new signature guessing. Task 4's constraint-name strings (`ux_sessions_one_active_per_console`, `ux_business_days_one_open`) are copied verbatim from the migration the prior branch's Task 3 wrote (`core/db/alembic/versions/bbe0f350a8a5_add_uniqueness_constraints_and_jsonb_.py`), not retyped from memory.
