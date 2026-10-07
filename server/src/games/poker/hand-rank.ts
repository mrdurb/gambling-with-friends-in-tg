import type { Card, Rank, Suit } from '@casino/shared';

export type HandCategory =
  | 'high'
  | 'pair'
  | 'two_pair'
  | 'trips'
  | 'straight'
  | 'flush'
  | 'full_house'
  | 'quads'
  | 'straight_flush';

export const HAND_NAMES: Record<HandCategory, string> = {
  high: 'Старшая карта',
  pair: 'Пара',
  two_pair: 'Две пары',
  trips: 'Тройка',
  straight: 'Стрит',
  flush: 'Флеш',
  full_house: 'Фулл-хаус',
  quads: 'Каре',
  straight_flush: 'Стрит-флеш',
};

// Старшинство категорий от младшей к старшей. В 6+ флеш собрать труднее фулл-хауса, поэтому он старше.
const ORDER: HandCategory[] = ['high', 'pair', 'two_pair', 'trips', 'straight', 'flush', 'full_house', 'quads', 'straight_flush'];
const SHORT_ORDER: HandCategory[] = ['high', 'pair', 'two_pair', 'trips', 'straight', 'full_house', 'flush', 'quads', 'straight_flush'];

const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
const RANKS: Rank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const ACE = 14;
export const rankValue = (rank: Rank) => RANKS.indexOf(rank) + 2;

// Колода по порядку: 52 карты или 36 (от шестёрки) для 6+.
export function pokerDeck(shortDeck: boolean): Card[] {
  const ranks = shortDeck ? RANKS.filter((rank) => rankValue(rank) >= 6) : RANKS;
  return SUITS.flatMap((suit) => ranks.map((rank): Card => ({ rank, suit })));
}

// Перетасованная копия колоды (Фишер–Йетс). randomInt(n) — целое от 0 до n − 1.
export function shuffled(deck: Card[], randomInt: (max: number) => number): Card[] {
  const cards = [...deck];
  for (let i = cards.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [cards[i], cards[j]] = [cards[j]!, cards[i]!];
  }
  return cards;
}

// Старшая карта лучшего стрита среди значений или 0. Туз играет и за младшую карту:
// перед двойкой в полной колоде, перед шестёркой в короткой.
function straightHigh(values: number[], shortDeck: boolean): number {
  const present = new Set(values);
  const lowest = shortDeck ? 6 : 2;
  for (let high = ACE; high >= lowest + 4; high--) {
    if ([0, 1, 2, 3, 4].every((step) => present.has(high - step))) return high;
  }
  const wheel = [ACE, lowest, lowest + 1, lowest + 2, lowest + 3];
  return wheel.every((value) => present.has(value)) ? lowest + 3 : 0;
}

// Лучшая пятикарточная комбинация из 5–7 карт. score сравнивается напрямую: больше — сильнее, равно — делёж.
export function rankHand(cards: Card[], shortDeck: boolean): { score: number; category: HandCategory } {
  const values = cards.map((card) => rankValue(card.rank)).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  // Ранги по убыванию количества, при равном количестве — по убыванию ранга.
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const distinct = [...counts.keys()].sort((a, b) => b - a);
  const without = (...used: number[]) => distinct.filter((value) => !used.includes(value));

  const flushSuit = SUITS.find((suit) => cards.filter((card) => card.suit === suit).length >= 5);
  const flush = flushSuit
    ? cards.filter((card) => card.suit === flushSuit).map((card) => rankValue(card.rank)).sort((a, b) => b - a)
    : null;

  // Все категории, которые есть в картах, с рангами для сравнения внутри категории.
  const found = new Map<HandCategory, number[]>();
  const straightFlush = flush ? straightHigh(flush, shortDeck) : 0;
  if (straightFlush) found.set('straight_flush', [straightFlush]);
  if (flush) found.set('flush', flush.slice(0, 5));
  const straight = straightHigh(distinct, shortDeck);
  if (straight) found.set('straight', [straight]);

  const [first, second] = groups as [[number, number], [number, number] | undefined];
  if (first[1] === 4) found.set('quads', [first[0], without(first[0])[0] ?? 0]);
  else if (first[1] === 3 && second && second[1] >= 2) found.set('full_house', [first[0], second[0]]);
  else if (first[1] === 3) found.set('trips', [first[0], ...without(first[0]).slice(0, 2)]);
  else if (first[1] === 2 && second?.[1] === 2) found.set('two_pair', [first[0], second[0], without(first[0], second[0])[0] ?? 0]);
  else if (first[1] === 2) found.set('pair', [first[0], ...without(first[0]).slice(0, 3)]);
  found.set('high', distinct.slice(0, 5));

  const order = shortDeck ? SHORT_ORDER : ORDER;
  const category = [...found.keys()].reduce((best, item) => (order.indexOf(item) > order.indexOf(best) ? item : best));
  // Категория в старшем разряде, затем до пяти рангов по убыванию важности.
  const ranks = [...found.get(category)!, 0, 0, 0, 0].slice(0, 5);
  const score = ranks.reduce((total, value) => total * 15 + value, order.indexOf(category));
  return { score, category };
}
