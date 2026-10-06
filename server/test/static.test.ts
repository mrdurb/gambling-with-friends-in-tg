import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'casino-static-'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Казино</title>');
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  return buildApp(openDb(':memory:'), { botToken: '', devAuth: true }, { staticDir: dir });
}

describe('serving the built client', () => {
  it('serves index.html at the root, ignoring Telegram launch query parameters', async () => {
    const res = await setup().inject({ url: '/?tgWebAppStartParam=t_abc' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.body).toContain('<title>Казино</title>');
  });

  it('tells clients to revalidate index.html so a deploy is picked up', async () => {
    const res = await setup().inject({ url: '/' });
    expect(res.headers['cache-control']).toBe('public, max-age=0');
  });

  it('serves asset files', async () => {
    const res = await setup().inject({ url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('console.log(1)');
  });

  it('keeps the API working next to static files', async () => {
    const res = await setup().inject({ url: '/api/me', headers: { authorization: 'dev 1' } });
    expect(res.json()).toMatchObject({ id: 1, balance: 1000 });
  });

  it('does not serve files outside the client directory', async () => {
    const res = await setup().inject({ url: '/../package.json' });
    expect(res.statusCode).toBe(404);
  });

  it('accepts a directory given relative to the working directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'casino-static-'));
    writeFileSync(join(dir, 'index.html'), 'relative ok');
    const app = buildApp(openDb(':memory:'), { botToken: '', devAuth: true }, { staticDir: relative(process.cwd(), dir) });
    expect((await app.inject({ url: '/' })).body).toBe('relative ok');
  });

  it('serves no static files when no directory is given', async () => {
    const app = buildApp(openDb(':memory:'), { botToken: '', devAuth: true });
    expect((await app.inject({ url: '/' })).statusCode).toBe(404);
  });
});
