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
  type TableInfo,
  type TableSnapshot,
} from '@casino/shared';
import { Blackjack } from './games/blackjack.ts';
import type { PlayerResult } from './rounds.ts';

type Timer = ReturnType<typeof setTimeout>;

interface Seat {
  player: PlayerInfo;
  connected: boolean;
  // Таймер, по которому место без связи освобождается.
  release?: Timer;
  // Игрок встал посреди раздачи: место освободится после расчёта.
  leaving: boolean;
  // Пропуски подряд: не поставил или не походил вовремя.
  misses: number;
}

interface Room {
  table: TableInfo;
  seats: (Seat | null)[];
  // Игроки, у которых стол сейчас открыт (сидящие и зрители).
  present: Map<number, PlayerInfo>;
  game: Blackjack;
  // Текущий таймер фазы: ставки, ход или показ результата.
  timer: { handle: Timer; endsAt: number } | null;
}

export interface RoomDeps {
  broadcast: (snapshot: TableSnapshot) => void;
  balanceOf: (userId: number) => number;
  // Записывает итоги раунда и возвращает новые балансы участников.
  settle: (tableCode: string, results: PlayerResult[]) => Map<number, number>;
  notifyBalance: (userId: number, balance: number) => void;
  newShoe: () => Card[];
}

const fail = (error: string): Ack => ({ ok: false, error });

// Живое состояние столов: кто смотрит, кто сидит, фазы раздачи и их таймеры.
// О сокетах и базе не знает: всё внешнее приходит через deps.
export class Rooms {
  private readonly rooms = new Map<string, Room>();
  private readonly presentAt = new Map<number, string>();
  private readonly seatedAt = new Map<number, string>();

  constructor(private readonly deps: RoomDeps) {}

  // Игрок открыл стол. Возвращает снимок, который он должен увидеть.
  enter(table: TableInfo, player: PlayerInfo): TableSnapshot {
    if (this.presentAt.get(player.id) !== table.code) this.exit(player.id);

    let room = this.rooms.get(table.code);
    if (!room) {
      room = {
        table,
        seats: Array.from({ length: SEATS }, () => null),
        present: new Map(),
        game: new Blackjack(this.deps.newShoe),
        timer: null,
      };
      this.rooms.set(table.code, room);
    }
    room.table = table;
    room.present.set(player.id, player);
    this.presentAt.set(player.id, table.code);

    const seat = this.seatOf(room, player.id);
    if (seat) {
      clearTimeout(seat.release);
      seat.release = undefined;
      seat.connected = true;
      seat.player = player;
    }
    return this.publish(room);
  }

  // Игрок закрыл стол или потерял связь. Место за ним сохраняется на время.
  exit(userId: number): void {
    const room = this.rooms.get(this.presentAt.get(userId) ?? '');
    if (!room) return;
    room.present.delete(userId);
    this.presentAt.delete(userId);

    const seat = this.seatOf(room, userId);
    if (seat && !seat.leaving) {
      seat.connected = false;
      seat.release = setTimeout(() => this.leaveSeat(room, userId), DISCONNECT_GRACE_MS);
    }
    this.publish(room);
  }

  sit(userId: number, index: number, force = false): Ack {
    const room = this.rooms.get(this.presentAt.get(userId) ?? '');
    if (!room) return fail('not_at_table');
    if (!Number.isInteger(index) || index < 0 || index >= SEATS) return fail('bad_seat');

    // Место этого же игрока, которое ещё доигрывает раздачу после «Встать».
    if (this.seatOf(room, userId)) return fail('already_seated');
    const elsewhere = this.rooms.get(this.seatedAt.get(userId) ?? '');
    if (elsewhere && !force) return fail('seated_elsewhere');
    if (room.seats[index]) return fail('seat_taken');

    if (elsewhere) this.leaveSeat(elsewhere, userId);
    room.seats[index] = { player: room.present.get(userId)!, connected: true, leaving: false, misses: 0 };
    this.seatedAt.set(userId, room.table.code);
    this.publish(room);
    return { ok: true };
  }

  stand(userId: number): void {
    const room = this.rooms.get(this.seatedAt.get(userId) ?? '');
    if (room) this.leaveSeat(room, userId);
  }

  bet(userId: number, amount: number): Ack {
    const place = this.placeOf(userId);
    if (!place) return fail('not_seated');
    const { room, index, seat } = place;

    const result = room.game.bet(index, amount, this.deps.balanceOf(userId));
    if (!result.ok) return result;
    seat.misses = 0;
    if (room.game.betCount() === 1) this.setTimer(room, BET_MS, () => this.startRound(room));
    if (!this.startIfEveryoneBet(room)) this.publish(room);
    return result;
  }

  act(userId: number, action: BjAction): Ack {
    const place = this.placeOf(userId);
    if (!place) return fail('not_seated');
    const { room, index, seat } = place;

    const result = room.game.act(index, action, this.freeBalance(room, index));
    if (!result.ok) return result;
    seat.misses = 0;
    this.afterMove(room);
    return result;
  }

  // Код стола, который у игрока сейчас открыт.
  tableOf(userId: number): string | null {
    return this.presentAt.get(userId) ?? null;
  }

  isSeatedAt(userId: number, code: string): boolean {
    return this.seatedAt.get(userId) === code;
  }

  // Место игрока, если он сидит и не уходит из-за стола.
  private placeOf(userId: number): { room: Room; index: number; seat: Seat } | null {
    const room = this.rooms.get(this.seatedAt.get(userId) ?? '');
    const index = room?.seats.findIndex((seat) => seat?.player.id === userId) ?? -1;
    const seat = room?.seats[index];
    return room && seat && !seat.leaving ? { room, index, seat } : null;
  }

  private seatOf(room: Room, userId: number): Seat | null {
    return room.seats.find((seat) => seat?.player.id === userId) ?? null;
  }

  private freeBalance(room: Room, index: number): number {
    const seat = room.seats[index];
    return seat ? this.deps.balanceOf(seat.player.id) - room.game.stake(index) : 0;
  }

  // Игрок уходит с места: сразу, если не участвует в раздаче, иначе — после её расчёта.
  private leaveSeat(room: Room, userId: number): void {
    const index = room.seats.findIndex((seat) => seat?.player.id === userId);
    const seat = room.seats[index];
    if (!seat) return;
    if (this.seatedAt.get(userId) === room.table.code) this.seatedAt.delete(userId);

    const { game } = room;
    if (game.hasBet(index) && game.phase !== 'betting') {
      seat.leaving = true;
      clearTimeout(seat.release);
      if (game.phase === 'playing') {
        game.forfeit(index);
        this.afterMove(room);
      } else {
        this.publish(room);
      }
      return;
    }

    game.cancelBet(index);
    this.removeSeat(room, index);
    if (game.phase === 'waiting') this.clearTimer(room);
    if (!this.startIfEveryoneBet(room)) this.publish(room);
  }

  private removeSeat(room: Room, index: number): void {
    const seat = room.seats[index];
    if (!seat) return;
    clearTimeout(seat.release);
    if (this.seatedAt.get(seat.player.id) === room.table.code) this.seatedAt.delete(seat.player.id);
    room.seats[index] = null;
  }

  private startIfEveryoneBet(room: Room): boolean {
    const everyoneBet = room.seats.every((seat, index) => !seat || room.game.hasBet(index));
    if (room.game.phase !== 'betting' || !everyoneBet) return false;
    this.startRound(room);
    return true;
  }

  private startRound(room: Room): void {
    room.seats.forEach((seat, index) => {
      if (seat && !room.game.hasBet(index)) seat.misses += 1;
    });
    room.game.start();
    this.afterMove(room);
  }

  // После любого изменения в раздаче: заводит таймер следующего хода или рассчитывает раунд.
  private afterMove(room: Room): void {
    if (room.game.phase === 'playing') {
      this.setTimer(room, TURN_MS, () => {
        const index = room.game.timeout();
        const seat = index === null ? null : room.seats[index];
        if (seat) seat.misses += 1;
        this.afterMove(room);
      });
      this.publish(room);
    } else if (room.game.phase === 'result') {
      this.finishRound(room);
    }
  }

  private finishRound(room: Room): void {
    const results = (room.game.results() ?? []).flatMap((result): PlayerResult[] => {
      const seat = room.seats[result.seat];
      return seat ? [{ userId: seat.player.id, wagered: result.wagered, net: result.net, outcome: result.outcome, details: result.details }] : [];
    });
    try {
      for (const [userId, balance] of this.deps.settle(room.table.code, results)) this.deps.notifyBalance(userId, balance);
    } catch (error) {
      // Раунд не записался — фишки ни у кого не изменились; стол продолжает работать.
      console.error('round settlement failed', error);
    }
    this.setTimer(room, RESULT_MS, () => this.endResult(room));
    this.publish(room);
  }

  private endResult(room: Room): void {
    this.clearTimer(room);
    room.game.reset();
    room.seats.forEach((seat, index) => {
      if (!seat) return;
      const broke = this.deps.balanceOf(seat.player.id) < MIN_BET;
      if (seat.leaving || seat.misses >= MAX_MISSES || broke) this.removeSeat(room, index);
    });
    this.publish(room);
  }

  private setTimer(room: Room, ms: number, onElapsed: () => void): void {
    this.clearTimer(room);
    room.timer = { handle: setTimeout(onElapsed, ms), endsAt: Date.now() + ms };
  }

  private clearTimer(room: Room): void {
    clearTimeout(room.timer?.handle);
    room.timer = null;
  }

  private publish(room: Room): TableSnapshot {
    const seated = room.seats.filter((seat) => seat && room.present.has(seat.player.id)).length;
    const turnSeat = room.game.currentSeat();
    const snapshot: TableSnapshot = {
      table: room.table,
      seats: room.seats.map((seat) => seat && { player: seat.player, connected: seat.connected }),
      spectators: room.present.size - seated,
      game: room.game.view(
        SEATS,
        turnSeat === null ? 0 : this.freeBalance(room, turnSeat),
        room.timer && Math.max(0, room.timer.endsAt - Date.now()),
      ),
    };
    const idle = room.game.phase === 'waiting' && room.present.size === 0 && room.seats.every((seat) => !seat);
    if (idle) {
      this.clearTimer(room);
      this.rooms.delete(room.table.code);
    }
    this.deps.broadcast(snapshot);
    return snapshot;
  }
}
