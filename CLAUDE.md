# CLAUDE.md

Working rules for this repository. Read before making changes.

Full context lives in `docs/`:
- `docs/SPEC.md` — features, architecture, data model, scenarios (Russian)
- `docs/PLAN.md` — stages and done criteria (Russian)
- `docs/OWNER_QUESTIONS.md` — open business decisions (Russian)

When a task touches behaviour described there, read the relevant section first. If the
code and the spec disagree, stop and ask — do not silently pick one.

## Project in one paragraph

Session, cash desk and bar tracking for a small PlayStation club (5–6 PS5) in Bishkek.
It replaces a paper notebook. Phase 1 works without any hardware: timers on screen, the
operator turns TVs off by hand. Phase 2 adds smart plugs that cut TV power when paid time
ends. Phase 3 is analytics. One location, one operator account.

## Git

- **Never add Claude as co-author.** No `Co-Authored-By:` trailer, no
  "Generated with Claude Code" line, no session links in commit messages or PR
  descriptions. Commits are authored by the repository owner only.
- Commit messages in English, imperative mood, short subject line.
- One logical change per commit.

## Skills

Several skills are installed. Before starting a task, check whether an installed skill
covers it (code review, testing strategy, debugging, documentation, architecture, etc.)
and use it when relevant.

## Language

- Code, identifiers, comments, commits: English.
- UI copy and docs: Russian.

## Current stage

Check `docs/PLAN.md` for the current stage. Do not build features from later stages
unless asked. Do not build anything listed under "Вне MVP" in `docs/SPEC.md`.

## Stack

- Backend: FastAPI, Pydantic v2, SQLAlchemy 2 (async), Alembic, PostgreSQL
- Background jobs: separate `worker` process, APScheduler 3, timezone `Asia/Bishkek`
- Bot: aiogram, long polling
- Frontend: React, Vite, TypeScript, TanStack Query, shadcn/ui
- Frontend types generated from the FastAPI OpenAPI schema (`openapi-typescript`)
- Settings UI for MVP: SQLAdmin
- Agent (phase 2): Python, asyncio, websockets
- Web server: nginx. Deployment: Docker Compose
- Package managers: `uv` for Python (lock file committed), `npm` for `web/`. Python 3.12

Do not add infrastructure (Redis, Celery, message brokers) without asking.

## Repository layout

```
core/            FastAPI app
  domain/        pure business logic — NO I/O, no DB, no network
  db/            models, session, alembic/
  services/      use cases: sessions, payments, business days, bar
  plugs/         PlugDriver interface + drivers (manual, tapo/shelly, fake)
  api/           routes, schemas, websocket
  worker/        APScheduler jobs
bot/             aiogram bot
agent/           phase 2
web/             React app
docs/
```

## Domain rules — do not break these

1. **Absolute timestamps for deadlines.** Segment ends are stored as timestamps, never
   as a "minutes remaining" counter. Remaining time is always derived:
   `end - now()`. This is what makes restarts safe.
2. **A session is made of segments.** Package segment = fixed duration and price.
   Open segment = no end, billed per minute. Every extension is a new segment.
3. **Switching to open time while a package is still running:** the open segment starts
   at the package's end, not at the moment of the click. Otherwise the guest pays twice.
4. **Grace period** (default 1 min per SPEC 3.2, configurable via `grace_minutes`) applies only at
   session start, never on extension. Leaving within the grace period cancels the session at no charge.
5. **Price snapshot on every segment and order.** Changing tariffs never rewrites history.
6. **Open time is per-minute**; the total is rounded to a whole som.
7. **Reports are per business day**, not per calendar date. A business day is opened and
   closed manually. Never auto-close a day.
8. **Tariffs belong to a zone.** One zone today; VIP rooms later are a new zone.
9. **Every manual override goes to `audit_log`**: free session, early stop, cancel,
   edit, tariff change.
10. **Cash and non-cash are always reported separately.** Payment methods: cash,
    transfer (a QR payment is a transfer).
11. **Plugs control the TV only, never the console.** Hard power loss corrupts the PS5.
12. **The plug layer is behind `PlugDriver`.** No vendor library types outside
    `core/plugs/` and `agent/`. Phase 1 uses the manual driver.
13. **DB is the source of truth, hardware follows.** The agent receives a full snapshot
    of desired state, not individual commands, and only switches a plug when desired and
    actual state differ.

## Engineering rules

- `domain/` is pure and covered by unit tests. Pricing, grace period, segment boundaries
  and rounding must be testable without a database.
- `api`, `worker`, `bot` are separate processes. Never run the scheduler inside the API
  process — with several uvicorn workers every job would run several times.
- Background jobs are idempotent: record the result in the DB so a rerun does nothing.
- Cross-process events go through Postgres `LISTEN/NOTIFY`.
- The Telegram bot answers only the owner's `chat_id`.
- Timezone `Asia/Bishkek` explicitly wherever something is scheduled or displayed.
- Secrets in `.env`, never committed. Keep `.env.example` up to date.
- Prefer fixing root causes over adding workarounds. If a fix is a workaround, say so.

## Before finishing a task

- Tests pass, linters clean.
- Migration added if models changed.
- Frontend types regenerated if the API schema changed.
- If the change affects behaviour described in `docs/SPEC.md`, point it out.
