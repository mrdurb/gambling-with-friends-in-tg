import { CASHIER_MAX } from '@casino/shared';
import { transaction, type Db } from './db.ts';

export type LedgerType = 'start' | 'cashier' | 'round';

export interface LedgerEntry {
  userId: number;
  type: LedgerType;
  amount: number;
  game?: string;
  roundId?: number;
}

export class WalletError extends Error {}

// Единственное место, где меняется баланс. Вызывается внутри транзакции вызывающего.
// Возвращает новый баланс.
export function post(db: Db, entry: LedgerEntry): number {
  const updated = db
    .prepare('UPDATE users SET balance = balance + ? WHERE id = ? AND balance + ? >= 0')
    .run(entry.amount, entry.userId, entry.amount);
  if (updated.changes === 0) throw new WalletError('unknown player or insufficient balance');

  db.prepare('INSERT INTO ledger (user_id, type, game, amount, round_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    entry.userId,
    entry.type,
    entry.game ?? null,
    entry.amount,
    entry.roundId ?? null,
    Date.now(),
  );

  const row = db.prepare('SELECT balance FROM users WHERE id = ?').get(entry.userId) as { balance: number };
  return row.balance;
}

export function withdrawFromCashier(db: Db, userId: number, amount: number): number {
  if (!Number.isInteger(amount) || amount < 1 || amount > CASHIER_MAX) throw new WalletError('bad amount');
  return transaction(db, () => post(db, { userId, type: 'cashier', amount }));
}
