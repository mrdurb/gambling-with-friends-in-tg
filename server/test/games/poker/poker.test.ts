import type { Card, PokerMode, Rank, Suit } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { PokerHand } from '../../../src/games/poker/poker.ts';

const card = (text: string): Card => ({ rank: text.slice(0, -1) as Rank, suit: text.slice(-1) as Suit });
const cards = (text: string) => text.split(' ').filter(Boolean).map(card);
const text = (list: Card[] | null) => (list ?? []).map((c) => c.rank + c.suit).join(' ');

interface Setup {
  // Стеки по местам; места по возрастанию идут по часовой стрелке.
  stacks: Record<number, number>;
  button?: number;
  // Карманные карты по местам; кому не заданы — получает мусор, не образующий комбинаций с бордом.
  holes?: Record<number, string>;
  board?: string;
  mode?: PokerMode;
  blinds?: [number, number];
}

const FILLER = ['2C 7D', '3C 8D', '4C 9D', '2D 8C', '3D 9C', '4D 7C', '2H 7S', '3H 8S', '4H 9S'];
const DEFAULT_BOARD = 'KS QH JD 5S 5H';

// Колода раздаётся так: игрокам по часовой стрелке от места слева от кнопки — карты подряд, затем борд.
function deal({ stacks, button, holes = {}, board = DEFAULT_BOARD, mode = 'nlh', blinds = [5, 10] }: Setup) {
  const seats = Object.keys(stacks).map(Number).sort((a, b) => a - b);
  const dealer = button ?? seats[0]!;
  const from = seats.indexOf(dealer) + 1;
  const order = [...seats.slice(from), ...seats.slice(0, from)];
  const deck = [...order.flatMap((seat, index) => cards(holes[seat] ?? FILLER[index]!)), ...cards(board)];
  return new PokerHand({ mode, blinds }, new Map(seats.map((seat) => [seat, stacks[seat]!])), dealer, deck);
}

const seatOf = (hand: PokerHand, seat: number) => hand.view().seats.get(seat)!;
const stacksOf = (hand: PokerHand) => Object.fromEntries([...hand.view().seats].map(([seat, state]) => [seat, state.stack]));
// Все уравнивают или чекают до вскрытия.
function checkDown(hand: PokerHand) {
  while (hand.view().turn) {
    const { seat, toCall } = hand.view().turn!;
    expect(hand.act(seat, toCall > 0 ? 'call' : 'check')).toEqual({ ok: true });
  }
}

describe('blinds and order', () => {
  it('posts blinds left of the button and starts with the player after the big blind', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    expect(hand.phase).toBe('preflop');
    expect(hand.view()).toMatchObject({ button: 0, turn: { seat: 0, toCall: 10, minRaise: 20, maxRaise: 1000 } });
    expect([0, 1, 2].map((seat) => seatOf(hand, seat).bet)).toEqual([0, 5, 10]);
    expect(stacksOf(hand)).toEqual({ 0: 1000, 1: 995, 2: 990 });
  });

  it('goes clockwise through nine players, skipping the gaps between seats', () => {
    const stacks = Object.fromEntries([0, 1, 2, 3, 4, 5, 6, 7, 8].map((seat) => [seat, 1000]));
    const hand = deal({ stacks, button: 7 });
    expect(seatOf(hand, 8).bet).toBe(5);
    expect(seatOf(hand, 0).bet).toBe(10);
    const order: number[] = [];
    for (let i = 0; i < 9; i++) {
      order.push(hand.view().turn!.seat);
      hand.act(order.at(-1)!, i === 8 ? 'check' : 'call');
    }
    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0]);
    expect(hand.phase).toBe('flop');
    expect(hand.view().turn!.seat).toBe(8); // после флопа первым ходит малый блайнд

    const sparse = deal({ stacks: { 2: 1000, 5: 1000, 8: 1000 }, button: 8 });
    expect([2, 5, 8].map((seat) => seatOf(sparse, seat).bet)).toEqual([5, 10, 0]);
    expect(sparse.view().turn!.seat).toBe(8);
  });

  it('plays heads-up with the button as small blind acting first before the flop and last after it', () => {
    const hand = deal({ stacks: { 3: 1000, 6: 1000 }, button: 6 });
    expect(seatOf(hand, 6).bet).toBe(5);
    expect(seatOf(hand, 3).bet).toBe(10);
    expect(hand.view().turn!.seat).toBe(6);
    hand.act(6, 'call');
    expect(hand.view().turn).toMatchObject({ seat: 3, toCall: 0 }); // большой блайнд вправе повысить
    hand.act(3, 'check');
    expect(hand.phase).toBe('flop');
    expect(hand.view().turn!.seat).toBe(3);
  });

  it('gives the big blind the last word when everyone only called', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    hand.act(0, 'call');
    hand.act(1, 'call');
    expect(hand.phase).toBe('preflop');
    expect(hand.view().turn).toMatchObject({ seat: 2, toCall: 0, minRaise: 20 });
    expect(hand.act(2, 'raise', 40)).toEqual({ ok: true });
    expect(hand.view().turn).toMatchObject({ seat: 0, toCall: 30 });
  });

  it('posts a blind the player cannot afford as an all-in for less', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 1000, 2: 6 }, button: 0 });
    expect(seatOf(hand, 2)).toMatchObject({ bet: 6, stack: 0, state: 'allin' });
    expect(hand.view().turn).toMatchObject({ seat: 0, toCall: 10 });
  });
});

describe('streets', () => {
  it('deals flop, turn and river as betting rounds complete and shows the collected pot', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0, board: 'KS QH JD 5S 5H' });
    expect(hand.view().board).toEqual([]);
    hand.act(0, 'call');
    hand.act(1, 'call');
    hand.act(2, 'check');
    expect(hand.view()).toMatchObject({ phase: 'flop', pots: [30] });
    expect(text(hand.view().board)).toBe('KS QH JD');
    expect(seatOf(hand, 1).bet).toBe(0);
    for (const seat of [1, 2, 0]) hand.act(seat, 'check');
    expect(text(hand.view().board)).toBe('KS QH JD 5S');
    expect(hand.phase).toBe('turn');
    for (const seat of [1, 2, 0]) hand.act(seat, 'check');
    expect(hand.phase).toBe('river');
    expect(text(hand.view().board)).toBe('KS QH JD 5S 5H');
    for (const seat of [1, 2, 0]) hand.act(seat, 'check');
    expect(hand.phase).toBe('result');
  });

  it('gives the pot to the last player standing without showing cards', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    hand.act(0, 'raise', 30);
    hand.act(1, 'fold');
    hand.act(2, 'fold');
    expect(hand.phase).toBe('result');
    expect(stacksOf(hand)).toEqual({ 0: 1015, 1: 995, 2: 990 });
    expect(seatOf(hand, 0)).toMatchObject({ won: 25, cards: null, hand: null });
    expect(hand.results()).toEqual([
      { seat: 0, contributed: 10, won: 25, showdown: false },
      { seat: 1, contributed: 5, won: 0, showdown: false },
      { seat: 2, contributed: 10, won: 0, showdown: false },
    ]);
  });
});

describe('betting rules', () => {
  it('requires a raise to be at least the previous raise', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    expect(hand.act(0, 'raise', 15)).toEqual({ ok: false, error: 'bad_amount' });
    expect(hand.act(0, 'raise', 30)).toEqual({ ok: true }); // повышение на 20
    expect(hand.view().turn).toMatchObject({ seat: 1, toCall: 25, minRaise: 50, maxRaise: 1000 });
    expect(hand.act(1, 'raise', 49)).toEqual({ ok: false, error: 'bad_amount' });
    expect(hand.act(1, 'raise', 100)).toEqual({ ok: true }); // повышение на 70
    expect(hand.view().turn).toMatchObject({ seat: 2, toCall: 90, minRaise: 170 });
  });

  it('starts every street from a minimum bet of one big blind', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 1000 }, button: 0 });
    hand.act(0, 'call');
    hand.act(1, 'check');
    expect(hand.view().turn).toMatchObject({ seat: 1, toCall: 0, minRaise: 10, maxRaise: 990 });
    expect(hand.act(1, 'raise', 9)).toEqual({ ok: false, error: 'bad_amount' });
    expect(hand.act(1, 'raise', 10)).toEqual({ ok: true });
  });

  it('refuses a raise beyond the stack, a check facing a bet and a call with nothing to call', () => {
    const hand = deal({ stacks: { 0: 300, 1: 1000 }, button: 0 });
    expect(hand.act(0, 'raise', 301)).toEqual({ ok: false, error: 'bad_amount' });
    expect(hand.act(0, 'check')).toEqual({ ok: false, error: 'not_allowed' });
    hand.act(0, 'call');
    expect(hand.act(1, 'call')).toEqual({ ok: false, error: 'not_allowed' });
  });

  it('refuses moves out of turn, from outsiders and with malformed amounts', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    expect(hand.act(1, 'call')).toEqual({ ok: false, error: 'not_your_turn' });
    expect(hand.act(7, 'call')).toEqual({ ok: false, error: 'not_your_turn' });
    for (const amount of [undefined, Number.NaN, 30.5, -30, Infinity, '30' as unknown as number]) {
      expect(hand.act(0, 'raise', amount)).toEqual({ ok: false, error: 'bad_amount' });
    }
    expect(hand.act(0, 'jump' as never)).toEqual({ ok: false, error: 'not_allowed' });
    expect(hand.view().turn!.seat).toBe(0);
  });

  it('lets a short all-in raise through without reopening the betting for those who already acted', () => {
    // Место 0 повышает до 100, место 1 уравнивает, место 2 идёт олл-ин на 130 — меньше полного рейза (нужно 190).
    const hand = deal({ stacks: { 0: 1000, 1: 1000, 2: 130 }, button: 0 });
    hand.act(0, 'raise', 100);
    hand.act(1, 'call');
    expect(hand.view().turn).toMatchObject({ seat: 2, minRaise: 130, maxRaise: 130 });
    expect(hand.act(2, 'raise', 130)).toEqual({ ok: true });
    expect(seatOf(hand, 2).state).toBe('allin');
    // Оба уже ходили после последнего полного рейза: могут уравнять или сбросить, но не повысить.
    expect(hand.view().turn).toMatchObject({ seat: 0, toCall: 30, minRaise: 0, maxRaise: 0 });
    expect(hand.act(0, 'raise', 300)).toEqual({ ok: false, error: 'not_allowed' });
    hand.act(0, 'call');
    expect(hand.view().turn).toMatchObject({ seat: 1, toCall: 30, minRaise: 0, maxRaise: 0 });
    hand.act(1, 'call');
    expect(hand.phase).toBe('flop');
  });

  it('reopens the betting after a full all-in raise', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 1000, 2: 190 }, button: 0 });
    hand.act(0, 'raise', 100);
    hand.act(1, 'call');
    hand.act(2, 'raise', 190);
    expect(hand.view().turn).toMatchObject({ seat: 0, toCall: 90, minRaise: 280, maxRaise: 1000 });
  });

  it('lets a player who has not acted yet raise over a short all-in', () => {
    const hand = deal({ stacks: { 0: 25, 1: 1000, 2: 1000 }, button: 0 });
    hand.act(0, 'raise', 25); // олл-ин на 25: повышение на 15 при минимуме 10 — полный рейз
    expect(hand.view().turn).toMatchObject({ seat: 1, toCall: 20, minRaise: 40 });
  });

  it('treats a call for more than the stack as an all-in for what is left', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 60 }, button: 0 });
    hand.act(0, 'raise', 200);
    expect(hand.view().turn).toMatchObject({ seat: 1, toCall: 50, minRaise: 0, maxRaise: 0 });
    hand.act(1, 'call');
    expect(seatOf(hand, 1)).toMatchObject({ stack: 0, state: 'allin' });
  });

  it('offers no raise when nobody else has chips to call it', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 60 }, button: 1 });
    hand.act(1, 'raise', 60);
    expect(hand.view().turn).toMatchObject({ seat: 0, toCall: 50, minRaise: 0, maxRaise: 0 });
  });
});

describe('pots', () => {
  it('returns the part of a bet nobody could match', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 60 }, button: 0, holes: { 0: 'AS AD', 1: '2C 7D' } });
    hand.act(0, 'raise', 200);
    hand.act(1, 'call');
    // 140 лишних вернулись сразу, в банке 120.
    expect(seatOf(hand, 0).stack).toBe(940);
    expect(hand.view().pots).toEqual([120]);
    while (hand.runoutPending()) hand.dealNext();
    expect(stacksOf(hand)).toEqual({ 0: 1060, 1: 0 });
    expect(hand.results()).toEqual([
      { seat: 0, contributed: 60, won: 120, showdown: true },
      { seat: 1, contributed: 60, won: 0, showdown: true },
    ]);
  });

  it('builds side pots for three stacks and pays each pot to its best hand', () => {
    // Борд K Q J 5 5. Место 0 (стек 100) — каре пятёрок, место 1 (стек 300) — тройка королей, место 2 (1000) — пара тузов.
    const hand = deal({
      stacks: { 0: 100, 1: 300, 2: 1000 },
      button: 2,
      holes: { 0: '5D 5C', 1: 'KD KC', 2: 'AS AD' },
    });
    hand.act(2, 'raise', 1000);
    hand.act(0, 'call');
    hand.act(1, 'call');
    expect(hand.view().pots).toEqual([300, 400]);
    expect(seatOf(hand, 2).stack).toBe(700); // 700 никто не уравнял
    while (hand.runoutPending()) hand.dealNext();
    expect(stacksOf(hand)).toEqual({ 0: 300, 1: 400, 2: 700 });
    expect([0, 1, 2].map((seat) => seatOf(hand, seat).won)).toEqual([300, 400, 0]);
  });

  it('splits a pot between equal hands and gives the odd chip to the first one left of the button', () => {
    // Оба играют борд; место 2 сбросило малый блайнд 5 — в банке 25 на двоих.
    const hand = deal({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 1, board: 'AS KS QH JD 10C' });
    hand.act(1, 'call');
    hand.act(2, 'fold');
    hand.act(0, 'check');
    checkDown(hand);
    expect(hand.phase).toBe('result');
    // Слева от кнопки (место 1) первым из претендентов идёт место 0.
    expect(stacksOf(hand)).toEqual({ 0: 1003, 1: 1002, 2: 995 });
  });

  it('keeps the total number of chips at the table unchanged', () => {
    const hand = deal({ stacks: { 0: 137, 1: 422, 2: 1000, 3: 61 }, button: 3, holes: { 0: 'AS AD', 2: 'KD KC' } });
    // Блайнды у мест 0 и 1, первым ходит место 2; остальные уравнивают олл-инами на разные суммы.
    hand.act(2, 'raise', 600);
    for (const seat of [3, 0, 1]) expect(hand.act(seat, 'call')).toEqual({ ok: true });
    while (hand.runoutPending()) hand.dealNext();
    expect(hand.phase).toBe('result');
    expect(Object.values(stacksOf(hand)).reduce((sum, stack) => sum + stack, 0)).toBe(137 + 422 + 1000 + 61);
    const results = hand.results()!;
    expect(results.reduce((sum, r) => sum + r.won - r.contributed, 0)).toBe(0);
  });
});

describe('showdown', () => {
  const river = (extra: Partial<Setup> = {}) => {
    // Борд K Q J 5 5: место 0 — пара тузов, место 1 — тройка королей, место 2 — мусор.
    const hand = deal({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0, holes: { 0: 'AS AD', 1: 'KD KC', 2: '2C 7D' }, ...extra });
    hand.act(0, 'call');
    hand.act(1, 'call');
    hand.act(2, 'check');
    return hand;
  };

  it('shows only the hands that take a pot; the losers muck', () => {
    const hand = river();
    checkDown(hand);
    expect(hand.phase).toBe('result');
    expect(seatOf(hand, 1)).toMatchObject({ won: 30, hand: 'Фулл-хаус' });
    expect(text(seatOf(hand, 1).cards)).toBe('KD KC');
    expect(seatOf(hand, 0)).toMatchObject({ won: 0, cards: null, hand: null, hasCards: true });
    expect(seatOf(hand, 2)).toMatchObject({ cards: null });
    expect(hand.results()!.every((r) => r.showdown)).toBe(true);
  });

  it('lets a player show a mucked or unseen winning hand, but not a folded one', () => {
    const hand = river();
    hand.act(1, 'raise', 20);
    hand.act(2, 'fold');
    expect(hand.show(0)).toEqual({ ok: false, error: 'not_allowed' }); // раздача ещё идёт
    hand.act(0, 'call');
    checkDown(hand);

    expect(hand.show(0)).toEqual({ ok: true });
    expect(text(seatOf(hand, 0).cards)).toBe('AS AD');
    expect(seatOf(hand, 0).hand).toBe('Две пары');
    expect(hand.show(0)).toEqual({ ok: false, error: 'not_allowed' });
    expect(hand.show(2)).toEqual({ ok: false, error: 'not_allowed' });
    expect(hand.show(7)).toEqual({ ok: false, error: 'not_allowed' });

    const uncontested = deal({ stacks: { 0: 1000, 1: 1000 }, button: 0, holes: { 1: 'AS AD' } });
    uncontested.act(0, 'fold');
    expect(uncontested.show(1)).toEqual({ ok: true });
    expect(text(seatOf(uncontested, 1).cards)).toBe('AS AD');
    expect(seatOf(uncontested, 1).hand).toBeNull(); // борда нет — комбинации нет
    expect(uncontested.show(0)).toEqual({ ok: false, error: 'not_allowed' });
  });

  it('opens every hand at a showdown that involves an all-in player', () => {
    const hand = river({ stacks: { 0: 1000, 1: 1000, 2: 40 } });
    hand.act(1, 'check');
    hand.act(2, 'raise', 30); // олл-ин на флопе
    hand.act(0, 'call');
    hand.act(1, 'call');
    checkDown(hand);
    expect(hand.phase).toBe('result');
    expect([0, 1, 2].map((seat) => text(seatOf(hand, seat).cards))).toEqual(['AS AD', 'KD KC', '2C 7D']);
  });

  it('opens the hands and deals the rest of the board street by street when betting is over before the river', () => {
    const hand = deal({ stacks: { 0: 500, 1: 500 }, button: 0, holes: { 0: 'AS AD', 1: 'KD KC' } });
    hand.act(0, 'raise', 500);
    hand.act(1, 'call');
    expect(hand.runoutPending()).toBe(true);
    expect(hand.view()).toMatchObject({ phase: 'preflop', turn: null, board: [] });
    expect([0, 1].map((seat) => text(seatOf(hand, seat).cards))).toEqual(['AS AD', 'KD KC']);

    hand.dealNext();
    expect(hand.view()).toMatchObject({ phase: 'flop', turn: null });
    expect(hand.view().board).toHaveLength(3);
    hand.dealNext();
    expect(hand.phase).toBe('turn');
    hand.dealNext();
    expect(hand.phase).toBe('river');
    expect(hand.runoutPending()).toBe(true);
    hand.dealNext();
    expect(hand.phase).toBe('result');
    expect(hand.runoutPending()).toBe(false);
    expect(stacksOf(hand)).toEqual({ 0: 0, 1: 1000 });
  });

  it('runs out the board when one player with chips is left against all-ins', () => {
    const hand = river({ stacks: { 0: 1000, 1: 1000, 2: 40 } });
    hand.act(1, 'check');
    hand.act(2, 'raise', 30);
    hand.act(0, 'fold');
    hand.act(1, 'call');
    expect(hand.runoutPending()).toBe(true);
    expect(hand.view().turn).toBeNull();
  });
});

describe('timeouts and leaving', () => {
  it('checks for a player who ran out of time when a check is possible, folds otherwise', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    expect(hand.timeout()).toBe(0);
    expect(seatOf(hand, 0).state).toBe('folded');
    hand.act(1, 'call');
    expect(hand.timeout()).toBe(2);
    expect(seatOf(hand, 2).state).toBe('active');
    expect(hand.phase).toBe('flop');
  });

  it('folds the hand of a player who leaves, in or out of turn, and ends the hand if one is left', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 1000, 2: 1000 }, button: 0 });
    hand.forfeit(2); // не его ход
    expect(seatOf(hand, 2).state).toBe('folded');
    expect(hand.view().turn!.seat).toBe(0);
    hand.forfeit(0); // его ход
    expect(hand.phase).toBe('result');
    expect(stacksOf(hand)).toEqual({ 0: 1000, 1: 1010, 2: 990 });
    hand.forfeit(1);
    expect(hand.phase).toBe('result');
  });

  it('does nothing on a timeout when nobody is to act', () => {
    const hand = deal({ stacks: { 0: 500, 1: 500 }, button: 0 });
    hand.act(0, 'raise', 500);
    hand.act(1, 'call');
    expect(hand.timeout()).toBeNull();
  });
});

describe('what the table needs', () => {
  it('tells each player their own cards and keeps the stake of a seat', () => {
    const hand = deal({ stacks: { 0: 1000, 1: 1000 }, button: 0, holes: { 0: 'AS AD', 1: 'KD KC' } });
    expect(text(hand.cardsOf(0))).toBe('AS AD');
    expect(text(hand.cardsOf(1))).toBe('KD KC');
    expect(hand.cardsOf(5)).toEqual([]);
    expect(seatOf(hand, 0)).toMatchObject({ cards: null, hasCards: true });
    // Стек плюс вложенное в банк.
    expect(hand.stake(0)).toBe(1000);
    hand.act(0, 'raise', 100);
    expect(hand.stake(0)).toBe(1000);
    hand.act(1, 'fold');
    expect(hand.stake(0)).toBe(1010);
    expect(hand.stake(1)).toBe(990);
    expect(hand.stake(5)).toBe(0);
  });
});
