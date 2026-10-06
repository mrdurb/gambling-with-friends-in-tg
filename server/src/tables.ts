import { randomBytes } from 'node:crypto';
import type { Me, TableInfo } from '@casino/shared';
import type { Db } from './db.ts';

const CODE_PATTERN = /^[A-Za-z0-9_-]{8}$/;
const MY_TABLES_LIMIT = 10;

interface TableRow {
  code: string;
  name: string;
  game: TableInfo['game'];
}

// appLink — ссылка на приложение в Telegram (t.me/<бот>/<приложение>); без неё приглашение собирает клиент.
function toInfo(row: TableRow, appLink: string): TableInfo {
  return { ...row, inviteLink: appLink ? `${appLink}?startapp=t_${row.code}` : null };
}

export function recordVisit(db: Db, code: string, userId: number): void {
  // REPLACE даёт строке новый rowid, поэтому при одинаковом времени порядок посещений всё равно однозначен.
  db.prepare('INSERT OR REPLACE INTO table_visits (table_code, user_id, last_visit_at) VALUES (?, ?, ?)').run(
    code,
    userId,
    Date.now(),
  );
}

export function createTable(db: Db, creator: Me, appLink: string): TableInfo {
  const row: TableRow = {
    code: randomBytes(6).toString('base64url'),
    name: `Стол игрока ${creator.firstName}`,
    game: 'blackjack',
  };
  db.prepare('INSERT INTO tables (code, game, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run(
    row.code,
    row.game,
    row.name,
    creator.id,
    Date.now(),
  );
  recordVisit(db, row.code, creator.id);
  return toInfo(row, appLink);
}

export function findTable(db: Db, code: string, appLink: string): TableInfo | null {
  if (!CODE_PATTERN.test(code)) return null;
  const row = db.prepare('SELECT code, name, game FROM tables WHERE code = ?').get(code) as TableRow | undefined;
  return row ? toInfo(row, appLink) : null;
}

export function listVisitedTables(db: Db, userId: number, appLink: string): TableInfo[] {
  const rows = db
    .prepare(`
      SELECT t.code, t.name, t.game FROM table_visits v JOIN tables t ON t.code = v.table_code
      WHERE v.user_id = ? ORDER BY v.last_visit_at DESC, v.rowid DESC LIMIT ?
    `)
    .all(userId, MY_TABLES_LIMIT) as unknown as TableRow[];
  return rows.map((row) => toInfo(row, appLink));
}
