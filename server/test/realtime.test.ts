import type { AddressInfo } from 'node:net';
import type { Ack, ClientToServerEvents, ServerToClientEvents, TableSnapshot } from '@casino/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { attachRealtime } from '../src/realtime.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup() {
  const db = openDb(':memory:');
  const authConfig = { botToken: '', devAuth: true };
  const app = buildApp(db, authConfig);
  const io = attachRealtime(app.server, { db, authConfig, appLink: '' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  cleanups.push(() => io.close(), () => app.close());
  const { port } = app.server.address() as AddressInfo;

  const client = (token: string | undefined): Client => {
    const socket: Client = connect(`http://127.0.0.1:${port}`, {
      auth: token === undefined ? {} : { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });
    cleanups.push(() => socket.close());
    return socket;
  };
  const created = await app.inject({ method: 'POST', url: '/api/tables', headers: { authorization: 'dev 1' } });
  return { client, code: created.json().code as string };
}

const join = (socket: Client, code: string) =>
  new Promise<Ack<{ snapshot: TableSnapshot }>>((resolve) => socket.emit('table:join', code, resolve));
const sit = (socket: Client, seat: number, force = false) =>
  new Promise<Ack>((resolve) => socket.emit('seat:take', seat, force, resolve));
const snapshotWhere = (socket: Client, matches: (snapshot: TableSnapshot) => boolean) =>
  new Promise<TableSnapshot>((resolve) => {
    const listener = (snapshot: TableSnapshot) => {
      if (!matches(snapshot)) return;
      socket.off('table:snapshot', listener);
      resolve(snapshot);
    };
    socket.on('table:snapshot', listener);
  });

describe('realtime tables', () => {
  it('shows one player sitting down to another', async () => {
    const { client, code } = await setup();
    const first = client('dev 1');
    const second = client('dev 2');
    expect(await join(first, code)).toMatchObject({ ok: true });
    const joined = await join(second, code);
    expect(joined).toMatchObject({ ok: true, snapshot: { spectators: 2 } });

    const seen = snapshotWhere(second, (s) => s.seats[4] !== null);
    expect(await sit(first, 4)).toEqual({ ok: true });
    expect((await seen).seats[4]).toEqual({
      player: { id: 1, firstName: 'Игрок 1', lastName: null, photoUrl: null },
      connected: true,
    });
  });

  it('marks a seated player as disconnected when their connection drops', async () => {
    const { client, code } = await setup();
    const first = client('dev 1');
    const second = client('dev 2');
    await join(first, code);
    await join(second, code);
    await sit(first, 0);

    const seen = snapshotWhere(second, (s) => s.seats[0]?.connected === false);
    first.close();
    expect((await seen).seats[0]?.player.id).toBe(1);
  });

  it('replaces the old connection when the same player connects again', async () => {
    const { client, code } = await setup();
    const old = client('dev 1');
    const watcher = client('dev 2');
    await join(old, code);
    await join(watcher, code);
    await sit(old, 0);

    const kicked = new Promise<void>((resolve) => old.on('kicked', resolve));
    const dropped = new Promise<void>((resolve) => old.on('disconnect', () => resolve()));
    const fresh = client('dev 1');
    await kicked;
    await dropped;

    const rejoined = await join(fresh, code);
    expect(rejoined).toMatchObject({ ok: true });
    if (rejoined.ok) expect(rejoined.snapshot.seats[0]).toMatchObject({ player: { id: 1 }, connected: true });
  });

  it('refuses a connection without valid authorization', async () => {
    const { client } = await setup();
    for (const token of [undefined, 'tma forged', 'dev abc']) {
      const socket = client(token);
      const error = await new Promise<Error>((resolve) => socket.on('connect_error', resolve));
      expect(error.message).toBe('unauthorized');
    }
  });

  it('answers not_found for an unknown table', async () => {
    const { client } = await setup();
    expect(await join(client('dev 1'), 'ZZZZZZZZ')).toEqual({ ok: false, error: 'not_found' });
  });

  it('survives malformed messages', async () => {
    const { client, code } = await setup();
    const socket = client('dev 1');
    const raw = socket as unknown as { emit: (...args: unknown[]) => void };
    raw.emit('table:join', 42);
    raw.emit('table:join', { code }, 'not a function');
    raw.emit('seat:take', 'zero', null, null);
    raw.emit('seat:take');
    raw.emit('seat:leave', 1, 2, 3);
    expect(await join(socket, code)).toMatchObject({ ok: true });
    expect(await sit(socket, 1)).toEqual({ ok: true });
  });
});
