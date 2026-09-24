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

## Тестовые данные для разработки

    uv run python -m core.db.seed

Создаёт одну зону, три консоли и тарифы-заглушки (цены не согласованы с
владельцем — см. `docs/OWNER_QUESTIONS.md`). Реальные цены правятся в
`/admin` (SQLAdmin), без изменения кода.

## Админка

`/admin` — SQLAdmin: зоны, консоли, тарифы, товары, настройки. Защищена тем же
паролем, что и вход, см. ниже.

## Вход

Один пароль на весь клуб — из `.env` (`ADMIN_PASSWORD_HASH`, dev-заглушка: `admin`).
Действует и на экране зала, и на `/admin` (SQLAdmin) — и это фактически один и тот
же вход: обе части сайта используют одну сессионную куку. Поэтому вход в одном месте
сразу даёт доступ к другому, а выход из любого (кнопка «Выйти» на экране зала или
«Logout» в SQLAdmin) разлогинивает и второе. Сессия держится 30 дней.

## Переменные окружения

См. `.env.example`.

## Ветки

- `main` — прод.
- `dev` — разработка.
