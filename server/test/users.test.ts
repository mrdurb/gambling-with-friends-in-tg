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
