# Stage 3 — Экран зала Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the hall screen — the React UI an operator lives in all day: one card per console with a live server-driven countdown, start/extend/stop/cancel/pay actions wired to the Stage 2 API, a single shared login gating the whole app (and SQLAdmin), and a WebSocket that keeps every open browser tab in sync in real time. Done when a full session — start, extend, stop, split payment — can be driven entirely from the browser without touching the API by hand, and closing/reopening the tab never loses or resets a timer.

**Architecture:** The backend gains three small new concerns Stage 2 didn't need: (1) a shared-login session cookie (`starlette.middleware.sessions.SessionMiddleware`) guarding every API router except `/health` and `/auth/*`, plus the same password gating SQLAdmin; (2) a read-only "hall snapshot" (`core/services/hall.py`) that assembles every console's current session/charge/balance in one shot, reusing Stage 2's `payments.session_charge_total`/`session_paid_total` rather than duplicating their math; (3) a Postgres `LISTEN/NOTIFY`-driven WebSocket (`/api/ws/hall`) that pushes a fresh snapshot to every connected browser whenever a session, payment, or business day changes — the same "full snapshot, not incremental commands" philosophy `SPEC.md` §5.3 already uses for the Phase-2 agent protocol, applied here to browsers instead of plugs. No field is added anywhere for "remaining minutes" — every deadline the frontend renders is an absolute timestamp already on `SessionResponse`/`SegmentResponse` (`grace_until`, `segment.ends_at`), and the browser derives `remaining = ends_at − now` on every render tick, per `CLAUDE.md` domain rule 1. The frontend is a single-page React app: an auth gate wraps a hall grid of console cards; each card is driven by one shared 1-second ticker plus whatever the WebSocket (or, disconnected, a 5-second HTTP poll) last delivered — no per-card timers, no client-side price calculation feeding real money (every charge/balance number rendered comes from the server; the client only interpolates the *display* of a live-open segment between pushes).

**Tech Stack:** FastAPI + Starlette `SessionMiddleware`, `asyncpg` (raw connection for `LISTEN`, alongside the existing SQLAlchemy pool for everything else), stdlib `hashlib.pbkdf2_hmac` for password hashing (no new crypto dependency). React, TanStack Query, native `WebSocket`, shadcn/ui components generated as needed, Tailwind. `openapi-typescript` (already a dev dependency, unused until now) generates `web/src/types/api.ts`.

**Spec:** `docs/PLAN.md` (stage "3. Экран зала"), `docs/SPEC.md` §3.1 (зал), §3.2 (сессии — grace/segments/rounding, already implemented, only *read* here), §3.4 (счёт и оплата), §4 (сценарии), §2 ("один аккаунт на клуб, без ролей"), `CLAUDE.md` domain rules 1–13, engineering rules.

## Global Constraints

- **Absolute timestamps for deadlines, extended to the client** (`CLAUDE.md` rule 1): the backend never sends "minutes remaining" — only `grace_until` and `segment.ends_at` timestamps. The frontend computes `remaining = ends_at − now` fresh on every tick; nothing ever decrements a counter in place. To stay correct if the till PC's clock is off from the server's, every snapshot carries a `generated_at` server timestamp; the client keeps a running `clockOffsetMs = generated_at − Date.now()` and always computes "now" as `Date.now() + clockOffsetMs`.
- **Overtime is a live counter, not a fixed increment.** `SPEC.md` §3.1's "переигрыш «+7 мин»" is read as an example value of a counter that counts up in real time once a package's `ends_at` passes — confirmed with the project owner during this planning session. There is no special "+7 minutes" action anywhere in this plan.
- **Grace period only gates cancel, never a countdown of its own** (rule 4): the "Отменить" (cancel) button is shown only while `now ≤ session.grace_until`; there's no separate grace-period visual, since the running segment's own timer already reflects the grace-shifted start (`domain/segments.py::grace_until` already pushed the package's `ends_at`/open segment's `starts_at` out by the grace window in Stage 2).
- **No new "remaining_time" field on any Pydantic schema.** `SessionResponse`/`SegmentResponse`/`HallSessionResponse` all stay timestamp-only; adding a derived field would create two sources of truth (server-computed vs. client-computed) that could disagree.
- **Every charge/balance number that touches money comes from the server.** The client interpolates the *display* of a running open-time segment between WebSocket pushes for a smoother countdown, using the same per-minute/round-to-som formula as `core/domain/money.py`, but never uses that interpolated number to decide anything (payment amounts are always typed in by the operator against the server's last-pushed `balance`).
- **Single shared login, no roles** (`SPEC.md` §2): one password, stored as a salted hash (`core/auth/password.py`, stdlib `hashlib.pbkdf2_hmac`, no new dependency) in `ADMIN_PASSWORD_HASH` (`.env`, per `CLAUDE.md` "secrets in `.env`, never committed"). A session cookie signed by `SESSION_SECRET` gates every API route except `/api/health` and `/api/auth/*`, and gates SQLAdmin (`/admin`) using the same password, independently (two login forms, one shared password — no attempt at single sign-on between the two). Session lifetime is 30 days (till-PC operators shouldn't be interrupted mid-shift) — confirmed with the project owner during this planning session.
- **`domain/`, `services/`, and now `auth/` stay pure/DB-appropriate exactly as Stage 2 drew the lines**: `core/auth/password.py` has no I/O beyond `os.urandom` and is unit-tested without a database, same bar as `core/domain/`.
- **Cross-process/cross-connection events go through Postgres `LISTEN/NOTIFY`** (`CLAUDE.md` engineering rules), not an in-process pub-sub — this is what makes the hall screen correct regardless of how many `uvicorn` workers the eventual deployment runs. Every session- or payment-mutating service function (`start_session`, `extend_session`, `stop_session`, `cancel_session`, `add_payment`, `open_business_day`, `close_business_day`) issues `NOTIFY hall_changed` in the same transaction as its own commit.
- **No bar/order integration.** `HallSnapshot`'s `charge_total`/`paid_total`/`balance` are computed by the exact same `core/services/payments.py` functions the existing session routes already call — which, per Stage 2, sum segments only. If Stage 4 later makes `session_charge_total` include `orders`, the hall screen picks that up automatically with no changes here.
- **Plugs are out of scope.** No `PlugDriver` call is added anywhere in this stage — TVs are still switched by hand per `SPEC.md` §3.8's Phase-1 manual driver; that wiring is Stage 8/9.
- Python 3.12, `uv`-managed deps, `npm`-managed frontend deps, commit messages in English/imperative, one logical change per commit, no AI attribution — same conventions as Stages 1–2.

---

### Task 1: Reference-data endpoints — public settings and tariffs

The hall screen needs two small pieces of read-only reference data that don't change per second and aren't part of the hall snapshot: the grace/warn thresholds (to know when to switch a card into "warn"), and the list of tariffs (to populate the start/extend dialogs' package/open-time picker). Neither exists yet — `core/services/settings.py` only has internal read functions, and there is no tariffs route at all.

**Files:**
- Create: `core/api/schemas/settings.py`
- Create: `core/api/routes/settings.py`
- Create: `core/api/schemas/tariffs.py`
- Create: `core/api/routes/tariffs.py`
- Modify: `core/api/main.py`
- Test: `tests/api/test_settings.py`
- Test: `tests/api/test_tariffs.py`

**Interfaces:**
- Produces: `GET /api/settings` → `{grace_minutes: int, warn_minutes: int}`; `GET /api/tariffs` → `list[{id, zone_id, kind, name, duration_min, price, hourly_rate, is_active}]` (active tariffs only, ordered by `id`). Later tasks' frontend code (Task 7's `api.ts`) calls both by name.

- [ ] **Step 1: Write the failing tests**

```python
# tests/api/test_settings.py
import pytest


@pytest.mark.asyncio
async def test_settings_returns_defaults_when_unset(client):
    response = await client.get("/api/settings")
    assert response.status_code == 200
    assert response.json() == {"grace_minutes": 3, "warn_minutes": 5}


@pytest.mark.asyncio
async def test_settings_reflects_configured_values(client):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Setting
    from tests.api.conftest import TEST_DATABASE_URL

    engine = create_async_engine(TEST_DATABASE_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        db.add(Setting(key="grace_minutes", value="4"))
        db.add(Setting(key="warn_minutes", value="7"))
        await db.commit()
    await engine.dispose()

    response = await client.get("/api/settings")
    assert response.json() == {"grace_minutes": 4, "warn_minutes": 7}
```

```python
# tests/api/test_tariffs.py
import pytest


async def _seed_tariffs(db):
    from core.db.models import Tariff, TariffKind, Zone

    zone = Zone(name="Зал", is_active=True)
    db.add(zone)
    await db.flush()
    db.add(Tariff(zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150))
    db.add(Tariff(zone_id=zone.id, kind=TariffKind.open, name="Открытое время", hourly_rate=120))
    db.add(
        Tariff(
            zone_id=zone.id, kind=TariffKind.package, name="Старый", duration_min=30,
            price=100, is_active=False,
        )
    )


@pytest.mark.asyncio
async def test_tariffs_lists_only_active(client):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from tests.api.conftest import TEST_DATABASE_URL

    engine = create_async_engine(TEST_DATABASE_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        await _seed_tariffs(db)
        await db.commit()
    await engine.dispose()

    response = await client.get("/api/tariffs")
    assert response.status_code == 200
    names = {t["name"] for t in response.json()}
    assert names == {"1 час", "Открытое время"}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_settings.py tests/api/test_tariffs.py -v`
Expected: FAIL — `404 Not Found` on both routes (they don't exist yet).

- [ ] **Step 3: Implement the schemas and routes**

```python
# core/api/schemas/settings.py
from pydantic import BaseModel


class PublicSettingsResponse(BaseModel):
    grace_minutes: int
    warn_minutes: int
```

```python
# core/api/routes/settings.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.schemas.settings import PublicSettingsResponse
from core.db.session import get_session
from core.services import settings as settings_service

router = APIRouter(prefix="/settings", tags=["settings"])


@router.get("", response_model=PublicSettingsResponse)
async def get_public_settings(db: AsyncSession = Depends(get_session)) -> PublicSettingsResponse:  # noqa: B008
    return PublicSettingsResponse(
        grace_minutes=await settings_service.get_grace_minutes(db),
        warn_minutes=await settings_service.get_warn_minutes(db),
    )
```

```python
# core/api/schemas/tariffs.py
from pydantic import BaseModel, ConfigDict

from core.db.models import TariffKind


class TariffResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    zone_id: int
    kind: TariffKind
    name: str
    duration_min: int | None
    price: int | None
    hourly_rate: int | None
    is_active: bool
```

```python
# core/api/routes/tariffs.py
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.schemas.tariffs import TariffResponse
from core.db.models import Tariff
from core.db.session import get_session

router = APIRouter(prefix="/tariffs", tags=["tariffs"])


@router.get("", response_model=list[TariffResponse])
async def list_tariffs(db: AsyncSession = Depends(get_session)) -> list[TariffResponse]:  # noqa: B008
    result = await db.execute(
        select(Tariff).where(Tariff.is_active.is_(True)).order_by(Tariff.id)
    )
    return [TariffResponse.model_validate(t) for t in result.scalars().all()]
```

```python
# core/api/main.py — add imports and registration
from core.api.routes.settings import router as settings_router
from core.api.routes.tariffs import router as tariffs_router

# inside create_app(), alongside the other app.include_router(...) calls:
    app.include_router(settings_router, prefix="/api")
    app.include_router(tariffs_router, prefix="/api")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/api/test_settings.py tests/api/test_tariffs.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/api/schemas/settings.py core/api/routes/settings.py core/api/schemas/tariffs.py core/api/routes/tariffs.py core/api/main.py tests/api/test_settings.py tests/api/test_tariffs.py
git commit -m "feat: add public settings and tariffs read endpoints"
```

---

### Task 2: Password hashing helper

**Files:**
- Create: `core/auth/__init__.py`
- Create: `core/auth/password.py`
- Test: `tests/auth/__init__.py`
- Test: `tests/auth/test_password.py`

**Interfaces:**
- Produces: `core.auth.password.hash_password(password: str) -> str`, `core.auth.password.verify_password(password: str, encoded: str) -> bool` — used by Task 3's login route and Task 4's SQLAdmin auth backend.

- [ ] **Step 1: Write the failing tests**

```python
# tests/auth/__init__.py
```

```python
# tests/auth/test_password.py
from core.auth.password import hash_password, verify_password


def test_verify_password_accepts_correct_password():
    encoded = hash_password("correct horse battery staple")
    assert verify_password("correct horse battery staple", encoded) is True


def test_verify_password_rejects_wrong_password():
    encoded = hash_password("correct horse battery staple")
    assert verify_password("wrong password", encoded) is False


def test_hash_password_salts_every_call_differently():
    assert hash_password("same") != hash_password("same")


def test_verify_password_rejects_garbage_encoded_value():
    assert verify_password("anything", "not-a-valid-hash") is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/auth/test_password.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.auth'`

- [ ] **Step 3: Implement**

```python
# core/auth/__init__.py
```

```python
# core/auth/password.py
"""Stdlib-only password hashing — no new dependency for a single shared password
(CLAUDE.md: don't add infrastructure without asking; bcrypt/passlib would be one
more supply-chain surface for something hashlib already does adequately here)."""

import hashlib
import hmac
import os
import sys

_ALGORITHM = "pbkdf2_sha256"
_ITERATIONS = 260_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"{_ALGORITHM}${_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations_str, salt_hex, digest_hex = encoded.split("$")
        if algorithm != _ALGORITHM:
            return False
        iterations = int(iterations_str)
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
    except ValueError:
        return False
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return hmac.compare_digest(actual, expected)


if __name__ == "__main__":
    # `uv run python -m core.auth.password 'new-password'` — prints a hash to paste
    # into ADMIN_PASSWORD_HASH in .env.
    print(hash_password(sys.argv[1]))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/auth/test_password.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add core/auth/__init__.py core/auth/password.py tests/auth/__init__.py tests/auth/test_password.py
git commit -m "feat: add stdlib-based password hashing for the shared login"
```

---

### Task 3: Login/logout/me endpoints and session cookie

**Files:**
- Modify: `core/config.py`
- Modify: `.env.example`
- Modify: `pyproject.toml`
- Create: `core/api/schemas/auth.py`
- Create: `core/api/routes/auth.py`
- Modify: `core/api/main.py`
- Test: `tests/api/test_auth.py`

**Interfaces:**
- Consumes: `core.auth.password.verify_password` (Task 2).
- Produces: `POST /api/auth/login {password}` → `AuthStatusResponse`, `POST /api/auth/logout` → `AuthStatusResponse`, `GET /api/auth/me` → `AuthStatusResponse`; `request.session["authenticated"]` is the flag Task 4's `require_auth` dependency checks.

- [ ] **Step 1: Generate the dev-default password hash**

Run: `uv run python -m core.auth.password admin`

Copy the printed string (starts with `pbkdf2_sha256$260000$`) — it's used as the literal default in Step 3 below. It decodes to the password `admin`, which is what Step 5's tests log in with.

- [ ] **Step 2: Add the dependency**

```toml
# pyproject.toml — add to [project] dependencies, alongside fastapi/uvicorn/etc.
    "itsdangerous>=2.2,<3",
```

Run: `uv sync`

- [ ] **Step 3: Add config fields**

```python
# core/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    database_url: str = "postgresql+asyncpg://psclub:psclub@localhost:5432/psclub"
    bot_token: str | None = None
    owner_chat_id: int | None = None
    timezone: str = "Asia/Bishkek"

    # Hall-screen login (Stage 3). These two dev defaults let a fresh checkout run
    # with zero setup (password: "admin") — replace both in .env before a real
    # deployment. See core/auth/password.py's module docstring for how to generate
    # a new ADMIN_PASSWORD_HASH.
    admin_password_hash: str = "<paste the Step 1 output here>"
    session_secret: str = "dev-insecure-session-secret-change-me"
    session_cookie_secure: bool = False  # set true once served over HTTPS (Stage 7)


settings = Settings()
```

Replace `<paste the Step 1 output here>` with the actual string from Step 1 before moving on.

- [ ] **Step 4: Document the new env vars**

```bash
# .env.example — append
# Hall-screen login (Stage 3). The dev defaults baked into core/config.py work out
# of the box (password: "admin"). Replace both before a real deployment:
#   uv run python -m core.auth.password 'new-password'      -> ADMIN_PASSWORD_HASH
#   python -c "import secrets; print(secrets.token_hex(32))" -> SESSION_SECRET
ADMIN_PASSWORD_HASH=
SESSION_SECRET=
SESSION_COOKIE_SECURE=false
```

- [ ] **Step 5: Write the failing tests**

```python
# tests/api/test_auth.py
import pytest


@pytest.mark.asyncio
async def test_me_without_login_is_not_authenticated(client):
    response = await client.get("/api/auth/me")
    assert response.status_code == 200
    assert response.json() == {"authenticated": False}


@pytest.mark.asyncio
async def test_login_with_wrong_password_is_401(client):
    response = await client.post("/api/auth/login", json={"password": "wrong"})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_with_correct_password_authenticates(client):
    response = await client.post("/api/auth/login", json={"password": "admin"})
    assert response.status_code == 200
    assert response.json() == {"authenticated": True}

    me_response = await client.get("/api/auth/me")
    assert me_response.json() == {"authenticated": True}


@pytest.mark.asyncio
async def test_logout_clears_the_session(client):
    await client.post("/api/auth/login", json={"password": "admin"})
    await client.post("/api/auth/logout")

    me_response = await client.get("/api/auth/me")
    assert me_response.json() == {"authenticated": False}
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_auth.py -v`
Expected: FAIL — `404 Not Found` (routes don't exist).

- [ ] **Step 7: Implement**

```python
# core/api/schemas/auth.py
from pydantic import BaseModel


class LoginRequest(BaseModel):
    password: str


class AuthStatusResponse(BaseModel):
    authenticated: bool
```

```python
# core/api/routes/auth.py
from fastapi import APIRouter, HTTPException, Request

from core.api.schemas.auth import AuthStatusResponse, LoginRequest
from core.auth.password import verify_password
from core.config import settings

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=AuthStatusResponse)
async def login(body: LoginRequest, request: Request) -> AuthStatusResponse:
    if not verify_password(body.password, settings.admin_password_hash):
        raise HTTPException(status_code=401, detail="invalid password")
    request.session["authenticated"] = True
    return AuthStatusResponse(authenticated=True)


@router.post("/logout", response_model=AuthStatusResponse)
async def logout(request: Request) -> AuthStatusResponse:
    request.session.clear()
    return AuthStatusResponse(authenticated=False)


@router.get("/me", response_model=AuthStatusResponse)
async def me(request: Request) -> AuthStatusResponse:
    return AuthStatusResponse(authenticated=bool(request.session.get("authenticated")))
```

```python
# core/api/main.py — full new version
from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from core.api.admin import register_admin
from core.api.errors import register_exception_handlers
from core.api.routes.auth import router as auth_router
from core.api.routes.business_days import router as business_days_router
from core.api.routes.health import router as health_router
from core.api.routes.sessions import router as sessions_router
from core.api.routes.settings import router as settings_router
from core.api.routes.tariffs import router as tariffs_router
from core.config import settings

SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days — one login per till PC per month


def create_app() -> FastAPI:
    app = FastAPI(title="PS Club API")
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        max_age=SESSION_MAX_AGE_SECONDS,
        same_site="lax",
        https_only=settings.session_cookie_secure,
    )
    register_exception_handlers(app)
    register_admin(app)
    app.include_router(health_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(settings_router, prefix="/api")
    app.include_router(tariffs_router, prefix="/api")
    app.include_router(business_days_router, prefix="/api")
    app.include_router(sessions_router, prefix="/api")
    return app


app = create_app()
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `uv run pytest tests/api/test_auth.py -v`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add core/config.py .env.example pyproject.toml uv.lock core/api/schemas/auth.py core/api/routes/auth.py core/api/main.py tests/api/test_auth.py
git commit -m "feat: add login/logout/me endpoints and the session cookie"
```

---

### Task 4: Enforce the login on every route, and on SQLAdmin

Nothing from Task 3 is actually required yet — `request.session["authenticated"]` is set on login, but no route checks it. This task adds the gate everywhere it needs to exist, and updates the test fixtures so Stage 2's existing tests (which never log in) keep passing.

**Files:**
- Create: `core/api/deps.py`
- Modify: `core/api/routes/sessions.py`
- Modify: `core/api/routes/business_days.py`
- Modify: `core/api/routes/settings.py`
- Modify: `core/api/routes/tariffs.py`
- Modify: `core/api/admin.py`
- Modify: `tests/api/conftest.py`
- Test: `tests/api/test_auth_enforcement.py`
- Modify: `README.md`

**Interfaces:**
- Produces: `core.api.deps.require_auth(request: Request) -> None` — a FastAPI dependency, added to every protected router's `dependencies=[...]`. Consumed directly by Task 5's and Task 6's new routers.

- [ ] **Step 1: Write the failing tests**

```python
# tests/api/test_auth_enforcement.py
import pytest


@pytest.mark.asyncio
async def test_health_does_not_require_auth(anonymous_client):
    response = await anonymous_client.get("/api/health")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_starting_a_session_requires_auth(anonymous_client):
    response = await anonymous_client.post("/api/sessions", json={"console_id": 1})
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_business_days_requires_auth(anonymous_client):
    response = await anonymous_client.get("/api/business-days/current")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_settings_requires_auth(anonymous_client):
    response = await anonymous_client.get("/api/settings")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_tariffs_requires_auth(anonymous_client):
    response = await anonymous_client.get("/api/tariffs")
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_logged_in_client_can_reach_protected_routes(client):
    response = await client.get("/api/settings")
    assert response.status_code == 200
```

`anonymous_client` doesn't exist yet — added in Step 2.

- [ ] **Step 2: Update the shared test fixtures**

```python
# tests/api/conftest.py — full new version
import os
from collections.abc import AsyncGenerator

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.api.main import app
from core.db.base import Base
from core.db.models import *  # noqa: F401,F403
from core.db.session import get_session

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://psclub:psclub@localhost:5433/psclub_test"
)


async def _build_client(*, auto_login: bool) -> AsyncGenerator[AsyncClient, None]:
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
        if auto_login:
            await ac.post("/api/auth/login", json={"password": "admin"})
        yield ac

    app.dependency_overrides.clear()
    await engine.dispose()


@pytest_asyncio.fixture
async def client():
    """Authenticated client — every Stage 2 test and most Stage 3 tests use this."""
    async for ac in _build_client(auto_login=True):
        yield ac


@pytest_asyncio.fixture
async def anonymous_client():
    """Not logged in — for asserting protected routes reject unauthenticated requests."""
    async for ac in _build_client(auto_login=False):
        yield ac
```

- [ ] **Step 3: Run the new tests to verify they fail**

Run: `uv run pytest tests/api/test_auth_enforcement.py -v`
Expected: FAIL — every protected-route assertion gets `200`/`404` instead of `401` (nothing enforces auth yet).

- [ ] **Step 4: Implement the dependency and wire it into every protected router**

```python
# core/api/deps.py
from fastapi import HTTPException, Request


def require_auth(request: Request) -> None:
    if not request.session.get("authenticated"):
        raise HTTPException(status_code=401, detail="authentication required")
```

```python
# core/api/routes/sessions.py — change only the router line
router = APIRouter(prefix="/sessions", tags=["sessions"], dependencies=[Depends(require_auth)])
```

Add `from core.api.deps import require_auth` to that file's imports (`Depends` is already imported).

```python
# core/api/routes/business_days.py — change only the router line
router = APIRouter(prefix="/business-days", tags=["business-days"], dependencies=[Depends(require_auth)])
```

Add `from core.api.deps import require_auth` there too.

```python
# core/api/routes/settings.py — change only the router line
router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(require_auth)])
```

Add `from core.api.deps import require_auth`.

```python
# core/api/routes/tariffs.py — change only the router line
router = APIRouter(prefix="/tariffs", tags=["tariffs"], dependencies=[Depends(require_auth)])
```

Add `from core.api.deps import require_auth`.

`health.py` and `auth.py` are left untouched — they must stay reachable without a session.

- [ ] **Step 5: Protect SQLAdmin with the same password**

```python
# core/api/admin.py — add near the top, alongside the existing imports
from sqladmin.authentication import AuthenticationBackend
from starlette.requests import Request as StarletteRequest
from starlette.responses import RedirectResponse

from core.auth.password import verify_password


class AdminAuth(AuthenticationBackend):
    async def login(self, request: StarletteRequest) -> bool:
        form = await request.form()
        password = form.get("password")
        if not password or not verify_password(str(password), settings.admin_password_hash):
            return False
        request.session["authenticated"] = True
        return True

    async def logout(self, request: StarletteRequest) -> bool:
        request.session.clear()
        return True

    async def authenticate(self, request: StarletteRequest) -> bool | RedirectResponse:
        return bool(request.session.get("authenticated"))
```

```python
# core/api/admin.py — change register_admin to use it
def register_admin(app: FastAPI) -> Admin:
    admin = Admin(
        app, engine, authentication_backend=AdminAuth(secret_key=settings.session_secret)
    )
    admin.add_view(ZoneAdmin)
    admin.add_view(ConsoleAdmin)
    admin.add_view(TariffAdmin)
    admin.add_view(ProductAdmin)
    admin.add_view(SettingAdmin)
    return admin
```

`settings` (from `core.config`) is already imported at the top of `admin.py`. sqladmin wraps its own mount with its own `SessionMiddleware` when given an `authentication_backend` — this is separate from the app-level one added in Task 3, so logging into the hall screen and logging into `/admin` are two independent logins that happen to share one password, not single sign-on.

If `from sqladmin.authentication import AuthenticationBackend` doesn't exist on the installed version, run `uv run python -c "import sqladmin; print(sqladmin.__version__)"` to confirm it's `0.19.x` (pinned in `pyproject.toml`) and check that version's docs for the exact import path — the class name and the three-method shape (`login`/`logout`/`authenticate`) have been stable across the `0.19` line.

- [ ] **Step 6: Run the full test suite**

Run: `uv run pytest -v`
Expected: PASS — every Stage 2 test still passes (the shared `client` fixture now logs in automatically) and every new `test_auth_enforcement.py` case passes.

- [ ] **Step 7: Document the login in the README**

```markdown
# README.md — new section after "## Админка"

## Вход

Один пароль на весь клуб — из `.env` (`ADMIN_PASSWORD_HASH`, dev-заглушка: `admin`).
Действует и на самом экране зала, и на `/admin` (SQLAdmin) — независимо друг от
друга, вход в одно место не даёт доступ к другому. Сессия держится 30 дней.
```

- [ ] **Step 8: Commit**

```bash
git add core/api/deps.py core/api/routes/sessions.py core/api/routes/business_days.py core/api/routes/settings.py core/api/routes/tariffs.py core/api/admin.py tests/api/conftest.py tests/api/test_auth_enforcement.py README.md
git commit -m "feat: enforce the shared login on the API and SQLAdmin"
```

---

### Task 5: Hall snapshot service and `GET /api/hall`

**Files:**
- Create: `core/services/hall.py`
- Create: `core/api/schemas/hall.py`
- Create: `core/api/routes/hall.py`
- Modify: `core/api/main.py`
- Test: `tests/services/test_hall.py`
- Test: `tests/api/test_hall.py`

**Interfaces:**
- Consumes: `payments_service.session_charge_total`, `payments_service.session_paid_total` (Stage 2, unchanged), `business_days.get_open_business_day` (Stage 2, unchanged).
- Produces: `core.services.hall.build_hall_snapshot(db, now) -> HallSnapshot` (dataclass: `generated_at`, `business_day_open`, `consoles: list[ConsoleHallView]`, each with `id, zone_id, name, is_active, session: SessionModel | None, charge_total, paid_total, balance`) — consumed directly by Task 6's WebSocket broadcaster. `core.api.schemas.hall.hall_snapshot_to_response(snapshot) -> HallSnapshotResponse` — also consumed directly by Task 6, so both the REST endpoint and every WebSocket push serialize identically.

- [ ] **Step 1: Write the failing service-level test**

```python
# tests/services/test_hall.py
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.api.clock import now as _now
from core.db.base import Base
from core.db.models import Console, SessionKind, Tariff, TariffKind, Zone
from core.services import business_days, hall, sessions
from tests.api.conftest import TEST_DATABASE_URL


@pytest.mark.asyncio
async def test_build_hall_snapshot_lists_free_and_active_consoles():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        free_console = Console(zone_id=zone.id, name="PS5-1")
        busy_console = Console(zone_id=zone.id, name="PS5-2")
        tariff = Tariff(zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150)
        db.add_all([free_console, busy_console, tariff])
        await db.flush()

        now = _now()
        await business_days.open_business_day(db, opening_cash=0, now=now)
        await sessions.start_session(
            db, console_id=busy_console.id, kind=SessionKind.paid, tariff_id=tariff.id,
            reason=None, comment=None, now=now,
        )

        snapshot = await hall.build_hall_snapshot(db, now)

    await engine.dispose()

    assert snapshot.business_day_open is True
    by_name = {c.name: c for c in snapshot.consoles}
    assert by_name["PS5-1"].session is None
    assert by_name["PS5-1"].charge_total == 0
    assert by_name["PS5-2"].session is not None
    assert by_name["PS5-2"].charge_total == 150
    assert by_name["PS5-2"].balance == 150
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/services/test_hall.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.services.hall'`

- [ ] **Step 3: Implement the service**

```python
# core/services/hall.py
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.db.models import Console, SessionStatus
from core.db.models import Session as SessionModel
from core.services import business_days
from core.services import payments as payments_service


@dataclass(frozen=True)
class ConsoleHallView:
    id: int
    zone_id: int
    name: str
    is_active: bool
    session: SessionModel | None
    charge_total: int
    paid_total: int
    balance: int


@dataclass(frozen=True)
class HallSnapshot:
    generated_at: datetime
    business_day_open: bool
    consoles: list[ConsoleHallView]


async def build_hall_snapshot(db: AsyncSession, now: datetime) -> HallSnapshot:
    consoles_result = await db.execute(select(Console).order_by(Console.id))
    consoles = consoles_result.scalars().all()

    sessions_result = await db.execute(
        select(SessionModel).where(SessionModel.status == SessionStatus.active)
    )
    active_by_console = {s.console_id: s for s in sessions_result.scalars().all()}

    views: list[ConsoleHallView] = []
    for console in consoles:
        session = active_by_console.get(console.id)
        if session is not None:
            charge = await payments_service.session_charge_total(db, session.id, now)
            paid = await payments_service.session_paid_total(db, session.id)
        else:
            charge = paid = 0
        views.append(
            ConsoleHallView(
                id=console.id,
                zone_id=console.zone_id,
                name=console.name,
                is_active=console.is_active,
                session=session,
                charge_total=charge,
                paid_total=paid,
                balance=charge - paid,
            )
        )

    day = await business_days.get_open_business_day(db)
    return HallSnapshot(generated_at=now, business_day_open=day is not None, consoles=views)
```

- [ ] **Step 4: Run service test to verify it passes**

Run: `uv run pytest tests/services/test_hall.py -v`
Expected: PASS

- [ ] **Step 5: Write the failing API test**

```python
# tests/api/test_hall.py
import pytest


@pytest.mark.asyncio
async def test_hall_lists_a_free_console(client):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Console, Zone
    from tests.api.conftest import TEST_DATABASE_URL

    engine = create_async_engine(TEST_DATABASE_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        db.add(Console(zone_id=zone.id, name="PS5-1"))
        await db.commit()
    await engine.dispose()

    response = await client.get("/api/hall")
    assert response.status_code == 200
    body = response.json()
    assert len(body["consoles"]) == 1
    assert body["consoles"][0]["session"] is None
    assert body["business_day_open"] is False


@pytest.mark.asyncio
async def test_hall_includes_an_active_session(client):
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.models import Console, Tariff, TariffKind, Zone
    from tests.api.conftest import TEST_DATABASE_URL

    engine = create_async_engine(TEST_DATABASE_URL)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        console = Console(zone_id=zone.id, name="PS5-1")
        tariff = Tariff(zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150)
        db.add_all([console, tariff])
        await db.commit()
        await db.refresh(console)
        await db.refresh(tariff)
        console_id, tariff_id = console.id, tariff.id
    await engine.dispose()

    await client.post("/api/business-days/open", json={"opening_cash": 0})
    await client.post("/api/sessions", json={"console_id": console_id, "tariff_id": tariff_id})

    response = await client.get("/api/hall")
    body = response.json()
    assert body["business_day_open"] is True
    console_view = next(c for c in body["consoles"] if c["id"] == console_id)
    assert console_view["session"]["status"] == "active"
    assert console_view["charge_total"] == 150
```

- [ ] **Step 6: Run API test to verify it fails**

Run: `uv run pytest tests/api/test_hall.py -v`
Expected: FAIL with `404 Not Found`.

- [ ] **Step 7: Implement the schema and route**

```python
# core/api/schemas/hall.py
from datetime import datetime

from pydantic import BaseModel

from core.api.schemas.sessions import SegmentResponse
from core.db.models import SessionKind, SessionStatus
from core.services.hall import HallSnapshot


class HallSessionResponse(BaseModel):
    id: int
    kind: SessionKind
    reason: str | None
    status: SessionStatus
    started_at: datetime
    grace_until: datetime
    segments: list[SegmentResponse]


class HallConsoleResponse(BaseModel):
    id: int
    zone_id: int
    name: str
    is_active: bool
    session: HallSessionResponse | None
    charge_total: int
    paid_total: int
    balance: int


class HallSnapshotResponse(BaseModel):
    generated_at: datetime
    business_day_open: bool
    consoles: list[HallConsoleResponse]


def hall_snapshot_to_response(snapshot: HallSnapshot) -> HallSnapshotResponse:
    consoles = []
    for view in snapshot.consoles:
        session_response = None
        if view.session is not None:
            session_response = HallSessionResponse(
                id=view.session.id,
                kind=view.session.kind,
                reason=view.session.reason,
                status=view.session.status,
                started_at=view.session.started_at,
                grace_until=view.session.grace_until,
                segments=[SegmentResponse.model_validate(s) for s in view.session.segments],
            )
        consoles.append(
            HallConsoleResponse(
                id=view.id,
                zone_id=view.zone_id,
                name=view.name,
                is_active=view.is_active,
                session=session_response,
                charge_total=view.charge_total,
                paid_total=view.paid_total,
                balance=view.balance,
            )
        )
    return HallSnapshotResponse(
        generated_at=snapshot.generated_at,
        business_day_open=snapshot.business_day_open,
        consoles=consoles,
    )
```

```python
# core/api/routes/hall.py
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.api.clock import now as _now
from core.api.deps import require_auth
from core.api.schemas.hall import HallSnapshotResponse, hall_snapshot_to_response
from core.db.session import get_session
from core.services import hall as hall_service

router = APIRouter(prefix="/hall", tags=["hall"], dependencies=[Depends(require_auth)])


@router.get("", response_model=HallSnapshotResponse)
async def get_hall(db: AsyncSession = Depends(get_session)) -> HallSnapshotResponse:  # noqa: B008
    snapshot = await hall_service.build_hall_snapshot(db, _now())
    return hall_snapshot_to_response(snapshot)
```

```python
# core/api/main.py — add the import and the include_router call
from core.api.routes.hall import router as hall_router
# ...
    app.include_router(hall_router, prefix="/api")
```

- [ ] **Step 8: Run API test to verify it passes**

Run: `uv run pytest tests/api/test_hall.py -v`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add core/services/hall.py core/api/schemas/hall.py core/api/routes/hall.py core/api/main.py tests/services/test_hall.py tests/api/test_hall.py
git commit -m "feat: add the hall snapshot service and GET /api/hall"
```

---

### Task 6: `NOTIFY` on every mutation, and the `/api/ws/hall` WebSocket

**Files:**
- Modify: `core/services/sessions.py`
- Modify: `core/services/payments.py`
- Modify: `core/services/business_days.py`
- Create: `core/api/ws/__init__.py`
- Create: `core/api/ws/manager.py`
- Create: `core/api/ws/listener.py`
- Create: `core/api/routes/hall_ws.py`
- Modify: `core/api/main.py`
- Test: `tests/services/test_hall_notify.py`
- Test: `tests/api/test_hall_ws.py`

**Interfaces:**
- Consumes: `core.services.hall.build_hall_snapshot`, `core.api.schemas.hall.hall_snapshot_to_response` (Task 5).
- Produces: `core.api.ws.manager.manager` (module-level `HallConnectionManager` singleton, `.connect(websocket)`, `.disconnect(websocket)`, `.broadcast(message: dict)`); `core.api.ws.listener.HallListener` (constructor takes an optional `session_factory` for tests, `.start()`/`.stop()` manage the raw `asyncpg` `LISTEN` connection); WebSocket route `GET /api/ws/hall` (upgrades, closes with code `1008` if not logged in).

- [ ] **Step 1: Write the failing test for `NOTIFY` being sent**

This test listens on a raw `asyncpg` connection to the same test database and asserts a real Postgres notification arrives after `start_session` commits — proving the service layer, not our own listener code, does the right thing.

```python
# tests/services/test_hall_notify.py
import asyncio

import asyncpg
import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.api.clock import now as _now
from core.db.base import Base
from core.db.models import Console, SessionKind, Tariff, TariffKind, Zone
from core.services import business_days, sessions
from tests.api.conftest import TEST_DATABASE_URL


def _asyncpg_dsn(sqlalchemy_url: str) -> str:
    return sqlalchemy_url.replace("postgresql+asyncpg://", "postgresql://", 1)


@pytest.mark.asyncio
async def test_starting_a_session_sends_hall_changed_notification():
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    listener_conn = await asyncpg.connect(_asyncpg_dsn(TEST_DATABASE_URL))
    received = asyncio.Event()

    def _on_notify(*_args):
        received.set()

    await listener_conn.add_listener("hall_changed", _on_notify)

    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        console = Console(zone_id=zone.id, name="PS5-1")
        tariff = Tariff(zone_id=zone.id, kind=TariffKind.package, name="1 час", duration_min=60, price=150)
        db.add_all([console, tariff])
        await db.flush()

        now = _now()
        await business_days.open_business_day(db, opening_cash=0, now=now)
        await sessions.start_session(
            db, console_id=console.id, kind=SessionKind.paid, tariff_id=tariff.id,
            reason=None, comment=None, now=now,
        )

    await asyncio.wait_for(received.wait(), timeout=2)

    await listener_conn.remove_listener("hall_changed", _on_notify)
    await listener_conn.close()
    await engine.dispose()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/services/test_hall_notify.py -v`
Expected: FAIL — `asyncio.TimeoutError` (no notification is ever sent yet).

- [ ] **Step 3: Add `NOTIFY hall_changed` to every mutating service function**

```python
# core/services/sessions.py — add this import
from sqlalchemy import text
```

In `start_session`, `extend_session`, `stop_session`, and `cancel_session`, add `await db.execute(text("NOTIFY hall_changed"))` as the line immediately before each function's `await db.commit()`. For example, `start_session`'s tail becomes:

```python
    if kind == SessionKind.free:
        db.add(
            AuditLog(
                action="free_session_start",
                entity="session",
                entity_id=session.id,
                details={"console_id": console_id, "reason": reason},
                created_at=now,
            )
        )

    await db.execute(text("NOTIFY hall_changed"))
    await db.commit()
    await db.refresh(session)
    return session
```

Apply the same one-line addition (`await db.execute(text("NOTIFY hall_changed"))` right before `await db.commit()`) to the tails of `extend_session`, `stop_session`, and `cancel_session`.

```python
# core/services/payments.py — add the import and the line before commit
from sqlalchemy import text
# ...
    db.add(payment)
    await db.execute(text("NOTIFY hall_changed"))
    await db.commit()
    await db.refresh(payment)
    return payment
```

```python
# core/services/business_days.py — add the import
from sqlalchemy import text
```

In `open_business_day`, add the `NOTIFY` inside the `try` block, right before `await db.commit()`:

```python
    day = BusinessDay(opened_at=now, opening_cash=opening_cash)
    db.add(day)
    try:
        await db.execute(text("NOTIFY hall_changed"))
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        if "ux_business_days_one_open" not in str(exc.orig):
            raise
        raise ConflictError("business day already open") from None
    await db.refresh(day)
    return day
```

In `close_business_day`, add it right before `await db.commit()`:

```python
    day.closed_at = now
    day.expected_cash = day.opening_cash + cash_total
    day.counted_cash = counted_cash
    await db.execute(text("NOTIFY hall_changed"))
    await db.commit()
    await db.refresh(day)
    return day
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/services/test_hall_notify.py -v`
Expected: PASS

- [ ] **Step 5: Write the failing tests for the connection manager and listener**

```python
# tests/api/test_hall_ws.py
import asyncio

import pytest

from core.api.ws.manager import HallConnectionManager
from core.api.ws.listener import HallListener


class _FakeWebSocket:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)


@pytest.mark.asyncio
async def test_manager_broadcasts_to_every_connection():
    manager = HallConnectionManager()
    ws_a, ws_b = _FakeWebSocket(), _FakeWebSocket()
    await manager.connect(ws_a)
    await manager.connect(ws_b)

    await manager.broadcast({"hello": "world"})

    assert ws_a.sent == [{"hello": "world"}]
    assert ws_b.sent == [{"hello": "world"}]


@pytest.mark.asyncio
async def test_manager_drops_a_connection_that_fails_to_send():
    manager = HallConnectionManager()

    class _BrokenWebSocket(_FakeWebSocket):
        async def send_json(self, message: dict) -> None:
            raise RuntimeError("connection gone")

    broken = _BrokenWebSocket()
    await manager.connect(broken)
    await manager.broadcast({"x": 1})  # must not raise

    good = _FakeWebSocket()
    await manager.connect(good)
    await manager.broadcast({"x": 2})
    assert good.sent == [{"x": 2}]


@pytest.mark.asyncio
async def test_hall_listener_broadcasts_current_snapshot_on_demand():
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.base import Base
    from core.db.models import Console, Zone
    from tests.api.conftest import TEST_DATABASE_URL

    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        zone = Zone(name="Зал", is_active=True)
        db.add(zone)
        await db.flush()
        db.add(Console(zone_id=zone.id, name="PS5-1"))
        await db.commit()

    manager = HallConnectionManager()
    ws = _FakeWebSocket()
    await manager.connect(ws)

    listener = HallListener(manager=manager, session_factory=session_factory)
    await listener.broadcast_current_snapshot()

    await engine.dispose()

    assert len(ws.sent) == 1
    assert ws.sent[0]["consoles"][0]["name"] == "PS5-1"
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `uv run pytest tests/api/test_hall_ws.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'core.api.ws'`

- [ ] **Step 7: Implement the manager and listener**

```python
# core/api/ws/__init__.py
```

```python
# core/api/ws/manager.py
import asyncio
import logging

logger = logging.getLogger(__name__)


class HallConnectionManager:
    """Fans a hall snapshot out to every connected browser tab. One instance lives
    for the app's lifetime (see core.api.ws.listener.hall_listener)."""

    def __init__(self) -> None:
        self._connections: set = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket) -> None:
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket) -> None:
        async with self._lock:
            self._connections.discard(websocket)

    async def broadcast(self, message: dict) -> None:
        async with self._lock:
            connections = list(self._connections)
        for connection in connections:
            try:
                await connection.send_json(message)
            except Exception:
                logger.info("dropping a hall websocket connection that failed to send")
                await self.disconnect(connection)


manager = HallConnectionManager()
```

```python
# core/api/ws/listener.py
import logging

import asyncpg

from core.api.clock import now as _now
from core.api.schemas.hall import hall_snapshot_to_response
from core.api.ws.manager import HallConnectionManager, manager as default_manager
from core.config import settings
from core.db.session import async_session_factory
from core.services import hall as hall_service

logger = logging.getLogger(__name__)

CHANNEL = "hall_changed"


def _asyncpg_dsn() -> str:
    return settings.database_url.replace("postgresql+asyncpg://", "postgresql://", 1)


class HallListener:
    """Owns one dedicated asyncpg connection LISTENing on `hall_changed`, and
    re-broadcasts the current hall snapshot to every connected browser whenever a
    session/payment/business-day mutation NOTIFYs it. `session_factory` and
    `manager` are overridable so tests can broadcast without a real LISTEN
    round-trip and without touching the production database."""

    def __init__(self, *, manager: HallConnectionManager = default_manager, session_factory=async_session_factory) -> None:
        self._manager = manager
        self._session_factory = session_factory
        self._connection: asyncpg.Connection | None = None

    async def broadcast_current_snapshot(self) -> None:
        async with self._session_factory() as db:
            snapshot = await hall_service.build_hall_snapshot(db, _now())
        await self._manager.broadcast(hall_snapshot_to_response(snapshot).model_dump(mode="json"))

    async def _on_notify(self, connection, pid, channel, payload) -> None:
        await self.broadcast_current_snapshot()

    async def start(self) -> None:
        self._connection = await asyncpg.connect(_asyncpg_dsn())
        await self._connection.add_listener(CHANNEL, self._on_notify)
        logger.info("hall listener connected, LISTEN %s", CHANNEL)

    async def stop(self) -> None:
        if self._connection is not None:
            await self._connection.remove_listener(CHANNEL, self._on_notify)
            await self._connection.close()
            self._connection = None


hall_listener = HallListener()
```

```python
# core/api/routes/hall_ws.py
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from core.api.clock import now as _now
from core.api.schemas.hall import hall_snapshot_to_response
from core.api.ws.manager import manager
from core.db.session import async_session_factory
from core.services import hall as hall_service

router = APIRouter(tags=["hall"])


@router.websocket("/ws/hall")
async def hall_ws(websocket: WebSocket) -> None:
    if not websocket.session.get("authenticated"):
        await websocket.close(code=1008)
        return

    await websocket.accept()
    await manager.connect(websocket)
    try:
        async with async_session_factory() as db:
            snapshot = await hall_service.build_hall_snapshot(db, _now())
        await websocket.send_json(hall_snapshot_to_response(snapshot).model_dump(mode="json"))

        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
```

```python
# core/api/main.py — wire the lifespan and the new router
from contextlib import asynccontextmanager

from core.api.routes.hall_ws import router as hall_ws_router
from core.api.ws.listener import hall_listener


@asynccontextmanager
async def lifespan(app: FastAPI):
    await hall_listener.start()
    yield
    await hall_listener.stop()


def create_app() -> FastAPI:
    app = FastAPI(title="PS Club API", lifespan=lifespan)
    # ... (SessionMiddleware, register_exception_handlers, register_admin unchanged)
    app.include_router(health_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(settings_router, prefix="/api")
    app.include_router(tariffs_router, prefix="/api")
    app.include_router(business_days_router, prefix="/api")
    app.include_router(sessions_router, prefix="/api")
    app.include_router(hall_router, prefix="/api")
    app.include_router(hall_ws_router, prefix="/api")
    return app


app = create_app()
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `uv run pytest tests/api/test_hall_ws.py -v`
Expected: PASS

- [ ] **Step 9: Write and run a real end-to-end WebSocket test**

`httpx.AsyncClient` can't open a WebSocket — this test uses Starlette's sync `TestClient` instead, which does trigger the app's lifespan (`hall_listener.start()`/`.stop()`) when used as a context manager.

```python
# tests/api/test_hall_ws.py — append
def test_websocket_rejects_unauthenticated_connection():
    from starlette.testclient import TestClient

    from core.api.main import app

    with TestClient(app) as test_client:
        with pytest.raises(Exception):  # noqa: B017 — Starlette raises on a 1008 close during handshake
            with test_client.websocket_connect("/api/ws/hall"):
                pass


def test_websocket_sends_the_initial_snapshot_once_logged_in():
    from starlette.testclient import TestClient

    from core.api.main import app
    from core.db.session import get_session

    engine, session_factory = _sync_test_db()
    async def override_get_session():
        async with session_factory() as session:
            yield session
    app.dependency_overrides[get_session] = override_get_session

    with TestClient(app) as test_client:
        test_client.post("/api/auth/login", json={"password": "admin"})
        with test_client.websocket_connect("/api/ws/hall") as ws:
            message = ws.receive_json()
            assert message["consoles"] == []

    app.dependency_overrides.clear()


def _sync_test_db():
    import asyncio

    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from core.db.base import Base
    from tests.api.conftest import TEST_DATABASE_URL

    engine = create_async_engine(TEST_DATABASE_URL)

    async def _reset():
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_reset())
    return engine, async_sessionmaker(engine, expire_on_commit=False)
```

Run: `uv run pytest tests/api/test_hall_ws.py -v`
Expected: PASS. If `test_websocket_rejects_unauthenticated_connection` doesn't raise on your installed Starlette version, replace the `pytest.raises` block with checking `test_client.websocket_connect(...)`'s close code directly per that version's API — the behavior to assert is simply "the handshake does not succeed for a logged-out client."

- [ ] **Step 10: Run the full test suite**

Run: `uv run pytest -v`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add core/services/sessions.py core/services/payments.py core/services/business_days.py core/api/ws core/api/routes/hall_ws.py core/api/main.py tests/services/test_hall_notify.py tests/api/test_hall_ws.py
git commit -m "feat: broadcast hall snapshots over websocket on every mutation"
```

---

### Task 7: Frontend API client and clock-offset utility

**Files:**
- Create: `web/src/lib/api.ts`
- Create: `web/src/lib/clock.ts`
- Create: `web/src/lib/format.ts`
- Test: `web/tests/clock.test.ts`
- Test: `web/tests/format.test.ts`
- Modify: `web/vite.config.ts`

**Interfaces:**
- Produces: `api.login`, `api.logout`, `api.me`, `api.settings`, `api.tariffs`, `api.hall`, `api.currentBusinessDay`, `api.openBusinessDay`, `api.startSession`, `api.extendSession`, `api.stopSession`, `api.cancelSession`, `api.paySession`, plus `ApiError` (has `.status`) — consumed by every later frontend task. `updateClockOffset(serverIso: string)` / `serverNow(): number` — consumed by Task 10. `formatDuration(ms): string` / `formatSom(amount): string` — consumed by Task 10.

- [ ] **Step 1: Generate the OpenAPI types**

With the backend running (`docker compose up -d db api` from the repo root, or `uv run uvicorn core.api.main:app --reload` if you already have a local Postgres):

```bash
cd web
npm run generate:types
```

Verify `web/src/types/api.ts` now exists (it's gitignored — regenerate it any time the backend schema changes, per `README.md`).

- [ ] **Step 2: Add the WebSocket proxy for local dev**

```ts
// web/vite.config.ts — change the existing proxy entry
server: {
  host: true,
  port: 5173,
  proxy: {
    "/api": { target: "http://api:8000", changeOrigin: true, ws: true },
  },
},
```

(Only `ws: true` is new — `http-proxy` upgrades a request only when it actually carries an `Upgrade` header, so plain `/api/...` calls are unaffected.)

- [ ] **Step 3: Write the failing tests for the pure utilities**

```ts
// web/tests/clock.test.ts
import { describe, expect, it } from "vitest";
import { serverNow, updateClockOffset } from "@/lib/clock";

describe("clock offset", () => {
  it("adjusts serverNow by the difference between server and local time", () => {
    const clientNow = Date.now();
    const serverIso = new Date(clientNow + 5000).toISOString();
    updateClockOffset(serverIso);
    expect(serverNow() - clientNow).toBeGreaterThanOrEqual(4900);
    expect(serverNow() - clientNow).toBeLessThanOrEqual(5100);
  });
});
```

```ts
// web/tests/format.test.ts
import { describe, expect, it } from "vitest";
import { formatDuration, formatSom } from "@/lib/format";

describe("formatDuration", () => {
  it("formats minutes and seconds", () => {
    expect(formatDuration(65_000)).toBe("1:05");
  });

  it("clamps negative durations to zero", () => {
    expect(formatDuration(-5000)).toBe("0:00");
  });
});

describe("formatSom", () => {
  it("appends the currency label", () => {
    expect(formatSom(150)).toBe("150 сом");
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd web && npm run test -- clock.test.ts format.test.ts`
Expected: FAIL — modules don't exist yet.

- [ ] **Step 5: Implement**

```ts
// web/src/lib/clock.ts
let offsetMs = 0;

export function updateClockOffset(serverIso: string): void {
  offsetMs = new Date(serverIso).getTime() - Date.now();
}

export function serverNow(): number {
  return Date.now() + offsetMs;
}
```

```ts
// web/src/lib/format.ts
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatSom(amount: number): string {
  return `${amount} сом`;
}
```

```ts
// web/src/lib/api.ts
import type { components } from "@/types/api";

export type SessionResponse = components["schemas"]["SessionResponse"];
export type HallSnapshotResponse = components["schemas"]["HallSnapshotResponse"];
export type HallConsoleResponse = components["schemas"]["HallConsoleResponse"];
export type BusinessDayResponse = components["schemas"]["BusinessDayResponse"];
export type PublicSettingsResponse = components["schemas"]["PublicSettingsResponse"];
export type AuthStatusResponse = components["schemas"]["AuthStatusResponse"];
export type TariffResponse = components["schemas"]["TariffResponse"];
export type SessionKind = components["schemas"]["SessionKind"];
export type PaymentMethod = components["schemas"]["PaymentMethod"];

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: response.statusText }));
    throw new ApiError(response.status, body.detail ?? response.statusText);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  login: (password: string) =>
    request<AuthStatusResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => request<AuthStatusResponse>("/api/auth/logout", { method: "POST" }),
  me: () => request<AuthStatusResponse>("/api/auth/me"),
  settings: () => request<PublicSettingsResponse>("/api/settings"),
  tariffs: () => request<TariffResponse[]>("/api/tariffs"),
  hall: () => request<HallSnapshotResponse>("/api/hall"),
  currentBusinessDay: () => request<BusinessDayResponse>("/api/business-days/current"),
  openBusinessDay: (openingCash: number) =>
    request<BusinessDayResponse>("/api/business-days/open", {
      method: "POST",
      body: JSON.stringify({ opening_cash: openingCash }),
    }),
  startSession: (body: {
    console_id: number;
    kind: SessionKind;
    tariff_id?: number | null;
    reason?: string | null;
  }) => request<SessionResponse>("/api/sessions", { method: "POST", body: JSON.stringify(body) }),
  extendSession: (sessionId: number, tariffId: number) =>
    request<SessionResponse>(`/api/sessions/${sessionId}/extend`, {
      method: "POST",
      body: JSON.stringify({ tariff_id: tariffId }),
    }),
  stopSession: (sessionId: number) =>
    request<SessionResponse>(`/api/sessions/${sessionId}/stop`, { method: "POST" }),
  cancelSession: (sessionId: number) =>
    request<SessionResponse>(`/api/sessions/${sessionId}/cancel`, { method: "POST" }),
  paySession: (sessionId: number, amount: number, method: PaymentMethod) =>
    request(`/api/sessions/${sessionId}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount, method }),
    }),
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd web && npm run test -- clock.test.ts format.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/clock.ts web/src/lib/format.ts web/tests/clock.test.ts web/tests/format.test.ts web/vite.config.ts
git commit -m "feat: add the typed API client and clock-offset utility"
```

(`web/src/types/api.ts` stays untracked, per `.gitignore`.)

---

### Task 8: Login page and app-level auth gating

**Files:**
- Create: `web/src/features/auth/useAuth.ts`
- Create: `web/src/features/auth/LoginPage.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/tests/App.test.tsx`
- Modify: `web/components.json` (no change needed — already configured)

**Interfaces:**
- Consumes: `api.login`, `api.logout`, `api.me`, `ApiError` (Task 7).
- Produces: `useAuth()` → `{isAuthenticated, isLoading, login, loginError, logout}` — consumed by Task 15's header (logout button) and implicitly by every gated feature.

- [ ] **Step 1: Install the shadcn primitives this task needs**

```bash
cd web
npx shadcn@latest add button input label card
```

This creates `web/src/components/ui/{button,input,label,card}.tsx`.

- [ ] **Step 2: Write the failing test**

```tsx
// web/tests/App.test.tsx — full new version
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "@/App";

function renderApp() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>,
  );
}

describe("App", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the login form when not authenticated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authenticated: false }) }),
    );
    renderApp();
    await waitFor(() => expect(screen.getByLabelText("Пароль")).toBeInTheDocument());
  });

  it("shows the hall placeholder when authenticated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ authenticated: true }) }),
    );
    renderApp();
    await waitFor(() => expect(screen.getByTestId("hall-page")).toBeInTheDocument());
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npm run test -- App.test.tsx`
Expected: FAIL — `App` still renders the Stage-1 health-check text.

- [ ] **Step 4: Implement**

```ts
// web/src/features/auth/useAuth.ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const AUTH_QUERY_KEY = ["auth", "me"] as const;

export function useAuth() {
  const queryClient = useQueryClient();

  const meQuery = useQuery({ queryKey: AUTH_QUERY_KEY, queryFn: api.me, retry: false });

  const loginMutation = useMutation({
    mutationFn: (password: string) => api.login(password),
    onSuccess: (data) => queryClient.setQueryData(AUTH_QUERY_KEY, data),
  });

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSuccess: (data) => queryClient.setQueryData(AUTH_QUERY_KEY, data),
  });

  return {
    isAuthenticated: meQuery.data?.authenticated ?? false,
    isLoading: meQuery.isLoading,
    login: loginMutation.mutateAsync,
    loginError: loginMutation.error,
    logout: logoutMutation.mutateAsync,
  };
}
```

```tsx
// web/src/features/auth/LoginPage.tsx
import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api";
import { useAuth } from "./useAuth";

export function LoginPage() {
  const { login, loginError } = useAuth();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await login(password);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <h1 className="text-xl font-semibold">Вход в PS Club</h1>
          <div className="flex flex-col gap-1">
            <Label htmlFor="password">Пароль</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
          </div>
          {loginError && (
            <p className="text-sm text-red-600">
              {loginError instanceof ApiError && loginError.status === 401
                ? "Неверный пароль"
                : "Не удалось войти"}
            </p>
          )}
          <Button type="submit" disabled={submitting || password.length === 0}>
            Войти
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

```tsx
// web/src/App.tsx
import { LoginPage } from "@/features/auth/LoginPage";
import { useAuth } from "@/features/auth/useAuth";

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <div className="p-4">Загрузка…</div>;
  if (!isAuthenticated) return <LoginPage />;

  return <div data-testid="hall-page">Зал (наполнение — Задача 15)</div>;
}

export default App;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npm run test -- App.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/features/auth web/src/App.tsx web/tests/App.test.tsx web/src/components/ui web/package.json web/package-lock.json
git commit -m "feat: add the shared login page and app-level auth gating"
```

---

### Task 9: `useHallSnapshot` — WebSocket with polling fallback

**Files:**
- Create: `web/src/features/hall/useHallSnapshot.ts`
- Test: `web/tests/useHallSnapshot.test.tsx`

**Interfaces:**
- Consumes: `api.hall` (Task 7), `updateClockOffset` (Task 7).
- Produces: `useHallSnapshot() -> {data: HallSnapshotResponse | undefined, connected: boolean}` — consumed by Task 15.

- [ ] **Step 1: Write the failing test**

A fake `WebSocket` global stands in for the real one, mirroring how `App.test.tsx` already stubs `fetch`.

```tsx
// web/tests/useHallSnapshot.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHallSnapshot } from "@/features/hall/useHallSnapshot";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  close() {
    this.onclose?.();
  }

  emitOpen() {
    this.onopen?.();
  }

  emitMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useHallSnapshot", () => {
  afterEach(() => {
    FakeWebSocket.instances = [];
    vi.unstubAllGlobals();
  });

  it("applies a snapshot pushed over the websocket", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ generated_at: new Date().toISOString(), business_day_open: false, consoles: [] }),
      }),
    );
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);

    const { result } = renderHook(() => useHallSnapshot(), { wrapper });

    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();
    socket.emitMessage({
      generated_at: new Date().toISOString(),
      business_day_open: true,
      consoles: [{ id: 1, zone_id: 1, name: "PS5-1", is_active: true, session: null, charge_total: 0, paid_total: 0, balance: 0 }],
    });

    await waitFor(() => expect(result.current.connected).toBe(true));
    await waitFor(() => expect(result.current.data?.consoles).toHaveLength(1));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test -- useHallSnapshot.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```ts
// web/src/features/hall/useHallSnapshot.ts
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type HallSnapshotResponse } from "@/lib/api";
import { updateClockOffset } from "@/lib/clock";

export const HALL_QUERY_KEY = ["hall"] as const;

function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/ws/hall`;
}

export function useHallSnapshot() {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const retryCount = useRef(0);

  const query = useQuery({
    queryKey: HALL_QUERY_KEY,
    queryFn: api.hall,
    refetchInterval: connected ? false : 5000,
  });

  useEffect(() => {
    let socket: WebSocket | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      if (cancelled) return;
      socket = new WebSocket(wsUrl());
      socket.onopen = () => {
        retryCount.current = 0;
        setConnected(true);
      };
      socket.onmessage = (event) => {
        const snapshot = JSON.parse(event.data) as HallSnapshotResponse;
        updateClockOffset(snapshot.generated_at);
        queryClient.setQueryData(HALL_QUERY_KEY, snapshot);
      };
      socket.onclose = () => {
        setConnected(false);
        if (cancelled) return;
        const delay = Math.min(1000 * 2 ** retryCount.current, 15000);
        retryCount.current += 1;
        retryTimer = setTimeout(connect, delay);
      };
      socket.onerror = () => socket?.close();
    }

    connect();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      socket?.close();
    };
  }, [queryClient]);

  return { data: query.data, connected };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test -- useHallSnapshot.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/features/hall/useHallSnapshot.ts web/tests/useHallSnapshot.test.tsx
git commit -m "feat: add the hall websocket hook with polling fallback"
```

---

### Task 10: Console card — status, live countdown, warn/overtime, sound

**Files:**
- Create: `web/src/features/hall/remainingTime.ts`
- Create: `web/src/features/hall/useAlertSound.ts`
- Create: `web/src/features/hall/ConsoleCard.tsx`
- Test: `web/tests/remainingTime.test.ts`
- Test: `web/tests/useAlertSound.test.tsx`

**Interfaces:**
- Consumes: `HallConsoleResponse` (Task 7), `formatDuration`/`formatSom` (Task 7).
- Produces: `computeCardTiming(console, nowMs, warnMinutes) -> CardTiming` (pure — consumed directly by `ConsoleCard` and reusable by Task 15's per-console action wiring to decide which buttons apply); `useAlertSound(status: CardStatus)`; `<ConsoleCard console nowMs warnMinutes onStart onExtend onStop onCancel onPay />` — consumed by Task 15.

- [ ] **Step 1: Write the failing test for the pure timing logic**

```ts
// web/tests/remainingTime.test.ts
import { describe, expect, it } from "vitest";
import { computeCardTiming } from "@/features/hall/remainingTime";
import type { HallConsoleResponse } from "@/lib/api";

const WARN_MINUTES = 5;

function consoleWithSession(overrides: Partial<HallConsoleResponse["session"]> = {}): HallConsoleResponse {
  return {
    id: 1,
    zone_id: 1,
    name: "PS5-1",
    is_active: true,
    charge_total: 150,
    paid_total: 0,
    balance: 150,
    session: {
      id: 1,
      kind: "paid",
      reason: null,
      status: "active",
      started_at: "2026-01-01T10:00:00+06:00",
      grace_until: "2026-01-01T10:03:00+06:00",
      segments: [
        {
          id: 1,
          tariff_id: 1,
          kind: "package",
          starts_at: "2026-01-01T10:03:00+06:00",
          ends_at: "2026-01-01T11:03:00+06:00",
          price_snapshot: 150,
          amount: 150,
          ...overrides,
        },
      ],
      ...overrides,
    },
  } as HallConsoleResponse;
}

describe("computeCardTiming", () => {
  it("is free when there is no session", () => {
    const console = consoleWithSession();
    console.session = null;
    expect(computeCardTiming(console, Date.now(), WARN_MINUTES).status).toBe("free");
  });

  it("is maintenance when the console is inactive", () => {
    const console = consoleWithSession();
    console.is_active = false;
    expect(computeCardTiming(console, Date.now(), WARN_MINUTES).status).toBe("maintenance");
  });

  it("is package_running well before the end", () => {
    const console = consoleWithSession();
    const now = new Date("2026-01-01T10:30:00+06:00").getTime();
    const timing = computeCardTiming(console, now, WARN_MINUTES);
    expect(timing.status).toBe("package_running");
    expect(timing.remainingMs).toBeGreaterThan(0);
  });

  it("is package_warn inside the warn window", () => {
    const console = consoleWithSession();
    const now = new Date("2026-01-01T10:59:00+06:00").getTime(); // 4 min left
    expect(computeCardTiming(console, now, WARN_MINUTES).status).toBe("package_warn");
  });

  it("is package_overtime with a live counter after the end", () => {
    const console = consoleWithSession();
    const now = new Date("2026-01-01T11:05:00+06:00").getTime(); // 2 min over
    const timing = computeCardTiming(console, now, WARN_MINUTES);
    expect(timing.status).toBe("package_overtime");
    expect(timing.overtimeMs).toBeGreaterThanOrEqual(2 * 60_000 - 1000);
  });

  it("is open_running for an open-time segment with no end", () => {
    const console = consoleWithSession({ kind: "open", ends_at: null, amount: null } as never);
    const now = new Date("2026-01-01T10:30:00+06:00").getTime();
    expect(computeCardTiming(console, now, WARN_MINUTES).status).toBe("open_running");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test -- remainingTime.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement the pure timing logic**

```ts
// web/src/features/hall/remainingTime.ts
import type { HallConsoleResponse } from "@/lib/api";

export type CardStatus =
  | "free"
  | "maintenance"
  | "package_running"
  | "package_warn"
  | "package_overtime"
  | "open_running"
  | "free_session"
  | "service_session";

export interface CardTiming {
  status: CardStatus;
  remainingMs: number | null;
  overtimeMs: number | null;
  chargeTotal: number;
  balance: number;
}

export function computeCardTiming(
  consoleView: HallConsoleResponse,
  nowMs: number,
  warnMinutes: number,
): CardTiming {
  if (!consoleView.is_active) {
    return { status: "maintenance", remainingMs: null, overtimeMs: null, chargeTotal: 0, balance: 0 };
  }

  const session = consoleView.session;
  if (!session) {
    return { status: "free", remainingMs: null, overtimeMs: null, chargeTotal: 0, balance: 0 };
  }

  const base = { chargeTotal: consoleView.charge_total, balance: consoleView.balance };

  if (session.kind === "free") {
    return { status: "free_session", remainingMs: null, overtimeMs: null, ...base };
  }
  if (session.kind === "service") {
    return { status: "service_session", remainingMs: null, overtimeMs: null, ...base };
  }

  const last = session.segments[session.segments.length - 1];
  if (last?.kind === "package" && last.ends_at) {
    const endsAtMs = new Date(last.ends_at).getTime();
    const remainingMs = endsAtMs - nowMs;
    if (remainingMs <= 0) {
      return { status: "package_overtime", remainingMs: null, overtimeMs: -remainingMs, ...base };
    }
    const status: CardStatus = remainingMs <= warnMinutes * 60_000 ? "package_warn" : "package_running";
    return { status, remainingMs, overtimeMs: null, ...base };
  }

  return { status: "open_running", remainingMs: null, overtimeMs: null, ...base };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test -- remainingTime.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for the alert sound**

```tsx
// web/tests/useAlertSound.test.tsx
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAlertSound } from "@/features/hall/useAlertSound";

class FakeOscillator {
  frequency = { value: 0 };
  connect() {}
  start() {}
  stop() {}
  onended: (() => void) | null = null;
}

class FakeGain {
  gain = { setValueAtTime: vi.fn() };
  connect() {}
}

class FakeAudioContext {
  currentTime = 0;
  createOscillator() {
    return new FakeOscillator();
  }
  createGain() {
    return new FakeGain();
  }
  destination = {};
  close() {}
}

describe("useAlertSound", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("beeps once when transitioning into package_warn", () => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    const createOscillatorSpy = vi.spyOn(FakeAudioContext.prototype, "createOscillator");

    const { rerender } = renderHook(({ status }) => useAlertSound(status), {
      initialProps: { status: "package_running" as const },
    });
    expect(createOscillatorSpy).not.toHaveBeenCalled();

    rerender({ status: "package_warn" as const });
    expect(createOscillatorSpy).toHaveBeenCalledTimes(1);

    rerender({ status: "package_warn" as const });
    expect(createOscillatorSpy).toHaveBeenCalledTimes(1); // no repeat while status is unchanged
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && npm run test -- useAlertSound.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7: Implement**

```ts
// web/src/features/hall/useAlertSound.ts
import { useEffect, useRef } from "react";
import type { CardStatus } from "./remainingTime";

function beep(frequency: number, durationMs: number): void {
  const ctx = new AudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.frequency.value = frequency;
  oscillator.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.2, ctx.currentTime);
  oscillator.start();
  oscillator.stop(ctx.currentTime + durationMs / 1000);
  oscillator.onended = () => ctx.close();
}

export function useAlertSound(status: CardStatus): void {
  const previous = useRef<CardStatus>(status);

  useEffect(() => {
    if (previous.current !== status) {
      if (status === "package_warn") beep(880, 300);
      if (status === "package_overtime") beep(440, 600);
      previous.current = status;
    }
  }, [status]);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd web && npm run test -- useAlertSound.test.tsx`
Expected: PASS

- [ ] **Step 9: Install the badge primitive and implement the card**

```bash
cd web
npx shadcn@latest add badge
```

```tsx
// web/src/features/hall/ConsoleCard.tsx
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { HallConsoleResponse } from "@/lib/api";
import { formatDuration, formatSom } from "@/lib/format";
import { computeCardTiming } from "./remainingTime";
import { useAlertSound } from "./useAlertSound";

const STATUS_LABELS: Record<string, string> = {
  free: "Свободна",
  maintenance: "Обслуживание",
  package_running: "Идёт пакет",
  package_warn: "Скоро конец",
  package_overtime: "Время вышло",
  open_running: "Открытое время",
  free_session: "Бесплатная сессия",
  service_session: "Служебная сессия",
};

interface ConsoleCardProps {
  console: HallConsoleResponse;
  nowMs: number;
  warnMinutes: number;
  onStart: () => void;
  onExtend: () => void;
  onStop: () => void;
  onCancel: () => void;
  onPay: () => void;
}

export function ConsoleCard({
  console: consoleView,
  nowMs,
  warnMinutes,
  onStart,
  onExtend,
  onStop,
  onCancel,
  onPay,
}: ConsoleCardProps) {
  const timing = computeCardTiming(consoleView, nowMs, warnMinutes);
  useAlertSound(timing.status);

  const session = consoleView.session;
  const isOvertime = timing.status === "package_overtime";
  const isWarn = timing.status === "package_warn";
  const canCancel = session != null && new Date(session.grace_until).getTime() > nowMs;

  return (
    <Card
      className={
        "flex flex-col gap-2 p-4" +
        (isOvertime ? " border-red-500 bg-red-50 animate-pulse" : isWarn ? " border-amber-400 bg-amber-50" : "")
      }
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">{consoleView.name}</span>
        <Badge variant={isOvertime ? "destructive" : "secondary"}>{STATUS_LABELS[timing.status]}</Badge>
      </div>

      {timing.remainingMs != null && (
        <div className="font-mono text-3xl">{formatDuration(timing.remainingMs)}</div>
      )}
      {timing.overtimeMs != null && (
        <div className="font-mono text-3xl text-red-600">+{formatDuration(timing.overtimeMs)}</div>
      )}
      {session && (
        <div className="text-sm text-muted-foreground">
          Счёт: {formatSom(timing.chargeTotal)} · Остаток: {formatSom(timing.balance)}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2">
        {timing.status === "free" && (
          <Button onClick={onStart} size="sm">
            Старт
          </Button>
        )}
        {session && session.status === "active" && (
          <>
            {session.kind === "paid" && (
              <Button onClick={onExtend} size="sm" variant="outline">
                Продлить
              </Button>
            )}
            <Button onClick={onStop} size="sm" variant="outline">
              Стоп
            </Button>
            {canCancel && (
              <Button onClick={onCancel} size="sm" variant="ghost">
                Отменить
              </Button>
            )}
            {session.kind === "paid" && (
              <Button onClick={onPay} size="sm" variant="outline">
                Оплата
              </Button>
            )}
          </>
        )}
      </div>
    </Card>
  );
}
```

- [ ] **Step 10: Commit**

```bash
git add web/src/features/hall/remainingTime.ts web/src/features/hall/useAlertSound.ts web/src/features/hall/ConsoleCard.tsx web/tests/remainingTime.test.ts web/tests/useAlertSound.test.tsx web/src/components/ui/badge.tsx web/package.json web/package-lock.json
git commit -m "feat: add the console card with live countdown, warn and overtime states"
```

---

### Task 11: Start-session dialog

**Files:**
- Create: `web/src/features/hall/StartSessionDialog.tsx`
- Test: `web/tests/StartSessionDialog.test.tsx`

**Interfaces:**
- Consumes: `api.tariffs`, `api.startSession` (Task 7).
- Produces: `<StartSessionDialog open onOpenChange consoleId onStarted />` — consumed by Task 15.

- [ ] **Step 1: Install the dialog and select primitives**

```bash
cd web
npx shadcn@latest add dialog select radio-group
```

- [ ] **Step 2: Write the failing test**

```tsx
// web/tests/StartSessionDialog.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StartSessionDialog } from "@/features/hall/StartSessionDialog";

function renderDialog(onStarted = vi.fn()) {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <StartSessionDialog open consoleId={1} onOpenChange={() => {}} onStarted={onStarted} />
    </QueryClientProvider>,
  );
  return { onStarted };
}

describe("StartSessionDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts a paid session with the selected tariff", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tariffs") {
        return {
          ok: true,
          json: async () => [
            { id: 1, zone_id: 1, kind: "package", name: "1 час", duration_min: 60, price: 150, hourly_rate: null, is_active: true },
          ],
        };
      }
      return { ok: true, json: async () => ({ id: 1 }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { onStarted } = renderDialog();

    await waitFor(() => expect(screen.getByText("1 час — 150 сом")).toBeInTheDocument());
    fireEvent.click(screen.getByText("1 час — 150 сом"));
    fireEvent.click(screen.getByRole("button", { name: "Начать" }));

    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const startCall = fetchMock.mock.calls.find(([url]) => url === "/api/sessions");
    expect(startCall).toBeTruthy();
    expect(JSON.parse(startCall![1].body)).toMatchObject({ console_id: 1, kind: "paid", tariff_id: 1 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd web && npm run test -- StartSessionDialog.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement**

```tsx
// web/src/features/hall/StartSessionDialog.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type SessionKind } from "@/lib/api";
import { formatSom } from "@/lib/format";

interface StartSessionDialogProps {
  open: boolean;
  consoleId: number;
  onOpenChange: (open: boolean) => void;
  onStarted: () => void;
}

export function StartSessionDialog({ open, consoleId, onOpenChange, onStarted }: StartSessionDialogProps) {
  const tariffsQuery = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs, enabled: open });
  const [kind, setKind] = useState<SessionKind>("paid");
  const [tariffId, setTariffId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const queryClient = useQueryClient();

  const startMutation = useMutation({
    mutationFn: () =>
      api.startSession({
        console_id: consoleId,
        kind,
        tariff_id: kind === "paid" ? tariffId : null,
        reason: kind === "free" ? reason : null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hall"] });
      onStarted();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Начать сессию</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <Button variant={kind === "paid" ? "default" : "outline"} size="sm" onClick={() => setKind("paid")}>
              Платная
            </Button>
            <Button variant={kind === "free" ? "default" : "outline"} size="sm" onClick={() => setKind("free")}>
              Бесплатная
            </Button>
            <Button variant={kind === "service" ? "default" : "outline"} size="sm" onClick={() => setKind("service")}>
              Служебная
            </Button>
          </div>

          {kind === "paid" && (
            <div className="flex flex-col gap-1">
              <Label>Тариф</Label>
              {(tariffsQuery.data ?? []).map((tariff) => (
                <button
                  key={tariff.id}
                  type="button"
                  className={
                    "rounded border p-2 text-left" + (tariffId === tariff.id ? " border-primary" : "")
                  }
                  onClick={() => setTariffId(tariff.id)}
                >
                  {tariff.name} — {formatSom(tariff.kind === "package" ? (tariff.price ?? 0) : (tariff.hourly_rate ?? 0))}
                  {tariff.kind === "open" ? "/час" : ""}
                </button>
              ))}
            </div>
          )}

          {kind === "free" && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="reason">Причина</Label>
              <Input id="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            onClick={() => startMutation.mutate()}
            disabled={
              startMutation.isPending ||
              (kind === "paid" && tariffId === null) ||
              (kind === "free" && reason.trim().length === 0)
            }
          >
            Начать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd web && npm run test -- StartSessionDialog.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/features/hall/StartSessionDialog.tsx web/tests/StartSessionDialog.test.tsx web/src/components/ui/dialog.tsx web/src/components/ui/select.tsx web/src/components/ui/radio-group.tsx web/package.json web/package-lock.json
git commit -m "feat: add the start-session dialog"
```

---

### Task 12: Extend, stop, and cancel actions

**Files:**
- Create: `web/src/features/hall/ExtendSessionDialog.tsx`
- Create: `web/src/features/hall/useSessionActions.ts`
- Test: `web/tests/ExtendSessionDialog.test.tsx`
- Test: `web/tests/useSessionActions.test.tsx`

**Interfaces:**
- Consumes: `api.extendSession`, `api.stopSession`, `api.cancelSession`, `api.tariffs` (Task 7).
- Produces: `<ExtendSessionDialog open sessionId onOpenChange onExtended />`; `useSessionActions() -> {stop(sessionId), cancel(sessionId), stopping, cancelling}` — both consumed by Task 15.

- [ ] **Step 1: Write the failing test for stop/cancel**

```tsx
// web/tests/useSessionActions.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSessionActions } from "@/features/hall/useSessionActions";

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient();
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useSessionActions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls the stop endpoint for the given session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 5 }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionActions(), { wrapper });
    await result.current.stop(5);

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/5/stop", expect.objectContaining({ method: "POST" }));
  });

  it("calls the cancel endpoint for the given session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 5 }) });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionActions(), { wrapper });
    await result.current.cancel(5);

    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/5/cancel", expect.objectContaining({ method: "POST" }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test -- useSessionActions.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `useSessionActions`**

```ts
// web/src/features/hall/useSessionActions.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

export function useSessionActions() {
  const queryClient = useQueryClient();
  const invalidateHall = () => queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });

  const stopMutation = useMutation({ mutationFn: api.stopSession, onSuccess: invalidateHall });
  const cancelMutation = useMutation({ mutationFn: api.cancelSession, onSuccess: invalidateHall });

  return {
    stop: stopMutation.mutateAsync,
    cancel: cancelMutation.mutateAsync,
    stopping: stopMutation.isPending,
    cancelling: cancelMutation.isPending,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test -- useSessionActions.test.tsx`
Expected: PASS

- [ ] **Step 5: Write the failing test for the extend dialog**

```tsx
// web/tests/ExtendSessionDialog.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtendSessionDialog } from "@/features/hall/ExtendSessionDialog";

describe("ExtendSessionDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("extends the session with the selected tariff", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/tariffs") {
        return {
          ok: true,
          json: async () => [
            { id: 2, zone_id: 1, kind: "open", name: "Открытое время", duration_min: null, price: null, hourly_rate: 120, is_active: true },
          ],
        };
      }
      return { ok: true, json: async () => ({ id: 5 }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const onExtended = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <ExtendSessionDialog open sessionId={5} onOpenChange={() => {}} onExtended={onExtended} />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText(/Открытое время/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Открытое время/));
    fireEvent.click(screen.getByRole("button", { name: "Продлить" }));

    await waitFor(() => expect(onExtended).toHaveBeenCalled());
    const extendCall = fetchMock.mock.calls.find(([url]) => url === "/api/sessions/5/extend");
    expect(JSON.parse(extendCall![1].body)).toEqual({ tariff_id: 2 });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd web && npm run test -- ExtendSessionDialog.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 7: Implement**

```tsx
// web/src/features/hall/ExtendSessionDialog.tsx
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import { formatSom } from "@/lib/format";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface ExtendSessionDialogProps {
  open: boolean;
  sessionId: number;
  onOpenChange: (open: boolean) => void;
  onExtended: () => void;
}

export function ExtendSessionDialog({ open, sessionId, onOpenChange, onExtended }: ExtendSessionDialogProps) {
  const tariffsQuery = useQuery({ queryKey: ["tariffs"], queryFn: api.tariffs, enabled: open });
  const [tariffId, setTariffId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const extendMutation = useMutation({
    mutationFn: () => api.extendSession(sessionId, tariffId as number),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      onExtended();
      onOpenChange(false);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Продлить сессию</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-1">
          {(tariffsQuery.data ?? []).map((tariff) => (
            <button
              key={tariff.id}
              type="button"
              className={"rounded border p-2 text-left" + (tariffId === tariff.id ? " border-primary" : "")}
              onClick={() => setTariffId(tariff.id)}
            >
              {tariff.name} — {formatSom(tariff.kind === "package" ? (tariff.price ?? 0) : (tariff.hourly_rate ?? 0))}
              {tariff.kind === "open" ? "/час" : ""}
            </button>
          ))}
        </div>

        <DialogFooter>
          <Button onClick={() => extendMutation.mutate()} disabled={tariffId === null || extendMutation.isPending}>
            Продлить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd web && npm run test -- ExtendSessionDialog.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add web/src/features/hall/ExtendSessionDialog.tsx web/src/features/hall/useSessionActions.ts web/tests/ExtendSessionDialog.test.tsx web/tests/useSessionActions.test.tsx
git commit -m "feat: add extend, stop and cancel session actions"
```

---

### Task 13: Payment dialog

**Files:**
- Create: `web/src/features/hall/PaymentDialog.tsx`
- Test: `web/tests/PaymentDialog.test.tsx`

**Interfaces:**
- Consumes: `api.paySession` (Task 7).
- Produces: `<PaymentDialog open sessionId balance onOpenChange onPaid />` — consumed by Task 15. Supports paying in parts across methods (`SPEC.md` §3.4) by letting the operator submit more than one payment before closing.

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/PaymentDialog.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentDialog } from "@/features/hall/PaymentDialog";

describe("PaymentDialog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("submits a cash payment for the entered amount", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    const onPaid = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <PaymentDialog open sessionId={5} balance={300} onOpenChange={() => {}} onPaid={onPaid} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByLabelText("Сумма"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "Наличные" }));
    fireEvent.click(screen.getByRole("button", { name: "Внести" }));

    await waitFor(() => expect(onPaid).toHaveBeenCalled());
    const payCall = fetchMock.mock.calls.find(([url]) => url === "/api/sessions/5/payments");
    expect(JSON.parse(payCall![1].body)).toEqual({ amount: 100, method: "cash" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test -- PaymentDialog.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```tsx
// web/src/features/hall/PaymentDialog.tsx
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, type PaymentMethod } from "@/lib/api";
import { formatSom } from "@/lib/format";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface PaymentDialogProps {
  open: boolean;
  sessionId: number;
  balance: number;
  onOpenChange: (open: boolean) => void;
  onPaid: () => void;
}

const METHODS: { value: PaymentMethod; label: string }[] = [
  { value: "cash", label: "Наличные" },
  { value: "qr", label: "QR" },
  { value: "transfer", label: "Перевод" },
];

export function PaymentDialog({ open, sessionId, balance, onOpenChange, onPaid }: PaymentDialogProps) {
  const [amount, setAmount] = useState(String(balance));
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const queryClient = useQueryClient();

  const payMutation = useMutation({
    mutationFn: () => api.paySession(sessionId, Number(amount), method),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY });
      onPaid();
      setAmount("");
    },
  });

  const amountValue = Number(amount);
  const isValidAmount = Number.isFinite(amountValue) && amountValue > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Оплата — остаток {formatSom(balance)}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="amount">Сумма</Label>
            <Input id="amount" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </div>
          <div className="flex gap-2">
            {METHODS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={method === option.value ? "default" : "outline"}
                onClick={() => setMethod(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <DialogFooter>
          <Button onClick={() => payMutation.mutate()} disabled={!isValidAmount || payMutation.isPending}>
            Внести
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

Leaving the dialog open (`onOpenChange` is the caller's, not closed here) lets the operator add a second payment with a different method for a split payment, then close manually once `balance` reaches 0 — Task 15 wires `balance` from the live hall snapshot so it updates between payments.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test -- PaymentDialog.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/features/hall/PaymentDialog.tsx web/tests/PaymentDialog.test.tsx
git commit -m "feat: add the split-payment dialog"
```

---

### Task 14: Business-day guard

Starting a session while no business day is open currently fails with a 409 (`ConflictError("no open business day")`) — `SPEC.md` §3.6 asks for "День не открыт. Открыть?" instead of a raw error.

**Files:**
- Create: `web/src/features/hall/BusinessDayGuard.tsx`
- Test: `web/tests/BusinessDayGuard.test.tsx`

**Interfaces:**
- Consumes: `api.currentBusinessDay`, `api.openBusinessDay`, `ApiError` (Task 7).
- Produces: `<BusinessDayGuard businessDayOpen children />` — renders `children` unchanged when a day is open; otherwise renders an inline "День не открыт. Открыть?" prompt over them. Consumed by Task 15, wrapping the console grid (`business_day_open` comes straight off the hall snapshot, so no extra fetch is needed to know whether to show it).

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/BusinessDayGuard.test.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BusinessDayGuard } from "@/features/hall/BusinessDayGuard";

describe("BusinessDayGuard", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders children unchanged when a day is open", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BusinessDayGuard businessDayOpen>
          <div>Зал</div>
        </BusinessDayGuard>
      </QueryClientProvider>,
    );
    expect(screen.getByText("Зал")).toBeInTheDocument();
  });

  it("prompts to open the day, and opens it on confirmation", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 1 }) });
    vi.stubGlobal("fetch", fetchMock);

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <BusinessDayGuard businessDayOpen={false}>
          <div>Зал</div>
        </BusinessDayGuard>
      </QueryClientProvider>,
    );

    expect(screen.getByText("День не открыт. Открыть?")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Наличные на начало"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Открыть" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/business-days/open",
        expect.objectContaining({ body: JSON.stringify({ opening_cash: 5000 }) }),
      ),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test -- BusinessDayGuard.test.tsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement**

```tsx
// web/src/features/hall/BusinessDayGuard.tsx
import { type ReactNode, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { HALL_QUERY_KEY } from "./useHallSnapshot";

interface BusinessDayGuardProps {
  businessDayOpen: boolean;
  children: ReactNode;
}

export function BusinessDayGuard({ businessDayOpen, children }: BusinessDayGuardProps) {
  const [openingCash, setOpeningCash] = useState("");
  const queryClient = useQueryClient();

  const openMutation = useMutation({
    mutationFn: () => api.openBusinessDay(Number(openingCash)),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: HALL_QUERY_KEY }),
  });

  if (businessDayOpen) return <>{children}</>;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="flex w-full max-w-sm flex-col gap-4 p-6">
        <h1 className="text-lg font-semibold">День не открыт. Открыть?</h1>
        <div className="flex flex-col gap-1">
          <Label htmlFor="opening-cash">Наличные на начало</Label>
          <Input
            id="opening-cash"
            type="number"
            value={openingCash}
            onChange={(event) => setOpeningCash(event.target.value)}
          />
        </div>
        <Button
          onClick={() => openMutation.mutate()}
          disabled={openingCash.trim().length === 0 || openMutation.isPending}
        >
          Открыть
        </Button>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test -- BusinessDayGuard.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add web/src/features/hall/BusinessDayGuard.tsx web/tests/BusinessDayGuard.test.tsx
git commit -m "feat: prompt to open the business day instead of failing the first session"
```

---

### Task 15: App shell — wire the hall grid together, mobile layout, logout

**Files:**
- Create: `web/src/features/hall/HallPage.tsx`
- Modify: `web/src/App.tsx`
- Modify: `web/tests/App.test.tsx`
- Modify: `web/src/index.css` (only if the grid needs a utility class Tailwind doesn't already provide — check before adding)

**Interfaces:**
- Consumes: everything from Tasks 7–14.
- Produces: the finished hall screen mounted by `App`.

- [ ] **Step 1: Write the failing test**

```tsx
// web/tests/App.test.tsx — replace the "authenticated" case from Task 8
it("shows the hall grid when authenticated", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url === "/api/auth/me") return { ok: true, json: async () => ({ authenticated: true }) };
    if (url === "/api/hall") {
      return {
        ok: true,
        json: async () => ({
          generated_at: new Date().toISOString(),
          business_day_open: true,
          consoles: [{ id: 1, zone_id: 1, name: "PS5-1", is_active: true, session: null, charge_total: 0, paid_total: 0, balance: 0 }],
        }),
      };
    }
    if (url === "/api/settings") return { ok: true, json: async () => ({ grace_minutes: 3, warn_minutes: 5 }) };
    return { ok: true, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "WebSocket",
    class {
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close() {}
    } as unknown as typeof WebSocket,
  );

  renderApp();
  await waitFor(() => expect(screen.getByTestId("hall-page")).toBeInTheDocument());
  await waitFor(() => expect(screen.getByText("PS5-1")).toBeInTheDocument());
});
```

(Remove the old `it("shows the hall placeholder ...")` test this replaces — the `data-testid="hall-page"` marker moves from `App.tsx`'s placeholder onto `HallPage`'s root element.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web && npm run test -- App.test.tsx`
Expected: FAIL — `HallPage` doesn't exist, `App` still renders the Task 8 placeholder text.

- [ ] **Step 3: Implement `HallPage`**

```tsx
// web/src/features/hall/HallPage.tsx
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { api, type HallConsoleResponse } from "@/lib/api";
import { serverNow } from "@/lib/clock";
import { useAuth } from "@/features/auth/useAuth";
import { BusinessDayGuard } from "./BusinessDayGuard";
import { ConsoleCard } from "./ConsoleCard";
import { ExtendSessionDialog } from "./ExtendSessionDialog";
import { PaymentDialog } from "./PaymentDialog";
import { StartSessionDialog } from "./StartSessionDialog";
import { useHallSnapshot } from "./useHallSnapshot";
import { useSessionActions } from "./useSessionActions";

type DialogState =
  | { kind: "none" }
  | { kind: "start"; consoleId: number }
  | { kind: "extend"; sessionId: number }
  | { kind: "pay"; sessionId: number; balance: number };

export function HallPage() {
  const { logout } = useAuth();
  const { data: hall } = useHallSnapshot();
  const settingsQuery = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const { stop, cancel } = useSessionActions();
  const [dialog, setDialog] = useState<DialogState>({ kind: "none" });
  const [nowMs, setNowMs] = useState(serverNow());

  useEffect(() => {
    const interval = setInterval(() => setNowMs(serverNow()), 1000);
    return () => clearInterval(interval);
  }, []);

  const warnMinutes = settingsQuery.data?.warn_minutes ?? 5;

  return (
    <div data-testid="hall-page" className="min-h-screen p-4">
      <header className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Зал</h1>
        <Button variant="ghost" size="sm" onClick={() => logout()}>
          Выйти
        </Button>
      </header>

      <BusinessDayGuard businessDayOpen={hall?.business_day_open ?? false}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {(hall?.consoles ?? []).map((consoleView: HallConsoleResponse) => (
            <ConsoleCard
              key={consoleView.id}
              console={consoleView}
              nowMs={nowMs}
              warnMinutes={warnMinutes}
              onStart={() => setDialog({ kind: "start", consoleId: consoleView.id })}
              onExtend={() =>
                consoleView.session && setDialog({ kind: "extend", sessionId: consoleView.session.id })
              }
              onStop={() => consoleView.session && stop(consoleView.session.id)}
              onCancel={() => consoleView.session && cancel(consoleView.session.id)}
              onPay={() =>
                consoleView.session &&
                setDialog({ kind: "pay", sessionId: consoleView.session.id, balance: consoleView.balance })
              }
            />
          ))}
        </div>
      </BusinessDayGuard>

      {dialog.kind === "start" && (
        <StartSessionDialog
          open
          consoleId={dialog.consoleId}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          onStarted={() => setDialog({ kind: "none" })}
        />
      )}
      {dialog.kind === "extend" && (
        <ExtendSessionDialog
          open
          sessionId={dialog.sessionId}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          onExtended={() => setDialog({ kind: "none" })}
        />
      )}
      {dialog.kind === "pay" && (
        <PaymentDialog
          open
          sessionId={dialog.sessionId}
          balance={dialog.balance}
          onOpenChange={(open) => !open && setDialog({ kind: "none" })}
          onPaid={() => {}}
        />
      )}
    </div>
  );
}
```

The grid (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`) is Tailwind's own responsive utilities — no custom CSS needed, satisfying "вёрстка, пригодная для телефона" (`PLAN.md` stage 3) down to a single column on a phone-width screen.

```tsx
// web/src/App.tsx
import { LoginPage } from "@/features/auth/LoginPage";
import { useAuth } from "@/features/auth/useAuth";
import { HallPage } from "@/features/hall/HallPage";

function App() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) return <div className="p-4">Загрузка…</div>;
  if (!isAuthenticated) return <LoginPage />;

  return <HallPage />;
}

export default App;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web && npm run test -- App.test.tsx`
Expected: PASS

- [ ] **Step 5: Run the full frontend test suite and linter**

Run: `cd web && npm run test && npm run lint`
Expected: all tests pass, no lint errors.

- [ ] **Step 6: Manually check the mobile layout**

Run `npm run dev` (or `docker compose up web`), open the app, and use the browser's device toolbar at a 375px-wide viewport — confirm the grid collapses to one column and every button stays reachable without horizontal scrolling.

- [ ] **Step 7: Commit**

```bash
git add web/src/features/hall/HallPage.tsx web/src/App.tsx web/tests/App.test.tsx
git commit -m "feat: assemble the hall page and wire it into the app"
```

---

### Task 16: Manual end-to-end verification

This stage's done-criterion (`PLAN.md`) is behavioral, not something a unit test proves on its own: a full session has to work start-to-payment through the actual browser, and closing/reopening the tab must not disturb a running timer. Run this checklist by hand once every prior task is committed.

**Files:** none — this task produces no code, only a verification record.

- [ ] **Step 1: Start the full stack**

```bash
cp .env.example .env   # if you don't already have one
docker compose up --build
```

- [ ] **Step 2: Seed reference data**

```bash
docker compose exec api uv run alembic upgrade head
docker compose exec api uv run python -m core.db.seed
```

- [ ] **Step 3: Log in**

Open `http://localhost:5173`. You should see the login form (Task 8). Log in with `admin` (the dev-default password from Task 3). You should land on the hall grid with three free `PS5-N` cards (Task 15).

- [ ] **Step 4: Open the business day**

If the "День не открыт. Открыть?" prompt (Task 14) doesn't already show, it will the moment you try to start a session. Enter an opening cash amount and confirm the grid becomes usable.

- [ ] **Step 5: Full paid session, package → extend → overtime → stop → split payment**

1. Click "Старт" on a free console, choose "Платная", pick "1 час", confirm. The card should immediately show a counting-down timer and a "Стоп"/"Продлить"/"Оплата" button set (Task 11).
2. Click "Продлить", pick "Открытое время". The timer should keep counting down the *remaining* package time (it should not jump or reset) until the package ends, then switch to counting *up* as open time (Task 12, backed by Stage 2's `next_segment_start`).
3. To see the overtime state without waiting a full hour: in SQLAdmin (`http://localhost:8000/admin`, same password), or via `docker compose exec api uv run python -c "..."`, move the segment's `ends_at` a minute into the past for this one session, then refresh — the card should immediately turn red, show a live "+MM:SS" counter, and play a beep once.
4. Click "Оплата" and pay part of the balance in cash, then part in QR without closing the dialog — confirm the balance shown updates between the two payments and reaches 0 after both (Task 13).
5. Click "Стоп" (or confirm the balance is already 0 and the session shows "finished" after the last payment) — the card should return to "Свободна".

- [ ] **Step 6: Tab-close resilience**

While a session is actively counting down, close the browser tab entirely, wait about 10 seconds, then reopen `http://localhost:5173`. You should land back on the same hall grid (still logged in — the 30-day cookie survives), and the reopened card's timer should show the *correct* remaining time (not reset to the full package length) — proving the countdown is derived from the server's absolute timestamp, not client-side state (`CLAUDE.md` rule 1, `PLAN.md` stage 3's done-criterion).

- [ ] **Step 7: Two-tab live sync**

Open a second browser tab to `http://localhost:5173` alongside the first. Start, extend, or pay for a session in one tab and confirm the other tab's card updates within roughly a second, without a manual refresh — this is the WebSocket broadcast from Task 6 in action.

- [ ] **Step 8: Free/service session and cancel-within-grace**

1. Start a free session (with a reason) on another console — confirm no charge/balance line is shown and no "Оплата" button appears (Task 10/11).
2. Start a paid session and immediately click "Отменить" (visible only inside the grace window) — confirm the console returns to "Свободна" with no charge recorded (Task 12; verify via `SELECT * FROM audit_log WHERE action = 'cancel'` that the cancellation was logged per `CLAUDE.md` rule 9 — this was Stage 2's job, not new in this stage, but worth reconfirming end-to-end here).

- [ ] **Step 9: Record the result**

If every step above behaves as described, Stage 3 meets `PLAN.md`'s done-criterion. Note this in the PR description (or wherever this team tracks stage completion) along with anything that surprised you — in particular flag if the SQLAdmin authentication backend from Task 4 needed a different import path than written, since that was the one place this plan couldn't verify the exact library API ahead of time.
