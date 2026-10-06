import { parse, validate } from '@tma.js/init-data-node';

export interface TelegramUser {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
}

export interface AuthConfig {
  botToken: string;
  devAuth: boolean;
}

export class AuthError extends Error {}

const INIT_DATA_TTL_SECONDS = 24 * 60 * 60;

export function authenticate(header: string | undefined, config: AuthConfig): TelegramUser {
  const [type, data = ''] = (header ?? '').split(' ');

  if (type === 'dev' && config.devAuth) {
    const id = Number(data);
    if (!Number.isSafeInteger(id) || id <= 0) throw new AuthError('bad dev user id');
    return { id, firstName: `Игрок ${id}`, lastName: null, username: null, photoUrl: null };
  }

  if (type === 'tma') {
    let user;
    try {
      validate(data, config.botToken, { expiresIn: INIT_DATA_TTL_SECONDS });
      user = parse(data).user;
    } catch {
      throw new AuthError('invalid init data');
    }
    if (!user) throw new AuthError('init data has no user');
    return {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name ?? null,
      username: user.username ?? null,
      photoUrl: user.photo_url ?? null,
    };
  }

  throw new AuthError('unsupported authorization');
}
