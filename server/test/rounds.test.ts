import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db.ts';
import { settleRound } from '../src/rounds.ts';
import { upsertUser } from '../src/users.ts';

function setup() {
  const db = openDb(':memory:');
  for (const id of [1, 2, 3]) upsertUser(db, { id, firstName: `И${id}`, lastName: null, username: null, photoUrl: null });
  return db;
}

const details = { blackjack: false, bust: false, doubles: 0, doublesWon: 0 };
const balances = (db: Db) =>
  Object.fromEntries(
    (db.prepare('SELECT id, balance FROM users ORDER BY id').all() as { id: number; balance: number }[]).map((u) => [u.id, u.balance]),
  );

describe('settleRound', () => {
  it('moves chips, records the round and returns the new balances', () => {
    const db = setup();
    const result = settleRound(db, 'TABLE001', 'blackjack', [
      { userId: 1, wagered: 100, net: 150, outcome: 'win', details: { ...details, blackjack: true } },
      { userId: 2, wagered: 200, net: -200, outcome: 'lose', details },
      { userId: 3, wagered: 50, net: 0, outcome: 'push', details },
    ]);

    expect([...result.entries()]).toEqual([[1, 1150], [2, 800], [3, 1000]]);
    expect(balances(db)).toEqual({ 1: 1150, 2: 800, 3: 1000 });

    expect(db.prepare('SELECT id, table_code, game FROM rounds').all()).toEqual([{ id: 1, table_code: 'TABLE001', game: 'blackjack' }]);
    expect(db.prepare('SELECT round_id, user_id, wagered, net, outcome, details FROM round_results ORDER BY user_id').all()).toEqual([
      { round_id: 1, user_id: 1, wagered: 100, net: 150, outcome: 'win', details: JSON.stringify({ ...details, blackjack: true }) },
      { round_id: 1, user_id: 2, wagered: 200, net: -200, outcome: 'lose', details: JSON.stringify(details) },
      { round_id: 1, user_id: 3, wagered: 50, net: 0, outcome: 'push', details: JSON.stringify(details) },
    ]);
    // В журнале — только реальные движения фишек.
    expect(db.prepare("SELECT user_id, game, amount, round_id FROM ledger WHERE type = 'round' ORDER BY user_id").all()).toEqual([
      { user_id: 1, game: 'blackjack', amount: 150, round_id: 1 },
      { user_id: 2, game: 'blackjack', amount: -200, round_id: 1 },
    ]);
  });

  it('changes nothing at all if any part of the round cannot be applied', () => {
    const db = setup();
    expect(() =>
      settleRound(db, 'TABLE001', 'blackjack', [
        { userId: 1, wagered: 100, net: 100, outcome: 'win', details },
        { userId: 2, wagered: 5000, net: -5000, outcome: 'lose', details },
      ]),
    ).toThrow();
    expect(balances(db)).toEqual({ 1: 1000, 2: 1000, 3: 1000 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM rounds').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM round_results').get()).toEqual({ n: 0 });
  });

  it('numbers rounds consecutively', () => {
    const db = setup();
    settleRound(db, 'TABLE001', 'blackjack', [{ userId: 1, wagered: 5, net: 5, outcome: 'win', details }]);
    settleRound(db, 'TABLE001', 'blackjack', [{ userId: 1, wagered: 5, net: -5, outcome: 'lose', details }]);
    expect(db.prepare('SELECT round_id, net FROM round_results ORDER BY round_id').all()).toEqual([
      { round_id: 1, net: 5 },
      { round_id: 2, net: -5 },
    ]);
  });
});
