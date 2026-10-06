import { retrieveRawInitData } from '@tma.js/sdk-react';

// Значение заголовка Authorization или null, если приложение открыто не из Telegram.
export function getAuthHeader(): string | null {
  if (import.meta.env.DEV) {
    const devUser = new URLSearchParams(window.location.search).get('devUser');
    if (devUser) return `dev ${devUser}`;
  }
  try {
    const raw = retrieveRawInitData();
    return raw ? `tma ${raw}` : null;
  } catch {
    return null;
  }
}
