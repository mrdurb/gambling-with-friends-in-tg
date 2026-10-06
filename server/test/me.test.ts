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
