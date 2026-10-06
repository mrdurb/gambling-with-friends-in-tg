import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';

function setup() {
  const db = openDb(':memory:');
  const app = buildApp(db, { botToken: '', devAuth: true });
  const cashier = (payload: unknown, user = 1) =>
    app.inject({ method: 'POST', url: '/api/cashier', headers: { authorization: `dev ${user}` }, payload: payload as object });
  return { db, app, cashier };
}

describe('POST /api/cashier', () => {
  it('gives chips and returns the new balance', async () => {
    const { app, cashier } = setup();
    const res = await cashier({ amount: 5000 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ balance: 6000 });
    const me = await app.inject({ url: '/api/me', headers: { authorization: 'dev 1' } });
    expect(me.json().balance).toBe(6000);
  });

  it('works for a player who has never opened the lobby', async () => {
    const { cashier } = setup();
    expect((await cashier({ amount: 10 }, 77)).json()).toEqual({ balance: 1010 });
  });

  it('keeps players separate', async () => {
    const { app, cashier } = setup();
    await cashier({ amount: 5000 }, 1);
    const other = await app.inject({ url: '/api/me', headers: { authorization: 'dev 2' } });
    expect(other.json().balance).toBe(1000);
  });

  it.each([{ amount: 0 }, { amount: 100_001 }, { amount: 1.5 }, { amount: '100' }, { amount: null }, {}])(
    'answers 400 for %j',
    async (payload) => {
      const { cashier } = setup();
      const res = await cashier(payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'bad_amount' });
    },
  );

  it('answers 400, not 500, for a malformed body', async () => {
    const { app } = setup();
    const res = await app.inject({
      method: 'POST',
      url: '/api/cashier',
      headers: { authorization: 'dev 1', 'content-type': 'application/json' },
      payload: '{"amount": ',
    });
    expect(res.statusCode).toBe(400);
  });

  it('answers 401 without authorization', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'POST', url: '/api/cashier', payload: { amount: 100 } });
    expect(res.statusCode).toBe(401);
  });
});
