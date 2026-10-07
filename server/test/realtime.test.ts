import type { AddressInfo } from 'node:net';
import { CHAT_RATE_LIMIT } from '@casino/shared';
import type {
  Ack,
  BjAction,
  Card,
  ChatMessage,
  ClientToServerEvents,
  Rank,
  Reaction,
  ReactionEvent,
  ServerToClientEvents,
  Suit,
  TableSnapshot,
} from '@casino/shared';
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

const card = (text: string): Card => ({ rank: text.slice(0, -1) as Rank, suit: text.slice(-1) as Suit });

async function setup(script = '') {
  const db = openDb(':memory:');
  const authConfig = { botToken: '', devAuth: true };
  const app = buildApp(db, authConfig);
  const newShoe = () => [...script.split(/\s+/).filter(Boolean).map(card), ...Array.from({ length: 312 }, () => card('2C'))];
  const io = attachRealtime(app.server, { db, authConfig, appLink: '', newShoe });
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
  return { client, db, code: created.json().code as string };
}

const join = (socket: Client, code: string) =>
  new Promise<Ack<{ snapshot: TableSnapshot }>>((resolve) => socket.emit('table:join', code, resolve));
const sit = (socket: Client, seat: number, force = false) =>
  new Promise<Ack>((resolve) => socket.emit('seat:take', seat, force, resolve));
const bet = (socket: Client, amount: number) => new Promise<Ack>((resolve) => socket.emit('game:bet', amount, resolve));
const act = (socket: Client, action: BjAction) => new Promise<Ack>((resolve) => socket.emit('game:action', action, resolve));
const say = (socket: Client, text: string) => new Promise<Ack>((resolve) => socket.emit('chat:send', text, resolve));
const react = (socket: Client, value: string) =>
  new Promise<Ack>((resolve) => socket.emit('reaction:send', { kind: 'emoji', value } as Reaction, resolve));
const collect = <T,>(socket: Client, event: 'chat:message' | 'reaction') => {
  const items: T[] = [];
  socket.on(event, ((item: T) => items.push(item)) as never);
  return items;
};
// Сообщения сокета доставляются по порядку, поэтому ответ на «пинг» означает, что всё отправленное раньше уже пришло.
const settle = (socket: Client) => say(socket, 'ping');
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
      leaving: false,
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

  it('plays a round of blackjack between two players and moves the chips', async () => {
    // Игрок 1: 10 + 9, игрок 2: 10 + 6, дилер: 10 + 7.
    const { client, code, db } = await setup('10S 10D 10H 9S 6D 7H');
    const first = client('dev 1');
    const second = client('dev 2');
    await join(first, code);
    await join(second, code);
    await sit(first, 0);
    await sit(second, 1);

    const firstBalance = new Promise<number>((resolve) => first.on('balance', resolve));
    const secondBalance = new Promise<number>((resolve) => second.on('balance', resolve));
    const result = snapshotWhere(second, (s) => s.game.phase === 'result');

    expect(await bet(first, 100)).toEqual({ ok: true });
    expect(await bet(second, 50)).toEqual({ ok: true });
    expect(await act(second, 'stand')).toEqual({ ok: false, error: 'not_your_turn' });
    expect(await act(first, 'stand')).toEqual({ ok: true });
    expect(await act(second, 'stand')).toEqual({ ok: true });

    expect(await firstBalance).toBe(1100);
    expect(await secondBalance).toBe(950);
    expect((await result).game.seats.slice(0, 2).map((seat) => seat?.net)).toEqual([100, -50]);
    expect(db.prepare('SELECT id, balance FROM users ORDER BY id').all()).toEqual([
      { id: 1, balance: 1100 },
      { id: 2, balance: 950 },
    ]);
  });

  it('rejects malformed game messages', async () => {
    const { client, code } = await setup();
    const socket = client('dev 1');
    await join(socket, code);
    await sit(socket, 0);
    const raw = socket as unknown as { emit: (...args: unknown[]) => void };
    raw.emit('game:bet', '100');
    raw.emit('game:action', 'cheat', 'not a function');
    expect(await bet(socket, '100' as unknown as number)).toEqual({ ok: false, error: 'bad_bet' });
    expect(await act(socket, 'cheat' as BjAction)).toEqual({ ok: false, error: 'not_allowed' });
    expect(await bet(socket, 100)).toEqual({ ok: true });
  });

  it('delivers a chat message to everyone at the table, spectators included, and to nobody else', async () => {
    const { client, code, db } = await setup();
    const [writer, seated, spectator, outsider] = [client('dev 1'), client('dev 2'), client('dev 3'), client('dev 4')];
    await join(writer, code);
    await join(seated, code);
    await join(spectator, code);
    await sit(seated, 0);
    const heard = [seated, spectator, outsider].map((socket) => collect<ChatMessage>(socket, 'chat:message'));

    expect(await say(writer, '  привет, стол  ')).toEqual({ ok: true });
    expect(await say(spectator, 'я просто смотрю')).toEqual({ ok: true });
    await Promise.all([settle(seated), settle(spectator)]);

    for (const messages of heard.slice(0, 2)) {
      expect(messages.slice(0, 2)).toMatchObject([
        { from: { id: 1, firstName: 'Игрок 1' }, text: 'привет, стол' },
        { from: { id: 3 }, text: 'я просто смотрю' },
      ]);
      expect(messages[0]!.at).toBeGreaterThan(0);
    }
    expect(heard[2]).toEqual([]);
    // Сервер сообщения не хранит.
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => row.name);
    expect(tables.some((name) => /chat|message/i.test(String(name)))).toBe(false);
  });

  it('rejects empty, oversized and malformed chat messages', async () => {
    const { client, code } = await setup();
    const socket = client('dev 1');
    expect(await say(socket, 'я ещё не за столом')).toEqual({ ok: false, error: 'not_at_table' });
    await join(socket, code);
    expect(await say(socket, '   ')).toEqual({ ok: false, error: 'bad_message' });
    expect(await say(socket, 'я'.repeat(201))).toEqual({ ok: false, error: 'bad_message' });
    expect(await say(socket, 42 as unknown as string)).toEqual({ ok: false, error: 'bad_message' });
    expect(await say(socket, 'я'.repeat(200))).toEqual({ ok: true });
  });

  it('limits how often one player can write to the table', async () => {
    const { client, code } = await setup();
    const socket = client('dev 1');
    await join(socket, code);
    await sit(socket, 0);
    for (let i = 0; i < CHAT_RATE_LIMIT; i++) expect(await say(socket, `сообщение ${i}`)).toEqual({ ok: true });
    expect(await say(socket, 'лишнее')).toEqual({ ok: false, error: 'too_fast' });
    expect(await react(socket, '🎉')).toEqual({ ok: false, error: 'too_fast' });
  });

  it('shows a reaction from a seated player to the table and refuses others', async () => {
    const { client, code } = await setup();
    const [seated, spectator] = [client('dev 1'), client('dev 2')];
    await join(seated, code);
    await join(spectator, code);
    await sit(seated, 0);
    const seen = collect<ReactionEvent>(spectator, 'reaction');

    expect(await react(seated, '🎉')).toEqual({ ok: true });
    expect(await react(spectator, '🎉')).toEqual({ ok: false, error: 'not_seated' });
    expect(await react(seated, '💩')).toEqual({ ok: false, error: 'bad_reaction' });
    expect(await react(seated, '<img src=x>')).toEqual({ ok: false, error: 'bad_reaction' });
    const raw = seated as unknown as { emit: (...args: unknown[]) => void };
    const malformed = await new Promise<Ack>((resolve) => raw.emit('reaction:send', null, resolve));
    expect(malformed).toEqual({ ok: false, error: 'bad_reaction' });

    await settle(spectator);
    expect(seen).toEqual([{ userId: 1, reaction: { kind: 'emoji', value: '🎉' } }]);
  });
});
