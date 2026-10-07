import type { GameId, TableInfo } from '@casino/shared';
import { Button, Cell, List, Placeholder, Section } from '@telegram-apps/telegram-ui';
import { useEffect, useState } from 'react';
import { createTable, fetchMyTables } from '../api.ts';

const TITLES: Record<GameId, string> = { blackjack: 'Блэкджек', roulette: 'Рулетка', poker: 'Покер' };

interface Props {
  game: GameId;
  onOpen: (code: string) => void;
  onBack: () => void;
}

export function Tables({ game, onOpen, onBack }: Props) {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchMyTables(game).then(setTables, () => setFailed(true));
  }, [game]);

  async function create() {
    setBusy(true);
    setFailed(false);
    try {
      onOpen((await createTable(game)).code);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <List>
      <Section>
        <Cell onClick={onBack}>‹ В лобби</Cell>
      </Section>
      <Section header={TITLES[game]} footer={failed ? 'Не удалось связаться с сервером. Попробуйте ещё раз.' : undefined}>
        <div style={{ padding: 16 }}>
          <Button stretched disabled={busy} onClick={create}>
            Создать стол
          </Button>
        </div>
      </Section>
      <Section header="Мои столы">
        {tables?.length === 0 && (
          <Placeholder description="Здесь появятся столы, которые вы создали или за которыми были." />
        )}
        {tables?.map((table) => (
          <Cell key={table.code} onClick={() => onOpen(table.code)}>
            {table.name}
          </Cell>
        ))}
      </Section>
    </List>
  );
}
