import type { PlayerStats } from '@casino/shared';
import { Cell, List, Placeholder, Section, Spinner } from '@telegram-apps/telegram-ui';
import { useEffect, useState } from 'react';
import { fetchStats } from '../api.ts';
import { PlayerAvatar, playerName } from '../components/PlayerAvatar.tsx';
import { formatChips, formatPercent, formatSigned } from '../format.ts';

interface Props {
  userId: number;
  onBack: () => void;
}

export function Stats({ userId, onBack }: Props) {
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchStats(userId).then(setStats, () => setFailed(true));
  }, [userId]);

  const back = (
    <Section>
      <Cell onClick={onBack}>‹ Назад</Cell>
    </Section>
  );

  if (!stats) {
    return (
      <List>
        {back}
        <Placeholder description={failed ? 'Не удалось загрузить статистику.' : undefined}>
          {!failed && <Spinner size="m" />}
        </Placeholder>
      </List>
    );
  }

  const { player, blackjack: bj } = stats;
  const row = (label: string, value: string) => (
    <Cell key={label} after={value}>
      {label}
    </Cell>
  );

  return (
    <List>
      {back}
      <Section>
        <Cell before={<PlayerAvatar player={player} size={48} />} subtitle="Статистика по блэкджеку">
          {playerName(player)}
        </Cell>
      </Section>
      <Section header="Фишки">
        {row('Чистый результат', formatSigned(bj.net))}
        {row('Выиграно', formatChips(bj.won))}
        {row('Проиграно', formatChips(bj.lost))}
        {row('Самый крупный выигрыш за раздачу', formatChips(bj.biggestWin))}
        {row('Самая крупная ставка', formatChips(bj.biggestBet))}
      </Section>
      <Section header="Раздачи">
        {row('Сыграно', formatChips(bj.rounds))}
        {row('Победы', formatChips(bj.wins))}
        {row('Поражения', formatChips(bj.losses))}
        {row('Ничьи', formatChips(bj.pushes))}
        {row('Процент побед', formatPercent(bj.winRate))}
        {row('Блэкджеки', formatChips(bj.blackjacks))}
        {row('Процент переборов', formatPercent(bj.bustRate))}
        {row('Самая длинная серия побед', formatChips(bj.longestWinStreak))}
        {row('Самая длинная серия поражений', formatChips(bj.longestLoseStreak))}
      </Section>
      <Section header="Удвоения">
        {row('Удваивал', formatChips(bj.doubles))}
        {row('Удвоений окупилось', formatPercent(bj.doublesWonRate))}
      </Section>
      <Section header="Касса">
        {row('Походов в кассу', formatChips(bj.cashierVisits))}
        {row('Взято фишек', formatChips(bj.cashierTotal))}
      </Section>
    </List>
  );
}
