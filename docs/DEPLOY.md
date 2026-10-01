# Деплой и эксплуатация

Прод-стек — `docker-compose.prod.yml` (отдельный файл, без dev-override). Код один для
локального варианта и гибрида; различается только место запуска и HTTPS.

## Первый запуск

1. `cp .env.example .env` и заполнить:
   - `POSTGRES_PASSWORD` — обязательно свой (в прод-стеке значения по умолчанию нет);
   - `ADMIN_PASSWORD_HASH` — `uv run python -m core.auth.password 'пароль'`;
   - `SESSION_SECRET` — `python -c "import secrets; print(secrets.token_hex(32))"`;
   - `BOT_TOKEN`; `owner_chat_id` потом вносится в `/admin` → Setting.
2. `docker compose -f docker-compose.prod.yml up -d --build`
3. Открыть `http://<адрес>:<WEB_PORT>` (по умолчанию порт 80).

Миграции накатывает контейнер `api` при старте; `worker`, `bot` и `backup` ждут,
пока он станет healthy. Все сервисы с `restart: unless-stopped`.

Обновление: `git pull && docker compose -f docker-compose.prod.yml up -d --build`.

## `/api/health`

Публичный (без логина), для мониторинга и для глаз.

| Поле | Смысл |
|---|---|
| `db` | база отвечает |
| `worker` | воркер писал пульс в БД за последние 2 минуты |
| `backup` | последний дамп моложе 3 часов |
| `status` | `ok` — всё в порядке; `degraded` — воркер или бэкап отстали; `down` — нет базы |

HTTP 200 при `ok` и `degraded`, 503 только при `down`. Для внешнего монитора
(UptimeRobot и т.п.) ищите в ответе `"status":"ok"`, а не код ответа.

## Бэкапы

Сервис `backup` каждый час делает `pg_dump` в `${BACKUP_HOST_DIR:-./backups}` на хосте
(файлы `psclub-ГГГГММДД-ЧЧММСС.sql.gz`), хранит `BACKUP_KEEP_DAYS` (14) дней.

**Вне машины.** Папка с дампами лежит на том же диске, что и база, — от поломки диска или
ПК кассы она не спасает. Раз в день дамп нужно уносить: либо скопировать вручную на флешку
или в облако, либо задать `BACKUP_UPLOAD_CMD` (команда получает путь к дампу как `$1`;
в образе `postgres:alpine` нет `rclone`/`scp` — образ придётся расширить). Что именно
использовать — зависит от решения «локальный / гибрид» (см. `OWNER_QUESTIONS.md`, вопрос 1).

**Восстановление** (проверено на пустой базе):

    docker compose -f docker-compose.prod.yml stop api worker bot
    docker compose -f docker-compose.prod.yml exec -T db dropdb -U psclub psclub
    docker compose -f docker-compose.prod.yml exec -T db createdb -U psclub psclub
    gunzip -c backups/psclub-ГГГГММДД-ЧЧММСС.sql.gz | \
      docker compose -f docker-compose.prod.yml exec -T db psql -U psclub -d psclub -v ON_ERROR_STOP=1
    docker compose -f docker-compose.prod.yml start api worker bot

Раз в неделю стоит проверять, что дамп восстанавливается (в отдельной базе
`createdb restore_test`), а не только что файл создаётся.

## Если ядро на ПК кассы

Отключить сон и гибернацию, автологин Windows, Docker Desktop в автозапуск, в BIOS —
включение после пропадания питания; роутер и ПК на ИБП (`SPEC.md`, раздел 8).

## Если гибрид (VPS)

Нужен HTTPS перед nginx (Caddy/Traefik/certbot — выбор на этапе деплоя), после этого
`SESSION_COOKIE_SECURE=true` в `.env`. nginx уже передаёт `X-Forwarded-Proto`,
а uvicorn запущен с `--proxy-headers`.
