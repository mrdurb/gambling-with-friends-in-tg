import type { Card, Rank, Suit } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { Blackjack, SHOE_SIZE } from '../../src/games/blackjack.ts';

const card = (text: string): Card => ({ rank: text.slice(0, -1) as Rank, suit: text.slice(-1) as Suit });

// Игра на заранее заданных картах. Порядок раздачи: по одной карте каждому месту (по возрастанию),
// открытая карта дилера, по второй карте каждому месту, закрытая карта дилера; дальше — добор по ходу игры.
function game(script: string) {
  let shuffles = 0;
  const scripted = script.split(/\s+/).filter(Boolean).map(card);
  const filler = Array.from({ length: SHOE_SIZE }, () => card('2C'));
  const bj = new Blackjack(() => {
    shuffles += 1;
    return [...scripted, ...filler].slice(0, SHOE_SIZE);
  });
  return { bj, shuffles: () => shuffles };
}

const RICH = 1_000_000;

// Один игрок на месте 0: карты игрока p1 p2, дилера up hole, затем добор.
function solo(player: string, dealer: string, draws = '', bet = 100) {
  const [p1, p2] = player.split(' ');
  const [up, hole] = dealer.split(' ');
  const { bj } = game(`${p1} ${up} ${p2} ${hole} ${draws}`);
  bj.bet(0, bet, RICH);
  bj.start();
  return bj;
}

const result = (bj: Blackjack, seat = 0) => bj.results()!.find((r) => r.seat === seat)!;

describe('betting', () => {
  it('accepts whole bets from 5 to 5000 within the balance', () => {
    const { bj } = game('');
    expect(bj.bet(0, 5, 5)).toEqual({ ok: true });
    expect(bj.bet(1, 5000, 5000)).toEqual({ ok: true });
    expect(bj.phase).toBe('betting');
  });

  it.each([4, 5001, 0, -10, 12.5, Number.NaN])('rejects a bet of %s', (amount) => {
    const { bj } = game('');
    expect(bj.bet(0, amount, RICH)).toEqual({ ok: false, error: 'bad_bet' });
    expect(bj.phase).toBe('waiting');
  });

  it('rejects a bet above the balance and a second bet from the same seat', () => {
    const { bj } = game('');
    expect(bj.bet(0, 100, 99)).toEqual({ ok: false, error: 'insufficient' });
    bj.bet(0, 100, RICH);
    expect(bj.bet(0, 50, RICH)).toEqual({ ok: false, error: 'already_bet' });
  });

  it('rejects bets once the round is running', () => {
    const bj = solo('10S 9S', '10H 7H');
    expect(bj.bet(1, 100, RICH)).toEqual({ ok: false, error: 'round_in_progress' });
  });

  it('returns to waiting when the only bet is cancelled', () => {
    const { bj } = game('');
    bj.bet(0, 100, RICH);
    bj.bet(1, 100, RICH);
    bj.cancelBet(0);
    expect(bj.phase).toBe('betting');
    bj.cancelBet(1);
    expect(bj.phase).toBe('waiting');
  });
});

describe('a simple hand', () => {
  it('wins even money when the player stands higher than the dealer', () => {
    const bj = solo('10S 9S', '10H 7H');
    expect(bj.act(0, 'stand', RICH)).toEqual({ ok: true });
    expect(bj.phase).toBe('result');
    expect(result(bj)).toMatchObject({ wagered: 100, net: 100, outcome: 'win' });
  });

  it('loses the bet when lower than the dealer', () => {
    const bj = solo('10S 7S', '10H 9H');
    bj.act(0, 'stand', RICH);
    expect(result(bj)).toMatchObject({ net: -100, outcome: 'lose' });
  });

  it('pushes on an equal total', () => {
    const bj = solo('10S 8S', '10H 8H');
    bj.act(0, 'stand', RICH);
    expect(result(bj)).toMatchObject({ net: 0, outcome: 'push' });
  });

  it('wins when the dealer busts', () => {
    const bj = solo('10S 2S', '10H 6H', '10D');
    bj.act(0, 'stand', RICH);
    expect(result(bj)).toMatchObject({ net: 100, outcome: 'win' });
    expect(bj.view(6, 0, null).dealer).toMatchObject({ total: 26, holeHidden: false });
  });

  it('busts on going over 21, and the dealer then does not draw', () => {
    const bj = solo('10S 6S', '10H 6H', 'KD 5D');
    expect(bj.act(0, 'hit', RICH)).toEqual({ ok: true });
    expect(bj.phase).toBe('result');
    expect(result(bj)).toMatchObject({ net: -100, outcome: 'lose', details: { bust: true } });
    expect(bj.view(6, 0, null).dealer.cards).toHaveLength(2);
  });

  it('stands automatically on reaching 21', () => {
    const bj = solo('10S 6S', '10H 9H', '5D');
    bj.act(0, 'hit', RICH);
    expect(bj.phase).toBe('result');
    expect(result(bj)).toMatchObject({ net: 100 });
  });

  it('counts an ace as 1 when 11 would bust', () => {
    const bj = solo('AS 6S', '10H 7H', '9D');
    bj.act(0, 'hit', RICH);
    const hand = bj.view(6, RICH, null).seats[0]!.hands[0]!;
    expect(hand).toMatchObject({ total: 16, soft: false, state: 'playing' });
  });
});

describe('dealer', () => {
  it('draws to 17', () => {
    const bj = solo('10S 8S', '10H 2H', '3D 4D');
    bj.act(0, 'stand', RICH);
    expect(bj.view(6, 0, null).dealer.total).toBe(19);
    expect(result(bj).net).toBe(-100);
  });

  it('stands on a soft 17', () => {
    const bj = solo('10S 8S', 'AH 6H', '10D');
    bj.act(0, 'stand', RICH);
    expect(bj.view(6, 0, null).dealer).toMatchObject({ total: 17, cards: [card('AH'), card('6H')] });
    expect(result(bj).net).toBe(100);
  });

  it('keeps the hole card hidden while players act', () => {
    const bj = solo('10S 8S', '9H 7H');
    expect(bj.view(6, RICH, null).dealer).toEqual({ cards: [card('9H')], holeHidden: true, total: 9 });
  });
});

describe('blackjack', () => {
  it('pays 3:2 and ends the round when the only player has it', () => {
    const bj = solo('AS KS', '9H 7H', '10D');
    expect(bj.phase).toBe('result');
    expect(result(bj)).toMatchObject({ wagered: 100, net: 150, outcome: 'win', details: { blackjack: true } });
    expect(bj.view(6, 0, null).dealer.cards).toHaveLength(2);
  });

  it('rounds half a chip in the player\'s favour', () => {
    expect(result(solo('AS KS', '9H 7H', '', 5)).net).toBe(8);
    expect(result(solo('AS KS', '9H 7H', '', 25)).net).toBe(38);
  });

  it('ends the round at once on a dealer blackjack: a player blackjack pushes, other hands lose', () => {
    // место 0: AS KS (блэкджек), место 1: 10D 9D; дилер: AH QH
    const { bj } = game('AS 10D AH KS 9D QH');
    bj.bet(0, 100, RICH);
    bj.bet(1, 100, RICH);
    bj.start();
    expect(bj.phase).toBe('result');
    expect(result(bj, 0)).toMatchObject({ net: 0, outcome: 'push', details: { blackjack: true } });
    expect(result(bj, 1)).toMatchObject({ net: -100, outcome: 'lose' });
    expect(bj.view(6, 0, null).dealer).toMatchObject({ holeHidden: false, total: 21 });
  });

  it('dealer blackjack with a ten up', () => {
    const bj = solo('10S 9S', 'KH AH');
    expect(bj.phase).toBe('result');
    expect(result(bj).net).toBe(-100);
  });

  it('is not checked for when the dealer shows a low card', () => {
    const bj = solo('10S 9S', '5H AH');
    expect(bj.phase).toBe('playing');
  });
});

describe('double', () => {
  it('doubles the bet, deals exactly one card and ends the hand', () => {
    const bj = solo('6S 5S', '10H 7H', '9D');
    expect(bj.act(0, 'double', 100)).toEqual({ ok: true });
    expect(bj.phase).toBe('result');
    expect(result(bj)).toMatchObject({ wagered: 200, net: 200, details: { doubles: 1, doublesWon: 1 } });
  });

  it('loses double when it goes wrong', () => {
    const bj = solo('6S 5S', '10H 7H', '2D');
    bj.act(0, 'double', 100);
    expect(result(bj)).toMatchObject({ wagered: 200, net: -200, details: { doubles: 1, doublesWon: 0 } });
  });

  it('needs enough free chips for the second bet', () => {
    const bj = solo('6S 5S', '10H 7H', '9D');
    expect(bj.act(0, 'double', 99)).toEqual({ ok: false, error: 'not_allowed' });
    expect(bj.view(6, 99, null).turn!.actions).toEqual(['hit', 'stand']);
  });

  it('is only offered on the first two cards', () => {
    const bj = solo('2S 3S', '10H 7H', '4D 9D');
    bj.act(0, 'hit', RICH);
    expect(bj.act(0, 'double', RICH)).toEqual({ ok: false, error: 'not_allowed' });
  });
});

describe('split', () => {
  it('makes two hands that are played in turn and settled separately', () => {
    // 8 8 против 10 7; добор: 3 и 10 на руки после сплита, затем 10 к первой руке.
    const bj = solo('8S 8D', '10H 7H', '3D 10D KC');
    expect(bj.view(6, RICH, null).turn!.actions).toEqual(['hit', 'stand', 'double', 'split']);
    expect(bj.act(0, 'split', RICH)).toEqual({ ok: true });

    let view = bj.view(6, RICH, null);
    expect(view.seats[0]!.hands.map((h) => h.cards)).toEqual([
      [card('8S'), card('3D')],
      [card('8D'), card('10D')],
    ]);
    expect(view.turn).toMatchObject({ seat: 0, hand: 0 });

    bj.act(0, 'hit', RICH); // 8+3+K = 21, автоматически стоп
    view = bj.view(6, RICH, null);
    expect(view.turn).toMatchObject({ seat: 0, hand: 1 });
    bj.act(0, 'stand', RICH); // 18 против 17

    expect(result(bj)).toMatchObject({ wagered: 200, net: 200, outcome: 'win' });
  });

  it('counts a split as one round with the summed result', () => {
    const bj = solo('8S 8D', '10H 9H', '10D 2C');
    bj.act(0, 'split', RICH);
    bj.act(0, 'stand', RICH); // 18 против 19 — проигрыш
    bj.act(0, 'hit', RICH); // 8+2+2(добор из наполнителя) = 12
    bj.act(0, 'stand', RICH); // 12 против 19 — проигрыш
    expect(result(bj)).toMatchObject({ wagered: 200, net: -200, outcome: 'lose' });
  });

  it('gives split aces one card each and no turn; 21 there is not a blackjack', () => {
    const bj = solo('AS AD', '10H 7H', 'KD 5D');
    bj.act(0, 'split', RICH);
    expect(bj.phase).toBe('result');
    const res = result(bj);
    // A+K = 21 (выплата 1:1), A+5 = 16 против 17 — проигрыш.
    expect(res).toMatchObject({ wagered: 200, net: 0, outcome: 'push', details: { blackjack: false } });
    expect(bj.view(6, 0, null).seats[0]!.hands.map((h) => h.outcome)).toEqual(['win', 'lose']);
  });

  it('allows splitting any two ten-value cards', () => {
    const bj = solo('10S KD', '9H 7H');
    expect(bj.view(6, RICH, null).turn!.actions).toContain('split');
  });

  it('is not offered for different values, without chips, or a second time', () => {
    expect(solo('9S 8D', '9H 7H').view(6, RICH, null).turn!.actions).not.toContain('split');
    expect(solo('8S 8D', '9H 7H').view(6, 99, null).turn!.actions).not.toContain('split');

    const bj = solo('8S 8D', '9H 7H', '8H 8C');
    bj.act(0, 'split', RICH);
    expect(bj.view(6, RICH, null).turn!.actions).toEqual(['hit', 'stand', 'double']);
    expect(bj.act(0, 'split', RICH)).toEqual({ ok: false, error: 'not_allowed' });
  });

  it('allows doubling after a split', () => {
    const bj = solo('8S 8D', '10H 7H', '3D 2D 10C');
    bj.act(0, 'split', RICH);
    expect(bj.act(0, 'double', RICH)).toEqual({ ok: true }); // 8+3+10 = 21
    bj.act(0, 'stand', RICH); // 8+2 = 10 против 17
    expect(result(bj)).toMatchObject({ wagered: 300, net: 100, details: { doubles: 1, doublesWon: 1 } });
  });
});

describe('several players', () => {
  // место 1: 10S 9S, место 4: 10D 6D; дилер 10H 7H
  const twoPlayers = (draws = '') => {
    const { bj } = game(`10S 10D 10H 9S 6D 7H ${draws}`);
    bj.bet(4, 50, RICH);
    bj.bet(1, 100, RICH);
    bj.start();
    return bj;
  };

  it('acts in seat order and rejects a move out of turn', () => {
    const bj = twoPlayers('5C');
    expect(bj.view(6, RICH, null).turn).toMatchObject({ seat: 1, hand: 0 });
    expect(bj.act(4, 'hit', RICH)).toEqual({ ok: false, error: 'not_your_turn' });
    expect(bj.act(3, 'hit', RICH)).toEqual({ ok: false, error: 'not_your_turn' });

    bj.act(1, 'stand', RICH);
    expect(bj.view(6, RICH, null).turn).toMatchObject({ seat: 4, hand: 0 });
    bj.act(4, 'hit', RICH); // 16 + 5 = 21

    expect(result(bj, 1)).toMatchObject({ net: 100 });
    expect(result(bj, 4)).toMatchObject({ net: 50 });
  });

  it('shows only seats that are in the round', () => {
    const view = twoPlayers().view(6, RICH, null);
    expect(view.seats.map((seat) => seat !== null)).toEqual([false, true, false, false, true, false]);
  });

  it('stands the current hand on timeout and moves on', () => {
    const bj = twoPlayers();
    expect(bj.timeout()).toBe(1);
    expect(bj.view(6, RICH, null).turn).toMatchObject({ seat: 4 });
    expect(bj.timeout()).toBe(4);
    expect(bj.phase).toBe('result');
    expect(result(bj, 4)).toMatchObject({ net: -50 });
  });

  it('stands every hand of a player who leaves, also when it is not their turn', () => {
    const bj = twoPlayers();
    bj.forfeit(4);
    expect(bj.view(6, RICH, null).turn).toMatchObject({ seat: 1 });
    bj.act(1, 'stand', RICH);
    expect(bj.phase).toBe('result');
    expect(result(bj, 4)).toMatchObject({ net: -50, outcome: 'lose' });
  });

  it('moves the turn on when the player whose turn it is leaves', () => {
    const bj = twoPlayers();
    bj.forfeit(1);
    expect(bj.view(6, RICH, null).turn).toMatchObject({ seat: 4 });
  });

  it('rejects moves when no round is being played', () => {
    const { bj } = game('');
    expect(bj.act(0, 'hit', RICH)).toEqual({ ok: false, error: 'not_your_turn' });
    expect(bj.timeout()).toBeNull();
  });
});

describe('between rounds', () => {
  it('tracks how many chips a seat has at stake', () => {
    const bj = solo('8S 8D', '10H 7H', '3D 2D 10C');
    expect(bj.stake(0)).toBe(100);
    bj.act(0, 'split', RICH);
    bj.act(0, 'double', RICH);
    expect(bj.stake(0)).toBe(300);
    expect(bj.stake(3)).toBe(0);
  });

  it('clears the table on reset', () => {
    const bj = solo('10S 9S', '10H 7H');
    bj.act(0, 'stand', RICH);
    bj.reset();
    expect(bj.phase).toBe('waiting');
    expect(bj.results()).toBeNull();
    expect(bj.view(6, 0, null)).toMatchObject({ dealer: { cards: [], total: 0 }, seats: [null, null, null, null, null, null] });
  });

  it('keeps the shoe between rounds and reshuffles when under a quarter remains', () => {
    const { bj, shuffles } = game('');
    const playRound = () => {
      bj.bet(0, 5, RICH);
      bj.start();
      while (bj.phase === 'playing') bj.act(0, 'hit', RICH);
      bj.reset();
    };
    playRound();
    playRound();
    expect(shuffles()).toBe(1);
    for (let i = 0; i < 60; i++) playRound();
    expect(shuffles()).toBeGreaterThan(1);
  });

  it('announces a reshuffled shoe for exactly the round that starts with it', () => {
    const { bj, shuffles } = game('');
    const flags: boolean[] = [];
    const playRound = () => {
      bj.bet(0, 5, RICH);
      expect(bj.view(6, 0, null).shoeReshuffled).toBe(false);
      bj.start();
      flags.push(bj.view(6, RICH, null).shoeReshuffled);
      while (bj.phase === 'playing') bj.act(0, 'hit', RICH);
      // Пометка держится до конца раздачи, включая показ результата.
      expect(bj.view(6, 0, null).shoeReshuffled).toBe(flags.at(-1));
      bj.reset();
      expect(bj.view(6, 0, null).shoeReshuffled).toBe(false);
    };
    for (let i = 0; i < 40; i++) playRound();

    expect(flags[0]).toBe(true);
    expect(flags[1]).toBe(false);
    expect(flags.filter(Boolean)).toHaveLength(shuffles());
    expect(shuffles()).toBeGreaterThan(1);
  });

  it('shows the bet before the cards are dealt', () => {
    const { bj } = game('');
    bj.bet(2, 75, RICH);
    expect(bj.view(6, 0, 1234)).toMatchObject({
      phase: 'betting',
      timeLeftMs: 1234,
      seats: [null, null, { hands: [{ cards: [], bet: 75 }], net: null }, null, null, null],
    });
  });
});
