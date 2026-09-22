# Stage 1 — Repository Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the monorepo skeleton for the PS-club system — no domain models, no business logic — so that `docker compose up` brings up an empty core with a database, migrations run, and the frontend loads and gets a response from the API.

**Architecture:** A single `uv`-managed Python project holds `core/` (FastAPI app, DB layer, worker) and `bot/` (aiogram) as plain importable packages sharing one virtualenv and one lock file. `api`, `worker` and `bot` run as three separate processes/containers built from one Docker image, each with a different command — this is required later so the scheduler never runs inside multiple uvicorn workers. `web/` is an independent npm project (Vite + React + TypeScript) with its own container. Postgres is the fifth service. All five run under one `docker-compose.yml` for local development.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy 2 (async, asyncpg), Alembic, APScheduler 3, aiogram 3, uv (Python 3.12), React + Vite + TypeScript + TanStack Query + Tailwind/shadcn, npm, openapi-typescript, Docker Compose, ruff, ESLint, pytest, vitest.

**Spec:** `docs/PLAN.md` (stage "1. Каркас репозитория"), `docs/SPEC.md` (section 5 "Архитектура", section 6 "Стек"), `CLAUDE.md` (repository layout, engineering rules).

## Global Constraints

- No domain models, no business logic, no `sessions`/`tariffs`/etc. tables — that is stage 2. The only migration in this stage is an empty baseline.
- Python 3.12 exactly, dependencies managed by `uv` with a committed lock file.
- `web/` uses `npm`.
- `api`, `worker`, `bot` are separate OS processes — never start the scheduler inside the FastAPI process.
- Cross-process communication will go through Postgres `LISTEN/NOTIFY` (stage 2+); nothing to build for that yet.
- Timezone `Asia/Bishkek` explicit wherever a schedule exists (the worker's heartbeat job).
- Secrets in `.env`, never committed; `.env.example` stays current.
- No CI in this stage (explicitly deferred by the project owner) — local commands only.
- Repository layout must match `CLAUDE.md`:
  ```
  core/            FastAPI app
    domain/        pure business logic — NO I/O, no DB, no network
    db/             models, session, alembic/
    services/       use cases: sessions, payments, business days, bar
    plugs/          PlugDriver interface + drivers (manual, tapo/shelly, fake)
    api/            routes, schemas, websocket
    worker/         APScheduler jobs
  bot/             aiogram bot
  web/             React app
  docs/
  ```
  `agent/` is phase 2 — do not create it in this stage.
- Commit messages: English, imperative mood, one logical change per commit, no AI attribution/co-author lines (per `CLAUDE.md` and project convention).

---

### Task 1: Repository skeleton, gitignore, env template

**Files:**
- Create: `.gitignore`
- Create: `.env.example`
- Create: `core/__init__.py`
- Create: `core/domain/__init__.py`
- Create: `core/services/__init__.py`
- Create: `core/plugs/__init__.py`
- Create: `core/api/__init__.py`
- Create: `core/db/__init__.py`
- Create: `core/worker/__init__.py`
- Create: `bot/__init__.py`

**Interfaces:**
- Produces: the directory layout every later task writes into. `core.domain`, `core.services`, `core.plugs` are empty packages — stage 2 fills them.

- [ ] **Step 1: Create the directories with empty `__init__.py` markers**

```bash
mkdir -p core/domain core/services core/plugs core/api/routes core/db/alembic/versions core/worker bot
touch core/__init__.py core/domain/__init__.py core/services/__init__.py core/plugs/__init__.py core/api/__init__.py core/api/routes/__init__.py core/db/__init__.py core/worker/__init__.py bot/__init__.py
```

Give `core/domain/__init__.py`, `core/services/__init__.py`, `core/plugs/__init__.py` a one-line module docstring each, so an empty package doesn't look like an accident:

`core/domain/__init__.py`:
```python
"""Pure business logic. No I/O, no DB, no network. Filled in stage 2."""
```

`core/services/__init__.py`:
```python
"""Use-case orchestration: sessions, payments, business days, bar. Filled in stage 2."""
```

`core/plugs/__init__.py`:
```python
"""PlugDriver interface and drivers (manual, tapo/shelly, fake). Filled in stage 2."""
```

- [ ] **Step 2: Write `.gitignore`**

```
__pycache__/
*.pyc
.venv/
.env
node_modules/
web/dist/
web/src/types/api.ts
.pytest_cache/
.ruff_cache/
*.egg-info/
```

- [ ] **Step 3: Write `.env.example`**

```
# Postgres
POSTGRES_DB=psclub
POSTGRES_USER=psclub
POSTGRES_PASSWORD=psclub

# Core (used when running outside Docker, e.g. `uv run pytest`).
# Inside docker-compose this is overridden to point at the `db` service.
DATABASE_URL=postgresql+asyncpg://psclub:psclub@localhost:5432/psclub

# Telegram bot — leave empty in dev until you have a real bot from @BotFather.
# Without BOT_TOKEN the bot container starts and stays idle instead of crash-looping.
BOT_TOKEN=
OWNER_CHAT_ID=

TZ=Asia/Bishkek
```

- [ ] **Step 4: Verify the tree**

Run: `find core bot -type f`
Expected: the nine `__init__.py` files from Step 1, nothing else yet.

- [ ] **Step 5: Commit**

```bash
git add .gitignore .env.example core bot
git commit -m "chore: scaffold repository directory layout"
```

---

### Task 2: Python project setup with uv

**Files:**
- Create: `pyproject.toml`
- Create: `uv.lock` (generated)

**Interfaces:**
- Produces: the `uv run <cmd>` environment every later Python task depends on. Dependency groups: default (runtime) and `dev` (ruff, pytest, pytest-asyncio, httpx).

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "ps-club-system"
version = "0.1.0"
description = "PS-club session, cash desk and bar tracking"
requires-python = "==3.12.*"
dependencies = [
    "fastapi>=0.115,<0.116",
    "uvicorn[standard]>=0.31,<0.32",
    "pydantic-settings>=2.5,<3",
    "sqlalchemy[asyncio]>=2.0,<3",
    "asyncpg>=0.29,<0.30",
    "alembic>=1.13,<2",
    "apscheduler>=3.10,<4",
    "aiogram>=3.13,<4",
]

[dependency-groups]
dev = [
    "ruff>=0.6,<0.7",
    "pytest>=8.3,<9",
    "pytest-asyncio>=0.24,<0.25",
    "httpx>=0.27,<0.28",
]

[tool.uv]
package = false

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: Pin the Python version and sync**

```bash
uv python pin 3.12
uv sync
```

Expected: `uv` downloads Python 3.12 if not already available, creates `.venv/`, writes `uv.lock`.

- [ ] **Step 3: Verify**

Run: `uv run python -c "import fastapi, sqlalchemy, alembic, apscheduler, aiogram; print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add pyproject.toml uv.lock .python-version
git commit -m "chore: set up uv-managed Python 3.12 project"
```

---

### Task 3: FastAPI skeleton with a health endpoint

**Files:**
- Create: `core/config.py`
- Create: `core/api/main.py`
- Create: `core/api/routes/health.py`
- Test: `tests/test_health.py`

**Interfaces:**
- Produces: `core.config.settings` (a `Settings` instance every later task — worker, bot, alembic env — imports for `database_url`, `bot_token`, `owner_chat_id`, `timezone`). Produces: `core.api.main.app`, a FastAPI instance with `GET /api/health` → `{"status": "ok"}`.

- [ ] **Step 1: Write `core/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://psclub:psclub@localhost:5432/psclub"
    bot_token: str | None = None
    owner_chat_id: int | None = None
    timezone: str = "Asia/Bishkek"


settings = Settings()
```

`database_url` has a working default so `uv run pytest` works before a `.env` file exists; docker-compose overrides it via the `DATABASE_URL` environment variable.

- [ ] **Step 2: Write `core/api/routes/health.py`**

```python
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
```

- [ ] **Step 3: Write `core/api/main.py`**

```python
from fastapi import FastAPI

from core.api.routes.health import router as health_router


def create_app() -> FastAPI:
    app = FastAPI(title="PS Club API")
    app.include_router(health_router, prefix="/api")
    return app


app = create_app()
```

- [ ] **Step 4: Write the failing test — `tests/test_health.py`**

```python
import pytest
from httpx import ASGITransport, AsyncClient

from core.api.main import app


@pytest.mark.asyncio
async def test_health_returns_ok() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

- [ ] **Step 5: Run the test**

Run: `uv run pytest tests/test_health.py -v`
Expected: PASS (the implementation was written in Steps 1–3, so this confirms wiring, not TDD red/green — that's fine for a scaffold task).

- [ ] **Step 6: Run the dev server manually and check by hand**

```bash
uv run uvicorn core.api.main:app --reload
```

Run in another shell: `curl http://127.0.0.1:8000/api/health`
Expected: `{"status":"ok"}`. Stop the server (Ctrl+C) before continuing.

- [ ] **Step 7: Commit**

```bash
git add core/config.py core/api/main.py core/api/routes/health.py tests/test_health.py
git commit -m "feat: add FastAPI skeleton with health endpoint"
```

---

### Task 4: Database layer and Alembic baseline

**Files:**
- Create: `core/db/base.py`
- Create: `core/db/session.py`
- Create: `alembic.ini`
- Create: `core/db/alembic/env.py`
- Create: `core/db/alembic/script.py.mako`
- Create: `core/db/alembic/versions/` (baseline revision, generated)

**Interfaces:**
- Consumes: `core.config.settings.database_url` (Task 3).
- Produces: `core.db.base.Base` (the declarative base every stage-2 model will subclass), `core.db.session.async_session_factory` / `get_session()` (the session dependency stage-2 routes will use).

- [ ] **Step 1: Write `core/db/base.py`**

```python
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
```

- [ ] **Step 2: Write `core/db/session.py`**

```python
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.config import settings

engine = create_async_engine(settings.database_url, pool_pre_ping=True)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        yield session
```

- [ ] **Step 3: Write `alembic.ini` at the repo root**

```ini
[alembic]
script_location = core/db/alembic
prepend_sys_path = .

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

- [ ] **Step 4: Write `core/db/alembic/script.py.mako`**

```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

# revision identifiers, used by Alembic.
revision: str = ${repr(up_revision)}
down_revision: Union[str, None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

- [ ] **Step 5: Write `core/db/alembic/env.py`**

```python
import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from core.config import settings
from core.db.base import Base

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

config.set_main_option("sqlalchemy.url", settings.database_url)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_migrations_online() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    asyncio.run(run_migrations_online())
```

- [ ] **Step 6: Start Postgres so Alembic has something to talk to**

```bash
docker run --rm -d --name psclub-db-dev \
  -e POSTGRES_DB=psclub -e POSTGRES_USER=psclub -e POSTGRES_PASSWORD=psclub \
  -p 5432:5432 postgres:16-alpine
```

Wait a few seconds, then check: `docker exec psclub-db-dev pg_isready -U psclub` → expects `accepting connections`.

- [ ] **Step 7: Generate the baseline revision**

```bash
uv run alembic revision -m "baseline"
```

This creates a file under `core/db/alembic/versions/<hash>_baseline.py` with the standard header (Task boilerplate above) and empty `upgrade()`/`downgrade()` bodies — leave them as `pass`. There are no tables yet; this revision only proves Alembic is wired to Postgres correctly.

- [ ] **Step 8: Apply and verify**

```bash
uv run alembic upgrade head
uv run alembic current
```

Expected: `current` prints the baseline revision hash with `(head)`.

- [ ] **Step 9: Roll back and re-apply to prove downgrade works too**

```bash
uv run alembic downgrade base
uv run alembic upgrade head
```

Expected: both commands succeed with no errors.

- [ ] **Step 10: Stop the throwaway Postgres container**

```bash
docker stop psclub-db-dev
```

- [ ] **Step 11: Commit**

```bash
git add alembic.ini core/db
git commit -m "feat: add async SQLAlchemy setup and Alembic baseline migration"
```

---

### Task 5: Worker process skeleton

**Files:**
- Create: `core/worker/main.py`

**Interfaces:**
- Consumes: `core.config.settings.timezone` (Task 3).
- Produces: `core.worker.main.main()`, the entrypoint `docker-compose.yml` and `uv run python -m core.worker.main` will call. Stage 2 adds real APScheduler jobs (`plug_events` reminders, business-day reminders, backups) next to the heartbeat.

- [ ] **Step 1: Write `core/worker/main.py`**

```python
import logging
from datetime import datetime
from zoneinfo import ZoneInfo

from apscheduler.schedulers.blocking import BlockingScheduler

from core.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("worker")


def heartbeat() -> None:
    now = datetime.now(ZoneInfo(settings.timezone))
    logger.info("worker alive at %s", now.isoformat())


def main() -> None:
    scheduler = BlockingScheduler(timezone=ZoneInfo(settings.timezone))
    scheduler.add_job(heartbeat, "interval", seconds=30, id="heartbeat")
    logger.info("worker starting, timezone=%s", settings.timezone)
    scheduler.start()


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run it standalone and verify**

```bash
timeout 35 uv run python -m core.worker.main || true
```

Expected: a "worker starting" log line immediately, then at least one "worker alive" log line ~30s later, before the command is killed by `timeout`.

- [ ] **Step 3: Commit**

```bash
git add core/worker/main.py
git commit -m "feat: add worker process skeleton with APScheduler heartbeat"
```

---

### Task 6: Telegram bot skeleton

**Files:**
- Create: `bot/main.py`

**Interfaces:**
- Consumes: `core.config.settings.bot_token`, `core.config.settings.owner_chat_id` (Task 3).
- Produces: `bot.main.main()`, the entrypoint `docker-compose.yml` and `uv run python -m bot.main` will call. Per the project owner's decision, when `BOT_TOKEN` is unset the process must stay up and idle rather than exit or crash-loop.

- [ ] **Step 1: Write `bot/main.py`**

```python
import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.filters import Command
from aiogram.types import Message

from core.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("bot")

dp = Dispatcher()


@dp.message(Command("start"))
async def start_handler(message: Message) -> None:
    if message.chat.id != settings.owner_chat_id:
        return
    await message.answer("PS Club bot is running.")


async def run_polling() -> None:
    bot = Bot(token=settings.bot_token)  # type: ignore[arg-type]
    logger.info("bot starting polling")
    await dp.start_polling(bot)


async def wait_idle() -> None:
    logger.warning(
        "BOT_TOKEN is not set — bot is idle. "
        "Set BOT_TOKEN (and OWNER_CHAT_ID) in .env and restart to enable polling."
    )
    await asyncio.Event().wait()


def main() -> None:
    if settings.bot_token:
        asyncio.run(run_polling())
    else:
        asyncio.run(wait_idle())


if __name__ == "__main__":
    main()
```

The `chat.id != owner_chat_id` guard is the SPEC 3.7 rule ("answers only the owner's `chat_id`") — even in the skeleton, wire it correctly now so it's never forgotten later.

- [ ] **Step 2: Verify the idle path (no token, the default in `.env.example`)**

```bash
timeout 5 uv run python -m bot.main || true
```

Expected: the "BOT_TOKEN is not set — bot is idle" warning, then the process just waits until killed by `timeout` (exit code from the `timeout` kill, not a crash traceback).

- [ ] **Step 3: Commit**

```bash
git add bot/main.py
git commit -m "feat: add Telegram bot skeleton with owner-only guard"
```

---

### Task 7: Docker images and Compose for core services

**Files:**
- Create: `docker/core.Dockerfile`
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: `pyproject.toml`/`uv.lock` (Task 2), `core.api.main:app` (Task 3), `core.worker.main` (Task 5), `bot.main` (Task 6).
- Produces: the `db`, `api`, `worker`, `bot` services later tasks (and the frontend) depend on being reachable at `db:5432` / `api:8000` inside the compose network.

- [ ] **Step 1: Write `docker/core.Dockerfile`**

```dockerfile
FROM python:3.12-slim

RUN pip install --no-cache-dir uv

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-install-project

COPY . .

CMD ["uv", "run", "uvicorn", "core.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

`--no-install-project` at this layer means dependency install is cached separately from app code, so editing `core/` doesn't force a full `uv sync` rebuild.

- [ ] **Step 2: Write `docker-compose.yml`**

```yaml
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-psclub}
      POSTGRES_USER: ${POSTGRES_USER:-psclub}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-psclub}
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-psclub}"]
      interval: 5s
      timeout: 5s
      retries: 10

  api:
    build:
      context: .
      dockerfile: docker/core.Dockerfile
    command: sh -c "uv run alembic upgrade head && uv run uvicorn core.api.main:app --host 0.0.0.0 --port 8000 --reload"
    env_file: .env
    environment:
      DATABASE_URL: postgresql+asyncpg://${POSTGRES_USER:-psclub}:${POSTGRES_PASSWORD:-psclub}@db:5432/${POSTGRES_DB:-psclub}
    ports:
      - "8000:8000"
    volumes:
      - .:/app
    depends_on:
      db:
        condition: service_healthy

  worker:
    build:
      context: .
      dockerfile: docker/core.Dockerfile
    command: uv run python -m core.worker.main
    env_file: .env
    environment:
      DATABASE_URL: postgresql+asyncpg://${POSTGRES_USER:-psclub}:${POSTGRES_PASSWORD:-psclub}@db:5432/${POSTGRES_DB:-psclub}
    volumes:
      - .:/app
    depends_on:
      db:
        condition: service_healthy

  bot:
    build:
      context: .
      dockerfile: docker/core.Dockerfile
    command: uv run python -m bot.main
    env_file: .env
    environment:
      DATABASE_URL: postgresql+asyncpg://${POSTGRES_USER:-psclub}:${POSTGRES_PASSWORD:-psclub}@db:5432/${POSTGRES_DB:-psclub}
    volumes:
      - .:/app
    depends_on:
      db:
        condition: service_healthy

volumes:
  pgdata:
```

(The `web` service is added in Task 9, once `web/` exists — `docker compose build` would fail on a missing context right now.)

- [ ] **Step 3: Bring up the core stack**

```bash
cp .env.example .env
docker compose up --build -d db api worker bot
```

- [ ] **Step 4: Verify migrations ran and the API answers**

```bash
docker compose logs api --tail 20
curl http://localhost:8000/api/health
```

Expected: the `api` log shows `alembic` applying the baseline revision, then uvicorn's "Application startup complete"; curl returns `{"status":"ok"}`.

- [ ] **Step 5: Verify worker and bot didn't crash**

```bash
docker compose ps
docker compose logs worker --tail 10
docker compose logs bot --tail 10
```

Expected: all four services show `Up` (or `running`) in `docker compose ps`; the worker log shows a "worker alive" heartbeat within 30s; the bot log shows the "BOT_TOKEN is not set — bot is idle" warning and nothing after (no crash-loop restart count climbing).

- [ ] **Step 6: Tear down**

```bash
docker compose down
```

- [ ] **Step 7: Commit**

```bash
git add docker/core.Dockerfile docker-compose.yml
git commit -m "feat: add Docker Compose setup for db, api, worker and bot"
```

---

### Task 8: Frontend scaffold (Vite + React + TypeScript)

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/vite.config.ts`
- Create: `web/vitest.setup.ts`
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/App.tsx`
- Create: `web/src/index.css`
- Create: `web/src/lib/utils.ts`
- Create: `web/tailwind.config.ts`
- Create: `web/postcss.config.js`
- Create: `web/components.json`
- Create: `web/eslint.config.js`
- Test: `web/tests/App.test.tsx`

**Interfaces:**
- Consumes: nothing from Python — talks to the API only through the `/api/*` HTTP proxy configured in `vite.config.ts` (target `http://api:8000`, valid once this runs inside docker-compose per Task 9).
- Produces: `App` (default export of `web/src/App.tsx`), the component stage-3 screens will grow out of. `cn()` from `web/src/lib/utils.ts` and `web/components.json` are shadcn/ui's expected entry points for `npx shadcn add <component>` later.

- [ ] **Step 1: Write `web/package.json`**

```json
{
  "name": "web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "lint": "eslint .",
    "generate:types": "openapi-typescript http://localhost:8000/openapi.json -o src/types/api.ts"
  },
  "dependencies": {
    "@tanstack/react-query": "^5.59.0",
    "clsx": "^2.1.1",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "tailwind-merge": "^2.5.3"
  },
  "devDependencies": {
    "@eslint/js": "^9.12.0",
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@types/react": "^18.3.11",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.2",
    "autoprefixer": "^10.4.20",
    "eslint": "^9.12.0",
    "eslint-plugin-react-hooks": "^5.0.0",
    "eslint-plugin-react-refresh": "^0.4.12",
    "jsdom": "^25.0.1",
    "openapi-typescript": "^7.4.1",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.13",
    "typescript": "^5.6.2",
    "typescript-eslint": "^8.8.1",
    "vite": "^5.4.8",
    "vitest": "^2.1.2"
  }
}
```

- [ ] **Step 2: Write `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 3: Write `web/vite.config.ts`**

```ts
/// <reference types="vitest" />
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://api:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

- [ ] **Step 4: Write `web/vitest.setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Write `web/index.html`**

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PS Club</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Write `web/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 7: Write `web/tailwind.config.ts`**

```ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [],
} satisfies Config;
```

- [ ] **Step 8: Write `web/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 9: Write `web/src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 10: Write `web/components.json`**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

- [ ] **Step 11: Write `web/src/App.tsx`**

```tsx
import { useQuery } from "@tanstack/react-query";

async function fetchHealth(): Promise<{ status: string }> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    throw new Error(`API responded with ${res.status}`);
  }
  return res.json();
}

export default function App() {
  const { data, error, isLoading } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
  });

  return (
    <main className="p-8 font-sans">
      <h1 className="text-2xl font-bold">PS Club</h1>
      {isLoading && <p>Проверка соединения с API...</p>}
      {error && <p className="text-red-600">Нет связи с API: {error.message}</p>}
      {data && <p className="text-green-600">API отвечает: {data.status}</p>}
    </main>
  );
}
```

- [ ] **Step 12: Write `web/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 13: Write `web/eslint.config.js`**

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { window: "readonly", document: "readonly" },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
);
```

- [ ] **Step 14: Write the failing test — `web/tests/App.test.tsx`**

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";

describe("App", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: "ok" }),
      }),
    );
  });

  it("shows the API status once loaded", async () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(screen.getByText(/API отвечает: ok/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 15: Install and run**

```bash
cd web
npm install
npm run test
```

Expected: PASS.

- [ ] **Step 16: Lint and typecheck**

```bash
npm run lint
npx tsc -b --noEmit
```

Expected: both exit 0 with no errors.

- [ ] **Step 17: Smoke-test the dev server locally (before wiring Docker)**

```bash
npm run dev
```

Expected: Vite starts on `http://localhost:5173`. Opening it shows "PS Club" and (since there's no `api` container reachable from a bare `npm run dev` — the proxy target `http://api:8000` only resolves inside the compose network) "Нет связи с API: ...". That's expected here; Task 9 verifies the real end-to-end path through Docker Compose. Stop the server (Ctrl+C).

- [ ] **Step 18: Commit**

```bash
cd ..
git add web
git commit -m "feat: scaffold React/Vite/TypeScript frontend with health check"
```

---

### Task 9: Frontend Docker image, full Compose stack, end-to-end verification

**Files:**
- Create: `docker/web.Dockerfile`
- Modify: `docker-compose.yml` (add the `web` service)

**Interfaces:**
- Consumes: `web/package.json` (Task 8), the `api` service (Task 7).
- Produces: the fully running five-service stack that satisfies this stage's "done" criterion.

- [ ] **Step 1: Write `docker/web.Dockerfile`**

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
```

- [ ] **Step 2: Add the `web` service to `docker-compose.yml`**

Add this service alongside `db`/`api`/`worker`/`bot` (same file from Task 7):

```yaml
  web:
    build:
      context: ./web
      dockerfile: ../docker/web.Dockerfile
    command: npm run dev -- --host 0.0.0.0
    ports:
      - "5173:5173"
    volumes:
      - ./web:/app
      - /app/node_modules
    depends_on:
      - api
```

- [ ] **Step 3: Bring up the full stack from a clean state**

```bash
docker compose down -v
docker compose up --build -d
```

- [ ] **Step 4: Verify every service is healthy**

```bash
docker compose ps
```

Expected: `db`, `api`, `worker`, `bot`, `web` all `Up`/`running`, `db` shows `(healthy)`.

- [ ] **Step 5: Verify migrations applied against the compose Postgres**

```bash
docker compose exec db psql -U psclub -d psclub -c "select version_num from alembic_version;"
```

Expected: one row with the baseline revision hash.

- [ ] **Step 6: Verify the API**

```bash
curl http://localhost:8000/api/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 7: Verify the frontend reaches the API through the proxy**

Open `http://localhost:5173` in a browser (or `curl -s http://localhost:5173 | grep "PS Club"` for a headless check that the page at least served).
Expected in the browser: "PS Club" heading, then "API отвечает: ok" — this is the stage's core "done" criterion (frontend opens and gets a response from the API).

- [ ] **Step 8: Verify closing/reopening doesn't break anything (restart safety)**

```bash
docker compose restart api
sleep 3
curl http://localhost:8000/api/health
```

Expected: still `{"status":"ok"}` — confirms `api` restart re-runs `alembic upgrade head` idempotently (no error, no duplicate baseline).

- [ ] **Step 9: Tear down**

```bash
docker compose down
```

- [ ] **Step 10: Commit**

```bash
git add docker/web.Dockerfile docker-compose.yml
git commit -m "feat: add frontend container and wire full Docker Compose stack"
```

---

### Task 10: README and OpenAPI type-generation docs

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: every command introduced in Tasks 1–9 — this task's only job is to document them so `docker compose up` plus the README is enough for a new contributor.

- [ ] **Step 1: Write `README.md`**

```markdown
# PS Club System

Учёт сессий, кассы и бара для PS-клуба на 5–6 консолей PS5. Подробности — в
`docs/SPEC.md` (спецификация) и `docs/PLAN.md` (этапы разработки).

## Стек

- Backend: FastAPI, SQLAlchemy 2 (async), Alembic, PostgreSQL — `uv`, Python 3.12
- Worker: APScheduler 3, отдельный процесс (никогда не внутри FastAPI)
- Bot: aiogram, long polling, отвечает только владельцу клуба
- Frontend: React, Vite, TypeScript, TanStack Query, Tailwind/shadcn — `npm`

## Быстрый старт (Docker Compose)

    cp .env.example .env
    docker compose up --build

- API: http://localhost:8000/api/health
- Frontend: http://localhost:5173
- Postgres: localhost:5432 (пользователь/пароль из `.env`)

Миграции применяются автоматически при старте контейнера `api`.

Бот стартует без ошибок и без токена, но остаётся неактивным (см. лог: "BOT_TOKEN is
not set — bot is idle"). Чтобы включить polling — впишите `BOT_TOKEN` и
`OWNER_CHAT_ID` в `.env` и перезапустите контейнер: `docker compose up -d --build bot`.

## Разработка backend без Docker

    uv sync
    cp .env.example .env   # при необходимости поправьте DATABASE_URL
    # поднимите Postgres любым способом (docker run ... postgres:16-alpine, см. docs/superpowers/plans)
    uv run alembic upgrade head
    uv run uvicorn core.api.main:app --reload

## Разработка frontend

Frontend расчитан на запуск внутри Docker Compose — там же живёт прокси `/api` →
`api:8000`. Для локального `npm run dev` вне Compose прокси-таргет `http://api:8000`
резолвиться не будет; используйте `docker compose up web` либо поменяйте target в
`web/vite.config.ts` на `http://localhost:8000` на время локальной отладки.

    cd web
    npm install
    npm run dev

## Тесты и линтеры

    uv run pytest
    uv run ruff check .

    cd web
    npm run test
    npm run lint

## Генерация TypeScript-типов из OpenAPI

Требует запущенный API:

    docker compose up -d db api
    cd web
    npm run generate:types

Результат — `web/src/types/api.ts` (в git не коммитится, генерируется по мере
надобности после изменений схемы).

## Миграции

    uv run alembic revision -m "описание"
    uv run alembic upgrade head
    uv run alembic downgrade -1

## Переменные окружения

См. `.env.example`.

## Ветки

- `main` — прод.
- `dev` — разработка.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup, dev and test instructions"
```

---

### Task 11: Full-stage verification against the PLAN.md done-criterion

**Files:** none created — this task only runs and confirms.

**Interfaces:** consumes the entire stack from Tasks 1–10.

- [ ] **Step 1: Clean-slate full stack run**

```bash
docker compose down -v
docker compose up --build -d
```

- [ ] **Step 2: Confirm the exact PLAN.md criterion**

> «docker compose up поднимает пустое ядро с БД, миграции проходят, фронт открывается и получает ответ от API»

```bash
docker compose ps
docker compose exec db psql -U psclub -d psclub -c "select version_num from alembic_version;"
curl -s http://localhost:8000/api/health
curl -s http://localhost:5173 | grep -q "PS Club" && echo "frontend serves"
```

Expected: all five services `Up`, one alembic_version row, `{"status":"ok"}`, "frontend serves" printed. Then open `http://localhost:5173` in an actual browser and confirm "API отвечает: ok" is visible (the automated `curl` only proves the HTML shell loads, not that the client-side fetch to `/api/health` through the Vite proxy succeeds).

- [ ] **Step 3: Run every test and lint suite**

```bash
uv run pytest
uv run ruff check .
cd web && npm run test && npm run lint && npx tsc -b --noEmit && cd ..
```

Expected: all green.

- [ ] **Step 4: Tear down**

```bash
docker compose down
```

- [ ] **Step 5: No commit needed — this task only verifies.** If any check in Steps 2–3 failed, fix it in the relevant earlier task's files and re-run this task before moving on.

---

## Self-Review Notes

- **Spec coverage:** every PLAN.md stage-1 bullet has a task — monorepo layout (Task 1), Docker Compose for dev (Tasks 7, 9), Alembic + linters + pytest/vitest (Tasks 2, 4, 8), OpenAPI type generation (Task 10), `.env.example` + README (Tasks 1, 10). The stage's done-criterion is explicitly re-verified in Task 11.
- **Explicitly out of scope, confirmed against CLAUDE.md/SPEC.md:** domain models (`sessions`, `tariffs`, etc.), `PlugDriver` implementation, SQLAdmin, WebSocket, real bot commands beyond the owner-only guard, `agent/` package, CI. All deferred to stage 2 or later per `docs/PLAN.md`.
- **Type/name consistency check:** `core.config.settings` (Task 3) is the single settings object imported unchanged by `core/db/session.py`, `core/db/alembic/env.py`, `core/worker/main.py`, and `bot/main.py` — same attribute names (`database_url`, `timezone`, `bot_token`, `owner_chat_id`) throughout. `core.api.main:app` is the exact import string used in `core.Dockerfile`'s CMD and in `docker-compose.yml`'s `api` command. `core.db.base.Base` is defined once and imported by `alembic/env.py`; no model files exist yet so `target_metadata` is empty on purpose.
