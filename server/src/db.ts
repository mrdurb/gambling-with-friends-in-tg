import { DatabaseSync } from 'node:sqlite';
import { START_CHIPS } from '@casino/shared';

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT,
      username TEXT,
      photo_url TEXT,
      balance INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ledger (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      game TEXT,
      amount INTEGER NOT NULL,
      round_id INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ledger_user ON ledger(user_id, type);
    CREATE TABLE IF NOT EXISTS tables (
      code TEXT PRIMARY KEY,
      game TEXT NOT NULL,
      name TEXT NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS table_visits (
      table_code TEXT NOT NULL REFERENCES tables(code),
      user_id INTEGER NOT NULL REFERENCES users(id),
      last_visit_at INTEGER NOT NULL,
      PRIMARY KEY (table_code, user_id)
    );
  `);
  // Игроки, созданные до появления журнала, получили стартовые фишки без записи о них.
  db.prepare(`
    INSERT INTO ledger (user_id, type, amount, created_at)
    SELECT id, 'start', ?, created_at FROM users
    WHERE NOT EXISTS (SELECT 1 FROM ledger WHERE user_id = users.id AND type = 'start')
  `).run(START_CHIPS);
  return db;
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
