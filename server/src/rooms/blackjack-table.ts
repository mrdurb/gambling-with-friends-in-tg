import {
  BET_MS,
  DISCONNECT_GRACE_MS,
  MAX_MISSES,
  MIN_BET,
  RESULT_MS,
  SEATS,
  TURN_MS,
  type Ack,
  type BjAction,
  type Card,
  type PlayerInfo,
  type TableSnapshot,
} from '@casino/shared';
import { Blackjack } from '../games/blackjack.ts';
import type { PlayerResult } from '../rounds.ts';
import { PhaseTimer, type HostContext, type TableHost, type Timer } from './host.ts';

interface Seat {
  player: PlayerInfo;
  connected: boolean;
  // Таймер, по которому место без связи освобождается.
  release?: Timer;
  // Игрок встал посреди раздачи: место освободится после расчёта.
  leaving: boolean;
  // Пропуски подряд: не поставил или не походил вовремя.
  misses: number;
  // В текущей раздаче пропуск хода уже засчитан (после сплита рук две, а пропуск один).
  timedOut: boolean;
}

const fail = (error: string): Ack => ({ ok: false, error });

// Стол блэкджека: места, фазы раздачи и их таймеры, пропуски.
// seated — общий для всех столов учёт «кто за каким столом сидит»: сидеть можно только за одним.
export class BlackjackTable implements TableHost {
  private readonly seats: (Seat | null)[] = Array.from({ length: SEATS }, () => null);
  private readonly game: Blackjack;
  // Таймер фазы: ставки, ход или показ результата.
  private readonly timer = new PhaseTimer();

  constructor(
    private readonly ctx: HostContext,
    private readonly seated: Map<number, BlackjackTable>,
    newShoe: () => Card[],
  ) {
    this.game = new Blackjack(newShoe);
  }

  get code(): string {
    return this.ctx.table.code;
  }

  enter(player: PlayerInfo): void {
    const seat = this.seatOf(player.id);
    if (!seat) return;
    clearTimeout(seat.release);
    seat.release = undefined;
    seat.connected = true;
    seat.player = player;
  }

  // Место за ушедшим сохраняется на время.
  exit(userId: number): void {
    const seat = this.seatOf(userId);
    if (seat && !seat.leaving) {
      seat.connected = false;
      seat.release = setTimeout(() => this.stand(userId), DISCONNECT_GRACE_MS);
    }
  }

  sit(userId: number, index: number, force: boolean): Ack {
    if (!Number.isInteger(index) || index < 0 || index >= SEATS) return fail('bad_seat');

    // Место этого же игрока, которое ещё доигрывает раздачу после «Встать».
    if (this.seatOf(userId)) return fail('already_seated');
    const elsewhere = this.seated.get(userId);
    if (elsewhere && !force) return fail('seated_elsewhere');
    if (this.seats[index]) return fail('seat_taken');

    elsewhere?.stand(userId);
    this.seats[index] = {
      player: this.ctx.present.get(userId)!,
      connected: true,
      leaving: false,
      misses: 0,
      timedOut: false,
    };
    this.seated.set(userId, this);
    this.ctx.publish();
    return { ok: true };
  }

  // Игрок уходит с места: сразу, если не участвует в раздаче, иначе — после её расчёта.
  stand(userId: number): void {
    const index = this.seats.findIndex((seat) => seat?.player.id === userId);
    const seat = this.seats[index];
    if (!seat) return;
    if (this.seated.get(userId) === this) this.seated.delete(userId);

    const { game } = this;
    if (game.hasBet(index) && game.phase !== 'betting') {
      seat.leaving = true;
      clearTimeout(seat.release);
      if (game.phase === 'playing') {
        // Чужой уход не трогает таймер того, кто сейчас ходит.
        const ownTurn = game.currentSeat() === index;
        game.forfeit(index);
        if (ownTurn) this.afterMove();
        else this.ctx.publish();
      } else {
        this.ctx.publish();
      }
      return;
    }

    game.cancelBet(index);
    this.removeSeat(index);
    if (game.phase === 'waiting') this.timer.clear();
    if (!this.startIfEveryoneBet()) this.ctx.publish();
  }

  bet(userId: number, amount: number): Ack {
    const place = this.placeOf(userId);
    if (!place) return fail('not_seated');

    const result = this.game.bet(place.index, amount, this.ctx.freeBalance(userId));
    if (!result.ok) return result;
    place.seat.misses = 0;
    if (this.game.betCount() === 1) this.timer.set(BET_MS, () => this.startRound());
    if (!this.startIfEveryoneBet()) this.ctx.publish();
    return result;
  }

  act(userId: number, action: BjAction): Ack {
    const place = this.placeOf(userId);
    if (!place) return fail('not_seated');

    const result = this.game.act(place.index, action, this.ctx.freeBalance(userId));
    if (!result.ok) return result;
    place.seat.misses = 0;
    this.afterMove();
    return result;
  }

  // Рассчитанные раздачи уже учтены в балансе.
  stakeOf(userId: number): number {
    if (this.game.phase === 'result') return 0;
    const index = this.seats.findIndex((seat) => seat?.player.id === userId);
    return index === -1 ? 0 : this.game.stake(index);
  }

  isIdle(): boolean {
    return this.game.phase === 'waiting' && this.seats.every((seat) => !seat);
  }

  snapshot(): TableSnapshot {
    const { present } = this.ctx;
    const seatedHere = this.seats.filter((seat) => seat && present.has(seat.player.id)).length;
    const turnSeat = this.game.currentSeat();
    return {
      kind: 'blackjack',
      table: this.ctx.table,
      seats: this.seats.map(
        (seat) => seat && { player: seat.player, connected: seat.connected, leaving: seat.leaving },
      ),
      spectators: present.size - seatedHere,
      game: this.game.view(
        SEATS,
        turnSeat === null ? 0 : this.ctx.freeBalance(this.seats[turnSeat]!.player.id),
        this.timer.leftMs(),
      ),
    };
  }

  // Место игрока, если он сидит и не уходит из-за стола.
  private placeOf(userId: number): { index: number; seat: Seat } | null {
    const index = this.seats.findIndex((seat) => seat?.player.id === userId);
    const seat = this.seats[index];
    return seat && !seat.leaving ? { index, seat } : null;
  }

  private seatOf(userId: number): Seat | null {
    return this.seats.find((seat) => seat?.player.id === userId) ?? null;
  }

  private removeSeat(index: number): void {
    const seat = this.seats[index];
    if (!seat) return;
    clearTimeout(seat.release);
    if (this.seated.get(seat.player.id) === this) this.seated.delete(seat.player.id);
    this.seats[index] = null;
  }

  private startIfEveryoneBet(): boolean {
    const everyoneBet = this.seats.every((seat, index) => !seat || this.game.hasBet(index));
    if (this.game.phase !== 'betting' || !everyoneBet) return false;
    this.startRound();
    return true;
  }

  private startRound(): void {
    this.seats.forEach((seat, index) => {
      if (!seat) return;
      seat.timedOut = false;
      if (!this.game.hasBet(index)) seat.misses += 1;
    });
    this.game.start();
    this.afterMove();
  }

  // После любого изменения в раздаче: заводит таймер следующего хода или рассчитывает раунд.
  private afterMove(): void {
    if (this.game.phase === 'playing') {
      this.timer.set(TURN_MS, () => {
        const index = this.game.timeout();
        const seat = index === null ? null : this.seats[index];
        if (seat && !seat.timedOut) {
          seat.timedOut = true;
          seat.misses += 1;
        }
        this.afterMove();
      });
      this.ctx.publish();
    } else if (this.game.phase === 'result') {
      this.finishRound();
    }
  }

  private finishRound(): void {
    const results = (this.game.results() ?? []).flatMap((result): PlayerResult[] => {
      const seat = this.seats[result.seat];
      return seat
        ? [{ userId: seat.player.id, wagered: result.wagered, net: result.net, outcome: result.outcome, details: result.details }]
        : [];
    });
    // Раздача не записалась — аннулируется сразу, чтобы стол не показывал выигрыши, которых никто не получил.
    if (!this.ctx.payOut(results)) return this.endResult();
    this.timer.set(RESULT_MS, () => this.endResult());
    this.ctx.publish();
  }

  private endResult(): void {
    this.timer.clear();
    this.game.reset();
    this.seats.forEach((seat, index) => {
      if (!seat) return;
      const broke = this.ctx.balanceOf(seat.player.id) < MIN_BET;
      if (seat.leaving || seat.misses >= MAX_MISSES || broke) this.removeSeat(index);
    });
    this.ctx.publish();
  }
}
