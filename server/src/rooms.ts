import type { Ack, Card, GameId, PlayerInfo, TableInfo, TableSnapshot } from '@casino/shared';
import { BlackjackTable } from './rooms/blackjack-table.ts';
import { fail, type HostContext, type SeatRegistry, type TableHost } from './rooms/host.ts';
import { PokerTable } from './rooms/poker-table.ts';
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
  // Личное сообщение игроку с его закрытыми картами.
  sendCards: (userId: number, cards: Card[]) => void;
  // Перетасованная колода покера: полная или короткая (36 карт).
  newDeck: (shortDeck: boolean) => Card[];
}

// Живое состояние столов: у кого какой стол открыт и какой ведущий его ведёт.
// Сама игра — в ведущем стола (rooms/). О сокетах и базе не знает: всё внешнее приходит через deps.
export class Rooms {
  private readonly rooms = new Map<string, Room>();
  private readonly presentAt = new Map<number, string>();
  // Кто за каким столом с местами сидит: сидеть можно только за одним.
  private readonly seated: SeatRegistry = new Map();

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
    const room = this.roomOf(userId);
    if (!room) return;
    room.ctx.present.delete(userId);
    this.presentAt.delete(userId);
    room.host.exit(userId);
    this.publish(room);
  }

  // Игровое действие — за столом, который у игрока сейчас открыт. Что оно значит, решает ведущий стола.
  action(userId: number, name: string, args: unknown[]): Ack {
    return this.roomOf(userId)?.host.action(userId, name, args) ?? fail('not_at_table');
  }

  // Код стола, который у игрока сейчас открыт.
  tableOf(userId: number): string | null {
    return this.presentAt.get(userId) ?? null;
  }

  canReact(userId: number): boolean {
    return this.roomOf(userId)?.host.canReact(userId) ?? false;
  }

  private roomOf(userId: number): Room | undefined {
    return this.rooms.get(this.presentAt.get(userId) ?? '');
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
      sendCards: this.deps.sendCards,
    };
    const room: Room = { ctx, host: this.host(ctx) };
    return room;
  }

  private host(ctx: HostContext): TableHost {
    switch (ctx.table.game) {
      case 'roulette':
        return new RouletteTable(ctx, this.deps.spinNumber, this.deps.spinMs);
      case 'poker':
        return new PokerTable(ctx, this.seated, this.deps.newDeck);
      default:
        return new BlackjackTable(ctx, this.seated, this.deps.newShoe);
    }
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
