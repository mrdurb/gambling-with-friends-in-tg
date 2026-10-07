import {
  DISCONNECT_GRACE_MS,
  MAX_MISSES,
  POKER_DISCARD_MS,
  POKER_MAX_BUYIN_BB,
  POKER_MIN_BUYIN_BB,
  POKER_REBUY_MS,
  POKER_RESULT_MS,
  POKER_RUNOUT_MS,
  POKER_SEATS,
  POKER_TURN_MS,
  type Ack,
  type Card,
  type PlayerInfo,
  type PokerActionKind,
  type PokerDetails,
  type PokerOptions,
  type PokerSeatView,
  type TableSnapshot,
} from '@casino/shared';
import { PokerHand } from '../games/poker/poker.ts';
import type { PlayerResult } from '../rounds.ts';
import { PhaseTimer, WRONG_GAME, fail, type HostContext, type SeatRegistry, type SeatedTable, type TableHost, type Timer } from './host.ts';

interface Seat {
  player: PlayerInfo;
  connected: boolean;
  // Таймер, по которому место без связи освобождается.
  release?: Timer;
  // Игрок встал посреди раздачи: место освободится после её расчёта.
  leaving: boolean;
  // Фишки игрока за столом. Во время раздачи — значение на её начало (плюс докупки): баланс и стек
  // меняются один раз, при расчёте.
  stack: number;
  // Раздачи подряд, в которых игрок не успел походить.
  misses: number;
  // В текущей раздаче пропуск уже засчитан.
  timedOut: boolean;
  // Раздачи подряд, пропущенные без фишек.
  brokeHands: number;
  // Таймер, по которому место игрока без фишек освобождается, если он не докупил.
  rebuyBy?: Timer;
}

const ACTIONS: PokerActionKind[] = ['fold', 'check', 'call', 'raise'];

// Стол покера: места со стеками, раздачи одна за другой, таймеры хода, сброса и выкладки борда.
// Стек с баланса не списывается, а резервируется (stakeOf); в базу уходит чистый результат каждой раздачи.
export class PokerTable implements TableHost, SeatedTable {
  private readonly options: PokerOptions;
  private readonly seats: (Seat | null)[];
  private readonly timer = new PhaseTimer();
  private hand: PokerHand | null = null;
  // Раздача рассчитана: стеки уже обновлены, идёт показ результата.
  private settled = false;
  // Место кнопки в последней раздаче.
  private button: number | null = null;
  // Стеки участников на начало текущей раздачи.
  private startStacks = new Map<number, number>();

  constructor(
    private readonly ctx: HostContext,
    private readonly seated: SeatRegistry,
    private readonly newDeck: (shortDeck: boolean) => Card[],
  ) {
    this.options = ctx.table.poker!;
    this.seats = Array.from({ length: POKER_SEATS[this.options.mode] }, () => null);
  }

  enter(player: PlayerInfo): void {
    const index = this.indexOf(player.id);
    const seat = this.seats[index];
    if (!seat) return;
    clearTimeout(seat.release);
    seat.release = undefined;
    seat.connected = true;
    seat.player = player;
    // Вернувшемуся посреди раздачи карты приходят снова.
    if (this.hand && this.startStacks.has(index) && !this.settled) this.sendCards(index, true);
  }

  // Место за ушедшим сохраняется на время; его ходы идут по таймеру.
  exit(userId: number): void {
    const seat = this.seats[this.indexOf(userId)];
    if (seat && !seat.leaving) {
      seat.connected = false;
      seat.release = setTimeout(() => this.stand(userId), DISCONNECT_GRACE_MS);
    }
  }

  action(userId: number, name: string, [first, second]: unknown[]): Ack {
    switch (name) {
      case 'poker:sit':
        return this.sit(userId, first, second);
      case 'poker:leave':
        this.stand(userId);
        return { ok: true };
      case 'poker:rebuy':
        return this.rebuy(userId, first);
      case 'poker:action':
        return this.play(userId, (hand, index) =>
          ACTIONS.includes(first as PokerActionKind) ? hand.act(index, first as PokerActionKind, second as number) : fail('not_allowed'),
        );
      case 'poker:discard':
        return this.play(userId, (hand, index) => hand.discard(index, first as number));
      case 'poker:show':
        return this.play(userId, (hand, index) => hand.show(index));
      default:
        return WRONG_GAME;
    }
  }

  canReact(userId: number): boolean {
    return this.seated.get(userId) === this;
  }

  // Игрок уходит с места: сразу, если не участвует в раздаче, иначе его рука сбрасывается,
  // а место освобождается после расчёта.
  stand(userId: number): void {
    const index = this.indexOf(userId);
    const seat = this.seats[index];
    if (!seat || seat.leaving) return;
    if (this.seated.get(userId) === this) this.seated.delete(userId);

    if (!this.hand || !this.startStacks.has(index)) {
      this.removeSeat(index);
      this.ctx.publish();
      return;
    }
    seat.leaving = true;
    clearTimeout(seat.release);
    this.advance((hand) => hand.forfeit(index));
  }

  // Стек зарезервирован целиком, пока игрок за столом. Ушедший после расчёта раздачи уже ничего не держит.
  stakeOf(userId: number): number {
    const seat = this.seats[this.indexOf(userId)];
    if (!seat || (seat.leaving && this.settled)) return 0;
    return seat.stack;
  }

  isIdle(): boolean {
    return !this.hand && this.seats.every((seat) => !seat);
  }

  snapshot(): TableSnapshot {
    const { present } = this.ctx;
    const view = this.hand?.view();
    const seats = this.seats.map((seat, index): PokerSeatView | null => {
      if (!seat) return null;
      const base = { player: seat.player, connected: seat.connected, leaving: seat.leaving, staked: this.stakeOf(seat.player.id) };
      const inHand = view?.seats.get(index);
      if (!inHand) {
        return { ...base, stack: seat.stack, bet: 0, state: 'waiting', cards: null, hasCards: false, discarded: false, won: null, hand: null };
      }
      return { ...base, ...inHand, stack: this.liveStack(index) };
    });
    return {
      kind: 'poker',
      table: this.ctx.table,
      spectators: present.size - this.seats.filter((seat) => seat && present.has(seat.player.id)).length,
      game: {
        phase: view?.phase ?? 'waiting',
        seats,
        board: view?.board ?? [],
        pots: view?.pots ?? [],
        button: view ? view.button : null,
        turn: view?.turn ?? null,
        timeLeftMs: this.timer.leftMs(),
      },
    };
  }

  // Фишки перед игроком прямо сейчас. Во время раздачи — оставшееся в ней плюс докупленное после её
  // начала; seat.stack до расчёта хранит значение на начало раздачи.
  private liveStack(index: number): number {
    const seat = this.seats[index]!;
    const inHand = this.hand?.view().seats.get(index);
    if (!inHand || this.settled) return seat.stack;
    return inHand.stack + seat.stack - this.startStacks.get(index)!;
  }

  private indexOf(userId: number): number {
    return this.seats.findIndex((seat) => seat?.player.id === userId);
  }

  // Пределы стека: от 40 до 100 больших блайндов.
  private buyInLimits(): [number, number] {
    const big = this.options.blinds[1];
    return [big * POKER_MIN_BUYIN_BB, big * POKER_MAX_BUYIN_BB];
  }

  private sit(userId: number, index: unknown, buyIn: unknown): Ack {
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= this.seats.length) return fail('bad_seat');
    if (this.indexOf(userId) !== -1) return fail('already_seated');
    if (this.seated.has(userId)) return fail('seated_elsewhere');
    const [min, max] = this.buyInLimits();
    if (typeof buyIn !== 'number' || !Number.isInteger(buyIn) || buyIn < min || buyIn > max) return fail('bad_buyin');
    if (buyIn > this.ctx.freeBalance(userId)) return fail('insufficient');
    if (this.seats[index]) return fail('seat_taken');

    this.seats[index] = {
      player: this.ctx.present.get(userId)!,
      connected: true,
      leaving: false,
      stack: buyIn,
      misses: 0,
      timedOut: false,
      brokeHands: 0,
    };
    this.seated.set(userId, this);
    if (!this.startIfReady()) this.ctx.publish();
    return { ok: true };
  }

  // Докупка: когда игрок не участвует в текущей раздаче; стек после неё — в пределах посадки.
  private rebuy(userId: number, amount: unknown): Ack {
    const index = this.indexOf(userId);
    const seat = this.seats[index];
    if (!seat || seat.leaving) return fail('not_seated');
    const live = this.hand?.view().seats.get(index);
    if (live && !this.settled && live.state !== 'folded') return fail('in_hand');
    const [min, max] = this.buyInLimits();
    if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return fail('bad_amount');
    const after = this.liveStack(index) + amount;
    if (after < min || after > max) return fail('bad_amount');
    if (amount > this.ctx.freeBalance(userId)) return fail('insufficient');

    seat.stack += amount;
    seat.brokeHands = 0;
    clearTimeout(seat.rebuyBy);
    seat.rebuyBy = undefined;
    if (!this.startIfReady()) this.ctx.publish();
    return { ok: true };
  }

  // Действие сидящего игрока в раздаче. Отказ ничего не меняет и никому не рассылается.
  private play(userId: number, move: (hand: PokerHand, index: number) => Ack): Ack {
    const index = this.indexOf(userId);
    const seat = this.seats[index];
    if (!seat || seat.leaving) return fail('not_seated');
    const hand = this.hand;
    if (!hand) return fail('not_allowed');
    const result = move(hand, index);
    if (!result.ok) return result;

    seat.misses = 0;
    // После сброса у игрока остаётся две карты.
    if (!this.settled) this.sendCards(index);
    // Показ карт после расчёта и чей-то сброс, пока сбросили не все, таймер не трогают.
    if (this.settled || hand.phase === 'discard') this.ctx.publish();
    else this.schedule();
    return result;
  }

  // Сколько карт у игрока было при последней отправке: шлём заново только после сброса.
  private readonly sentCards = new Map<number, number>();

  // Личные карты уходят только тому, у кого этот стол открыт: у игрока одно подключение, и он может
  // в это время сидеть за другим столом. Вернувшись, он получит их заново.
  private sendCards(index: number, force = false): void {
    const seat = this.seats[index];
    if (!seat || !this.ctx.present.has(seat.player.id)) return;
    const cards = this.settled || !this.hand ? [] : this.hand.cardsOf(index);
    if (!force && this.sentCards.get(index) === cards.length) return;
    this.sentCards.set(index, cards.length);
    this.ctx.sendCards(seat.player.id, cards);
  }

  // Уход игрока из раздачи. Если фаза и очередь хода остались прежними (ушёл не в свой ход),
  // таймер идущего не трогается.
  private advance(change: (hand: PokerHand) => void): void {
    const hand = this.hand;
    if (!hand) return;
    const mark = () => `${hand.phase}:${JSON.stringify(hand.view().turn)}:${hand.runoutPending()}`;
    const before = mark();
    change(hand);
    if (this.settled || mark() === before) this.ctx.publish();
    else this.schedule();
  }

  // Заводит таймер под текущее состояние раздачи и рассылает снимок.
  private schedule(): void {
    const hand = this.hand!;
    if (hand.phase === 'result') return this.settle();
    if (hand.phase === 'discard') {
      this.timer.set(POKER_DISCARD_MS, () => {
        hand.autoDiscard();
        for (const index of this.startStacks.keys()) this.sendCards(index);
        this.schedule();
      });
    } else if (hand.runoutPending()) {
      this.timer.set(POKER_RUNOUT_MS, () => {
        hand.dealNext();
        this.schedule();
      });
    } else {
      this.timer.set(POKER_TURN_MS, () => {
        const seat = this.seats[hand.timeout() ?? -1];
        if (seat && !seat.timedOut) {
          seat.timedOut = true;
          seat.misses += 1;
        }
        this.schedule();
      });
    }
    this.ctx.publish();
  }

  // Начинает раздачу, если её нет и за столом минимум двое с фишками.
  private startIfReady(): boolean {
    if (this.hand) return false;
    const players = this.seats.flatMap((seat, index) => (seat && seat.stack > 0 ? [index] : []));
    if (players.length < 2) return false;

    this.seats.forEach((seat) => {
      if (!seat) return;
      seat.timedOut = false;
      if (seat.stack === 0) seat.brokeHands += 1;
    });
    // Кнопка — у следующего по часовой стрелке участника после прошлой кнопки.
    this.button = players.find((index) => index > (this.button ?? -1)) ?? players[0]!;
    this.startStacks = new Map(players.map((index) => [index, this.seats[index]!.stack]));
    this.settled = false;
    this.sentCards.clear();
    this.hand = new PokerHand(this.options, this.startStacks, this.button, this.newDeck(this.options.mode === 'short'));
    for (const index of players) this.sendCards(index);
    this.schedule();
    return true;
  }

  private settle(): void {
    const results = this.hand!.results()!.flatMap((result): PlayerResult[] => {
      const seat = this.seats[result.seat];
      if (!seat) return [];
      const net = result.won - result.contributed;
      const details: PokerDetails = { mode: this.options.mode, pot: result.won, showdown: result.showdown };
      return [{ userId: seat.player.id, wagered: result.contributed, net, outcome: net > 0 ? 'win' : net < 0 ? 'lose' : 'push', details }];
    });
    // Раздача не записалась — аннулируется: стеки остаются как на её начало.
    if (!this.ctx.payOut(results)) return this.endHand();

    for (const result of this.hand!.results()!) {
      const seat = this.seats[result.seat];
      if (seat) seat.stack += result.won - result.contributed;
    }
    this.settled = true;
    this.timer.set(POKER_RESULT_MS, () => this.endHand());
    this.ctx.publish();
  }

  private endHand(): void {
    this.timer.clear();
    const dealtIn = [...this.startStacks.keys()];
    this.hand = null;
    this.settled = false;
    this.startStacks = new Map();
    // Карт больше нет.
    for (const index of dealtIn) this.sendCards(index);
    this.seats.forEach((seat, index) => {
      if (!seat) return;
      const broke = seat.stack === 0 && seat.brokeHands >= MAX_MISSES;
      if (seat.leaving || seat.misses >= MAX_MISSES || broke) return this.removeSeat(index);
      // Без фишек место держится минуту: иначе один на один оно было бы занято вечно.
      if (seat.stack === 0 && !seat.rebuyBy) {
        seat.rebuyBy = setTimeout(() => {
          seat.rebuyBy = undefined;
          if (seat.stack === 0) this.stand(seat.player.id);
        }, POKER_REBUY_MS);
      }
    });
    if (!this.startIfReady()) this.ctx.publish();
  }

  private removeSeat(index: number): void {
    const seat = this.seats[index];
    if (!seat) return;
    clearTimeout(seat.release);
    clearTimeout(seat.rebuyBy);
    if (this.seated.get(seat.player.id) === this) this.seated.delete(seat.player.id);
    this.seats[index] = null;
  }
}
