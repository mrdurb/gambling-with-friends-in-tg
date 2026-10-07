import type { Me } from '@casino/shared';
import { Cell, List, Section } from '@telegram-apps/telegram-ui';
import { PlayerAvatar, playerName } from '../components/PlayerAvatar.tsx';
import { formatChips } from '../format.ts';
import { canAddToHomeScreen, promptAddToHomeScreen } from '../telegram.ts';

const GAMES = [
  { id: 'blackjack', title: 'Блэкджек', available: true },
  { id: 'poker', title: 'Покер', available: false },
  { id: 'roulette', title: 'Рулетка', available: false },
];

interface Props {
  me: Me;
  onOpenCashier: () => void;
  onOpenGame: () => void;
  onOpenRating: () => void;
  onOpenMyStats: () => void;
}

export function Lobby({ me, onOpenCashier, onOpenGame, onOpenRating, onOpenMyStats }: Props) {
  return (
    <List>
      <Section>
        <Cell
          before={<PlayerAvatar player={me} size={48} />}
          subtitle={`${formatChips(me.balance)} фишек`}
          after="Статистика"
          onClick={onOpenMyStats}
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
        <Cell onClick={onOpenRating}>Рейтинг</Cell>
      </Section>
      {canAddToHomeScreen() && (
        <Section footer="Иконка приложения появится на главном экране телефона.">
          <Cell onClick={promptAddToHomeScreen}>Добавить на главный экран</Cell>
        </Section>
      )}
    </List>
  );
}
