import { MAX_BET, RED_NUMBERS, ROULETTE_FIELDS, WHEEL_ORDER, roulettePayout, rouletteWins, type RouletteField } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { Roulette } from '../../src/games/roulette.ts';

const RICH = 1_000_000;

// Один игрок ставит по 10 на каждое из полей и получает чистый результат при выпавшем числе.
function netOf(fields: RouletteField[], number: number): number {
  const game = new Roulette();
  for (const field of fields) expect(game.bet(1, field, 10, RICH)).toEqual({ ok: true });
  game.spin(number);
  game.finish();
  return game.results()![0]!.net;
}

describe('wheel and fields', () => {
  it('has 37 distinct numbers on the wheel with alternating colours around zero', () => {
    expect(new Set(WHEEL_ORDER).size).toBe(37);
    expect([...WHEEL_ORDER].sort((a, b) => a - b)).toEqual(Array.from({ length: 37 }, (_, n) => n));
    expect(WHEEL_ORDER[0]).toBe(0);
    expect(RED_NUMBERS.size).toBe(18);
    const colours = WHEEL_ORDER.slice(1).map((n) => RED_NUMBERS.has(n));
    colours.forEach((red, index) => {
      if (index > 0) expect(red).not.toBe(colours[index - 1]);
    });
  });

  it('lists 49 fields: 37 numbers and 12 groups', () => {
    expect(ROULETTE_FIELDS).toHaveLength(49);
    expect(new Set(ROULETTE_FIELDS).size).toBe(49);
  });

  it('gives every group exactly as many winning numbers as its payout implies', () => {
    const count = (field: RouletteField) => Array.from({ length: 37 }, (_, n) => n).filter((n) => rouletteWins(field, n)).length;
    for (const field of ROULETTE_FIELDS) {
      const expected = { 35: 1, 2: 12, 1: 18 }[roulettePayout(field)];
      expect(count(field), field).toBe(expected);
    }
  });
});

describe('payouts', () => {
  it('pays 35 to 1 on a number', () => {
    expect(netOf(['n17'], 17)).toBe(350);
    expect(netOf(['n17'], 18)).toBe(-10);
  });

  it('pays 1 to 1 on colour, parity and halves', () => {
    expect(netOf(['red'], 1)).toBe(10);
    expect(netOf(['red'], 2)).toBe(-10);
    expect(netOf(['black'], 2)).toBe(10);
    expect(netOf(['even'], 36)).toBe(10);
    expect(netOf(['odd'], 36)).toBe(-10);
    expect(netOf(['odd'], 35)).toBe(10);
    expect(netOf(['low'], 18)).toBe(10);
    expect(netOf(['low'], 19)).toBe(-10);
    expect(netOf(['high'], 19)).toBe(10);
  });

  it('pays 2 to 1 on dozens and columns', () => {
    expect(netOf(['dozen1'], 12)).toBe(20);
    expect(netOf(['dozen1'], 13)).toBe(-10);
    expect(netOf(['dozen2'], 13)).toBe(20);
    expect(netOf(['dozen3'], 36)).toBe(20);
    expect(netOf(['col1'], 34)).toBe(20);
    expect(netOf(['col2'], 35)).toBe(20);
    expect(netOf(['col3'], 36)).toBe(20);
    expect(netOf(['col3'], 34)).toBe(-10);
  });

  it('lets only the zero bet win on zero', () => {
    const groups = ROULETTE_FIELDS.filter((field) => !field.startsWith('n'));
    expect(netOf(groups, 0)).toBe(-10 * groups.length);
    expect(netOf(['n0'], 0)).toBe(350);
  });

  it('sums winning and losing bets into one net result', () => {
    // 17 — чёрное, нечётное: число +350, чёрное +10, красное −10, чёт −10.
    expect(netOf(['n17', 'black', 'red', 'even'], 17)).toBe(340);
  });

  it('reports wagered total, outcome and details for statistics', () => {
    const game = new Roulette();
    game.bet(1, 'red', 10, RICH);
    game.bet(1, 'black', 10, RICH);
    game.bet(2, 'n5', 20, RICH);
    game.spin(1);
    game.finish();
    expect(game.results()).toEqual([
      { userId: 1, wagered: 20, net: 0, outcome: 'push', details: { number: 1, bets: { red: 10, black: 10 } } },
      { userId: 2, wagered: 20, net: -20, outcome: 'lose', details: { number: 1, bets: { n5: 20 } } },
    ]);
  });
});

describe('betting', () => {
  it('adds a repeated bet to the same field', () => {
    const game = new Roulette();
    game.bet(1, 'red', 10, RICH);
    game.bet(1, 'red', 25, RICH);
    expect(game.view().players).toEqual([{ userId: 1, bets: { red: 35 }, ready: false, net: null }]);
    expect(game.stake(1)).toBe(35);
  });

  it('moves from waiting to betting on the first bet', () => {
    const game = new Roulette();
    expect(game.phase).toBe('waiting');
    game.bet(1, 'red', 5, RICH);
    expect(game.phase).toBe('betting');
  });

  it('refuses unknown fields and bad amounts', () => {
    const game = new Roulette();
    expect(game.bet(1, 'n37' as RouletteField, 10, RICH)).toEqual({ ok: false, error: 'bad_field' });
    expect(game.bet(1, 'toString' as RouletteField, 10, RICH)).toEqual({ ok: false, error: 'bad_field' });
    expect(game.bet(1, 'red', 4, RICH)).toEqual({ ok: false, error: 'bad_bet' });
    expect(game.bet(1, 'red', 5.5, RICH)).toEqual({ ok: false, error: 'bad_bet' });
    expect(game.bet(1, 'red', Number.NaN, RICH)).toEqual({ ok: false, error: 'bad_bet' });
    expect(game.phase).toBe('waiting');
  });

  it('caps the round total at the table limit and at the free balance', () => {
    const game = new Roulette();
    expect(game.bet(1, 'red', MAX_BET, RICH)).toEqual({ ok: true });
    expect(game.bet(1, 'black', 5, RICH)).toEqual({ ok: false, error: 'over_limit' });
    // Свободный баланс приходит уже за вычетом стоящих ставок.
    expect(game.bet(2, 'red', 50, 49)).toEqual({ ok: false, error: 'insufficient' });
    expect(game.bet(2, 'red', 50, 50)).toEqual({ ok: true });
  });

  it('clears all bets of a player and returns to waiting when nobody has bets', () => {
    const game = new Roulette();
    game.bet(1, 'red', 10, RICH);
    game.bet(2, 'black', 10, RICH);
    expect(game.clear(1)).toEqual({ ok: true });
    expect(game.phase).toBe('betting');
    expect(game.stake(1)).toBe(0);
    expect(game.clear(1)).toEqual({ ok: false, error: 'no_bets' });
    game.clear(2);
    expect(game.phase).toBe('waiting');
  });

  it('locks bets after ready and requires a bet to be ready', () => {
    const game = new Roulette();
    expect(game.ready(1)).toEqual({ ok: false, error: 'no_bets' });
    game.bet(1, 'red', 10, RICH);
    expect(game.ready(1)).toEqual({ ok: true });
    expect(game.isReady(1)).toBe(true);
    expect(game.ready(1)).toEqual({ ok: false, error: 'already_ready' });
    expect(game.bet(1, 'red', 10, RICH)).toEqual({ ok: false, error: 'already_ready' });
    expect(game.clear(1)).toEqual({ ok: false, error: 'already_ready' });
  });

  it('refuses everything while the wheel spins and while the result is shown', () => {
    const game = new Roulette();
    game.bet(1, 'red', 10, RICH);
    game.spin(3);
    for (const phase of ['spinning', 'result']) {
      expect(game.phase).toBe(phase);
      expect(game.bet(2, 'red', 10, RICH)).toEqual({ ok: false, error: 'round_in_progress' });
      expect(game.clear(1)).toEqual({ ok: false, error: 'round_in_progress' });
      expect(game.ready(1)).toEqual({ ok: false, error: 'round_in_progress' });
      game.finish();
    }
  });
});

describe('round', () => {
  it('shows the number from the start of the spin and results only after it', () => {
    const game = new Roulette();
    game.bet(1, 'red', 10, RICH);
    expect(game.view().number).toBeNull();
    game.spin(3);
    expect(game.view()).toMatchObject({ phase: 'spinning', number: 3, players: [{ net: null }] });
    expect(game.results()).toBeNull();
    expect(game.stake(1)).toBe(10);
    game.finish();
    expect(game.view()).toMatchObject({ phase: 'result', number: 3, players: [{ net: 10 }] });
    // После расчёта ставка уже учтена в балансе.
    expect(game.stake(1)).toBe(0);
  });

  it('does not spin without bets and clears everything on reset', () => {
    const game = new Roulette();
    game.spin(3);
    expect(game.phase).toBe('waiting');
    game.bet(1, 'red', 10, RICH);
    game.spin(3);
    game.finish();
    game.reset();
    expect(game.view()).toEqual({ phase: 'waiting', number: null, players: [] });
    expect(game.results()).toBeNull();
  });

  it('lists bettors', () => {
    const game = new Roulette();
    game.bet(2, 'red', 10, RICH);
    game.bet(1, 'red', 10, RICH);
    expect(game.bettors()).toEqual([2, 1]);
    expect(game.hasBets(1)).toBe(true);
    expect(game.hasBets(3)).toBe(false);
  });
});
