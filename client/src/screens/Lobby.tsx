import type { Me } from '@casino/shared';
import { Cell, List, Section } from '@telegram-apps/telegram-ui';
import { PlayerAvatar, playerName } from '../components/PlayerAvatar.tsx';
import { formatChips } from '../format.ts';

const GAMES = [
  { id: 'blackjack', title: 'Блэкджек', available: true },
  { id: 'poker', title: 'Покер', available: false },
  { id: 'roulette', title: 'Рулетка', available: false },
];

interface Props {
  me: Me;
  onOpenCashier: () => void;
  onOpenGame: () => void;
}

export function Lobby({ me, onOpenCashier, onOpenGame }: Props) {
  return (
    <List>
      <Section>
        <Cell
          before={<PlayerAvatar player={me} size={48} />}
          subtitle={`${formatChips(me.balance)} фишек`}
        >
          {playerName(me)}
        </Cell>
      </Section>
      <Section header="Игры">
        {GAMES.map((game) => (
          <Cell
            key={game.id}
            disabled={!game.available}
            after={game.available ? undefined : 'Скоро'}
            onClick={game.available ? onOpenGame : undefined}
          >
            {game.title}
          </Cell>
        ))}
      </Section>
      <Section>
        <Cell onClick={onOpenCashier}>Касса</Cell>
        <Cell>Рейтинг</Cell>
      </Section>
    </List>
  );
}
