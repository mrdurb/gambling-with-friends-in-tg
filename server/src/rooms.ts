import type { Ack, BjAction, Card, GameId, PlayerInfo, RouletteField, TableInfo, TableSnapshot } from '@casino/shared';
import { BlackjackTable } from './rooms/blackjack-table.ts';
import type { HostContext, TableHost } from './rooms/host.ts';
import { RouletteTable } from './rooms/roulette-table.ts';
import type { PlayerResult } from './rounds.ts';

interface Room {
  ctx: HostContext;
  host: TableHost;
}

export interface RoomDeps {
  broadcast: (snapshot: TableSnapshot) => void;
  balanceOf: (userId: number) => number;
  // Записывает итоги раунда и возвращает новые балансы участников.
  settle: (tableCode: string, results: PlayerResult[], game: GameId) => Map<number, number>;
  notifyBalance: (userId: number, balance: number) => void;
  newShoe: () => Card[];
  // Число, выпавшее на колесе рулетки: от 0 до 36.
  spinNumber: () => number;
  // Длительность вращения; в тестах короче настоящей.
  spinMs?: number;
}

const fail = (error: string): Ack => ({ ok: false, error });

// Живое состояние столов: у кого какой стол открыт и какой ведущий его ведёт.
// Сама игра — в ведущем стола (rooms/). О сокетах и базе не знает: всё внешнее приходит через deps.
export class Rooms {
  private readonly rooms = new Map<string, Room>();
  private readonly presentAt = new Map<number, string>();
  // Кто за каким столом блэкджека сидит.
  private readonly seated = new Map<number, BlackjackTable>();

  constructor(private readonly deps: RoomDeps) {}

  // Игрок открыл стол. Возвращает снимок, который он должен увидеть.
  enter(table: TableInfo, player: PlayerInfo): TableSnapshot {
    if (this.presentAt.get(player.id) !== table.code) this.exit(player.id);

    let room = this.rooms.get(table.code);
    if (!room) {
      room = this.open(table);
      this.rooms.set(table.code, room);
    }
    room.ctx.table = table;
    room.ctx.present.set(player.id, player);
    this.presentAt.set(player.id, table.code);
    room.host.enter(player);
    return this.publish(room);
  }

  // Игрок закрыл стол или потерял связь.
  exit(userId: number): void {
    const room = this.rooms.get(this.presentAt.get(userId) ?? '');
    if (!room) return;
    room.ctx.present.delete(userId);
    this.presentAt.delete(userId);
    room.host.exit(userId);
    this.publish(room);
  }

  sit(userId: number, index: number, force = false): Ack {
    const room = this.rooms.get(this.presentAt.get(userId) ?? '');
    if (!room) return fail('not_at_table');
    if (!(room.host instanceof BlackjackTable)) return fail('wrong_game');
    return room.host.sit(userId, index, force);
  }

  stand(userId: number): void {
    this.seated.get(userId)?.stand(userId);
  }

  bet(userId: number, amount: number): Ack {
    return this.seated.get(userId)?.bet(userId, amount) ?? fail('not_seated');
  }

  act(userId: number, action: BjAction): Ack {
    return this.seated.get(userId)?.act(userId, action) ?? fail('not_seated');
  }

  rouletteBet(userId: number, field: RouletteField, amount: number): Ack {
    return this.roulette(userId, (host) => host.bet(userId, field, amount));
  }

  rouletteClear(userId: number): Ack {
    return this.roulette(userId, (host) => host.clear(userId));
  }

  rouletteReady(userId: number): Ack {
    return this.roulette(userId, (host) => host.ready(userId));
  }

  // Код стола, который у игрока сейчас открыт.
  tableOf(userId: number): string | null {
    return this.presentAt.get(userId) ?? null;
  }

  // Реакции: в блэкджеке — только сидящим за этим столом, в рулетке — всем, у кого стол открыт.
  canReact(userId: number): boolean {
    const room = this.rooms.get(this.presentAt.get(userId) ?? '');
    if (!room) return false;
    return room.host instanceof RouletteTable || this.seated.get(userId) === room.host;
  }

  private open(table: TableInfo): Room {
    const ctx: HostContext = {
      table,
      present: new Map(),
      publish: () => void this.publish(room),
      freeBalance: (userId) => this.freeBalance(userId),
      balanceOf: this.deps.balanceOf,
      payOut: (results) => {
        try {
          const balances = this.deps.settle(ctx.table.code, results, ctx.table.game);
          for (const [userId, balance] of balances) this.deps.notifyBalance(userId, balance);
          return true;
        } catch (error) {
          console.error('round settlement failed', error);
          return false;
        }
      },
    };
    const host =
      table.game === 'roulette'
        ? new RouletteTable(ctx, this.deps.spinNumber, this.deps.spinMs)
        : new BlackjackTable(ctx, this.seated, this.deps.newShoe);
    const room: Room = { ctx, host };
    return room;
  }

  // Действие рулетки — за столом, который у игрока сейчас открыт.
  private roulette(userId: number, action: (host: RouletteTable) => Ack): Ack {
    const room = this.rooms.get(this.presentAt.get(userId) ?? '');
    if (!room) return fail('not_at_table');
    return room.host instanceof RouletteTable ? action(room.host) : fail('wrong_game');
  }

  // Баланс за вычетом всего, что у игрока сейчас на кону, — в том числе за столом,
  // из-за которого он встал посреди раздачи.
  private freeBalance(userId: number): number {
    let staked = 0;
    for (const room of this.rooms.values()) staked += room.host.stakeOf(userId);
    return this.deps.balanceOf(userId) - staked;
  }

  private publish(room: Room): TableSnapshot {
    const snapshot = room.host.snapshot();
    if (room.ctx.present.size === 0 && room.host.isIdle()) this.rooms.delete(room.ctx.table.code);
    this.deps.broadcast(snapshot);
    return snapshot;
  }
}
