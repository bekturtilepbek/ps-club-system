# Деплой и эксплуатация

Выбранный вариант — **гибрид**: ядро на VPS (DigitalOcean), в клубе только браузер на кассе.
Стек — `docker-compose.prod.yml` (отдельный файл, без dev-override). Схема:

    браузер ──HTTPS──▶ caddy ──▶ nginx(web) ──▶ api ──▶ db
                                                worker ─┘   backup ─▶ ./backups ─▶ облако
                                                bot ────────▶ Telegram

- `caddy` — единственный, кто слушает 80/443; сам получает сертификат Let's Encrypt.
- `nginx` отдаёт собранный фронт и проксирует `/api` (включая WebSocket) и `/admin`.
- `api` накатывает миграции при старте; `worker`, `bot`, `backup` ждут, пока он станет healthy.
- Все сервисы с `restart: unless-stopped`.

## 1. Сервер (DigitalOcean)

1. Дроплет: Ubuntu 24.04, регион Frankfurt (или другой европейский), **не меньше 2 ГБ памяти**
   (на 1 ГБ сборка образов может не уложиться; скрипт ниже добавляет swap, но 2 ГБ надёжнее).
   При создании добавить свой **SSH-ключ**.
2. В панели DigitalOcean → Networking → Firewalls: входящие TCP **22, 80, 443**, остальное
   закрыть, привязать к дроплету (на самом сервере то же делает `ufw`).
3. Подготовка сервера одной командой с вашего ПК (скрипт ставит Docker, обновления, swap,
   открывает только 22/80/443 и создаёт пользователя `deploy`):

       scp scripts/server-setup.sh root@<IP>:/tmp/
       ssh root@<IP> bash /tmp/server-setup.sh

4. Проверить вход под новым пользователем: `ssh deploy@<IP>` — должен пускать без пароля.
5. **Только после этого** закрыть вход по паролю и под root:

       ssh root@<IP> "sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/;s/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config && systemctl restart ssh"

   (если вход под `deploy` не работал, не делайте этот шаг: вы потеряете доступ к серверу).

## 2. Имя для сайта (без покупки домена)

Нужен адрес, на который Let's Encrypt выдаст сертификат. Бесплатно — DuckDNS:

1. Зайти на duckdns.org (вход через Google/GitHub), создать поддомен, например `psclub-bishkek`.
2. В поле *current ip* вписать IP сервера. Получится `psclub-bishkek.duckdns.org`.

Это значение пойдёт в `SITE_ADDRESS`. (IP сервера не меняется, пока вы не удалите сервер, так что
обновлять запись не придётся.) Сайт будет открыт из интернета — от подбора пароля защищает
ограничение попыток входа (5 неверных за 15 минут с одного адреса), поэтому пароль админа
должен быть длинным.

## 3. Первый запуск

Git-репозитория на сервере нет: код едет с вашего ПК одним коммитом, `scripts/deploy.sh`
упаковывает его (`git archive`), копирует по ssh и синхронизирует в `~/ps-club-system`
(файлы `.env`, `backups/` и `rclone/` на сервере не трогаются).

Сначала создать `.env` на сервере (один раз):

    ssh deploy@<IP>
    mkdir -p ~/ps-club-system && cd ~/ps-club-system
    # положите сюда .env.example любым способом, например с ПК:
    #   scp .env.example deploy@<IP>:~/ps-club-system/.env
    nano .env

Что заполнить в `.env`:

| Переменная | Значение |
|---|---|
| `POSTGRES_PASSWORD` | свой длинный пароль (в прод-стеке значения по умолчанию нет) |
| `ADMIN_PASSWORD_HASH` | `uv run python -m core.auth.password 'пароль'` (можно на своём ПК). **Значение в одинарных кавычках!** В хеше есть `$`, без кавычек Docker Compose его портит и войти будет нельзя |
| `SESSION_SECRET` | `python3 -c "import secrets; print(secrets.token_hex(32))"` |
| `SESSION_COOKIE_SECURE` | `true` |
| `SITE_ADDRESS` | `psclub-bishkek.duckdns.org` |
| `BOT_TOKEN` | токен от @BotFather |
| `BACKUP_REMOTE` | см. раздел 6 (можно заполнить позже) |

Запуск (с вашего ПК, из корня репозитория, на ветке/коммите, который выкатываете):

    scripts/deploy.sh deploy@<IP>

Первая сборка — несколько минут. Затем открыть `https://<ваше имя>`; сертификат выдаётся при
первом обращении, если порты 80/443 доступны и DuckDNS указывает на сервер. Предупреждений о
dev-секретах в `docker compose -f docker-compose.prod.yml logs api` (на сервере) быть не должно.

**Важно про Telegram-бота:** один токен нельзя опрашивать из двух мест. Пока на сервере запущен
бот, остановите локального (`docker compose stop bot` на ПК) или заведите для разработки
отдельного бота у @BotFather, иначе оба будут сбрасывать друг другу соединение.

## 4. Данные клуба (через `/admin`, seed на проде не запускается)

Зайти в `https://<имя>/admin` тем же паролем и внести:

- **Zone** — одна зона («Зал»).
- **Console** — все консоли (названия «PS5-1» … ; `plug_driver` = `manual`).
- **Tariff** — пакеты «1 час» 60 мин / 180 сом, «3 часа» 180 мин / 420, «5 часов» 300 мин / 600
  и «Открытое время» — 180 сом в час.
- **Product** — меню бара (название, цена, категория).
- **Параметры** — `grace_minutes` = `1` («Время на выбор игры»), `warn_minutes`, `planned_open`,
  `planned_close`, `owner_chat_id` (chat_id владельца), `day_reminder_threshold_minutes`,
  `day_reminder_interval_minutes`. Параметр выбирается из списка, у каждого есть подсказка,
  значение проверяется (минуты, время ЧЧ:ММ, число) — опечатку админка не пропустит.

Разделы админки называются по-русски: Тарифы, Товары бара, Консоли, Параметры, Зоны. Новые
записи по умолчанию «включены»; удалять ничего нельзя — только выключать (чтобы не портить
историю).

Потом бот: написать ему `/start`, команда `/hall` должна ответить только владельцу.

## 5. `/api/health` и мониторинг

Публичный (без логина).

| Поле | Смысл |
|---|---|
| `db` | база отвечает |
| `worker` | воркер писал пульс в БД за последние 2 минуты |
| `backup` | последний дамп моложе 3 часов |
| `status` | `ok` — всё в порядке; `degraded` — воркер или бэкап отстали; `down` — нет базы |

HTTP 200 при `ok` и `degraded`, 503 только при `down`, поэтому внешний монитор должен искать
в ответе **текст** `"status":"ok"`, а не смотреть на код.

**Алерты на телефон (UptimeRobot, бесплатно):** Add monitor → тип *Keyword*, URL
`https://<имя>/api/health`, слово `"status":"ok"`, *Alert when keyword does not exist*,
интервал 5 минут, контакт — ваш Telegram или e-mail. Так вы узнаете и про упавший сервер, и про
остановившийся воркер, и про устаревший бэкап.

## 6. Бэкапы

Сервис `backup` каждый час делает `pg_dump` в `./backups` на сервере (файлы
`psclub-ГГГГММДД-ЧЧММСС.sql.gz`), хранит `BACKUP_KEEP_DAYS` (14) дней. Это защита от ошибок, но
**не от потери сервера**, поэтому раз в день первая успешная копия уходит в облако через rclone
(`BACKUP_REMOTE`, хранится `BACKUP_REMOTE_KEEP_DAYS` = 60 дней). Если выгрузка упала, в логе
`offsite upload FAILED` и следующий часовой запуск повторяет попытку.

**Настроить облако один раз** (пример для Backblaze B2: создать bucket и *Application Key*;
для другого хранилища — другой тип в `rclone config`):

    mkdir -p rclone
    docker run --rm -it -v "$PWD/rclone:/config/rclone" \
      -e RCLONE_CONFIG=/config/rclone/rclone.conf rclone/rclone config
    # n (new remote) → имя: offsite → тип: b2 → account/key → остальное по умолчанию

Затем в `.env`: `BACKUP_REMOTE=offsite:имя-bucket` и
`docker compose -f docker-compose.prod.yml up -d backup`. Через час в логе
(`docker compose -f docker-compose.prod.yml logs backup`) должно появиться
`offsite upload ok`. Папка `rclone/` с ключами не коммитится. Дампы содержат выручку клуба —
bucket должен быть приватным.

**Восстановление** (проверено на пустой базе):

    docker compose -f docker-compose.prod.yml stop api worker bot
    docker compose -f docker-compose.prod.yml exec -T db dropdb -U psclub psclub
    docker compose -f docker-compose.prod.yml exec -T db createdb -U psclub psclub
    gunzip -c backups/psclub-ГГГГММДД-ЧЧММСС.sql.gz | \
      docker compose -f docker-compose.prod.yml exec -T db psql -U psclub -d psclub -v ON_ERROR_STOP=1
    docker compose -f docker-compose.prod.yml start api worker bot

Дамп из облака сначала скачать: `rclone copyto offsite:имя-bucket/<файл> backups/` (тем же
контейнером `rclone/rclone` с монтированием `rclone/` и `backups/`).

**Проверьте восстановление до начала пилота** и потом раз в неделю: восстановить свежий дамп в
отдельную базу (`createdb restore_test`) — хороший дамп это тот, который восстанавливается.

## 7. Обновление и откат

Если в релизе есть миграция базы, сначала снимите дамп на сервере:

    ssh deploy@<IP> "cd ps-club-system && docker compose -f docker-compose.prod.yml exec -T backup sh -c 'pg_dump --no-owner | gzip > /backups/psclub-before-update.sql.gz'"

Потом выкатка с ПК:

    scripts/deploy.sh deploy@<IP>            # текущий коммит
    scripts/deploy.sh deploy@<IP> <коммит>   # конкретный коммит или тег

Миграции применяются автоматически. Обновлять лучше вне рабочих часов клуба: на несколько секунд
перезапускается `api` (идущие сессии не страдают — остатки времени считаются из меток в БД, но
открытый экран на кассе переподключится). Какой коммит сейчас на сервере:
`ssh deploy@<IP> cat ps-club-system/.deployed-version`.

**Откат:** `scripts/deploy.sh deploy@<IP> <прошлый коммит>`. Если новая версия успела изменить
схему БД, откат кода сам схему не вернёт — тогда восстановить БД из `psclub-before-update`.

## 8. Касса и безопасность

- На ПК кассы нужен только браузер: открыть `https://<имя>`, добавить в закладки, лучше
  как ярлык/приложение на весь экран. Вход помнится 30 дней.
- Сайт доступен из интернета, но все данные закрыты логином; вход ограничен по числу попыток
  (после 5 неверных — пауза 15 минут, экран входа пишет об этом).
- Ограничение попыток хранится в памяти `api`: перезапуск его сбрасывает. Для кассы это нормально.
- Порт базы наружу не опубликован; наружу открыты только 22/80/443 (и только они разрешены в
  firewall DigitalOcean).
- Секреты только в `.env` на сервере (не коммитятся). Потеря `caddy_data` не страшна, но
  сертификат придётся выпускать заново.

## 9. Если когда-нибудь вернуться на ПК кассы

Код один и тот же: поставить Docker Desktop, отключить сон и гибернацию, автологин, в BIOS —
включение после пропадания питания, роутер и ПК на ИБП; `SITE_ADDRESS=:80`, а данные перенести
дампом и восстановлением (раздел 6).
