import type { Me } from '@casino/shared';
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState } from 'react';
import { fetchMe, UnauthorizedError } from './api.ts';
import { Cashier } from './screens/Cashier.tsx';
import { Lobby } from './screens/Lobby.tsx';
import { Rating } from './screens/Rating.tsx';
import { Stats } from './screens/Stats.tsx';
import { Table } from './screens/Table.tsx';
import { Tables } from './screens/Tables.tsx';
import { getStartTableCode } from './telegram.ts';

type Screen =
  | { name: 'lobby' }
  // back — куда вернуться из кассы (в лобби или за стол).
  | { name: 'cashier'; back: Screen }
  | { name: 'tables' }
  | { name: 'table'; code: string }
  | { name: 'rating' }
  | { name: 'stats'; userId: number; back: Screen };

type State =
  | { status: 'loading' }
  | { status: 'ready'; me: Me }
  | { status: 'unauthorized' }
  | { status: 'error' };

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  // Приложение, открытое по ссылке-приглашению, сразу показывает нужный стол.
  const [screen, setScreen] = useState<Screen>(() => {
    const code = getStartTableCode();
    return code ? { name: 'table', code } : { name: 'lobby' };
  });

  useEffect(() => {
    fetchMe().then(
      (me) => setState({ status: 'ready', me }),
      (error) => setState({ status: error instanceof UnauthorizedError ? 'unauthorized' : 'error' }),
    );
  }, []);

  switch (state.status) {
    case 'loading':
      return (
        <Placeholder>
          <Spinner size="l" />
        </Placeholder>
      );
    case 'unauthorized':
      return <Placeholder header="Откройте приложение из Telegram" />;
    case 'error':
      return <Placeholder header="Не удалось загрузить" description="Проверьте соединение и откройте приложение заново" />;
    case 'ready': {
      const { me } = state;
      switch (screen.name) {
        case 'cashier':
          return (
            <Cashier
              balance={me.balance}
              onBalance={(balance) => setState({ status: 'ready', me: { ...me, balance } })}
              onBack={() => setScreen(screen.back)}
            />
          );
        case 'tables':
          return (
            <Tables onOpen={(code) => setScreen({ name: 'table', code })} onBack={() => setScreen({ name: 'lobby' })} />
          );
        case 'table':
          return (
            <Table
              code={screen.code}
              me={me}
              onBalance={(balance) => setState({ status: 'ready', me: { ...me, balance } })}
              onOpenCashier={() => setScreen({ name: 'cashier', back: screen })}
              onBack={() => setScreen({ name: 'tables' })}
            />
          );
        case 'rating':
          return (
            <Rating
              meId={me.id}
              onOpenPlayer={(userId) => setScreen({ name: 'stats', userId, back: screen })}
              onBack={() => setScreen({ name: 'lobby' })}
            />
          );
        case 'stats':
          return <Stats userId={screen.userId} onBack={() => setScreen(screen.back)} />;
        case 'lobby':
          return (
            <Lobby
              me={me}
              onOpenRating={() => setScreen({ name: 'rating' })}
              onOpenMyStats={() => setScreen({ name: 'stats', userId: me.id, back: screen })}
              onOpenCashier={() => setScreen({ name: 'cashier', back: screen })}
              onOpenGame={() => setScreen({ name: 'tables' })}
            />
          );
      }
    }
  }
}
