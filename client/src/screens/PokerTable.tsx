import './poker.css';
import {
  POKER_MAX_BUYIN_BB,
  POKER_MIN_BUYIN_BB,
  REACTIONS,
  type Card,
  type Me,
  type PokerSeatView,
  type PokerSnapshot,
} from '@casino/shared';
import { useEffect, useState, type ReactNode } from 'react';
import { Cards } from '../components/Cards.tsx';
import { Countdown } from '../components/Countdown.tsx';
import { PlayerAvatar, playerName } from '../components/PlayerAvatar.tsx';
import { formatChips } from '../format.ts';
import type { TableConnection } from '../realtime.ts';

interface Props {
  snapshot: PokerSnapshot;
  me: Me;
  connection: TableConnection;
  onOpenCashier: () => void;
  // Открытый чат стола: показывается над нижней панелью.
  chat: ReactNode;
}

// Окно выбора суммы: посадка на место или докупка.
type Dialog = { kind: 'sit'; seat: number } | { kind: 'rebuy' } | null;

const ERRORS: Record<string, string> = {
  insufficient: 'Не хватает фишек на балансе.',
  seat_taken: 'Это место уже заняли.',
  seated_elsewhere: 'Вы сидите за другим столом. Сначала встаньте там.',
  in_hand: 'Докупить можно, когда вы не в раздаче.',
  bad_amount: 'Такая сумма не подходит.',
  bad_buyin: 'Такой стек не подходит для этого стола.',
  not_your_turn: 'Ход уже перешёл.',
};

// Место на овале: 0 — внизу по центру, дальше по часовой стрелке. radius — доля от полуосей.
function place(slot: number, count: number, radius: number) {
  const angle = (Math.PI / 2) * 1 + (slot * 2 * Math.PI) / count;
  return { left: `${50 + 45 * radius * Math.cos(angle)}%`, top: `${50 + 43 * radius * Math.sin(angle)}%` };
}

export function PokerTable({ snapshot, me, connection, onOpenCashier, chat }: Props) {
  const { game } = snapshot;
  const [, big] = snapshot.table.poker!.blinds;
  const [minBuyIn, maxBuyIn] = [big * POKER_MIN_BUYIN_BB, big * POKER_MAX_BUYIN_BB];
  const [openedDialog, setDialog] = useState<Dialog>(null);
  const [amount, setAmount] = useState(0);
  const [raiseTo, setRaiseTo] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const count = game.seats.length;
  const mySeat = game.seats.findIndex((seat) => seat?.player.id === me.id);
  const mine = mySeat === -1 ? null : game.seats[mySeat]!;
  const myTurn = game.turn !== null && game.turn.seat === mySeat ? game.turn : null;
  // Окно теряет смысл, если место под ним исчезло: докупать некому, а садиться после посадки незачем.
  const dialog = openedDialog && (openedDialog.kind === 'rebuy') === Boolean(mine) ? openedDialog : null;
  const bets = game.seats.reduce((sum, seat) => sum + (seat?.bet ?? 0), 0);
  const pot = game.pots.reduce((sum, value) => sum + value, 0) + bets;
  // Фишки вне стола: всё, что стол зарезервировал под стек, в них не входит.
  const free = me.balance - (mine?.staked ?? 0);

  // Отказ относится к одному действию: со сменой хода или фазы он уже неактуален.
  useEffect(() => setError(null), [game.phase, game.turn?.seat]);
  // На каждый свой ход ползунок рейза встаёт на минимум.
  useEffect(() => setRaiseTo(myTurn?.minRaise ?? 0), [myTurn?.minRaise, myTurn?.seat, game.phase]);

  async function send(request: Promise<{ ok: true } | { ok: false; error: string }>) {
    setError(null);
    const outcome = await request;
    if (!outcome.ok) setError(ERRORS[outcome.error] ?? 'Действие не принято. Попробуйте ещё раз.');
    return outcome.ok;
  }

  function openDialog(next: Exclude<Dialog, null>) {
    const [low, high] = next.kind === 'sit' ? [minBuyIn, maxBuyIn] : [Math.max(1, minBuyIn - mine!.stack), maxBuyIn - mine!.stack];
    setError(null);
    setAmount(Math.max(low, Math.min(high, free)));
    setDialog(next);
  }

  const seatNode = (seat: PokerSeatView | null, index: number) => {
    // Свои карты игрок видит всегда; чужие — только открытые.
    const slot = (index - Math.max(mySeat, 0) + count) % count;
    const style = place(slot, count, 1);
    if (!seat) {
      return (
        <div key={index} className="p-seat empty" style={style}>
          {mySeat === -1 ? <button onClick={() => openDialog({ kind: 'sit', seat: index })}>Сесть</button> : <span className="hint">пусто</span>}
        </div>
      );
    }
    const own = index === mySeat;
    const reaction = connection.reactions[seat.player.id];
    const classes = ['p-seat', game.turn?.seat === index && 'turn', seat.state === 'folded' && 'folded', !seat.connected && 'offline']
      .filter(Boolean)
      .join(' ');
    const avatar = <PlayerAvatar player={seat.player} size={34} />;
    return (
      <div key={index} className={classes} style={style}>
        <span className="avatar-slot">
          {own && !seat.leaving ? (
            <button className="avatar-button" aria-label="Реакция" onClick={() => setPicking(!picking)}>
              {avatar}
            </button>
          ) : (
            avatar
          )}
          {reaction && <span className="reaction">{reaction}</span>}
          {game.button === index && <span className="p-button">D</span>}
        </span>
        <span className="who">{own ? 'Вы' : playerName(seat.player)}</span>
        <span className="p-stack">{seat.state === 'allin' ? 'Олл-ин' : formatChips(seat.stack)}</span>
        {seat.cards ? <Cards cards={seat.cards} size="small" /> : seat.hasCards && !own && <Cards cards={[]} hiddenCount={2} size="small" />}
        {seat.won ? <span className="net-win">+{formatChips(seat.won)}</span> : null}
        {seat.hand && <span className="hint">{seat.hand}</span>}
        {seat.state === 'folded' && <span className="hint">пас</span>}
        {!seat.connected && <span className="hint">нет связи</span>}
      </div>
    );
  };

  // Ставки текущего круга лежат между местом и центром стола.
  const betNode = (seat: PokerSeatView | null, index: number) => {
    if (!seat || seat.bet === 0) return null;
    const slot = (index - Math.max(mySeat, 0) + count) % count;
    return (
      <span key={index} className="p-bet" style={place(slot, count, 0.56)}>
        {formatChips(seat.bet)}
      </span>
    );
  };

  const timer = game.timeLeftMs !== null && (game.turn || game.phase === 'discard') && <Countdown ms={game.timeLeftMs} stamp={snapshot} />;
  // «Встать» доступно сидящему всегда, в том числе на своём ходу.
  const status = (text: string) => (
    <div className="status">
      <span>{error ?? text}</span>
      <span className="hint">
        {timer}
        {mine && !mine.leaving && !dialog && (
          <button className="link" onClick={connection.pokerLeave}>
            Встать
          </button>
        )}
      </span>
    </div>
  );

  let panel: ReactNode;
  if (dialog) {
    const sitting = dialog.kind === 'sit';
    const low = sitting ? minBuyIn : Math.max(1, minBuyIn - mine!.stack);
    const high = Math.min(free, sitting ? maxBuyIn : maxBuyIn - mine!.stack);
    const confirm = async () => {
      const ok = await send(sitting ? connection.pokerSit(dialog.seat, amount) : connection.pokerRebuy(amount));
      if (ok) setDialog(null);
    };
    panel =
      high < low ? (
        <>
          {status(`Нужно минимум ${formatChips(low)} фишек, на балансе свободно ${formatChips(Math.max(free, 0))}.`)}
          <div className="row">
            <button className="primary" onClick={onOpenCashier}>
              В кассу
            </button>
            <button onClick={() => setDialog(null)}>Отмена</button>
          </div>
        </>
      ) : (
        <>
          {status(sitting ? `Стек: ${formatChips(amount)}` : `Докупить: ${formatChips(amount)}`)}
          <input type="range" min={low} max={high} step={big} value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
          <div className="row">
            <button onClick={() => setAmount(low)}>Мин. {formatChips(low)}</button>
            <button onClick={() => setAmount(high)}>Макс. {formatChips(high)}</button>
          </div>
          <div className="row">
            <button className="primary" onClick={confirm}>
              {sitting ? 'Сесть' : 'Докупить'}
            </button>
            <button onClick={() => setDialog(null)}>Отмена</button>
          </div>
        </>
      );
  } else if (!mine) {
    panel = status(`Блайнды ${snapshot.table.poker!.blinds.join('/')}. Выберите свободное место.`);
  } else if (mine.leaving) {
    panel = status('Вы встаёте после этой раздачи.');
  } else if (game.phase === 'discard' && mine.hasCards && !mine.discarded) {
    panel = status('Нажмите на карту, которую сбрасываете.');
  } else if (myTurn) {
    const { toCall, minRaise, maxRaise } = myTurn;
    // Рейз размером в долю банка: уравнять и добавить эту долю от банка после колла.
    const sized = (share: number) => Math.max(minRaise, Math.min(maxRaise, Math.round(mine.bet + toCall + (pot + toCall) * share)));
    panel = (
      <>
        {status(toCall > 0 ? `Ваш ход. До колла — ${formatChips(toCall)}.` : 'Ваш ход.')}
        {maxRaise > 0 && (
          <>
            <input
              type="range"
              min={minRaise}
              max={maxRaise}
              step={1}
              value={raiseTo}
              onChange={(event) => setRaiseTo(Number(event.target.value))}
            />
            <div className="row">
              <button onClick={() => setRaiseTo(sized(0.5))}>½ банка</button>
              <button onClick={() => setRaiseTo(sized(1))}>Банк</button>
              <button onClick={() => setRaiseTo(maxRaise)}>Олл-ин</button>
            </div>
          </>
        )}
        <div className="row">
          <button onClick={() => send(connection.pokerAct('fold'))}>Пас</button>
          <button className="primary" onClick={() => send(connection.pokerAct(toCall > 0 ? 'call' : 'check'))}>
            {toCall > 0 ? `Колл ${formatChips(toCall)}` : 'Чек'}
          </button>
          {maxRaise > 0 && (
            <button className="primary" onClick={() => send(connection.pokerAct('raise', raiseTo))}>
              {raiseTo === maxRaise ? 'Олл-ин' : toCall > 0 || mine.bet > 0 ? 'Рейз до' : 'Ставка'} {formatChips(raiseTo)}
            </button>
          )}
        </div>
      </>
    );
  } else {
    const inHand = mine.state === 'active' || mine.state === 'allin';
    const acting = game.turn ? game.seats[game.turn.seat] : null;
    const canRebuy = !(inHand && game.phase !== 'result') && mine.stack < maxBuyIn;
    // Показать можно руку, которую не сбросили и которая ещё закрыта.
    const canShow = game.phase === 'result' && mine.hasCards && !mine.cards && connection.myCards.length > 0;
    let text = 'Ждём второго игрока с фишками.';
    if (game.phase === 'result') text = mine.won ? `Вы забрали ${formatChips(mine.won)}.` : 'Раздача окончена.';
    else if (mine.stack === 0 && !inHand) text = 'Фишки кончились. Докупите, чтобы играть дальше.';
    else if (game.phase === 'discard') text = 'Ждём, пока остальные сбросят карту.';
    else if (acting) text = `Ходит ${playerName(acting.player)}.`;
    else if (game.phase !== 'waiting') text = inHand ? 'Вскрытие.' : 'Идёт раздача. Вы в игре со следующей.';
    panel = (
      <>
        {status(text)}
        <div className="row">
          {canShow && (
            <button className="primary" onClick={() => send(connection.pokerShow())}>
              Показать карты
            </button>
          )}
          {canRebuy && <button onClick={() => openDialog({ kind: 'rebuy' })}>Докупить</button>}
        </div>
      </>
    );
  }

  const discarding = game.phase === 'discard' && mine?.hasCards && !mine.discarded;
  const ownCards: Card[] = connection.myCards;

  return (
    <>
      <div className="p-felt">
        <div className="p-center">
          <Cards cards={game.board} />
          {pot > 0 && (
            <span className="p-pot">
              Банк {formatChips(pot)}
              {game.pots.length > 1 && <span className="hint"> · {game.pots.map(formatChips).join(' + ')}</span>}
            </span>
          )}
        </div>
        {game.seats.map(betNode)}
        {game.seats.map(seatNode)}
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

      {mine && ownCards.length > 0 && mine.state !== 'folded' && (
        <div className="p-own">
          {ownCards.map((card, index) => (
            <button key={index} className="p-own-card" disabled={!discarding} onClick={() => send(connection.pokerDiscard(index))}>
              <Cards cards={[card]} size="big" />
            </button>
          ))}
          <span className="p-own-stack">
            <span className="hint">Стек</span>
            {formatChips(mine.stack)}
          </span>
        </div>
      )}

      <div className="bottom">
        {chat}
        <div className="panel">{panel}</div>
      </div>
    </>
  );
}
