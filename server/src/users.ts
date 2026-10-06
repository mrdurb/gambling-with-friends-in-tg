import { START_CHIPS, type Me } from '@casino/shared';
import type { TelegramUser } from './auth.ts';
import { transaction, type Db } from './db.ts';
import { post } from './wallet.ts';

export function upsertUser(db: Db, user: TelegramUser): Me {
  return transaction(db, () => {
    const existing = db.prepare('SELECT balance FROM users WHERE id = ?').get(user.id) as { balance: number } | undefined;

    if (existing) {
      db.prepare('UPDATE users SET first_name = ?, last_name = ?, username = ?, photo_url = ? WHERE id = ?').run(
        user.firstName,
        user.lastName,
        user.username,
        user.photoUrl,
        user.id,
      );
      return { ...user, balance: existing.balance };
    }

    db.prepare(
      'INSERT INTO users (id, first_name, last_name, username, photo_url, balance, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
    ).run(user.id, user.firstName, user.lastName, user.username, user.photoUrl, Date.now());
    return { ...user, balance: post(db, { userId: user.id, type: 'start', amount: START_CHIPS }) };
  });
}
