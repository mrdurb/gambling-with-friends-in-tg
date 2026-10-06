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
