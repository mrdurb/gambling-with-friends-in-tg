import type { AuthConfig } from './auth.ts';

// Сервер работает либо с токеном бота (настоящий вход), либо в режиме разработки, но не в обоих сразу:
// иначе вход `dev <id>` оказался бы открыт на сервере, доступном из Telegram.
export function loadAuthConfig(env: Record<string, string | undefined>): AuthConfig {
  const botToken = env.BOT_TOKEN ?? '';
  const devAuth = env.DEV_AUTH === '1';
  if (botToken && devAuth) throw new Error('DEV_AUTH=1 cannot be combined with BOT_TOKEN');
  if (!botToken && !devAuth) throw new Error('BOT_TOKEN is required unless DEV_AUTH=1');
  return { botToken, devAuth };
}
