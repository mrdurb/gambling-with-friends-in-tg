# Казино в Telegram: этапы реализации и детальный план этапа 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести спецификацию до работающего приложения за семь этапов, каждый из которых заканчивается тем, что можно запустить и проверить руками; этот документ детально расписывает этап 1 (каркас, вход, лобби).

**Architecture:** Один репозиторий с тремя пакетами (`shared`, `server`, `client`). Сервер — один Node-процесс: HTTP API на Fastify, данные в SQLite, проверка подписи Telegram на каждом запросе. Клиент — React-приложение, которое ничего не решает само и показывает то, что прислал сервер.

**Tech Stack:** Node.js ≥ 24, TypeScript 7, Fastify 5, встроенный `node:sqlite`, `@tma.js/init-data-node` 2, Vitest 5, React 18, Vite 8, `@telegram-apps/telegram-ui` 2.1, `@tma.js/sdk-react` 3.

**Spec:** `docs/superpowers/specs/2026-10-07-casino-blackjack-design.md`

## Этапы

Детальный план пишется перед началом каждого этапа, потому что опирается на код предыдущих. Этап 1 расписан ниже.

| № | Этап | Что входит | Как проверить руками |
| --- | --- | --- | --- |
| 1 | Каркас, вход, лобби | Репозиторий, сервер с проверкой `initData`, игроки в базе, стартовые 1000 фишек, экран лобби, режим разработки с поддельными игроками | `npm run dev`, открыть `localhost:5173/?devUser=1` — лобби с именем и балансом 1000; `?devUser=2` — другой игрок; без параметра — «Откройте приложение из Telegram» |
| 2 | Деплой и CI/CD | Dockerfile, Docker Compose с Caddy, GitHub Actions (тесты → образ → выкладка по SSH), раздача клиента сервером, ежедневная копия базы, регистрация бота и приложения в @BotFather | Открыть ссылку `t.me/<бот>/<приложение>` в Telegram на телефоне — лобби со своим именем и аватаркой; push в `main` сам выкатывает изменение |
| 3 | Кошелёк и касса | Журнал операций, единая точка изменения баланса, экран кассы (быстрые суммы и своя сумма, лимит 100 000) | Взять фишки в кассе — баланс вырос и сохранился после перезапуска сервера |
| 4 | Столы и присутствие | Создание стола, ссылка-приглашение с `startapp`, «Мои столы», Socket.IO, места, сесть/встать, зрители, переподключение, один стол на игрока | Две вкладки с разными игроками: оба видят, кто сел и встал; ссылка из чата открывает сразу нужный стол |
| 5 | Блэкджек | Правила как чистая машина состояний с тестами, интерфейс `Game`, фазы и таймеры, ставки фишками, hit/stand/double/split, расчёт через кошелёк, пропуски и авто-вставание, выход посреди раздачи, уход в кассу при нуле | Сыграть несколько раздач вдвоём в двух вкладках, включая сплит, удвоение, блэкджек и истечение таймера |
| 6 | Чат и реакции | Чат стола без хранения, восемь реакций у аватарки на 3 секунды | Сообщение и реакция из одной вкладки видны в другой; после выхода и входа чат пуст |
| 7 | Рейтинг и статистика | Итоги раздач в базе, общий рейтинг, статистика игрока по блэкджеку | После нескольких раздач цифры в рейтинге и статистике сходятся с тем, что было за столом |

Этап 5 самый крупный; при написании его детального плана он может быть разделён на два (базовая раздача; удвоение, сплит и таймеры).

Этап 2 требует от владельца проекта покупки VPS и домена и создания бота; остальные этапы проверяются локально.

## Global Constraints

- Node.js ≥ 24: используется встроенный модуль `node:sqlite`, нативных зависимостей нет.
- React строго 18.x: `@telegram-apps/telegram-ui` 2.1.13 требует `react ^18.2.0`.
- Интерфейс только на русском.
- Новый игрок получает 1000 фишек (`START_CHIPS`), один раз.
- `initData` считается действительной 24 часа с `auth_date`.
- Клиенту нельзя верить: сервер определяет игрока только по проверенной подписи `initData`.
- Вход без подписи (`Authorization: dev <id>`) работает только при переменной окружения `DEV_AUTH=1` и никогда не включается в проде.
- Импорты между своими файлами пишутся с расширением `.ts`/`.tsx` (включён `allowImportingTsExtensions`).
- `@telegram-apps/telegram-ui` используется только на экранах лобби, кассы, рейтинга и статистики.

## Review Focus

Условия, которые спецификация подразумевает и которые вероятнее всего встретятся у живых игроков (для этапа 1):

1. У игрока в Telegram нет фамилии, username или аватарки — профиль создаётся, пустые поля приходят как `null`, вместо аватарки инициалы. Тест: `auth.test.ts` (первый тест, `lastName: null`), ручная проверка в задаче 3.
2. Игрок сменил имя или аватарку в Telegram — профиль обновляется, баланс не сбрасывается. Тест: `users.test.ts`, задача 2.
3. Telegram id больше 32 бит (у новых аккаунтов так и есть) — сохраняется и возвращается без искажения. Тест: `users.test.ts`, задача 2.
4. Аватарка есть, но не загрузилась (Telegram замедлен) — показываются инициалы. `Avatar` из telegram-ui делает это сам при ошибке загрузки, если передан `acronym`; ручная проверка в задаче 3.
5. Приложение открыто не из Telegram или с подделанной подписью — сервер отвечает 401, клиент показывает «Откройте приложение из Telegram». Тесты: `auth.test.ts`, `me.test.ts`; ручная проверка в задаче 3.

---

## Структура файлов этапа 1

```
package.json            — рабочие пространства и общие команды
tsconfig.base.json      — общие настройки TypeScript
.gitignore
.env.example
shared/
  package.json
  src/index.ts          — START_CHIPS и тип Me
server/
  package.json
  tsconfig.json
  src/db.ts             — открытие базы и схема
  src/auth.ts           — кто игрок: проверка initData и вход для разработки
  src/users.ts          — создание и обновление игрока
  src/app.ts            — HTTP-приложение и маршрут /api/me
  src/main.ts           — чтение окружения и запуск
  test/auth.test.ts
  test/users.test.ts
  test/me.test.ts
client/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/telegram.ts       — заголовок авторизации из Telegram или из ?devUser
  src/api.ts            — запросы к серверу
  src/App.tsx           — загрузка профиля и выбор экрана
  src/screens/Lobby.tsx — лобби
  src/main.tsx          — точка входа
```

---

### Task 1: Каркас репозитория и определение игрока по `initData`

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `.env.example`
- Create: `shared/package.json`, `shared/src/index.ts`
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/auth.ts`
- Test: `server/test/auth.test.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `@casino/shared`: `START_CHIPS: number`, `interface Me { id: number; firstName: string; lastName: string | null; username: string | null; photoUrl: string | null; balance: number }`
  - `server/src/auth.ts`: `interface TelegramUser { id; firstName; lastName; username; photoUrl }` (те же поля, что у `Me`, без `balance`), `interface AuthConfig { botToken: string; devAuth: boolean }`, `class AuthError extends Error`, `authenticate(header: string | undefined, config: AuthConfig): TelegramUser` — бросает `AuthError`.

- [ ] **Step 1: Закоммитить уже существующие материалы**

В репозитории ещё нет коммитов. Сначала `.gitignore`:

```
node_modules/
dist/
.env
*.db
*.db-shm
*.db-wal
```

```bash
git add .gitignore PROMPT.md CLAUDE.md docs
git commit -m "docs: постановка, спецификация, план и копия документации Telegram"
```

- [ ] **Step 2: Создать корневые файлы и пакет `shared`**

`package.json`:

```json
{
  "name": "casino",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "workspaces": ["shared", "server", "client"],
  "scripts": {
    "dev": "concurrently -n server,client \"npm run dev -w server\" \"npm run dev -w client\"",
    "test": "npm test -w server",
    "typecheck": "npm run typecheck -w server && npm run typecheck -w client"
  },
  "devDependencies": {
    "concurrently": "^10.0.5",
    "typescript": "^7.0.2"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true
  }
}
```

`.env.example`:

```
# Токен бота из @BotFather. Нужен для проверки подписи initData.
BOT_TOKEN=
# 1 — разрешить вход без Telegram (Authorization: dev <id>). Только для разработки.
DEV_AUTH=1
# Путь к файлу базы.
DB_PATH=casino.db
PORT=3000
```

`shared/package.json`:

```json
{
  "name": "@casino/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": "./src/index.ts"
}
```

`shared/src/index.ts`:

```ts
export const START_CHIPS = 1000;

export interface Me {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  balance: number;
}
```

- [ ] **Step 3: Создать пакет `server` без кода**

`server/package.json`:

```json
{
  "name": "@casino/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch --env-file-if-exists=../.env src/main.ts",
    "test": "vitest run",
    "typecheck": "tsc -p ."
  },
  "dependencies": {
    "@casino/shared": "*",
    "@tma.js/init-data-node": "^2.0.8",
    "fastify": "^5.12.5",
    "tsx": "^4.23.15"
  },
  "devDependencies": {
    "@types/node": "^24.19.1",
    "vitest": "^5.0.3"
  }
}
```

`server/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "test"]
}
```

Пакета `client` ещё нет, поэтому на этом шаге временно уберите `"client"` из `workspaces` в корневом `package.json` (вернётся в задаче 3) и из скрипта `typecheck` (оставьте `npm run typecheck -w server`).

Run: `npm install`
Expected: установка без ошибок, появился `package-lock.json`.

- [ ] **Step 4: Написать падающий тест**

`server/test/auth.test.ts`:

```ts
import { sign } from '@tma.js/init-data-node';
import { describe, expect, it } from 'vitest';
import { AuthError, authenticate } from '../src/auth.ts';

const botToken = '123456:TEST-TOKEN';
const prod = { botToken, devAuth: false };

function initData(authDate: Date, token = botToken): string {
  return sign(
    { user: { id: 42, first_name: 'Стас', username: 'stas', photo_url: 'https://t.me/i/userpic/320/stas.jpg' } },
    token,
    authDate,
  );
}

describe('authenticate', () => {
  it('returns the user from correctly signed init data', () => {
    expect(authenticate(`tma ${initData(new Date())}`, prod)).toEqual({
      id: 42,
      firstName: 'Стас',
      lastName: null,
      username: 'stas',
      photoUrl: 'https://t.me/i/userpic/320/stas.jpg',
    });
  });

  it('rejects init data signed with another bot token', () => {
    expect(() => authenticate(`tma ${initData(new Date(), '999:OTHER')}`, prod)).toThrow(AuthError);
  });

  it('rejects init data with a tampered user', () => {
    const tampered = initData(new Date()).replace('%22id%22%3A42', '%22id%22%3A43');
    expect(tampered).not.toBe(initData(new Date()));
    expect(() => authenticate(`tma ${tampered}`, prod)).toThrow(AuthError);
  });

  it('rejects init data older than 24 hours', () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(() => authenticate(`tma ${initData(old)}`, prod)).toThrow(AuthError);
  });

  it('rejects a missing or malformed header', () => {
    expect(() => authenticate(undefined, prod)).toThrow(AuthError);
    expect(() => authenticate('tma', prod)).toThrow(AuthError);
    expect(() => authenticate('Bearer abc', prod)).toThrow(AuthError);
  });

  it('accepts dev users only when dev auth is on', () => {
    expect(authenticate('dev 7', { botToken: '', devAuth: true })).toMatchObject({ id: 7, firstName: 'Игрок 7' });
    expect(() => authenticate('dev 7', prod)).toThrow(AuthError);
    expect(() => authenticate('dev abc', { botToken: '', devAuth: true })).toThrow(AuthError);
  });
});
```

- [ ] **Step 5: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL, не найден модуль `../src/auth.ts`.

- [ ] **Step 6: Написать реализацию**

`server/src/auth.ts`:

```ts
import { parse, validate } from '@tma.js/init-data-node';

export interface TelegramUser {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

export interface AuthConfig {
  botToken: string;
  devAuth: boolean;
}

export class AuthError extends Error {}

const INIT_DATA_TTL_SECONDS = 24 * 60 * 60;

export function authenticate(header: string | undefined, config: AuthConfig): TelegramUser {
  const [type, data = ''] = (header ?? '').split(' ');

  if (type === 'dev' && config.devAuth) {
    const id = Number(data);
    if (!Number.isSafeInteger(id) || id <= 0) throw new AuthError('bad dev user id');
    return { id, firstName: `Игрок ${id}`, lastName: null, username: null, photoUrl: null };
  }

  if (type === 'tma') {
    let user;
    try {
      validate(data, config.botToken, { expiresIn: INIT_DATA_TTL_SECONDS });
      user = parse(data).user;
    } catch {
      throw new AuthError('invalid init data');
    }
    if (!user) throw new AuthError('init data has no user');
    return {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name ?? null,
      username: user.username ?? null,
      photoUrl: user.photo_url ?? null,
    };
  }

  throw new AuthError('unsupported authorization');
}
```

- [ ] **Step 7: Убедиться, что тесты и проверка типов проходят**

Run: `npm test`
Expected: PASS, 6 тестов.

Run: `npm run typecheck`
Expected: без ошибок.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json .env.example shared server
git commit -m "feat: каркас репозитория и определение игрока по initData"
```

---

### Task 2: Игроки в базе и маршрут `/api/me`

**Files:**
- Create: `server/src/db.ts`, `server/src/users.ts`, `server/src/app.ts`, `server/src/main.ts`
- Test: `server/test/users.test.ts`, `server/test/me.test.ts`

**Interfaces:**
- Consumes: `authenticate`, `AuthError`, `AuthConfig`, `TelegramUser` из `server/src/auth.ts`; `START_CHIPS`, `Me` из `@casino/shared`.
- Produces:
  - `server/src/db.ts`: `type Db`, `openDb(path: string): Db` — открывает файл (или `':memory:'`) и создаёт таблицы.
  - `server/src/users.ts`: `upsertUser(db: Db, user: TelegramUser): Me`.
  - `server/src/app.ts`: `buildApp(db: Db, authConfig: AuthConfig): FastifyInstance`.
  - HTTP: `GET /api/me` → `200` с `Me` либо `401 {"error":"unauthorized"}`.

- [ ] **Step 1: Написать падающие тесты**

`server/test/users.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TelegramUser } from '../src/auth.ts';
import { openDb } from '../src/db.ts';
import { upsertUser } from '../src/users.ts';

const stas: TelegramUser = { id: 42, firstName: 'Стас', lastName: null, username: 'stas', photoUrl: null };

describe('upsertUser', () => {
  it('updates the profile from Telegram but keeps the balance', () => {
    const db = openDb(':memory:');
    upsertUser(db, stas);
    db.prepare('UPDATE users SET balance = 250 WHERE id = 42').run();

    const renamed = { ...stas, firstName: 'Станислав', lastName: 'К.', photoUrl: 'https://t.me/i/userpic/320/new.jpg' };
    expect(upsertUser(db, renamed)).toEqual({ ...renamed, balance: 250 });
  });

  it('keeps Telegram ids above 32 bits exact', () => {
    const db = openDb(':memory:');
    const id = 5_000_000_000_123;
    expect(upsertUser(db, { ...stas, id }).id).toBe(id);
    expect(upsertUser(db, { ...stas, id }).balance).toBe(1000);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 1 });
  });
});
```

`server/test/me.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';

function setup() {
  const db = openDb(':memory:');
  return { db, app: buildApp(db, { botToken: '', devAuth: true }) };
}

describe('GET /api/me', () => {
  it('creates a new player with 1000 chips', async () => {
    const { app } = setup();
    const res = await app.inject({ url: '/api/me', headers: { authorization: 'dev 1' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      id: 1,
      firstName: 'Игрок 1',
      lastName: null,
      username: null,
      photoUrl: null,
      balance: 1000,
    });
  });

  it('does not grant start chips again on the next visit', async () => {
    const { app, db } = setup();
    await app.inject({ url: '/api/me', headers: { authorization: 'dev 1' } });
    db.prepare('UPDATE users SET balance = 250 WHERE id = 1').run();
    const res = await app.inject({ url: '/api/me', headers: { authorization: 'dev 1' } });
    expect(res.json().balance).toBe(250);
  });

  it('keeps players separate', async () => {
    const { app, db } = setup();
    await app.inject({ url: '/api/me', headers: { authorization: 'dev 1' } });
    db.prepare('UPDATE users SET balance = 250 WHERE id = 1').run();
    const res = await app.inject({ url: '/api/me', headers: { authorization: 'dev 2' } });
    expect(res.json()).toMatchObject({ id: 2, balance: 1000 });
  });

  it('answers 401 without valid authorization', async () => {
    const { app } = setup();
    const res = await app.inject({ url: '/api/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `npm test`
Expected: FAIL в `users.test.ts` и `me.test.ts` (не найдены `../src/db.ts`, `../src/app.ts`); `auth.test.ts` проходит.

- [ ] **Step 3: Написать реализацию**

`server/src/db.ts`:

```ts
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT,
      username TEXT,
      photo_url TEXT,
      balance INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}
```

`server/src/users.ts`:

```ts
import { START_CHIPS, type Me } from '@casino/shared';
import type { TelegramUser } from './auth.ts';
import type { Db } from './db.ts';

export function upsertUser(db: Db, user: TelegramUser): Me {
  db.prepare(`
    INSERT INTO users (id, first_name, last_name, username, photo_url, balance, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      username = excluded.username,
      photo_url = excluded.photo_url
  `).run(user.id, user.firstName, user.lastName, user.username, user.photoUrl, START_CHIPS, Date.now());

  const row = db.prepare('SELECT balance FROM users WHERE id = ?').get(user.id) as { balance: number };
  return { ...user, balance: row.balance };
}
```

`server/src/app.ts`:

```ts
import Fastify, { type FastifyInstance } from 'fastify';
import { AuthError, authenticate, type AuthConfig } from './auth.ts';
import type { Db } from './db.ts';
import { upsertUser } from './users.ts';

export function buildApp(db: Db, authConfig: AuthConfig): FastifyInstance {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthError) return reply.code(401).send({ error: 'unauthorized' });
    app.log.error(error);
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/api/me', async (request) => {
    const user = authenticate(request.headers.authorization, authConfig);
    return upsertUser(db, user);
  });

  return app;
}
```

`server/src/main.ts`:

```ts
import { buildApp } from './app.ts';
import { openDb } from './db.ts';

const botToken = process.env.BOT_TOKEN ?? '';
const devAuth = process.env.DEV_AUTH === '1';
if (!botToken && !devAuth) throw new Error('BOT_TOKEN is required unless DEV_AUTH=1');

const db = openDb(process.env.DB_PATH ?? 'casino.db');
const app = buildApp(db, { botToken, devAuth });
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
console.log(`server listening on :${port}${devAuth ? ' (DEV_AUTH on)' : ''}`);
```

- [ ] **Step 4: Убедиться, что тесты и проверка типов проходят**

Run: `npm test`
Expected: PASS, 3 файла, 12 тестов.

Run: `npm run typecheck`
Expected: без ошибок.

- [ ] **Step 5: Проверить запуск сервера**

```bash
cp .env.example .env
npm run dev -w server
```

Expected: в консоли `server listening on :3000 (DEV_AUTH on)`.

В другом терминале:

```bash
curl -s -H 'Authorization: dev 1' http://localhost:3000/api/me
curl -s -w ' [%{http_code}]\n' http://localhost:3000/api/me
```

Expected: `{"id":1,"firstName":"Игрок 1","lastName":null,"username":null,"photoUrl":null,"balance":1000}` и `{"error":"unauthorized"} [401]`. Остановить сервер (Ctrl+C).

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat: игроки в базе и маршрут /api/me со стартовыми фишками"
```

---

### Task 3: Клиент и экран лобби

**Files:**
- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`
- Create: `client/src/telegram.ts`, `client/src/api.ts`, `client/src/App.tsx`, `client/src/screens/Lobby.tsx`, `client/src/main.tsx`
- Modify: `package.json` (вернуть `"client"` в `workspaces` и в скрипт `typecheck`)
- Modify: `CLAUDE.md` (добавить раздел с командами)

**Interfaces:**
- Consumes: `GET /api/me` → `Me` или 401; тип `Me` из `@casino/shared`.
- Produces:
  - `client/src/telegram.ts`: `getAuthHeader(): string | null` — значение заголовка `Authorization` (`tma <initData>` в Telegram, `dev <id>` при `?devUser=<id>` в режиме разработки) или `null`.
  - `client/src/api.ts`: `class UnauthorizedError extends Error`, `fetchMe(): Promise<Me>`. Следующие этапы добавляют запросы сюда же.
  - `client/src/screens/Lobby.tsx`: `Lobby({ me }: { me: Me })`.

- [ ] **Step 1: Создать пакет `client`**

В корневом `package.json` вернуть:

```json
"workspaces": ["shared", "server", "client"],
```

```json
"typecheck": "npm run typecheck -w server && npm run typecheck -w client"
```

`client/package.json`:

```json
{
  "name": "@casino/client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "typecheck": "tsc -p ."
  },
  "dependencies": {
    "@casino/shared": "*",
    "@telegram-apps/telegram-ui": "^2.1.13",
    "@tma.js/sdk-react": "^3.0.23",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.31",
    "@types/react-dom": "^18.3.7",
    "@vitejs/plugin-react": "^6.1.2",
    "vite": "^8.3.3"
  }
}
```

`client/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

`client/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:3000' },
  },
});
```

`client/index.html`:

```html
<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <title>Казино</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Run: `npm install`
Expected: установка без ошибок.

- [ ] **Step 2: Написать связь с Telegram и сервером**

`client/src/telegram.ts`:

```ts
import { retrieveRawInitData } from '@tma.js/sdk-react';

// Значение заголовка Authorization или null, если приложение открыто не из Telegram.
export function getAuthHeader(): string | null {
  if (import.meta.env.DEV) {
    const devUser = new URLSearchParams(window.location.search).get('devUser');
    if (devUser) return `dev ${devUser}`;
  }
  try {
    const raw = retrieveRawInitData();
    return raw ? `tma ${raw}` : null;
  } catch {
    return null;
  }
}
```

`client/src/api.ts`:

```ts
import type { Me } from '@casino/shared';
import { getAuthHeader } from './telegram.ts';

export class UnauthorizedError extends Error {}

async function request<T>(path: string): Promise<T> {
  const auth = getAuthHeader();
  if (!auth) throw new UnauthorizedError();
  const res = await fetch(path, { headers: { Authorization: auth } });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchMe = () => request<Me>('/api/me');
```

- [ ] **Step 3: Написать экраны**

`client/src/screens/Lobby.tsx`:

```tsx
import type { Me } from '@casino/shared';
import { Avatar, Cell, List, Section } from '@telegram-apps/telegram-ui';

const GAMES = [
  { id: 'blackjack', title: 'Блэкджек', available: true },
  { id: 'poker', title: 'Покер', available: false },
  { id: 'roulette', title: 'Рулетка', available: false },
];

function initials(me: Me): string {
  return (me.firstName[0] ?? '') + (me.lastName?.[0] ?? '');
}

export function Lobby({ me }: { me: Me }) {
  const name = [me.firstName, me.lastName].filter(Boolean).join(' ');
  return (
    <List>
      <Section>
        <Cell
          before={<Avatar size={48} src={me.photoUrl ?? undefined} acronym={initials(me)} />}
          subtitle={`${me.balance.toLocaleString('ru-RU')} фишек`}
        >
          {name}
        </Cell>
      </Section>
      <Section header="Игры">
        {GAMES.map((game) => (
          <Cell key={game.id} disabled={!game.available} after={game.available ? undefined : 'Скоро'}>
            {game.title}
          </Cell>
        ))}
      </Section>
      <Section>
        <Cell>Касса</Cell>
        <Cell>Рейтинг</Cell>
      </Section>
    </List>
  );
}
```

Пункты «Блэкджек», «Касса» и «Рейтинг» на этом этапе никуда не ведут: переходы появляются на этапах 3, 4 и 7.

`client/src/App.tsx`:

```tsx
import type { Me } from '@casino/shared';
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState } from 'react';
import { fetchMe, UnauthorizedError } from './api.ts';
import { Lobby } from './screens/Lobby.tsx';

type State =
  | { status: 'loading' }
  | { status: 'ready'; me: Me }
  | { status: 'unauthorized' }
  | { status: 'error' };

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    fetchMe().then(
      (me) => setState({ status: 'ready', me }),
      (error) => setState({ status: error instanceof UnauthorizedError ? 'unauthorized' : 'error' }),
    );
  }, []);

  switch (state.status) {
    case 'loading':
      return (
        <Placeholder>
          <Spinner size="l" />
        </Placeholder>
      );
    case 'unauthorized':
      return <Placeholder header="Откройте приложение из Telegram" />;
    case 'error':
      return <Placeholder header="Не удалось загрузить" description="Проверьте соединение и откройте приложение заново" />;
    case 'ready':
      return <Lobby me={state.me} />;
  }
}
```

`client/src/main.tsx`:

```tsx
import '@telegram-apps/telegram-ui/dist/styles.css';
import { AppRoot } from '@telegram-apps/telegram-ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot>
      <App />
    </AppRoot>
  </StrictMode>,
);
```

- [ ] **Step 4: Проверка типов и сборка**

Run: `npm run typecheck`
Expected: без ошибок.

Run: `npm run build -w client`
Expected: `✓ built`, в `client/dist/` появились `index.html` и `assets/`.

- [ ] **Step 5: Ручная проверка в браузере**

Run: `npm run dev` (нужен `.env` из задачи 2 с `DEV_AUTH=1`)

Открыть по очереди и сверить:

| Адрес | Ожидается |
| --- | --- |
| `http://localhost:5173/?devUser=1` | Лобби: кружок с буквой «И», «Игрок 1», «1 000 фишек»; игры: Блэкджек, Покер «Скоро», Рулетка «Скоро»; Касса, Рейтинг |
| `http://localhost:5173/?devUser=2` | То же для «Игрок 2» |
| `http://localhost:5173/` | «Откройте приложение из Telegram» |
| `?devUser=1` при остановленном сервере | «Не удалось загрузить» |

Затем проверить, что баланс хранится в базе. Не останавливая сервер, изменить баланс игрока 1 напрямую:

```bash
sqlite3 server/casino.db "UPDATE users SET balance = 250 WHERE id = 1"
```

Обновить страницу `?devUser=1`.
Expected: «250 фишек» (повторный вход не выдаёт стартовые фишки заново).

Замечание: в режиме разработки сервер при каждом входе перезаписывает `photo_url` значением `null`, поэтому загрузку настоящей аватарки и подмену на инициалы при ошибке загрузки проверяем на этапе 2 в настоящем Telegram.

- [ ] **Step 6: Дописать команды в `CLAUDE.md`**

Добавить в конец `CLAUDE.md`:

```markdown
## Команды

- `npm run dev` — сервер (:3000) и клиент (:5173) с перезапуском при изменениях. Нужен `.env` (образец — `.env.example`).
- `npm test` — тесты сервера (Vitest).
- `npm run typecheck` — проверка типов сервера и клиента.
- `npm run build -w client` — сборка клиента в `client/dist`.

Режим разработки: при `DEV_AUTH=1` в `.env` приложение открывается в обычном браузере как поддельный игрок: `http://localhost:5173/?devUser=<число>`. Разные числа в разных вкладках — разные игроки.

React зафиксирован на 18.x из-за `@telegram-apps/telegram-ui`.
```

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json client CLAUDE.md
git commit -m "feat: клиент и экран лобби"
```

---

## Результат этапа 1

- `npm test` — 12 тестов проходят.
- `npm run dev` + `http://localhost:5173/?devUser=1` — лобби с именем и балансом.
- Следующий шаг — детальный план этапа 2 (деплой и CI/CD). К его началу нужны: VPS (1 ядро, 1 ГБ), домен, направленный на VPS, репозиторий на GitHub.
