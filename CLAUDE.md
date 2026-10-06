# Казино с друзьями в Telegram (Mini App)

Постановка — в `PROMPT.md`. Документация Telegram — в `docs/telegram/` (см. `README.md` там; `official/` главнее остального; в `official/` подчёркивания экранированы: `chat\_instance`).

## Факты о платформе, нужные проекту

Источник, если не указано иное: `docs/telegram/official/webapps.md`.

- Mini App — обычная веб-страница, которую Telegram открывает во встроенном WebView. Она привязана к боту. Всё состояние и реалтайм — на нашем сервере, Telegram их не даёт.
- В проде URL приложения должен быть HTTPS (`official/api.md`, WebAppInfo). В тестовой среде Telegram допускается HTTP (раздел «Testing Mini Apps»; `tma-js/platform/creating-new-app.md`).
- Запуск из группового чата — только по прямой ссылке: `https://t.me/<bot>/<app>?startapp=<param>` или `https://t.me/<bot>?startapp=<param>` (main Mini App). Кнопки `web_app` (inline и клавиатурные) работают только в личном чате с ботом (`official/api.md`, InlineKeyboardButton / KeyboardButton).
- `startapp` приходит в приложение как `start_param` в initData и как GET-параметр `tgWebAppStartParam`.
- При запуске по прямой ссылке в initData есть `chat_type` и `chat_instance` (идентификатор чата, не chat_id). Доступа к самому чату нет: ни читать, ни писать сообщения, ни получить список участников.
- Кто игрок: `initData.user` (WebAppUser) — `id`, `first_name`, `last_name?`, `username?`, `photo_url?` (аватар отдаётся, только если позволяют настройки приватности — нужен запасной вариант).
- Данным с клиента верить нельзя: сервер получает строку `initData` и проверяет `hash` — HMAC-SHA256 от data-check-string с ключом HMAC-SHA256(bot_token, "WebAppData"); дополнительно проверять свежесть `auth_date` (раздел «Validating data received via the Mini App»; готовая реализация — `tma-js/packages/tma-js-init-data-node/validating.md`).
- Регистрация: бот через `/newbot` в @BotFather, приложение — `/newapp` (прямая ссылка `t.me/<bot>/<app>`) или настройка Main Mini App (`tma-js/platform/creating-new-app.md`).

## Команды

- `npm run dev` — сервер (:3000) и клиент (:5173) с перезапуском при изменениях. Нужен `.env` (образец — `.env.example`).
- `npm test` — тесты сервера (Vitest).
- `npm run typecheck` — проверка типов сервера и клиента.
- `npm run build -w client` — сборка клиента в `client/dist`.

Режим разработки: при `DEV_AUTH=1` в `.env` приложение открывается в обычном браузере как поддельный игрок: `http://localhost:5173/?devUser=<число>`. Разные числа в разных вкладках — разные игроки.

React зафиксирован на 18.x из-за `@telegram-apps/telegram-ui`.

## Деплой

- Push в `main` → GitHub Actions (`.github/workflows/ci.yml`): тесты → образ в `ghcr.io/mrdurb/gambling-with-friends-in-tg` → выкладка по SSH. Следить: `gh run watch`.
- Сервер: `root@129.101.113.9`, вход только по ключу. Всё в `/opt/casino`: `docker-compose.yml` и `Caddyfile` (копируются из `deploy/` при каждом деплое), `.env` (`BOT_TOKEN`, `DOMAIN`, `APP_LINK`; в репозитории его нет), `data/casino.db`, `backups/`.
- Адрес: `https://129.101.113.9.sslip.io`, приложение в Telegram: `t.me/megaloodkabot/loodkaroom`. При переезде на свой домен поменять `DOMAIN` в `/opt/casino/.env`, выполнить `docker compose up -d` и обновить URL приложения в @BotFather (`/myapps`).
- Логи: `ssh root@129.101.113.9 'cd /opt/casino && docker compose logs --tail 50 app'`.
- Копия базы: ежедневно в 04:15 по времени сервера, `/etc/cron.d/casino-backup`, хранится 7 дней.
- На сервере `DEV_AUTH` не задаётся.
- С машины разработчика часть новых подключений к серверу (SSH и HTTPS) обрывается; с самого сервера сайт отвечает стабильно. Команды по SSH стоит повторять при `Connection closed`.
