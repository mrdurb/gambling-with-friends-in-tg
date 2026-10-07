import { randomBytes } from 'node:crypto';
import { POKER_MODE_TITLES, type GameId, type Me, type PokerOptions, type TableInfo } from '@casino/shared';
import type { Db } from './db.ts';

const CODE_PATTERN = /^[A-Za-z0-9_-]{8}$/;
const MY_TABLES_LIMIT = 10;

interface TableRow {
  code: string;
  name: string;
  game: GameId;
  // Настройки стола в JSON; сейчас они есть только у покера.
  options: string | null;
}

// appLink — ссылка на приложение в Telegram (t.me/<бот>/<приложение>); без неё приглашение собирает клиент.
function toInfo({ options, ...row }: TableRow, appLink: string): TableInfo {
  return {
    ...row,
    inviteLink: appLink ? `${appLink}?startapp=t_${row.code}` : null,
    poker: options ? (JSON.parse(options) as PokerOptions) : null,
  };
}

export function recordVisit(db: Db, code: string, userId: number): void {
  // REPLACE даёт строке новый rowid, поэтому при одинаковом времени порядок посещений всё равно однозначен.
  db.prepare('INSERT OR REPLACE INTO table_visits (table_code, user_id, last_visit_at) VALUES (?, ?, ?)').run(
    code,
    userId,
    Date.now(),
  );
}

function tableName(game: GameId, creator: Me, poker: PokerOptions | null): string {
  if (poker) return `${POKER_MODE_TITLES[poker.mode]} ${poker.blinds.join('/')} игрока ${creator.firstName}`;
  return `${game === 'roulette' ? 'Рулетка' : 'Стол'} игрока ${creator.firstName}`;
}

// poker — настройки стола покера; для остальных игр не передаются.
export function createTable(
  db: Db,
  creator: Me,
  appLink: string,
  game: GameId = 'blackjack',
  poker: PokerOptions | null = null,
): TableInfo {
  const row: TableRow = {
    code: randomBytes(6).toString('base64url'),
    name: tableName(game, creator, poker),
    game,
    options: poker && JSON.stringify(poker),
  };
  db.prepare('INSERT INTO tables (code, game, name, options, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    row.code,
    row.game,
    row.name,
    row.options,
    creator.id,
    Date.now(),
  );
  recordVisit(db, row.code, creator.id);
  return toInfo(row, appLink);
}

export function findTable(db: Db, code: string, appLink: string): TableInfo | null {
  if (!CODE_PATTERN.test(code)) return null;
  const row = db.prepare('SELECT code, name, game, options FROM tables WHERE code = ?').get(code) as TableRow | undefined;
  return row ? toInfo(row, appLink) : null;
}

export function listVisitedTables(db: Db, userId: number, appLink: string, game: GameId = 'blackjack'): TableInfo[] {
  const rows = db
    .prepare(`
      SELECT t.code, t.name, t.game, t.options FROM table_visits v JOIN tables t ON t.code = v.table_code
      WHERE v.user_id = ? AND t.game = ? ORDER BY v.last_visit_at DESC, v.rowid DESC LIMIT ?
    `)
    .all(userId, game, MY_TABLES_LIMIT) as unknown as TableRow[];
  return rows.map((row) => toInfo(row, appLink));
}
