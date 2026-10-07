import type { GameId, Me, PlayerStats, RatingRow, TableInfo } from '@casino/shared';
import { getAuthHeader } from './telegram.ts';

export class UnauthorizedError extends Error {}

// Ошибка, которую сервер вернул осознанно: код из поля error ответа.
export class ApiError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  const auth = getAuthHeader();
  if (!auth) throw new UnauthorizedError();
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: auth, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status >= 400 && res.status < 500) {
    const payload = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(payload?.error ?? 'bad_request');
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchMe = () => request<Me>('/api/me');
export const withdrawFromCashier = (amount: number) => request<{ balance: number }>('/api/cashier', { amount });
export const fetchMyTables = (game: GameId) => request<TableInfo[]>(`/api/tables?game=${game}`);
export const createTable = (game: GameId) => request<TableInfo>('/api/tables', { game });
export const fetchRating = () => request<RatingRow[]>('/api/rating');
export const fetchStats = (userId: number) => request<PlayerStats>(`/api/stats/${userId}`);
