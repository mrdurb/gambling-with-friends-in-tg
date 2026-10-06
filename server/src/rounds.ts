import type { GameId, RoundOutcome } from '@casino/shared';
import { transaction, type Db } from './db.ts';
import { post } from './wallet.ts';

export interface PlayerResult {
  userId: number;
  wagered: number;
  net: number;
  outcome: RoundOutcome;
  // Подробности для статистики конкретной игры.
  details: unknown;
}

// Расчёт завершённого раунда одной транзакцией: раунд, итоги игроков, движения фишек.
// Возвращает новые балансы участников.
export function settleRound(db: Db, tableCode: string, game: GameId, results: PlayerResult[]): Map<number, number> {
  return transaction(db, () => {
    const round = db.prepare('INSERT INTO rounds (table_code, game, finished_at) VALUES (?, ?, ?)').run(tableCode, game, Date.now());
    const roundId = Number(round.lastInsertRowid);
    const insert = db.prepare(
      'INSERT INTO round_results (round_id, user_id, wagered, net, outcome, details) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const balance = db.prepare('SELECT balance FROM users WHERE id = ?');

    const balances = new Map<number, number>();
    for (const result of results) {
      insert.run(roundId, result.userId, result.wagered, result.net, result.outcome, JSON.stringify(result.details));
      balances.set(
        result.userId,
        result.net === 0
          ? (balance.get(result.userId) as { balance: number }).balance
          : post(db, { userId: result.userId, type: 'round', game, amount: result.net, roundId }),
      );
    }
    return balances;
  });
}

export function balanceOf(db: Db, userId: number): number {
  const row = db.prepare('SELECT balance FROM users WHERE id = ?').get(userId) as { balance: number } | undefined;
  return row?.balance ?? 0;
}
