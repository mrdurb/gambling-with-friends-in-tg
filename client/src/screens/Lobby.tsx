import type { GameId, Me } from '@casino/shared';
import { Cell, List, Section } from '@telegram-apps/telegram-ui';
import { PlayerAvatar, playerName } from '../components/PlayerAvatar.tsx';
import { formatChips } from '../format.ts';
import { canAddToHomeScreen, promptAddToHomeScreen } from '../telegram.ts';

// game — игра, если она уже доступна.
const GAMES: { title: string; game?: GameId }[] = [
  { title: 'Блэкджек', game: 'blackjack' },
  { title: 'Рулетка', game: 'roulette' },
  { title: 'Покер', game: 'poker' },
];

interface Props {
  me: Me;
  onOpenCashier: () => void;
  onOpenGame: (game: GameId) => void;
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
        {GAMES.map(({ title, game }) => (
          <Cell key={title} disabled={!game} after={game ? undefined : 'Скоро'} onClick={game && (() => onOpenGame(game))}>
            {title}
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
