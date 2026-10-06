import { DISCONNECT_GRACE_MS, SEATS, type Ack, type PlayerInfo, type TableInfo, type TableSnapshot } from '@casino/shared';

interface Seat {
  player: PlayerInfo;
  connected: boolean;
  // Таймер, по которому место без связи освобождается.
  release?: ReturnType<typeof setTimeout>;
}

interface Room {
  table: TableInfo;
  seats: (Seat | null)[];
  // Игроки, у которых стол сейчас открыт (сидящие и зрители).
  present: Map<number, PlayerInfo>;
}

// Живое состояние столов: кто смотрит, кто сидит, у кого пропала связь.
// О сокетах не знает: наружу отдаёт снимки через broadcast.
export class Rooms {
  private readonly rooms = new Map<string, Room>();
  private readonly presentAt = new Map<number, string>();
  private readonly seatedAt = new Map<number, string>();

  constructor(private readonly broadcast: (snapshot: TableSnapshot) => void) {}

  // Игрок открыл стол. Возвращает снимок, который он должен увидеть.
  enter(table: TableInfo, player: PlayerInfo): TableSnapshot {
    if (this.presentAt.get(player.id) !== table.code) this.exit(player.id);

    let room = this.rooms.get(table.code);
    if (!room) {
      room = { table, seats: Array.from({ length: SEATS }, () => null), present: new Map() };
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
    if (seat) {
      seat.connected = false;
      seat.release = setTimeout(() => this.unseat(userId), DISCONNECT_GRACE_MS);
    }
    this.publish(room);
  }

  sit(userId: number, index: number, force = false): Ack {
    const room = this.rooms.get(this.presentAt.get(userId) ?? '');
    if (!room) return { ok: false, error: 'not_at_table' };
    if (!Number.isInteger(index) || index < 0 || index >= SEATS) return { ok: false, error: 'bad_seat' };

    const seatedCode = this.seatedAt.get(userId);
    if (seatedCode === room.table.code) return { ok: false, error: 'already_seated' };
    if (seatedCode && !force) return { ok: false, error: 'seated_elsewhere' };
    if (room.seats[index]) return { ok: false, error: 'seat_taken' };

    if (seatedCode) this.unseat(userId);
    room.seats[index] = { player: room.present.get(userId)!, connected: true };
    this.seatedAt.set(userId, room.table.code);
    this.publish(room);
    return { ok: true };
  }

  stand(userId: number): void {
    this.unseat(userId);
  }

  private seatOf(room: Room, userId: number): Seat | null {
    return room.seats.find((seat) => seat?.player.id === userId) ?? null;
  }

  private unseat(userId: number): void {
    const room = this.rooms.get(this.seatedAt.get(userId) ?? '');
    if (!room) return;
    const index = room.seats.findIndex((seat) => seat?.player.id === userId);
    clearTimeout(room.seats[index]?.release);
    room.seats[index] = null;
    this.seatedAt.delete(userId);
    this.publish(room);
  }

  private publish(room: Room): TableSnapshot {
    const seated = room.seats.filter((seat) => seat && room.present.has(seat.player.id)).length;
    const snapshot: TableSnapshot = {
      table: room.table,
      seats: room.seats.map((seat) => seat && { player: seat.player, connected: seat.connected }),
      spectators: room.present.size - seated,
    };
    if (room.present.size === 0 && room.seats.every((seat) => !seat)) this.rooms.delete(room.table.code);
    this.broadcast(snapshot);
    return snapshot;
  }
}
