import './table.css';
import {
  CHIP_VALUES,
  MAX_BET,
  MIN_BET,
  type BjAction,
  type BjSeatView,
  type Me,
  type SeatView,
  type TableSnapshot,
} from '@casino/shared';
import { useState } from 'react';
import { Cards } from '../components/Cards.tsx';
import { Countdown } from '../components/Countdown.tsx';
import { PlayerAvatar, playerName } from '../components/PlayerAvatar.tsx';
import { formatChips } from '../format.ts';
import { useTable, type TableConnection } from '../realtime.ts';
import { shareInvite } from '../telegram.ts';

interface Props {
  code: string;
  me: Me;
  onBalance: (balance: number) => void;
  onOpenCashier: () => void;
  onBack: () => void;
}

const ACTION_LABELS: Record<BjAction, string> = { hit: 'Ещё', stand: 'Хватит', double: 'Удвоить', split: 'Сплит' };

const signed = (amount: number) => (amount > 0 ? `+${formatChips(amount)}` : amount < 0 ? `−${formatChips(-amount)}` : 'Ничья');
const netClass = (amount: number) => (amount > 0 ? 'net-win' : amount < 0 ? 'net-lose' : 'hint');

export function Table({ code, me, onBalance, onOpenCashier, onBack }: Props) {
  const connection = useTable(code, onBalance);
  const { status, snapshot, sit, stand, reclaim } = connection;
  // Место, на которое игрок хочет пересесть с другого стола; ждёт подтверждения.
  const [moveTo, setMoveTo] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const head = (title: string, invite?: () => void) => (
    <div className="tbl-head">
      <button className="link" onClick={onBack}>
        ‹ Столы
      </button>
      <span className="name">{title}</span>
      {invite && (
        <button className="link" onClick={invite}>
          Пригласить
        </button>
      )}
    </div>
  );

  if (status === 'not_found') {
    return (
      <div className="tbl">
        {head('Стол не найден')}
        <div className="tbl-notice">Проверьте ссылку или создайте новый стол.</div>
      </div>
    );
  }
  if (status === 'kicked') {
    return (
      <div className="tbl">
        {head('Приложение открыто в другом месте')}
        <div className="tbl-notice">Играть можно только с одного устройства.</div>
        <div className="panel">
          <button className="primary" onClick={reclaim}>
            Играть здесь
          </button>
        </div>
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="tbl">
        {head('Подключение…')}
      </div>
    );
  }

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

  async function invite() {
    const link = snapshot!.table.inviteLink ?? `${window.location.origin}/?tgWebAppStartParam=t_${code}`;
    const outcome = await shareInvite(link);
    if (outcome === 'copied') setNotice('Ссылка-приглашение скопирована.');
    if (outcome === 'failed') setNotice(`Скопируйте ссылку вручную: ${link}`);
  }

  return (
    <div className="tbl">
      {head(snapshot.table.name, invite)}
      {status === 'offline' && <div className="tbl-notice">Переподключение…</div>}
      {notice && <div className="tbl-notice">{notice}</div>}

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
            onSit={() => take(index)}
            onStand={stand}
          />
        ))}
      </div>

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
  );
}

interface SeatBoxProps {
  index: number;
  seat: SeatView | null;
  hands: BjSeatView | null;
  activeHand: number | null;
  mine: boolean;
  canSit: boolean;
  onSit: () => void;
  onStand: () => void;
}

function SeatBox({ index, seat, hands, activeHand, mine, canSit, onSit, onStand }: SeatBoxProps) {
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
      <PlayerAvatar player={seat.player} size={32} />
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
      {mine && (
        <button className="link" onClick={onStand}>
          Встать
        </button>
      )}
    </div>
  );
}

interface PanelProps {
  snapshot: TableSnapshot;
  me: Me;
  mySeat: number;
  connection: TableConnection;
  onOpenCashier: () => void;
}

function Panel({ snapshot, me, mySeat, connection, onOpenCashier }: PanelProps) {
  const { game } = snapshot;
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
          <button key={value} className="chip" disabled={pending + value > limit} onClick={() => setPending(pending + value)}>
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
