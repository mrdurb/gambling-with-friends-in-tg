import {
  addToHomeScreen,
  init,
  postEvent,
  retrieveLaunchParams,
  retrieveRawInitData,
  shareURL,
  viewport,
} from '@tma.js/sdk-react';

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

// Разворачивает приложение на весь экран телефона и фиксирует ориентацию.
// Там, где Telegram этого не умеет (или вне Telegram), приложение остаётся в обычном виде.
export async function setupViewport(): Promise<void> {
  let platform = '';
  try {
    platform = retrieveLaunchParams().tgWebAppPlatform;
  } catch {
    return;
  }
  try {
    await viewport.mount();
    // Отступы безопасных зон становятся CSS-переменными --tg-viewport-*; ими пользуется app.css.
    viewport.bindCssVars();
    // На компьютере приложение удобнее в окне, поэтому полноэкранный режим — только на телефонах.
    const mobile = platform === 'ios' || platform === 'android';
    if (mobile && viewport.requestFullscreen.isAvailable()) await viewport.requestFullscreen();
  } catch {
    // Полноэкранный режим не поддерживается или отклонён.
  }
  try {
    postEvent('web_app_toggle_orientation_lock', { locked: true });
  } catch {
    // Клиент Telegram старше, чем блокировка ориентации.
  }
}

export const canAddToHomeScreen = (): boolean => {
  try {
    return addToHomeScreen.isAvailable();
  } catch {
    return false;
  }
};

export function promptAddToHomeScreen(): void {
  try {
    addToHomeScreen();
  } catch {
    // Не поддерживается.
  }
}
