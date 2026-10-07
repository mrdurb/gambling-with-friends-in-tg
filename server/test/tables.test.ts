import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';

function setup(appLink = '') {
  const app = buildApp(openDb(':memory:'), { botToken: '', devAuth: true }, { appLink });
  const call = (method: 'GET' | 'POST', url: string, user = 1) =>
    app.inject({ method, url, headers: { authorization: `dev ${user}` } });
  return { app, call };
}

describe('tables API', () => {
  it('creates a blackjack table named after its creator', async () => {
    const { call } = setup();
    const res = await call('POST', '/api/tables');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Стол игрока Игрок 1', game: 'blackjack', inviteLink: null });
    expect(res.json().code).toMatch(/^[A-Za-z0-9_-]{8}$/);
  });

  it('gives every table its own code', async () => {
    const { call } = setup();
    const codes = new Set<string>();
    for (let i = 0; i < 50; i++) codes.add((await call('POST', '/api/tables')).json().code);
    expect(codes.size).toBe(50);
  });

  it('builds the invite link from the app link', async () => {
    const { call } = setup('https://t.me/somebot/app');
    const table = (await call('POST', '/api/tables')).json();
    expect(table.inviteLink).toBe(`https://t.me/somebot/app?startapp=t_${table.code}`);
  });

  it('finds a table by code for any player and remembers the visit', async () => {
    const { call } = setup();
    const table = (await call('POST', '/api/tables', 1)).json();

    const found = await call('GET', `/api/tables/${table.code}`, 2);
    expect(found.json()).toEqual(table);
    expect((await call('GET', '/api/tables', 2)).json()).toEqual([table]);
  });

  it('answers 404 for an unknown or malformed code', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/tables/AAAAAAAA')).statusCode).toBe(404);
    expect((await call('GET', '/api/tables/x')).statusCode).toBe(404);
    expect((await call('GET', "/api/tables/a'%20OR%201=1")).statusCode).toBe(404);
  });

  it('lists only the tables a player created or visited, newest visit first, at most 10', async () => {
    const { call } = setup();
    const created: string[] = [];
    for (let i = 0; i < 12; i++) created.push((await call('POST', '/api/tables', 1)).json().code);
    await call('POST', '/api/tables', 2);

    await call('GET', `/api/tables/${created[0]}`, 1);
    const mine = (await call('GET', '/api/tables', 1)).json() as { code: string }[];
    expect(mine).toHaveLength(10);
    expect(mine[0]!.code).toBe(created[0]);
    expect(mine.every((t) => created.includes(t.code))).toBe(true);
  });

  it('creates a roulette table when asked, and a blackjack one by default', async () => {
    const { app } = setup();
    const create = (payload?: object) =>
      app.inject({ method: 'POST', url: '/api/tables', headers: { authorization: 'dev 1' }, payload });
    expect((await create({ game: 'roulette' })).json()).toMatchObject({ name: 'Рулетка игрока Игрок 1', game: 'roulette' });
    expect((await create({ game: 'blackjack' })).json()).toMatchObject({ name: 'Стол игрока Игрок 1', game: 'blackjack' });
    expect((await create({})).json()).toMatchObject({ game: 'blackjack' });
    expect((await create({ game: 'chess' })).statusCode).toBe(400);
    expect((await create({ game: 42 })).statusCode).toBe(400);
  });

  it('lists the tables of one game at a time, blackjack by default', async () => {
    const { app, call } = setup();
    const roulette = (
      await app.inject({ method: 'POST', url: '/api/tables', headers: { authorization: 'dev 1' }, payload: { game: 'roulette' } })
    ).json();
    const blackjack = (await call('POST', '/api/tables')).json();

    expect((await call('GET', '/api/tables?game=roulette')).json()).toEqual([roulette]);
    expect((await call('GET', '/api/tables?game=blackjack')).json()).toEqual([blackjack]);
    expect((await call('GET', '/api/tables')).json()).toEqual([blackjack]);
    expect((await call('GET', '/api/tables?game=chess')).statusCode).toBe(400);
  });

  it('creates poker tables of every mode and blind level, named after them', async () => {
    const { app } = setup();
    const create = (payload: object) =>
      app.inject({ method: 'POST', url: '/api/tables', headers: { authorization: 'dev 1' }, payload });

    expect((await create({ game: 'poker', mode: 'nlh', blinds: 10 })).json()).toMatchObject({
      name: 'Холдем 5/10 игрока Игрок 1',
      game: 'poker',
      poker: { mode: 'nlh', blinds: [5, 10] },
    });
    expect((await create({ game: 'poker', mode: 'pineapple', blinds: 50 })).json()).toMatchObject({
      name: 'Холдем 3-1 25/50 игрока Игрок 1',
      poker: { mode: 'pineapple', blinds: [25, 50] },
    });
    const short = (await create({ game: 'poker', mode: 'short', blinds: 200 })).json();
    expect(short).toMatchObject({ name: 'Холдем 6+ 100/200 игрока Игрок 1', poker: { mode: 'short', blinds: [100, 200] } });

    // Настройки переживают чтение из базы.
    const found = await app.inject({ url: `/api/tables/${short.code}`, headers: { authorization: 'dev 1' } });
    expect(found.json()).toEqual(short);
    const listed = await app.inject({ url: '/api/tables?game=poker', headers: { authorization: 'dev 1' } });
    expect(listed.json()).toHaveLength(3);
    expect(listed.json()[0]).toEqual(short);
  });

  it('refuses poker tables with an unknown mode or blind level', async () => {
    const { app } = setup();
    const create = (payload: object) =>
      app.inject({ method: 'POST', url: '/api/tables', headers: { authorization: 'dev 1' }, payload });
    expect((await create({ game: 'poker' })).statusCode).toBe(400);
    expect((await create({ game: 'poker', mode: 'omaha', blinds: 10 })).statusCode).toBe(400);
    expect((await create({ game: 'poker', mode: 'nlh', blinds: 7 })).statusCode).toBe(400);
    expect((await create({ game: 'poker', mode: 'nlh', blinds: '10' })).statusCode).toBe(400);
    expect((await create({ game: 'poker', mode: 'nlh' })).statusCode).toBe(400);
  });

  it('gives blackjack and roulette tables no poker options', async () => {
    const { app, call } = setup();
    expect((await call('POST', '/api/tables')).json().poker).toBeNull();
    const roulette = await app.inject({ method: 'POST', url: '/api/tables', headers: { authorization: 'dev 1' }, payload: { game: 'roulette' } });
    expect(roulette.json().poker).toBeNull();
  });

  it('requires authorization', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'POST', url: '/api/tables' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/tables' })).statusCode).toBe(401);
  });
});

describe('database upgrade', () => {
  it('opens a database created before tables had options', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'casino-'));
    const path = join(dir, 'old.db');
    const old = new DatabaseSync(path);
    old.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, first_name TEXT NOT NULL, last_name TEXT, username TEXT, photo_url TEXT,
        balance INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE tables (code TEXT PRIMARY KEY, game TEXT NOT NULL, name TEXT NOT NULL,
        created_by INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL);
      INSERT INTO users VALUES (1, 'Игрок 1', NULL, NULL, NULL, 1000, 1);
      INSERT INTO tables VALUES ('OLDTABLE', 'blackjack', 'Старый стол', 1, 1);
    `);
    old.close();

    const app = buildApp(openDb(path), { botToken: '', devAuth: true });
    const found = await app.inject({ url: '/api/tables/OLDTABLE', headers: { authorization: 'dev 1' } });
    expect(found.json()).toMatchObject({ name: 'Старый стол', game: 'blackjack', poker: null });
    // Повторное открытие колонку второй раз не добавляет.
    expect(() => openDb(path)).not.toThrow();
    rmSync(dir, { recursive: true });
  });
});
