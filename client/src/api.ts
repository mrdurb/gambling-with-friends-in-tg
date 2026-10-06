import type { Me } from '@casino/shared';
import { getAuthHeader } from './telegram.ts';

export class UnauthorizedError extends Error {}

async function request<T>(path: string): Promise<T> {
  const auth = getAuthHeader();
  if (!auth) throw new UnauthorizedError();
  const res = await fetch(path, { headers: { Authorization: auth } });
  if (res.status === 401) throw new UnauthorizedError();
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export const fetchMe = () => request<Me>('/api/me');
