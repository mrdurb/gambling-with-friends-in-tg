import './roulette.css';
import {
  MAX_BET,
  MIN_BET,
  REACTIONS,
  ROULETTE_CHIPS,
  rouletteWins,
  type Me,
  type RouletteField,
  type RoulettePlayerView,
  type RouletteSnapshot,
} from '@casino/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Countdown } from '../components/Countdown.tsx';
import { PlayerAvatar, playerName } from '../components/PlayerAvatar.tsx';
import { numberColor, Wheel } from '../components/Wheel.tsx';
import { formatChips, formatSigned } from '../format.ts';
import type { TableConnection } from '../realtime.ts';

interface Props {
  snapshot: RouletteSnapshot;
  me: Me;
  connection: TableConnection;
  onOpenCashier: () => void;
  // Открытый чат стола: показывается над нижней панелью.
  chat: ReactNode;
}

const NUMBERS = Array.from({ length: 36 }, (_, index) => index + 1);
// Ставки на группы чисел в порядке показа под числами.
const GROUPS: { field: RouletteField; label: string; hint?: string }[] = [
  { field: 'dozen1', label: '1–12' },
  { field: 'dozen2', label: '13–24' },
  { field: 'dozen3', label: '25–36' },
  { field: 'col1', label: 'Колонка 1', hint: '1, 4, 7…' },
  { field: 'col2', label: 'Колонка 2', hint: '2, 5, 8…' },
  { field: 'col3', label: 'Колонка 3', hint: '3, 6, 9…' },
  { field: 'low', label: '1–18' },
  { field: 'even', label: 'Чёт' },
  { field: 'red', label: 'Красное' },
  { field: 'black', label: 'Чёрное' },
  { field: 'odd', label: 'Нечет' },
  { field: 'high', label: '19–36' },
];
const COLOR_NAMES = { red: 'красное', black: 'чёрное', green: 'зеро' };
const ERRORS: Record<string, string> = {
  insufficient: 'Не хватает фишек на эту ставку.',
  over_limit: `За раунд можно поставить не больше ${formatChips(MAX_BET)}.`,
  round_in_progress: 'Ставки уже закрыты.',
  too_fast: 'Слишком быстро. Подождите пару секунд.',
};

const sum = (bets: RoulettePlayerView['bets']) => Object.values(bets).reduce<number>((total, amount) => total + (amount ?? 0), 0);

export function RouletteTable({ snapshot, me, connection, onOpenCashier, chat }: Props) {
  const { game } = snapshot;
  const [chip, setChip] = useState<number>(ROULETTE_CHIPS[0]!);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  // Отказ относится к одному действию: со сменой фазы он уже неактуален.
  useEffect(() => setError(null), [game.phase]);

  const mine = game.players.find((item) => item.player.id === me.id);
  const myBets = mine?.bets ?? {};
  const stake = sum(myBets);
  const open = game.phase === 'waiting' || game.phase === 'betting';
  const canBet = open && !mine?.ready;
  // После расчёта баланс уже включает результат раунда; до него ставки ещё не списаны.
  const free = game.phase === 'result' ? me.balance : me.balance - stake;
  const result = game.phase === 'result' ? game.number : null;

  // Отправивший реакцию последним показывается первым.
  const players = [...game.players].sort(
    (a, b) => Number(b.player.id === connection.lastReactor) - Number(a.player.id === connection.lastReactor),
  );

  async function send(request: Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    const outcome = await request;
    if (!outcome.ok) setError(ERRORS[outcome.error] ?? 'Действие не принято. Попробуйте ещё раз.');
  }

  const cell = (field: RouletteField, label: string, className: string, hint?: string) => {
    const amount = myBets[field];
    const won = result !== null && rouletteWins(field, result);
    const classes = ['cell', className, won && 'won', result !== null && !won && 'dim'].filter(Boolean).join(' ');
    return (
      <button key={field} className={classes} disabled={!canBet} onClick={() => send(connection.rouletteBet(field, chip))}>
        <span>{label}</span>
        {hint && <span className="cell-hint">{hint}</span>}
        {amount !== undefined && <span className="cell-chip">{formatChips(amount)}</span>}
      </button>
    );
  };

  const timer = game.timeLeftMs !== null && game.phase !== 'spinning' && <Countdown ms={game.timeLeftMs} stamp={snapshot} />;
  const status = (text: string) => (
    <div className="status">
      <span>{text}</span>
      <span className="hint">
        {timer} {timer && '· '}
        {formatChips(free)} фишек
      </span>
    </div>
  );

  let headline = 'Делайте ставки';
  if (game.phase === 'spinning') headline = 'Колесо крутится…';
  if (result !== null) headline = `Выпало ${result}, ${COLOR_NAMES[numberColor(result)]}`;

  let panel: ReactNode;
  if (game.phase === 'result') {
    panel = status(mine?.net != null ? `Раунд окончен: ${mine.net === 0 ? 'при своих' : formatSigned(mine.net)}` : 'Раунд окончен.');
  } else if (game.phase === 'spinning') {
    panel = status(stake > 0 ? `Ваши ставки: ${formatChips(stake)}` : 'Вы в игре со следующего раунда.');
  } else if (mine?.ready) {
    panel = status(`Ставки приняты: ${formatChips(stake)}. Ждём остальных.`);
  } else if (stake === 0 && me.balance < MIN_BET) {
    panel = (
      <>
        {status('Не хватает фишек на минимальную ставку.')}
        <button className="primary" onClick={onOpenCashier}>
          В кассу
        </button>
      </>
    );
  } else {
    panel = (
      <>
        {status(error ?? (stake > 0 ? `Ваши ставки: ${formatChips(stake)}` : 'Выберите фишку и нажмите на поле.'))}
        <div className="chips">
          {ROULETTE_CHIPS.map((value) => (
            <button key={value} className={value === chip ? 'chip selected' : 'chip'} onClick={() => setChip(value)}>
              {value}
            </button>
          ))}
        </div>
        <div className="row">
          <button disabled={stake === 0} onClick={() => send(connection.rouletteClear())}>
            Сбросить
          </button>
          <button className="primary" disabled={stake === 0} onClick={() => send(connection.rouletteReady())}>
            Готов
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="r-players">
        {players.map((item) => {
          const own = item.player.id === me.id;
          const reaction = connection.reactions[item.player.id];
          const total = sum(item.bets);
          const avatar = <PlayerAvatar player={item.player} size={36} />;
          return (
            <div key={item.player.id} className={item.connected ? 'r-player' : 'r-player offline'}>
              <span className="avatar-slot">
                {own ? (
                  <button className="avatar-button" aria-label="Реакция" onClick={() => setPicking(!picking)}>
                    {avatar}
                  </button>
                ) : (
                  avatar
                )}
                {reaction && <span className="reaction">{reaction}</span>}
              </span>
              <span className="who">{own ? 'Вы' : playerName(item.player)}</span>
              {item.net !== null ? (
                <span className={item.net > 0 ? 'net-win' : item.net < 0 ? 'net-lose' : 'hint'}>
                  {item.net === 0 ? '0' : formatSigned(item.net)}
                </span>
              ) : (
                <span className="hint">
                  {!item.connected ? 'нет связи' : total === 0 ? '—' : `${formatChips(total)}${item.ready ? ' ✓' : ''}`}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {picking && (
        <div className="r-reactions">
          {REACTIONS.map((value) => (
            <button
              key={value}
              onClick={() => {
                connection.sendReaction(value);
                setPicking(false);
              }}
            >
              {value}
            </button>
          ))}
        </div>
      )}

      <div className="r-wheel">
        <Wheel number={game.number} spinMs={game.phase === 'spinning' ? game.timeLeftMs : null} shown={result} />
        <div className="r-side">
          <span className="r-headline">{headline}</span>
          <span className="hint">Последние числа</span>
          <div className="r-history">
            {game.history.length === 0 && <span className="hint">пока нет</span>}
            {game.history.map((number, index) => (
              <span key={index} className={`r-past ${numberColor(number)}`}>
                {number}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="r-board">
        {cell('n0', '0', 'green zero')}
        {NUMBERS.map((number) => cell(`n${number}`, String(number), numberColor(number)))}
        {GROUPS.map(({ field, label, hint }) => cell(field, label, field === 'red' || field === 'black' ? `group ${field}` : 'group', hint))}
      </div>

      <div className="bottom">
        {chat}
        <div className="panel">{panel}</div>
      </div>
    </>
  );
}
