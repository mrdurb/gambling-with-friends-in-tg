import type { Card, Rank, Suit } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { pokerDeck, rankHand, shuffled, type HandCategory } from '../../../src/games/poker/hand-rank.ts';

const card = (text: string): Card => ({ rank: text.slice(0, -1) as Rank, suit: text.slice(-1) as Suit });
const hand = (text: string) => text.split(' ').map(card);
const rank = (text: string, short = false) => rankHand(hand(text), short);
const score = (text: string, short = false) => rank(text, short).score;

// По одной руке на категорию, от младшей к старшей в обычном порядке.
const LADDER: [HandCategory, string][] = [
  ['high', 'AS KD 9C 7H 6S'],
  ['pair', '6S 6D 7C 8H 10S'],
  ['two_pair', '6S 6D 7C 7H 10S'],
  ['trips', '6S 6D 6C 8H 10S'],
  ['straight', '6S 7D 8C 9H 10S'],
  ['flush', '6S 8S 10S QS AS'],
  ['full_house', '6S 6D 6C 7H 7S'],
  ['quads', '6S 6D 6C 6H 7S'],
  ['straight_flush', '6S 7S 8S 9S 10S'],
];

describe('categories', () => {
  it('names every category', () => {
    for (const [category, cards] of LADDER) expect(rank(cards).category, cards).toBe(category);
  });

  it('orders categories the usual way', () => {
    const scores = LADDER.map(([, cards]) => score(cards));
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(new Set(scores).size).toBe(scores.length);
  });

  it('puts a flush above a full house in short deck, and keeps a straight above trips', () => {
    const order = LADDER.map(([category]) => category);
    const short = [...LADDER].sort((a, b) => score(a[1], true) - score(b[1], true)).map(([category]) => category);
    expect(short).toEqual(['high', 'pair', 'two_pair', 'trips', 'straight', 'full_house', 'flush', 'quads', 'straight_flush']);
    expect(order).not.toEqual(short);
  });
});

describe('kickers', () => {
  it('breaks ties inside a category from the most important card down', () => {
    const better = (a: string, b: string) => expect(score(a), `${a} > ${b}`).toBeGreaterThan(score(b));
    better('AS QD 9C 7H 6S', 'AS JD 10C 9H 8S'); // старшая карта: второй кикер
    better('7S 7D 2C 3H 4S', '6S 6D AC KH QS'); // пара: сначала ранг пары
    better('6S 6D AC KH 3S', '6H 6C AD KS 2S'); // пара: третий кикер
    better('9S 9D 2C 2H 3S', '8S 8D 7C 7H AS'); // две пары: старшая пара
    better('9S 9D 3C 3H 4S', '9H 9C 2D 2S AS'); // две пары: младшая пара
    better('9S 9D 3C 3H 5S', '9H 9C 3D 3S 4S'); // две пары: кикер
    better('7S 7D 7C 2H 3S', '6S 6D 6C AH KS'); // тройка
    better('7S 8D 9C 10H JS', '6S 7D 8C 9H 10S'); // стрит по старшей
    better('AS 3S 4S 5S 7S', 'KD QD JD 9D 8D'); // флеш по старшей карте
    better('3S 3D 3C 2H 2S', '2D 2C 2H AS AD'); // фулл-хаус по тройке
    better('3S 3D 3C 3H 2S', '2S 2D 2C 2H AS'); // каре
  });

  it('gives equal hands equal scores whatever the suits and order', () => {
    expect(score('AS KD 9C 7H 6S')).toBe(score('6D 7C 9H KS AD'));
    expect(score('6S 6D 7C 7H 10S')).toBe(score('7S 7D 10C 6H 6C'));
  });
});

describe('straights', () => {
  it('plays the ace low: A-2-3-4-5 is the lowest straight in a full deck', () => {
    expect(rank('AS 2D 3C 4H 5S').category).toBe('straight');
    expect(score('2S 3D 4C 5H 6S')).toBeGreaterThan(score('AS 2D 3C 4H 5S'));
    expect(score('AS 2D 3C 4H 5S')).toBeGreaterThan(score('KS KD KC 2H 3S'));
    expect(rank('JS QD KC AH 2S').category).toBe('high'); // через туз стрит не заворачивается
  });

  it('plays the ace as a five in short deck: A-6-7-8-9 is the lowest straight', () => {
    expect(rank('AS 6D 7C 8H 9S', true).category).toBe('straight');
    expect(rank('AS 6D 7C 8H 9S', false).category).toBe('high');
    expect(score('6S 7D 8C 9H 10S', true)).toBeGreaterThan(score('AS 6D 7C 8H 9S', true));
    expect(rank('AS 6S 7S 8S 9S', true).category).toBe('straight_flush');
    expect(score('10S JD QC KH AS', true)).toBeGreaterThan(score('9S 10D JC QH KS', true));
  });
});

describe('best five of seven', () => {
  it('takes the two best pairs out of three and the best kicker', () => {
    expect(score('AS AD KC KH QS QD 2C')).toBe(score('AS AD KC KH QS'));
  });

  it('finds a straight flush inside a longer flush and straight', () => {
    expect(rank('5S 6S 7S 8S 9S AS KD').category).toBe('straight_flush');
    // Флеш и стрит есть, но не из одних и тех же карт.
    expect(rank('5S 6S 7S 8S 9D AS KS').category).toBe('flush');
  });

  it('takes the top of a six-card straight', () => {
    expect(score('5S 6D 7C 8H 9S 10D 2C')).toBe(score('6D 7C 8H 9S 10D'));
  });

  it('prefers the full house made of the higher pair, and trips plus trips is a full house', () => {
    expect(score('9S 9D 9C KH KS 2D 2C')).toBe(score('9S 9D 9C KH KS'));
    expect(score('9S 9D 9C KH KS KD 2C')).toBe(score('KH KS KD 9S 9D'));
  });

  it('prefers a flush to trips in both orders', () => {
    // Флеш и фулл-хаус в семи картах вместе не помещаются, поэтому спорить могут только флеш и тройка.
    expect(rank('9S KS QS 8S 7S 9D 9C', false).category).toBe('flush');
    expect(rank('9S KS QS 8S 7S 9D 9C', true).category).toBe('flush');
  });

  it('ranks five and six cards too', () => {
    expect(rank('AS AD KC 2H 3S 4D').category).toBe('pair');
  });
});

describe('decks', () => {
  it('builds a 52-card deck and a 36-card deck from six up, without repeats', () => {
    const full = pokerDeck(false);
    const short = pokerDeck(true);
    expect(full).toHaveLength(52);
    expect(short).toHaveLength(36);
    for (const deck of [full, short]) expect(new Set(deck.map((c) => c.rank + c.suit)).size).toBe(deck.length);
    expect(short.some((c) => ['2', '3', '4', '5'].includes(c.rank))).toBe(false);
    expect(short.filter((c) => c.rank === '6')).toHaveLength(4);
  });

  it('shuffles without losing or repeating cards and without touching the source', () => {
    const deck = pokerDeck(false);
    const copy = [...deck];
    const mixed = shuffled(deck, (max) => max - 1);
    expect(deck).toEqual(copy);
    expect(mixed).toHaveLength(52);
    expect(new Set(mixed.map((c) => c.rank + c.suit)).size).toBe(52);
    expect(shuffled(deck, () => 0)).not.toEqual(deck);
  });
});
