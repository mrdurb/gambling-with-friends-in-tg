import { init, retrieveLaunchParams, retrieveRawInitData, shareURL } from '@tma.js/sdk-react';

// Вне Telegram (режим разработки в браузере) SDK не инициализируется; функции ниже это учитывают.
try {
  init();
} catch {
  // Не в Telegram.
}

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

// Код стола из ссылки-приглашения (?startapp=t_<код>), если приложение открыто по ней.
export function getStartTableCode(): string | null {
  let param = new URLSearchParams(window.location.search).get('tgWebAppStartParam');
  if (!param) {
    try {
      param = retrieveLaunchParams().tgWebAppStartParam ?? null;
    } catch {
      param = null;
    }
  }
  return /^t_([A-Za-z0-9_-]{8})$/.exec(param ?? '')?.[1] ?? null;
}

// Открывает диалог Telegram «Поделиться»; вне Telegram копирует ссылку. Возвращает, что именно произошло.
export async function shareInvite(link: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (shareURL.isAvailable()) {
      shareURL(link, 'Садись за мой стол');
      return 'shared';
    }
  } catch {
    // Падаем в копирование.
  }
  try {
    await navigator.clipboard.writeText(link);
    return 'copied';
  } catch {
    return 'failed';
  }
}
