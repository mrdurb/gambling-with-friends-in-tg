# Этап 3: кошелёк и касса

Спецификация: `docs/superpowers/specs/2026-10-07-casino-blackjack-design.md` (разделы 2.5, 3.1, 3.2).

## Решения

- Таблица `ledger` (журнал): игрок, вид (`start`, `cashier`, `round`), игра, сумма, раунд, время. Баланс меняется только через `server/src/wallet.ts`, каждая операция — строка журнала в той же транзакции.
- Стартовые 1000 фишек выдаются через кошелёк (строка `start`). Игрокам, созданным на этапе 1, строка `start` дописывается при открытии базы.
- `POST /api/cashier {amount}` → `{balance}`; сумма — целое от 1 до 100 000, иначе 400 `{error:"bad_amount"}`.
- Обработчик ошибок отдаёт клиентские ошибки Fastify (битый JSON и т. п.) как 4xx, а не 500 (отложено с этапа 1).
- Экран кассы: баланс, быстрые суммы 1000 / 5000 / 25 000 / 100 000, поле своей суммы. Возврат в лобби — кнопкой на экране (родная кнопка «Назад» Telegram не используется: её нельзя проверить вне Telegram).

## Файлы

- `shared/src/index.ts` — `CASHIER_MAX`, `CASHIER_PRESETS`.
- `server/src/db.ts` — таблица `ledger`, досыпка `start`, `transaction()`.
- `server/src/wallet.ts` — `post`, `withdrawFromCashier`, `WalletError`.
- `server/src/users.ts` — стартовая выдача через кошелёк.
- `server/src/app.ts` — маршрут кассы, обработка 4xx.
- `client/src/api.ts`, `client/src/App.tsx`, `client/src/screens/Lobby.tsx`, `client/src/screens/Cashier.tsx`.
- Тесты: `server/test/wallet.test.ts`, `server/test/cashier.test.ts`.

## Проверка руками

`npm run dev`, `?devUser=1`: Касса → 5000 → баланс 6 000; своя сумма 37 → 6 037; 0 и 100 001 отклоняются; после перезапуска сервера баланс тот же.
