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

  it('requires authorization', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'POST', url: '/api/tables' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/tables' })).statusCode).toBe(401);
  });
});
