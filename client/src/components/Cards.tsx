import type { Card } from '@casino/shared';

const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' } as const;

function CardFace({ card }: { card: Card }) {
  const red = card.suit === 'H' || card.suit === 'D';
  return (
    <span className={red ? 'card red' : 'card'}>
      <span>{card.rank}</span>
      <span>{SUIT_SYMBOL[card.suit]}</span>
    </span>
  );
}

// hiddenCount — сколько закрытых карт дорисовать после открытых.
export function Cards({ cards, hiddenCount = 0 }: { cards: Card[]; hiddenCount?: number }) {
  return (
    <span className="cards">
      {cards.map((card, index) => (
        <CardFace key={index} card={card} />
      ))}
      {Array.from({ length: hiddenCount }, (_, index) => (
        <span key={`hidden-${index}`} className="card back" />
      ))}
    </span>
  );
}
