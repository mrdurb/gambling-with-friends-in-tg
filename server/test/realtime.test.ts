import type { AddressInfo } from 'node:net';
import { CHAT_RATE_LIMIT, ROULETTE_RATE_LIMIT } from '@casino/shared';
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
  BlackjackSnapshot,
  RouletteField,
  PokerActionKind,
  PokerSnapshot,
  RouletteSnapshot,
} from '@casino/shared';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { attachRealtime } from '../src/realtime.ts';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
// Помощники ниже работают со столом блэкджека.
type TableSnapshot = BlackjackSnapshot;

const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const card = (text: string): Card => ({ rank: text.slice(0, -1) as Rank, suit: text.slice(-1) as Suit });

async function setup(script = '', numbers: number[] = [1], pokerDeck = '') {
  const db = openDb(':memory:');
  const authConfig = { botToken: '', devAuth: true };
  const app = buildApp(db, authConfig);
  const newShoe = () => [...script.split(/\s+/).filter(Boolean).map(card), ...Array.from({ length: 312 }, () => card('2C'))];
  let spins = 0;
  const spinNumber = () => numbers[Math.min(spins++, numbers.length - 1)]!;
  // Вращение в тестах короткое, чтобы не ждать настоящие 5 секунд.
  const io = attachRealtime(app.server, { db, authConfig, appLink: '', newShoe, spinNumber, spinMs: 50, newDeck: () => pokerDeck.split(' ').map(card) });
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
  const rouletteTable = async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tables', headers: { authorization: 'dev 1' }, payload: { game: 'roulette' } });
    return res.json().code as string;
  };
  const pokerTable = async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/tables',
      headers: { authorization: 'dev 1' },
      payload: { game: 'poker', mode: 'nlh', blinds: 10 },
    });
    return res.json().code as string;
  };
  return { client, db, code: created.json().code as string, rouletteTable, pokerTable };
}

const join = (socket: Client, code: string) =>
  new Promise<Ack<{ snapshot: TableSnapshot }>>((resolve) => socket.emit('table:join', code, resolve as never));
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
const rBet = (socket: Client, field: RouletteField, amount: number) =>
  new Promise<Ack>((resolve) => socket.emit('roulette:bet', field, amount, resolve));
const rReady = (socket: Client) => new Promise<Ack>((resolve) => socket.emit('roulette:ready', resolve));
const rClear = (socket: Client) => new Promise<Ack>((resolve) => socket.emit('roulette:clear', resolve));
const rouletteWhere = (socket: Client, matches: (snapshot: RouletteSnapshot) => boolean) =>
  snapshotWhere(socket, matches as never) as unknown as Promise<RouletteSnapshot>;
const pSit = (socket: Client, seat: number, buyIn: number) =>
  new Promise<Ack>((resolve) => socket.emit('poker:sit', seat, buyIn, resolve));
const pAct = (socket: Client, kind: PokerActionKind, amount: number | null = null) =>
  new Promise<Ack>((resolve) => socket.emit('poker:action', kind, amount, resolve));
const pShow = (socket: Client) => new Promise<Ack>((resolve) => socket.emit('poker:show', resolve));
const pokerWhere = (socket: Client, matches: (snapshot: PokerSnapshot) => boolean) =>
  snapshotWhere(socket, matches as never) as unknown as Promise<PokerSnapshot>;
// Всё, что клиент получил о картах: личные сообщения и открытые карты из снимков.
const watchCards = (socket: Client) => {
  const seen = { own: [] as string[], open: new Set<string>() };
  const name = (c: Card) => c.rank + c.suit;
  socket.on('poker:cards', (cards) => seen.own.push(cards.map(name).join(' ')));
  socket.on('table:snapshot', (snapshot) => {
    if (snapshot.kind !== 'poker') return;
    for (const seat of snapshot.game.seats) for (const item of seat?.cards ?? []) seen.open.add(name(item));
  });
  return seen;
};
// Сообщения сокета доставляются по порядку, поэтому ответ на «пинг» означает, что всё отправленное раньше уже пришло.
const settle = (socket: Client) => say(socket, 'ping');
const snapshotWhere = (socket: Client, matches: (snapshot: TableSnapshot) => boolean) =>
  new Promise<TableSnapshot>((resolve) => {
    const listener = (snapshot: TableSnapshot) => {
      if (!matches(snapshot)) return;
      socket.off('table:snapshot', listener as never);
      resolve(snapshot);
    };
    socket.on('table:snapshot', listener as never);
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

  it('plays a round of roulette between two players and moves the chips', async () => {
    const { client, db, rouletteTable } = await setup('', [1]);
    const code = await rouletteTable();
    const [first, second] = [client('dev 1'), client('dev 2')];
    expect(await join(first, code)).toMatchObject({ ok: true, snapshot: { kind: 'roulette', game: { phase: 'waiting' } } });
    await join(second, code);

    const firstBalance = new Promise<number>((resolve) => first.on('balance', resolve));
    const secondBalance = new Promise<number>((resolve) => second.on('balance', resolve));
    const spinning = rouletteWhere(second, (s) => s.game.phase === 'spinning');
    const result = rouletteWhere(second, (s) => s.game.phase === 'result');

    expect(await rBet(first, 'red', 100)).toEqual({ ok: true });
    expect(await rBet(second, 'n7', 50)).toEqual({ ok: true });
    expect(await rBet(second, 'black', 10)).toEqual({ ok: true });
    expect(await rClear(second)).toEqual({ ok: true });
    expect(await rBet(second, 'black', 50)).toEqual({ ok: true });
    expect(await rReady(first)).toEqual({ ok: true });
    expect(await rReady(second)).toEqual({ ok: true });

    expect((await spinning).game.number).toBe(1);
    expect(await firstBalance).toBe(1100);
    expect(await secondBalance).toBe(950);
    expect((await result).game).toMatchObject({ number: 1, history: [1], players: [{ net: 100 }, { net: -50 }] });
    expect(db.prepare('SELECT id, balance FROM users ORDER BY id').all()).toEqual([
      { id: 1, balance: 1100 },
      { id: 2, balance: 950 },
    ]);
    expect(db.prepare('SELECT game FROM rounds').all()).toEqual([{ game: 'roulette' }]);
    expect(db.prepare("SELECT user_id, amount, game FROM ledger WHERE type = 'round' ORDER BY user_id").all()).toEqual([
      { user_id: 1, amount: 100, game: 'roulette' },
      { user_id: 2, amount: -50, game: 'roulette' },
    ]);
  });

  it('rejects malformed roulette messages and messages meant for the other game', async () => {
    const { client, code, rouletteTable } = await setup();
    const socket = client('dev 1');
    const raw = socket as unknown as { emit: (...args: unknown[]) => void };
    expect(await rBet(socket, 'red', 10)).toEqual({ ok: false, error: 'not_at_table' });

    await join(socket, await rouletteTable());
    raw.emit('roulette:bet', 'red', 10);
    raw.emit('roulette:ready', 'not a function');
    raw.emit('roulette:clear');
    expect(await rBet(socket, null as unknown as RouletteField, 10)).toEqual({ ok: false, error: 'bad_field' });
    expect(await rBet(socket, 'n99' as RouletteField, 10)).toEqual({ ok: false, error: 'bad_field' });
    expect(await rBet(socket, 'red', '10' as unknown as number)).toEqual({ ok: false, error: 'bad_bet' });
    expect(await sit(socket, 0)).toEqual({ ok: false, error: 'wrong_game' });
    expect(await rBet(socket, 'red', 10)).toEqual({ ok: true });

    await join(socket, code);
    expect(await rBet(socket, 'red', 10)).toEqual({ ok: false, error: 'wrong_game' });
    expect(await rReady(socket)).toEqual({ ok: false, error: 'wrong_game' });
  });

  it('limits how fast one player can change roulette bets', async () => {
    const { client, rouletteTable } = await setup();
    const socket = client('dev 1');
    await join(socket, await rouletteTable());
    for (let i = 0; i < ROULETTE_RATE_LIMIT; i++) expect(await rBet(socket, 'red', 5)).toEqual({ ok: true });
    expect(await rBet(socket, 'red', 5)).toEqual({ ok: false, error: 'too_fast' });
    expect(await rClear(socket)).toEqual({ ok: false, error: 'too_fast' });
    expect(await rReady(socket)).toEqual({ ok: false, error: 'too_fast' });
  });

  it('lets anyone at a roulette table send a reaction', async () => {
    const { client, rouletteTable } = await setup();
    const code = await rouletteTable();
    const [sender, watcher] = [client('dev 1'), client('dev 2')];
    await join(sender, code);
    await join(watcher, code);
    const seen = collect<ReactionEvent>(watcher, 'reaction');
    expect(await react(sender, '🎉')).toEqual({ ok: true });
    await settle(watcher);
    expect(seen).toEqual([{ userId: 1, reaction: { kind: 'emoji', value: '🎉' } }]);
  });

  // Карманные карты — с начала колоды: игрок 2 (большой блайнд) получает AS AD, игрок 1 — KD KC.
  // Борд — с конца: K Q J 5 5, у игрока 1 фулл-хаус.
  const POKER_DECK = 'AS AD KD KC 5H 5S JD QH KS';

  it('plays a hand of poker between two players, keeps closed cards private and moves the chips', async () => {
    const { client, db, pokerTable } = await setup('', [1], POKER_DECK);
    const code = await pokerTable();
    const [first, second, watcher] = [client('dev 1'), client('dev 2'), client('dev 3')];
    const seen = [first, second, watcher].map(watchCards);
    expect(await join(first, code)).toMatchObject({ ok: true, snapshot: { kind: 'poker', game: { phase: 'waiting' } } });
    await join(second, code);
    await join(watcher, code);

    const firstBalance = new Promise<number>((resolve) => first.on('balance', resolve));
    const secondBalance = new Promise<number>((resolve) => second.on('balance', resolve));
    const result = pokerWhere(watcher, (s) => s.game.phase === 'result');

    expect(await pSit(first, 0, 400)).toEqual({ ok: true });
    expect(await pSit(second, 1, 400)).toEqual({ ok: true });
    expect(await pAct(second, 'check')).toEqual({ ok: false, error: 'not_your_turn' });
    expect(await pAct(first, 'raise', 30)).toEqual({ ok: true });
    expect(await pAct(second, 'call')).toEqual({ ok: true });
    // Три круга чеков: после флопа первым ходит большой блайнд.
    for (let street = 0; street < 3; street++) {
      expect(await pAct(second, 'check')).toEqual({ ok: true });
      expect(await pAct(first, 'check')).toEqual({ ok: true });
    }

    expect(await firstBalance).toBe(1030);
    expect(await secondBalance).toBe(970);
    const shown = await result;
    expect(shown.game.seats.slice(0, 2)).toMatchObject([
      { stack: 430, won: 60, hand: 'Фулл-хаус' },
      { stack: 370, won: 0, cards: null },
    ]);
    await Promise.all([settle(first), settle(second), settle(watcher)]);

    // Каждый получил лично только свои карты; зритель — никаких.
    expect(seen[0]!.own[0]).toBe('KD KC');
    expect(seen[1]!.own[0]).toBe('AS AD');
    expect(seen[2]!.own).toEqual([]);
    // Тузы проигравшего остались закрытыми для всех, пока он сам их не показал.
    for (const view of seen) expect([...view.open].sort()).toEqual(['KC', 'KD']);
    expect(await pShow(second)).toEqual({ ok: true });
    await settle(watcher);
    expect([...seen[2]!.open].sort()).toEqual(['AD', 'AS', 'KC', 'KD']);

    expect(db.prepare('SELECT id, balance FROM users ORDER BY id').all()).toMatchObject([
      { id: 1, balance: 1030 },
      { id: 2, balance: 970 },
      { id: 3, balance: 1000 },
    ]);
    expect(db.prepare('SELECT game FROM rounds').all()).toEqual([{ game: 'poker' }]);
    expect(db.prepare("SELECT user_id, amount, game FROM ledger WHERE type = 'round' ORDER BY user_id").all()).toEqual([
      { user_id: 1, amount: 30, game: 'poker' },
      { user_id: 2, amount: -30, game: 'poker' },
    ]);
  });

  it('rejects malformed poker messages and messages meant for another game', async () => {
    const { client, code, pokerTable } = await setup('', [1], POKER_DECK);
    const socket = client('dev 1');
    const raw = socket as unknown as { emit: (...args: unknown[]) => void };
    const send = (...args: unknown[]) => new Promise<Ack>((resolve) => raw.emit(...args, resolve));
    expect(await pSit(socket, 0, 400)).toEqual({ ok: false, error: 'not_at_table' });

    await join(socket, await pokerTable());
    raw.emit('poker:sit', 0, 400);
    raw.emit('poker:action', 'fold');
    raw.emit('poker:rebuy');
    raw.emit('poker:discard', 'x', 'not a function');
    expect(await send('poker:sit', null, 400)).toEqual({ ok: false, error: 'bad_seat' });
    expect(await send('poker:sit', 0, { amount: 400 })).toEqual({ ok: false, error: 'bad_buyin' });
    expect(await send('poker:sit')).toEqual({ ok: false, error: 'bad_seat' });
    expect(await send('poker:action', 'fold', null)).toEqual({ ok: false, error: 'not_seated' });
    expect(await sit(socket, 0)).toEqual({ ok: false, error: 'wrong_game' });
    expect(await pSit(socket, 0, 400)).toEqual({ ok: true });
    expect(await send('poker:action', ['fold'], null)).toEqual({ ok: false, error: 'not_allowed' });
    expect(await send('poker:rebuy', '100')).toEqual({ ok: false, error: 'bad_amount' });
    expect(await send('poker:discard', 0)).toEqual({ ok: false, error: 'not_allowed' });
    expect(await react(socket, '🎉')).toEqual({ ok: true }); // сидящий может отправить реакцию

    socket.emit('poker:leave');
    await join(socket, code);
    expect(await pSit(socket, 0, 400)).toEqual({ ok: false, error: 'wrong_game' });
    expect(await pAct(socket, 'fold')).toEqual({ ok: false, error: 'wrong_game' });
  });
});
