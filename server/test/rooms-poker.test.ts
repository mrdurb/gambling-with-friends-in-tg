import {
  DISCONNECT_GRACE_MS,
  POKER_DISCARD_MS,
  POKER_REBUY_MS,
  POKER_RESULT_MS,
  POKER_RUNOUT_MS,
  POKER_TURN_MS,
  type Card,
  type PlayerInfo,
  type PokerMode,
  type PokerView,
  type Rank,
  type Suit,
  type TableInfo,
  type TableSnapshot,
} from '@casino/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rooms } from '../src/rooms.ts';
import type { PlayerResult } from '../src/rounds.ts';
import { drive } from './helpers.ts';

const pokerTable = (mode: PokerMode = 'nlh', code = 'PPPPPPPP'): TableInfo => ({
  code,
  name: 'P',
  game: 'poker',
  inviteLink: null,
  poker: { mode, blinds: [5, 10] },
});
const bjTable: TableInfo = { code: 'BBBBBBBB', name: 'B', game: 'blackjack', inviteLink: null, poker: null };
const rouletteTable: TableInfo = { code: 'RRRRRRRR', name: 'R', game: 'roulette', inviteLink: null, poker: null };
const player = (id: number): PlayerInfo => ({ id, firstName: `Игрок ${id}`, lastName: null, photoUrl: null });
const card = (text: string): Card => ({ rank: text.slice(0, -1) as Rank, suit: text.slice(-1) as Suit });
const text = (list: Card[] | null | undefined) => (list ?? []).map((c) => c.rank + c.suit).join(' ');

// Колода по умолчанию: карманные карты подряд, игрокам по часовой стрелке слева от кнопки.
// Первые две руки — AS AD и KD KC, затем мусор; борд K Q J 5 5 — вторая рука собирает фулл-хаус.
const DECK = 'AS AD KD KC 2C 7D 3C 8D 4C 9D 2D 8C 3D 9C 4D 7C 2H 7S';
const BOARD = 'KS QH JD 5S 5H';

interface Options {
  mode?: PokerMode;
  bank?: Record<number, number>;
  // Колоды по раздачам: строка карманных карт подряд; борд всегда BOARD.
  decks?: string[];
  // Сколько игроков сразу садится (игрок N — на место N − 1, со стеком 400).
  seated?: number;
}

function setup({ mode = 'nlh', bank = {}, decks = [DECK], seated = 0 }: Options = {}) {
  const table = pokerTable(mode);
  const sent: TableSnapshot[] = [];
  const settled: { code: string; game: string; results: PlayerResult[] }[] = [];
  const notified: [number, number][] = [];
  const dealt: [number, string][] = [];
  const balances = new Map<number, number>(Object.entries(bank).map(([id, amount]) => [Number(id), amount]));
  const balanceOf = (id: number) => balances.get(id) ?? 1000;
  let failSettle = false;
  let hands = 0;

  const rooms = drive(
    new Rooms({
      broadcast: (snapshot) => sent.push(snapshot),
      balanceOf,
      settle: (code, results, game) => {
        if (failSettle) throw new Error('database is down');
        settled.push({ code, game, results });
        for (const result of results) balances.set(result.userId, balanceOf(result.userId) + result.net);
        return new Map(results.map((result) => [result.userId, balanceOf(result.userId)]));
      },
      notifyBalance: (id, balance) => notified.push([id, balance]),
      sendCards: (id, cards) => dealt.push([id, text(cards)]),
      newShoe: () => Array.from({ length: 312 }, (): Card => ({ rank: '2', suit: 'C' })),
      spinNumber: () => 1,
      // Карманные карты — с начала колоды, борд — с её конца; лишние карты посередине не мешают.
      newDeck: () => [...decks[Math.min(hands++, decks.length - 1)]!.split(' '), ...BOARD.split(' ').reverse()].map(card),
    }),
  );

  const join = (id: number, seat = id - 1, buyIn = 400) => {
    rooms.enter(table, player(id));
    return rooms.pokerSit(id, seat, buyIn);
  };
  for (let id = 1; id <= seated; id++) join(id);
  const last = (): PokerView => {
    const snapshot = sent.filter((item) => item.table.code === table.code).at(-1)!;
    if (snapshot.kind !== 'poker') throw new Error('not a poker snapshot');
    return snapshot.game;
  };
  const cardsOf = (id: number) => dealt.filter(([user]) => user === id).at(-1)?.[1];
  return { rooms, table, sent, last, settled, notified, dealt, cardsOf, balances, join, breakSettle: () => (failSettle = true) };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

// В раздаче двух игроков (места 0 и 1) кнопка — место 0: игрок 1 ставит малый блайнд и ходит первым.
// Игрок 2 получает AS AD, игрок 1 — KD KC и на борде K Q J 5 5 собирает фулл-хаус.
const seatsOf = (view: PokerView) => view.seats.map((seat) => seat && seat.player.id);

// Раздача начинается, как только сели двое, поэтому первая раздача всегда один на один. Чтобы получить
// раздачу на троих, первую сбрасываем: во второй кнопка у места 1 (игрок 2), он же ходит первым,
// малый блайнд — место 2 (игрок 3), большой — место 0 (игрок 1). Стеки: 395, 405 и 400.
// Карты второй раздачи идут игрокам 3, 1 и 2 в этом порядке.
function threeHanded(options: Options = {}) {
  const ctx = setup({ ...options, seated: 3, decks: [DECK, ...(options.decks ?? [DECK])] });
  ctx.rooms.pokerAct(1, 'fold');
  vi.advanceTimersByTime(POKER_RESULT_MS);
  expect(ctx.last()).toMatchObject({ phase: options.mode === 'pineapple' ? 'discard' : 'preflop', button: 1 });
  return ctx;
}

describe('sitting down', () => {
  it('takes a seat with a stack between 40 and 100 big blinds', () => {
    const { rooms, table, last } = setup();
    rooms.enter(table, player(1));
    expect(last()).toMatchObject({ phase: 'waiting', button: null, turn: null, board: [], pots: [] });
    expect(last().seats).toHaveLength(9);
    for (const buyIn of [399, 1001, 400.5, Number.NaN, '400' as unknown as number]) {
      expect(rooms.pokerSit(1, 0, buyIn)).toEqual({ ok: false, error: 'bad_buyin' });
    }
    for (const seat of [9, -1, 1.5, '0' as unknown as number]) expect(rooms.pokerSit(1, seat, 400)).toEqual({ ok: false, error: 'bad_seat' });
    expect(rooms.pokerSit(1, 3, 400)).toEqual({ ok: true });
    expect(last().seats[3]).toEqual({
      player: player(1),
      connected: true,
      leaving: false,
      stack: 400,
      staked: 400,
      bet: 0,
      state: 'waiting',
      cards: null,
      hasCards: false,
      discarded: false,
      won: null,
      hand: null,
    });
    expect(rooms.pokerSit(1, 4, 400)).toEqual({ ok: false, error: 'already_seated' });
    rooms.enter(table, player(2));
    expect(rooms.pokerSit(2, 3, 400)).toEqual({ ok: false, error: 'seat_taken' });
    expect(rooms.pokerSit(9, 5, 400)).toEqual({ ok: false, error: 'not_at_table' });
  });

  it('has seven seats in short deck', () => {
    const { rooms, table, last } = setup({ mode: 'short' });
    rooms.enter(table, player(1));
    expect(last().seats).toHaveLength(7);
    expect(rooms.pokerSit(1, 7, 400)).toEqual({ ok: false, error: 'bad_seat' });
    expect(rooms.pokerSit(1, 6, 400)).toEqual({ ok: true });
  });

  it('checks the stack against the free balance', () => {
    const { rooms, table } = setup({ bank: { 1: 399, 2: 700 } });
    rooms.enter(table, player(1));
    expect(rooms.pokerSit(1, 0, 400)).toEqual({ ok: false, error: 'insufficient' });
    // Фишки на кону в рулетке в стек не идут, а стек нельзя поставить в рулетке.
    rooms.enter(rouletteTable, player(2));
    rooms.rouletteBet(2, 'red', 200);
    rooms.enter(table, player(2));
    expect(rooms.pokerSit(2, 1, 501)).toEqual({ ok: false, error: 'insufficient' });
    expect(rooms.pokerSit(2, 1, 500)).toEqual({ ok: true });
    rooms.enter(rouletteTable, player(2));
    expect(rooms.rouletteBet(2, 'black', 5)).toEqual({ ok: false, error: 'insufficient' });
  });

  it('allows one seat per player across poker and blackjack', () => {
    const { rooms, table, last, join } = setup();
    join(1);
    rooms.enter(bjTable, player(1));
    expect(rooms.sit(1, 0)).toEqual({ ok: false, error: 'seated_elsewhere' });
    expect(rooms.sit(1, 0, true)).toEqual({ ok: true });
    rooms.enter(table, player(1));
    expect(last().seats[0]).toBeNull();
    expect(rooms.pokerSit(1, 0, 400)).toEqual({ ok: false, error: 'seated_elsewhere' });
  });

  it('refuses actions of other games', () => {
    const { rooms, table } = setup();
    rooms.enter(table, player(1));
    expect(rooms.sit(1, 0)).toEqual({ ok: false, error: 'wrong_game' });
    rooms.enter(bjTable, player(1));
    expect(rooms.pokerSit(1, 0, 400)).toEqual({ ok: false, error: 'wrong_game' });
    expect(rooms.pokerAct(1, 'fold')).toEqual({ ok: false, error: 'wrong_game' });
  });
});

describe('dealing', () => {
  it('waits with one player and deals as soon as a second one sits down', () => {
    const { last, join, cardsOf, dealt } = setup();
    join(1);
    expect(last().phase).toBe('waiting');
    join(2);
    expect(last()).toMatchObject({
      phase: 'preflop',
      button: 0,
      turn: { seat: 0, toCall: 5, minRaise: 20, maxRaise: 400 },
      timeLeftMs: POKER_TURN_MS,
    });
    expect(last().seats.slice(0, 2)).toMatchObject([
      { stack: 395, bet: 5, state: 'active', cards: null, hasCards: true },
      { stack: 390, bet: 10, state: 'active', cards: null, hasCards: true },
    ]);
    // Карты уходят каждому лично.
    expect(cardsOf(1)).toBe('KD KC');
    expect(cardsOf(2)).toBe('AS AD');
    expect(dealt).toHaveLength(2);
  });

  it('never puts closed cards into the shared snapshot', () => {
    const { rooms, sent } = setup({ seated: 2 });
    rooms.pokerAct(1, 'call');
    rooms.pokerAct(2, 'check');
    const leaked = sent.some((snapshot) => snapshot.kind === 'poker' && snapshot.game.seats.some((seat) => seat?.cards));
    expect(leaked).toBe(false);
  });

  it('seats a newcomer during a hand and deals them in from the next one', () => {
    const { rooms, last, join, cardsOf } = setup({ seated: 2 });
    join(3);
    expect(last().seats[2]).toMatchObject({ state: 'waiting', hasCards: false, stack: 400 });
    expect(cardsOf(3)).toBeUndefined();
    rooms.pokerAct(1, 'fold');
    vi.advanceTimersByTime(POKER_RESULT_MS);
    expect(last().phase).toBe('preflop');
    expect(last().seats[2]).toMatchObject({ state: 'active', hasCards: true });
    expect(cardsOf(3)).toBeTruthy();
  });

  it('moves the button clockwise past empty seats', () => {
    const { rooms, last, join } = setup();
    join(1, 2);
    join(2, 5);
    join(3, 7);
    expect(last().button).toBe(2);
    const buttons: (number | null)[] = [];
    for (let hand = 0; hand < 3; hand++) {
      for (let move = 0; move < 3 && last().turn; move++) rooms.pokerAct(last().seats[last().turn!.seat]!.player.id, 'fold');
      vi.advanceTimersByTime(POKER_RESULT_MS);
      buttons.push(last().button);
    }
    expect(buttons).toEqual([5, 7, 2]);
  });
});

describe('playing and settling', () => {
  const showdown = (ctx: ReturnType<typeof setup>) => {
    const { rooms, last } = ctx;
    rooms.pokerAct(1, 'call');
    rooms.pokerAct(2, 'check');
    // До вскрытия: три круга чеков после флопа. Ограничено счётчиком, чтобы ошибка не зациклила тест.
    for (let move = 0; move < 6 && last().turn && last().phase !== 'preflop'; move++) {
      rooms.pokerAct(last().seats[last().turn!.seat]!.player.id, 'check');
    }
  };

  it('settles each hand through the wallet by net result and updates the stacks', () => {
    const ctx = setup({ seated: 2 });
    const { last, settled, notified } = ctx;
    showdown(ctx);
    expect(settled).toEqual([
      {
        code: 'PPPPPPPP',
        game: 'poker',
        results: [
          { userId: 1, wagered: 10, net: 10, outcome: 'win', details: { mode: 'nlh', pot: 20, showdown: true } },
          { userId: 2, wagered: 10, net: -10, outcome: 'lose', details: { mode: 'nlh', pot: 0, showdown: true } },
        ],
      },
    ]);
    expect(notified).toEqual([
      [1, 1010],
      [2, 990],
    ]);
    expect(last()).toMatchObject({ phase: 'result', turn: null, timeLeftMs: POKER_RESULT_MS, pots: [] });
    expect(last().seats.slice(0, 2)).toMatchObject([
      { stack: 410, won: 20, hand: 'Фулл-хаус', cards: [{ rank: 'K' }, { rank: 'K' }] },
      { stack: 390, won: 0, cards: null, hand: null },
    ]);
  });

  it('shows the result for 5 seconds and then deals the next hand', () => {
    const ctx = setup({ seated: 2 });
    showdown(ctx);
    vi.advanceTimersByTime(POKER_RESULT_MS - 1);
    expect(ctx.last().phase).toBe('result');
    vi.advanceTimersByTime(1);
    expect(ctx.last()).toMatchObject({ phase: 'preflop', button: 1 });
    expect(ctx.last().seats.slice(0, 2)).toMatchObject([
      { stack: 400, bet: 10, won: null },
      { stack: 385, bet: 5 },
    ]);
  });

  it('lets a player show a mucked hand while the result is on screen', () => {
    const ctx = setup({ seated: 2 });
    expect(ctx.rooms.pokerShow(2)).toEqual({ ok: false, error: 'not_allowed' });
    showdown(ctx);
    expect(ctx.rooms.pokerShow(2)).toEqual({ ok: true });
    expect(text(ctx.last().seats[1]!.cards)).toBe('AS AD');
    ctx.rooms.enter(ctx.table, player(3));
    expect(ctx.rooms.pokerShow(3)).toEqual({ ok: false, error: 'not_seated' });
  });

  it('deals the rest of the board with pauses when everyone is all-in', () => {
    const { rooms, last, settled } = setup({ seated: 2 });
    rooms.pokerAct(1, 'raise', 400);
    rooms.pokerAct(2, 'call');
    expect(last()).toMatchObject({ phase: 'preflop', board: [], turn: null, timeLeftMs: POKER_RUNOUT_MS });
    expect(last().seats.slice(0, 2).map((seat) => text(seat!.cards))).toEqual(['KD KC', 'AS AD']);
    vi.advanceTimersByTime(POKER_RUNOUT_MS);
    expect(last().board).toHaveLength(3);
    vi.advanceTimersByTime(POKER_RUNOUT_MS * 2);
    expect(last()).toMatchObject({ phase: 'river' });
    expect(settled).toEqual([]);
    vi.advanceTimersByTime(POKER_RUNOUT_MS);
    expect(last().phase).toBe('result');
    expect(settled[0]!.results.map((result) => result.net)).toEqual([400, -400]);
  });

  it('voids the hand and keeps the stacks if it cannot be saved', () => {
    const ctx = setup({ seated: 2 });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    ctx.breakSettle();
    showdown(ctx);
    expect(ctx.notified).toEqual([]);
    expect(ctx.sent.some((snapshot) => snapshot.kind === 'poker' && snapshot.game.phase === 'result')).toBe(false);
    // Сразу следующая раздача с прежними стеками.
    expect(ctx.last().phase).toBe('preflop');
    expect(ctx.last().seats.slice(0, 2).map((seat) => seat!.stack + seat!.bet)).toEqual([400, 400]);
    logged.mockRestore();
  });
});

describe('timers and skips', () => {
  it('folds or checks for a player after 30 seconds', () => {
    const { last } = setup({ seated: 2 });
    vi.advanceTimersByTime(POKER_TURN_MS - 1);
    expect(last().phase).toBe('preflop');
    vi.advanceTimersByTime(1);
    expect(last()).toMatchObject({ phase: 'result' });
    expect(last().seats[0]).toMatchObject({ state: 'folded' });
  });

  it('unseats a player after timing out in two hands in a row', () => {
    const { last } = threeHanded();
    // Все молчат. Вторая раздача: игроки 2 и 3 пропускают ход, банк забирает игрок 1.
    vi.advanceTimersByTime(POKER_TURN_MS * 2);
    expect(last().phase).toBe('result');
    vi.advanceTimersByTime(POKER_RESULT_MS);
    expect(seatsOf(last()).slice(0, 3)).toEqual([1, 2, 3]);
    // Третья раздача: кнопка у игрока 3, он пропускает второй раз подряд и встаёт.
    // У игрока 1 это первый пропуск, у игрока 2 — по-прежнему один: в этой раздаче ему ходить не пришлось.
    vi.advanceTimersByTime(POKER_TURN_MS * 2 + POKER_RESULT_MS);
    expect(seatsOf(last()).slice(0, 3)).toEqual([1, 2, null]);
  });

  it('forgives a skip once the player makes a move', () => {
    const { rooms, last } = setup({ seated: 2 });
    vi.advanceTimersByTime(POKER_TURN_MS + POKER_RESULT_MS); // игрок 1 промолчал
    // Вторая раздача: кнопка у игрока 2, он ходит первым.
    rooms.pokerAct(2, 'call');
    rooms.pokerAct(1, 'check');
    rooms.pokerAct(1, 'check');
    rooms.pokerAct(2, 'raise', 10);
    rooms.pokerAct(1, 'fold');
    vi.advanceTimersByTime(POKER_RESULT_MS + POKER_TURN_MS + POKER_RESULT_MS); // игрок 1 снова промолчал — первый пропуск заново
    expect(last().seats[0]?.player.id).toBe(1);
  });

  it('does not restart the turn clock when another player leaves', () => {
    const { rooms, last } = threeHanded();
    vi.advanceTimersByTime(POKER_TURN_MS - 1000);
    rooms.pokerLeave(1); // большой блайнд уходит не в свой ход
    expect(last()).toMatchObject({ turn: { seat: 1 }, timeLeftMs: 1000 });
    expect(last().seats[0]).toMatchObject({ state: 'folded', leaving: true });
  });

  it('gives 15 seconds to discard in 3-1, then discards the lowest card and starts the betting', () => {
    const { rooms, last, cardsOf } = setup({ mode: 'pineapple', seated: 2, decks: ['9C AS AD 3C KD KC'] });
    expect(last()).toMatchObject({ phase: 'discard', turn: null, timeLeftMs: POKER_DISCARD_MS });
    expect(cardsOf(2)).toBe('9C AS AD');
    expect(rooms.pokerDiscard(2, 0)).toEqual({ ok: true });
    expect(cardsOf(2)).toBe('AS AD');
    expect(last().phase).toBe('discard');
    expect(last().seats.slice(0, 2)).toMatchObject([{ discarded: false }, { discarded: true }]);
    vi.advanceTimersByTime(5000);
    rooms.enter(pokerTable('pineapple'), player(9)); // зритель получает свежий снимок
    expect(last().timeLeftMs).toBe(POKER_DISCARD_MS - 5000);
    vi.advanceTimersByTime(POKER_DISCARD_MS - 5000);
    expect(last()).toMatchObject({ phase: 'preflop', timeLeftMs: POKER_TURN_MS });
    expect(cardsOf(1)).toBe('KD KC');
  });

  it('starts the betting at once when everyone has discarded', () => {
    const { rooms, last } = setup({ mode: 'pineapple', seated: 2, decks: ['9C AS AD 3C KD KC'] });
    rooms.pokerDiscard(1, 0);
    rooms.pokerDiscard(2, 0);
    expect(last().phase).toBe('preflop');
    expect(rooms.pokerDiscard(1, 0)).toEqual({ ok: false, error: 'not_allowed' });
  });
});

describe('running out of chips and rebuying', () => {
  const bust = (ctx: ReturnType<typeof setup>) => {
    ctx.rooms.pokerAct(1, 'raise', 400);
    ctx.rooms.pokerAct(2, 'call');
    vi.advanceTimersByTime(POKER_RUNOUT_MS * 4);
  };

  it('keeps a player with no chips at the table and waits for a rebuy', () => {
    const ctx = setup({ seated: 2 });
    bust(ctx);
    vi.advanceTimersByTime(POKER_RESULT_MS);
    expect(ctx.last().phase).toBe('waiting');
    expect(ctx.last().seats.slice(0, 2)).toMatchObject([{ stack: 800 }, { stack: 0, state: 'waiting' }]);
    // Баланс игрока 2 — 600: стек до 100 больших блайндов, но не меньше 40.
    expect(ctx.rooms.pokerRebuy(2, 399)).toEqual({ ok: false, error: 'bad_amount' });
    expect(ctx.rooms.pokerRebuy(2, 1001)).toEqual({ ok: false, error: 'bad_amount' });
    expect(ctx.rooms.pokerRebuy(2, 601)).toEqual({ ok: false, error: 'insufficient' });
    expect(ctx.rooms.pokerRebuy(2, 500)).toEqual({ ok: true });
    expect(ctx.last().phase).toBe('preflop');
    expect(ctx.last().seats[1]).toMatchObject({ state: 'active' });
    expect(ctx.last().seats[1]!.stack + ctx.last().seats[1]!.bet).toBe(500);
  });

  it('unseats a player who sat out two hands without chips', () => {
    // Вторая раздача: игрок 3 — тузы, игрок 1 — мусор, игрок 2 сбрасывает королей.
    const { rooms, last } = threeHanded({ decks: ['AS AD 2C 7D KD KC', DECK] });
    rooms.pokerAct(2, 'fold');
    rooms.pokerAct(3, 'raise', 400);
    rooms.pokerAct(1, 'call'); // олл-ин на 395
    vi.advanceTimersByTime(POKER_RUNOUT_MS * 4);
    expect(last()).toMatchObject({ phase: 'result' });
    expect(last().seats[0]).toMatchObject({ stack: 0, won: 0 });
    vi.advanceTimersByTime(POKER_RESULT_MS);

    for (let hand = 0; hand < 2; hand++) {
      expect(last().seats[0]).toMatchObject({ stack: 0, state: 'waiting' });
      rooms.pokerAct(last().seats[last().turn!.seat]!.player.id, 'fold');
      vi.advanceTimersByTime(POKER_RESULT_MS);
    }
    expect(last().seats[0]).toBeNull();
    expect(last().phase).toBe('preflop');
  });

  it('allows a rebuy only when the player is out of the current hand, up to 100 big blinds in total', () => {
    const { rooms, table, last } = threeHanded({ bank: { 1: 5000 } });
    rooms.pokerAct(2, 'call');
    rooms.pokerAct(3, 'call');
    expect(rooms.pokerRebuy(1, 100)).toEqual({ ok: false, error: 'in_hand' });
    rooms.pokerAct(1, 'fold');
    expect(last().phase).toBe('flop');
    // Перед игроком осталось 385 (большой блайнд 10 ушёл в банк): докупить можно до 1000, то есть не больше 615.
    expect(rooms.pokerRebuy(1, 616)).toEqual({ ok: false, error: 'bad_amount' });
    for (const amount of [0, -5, 10.5, Number.NaN]) expect(rooms.pokerRebuy(1, amount)).toEqual({ ok: false, error: 'bad_amount' });
    expect(rooms.pokerRebuy(1, 14)).toEqual({ ok: false, error: 'bad_amount' }); // после докупки должно быть не меньше 400
    expect(rooms.pokerRebuy(1, 615)).toEqual({ ok: true });
    expect(last().seats[0]).toMatchObject({ stack: 1000, staked: 1010, state: 'folded' });
    expect(rooms.pokerRebuy(9, 100)).toEqual({ ok: false, error: 'not_at_table' });
    rooms.enter(table, player(8));
    expect(rooms.pokerRebuy(8, 100)).toEqual({ ok: false, error: 'not_seated' });

    // После расчёта раздачи докупленное никуда не делось.
    rooms.pokerAct(3, 'raise', 10);
    rooms.pokerAct(2, 'fold');
    expect(last()).toMatchObject({ phase: 'result' });
    expect(last().seats[0]).toMatchObject({ stack: 1000, staked: 1000 });
  });

  it('gives a player without chips a minute to rebuy when no hand can start, then frees the seat', () => {
    const ctx = setup({ seated: 2 });
    bust(ctx);
    vi.advanceTimersByTime(POKER_RESULT_MS);
    expect(ctx.last().seats[1]).toMatchObject({ stack: 0 });
    vi.advanceTimersByTime(POKER_REBUY_MS - 1);
    expect(ctx.last().seats[1]).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(ctx.last().seats[1]).toBeNull();
  });

  it('keeps the seat when the player rebuys within that minute', () => {
    const ctx = setup({ seated: 2 });
    bust(ctx);
    vi.advanceTimersByTime(POKER_RESULT_MS + 1000);
    ctx.rooms.pokerRebuy(2, 400);
    vi.advanceTimersByTime(POKER_REBUY_MS);
    expect(ctx.last().seats[1]).not.toBeNull();
  });
});

describe('quiet table', () => {
  it('does not broadcast anything for a refused move', () => {
    const { rooms, sent } = setup({ seated: 2 });
    const before = sent.length;
    expect(rooms.pokerAct(2, 'check')).toEqual({ ok: false, error: 'not_your_turn' });
    expect(rooms.pokerAct(1, 'raise', 3)).toEqual({ ok: false, error: 'bad_amount' });
    expect(rooms.pokerShow(1)).toEqual({ ok: false, error: 'not_allowed' });
    expect(sent.length).toBe(before);
  });

  it('sends cards only to players who have this table open', () => {
    const { rooms, table, dealt } = setup({ seated: 2 });
    rooms.enter(bjTable, player(2)); // игрок 2 ушёл смотреть другой стол
    const before = dealt.length;
    rooms.enter(table, player(9));
    rooms.pokerAct(1, 'fold');
    vi.advanceTimersByTime(POKER_RESULT_MS);
    // Конец раздачи и новая раздача: игроку 2 ничего не приходит, пока он не вернётся.
    expect(dealt.slice(before).filter(([id]) => id === 2)).toEqual([]);
    rooms.enter(table, player(2));
    expect(dealt.at(-1)![0]).toBe(2);
    expect(dealt.at(-1)![1]).not.toBe('');
  });

  it('keeps an all-in player in the hand when they stand up', () => {
    const { rooms, last, settled } = setup({ seated: 2 });
    rooms.pokerAct(1, 'raise', 400);
    rooms.pokerAct(2, 'call');
    rooms.pokerLeave(1); // у игрока 1 фулл-хаус, он уже в олл-ине
    vi.advanceTimersByTime(POKER_RUNOUT_MS * 4);
    expect(settled[0]!.results.map((result) => result.net)).toEqual([400, -400]);
    vi.advanceTimersByTime(POKER_RESULT_MS);
    expect(last().seats[0]).toBeNull();
  });
});

describe('leaving and losing connection', () => {
  it('folds the hand of a player who stands up mid-hand and frees the seat after it is settled', () => {
    const { rooms, last, settled } = setup({ seated: 2 });
    rooms.pokerLeave(2);
    expect(last()).toMatchObject({ phase: 'result' });
    expect(last().seats[1]).toMatchObject({ leaving: true, state: 'folded' });
    expect(settled[0]!.results).toMatchObject([
      { userId: 1, net: 10 },
      { userId: 2, net: -10 },
    ]);
    vi.advanceTimersByTime(POKER_RESULT_MS);
    expect(last()).toMatchObject({ phase: 'waiting' });
    expect(seatsOf(last()).slice(0, 2)).toEqual([1, null]);
    // Ушедший может сразу сесть за другой стол.
    rooms.enter(bjTable, player(2));
    expect(rooms.sit(2, 0)).toEqual({ ok: true });
  });

  it('frees the seat at once when the player is not in a hand', () => {
    const { rooms, last, join } = setup();
    join(1);
    rooms.pokerLeave(1);
    expect(last().seats[0]).toBeNull();
    expect(rooms.pokerSit(1, 0, 400)).toEqual({ ok: true });
  });

  it('keeps the seat of a disconnected player for a minute and plays their turns by the clock', () => {
    const { rooms, table, last, cardsOf, dealt } = setup({ seated: 2 });
    rooms.exit(1);
    expect(last().seats[0]).toMatchObject({ connected: false });
    const before = dealt.length;
    rooms.enter(table, player(1));
    expect(last().seats[0]).toMatchObject({ connected: true });
    // Вернувшемуся карты приходят снова.
    expect(dealt.length).toBe(before + 1);
    expect(cardsOf(1)).toBe('KD KC');

    rooms.exit(1);
    vi.advanceTimersByTime(POKER_TURN_MS);
    expect(last().seats[0]).toMatchObject({ state: 'folded' });
    vi.advanceTimersByTime(DISCONNECT_GRACE_MS);
    expect(last().seats[0]).toBeNull();
  });

  it('forgets the table once nobody sits or watches', () => {
    const { rooms, table, last, join } = setup();
    join(1);
    join(2);
    rooms.pokerLeave(1);
    vi.advanceTimersByTime(POKER_RESULT_MS);
    rooms.pokerLeave(2);
    rooms.exit(1);
    rooms.exit(2);
    rooms.enter(table, player(3));
    expect(last()).toMatchObject({ phase: 'waiting', button: null });
  });
});
