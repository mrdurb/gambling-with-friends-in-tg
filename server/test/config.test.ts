import { describe, expect, it } from 'vitest';
import { loadAuthConfig } from '../src/config.ts';

describe('loadAuthConfig', () => {
  it('uses the bot token when dev auth is off', () => {
    expect(loadAuthConfig({ BOT_TOKEN: '123:ABC' })).toEqual({ botToken: '123:ABC', devAuth: false });
  });

  it('turns dev auth on only without a bot token', () => {
    expect(loadAuthConfig({ DEV_AUTH: '1' })).toEqual({ botToken: '', devAuth: true });
  });

  it('refuses to start with both a bot token and dev auth', () => {
    expect(() => loadAuthConfig({ BOT_TOKEN: '123:ABC', DEV_AUTH: '1' })).toThrow(/DEV_AUTH/);
  });

  it('refuses to start with neither', () => {
    expect(() => loadAuthConfig({})).toThrow(/BOT_TOKEN/);
    expect(() => loadAuthConfig({ BOT_TOKEN: '', DEV_AUTH: '0' })).toThrow(/BOT_TOKEN/);
  });
});
