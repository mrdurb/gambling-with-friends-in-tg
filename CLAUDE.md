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

## Устройство

Спецификации — `docs/superpowers/specs/` (первая версия с блэкджеком и отдельно рулетка); решения по этапам и отступления от неё — `docs/superpowers/plans/`.

- `shared/src/index.ts` — все общие типы, константы (лимиты, таймеры, реакции) и события сокета.
- `server/src/`: `auth.ts` (кто игрок), `wallet.ts` (единственное место, где меняется баланс; журнал `ledger`), `rounds.ts` (расчёт раунда одной транзакцией), `tables.ts` (столы в базе), `rooms.ts` (у кого какой стол открыт, выбор ведущего стола по `table.game`, свободный баланс игрока по всем столам — без сокетов и базы), `rooms/blackjack-table.ts` и `rooms/roulette-table.ts` (ведущие столов: фазы и таймеры своей игры; общий интерфейс — `rooms/host.ts`), `rooms/poker-table.ts` (ведущий стола покера), `games/blackjack.ts`, `games/roulette.ts` и `games/poker/` (правила как чистые машины состояний: блэкджек и покер — по номерам мест, рулетка — по игрокам; в покере одна раздача — один объект `PokerHand`, оценка комбинаций — `hand-rank.ts`), `realtime.ts` (Socket.IO поверх `rooms`, чат и реакции), `stats.ts` (общий рейтинг и статистика по каждой игре из `round_results` и `ledger`), `app.ts` (HTTP API).
- `client/src/`: `App.tsx` (экраны и переходы), `realtime.ts` (подключение и хук `useTable`), `screens/Table.tsx` (общая рамка стола: шапка, чат, служебные экраны; своя вёрстка в `table.css`), `screens/BlackjackTable.tsx`, `screens/RouletteTable.tsx` и `screens/PokerTable.tsx` (экраны игр), `components/Wheel.tsx` (колесо рулетки), остальные экраны — на `@telegram-apps/telegram-ui`.
- Баланс в базе меняется один раз за раздачу, при расчёте; ставки до этого живут только в памяти стола. Перезапуск сервера посреди раздачи её аннулирует.
- Чат и реакции не сохраняются нигде.
- В рулетке число определяется в начале вращения и сразу уходит клиентам (для анимации), а фишки начисляются в конце вращения. История чисел живёт в памяти стола.
- Покер: три режима (`nlh`, `pineapple` — «3-1», `short` — «6+») и блайнды хранятся в настройках стола (`tables.options`, `TableInfo.poker`). Стек не списывается с баланса, а резервируется (`stakeOf`); в базу уходит чистый результат каждой раздачи. Закрытые карты в общий снимок не попадают: игрок получает свои личным событием `poker:cards`.
- Игровые события сокета уходят ведущему стола как есть: `Rooms.action(игрок, имя события, аргументы)` → `TableHost.action`; аргументы проверяет ведущий, чужое событие — отказ `wrong_game`. Сидеть можно только за одним столом с местами (блэкджек и покер вместе).
- Новая игра: правила в `games/`, ведущий стола в `rooms/` (интерфейс `TableHost`) и его создание в `rooms.ts`, имена событий в `realtime.ts`, свой вид снимка в `TableSnapshot` (различаются по `kind`), события сокета, экран в `screens/`, функция статистики по `details`; добавить игру в `GAME_IDS`. Кошелёк, столы, чат, реакции и рейтинг менять не нужно.

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
