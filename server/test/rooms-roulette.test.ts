import {
  RESULT_MS,
  ROULETTE_BET_MS,
  SPIN_MS,
  type Card,
  type PlayerInfo,
  type RouletteView,
  type TableInfo,
  type TableSnapshot,
} from '@casino/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rooms } from '../src/rooms.ts';
import type { PlayerResult } from '../src/rounds.ts';

const table: TableInfo = { code: 'RRRRRRRR', name: 'R', game: 'roulette', inviteLink: null };
const bjTable: TableInfo = { code: 'BBBBBBBB', name: 'B', game: 'blackjack', inviteLink: null };
const player = (id: number): PlayerInfo => ({ id, firstName: `Игрок ${id}`, lastName: null, photoUrl: null });

// Игроки 1 и 2 открыли стол рулетки. Колесо выдаёт числа из numbers по очереди (по умолчанию всегда 1 — красное).
function setup({ numbers = [1], bank = {} as Record<number, number>, players = [1, 2] } = {}) {
  const sent: TableSnapshot[] = [];
  const settled: { code: string; game: string; results: PlayerResult[] }[] = [];
  const notified: [number, number][] = [];
  const balances = new Map<number, number>(Object.entries(bank).map(([id, amount]) => [Number(id), amount]));
  const balanceOf = (id: number) => balances.get(id) ?? 1000;
  let failSettle = false;
  let spins = 0;

  const rooms = new Rooms({
    broadcast: (snapshot) => sent.push(snapshot),
    balanceOf,
    settle: (code, results, game) => {
      if (failSettle) throw new Error('database is down');
      settled.push({ code, game, results });
      for (const result of results) balances.set(result.userId, balanceOf(result.userId) + result.net);
      return new Map(results.map((result) => [result.userId, balanceOf(result.userId)]));
    },
    notifyBalance: (id, balance) => notified.push([id, balance]),
    newShoe: () => Array.from({ length: 312 }, (): Card => ({ rank: '2', suit: 'C' })),
    spinNumber: () => numbers[Math.min(spins++, numbers.length - 1)]!,
  });

  for (const id of players) rooms.enter(table, player(id));
  const last = (): RouletteView => {
    const snapshot = sent.filter((item) => item.table.code === table.code).at(-1)!;
    if (snapshot.kind !== 'roulette') throw new Error('not a roulette snapshot');
    return snapshot.game;
  };
  const playRound = () => {
    rooms.rouletteBet(1, 'red', 5);
    rooms.rouletteReady(1);
    vi.advanceTimersByTime(SPIN_MS + RESULT_MS);
  };
  return { rooms, sent, last, settled, notified, balances, playRound, breakSettle: () => (failSettle = true) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('betting', () => {
  it('shows everyone who has the table open, in order of arrival', () => {
    const { last } = setup();
    expect(last()).toEqual({
      phase: 'waiting',
      players: [
        { player: player(1), connected: true, bets: {}, ready: false, net: null },
        { player: player(2), connected: true, bets: {}, ready: false, net: null },
      ],
      timeLeftMs: null,
      number: null,
      history: [],
    });
  });

  it('starts the 25 second countdown on the first bet', () => {
    const { rooms, last } = setup();
    expect(rooms.rouletteBet(1, 'red', 10)).toEqual({ ok: true });
    expect(last()).toMatchObject({ phase: 'betting', timeLeftMs: ROULETTE_BET_MS, players: [{ bets: { red: 10 } }, { bets: {} }] });
    vi.advanceTimersByTime(4000);
    rooms.rouletteBet(2, 'n7', 5);
    expect(last().timeLeftMs).toBe(ROULETTE_BET_MS - 4000);
  });

  it('cancels the countdown when the last bets are cleared', () => {
    const { rooms, last } = setup();
    rooms.rouletteBet(1, 'red', 10);
    expect(rooms.rouletteClear(1)).toEqual({ ok: true });
    expect(last()).toMatchObject({ phase: 'waiting', timeLeftMs: null });
    vi.advanceTimersByTime(ROULETTE_BET_MS);
    expect(last().phase).toBe('waiting');
  });

  it('checks bets against the balance left after earlier bets', () => {
    const { rooms } = setup({ bank: { 1: 30 } });
    expect(rooms.rouletteBet(1, 'red', 25)).toEqual({ ok: true });
    expect(rooms.rouletteBet(1, 'black', 10)).toEqual({ ok: false, error: 'insufficient' });
    expect(rooms.rouletteBet(1, 'black', 5)).toEqual({ ok: true });
  });

  it('refuses roulette actions from someone who has no table open', () => {
    const { rooms } = setup();
    expect(rooms.rouletteBet(9, 'red', 10)).toEqual({ ok: false, error: 'not_at_table' });
    expect(rooms.rouletteReady(9)).toEqual({ ok: false, error: 'not_at_table' });
    expect(rooms.rouletteClear(9)).toEqual({ ok: false, error: 'not_at_table' });
  });
});

describe('starting the spin', () => {
  it('spins at once when every present bettor is ready, without waiting for spectators', () => {
    const { rooms, last } = setup({ players: [1, 2, 3] });
    rooms.rouletteBet(1, 'red', 10);
    rooms.rouletteBet(2, 'black', 10);
    rooms.rouletteReady(1);
    expect(last()).toMatchObject({ phase: 'betting', players: [{ ready: true }, { ready: false }, { ready: false }] });
    rooms.rouletteReady(2);
    expect(last()).toMatchObject({ phase: 'spinning', number: 1, timeLeftMs: SPIN_MS });
  });

  it('spins when the countdown ends, playing bets that were not confirmed', () => {
    const { rooms, last, settled } = setup();
    rooms.rouletteBet(1, 'red', 10);
    rooms.rouletteBet(2, 'black', 10);
    rooms.rouletteReady(1);
    vi.advanceTimersByTime(ROULETTE_BET_MS - 1);
    expect(last().phase).toBe('betting');
    vi.advanceTimersByTime(1);
    expect(last().phase).toBe('spinning');
    vi.advanceTimersByTime(SPIN_MS);
    expect(settled[0]!.results.map((result) => result.net)).toEqual([10, -10]);
  });

  it('spins when the only bettor who was not ready clears their bets', () => {
    const { rooms, last } = setup();
    rooms.rouletteBet(1, 'red', 10);
    rooms.rouletteBet(2, 'black', 10);
    rooms.rouletteReady(1);
    rooms.rouletteClear(2);
    expect(last().phase).toBe('spinning');
  });

  it('keeps a bettor who left in the round but does not wait for them', () => {
    const { rooms, last, settled } = setup();
    rooms.rouletteBet(1, 'red', 10);
    rooms.rouletteBet(2, 'black', 10);
    rooms.exit(2);
    expect(last()).toMatchObject({ phase: 'betting', players: [{ connected: true }, { player: { id: 2 }, connected: false, bets: { black: 10 } }] });
    rooms.rouletteReady(1);
    expect(last().phase).toBe('spinning');
    vi.advanceTimersByTime(SPIN_MS);
    expect(settled[0]!.results).toHaveLength(2);
    vi.advanceTimersByTime(RESULT_MS);
    expect(last().players.map((item) => item.player.id)).toEqual([1]);
  });

  it('does not spin just because a bettor who was still betting lost connection', () => {
    const { rooms, last, sent } = setup();
    rooms.rouletteBet(1, 'red', 10);
    rooms.rouletteBet(2, 'black', 10);
    rooms.rouletteReady(2);
    const before = sent.length;
    rooms.exit(1);
    expect(last().phase).toBe('betting');
    expect(sent.length).toBe(before + 1);

    // Вернулся — может доставить и подтвердить.
    rooms.enter(table, player(1));
    expect(rooms.rouletteBet(1, 'n3', 5)).toEqual({ ok: true });
    rooms.rouletteReady(1);
    expect(last().phase).toBe('spinning');
  });

  it('waits for the countdown when every bettor has left', () => {
    const { rooms, last } = setup({ players: [1, 2] });
    rooms.rouletteBet(1, 'red', 10);
    rooms.exit(1);
    expect(last().phase).toBe('betting');
    vi.advanceTimersByTime(ROULETTE_BET_MS);
    expect(last().phase).toBe('spinning');
  });
});

describe('spin and result', () => {
  it('settles through the wallet only when the wheel stops, then shows the result for 3 seconds', () => {
    const { rooms, last, settled, notified } = setup();
    rooms.rouletteBet(1, 'n1', 10);
    rooms.rouletteBet(1, 'black', 20);
    rooms.rouletteReady(1);
    vi.advanceTimersByTime(SPIN_MS - 1);
    expect(settled).toEqual([]);
    expect(notified).toEqual([]);
    expect(last().players[0]!.net).toBeNull();

    vi.advanceTimersByTime(1);
    expect(settled).toEqual([
      {
        code: table.code,
        game: 'roulette',
        results: [{ userId: 1, wagered: 30, net: 330, outcome: 'win', details: { number: 1, bets: { n1: 10, black: 20 } } }],
      },
    ]);
    expect(notified).toEqual([[1, 1330]]);
    expect(last()).toMatchObject({ phase: 'result', number: 1, timeLeftMs: RESULT_MS, players: [{ net: 330 }, { net: null }] });

    vi.advanceTimersByTime(RESULT_MS);
    expect(last()).toMatchObject({ phase: 'waiting', number: null, timeLeftMs: null, players: [{ bets: {}, ready: false, net: null }, {}] });
  });

  it('refuses bets while the wheel spins and while the result is shown', () => {
    const { rooms } = setup();
    rooms.rouletteBet(1, 'red', 10);
    rooms.rouletteReady(1);
    expect(rooms.rouletteBet(2, 'red', 10)).toEqual({ ok: false, error: 'round_in_progress' });
    vi.advanceTimersByTime(SPIN_MS);
    expect(rooms.rouletteBet(2, 'red', 10)).toEqual({ ok: false, error: 'round_in_progress' });
  });

  it('remembers the last five numbers, newest first', () => {
    const { last, playRound } = setup({ numbers: [1, 2, 3, 4, 5, 6, 7] });
    for (let round = 0; round < 3; round++) playRound();
    expect(last().history).toEqual([3, 2, 1]);
    for (let round = 0; round < 4; round++) playRound();
    expect(last().history).toEqual([7, 6, 5, 4, 3]);
  });

  it('voids the round without showing a result if it cannot be saved', () => {
    const { rooms, last, sent, notified, breakSettle } = setup();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    breakSettle();
    rooms.rouletteBet(1, 'red', 10);
    rooms.rouletteReady(1);
    vi.advanceTimersByTime(SPIN_MS);
    expect(notified).toEqual([]);
    expect(last()).toMatchObject({ phase: 'waiting', history: [] });
    expect(sent.some((snapshot) => snapshot.kind === 'roulette' && snapshot.game.phase === 'result')).toBe(false);
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  it('forgets the table and its history once nobody is there', () => {
    const { rooms, last, playRound } = setup();
    playRound();
    expect(last().history).toEqual([1]);
    rooms.exit(1);
    rooms.exit(2);
    rooms.enter(table, player(1));
    expect(last().history).toEqual([]);
  });
});

describe('two games side by side', () => {
  it('keeps chips staked on roulette out of reach at a blackjack table, and the other way round', () => {
    const { rooms } = setup({ bank: { 1: 100, 2: 100 } });
    rooms.rouletteBet(1, 'red', 80);
    rooms.enter(bjTable, player(1));
    rooms.sit(1, 0);
    rooms.enter(bjTable, player(2));
    rooms.sit(2, 1);
    expect(rooms.bet(1, 25)).toEqual({ ok: false, error: 'insufficient' });
    expect(rooms.bet(1, 20)).toEqual({ ok: true });

    expect(rooms.bet(2, 80)).toEqual({ ok: true }); // оба поставили — раздача идёт, ставка игрока 2 на кону
    rooms.enter(table, player(2));
    expect(rooms.rouletteBet(2, 'red', 25)).toEqual({ ok: false, error: 'insufficient' });
    expect(rooms.rouletteBet(2, 'red', 20)).toEqual({ ok: true });
  });

  it('refuses actions meant for the other game', () => {
    const { rooms } = setup();
    expect(rooms.sit(1, 0)).toEqual({ ok: false, error: 'wrong_game' });
    rooms.enter(bjTable, player(1));
    expect(rooms.rouletteBet(1, 'red', 10)).toEqual({ ok: false, error: 'wrong_game' });
    expect(rooms.rouletteReady(1)).toEqual({ ok: false, error: 'wrong_game' });
    expect(rooms.rouletteClear(1)).toEqual({ ok: false, error: 'wrong_game' });
  });
});
