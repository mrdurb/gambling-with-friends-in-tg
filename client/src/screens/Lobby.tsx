import type { Me } from '@casino/shared';
import { Avatar, Cell, List, Section } from '@telegram-apps/telegram-ui';

const GAMES = [
  { id: 'blackjack', title: 'Блэкджек', available: true },
  { id: 'poker', title: 'Покер', available: false },
  { id: 'roulette', title: 'Рулетка', available: false },
];

function initials(me: Me): string {
  return (me.firstName[0] ?? '') + (me.lastName?.[0] ?? '');
}

export function Lobby({ me }: { me: Me }) {
  const name = [me.firstName, me.lastName].filter(Boolean).join(' ');
  return (
    <List>
      <Section>
        <Cell
          before={<Avatar size={48} src={me.photoUrl ?? undefined} acronym={initials(me)} />}
          subtitle={`${me.balance.toLocaleString('ru-RU')} фишек`}
        >
          {name}
        </Cell>
      </Section>
      <Section header="Игры">
        {GAMES.map((game) => (
          <Cell key={game.id} disabled={!game.available} after={game.available ? undefined : 'Скоро'}>
            {game.title}
          </Cell>
        ))}
      </Section>
      <Section>
        <Cell>Касса</Cell>
        <Cell>Рейтинг</Cell>
      </Section>
    </List>
  );
}
