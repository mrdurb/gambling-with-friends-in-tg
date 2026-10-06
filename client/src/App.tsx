import type { Me } from '@casino/shared';
import { Placeholder, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState } from 'react';
import { fetchMe, UnauthorizedError } from './api.ts';
import { Lobby } from './screens/Lobby.tsx';

type State =
  | { status: 'loading' }
  | { status: 'ready'; me: Me }
  | { status: 'unauthorized' }
  | { status: 'error' };

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });

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
    case 'ready':
      return <Lobby me={state.me} />;
  }
}
