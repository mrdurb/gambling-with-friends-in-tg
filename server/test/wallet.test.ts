import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { TelegramUser } from '../src/auth.ts';
import { openDb, type Db } from '../src/db.ts';
import { upsertUser } from '../src/users.ts';
import { post, WalletError, withdrawFromCashier } from '../src/wallet.ts';

const stas: TelegramUser = { id: 42, firstName: 'Стас', lastName: null, username: null, photoUrl: null };

function ledger(db: Db) {
  return db.prepare('SELECT user_id, type, game, amount, round_id FROM ledger ORDER BY id').all();
}

function balance(db: Db, id = 42) {
  return (db.prepare('SELECT balance FROM users WHERE id = ?').get(id) as { balance: number }).balance;
}

describe('start chips', () => {
  it('are recorded in the ledger once', () => {
    const db = openDb(':memory:');
    upsertUser(db, stas);
    upsertUser(db, stas);
    expect(ledger(db)).toEqual([{ user_id: 42, type: 'start', game: null, amount: 1000, round_id: null }]);
    expect(balance(db)).toBe(1000);
  });

  it('are backfilled for players created before the ledger existed', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'casino-db-')), 'casino.db');
    const old = openDb(file);
    old.prepare(
      "INSERT INTO users (id, first_name, balance, created_at) VALUES (7, 'Старый', 640, 111)",
    ).run();
    old.close();

    const db = openDb(file);
    expect(ledger(db)).toEqual([{ user_id: 7, type: 'start', game: null, amount: 1000, round_id: null }]);
    expect(balance(db, 7)).toBe(640);
    db.close();

    expect(ledger(openDb(file))).toHaveLength(1);
  });
});

describe('cashier', () => {
  it('adds chips and records the visit', () => {
    const db = openDb(':memory:');
    upsertUser(db, stas);
    expect(withdrawFromCashier(db, 42, 5000)).toBe(6000);
    expect(withdrawFromCashier(db, 42, 1)).toBe(6001);
    expect(balance(db)).toBe(6001);
    expect(ledger(db).slice(1)).toEqual([
      { user_id: 42, type: 'cashier', game: null, amount: 5000, round_id: null },
      { user_id: 42, type: 'cashier', game: null, amount: 1, round_id: null },
    ]);
  });

  it('gives out at most 100000 chips at a time', () => {
    const db = openDb(':memory:');
    upsertUser(db, stas);
    expect(withdrawFromCashier(db, 42, 100_000)).toBe(101_000);
    expect(() => withdrawFromCashier(db, 42, 100_001)).toThrow(WalletError);
  });

  it.each([0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects amount %s and changes nothing', (amount) => {
    const db = openDb(':memory:');
    upsertUser(db, stas);
    expect(() => withdrawFromCashier(db, 42, amount)).toThrow(WalletError);
    expect(balance(db)).toBe(1000);
    expect(ledger(db)).toHaveLength(1);
  });

  it('rejects an unknown player', () => {
    const db = openDb(':memory:');
    expect(() => withdrawFromCashier(db, 999, 100)).toThrow(WalletError);
    expect(ledger(db)).toHaveLength(0);
  });
});

describe('post', () => {
  it('never lets the balance go below zero', () => {
    const db = openDb(':memory:');
    upsertUser(db, stas);
    expect(post(db, { userId: 42, type: 'round', game: 'blackjack', amount: -1000 })).toBe(0);
    expect(() => post(db, { userId: 42, type: 'round', game: 'blackjack', amount: -1 })).toThrow(WalletError);
    expect(balance(db)).toBe(0);
    expect(ledger(db)).toHaveLength(2);
  });
});
