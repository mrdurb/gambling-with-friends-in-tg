import type { RatingRow } from '@casino/shared';
import { Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState } from 'react';
import { fetchRating } from '../api.ts';
import { PlayerAvatar, playerName } from '../components/PlayerAvatar.tsx';
import { formatChips, formatSigned } from '../format.ts';

interface Props {
  meId: number;
  onOpenPlayer: (userId: number) => void;
  onBack: () => void;
}

export function Rating({ meId, onOpenPlayer, onBack }: Props) {
  const [rows, setRows] = useState<RatingRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchRating().then(setRows, () => setFailed(true));
  }, []);

  return (
    <List>
      <Section>
        <Cell onClick={onBack}>‹ В лобби</Cell>
      </Section>
      <Section header="Рейтинг" footer="Чистый результат: выиграно минус проиграно. Фишки из кассы не считаются.">
        {failed && <Placeholder description="Не удалось загрузить рейтинг." />}
        {!rows && !failed && (
          <Placeholder>
            <Spinner size="m" />
          </Placeholder>
        )}
        {rows?.map((row, index) => (
          <Cell
            key={row.player.id}
            before={<PlayerAvatar player={row.player} />}
            subtitle={`выиграно ${formatChips(row.won)} · проиграно ${formatChips(row.lost)}`}
            after={formatSigned(row.net)}
            onClick={() => onOpenPlayer(row.player.id)}
          >
            {index + 1}. {playerName(row.player)}
            {row.player.id === meId ? ' (вы)' : ''}
          </Cell>
        ))}
      </Section>
    </List>
  );
}
