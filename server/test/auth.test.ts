import { sign } from '@tma.js/init-data-node';
import { describe, expect, it } from 'vitest';
import { AuthError, authenticate } from '../src/auth.ts';

const botToken = '123456:TEST-TOKEN';
const prod = { botToken, devAuth: false };

function initData(authDate: Date, token = botToken): string {
  return sign(
    { user: { id: 42, first_name: 'Стас', username: 'stas', photo_url: 'https://t.me/i/userpic/320/stas.jpg' } },
    token,
    authDate,
  );
}

describe('authenticate', () => {
  it('returns the user from correctly signed init data', () => {
    expect(authenticate(`tma ${initData(new Date())}`, prod)).toEqual({
      id: 42,
      firstName: 'Стас',
      lastName: null,
      username: 'stas',
      photoUrl: 'https://t.me/i/userpic/320/stas.jpg',
    });
  });

  it('rejects init data signed with another bot token', () => {
    expect(() => authenticate(`tma ${initData(new Date(), '999:OTHER')}`, prod)).toThrow(AuthError);
  });

  it('rejects init data with a tampered user', () => {
    const tampered = initData(new Date()).replace('%22id%22%3A42', '%22id%22%3A43');
    expect(tampered).not.toBe(initData(new Date()));
    expect(() => authenticate(`tma ${tampered}`, prod)).toThrow(AuthError);
  });

  it('rejects init data older than 24 hours', () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    expect(() => authenticate(`tma ${initData(old)}`, prod)).toThrow(AuthError);
  });

  it('rejects a missing or malformed header', () => {
    expect(() => authenticate(undefined, prod)).toThrow(AuthError);
    expect(() => authenticate('tma', prod)).toThrow(AuthError);
    expect(() => authenticate('Bearer abc', prod)).toThrow(AuthError);
  });

  it('accepts dev users only when dev auth is on', () => {
    expect(authenticate('dev 7', { botToken: '', devAuth: true })).toMatchObject({ id: 7, firstName: 'Игрок 7' });
    expect(() => authenticate('dev 7', prod)).toThrow(AuthError);
    expect(() => authenticate('dev abc', { botToken: '', devAuth: true })).toThrow(AuthError);
  });
});
