import { POKER_BLINDS, POKER_MODES, type GameId, type PokerMode, type TableInfo } from '@casino/shared';
import { Button, Cell, List, Placeholder, Section, SegmentedControl } from '@telegram-apps/telegram-ui';
import { useEffect, useState } from 'react';
import { createTable, fetchMyTables } from '../api.ts';

const TITLES: Record<GameId, string> = { blackjack: 'Блэкджек', roulette: 'Рулетка', poker: 'Покер' };

// Короткие подписи режимов: полные названия в переключатель на телефоне не помещаются.
const MODE_LABELS: Record<PokerMode, string> = { nlh: 'Холдем', pineapple: '3-1', short: '6+' };

interface Props {
  game: GameId;
  onOpen: (code: string) => void;
  onBack: () => void;
}

export function Tables({ game, onOpen, onBack }: Props) {
  const [tables, setTables] = useState<TableInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Настройки нового стола покера.
  const [mode, setMode] = useState<PokerMode>('nlh');
  const [bigBlind, setBigBlind] = useState(POKER_BLINDS[0]![1]);

  useEffect(() => {
    fetchMyTables(game).then(setTables, () => setFailed(true));
  }, [game]);

  async function create() {
    setBusy(true);
    setFailed(false);
    try {
      onOpen((await createTable(game, game === 'poker' ? { mode, blinds: bigBlind } : undefined)).code);
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
        {game === 'poker' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 16px 0' }}>
            <SegmentedControl>
              {POKER_MODES.map((item) => (
                <SegmentedControl.Item key={item} selected={item === mode} onClick={() => setMode(item)}>
                  {MODE_LABELS[item]}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl>
            <SegmentedControl>
              {POKER_BLINDS.map(([small, big]) => (
                <SegmentedControl.Item key={big} selected={big === bigBlind} onClick={() => setBigBlind(big)}>
                  {small}/{big}
                </SegmentedControl.Item>
              ))}
            </SegmentedControl>
          </div>
        )}
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
