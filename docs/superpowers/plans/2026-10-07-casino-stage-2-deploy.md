# Казино в Telegram: этап 2 — деплой и CI/CD

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Приложение открывается в Telegram по ссылке `t.me/<бот>/<приложение>`, а каждый push в `main` сам выкатывает новую версию на сервер.

**Architecture:** Сервер начинает раздавать собранный клиент сам, поэтому в проде один контейнер приложения. Перед ним контейнер Caddy, который получает сертификат и проксирует запросы. GitHub Actions прогоняет тесты, собирает образ, кладёт его в GitHub Container Registry и по SSH обновляет контейнеры на сервере.

**Tech Stack:** `@fastify/static` 10, Docker, Docker Compose, Caddy 2, GitHub Actions, GitHub Container Registry, `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-10-07-casino-blackjack-design.md` (раздел 6 «Деплой», раздел 3.2 — резервная копия)

## Исходные данные

| Что | Значение |
| --- | --- |
| Репозиторий | `github.com/mrdurb/gambling-with-friends-in-tg` (приватный), `origin` уже настроен, `main` уже запушен |
| Сервер | `root@129.101.113.9`, Ubuntu 24.04.5, 1 vCPU, 2 ГБ, Docker не установлен, порты 80 и 443 свободны |
| Домен | `129.101.113.9.sslip.io` (бесплатное имя, указывающее на IP сервера; резолвится) |
| Образ | `ghcr.io/mrdurb/gambling-with-friends-in-tg:latest` |
| Папка на сервере | `/opt/casino` |

## Что не проверено заранее

Код задачи 1 собран и проверен во временной папке (22 теста проходят). Остальное проверить заранее было нечем: локальный Docker не запущен, а установка чего-либо на сервер — уже выполнение плана. Поэтому у шагов с Docker и CI есть строки `Expected:`; при расхождении исполнитель чинит причину, а не подгоняет вывод. Конкретные риски:

- Сертификат для имени `sslip.io` может не выпуститься (общие лимиты Let's Encrypt на чужой домен). Запасной путь — купить домен и поменять `DOMAIN` в `/opt/casino/.env`.
- Скачивание образов `caddy` (Docker Hub) и `ghcr.io` с российского сервера может не работать.
- Сборка образа в `node:24-slim` с `npm ci` по нашему `package-lock.json`.

## Global Constraints

- Node.js ≥ 24; образ на `node:24-slim`.
- На сервере задаётся только `BOT_TOKEN`; `DEV_AUTH` там не задаётся никогда (сервер не запустится с обоими).
- Токен бота не должен попадать в репозиторий, в чат и в логи CI. Его вписывает владелец одной командой на сервере.
- База — файл `/opt/casino/data/casino.db` на сервере; передеплой её не трогает.
- Ежедневная копия базы на том же сервере, хранится 7 дней.
- Деплой запускается только из `main` и только после зелёных тестов.
- Импорты между своими файлами пишутся с расширением `.ts`.

## Review Focus

1. После выката Telegram показывает старую версию из кэша — `index.html` должен отдаваться с `max-age=0`. Тест: `static.test.ts`, задача 1.
2. Передеплой не должен стирать игроков и балансы. Проверка: задача 4, шаг 5.
3. После перезагрузки сервера приложение поднимается само. Проверка: задача 3, шаг 2 (`systemctl is-enabled docker`) и `restart: unless-stopped`.
4. Токен бота не вписан или вписан с ошибкой — контейнер не должен молча «работать». Проверка: задача 4, шаг 3 (понятная строка в логах).
5. Открытие по `http://` — перенаправление на `https://`. Проверка: задача 4, шаг 4.

---

## Структура файлов

```
server/src/app.ts            — изменить: необязательная раздача папки с клиентом
server/src/main.ts           — изменить: читать STATIC_DIR
server/test/static.test.ts   — создать
Dockerfile                   — создать: сборка клиента и образ сервера
.dockerignore                — создать
deploy/docker-compose.yml    — создать: контейнеры app и caddy
deploy/Caddyfile             — создать
.github/workflows/ci.yml     — создать: тесты и деплой
CLAUDE.md                    — изменить: раздел «Деплой»
```

---

### Task 1: Сервер раздаёт собранный клиент

**Files:**
- Modify: `server/src/app.ts`, `server/src/main.ts`, `server/package.json`
- Test: `server/test/static.test.ts`

**Interfaces:**
- Consumes: `buildApp(db, authConfig)` из этапа 1.
- Produces: `buildApp(db: Db, authConfig: AuthConfig, staticDir?: string): FastifyInstance`; переменная окружения `STATIC_DIR`.

- [ ] **Step 1: Создать ветку и поставить зависимость**

```bash
git checkout -b stage-2
npm install -w server @fastify/static@^10.1.5
```

Expected: в `server/package.json` появилась строка `"@fastify/static"`.

- [ ] **Step 2: Написать падающий тест**

`server/test/static.test.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'casino-static-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Казино</title>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  return buildApp(openDb(':memory:'), { botToken: '', devAuth: true }, dir);
}

describe('serving the built client', () => {
  it('serves index.html at the root, ignoring Telegram launch query parameters', async () => {
    const res = await setup().inject({ url: '/?tgWebAppStartParam=t_abc' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('<title>Казино</title>');
  });

  it('tells clients to revalidate index.html so a deploy is picked up', async () => {
    const res = await setup().inject({ url: '/' });
    expect(res.headers['cache-control']).toBe('public, max-age=0');
  });

  it('serves asset files', async () => {
    const res = await setup().inject({ url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('console.log(1)');
  });

  it('keeps the API working next to static files', async () => {
    const res = await setup().inject({ url: '/api/me', headers: { authorization: 'dev 1' } });
    expect(res.json()).toMatchObject({ id: 1, balance: 1000 });
  });

  it('does not serve files outside the client directory', async () => {
    const res = await setup().inject({ url: '/../package.json' });
    expect(res.statusCode).toBe(404);
  });

  it('serves no static files when no directory is given', async () => {
    const app = buildApp(openDb(':memory:'), { botToken: '', devAuth: true });
    expect((await app.inject({ url: '/' })).statusCode).toBe(404);
  });
});
```

- [ ] **Step 3: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL в `static.test.ts` — запросы к `/` и `/assets/app.js` возвращают 404 (третий аргумент `buildApp` пока игнорируется). Тесты «keeps the API working», «does not serve files outside» и «serves no static files» проходят уже сейчас — это ожидаемо, они закрепляют поведение, которое не должно сломаться.

- [ ] **Step 4: Написать реализацию**

`server/src/app.ts` целиком:

```ts
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { AuthError, authenticate, type AuthConfig } from './auth.ts';
import type { Db } from './db.ts';
import { upsertUser } from './users.ts';

// staticDir — папка с собранным клиентом; в разработке её нет, клиент раздаёт Vite.
export function buildApp(db: Db, authConfig: AuthConfig, staticDir?: string): FastifyInstance {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthError) return reply.code(401).send({ error: 'unauthorized' });
    console.error(error);
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/api/me', async (request) => {
    const user = authenticate(request.headers.authorization, authConfig);
    return upsertUser(db, user);
  });

  if (staticDir) app.register(fastifyStatic, { root: staticDir });

  return app;
}
```

В `server/src/main.ts` заменить строку `const app = buildApp(db, authConfig);` на:

```ts
const app = buildApp(db, authConfig, process.env.STATIC_DIR);
```

- [ ] **Step 5: Убедиться, что всё проходит**

Run: `npm test`
Expected: PASS, 5 файлов, 23 теста.

Run: `npm run typecheck`
Expected: без ошибок.

- [ ] **Step 6: Проверить руками, что один процесс отдаёт и страницу, и API**

```bash
npm run build -w client
cd server && DEV_AUTH=1 DB_PATH=:memory: STATIC_DIR=../client/dist PORT=3100 npx tsx src/main.ts
```

В другом терминале:

```bash
curl -s http://localhost:3100/ | head -3
curl -s -H 'Authorization: dev 1' http://localhost:3100/api/me
```

Expected: начало HTML со строкой `<html lang="ru">` и JSON игрока с `"balance":1000`. Остановить сервер.

- [ ] **Step 7: Commit**

```bash
git add package-lock.json server
git commit -m "feat: сервер раздаёт собранный клиент"
```

---

### Task 2: Образ, Compose, Caddy и CI

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `deploy/docker-compose.yml`, `deploy/Caddyfile`, `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: переменные `STATIC_DIR`, `DB_PATH`, `PORT`, `BOT_TOKEN` сервера; команды `npm run typecheck`, `npm test`, `npm run build -w client`.
- Produces: образ `ghcr.io/mrdurb/gambling-with-friends-in-tg:latest`; на сервере ожидаются `/opt/casino/.env` с `BOT_TOKEN` и `DOMAIN`; секреты репозитория `SSH_HOST`, `SSH_KEY`, `SSH_KNOWN_HOSTS`.

- [ ] **Step 1: Dockerfile и .dockerignore**

`.dockerignore`:

```
.git
.github
.superpowers
node_modules
**/node_modules
**/dist
docs
deploy
.env
*.db
*.db-shm
*.db-wal
```

`Dockerfile`:

```dockerfile
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY client client
RUN npm run build -w client

FROM node:24-slim
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/casino.db \
    STATIC_DIR=/app/client/dist
EXPOSE 3000
CMD ["node_modules/.bin/tsx", "server/src/main.ts"]
```

Сервер запускается через `tsx` прямо из исходников на TypeScript: отдельного шага компиляции сервера нет.

- [ ] **Step 2: Compose и Caddy**

`deploy/docker-compose.yml`:

```yaml
services:
  app:
    image: ghcr.io/mrdurb/gambling-with-friends-in-tg:latest
    restart: unless-stopped
    environment:
      BOT_TOKEN: ${BOT_TOKEN}
    volumes:
      - ./data:/data

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    environment:
      DOMAIN: ${DOMAIN}
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data

volumes:
  caddy_data:
```

Значения `${BOT_TOKEN}` и `${DOMAIN}` Compose берёт из файла `.env` в той же папке на сервере.

`deploy/Caddyfile`:

```
{$DOMAIN} {
	reverse_proxy app:3000
}
```

- [ ] **Step 3: Workflow**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: npm
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - run: npm run build -w client

  deploy:
    if: github.ref == 'refs/heads/main'
    needs: test
    runs-on: ubuntu-latest
    concurrency: deploy
    permissions:
      contents: read
      packages: write
    env:
      IMAGE: ghcr.io/mrdurb/gambling-with-friends-in-tg:latest
    steps:
      - uses: actions/checkout@v7
      - uses: docker/setup-buildx-action@v4
      - uses: docker/login-action@v4
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v7
        with:
          context: .
          push: true
          tags: ${{ env.IMAGE }}
      - name: Deploy
        env:
          SSH_HOST: ${{ secrets.SSH_HOST }}
          SSH_KEY: ${{ secrets.SSH_KEY }}
          SSH_KNOWN_HOSTS: ${{ secrets.SSH_KNOWN_HOSTS }}
          GHCR_USER: ${{ github.actor }}
          GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          install -m 700 -d ~/.ssh
          printf '%s\n' "$SSH_KEY" > ~/.ssh/id_ed25519
          chmod 600 ~/.ssh/id_ed25519
          printf '%s\n' "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts
          scp deploy/docker-compose.yml deploy/Caddyfile "root@$SSH_HOST:/opt/casino/"
          printf '%s' "$GHCR_TOKEN" | ssh "root@$SSH_HOST" "docker login ghcr.io -u '$GHCR_USER' --password-stdin"
          ssh "root@$SSH_HOST" "cd /opt/casino && docker compose pull && docker compose up -d && docker image prune -f; docker logout ghcr.io"
```

Образ приватный, поэтому сервер входит в реестр временным токеном задания: он действует только пока идёт деплой, и после скачивания сервер из реестра выходит.

- [ ] **Step 4: Commit и проверка тестового задания в CI**

```bash
git add Dockerfile .dockerignore deploy .github
git commit -m "ci: образ, compose с Caddy и workflow тестов и деплоя"
git push -u origin stage-2
gh run watch --exit-status
```

Expected: задание `test` зелёное; задание `deploy` пропущено (ветка не `main`). Push ветки — действие вовне: перед ним исполнитель получает подтверждение владельца.

---

### Task 3: Сервер, бот и секреты

**Files:** в репозитории ничего не меняется.

**Interfaces:**
- Consumes: `deploy/docker-compose.yml` из задачи 2 (ожидает `/opt/casino/.env`).
- Produces: готовый к деплою сервер; секреты `SSH_HOST`, `SSH_KEY`, `SSH_KNOWN_HOSTS` в репозитории; бот и приложение в Telegram.

- [ ] **Step 1: Предусловие — `gh` установлен и авторизован**

Run: `gh auth status`
Expected: `Logged in to github.com account mrdurb`. Если команды нет — владелец выполняет `brew install gh` и `gh auth login` (интерактивно, в своём терминале).

- [ ] **Step 2: Установить Docker и sqlite3 на сервер**

```bash
ssh root@129.101.113.9 'apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker.io docker-compose-v2 sqlite3 && systemctl enable --now docker && docker --version && docker compose version && systemctl is-enabled docker'
```

Expected: в конце три строки — версия Docker, версия Docker Compose (v2.x), `enabled`.

- [ ] **Step 3: Папка приложения и файл окружения**

```bash
ssh root@129.101.113.9 'install -d -m 700 /opt/casino /opt/casino/data /opt/casino/backups && printf "BOT_TOKEN=\nDOMAIN=129.101.113.9.sslip.io\n" > /opt/casino/.env && chmod 600 /opt/casino/.env && ls -la /opt/casino'
```

Expected: папки `data`, `backups` и файл `.env` с правами `-rw-------`.

- [ ] **Step 4: Ключ для деплоя и секреты репозитория**

```bash
KEY="$(mktemp -d)/deploy_key"
ssh-keygen -q -t ed25519 -N '' -C 'github-actions-deploy' -f "$KEY"
ssh root@129.101.113.9 'cat >> ~/.ssh/authorized_keys' < "$KEY.pub"
ssh -i "$KEY" -o IdentitiesOnly=yes -o BatchMode=yes root@129.101.113.9 'echo deploy-key-ok'
gh secret set SSH_KEY < "$KEY"
gh secret set SSH_HOST --body '129.101.113.9'
ssh-keyscan -t ed25519 129.101.113.9 2>/dev/null | gh secret set SSH_KNOWN_HOSTS
rm -f "$KEY" "$KEY.pub"
gh secret list
```

Expected: `deploy-key-ok`, затем в списке три секрета: `SSH_HOST`, `SSH_KEY`, `SSH_KNOWN_HOSTS`. Приватный ключ после этого остаётся только в секретах GitHub.

Ключ даёт GitHub Actions вход на сервер под `root`. Отдельного пользователя для деплоя не заводим: тот, кто управляет Docker, и так фактически имеет права `root`.

- [ ] **Step 5: Владелец создаёт бота и приложение**

Это делает владелец в Telegram, в чате с @BotFather:

1. `/newbot` → имя бота (любое) → username бота (должен заканчиваться на `bot`). BotFather пришлёт токен.
2. `/newapp` → выбрать этого бота → название → описание → картинка 640×360 (обязательна; подойдёт любая) → на вопрос про GIF ответить `/empty` → **Web App URL: `https://129.101.113.9.sslip.io`** → короткое имя приложения (латиницей, например `casino`).

Владелец вписывает токен на сервер сам, одной командой в своём терминале (токен не проходит через чат):

```bash
ssh root@129.101.113.9 "sed -i 's|^BOT_TOKEN=.*|BOT_TOKEN=СЮДА_ТОКЕН|' /opt/casino/.env"
```

Владелец сообщает исполнителю только ссылку вида `t.me/<username бота>/<короткое имя>`.

- [ ] **Step 6: Убедиться, что токен вписан, не показывая его**

```bash
ssh root@129.101.113.9 'grep -c "^BOT_TOKEN=[0-9]\+:[A-Za-z0-9_-]\{30,\}$" /opt/casino/.env'
```

Expected: `1`. Если `0` — токен не вписан или вписан с лишними символами; вернуться к шагу 5.

---

### Task 4: Первый деплой и проверка в Telegram

**Files:** в репозитории ничего не меняется (слияние `stage-2` в `main`).

**Interfaces:**
- Consumes: всё из задач 1–3.
- Produces: работающее приложение по адресу `https://129.101.113.9.sslip.io`.

- [ ] **Step 1: Слить в `main` и запушить**

```bash
git checkout main
git merge --ff-only stage-2
git push origin main
gh run watch --exit-status
```

Expected: оба задания зелёные — `test` и `deploy`. Push в `main` запускает выкладку на сервер: перед ним исполнитель получает подтверждение владельца.

- [ ] **Step 2: Контейнеры запущены**

```bash
ssh root@129.101.113.9 'cd /opt/casino && docker compose ps --format "{{.Service}} {{.State}}"'
```

Expected: `app running` и `caddy running`.

- [ ] **Step 3: Логи приложения**

```bash
ssh root@129.101.113.9 'cd /opt/casino && docker compose logs --tail 5 app'
```

Expected: `server listening on :3000` без приписки `(DEV_AUTH on)`. Если вместо этого `BOT_TOKEN is required unless DEV_AUTH=1` и контейнер перезапускается — токен не вписан (задача 3, шаг 5).

- [ ] **Step 4: HTTPS, страница, API, перенаправление**

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://129.101.113.9.sslip.io/
curl -s https://129.101.113.9.sslip.io/ | grep -o '<title>.*</title>'
curl -s -w ' [%{http_code}]\n' https://129.101.113.9.sslip.io/api/me
curl -s -w ' [%{http_code}]\n' -H 'Authorization: dev 1' https://129.101.113.9.sslip.io/api/me
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://129.101.113.9.sslip.io/
```

Expected, по строкам: `200`; `<title>Казино</title>`; `{"error":"unauthorized"} [401]`; `{"error":"unauthorized"} [401]` (вход для разработки в проде закрыт); `308 https://129.101.113.9.sslip.io/`.

Сертификат выпускается при первом запуске и может занять до минуты. Если через две минуты HTTPS не отвечает — смотреть `docker compose logs caddy`; при отказе Let's Encrypt для `sslip.io` остановиться и сообщить владельцу (нужен свой домен).

- [ ] **Step 5: Передеплой не трогает базу**

Владелец открывает ссылку `t.me/<бот>/<приложение>` в Telegram (после этого в базе есть игрок). Затем:

```bash
ssh root@129.101.113.9 'sqlite3 /opt/casino/data/casino.db "SELECT COUNT(*), MIN(created_at) FROM users"'
git commit --allow-empty -m "ci: проверка передеплоя" && git push origin main
gh run watch --exit-status
ssh root@129.101.113.9 'sqlite3 /opt/casino/data/casino.db "SELECT COUNT(*), MIN(created_at) FROM users"'
```

Expected: строка до и после передеплоя одинаковая (то же число игроков и то же время создания первого).

- [ ] **Step 6: Проверка владельцем в Telegram**

Владелец открывает ссылку `t.me/<бот>/<приложение>` на телефоне и подтверждает:

| Что | Ожидается |
| --- | --- |
| Экран | Лобби со своим именем из Telegram и «1 000 фишек» |
| Аватарка | Своя фотография; если в Telegram её нет или она не загрузилась — кружок с инициалами |
| Та же ссылка, отправленная в групповой чат | Открывается оттуда так же |
| Ссылка `https://129.101.113.9.sslip.io` в обычном браузере | «Откройте приложение из Telegram» |

---

### Task 5: Копии базы и раздел о деплое

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `/opt/casino/data/casino.db`, `/opt/casino/backups`.
- Produces: файл `/etc/cron.d/casino-backup` на сервере.

- [ ] **Step 1: Ежедневная копия**

```bash
ssh root@129.101.113.9 'cat > /etc/cron.d/casino-backup' <<'EOF'
15 4 * * * root sqlite3 /opt/casino/data/casino.db ".backup '/opt/casino/backups/casino-$(date +\%F).db'" && find /opt/casino/backups -name 'casino-*.db' -mtime +7 -delete
EOF
ssh root@129.101.113.9 'chmod 644 /etc/cron.d/casino-backup'
```

- [ ] **Step 2: Проверить, что копия создаётся и читается**

```bash
ssh root@129.101.113.9 'sqlite3 /opt/casino/data/casino.db ".backup /opt/casino/backups/casino-$(date +%F).db" && ls -la /opt/casino/backups && sqlite3 /opt/casino/backups/casino-$(date +%F).db "PRAGMA integrity_check; SELECT COUNT(*) FROM users"'
```

Expected: файл `casino-<сегодня>.db`, затем `ok` и число игроков, совпадающее с основной базой.

- [ ] **Step 3: Дописать раздел в `CLAUDE.md`**

Добавить в конец `CLAUDE.md`:

```markdown
## Деплой

- Push в `main` → GitHub Actions (`.github/workflows/ci.yml`): тесты → образ в `ghcr.io/mrdurb/gambling-with-friends-in-tg` → выкладка по SSH. Следить: `gh run watch`.
- Сервер: `root@129.101.113.9`, всё в `/opt/casino`: `docker-compose.yml` и `Caddyfile` (копируются из `deploy/` при каждом деплое), `.env` (`BOT_TOKEN`, `DOMAIN`; в репозитории его нет), `data/casino.db`, `backups/`.
- Адрес: `https://129.101.113.9.sslip.io`. При переезде на свой домен поменять `DOMAIN` в `/opt/casino/.env`, выполнить `docker compose up -d` и обновить URL приложения в @BotFather (`/myapps`).
- Логи: `ssh root@129.101.113.9 'cd /opt/casino && docker compose logs --tail 50 app'`.
- Копия базы: ежедневно в 04:15 по времени сервера, `/etc/cron.d/casino-backup`, хранится 7 дней.
- На сервере `DEV_AUTH` не задаётся.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: раздел о деплое"
git push origin main
gh run watch --exit-status
```

Expected: оба задания зелёные.

---

## Результат этапа 2

- Ссылка `t.me/<бот>/<приложение>` открывает лобби в Telegram с настоящим именем и аватаркой.
- Push в `main` выкатывает изменения без ручных действий.
- База переживает передеплой и копируется раз в сутки.
- Следующий шаг — детальный план этапа 3 (кошелёк и касса). В его начале закрыть отложенное с этапа 1: обработчик ошибок должен отдавать клиентские ошибки Fastify (400) как есть, а не как 500.
