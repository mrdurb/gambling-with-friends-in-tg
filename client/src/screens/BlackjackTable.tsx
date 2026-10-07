import {
  CHIP_VALUES,
  MAX_BET,
  MIN_BET,
  REACTIONS,
  type BjAction,
  type BjSeatView,
  type BlackjackSnapshot,
  type Me,
  type SeatView,
} from '@casino/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Cards } from '../components/Cards.tsx';
import { Countdown } from '../components/Countdown.tsx';
import { PlayerAvatar, playerName } from '../components/PlayerAvatar.tsx';
import { formatChips, formatSigned } from '../format.ts';
import type { TableConnection } from '../realtime.ts';

interface Props {
  snapshot: BlackjackSnapshot;
  me: Me;
  connection: TableConnection;
  onOpenCashier: () => void;
  // Открытый чат стола: показывается над нижней панелью.
  chat: ReactNode;
}

const ACTION_LABELS: Record<BjAction, string> = { hit: 'Ещё', stand: 'Хватит', double: 'Удвоить', split: 'Сплит' };

const signed = (amount: number) => (amount === 0 ? 'Ничья' : formatSigned(amount));
const netClass = (amount: number) => (amount > 0 ? 'net-win' : amount < 0 ? 'net-lose' : 'hint');

export function BlackjackTable({ snapshot, me, connection, onOpenCashier, chat }: Props) {
  const { sit, stand } = connection;
  // Место, на которое игрок хочет пересесть с другого стола; ждёт подтверждения.
  const [moveTo, setMoveTo] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const { game } = snapshot;
  const mySeat = snapshot.seats.findIndex((seat) => seat?.player.id === me.id);

  async function take(seat: number, force = false) {
    setNotice(null);
    const result = await sit(seat, force);
    setMoveTo(null);
    if (result.ok) return;
    if (result.error === 'seated_elsewhere') setMoveTo(seat);
    else if (result.error === 'seat_taken') setNotice('Это место уже заняли.');
    else if (result.error === 'already_seated') setNotice('Дождитесь конца раздачи, чтобы сесть снова.');
    else setNotice('Не получилось сесть. Попробуйте ещё раз.');
  }

  return (
    <>
      {notice && <div className="tbl-notice">{notice}</div>}
      {game.shoeReshuffled && <div className="tbl-notice">Колода перетасована: в игре снова все шесть колод.</div>}

      <div className="dealer">
        <span className="hint">Дилер{game.dealer.cards.length > 0 ? ` · ${game.dealer.total}` : ''}</span>
        <Cards cards={game.dealer.cards} hiddenCount={game.dealer.holeHidden ? 1 : 0} />
      </div>

      <div className="seats">
        {snapshot.seats.map((seat, index) => (
          <SeatBox
            key={index}
            index={index}
            seat={seat}
            hands={game.seats[index] ?? null}
            activeHand={game.turn?.seat === index ? game.turn.hand : null}
            mine={index === mySeat}
            canSit={mySeat === -1}
            reaction={seat ? connection.reactions[seat.player.id] : undefined}
            picking={index === mySeat && picking && !seat?.leaving}
            onAvatar={() => setPicking(!picking)}
            onReact={(value) => {
              connection.sendReaction(value);
              setPicking(false);
            }}
            onSit={() => take(index)}
            onStand={stand}
          />
        ))}
      </div>

      <div className="bottom">
        {chat}
        {moveTo !== null ? (
          <div className="panel">
            <span>Вы сидите за другим столом. Если пересесть, место там освободится.</span>
            <div className="row">
              <button className="primary" onClick={() => take(moveTo, true)}>
                Пересесть сюда
              </button>
              <button onClick={() => setMoveTo(null)}>Отмена</button>
            </div>
          </div>
        ) : (
          <Panel snapshot={snapshot} me={me} mySeat={mySeat} connection={connection} onOpenCashier={onOpenCashier} />
        )}
      </div>
    </>
  );
}

interface SeatBoxProps {
  index: number;
  seat: SeatView | null;
  hands: BjSeatView | null;
  activeHand: number | null;
  mine: boolean;
  canSit: boolean;
  // Реакция игрока, которая сейчас видна.
  reaction: string | undefined;
  // Открыт ли выбор реакции (только на своём месте).
  picking: boolean;
  onAvatar: () => void;
  onReact: (value: string) => void;
  onSit: () => void;
  onStand: () => void;
}

function SeatBox(props: SeatBoxProps) {
  const { index, seat, hands, activeHand, mine, canSit, reaction, picking, onAvatar, onReact, onSit, onStand } = props;
  if (!seat) {
    return (
      <div className="seat">
        <span className="hint">Место {index + 1}</span>
        {canSit ? <button onClick={onSit}>Сесть</button> : <span className="hint">Свободно</span>}
      </div>
    );
  }

  const classes = ['seat', activeHand !== null && 'turn', !seat.connected && 'offline'].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      <span className="avatar-slot">
        {mine && !seat.leaving ? (
          <button className="avatar-button" aria-label="Реакция" onClick={onAvatar}>
            <PlayerAvatar player={seat.player} size={32} />
          </button>
        ) : (
          <PlayerAvatar player={seat.player} size={32} />
        )}
        {reaction && <span className="reaction">{reaction}</span>}
      </span>
      {picking && (
        <div className="reaction-picker">
          {REACTIONS.map((value) => (
            <button key={value} onClick={() => onReact(value)}>
              {value}
            </button>
          ))}
        </div>
      )}
      <span className="who">{mine ? 'Вы' : playerName(seat.player)}</span>
      {!seat.connected && <span className="hint">нет связи</span>}
      {hands?.hands.map((hand, handIndex) => (
        <div key={handIndex} className={handIndex === activeHand ? 'hand active' : 'hand'}>
          {hand.cards.length > 0 && <Cards cards={hand.cards} />}
          <span className="hint">
            {hand.cards.length > 0 ? `${hand.total} · ` : ''}
            {formatChips(hand.bet)}
          </span>
        </div>
      ))}
      {hands?.net != null && <span className={netClass(hands.net)}>{signed(hands.net)}</span>}
      {seat.leaving ? (
        <span className="hint">{mine ? 'Встаёте после раздачи' : 'уходит'}</span>
      ) : (
        mine && (
          <button className="link" onClick={onStand}>
            Встать
          </button>
        )
      )}
    </div>
  );
}

interface PanelProps {
  snapshot: BlackjackSnapshot;
  me: Me;
  mySeat: number;
  connection: TableConnection;
  onOpenCashier: () => void;
}

function Panel({ snapshot, me, mySeat, connection, onOpenCashier }: PanelProps) {
  const { game } = snapshot;
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Отказ относится к одному действию: со сменой хода или фазы он уже неактуален.
  useEffect(() => setError(null), [game.phase, game.turn?.seat, game.turn?.hand]);

  const mine = mySeat === -1 ? null : game.seats[mySeat];
  const stake = mine?.hands.reduce((sum, hand) => sum + hand.bet, 0) ?? 0;
  // После расчёта баланс уже включает результат раздачи; до него ставка ещё не списана.
  const free = game.phase === 'result' ? me.balance : me.balance - stake;
  const timer = game.timeLeftMs !== null && <Countdown ms={game.timeLeftMs} stamp={snapshot} />;

  const status = (text: string) => (
    <div className="status">
      <span>{text}</span>
      <span className="hint">
        {timer} {timer && '· '}
        {formatChips(free)} фишек
      </span>
    </div>
  );

  async function send(request: Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    const result = await request;
    if (!result.ok) setError('Действие не принято. Посмотрите на стол: возможно, ход уже перешёл.');
    return result.ok;
  }

  if (mySeat === -1) {
    return (
      <div className="panel">
        {status(me.balance < MIN_BET ? 'Фишки кончились.' : 'Выберите свободное место, чтобы играть.')}
        {me.balance < MIN_BET && (
          <button className="primary" onClick={onOpenCashier}>
            В кассу
          </button>
        )}
      </div>
    );
  }

  if (game.phase === 'result') {
    return <div className="panel">{status(mine?.net != null ? `Раздача окончена: ${signed(mine.net)}` : 'Раздача окончена.')}</div>;
  }

  if (game.phase === 'playing') {
    if (game.turn?.seat !== mySeat) {
      const acting = game.turn ? snapshot.seats[game.turn.seat] : null;
      const who = acting ? `Ходит ${playerName(acting.player)}.` : 'Идёт раздача.';
      return <div className="panel">{status(mine ? who : `${who} Вы в игре со следующей раздачи.`)}</div>;
    }
    return (
      <div className="panel">
        {status(error ?? 'Ваш ход.')}
        <div className="row">
          {game.turn.actions.map((action) => (
            <button
              key={action}
              className={action === 'hit' || action === 'stand' ? 'primary' : undefined}
              onClick={() => send(connection.act(action))}
            >
              {ACTION_LABELS[action]}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (mine) {
    return <div className="panel">{status(`Ставка ${formatChips(stake)} принята. Ждём остальных.`)}</div>;
  }

  if (me.balance < MIN_BET) {
    return (
      <div className="panel">
        {status('Не хватает фишек на минимальную ставку.')}
        <button className="primary" onClick={onOpenCashier}>
          В кассу
        </button>
      </div>
    );
  }

  const limit = Math.min(MAX_BET, me.balance);
  return (
    <div className="panel">
      {status(error ?? `Ставка: ${formatChips(pending)} (от ${MIN_BET} до ${formatChips(MAX_BET)})`)}
      <div className="chips">
        {CHIP_VALUES.map((value) => (
          <button
            key={value}
            className="chip"
            disabled={pending + value > limit}
            onClick={() => {
              setError(null);
              setPending(pending + value);
            }}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="row">
        <button disabled={pending === 0} onClick={() => setPending(0)}>
          Сбросить
        </button>
        <button
          className="primary"
          disabled={pending < MIN_BET}
          onClick={async () => {
            if (await send(connection.bet(pending))) setPending(0);
          }}
        >
          Поставить {formatChips(pending)}
        </button>
      </div>
    </div>
  );
}
