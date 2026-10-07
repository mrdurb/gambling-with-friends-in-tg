import {
  BET_MS,
  DISCONNECT_GRACE_MS,
  RESULT_MS,
  TURN_MS,
  type Card,
  type PlayerInfo,
  type Rank,
  type Suit,
  type TableInfo,
  type TableSnapshot,
} from '@casino/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rooms } from '../src/rooms.ts';
import type { PlayerResult } from '../src/rounds.ts';

const table: TableInfo = { code: 'AAAAAAAA', name: 'A', game: 'blackjack', inviteLink: null };
const other: TableInfo = { code: 'BBBBBBBB', name: 'B', game: 'blackjack', inviteLink: null };
const player = (id: number): PlayerInfo => ({ id, firstName: `Игрок ${id}`, lastName: null, photoUrl: null });
const card = (text: string): Card => ({ rank: text.slice(0, -1) as Rank, suit: text.slice(-1) as Suit });

// Игроки 1 и 2 сидят на местах 0 и 1. Карты по умолчанию: игрок 1 — 19, игрок 2 — 16, дилер — 17.
function setup({ script = '10S 10D 10H 9S 6D 7H', bank = {} as Record<number, number>, players = [1, 2] } = {}) {
  const sent: TableSnapshot[] = [];
  const settled: { code: string; results: PlayerResult[] }[] = [];
  const notified: [number, number][] = [];
  const balances = new Map<number, number>(Object.entries(bank).map(([id, amount]) => [Number(id), amount]));
  const balanceOf = (id: number) => balances.get(id) ?? 1000;
  let failSettle = false;

  const rooms = new Rooms({
    broadcast: (snapshot) => sent.push(snapshot),
    balanceOf,
    settle: (code, results) => {
      if (failSettle) throw new Error('database is down');
      settled.push({ code, results });
      for (const result of results) balances.set(result.userId, balanceOf(result.userId) + result.net);
      return new Map(results.map((result) => [result.userId, balanceOf(result.userId)]));
    },
    notifyBalance: (id, balance) => notified.push([id, balance]),
    newShoe: () => [...script.split(/\s+/).filter(Boolean).map(card), ...Array.from({ length: 312 }, () => card('2C'))],
  });

  players.forEach((id, seat) => {
    rooms.enter(table, player(id));
    rooms.sit(id, seat);
  });
  const last = () => sent.filter((snapshot) => snapshot.table.code === table.code).at(-1)!;
  return { rooms, sent, last, settled, notified, balances, breakSettle: () => (failSettle = true) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('betting phase', () => {
  it('starts the round as soon as everyone seated has bet', () => {
    const { rooms, last } = setup();
    expect(rooms.bet(1, 100)).toEqual({ ok: true });
    expect(last().game).toMatchObject({ phase: 'betting', timeLeftMs: BET_MS });

    expect(rooms.bet(2, 50)).toEqual({ ok: true });
    expect(last().game).toMatchObject({ phase: 'playing', turn: { seat: 0, hand: 0 }, timeLeftMs: TURN_MS });
  });

  it('starts after 20 seconds without those who did not bet', () => {
    const { rooms, last } = setup();
    rooms.bet(2, 50);
    vi.advanceTimersByTime(BET_MS - 1);
    expect(last().game.phase).toBe('betting');
    vi.advanceTimersByTime(1);
    expect(last().game).toMatchObject({ phase: 'playing', turn: { seat: 1 } });
    expect(last().game.seats[0]).toBeNull();
  });

  it('counts down the time left in snapshots', () => {
    const { rooms, last } = setup();
    rooms.bet(1, 100);
    vi.advanceTimersByTime(7000);
    rooms.enter(table, player(9));
    expect(last().game.timeLeftMs).toBe(BET_MS - 7000);
  });

  it('checks the bet against the balance', () => {
    const { rooms } = setup({ bank: { 1: 60 } });
    expect(rooms.bet(1, 100)).toEqual({ ok: false, error: 'insufficient' });
    expect(rooms.bet(1, 60)).toEqual({ ok: true });
  });

  it('refuses a bet from someone who is not seated', () => {
    const { rooms } = setup();
    rooms.enter(table, player(9));
    expect(rooms.bet(9, 100)).toEqual({ ok: false, error: 'not_seated' });
    expect(rooms.bet(77, 100)).toEqual({ ok: false, error: 'not_seated' });
  });

  it('cancels the bet of a player who stands up, and starts if the rest have all bet', () => {
    const { rooms, last } = setup({ players: [1, 2, 3], script: '10S 10D 10H 9S 6D 7H' });
    rooms.bet(1, 100);
    rooms.bet(2, 100);
    rooms.stand(3);
    expect(last().seats[2]).toBeNull();
    expect(last().game.phase).toBe('playing');
  });

  it('goes back to waiting when the only bettor stands up', () => {
    const { rooms, last } = setup();
    rooms.bet(1, 100);
    rooms.stand(1);
    expect(last().game).toMatchObject({ phase: 'waiting', timeLeftMs: null });
    vi.advanceTimersByTime(BET_MS * 2);
    expect(last().game.phase).toBe('waiting');
  });
});

describe('playing a round', () => {
  const start = (options?: Parameters<typeof setup>[0]) => {
    const ctx = setup(options);
    ctx.rooms.bet(1, 100);
    ctx.rooms.bet(2, 50);
    return ctx;
  };

  it('settles through the wallet once, tells players their balance, and shows the result for 5 seconds', () => {
    const { rooms, last, settled, notified } = start();
    expect(rooms.act(2, 'stand')).toEqual({ ok: false, error: 'not_your_turn' });
    expect(rooms.act(1, 'stand')).toEqual({ ok: true });
    expect(rooms.act(2, 'stand')).toEqual({ ok: true });

    expect(settled).toHaveLength(1);
    expect(settled[0]!.code).toBe('AAAAAAAA');
    expect(settled[0]!.results).toEqual([
      expect.objectContaining({ userId: 1, wagered: 100, net: 100, outcome: 'win' }),
      expect.objectContaining({ userId: 2, wagered: 50, net: -50, outcome: 'lose' }),
    ]);
    expect(notified).toEqual([[1, 1100], [2, 950]]);
    expect(last().game).toMatchObject({ phase: 'result', timeLeftMs: RESULT_MS });
    expect(last().game.seats[0]).toMatchObject({ net: 100 });

    vi.advanceTimersByTime(RESULT_MS);
    expect(last().game).toMatchObject({ phase: 'waiting', timeLeftMs: null });
    expect(last().seats.slice(0, 2).map((seat) => seat?.player.id)).toEqual([1, 2]);
    expect(settled).toHaveLength(1);
  });

  it('gives each decision its own 30 seconds and stands the hand when they run out', () => {
    const { rooms, last, settled } = start({ script: '5S 10D 10H 4S 6D 7H 2D' });
    vi.advanceTimersByTime(TURN_MS - 1);
    rooms.act(1, 'hit'); // 9 + 2 = 11
    vi.advanceTimersByTime(TURN_MS - 1);
    expect(last().game.turn).toMatchObject({ seat: 0 });
    vi.advanceTimersByTime(1);
    expect(last().game.turn).toMatchObject({ seat: 1 });
    vi.advanceTimersByTime(TURN_MS);
    expect(last().game.phase).toBe('result');
    expect(settled[0]!.results.map((r) => r.net)).toEqual([-100, -50]);
  });

  it('offers double and split only when the free balance covers them', () => {
    const rich = start({ script: '8S 10D 10H 8D 6D 7H' });
    expect(rich.last().game.turn!.actions).toEqual(['hit', 'stand', 'double', 'split']);

    const poor = start({ script: '8S 10D 10H 8D 6D 7H', bank: { 1: 199 } });
    expect(poor.last().game.turn!.actions).toEqual(['hit', 'stand']);
    expect(poor.rooms.act(1, 'double')).toEqual({ ok: false, error: 'not_allowed' });
  });

  it('refuses bets and seats nobody into a running round', () => {
    const { rooms, last } = start();
    rooms.enter(table, player(3));
    expect(rooms.sit(3, 4)).toEqual({ ok: true });
    expect(rooms.bet(3, 100)).toEqual({ ok: false, error: 'round_in_progress' });
    expect(last().game.seats[4]).toBeNull();
  });

  it('returns to waiting without paying anyone if the round cannot be saved', () => {
    const { rooms, last, sent, notified, breakSettle } = start();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    breakSettle();
    rooms.act(1, 'stand');
    rooms.act(2, 'stand');
    expect(notified).toEqual([]);
    // Раздача аннулируется сразу: выигрыши, которые никто не получил, не показываются.
    expect(last().game.phase).toBe('waiting');
    expect(sent.some((snapshot) => snapshot.game.phase === 'result')).toBe(false);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });
});

describe('leaving and skipping', () => {
  it('keeps the chips staked at a table the player left mid-round out of reach at another table', () => {
    const { rooms, last } = setup();
    rooms.bet(1, 1000);
    rooms.bet(2, 50);
    rooms.enter(other, player(1));
    rooms.sit(1, 0, true);
    expect(last().seats[0]).toMatchObject({ leaving: true });
    expect(rooms.bet(1, 5)).toEqual({ ok: false, error: 'insufficient' });

    rooms.act(2, 'stand'); // 19 против 17 — игрок 1 выигрывает 1000, раздача рассчитана
    expect(rooms.bet(1, 2000)).toEqual({ ok: true });
  });

  it('counts timeouts on both split hands as one skipped round', () => {
    const { rooms, last } = setup({ script: '8S 10D 10H 8D 6D 7H' });
    rooms.bet(1, 5);
    rooms.bet(2, 5);
    rooms.act(1, 'split');
    vi.advanceTimersByTime(TURN_MS);
    vi.advanceTimersByTime(TURN_MS);
    expect(last().game.turn).toMatchObject({ seat: 1 });
    rooms.act(2, 'stand');
    vi.advanceTimersByTime(RESULT_MS);
    expect(last().seats[0]?.player.id).toBe(1);
  });

  it('does not restart the turn clock when another player leaves', () => {
    const { rooms, last } = setup();
    rooms.bet(1, 100);
    rooms.bet(2, 50);
    vi.advanceTimersByTime(TURN_MS - 1000);
    rooms.stand(2);
    expect(last().game).toMatchObject({ turn: { seat: 0 }, timeLeftMs: 1000 });
    vi.advanceTimersByTime(1000);
    expect(last().game.phase).toBe('result');
  });

  it('plays out the hand of a player who stands up mid-round and frees the seat after the result', () => {
    const { rooms, last, settled } = setup();
    rooms.bet(1, 100);
    rooms.bet(2, 50);
    rooms.stand(1);

    expect(last().seats[0]?.player.id).toBe(1);
    expect(last().game.turn).toMatchObject({ seat: 1 });
    expect(rooms.act(1, 'hit')).toEqual({ ok: false, error: 'not_seated' });

    rooms.act(2, 'stand');
    expect(settled[0]!.results[0]).toMatchObject({ userId: 1, net: 100 });
    vi.advanceTimersByTime(RESULT_MS);
    expect(last().seats[0]).toBeNull();
    expect(last().seats[1]?.player.id).toBe(2);
  });

  it('lets a player who left mid-round sit at another table straight away', () => {
    const { rooms } = setup();
    rooms.bet(1, 100);
    rooms.bet(2, 50);
    rooms.enter(other, player(1));
    expect(rooms.sit(1, 0, true)).toEqual({ ok: true });
  });

  it('unseats a player after two rounds in a row without a bet', () => {
    const { rooms, last } = setup();
    for (let round = 0; round < 2; round++) {
      expect(last().seats[0]?.player.id).toBe(1);
      rooms.bet(2, 5);
      vi.advanceTimersByTime(BET_MS);
      rooms.act(2, 'stand');
      vi.advanceTimersByTime(RESULT_MS);
    }
    expect(last().seats[0]).toBeNull();
    expect(last().seats[1]?.player.id).toBe(2);
  });

  it('forgives a skip once the player bets again', () => {
    const { rooms, last } = setup();
    const playRound = (bettors: number[]) => {
      for (const id of bettors) rooms.bet(id, 5);
      vi.advanceTimersByTime(BET_MS);
      for (const id of bettors) rooms.act(id, 'stand');
      vi.advanceTimersByTime(RESULT_MS);
    };
    playRound([2]);
    playRound([1, 2]);
    playRound([2]);
    expect(last().seats[0]?.player.id).toBe(1);
  });

  it('counts a timed-out turn as a skip', () => {
    const { rooms, last } = setup();
    rooms.bet(1, 5);
    rooms.bet(2, 5);
    vi.advanceTimersByTime(TURN_MS); // игрок 1 поставил и не походил — первый пропуск
    rooms.act(2, 'stand');
    vi.advanceTimersByTime(RESULT_MS);
    expect(last().seats[0]?.player.id).toBe(1);

    rooms.bet(2, 5);
    vi.advanceTimersByTime(BET_MS); // игрок 1 не поставил — второй пропуск подряд
    rooms.act(2, 'stand');
    vi.advanceTimersByTime(RESULT_MS);
    expect(last().seats[0]).toBeNull();
  });

  it('unseats a player who can no longer afford the minimum bet', () => {
    const { rooms, last } = setup({ bank: { 2: 50 } });
    rooms.bet(1, 100);
    rooms.bet(2, 50);
    rooms.act(1, 'stand');
    rooms.act(2, 'stand'); // 16 против 17 — проигрывает последние 50
    vi.advanceTimersByTime(RESULT_MS);
    expect(last().seats[1]).toBeNull();
    expect(last().seats[0]?.player.id).toBe(1);
  });

  it('plays out and counts the hand of a disconnected player, then frees the seat', () => {
    const { rooms, last, settled } = setup();
    rooms.bet(1, 100);
    rooms.bet(2, 50);
    rooms.exit(1);
    expect(last().seats[0]).toMatchObject({ connected: false });

    vi.advanceTimersByTime(TURN_MS); // рука игрока 1 останавливается сама
    expect(last().game.turn).toMatchObject({ seat: 1 });
    rooms.act(2, 'stand');
    expect(settled[0]!.results[0]).toMatchObject({ userId: 1, net: 100 });

    vi.advanceTimersByTime(DISCONNECT_GRACE_MS);
    expect(last().seats[0]).toBeNull();
  });
});
