import type { Card, PokerActionKind, PokerOptions, PokerPhase, PokerSeatState } from '@casino/shared';
import { HAND_NAMES, rankHand, rankValue } from './hand-rank.ts';

export type Result = { ok: true } | { ok: false; error: string };

export interface PokerResult {
  seat: number;
  // Сколько игрок вложил в банк за раздачу (без возвращённой неуравненной части).
  contributed: number;
  // Сколько забрал из банка.
  won: number;
  // Дошёл ли до вскрытия.
  showdown: boolean;
}

export interface PokerSeatPublic {
  stack: number;
  // Ставка в текущем круге торговли.
  bet: number;
  state: PokerSeatState;
  // Открытые карты; null, пока рука закрыта.
  cards: Card[] | null;
  hasCards: boolean;
  discarded: boolean;
  // Сколько забрал из банка; null до конца раздачи.
  won: number | null;
  // Название комбинации открытой руки.
  hand: string | null;
}

export interface PokerPublic {
  phase: PokerPhase;
  board: Card[];
  pots: number[];
  button: number;
  turn: { seat: number; toCall: number; minRaise: number; maxRaise: number } | null;
  seats: Map<number, PokerSeatPublic>;
}

interface Seat {
  stack: number;
  bet: number;
  // Вложено в банк за всю раздачу, включая текущий круг.
  total: number;
  cards: Card[];
  folded: boolean;
  // Ходил после последнего полного рейза: уравнять ещё может, повысить — нет.
  acted: boolean;
  shown: boolean;
  discarded: boolean;
  won: number;
}

const fail = (error: string): Result => ({ ok: false, error });
const STREETS: PokerPhase[] = ['preflop', 'flop', 'turn', 'river'];

// Одна раздача холдема как машина состояний по номерам мест. Участники, их стеки, кнопка и колода
// приходят снаружи; таймеры, пропуски и фишки между раздачами — забота стола.
// Колода раздаётся подряд: игрокам по часовой стрелке от места слева от кнопки, затем борд.
export class PokerHand {
  phase: PokerPhase;
  private readonly seats = new Map<number, Seat>();
  // Места по часовой стрелке, начиная слева от кнопки (кнопка — последняя).
  private readonly order: number[];
  private readonly deck: Card[];
  private readonly board: Card[] = [];
  private turnSeat: number | null = null;
  // Наибольшая ставка в текущем круге и размер последнего полного повышения.
  private currentBet = 0;
  private lastRaise: number;
  // Торговля закончилась до ривера: руки открыты, борд выкладывается по улицам.
  private runout = false;
  private settled: PokerResult[] | null = null;

  constructor(
    private readonly options: PokerOptions,
    stacks: Map<number, number>,
    private readonly button: number,
    deck: Card[],
  ) {
    const seats = [...stacks.keys()].sort((a, b) => a - b);
    const from = seats.indexOf(button) + 1;
    this.order = [...seats.slice(from), ...seats.slice(0, from)];
    this.deck = [...deck];
    const holeCards = options.mode === 'pineapple' ? 3 : 2;
    for (const seat of this.order) {
      this.seats.set(seat, {
        stack: stacks.get(seat)!,
        bet: 0,
        total: 0,
        cards: this.deck.splice(0, holeCards),
        folded: false,
        acted: false,
        shown: false,
        discarded: false,
        won: 0,
      });
    }

    const [small, big] = options.blinds;
    this.lastRaise = big;
    // Один на один малый блайнд ставит кнопка.
    const headsUp = this.order.length === 2;
    const smallSeat = headsUp ? button : this.order[0]!;
    const bigSeat = headsUp ? this.order[0]! : this.order[1]!;
    this.pay(smallSeat, small);
    this.pay(bigSeat, big);
    this.currentBet = big;

    this.phase = 'preflop';
    if (options.mode === 'pineapple') this.phase = 'discard';
    else this.openBetting(bigSeat);
  }

  cardsOf(seat: number): Card[] {
    return this.seats.get(seat)?.cards ?? [];
  }

  // 3-1: сбросить одну из трёх карт по её номеру.
  discard(seat: number, index: number): Result {
    const state = this.seats.get(seat);
    if (this.phase !== 'discard' || !state || state.folded || state.discarded) return fail('not_allowed');
    if (!Number.isInteger(index) || index < 0 || index >= state.cards.length) return fail('bad_card');
    state.cards.splice(index, 1);
    state.discarded = true;
    this.startAfterDiscard();
    return { ok: true };
  }

  // Время на сброс вышло: не успевшим сбрасывается младшая карта.
  autoDiscard(): void {
    if (this.phase !== 'discard') return;
    for (const state of this.seats.values()) {
      if (state.folded || state.discarded) continue;
      const lowest = state.cards.reduce((best, card, index) => (rankValue(card.rank) < rankValue(state.cards[best]!.rank) ? index : best), 0);
      state.cards.splice(lowest, 1);
      state.discarded = true;
    }
    this.startAfterDiscard();
  }

  // amount — для рейза: итоговая ставка игрока в этом круге («повысить до»).
  act(seat: number, kind: PokerActionKind, amount?: number): Result {
    const state = this.seats.get(seat);
    if (!state || seat !== this.turnSeat) return fail('not_your_turn');
    const owed = this.currentBet - state.bet;

    switch (kind) {
      case 'fold':
        state.folded = true;
        break;
      case 'check':
        if (owed > 0) return fail('not_allowed');
        break;
      case 'call':
        if (owed <= 0) return fail('not_allowed');
        this.pay(seat, owed);
        break;
      case 'raise': {
        const { minRaise, maxRaise } = this.raiseLimits(seat);
        if (maxRaise === 0) return fail('not_allowed');
        if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < minRaise || amount > maxRaise) return fail('bad_amount');
        const increase = amount - this.currentBet;
        this.pay(seat, amount - state.bet);
        this.currentBet = amount;
        // Полный рейз заново открывает торговлю всем; короткий олл-ин — нет.
        if (increase >= this.lastRaise) {
          this.lastRaise = increase;
          for (const other of this.seats.values()) other.acted = false;
        }
        break;
      }
      default:
        return fail('not_allowed');
    }
    state.acted = true;
    this.afterMove(seat);
    return { ok: true };
  }

  // Время на ход вышло: чек, если он возможен, иначе фолд. Возвращает место или null, если ходить некому.
  timeout(): number | null {
    const seat = this.turnSeat;
    if (seat === null) return null;
    this.act(seat, this.currentBet > this.seats.get(seat)!.bet ? 'fold' : 'check');
    return seat;
  }

  // Игрок ушёл из-за стола посреди раздачи: его рука сбрасывается.
  forfeit(seat: number): void {
    const state = this.seats.get(seat);
    if (!state || state.folded || this.phase === 'result') return;
    state.folded = true;
    if (this.live().length === 1) return this.finish();
    if (this.phase === 'discard') this.startAfterDiscard();
    else if (seat === this.turnSeat) this.afterMove(seat);
  }

  // Борд ещё выкладывается после олл-ина: стол вызывает dealNext с паузами, пока не станет false.
  runoutPending(): boolean {
    return this.runout && this.phase !== 'result';
  }

  dealNext(): void {
    if (!this.runoutPending()) return;
    if (this.board.length === 5) this.finish();
    else this.dealStreet();
  }

  // Показать свою руку после раздачи. Сброшенную в пас показать нельзя.
  show(seat: number): Result {
    const state = this.seats.get(seat);
    if (this.phase !== 'result' || !state || state.folded || state.shown) return fail('not_allowed');
    state.shown = true;
    return { ok: true };
  }

  // Все фишки места за столом: стек и вложенное в банк. После раздачи — итоговый стек.
  stake(seat: number): number {
    const state = this.seats.get(seat);
    if (!state) return 0;
    return this.phase === 'result' ? state.stack : state.stack + state.total;
  }

  // Итоги раздачи; null, пока она идёт.
  results(): PokerResult[] | null {
    return this.settled;
  }

  view(): PokerPublic {
    const done = this.phase === 'result';
    const seats = new Map<number, PokerSeatPublic>();
    for (const [seat, state] of [...this.seats].sort((a, b) => a[0] - b[0])) {
      const open = state.shown && !state.folded;
      seats.set(seat, {
        stack: state.stack,
        bet: state.bet,
        state: state.folded ? 'folded' : state.stack === 0 && !done ? 'allin' : 'active',
        cards: open ? [...state.cards] : null,
        hasCards: !state.folded,
        discarded: state.discarded,
        won: done ? state.won : null,
        hand: open && this.board.length === 5 ? HAND_NAMES[this.rank(state).category] : null,
      });
    }
    return {
      phase: this.phase,
      board: [...this.board],
      pots: done ? [] : this.pots((state) => state.total - state.bet).map((pot) => pot.amount),
      button: this.button,
      turn: this.turnSeat === null ? null : { seat: this.turnSeat, toCall: this.toCall(this.turnSeat), ...this.raiseLimits(this.turnSeat) },
      seats,
    };
  }

  // Игроки, не сбросившие карты.
  private live(): Seat[] {
    return [...this.seats.values()].filter((state) => !state.folded);
  }

  private pay(seat: number, amount: number): void {
    const state = this.seats.get(seat)!;
    const paid = Math.min(amount, state.stack);
    state.stack -= paid;
    state.bet += paid;
    state.total += paid;
  }

  private toCall(seat: number): number {
    const state = this.seats.get(seat)!;
    return Math.min(this.currentBet - state.bet, state.stack);
  }

  // До какой суммы можно повысить; нули — повышать нельзя.
  private raiseLimits(seat: number): { minRaise: number; maxRaise: number } {
    const state = this.seats.get(seat)!;
    const maxRaise = state.bet + state.stack;
    // Повышать некуда: не хватает даже на колл, уже ходил после последнего полного рейза,
    // либо ни у кого из соперников не осталось фишек, чтобы ответить.
    const rivals = this.live().some((other) => other !== state && other.stack > 0);
    if (maxRaise <= this.currentBet || state.acted || !rivals) return { minRaise: 0, maxRaise: 0 };
    return { minRaise: Math.min(this.currentBet + this.lastRaise, maxRaise), maxRaise };
  }

  private startAfterDiscard(): void {
    if (this.live().some((state) => !state.discarded)) return;
    this.phase = 'preflop';
    const headsUp = this.order.length === 2;
    this.openBetting(headsUp ? this.order[0]! : this.order[1]!);
  }

  // Начало круга торговли: ходит первый, кто может, после указанного места.
  private openBetting(after: number): void {
    this.turnSeat = this.nextToAct(after);
    if (this.turnSeat === null) this.closeStreet();
  }

  // Следующий по часовой стрелке, кому есть что решать: не сбросил, есть фишки, и он ещё не ходил
  // или должен доставить до текущей ставки.
  private nextToAct(after: number): number | null {
    const start = this.order.indexOf(after);
    for (let step = 1; step <= this.order.length; step++) {
      const seat = this.order[(start + step) % this.order.length]!;
      const state = this.seats.get(seat)!;
      if (!state.folded && state.stack > 0 && (!state.acted || state.bet < this.currentBet)) return seat;
    }
    return null;
  }

  private afterMove(seat: number): void {
    if (this.live().length === 1) return this.finish();
    this.turnSeat = this.nextToAct(seat);
    if (this.turnSeat === null) this.closeStreet();
  }

  // Круг торговли окончен: ставки уходят в банк, дальше следующая улица, выкладка борда или вскрытие.
  private closeStreet(): void {
    this.turnSeat = null;
    this.refundUncalled();
    for (const state of this.seats.values()) {
      state.bet = 0;
      state.acted = false;
    }
    this.currentBet = 0;
    this.lastRaise = this.options.blinds[1];

    if (this.phase === 'river') return this.finish();
    // Торговаться больше некому: фишки остались не больше чем у одного.
    if (this.live().filter((state) => state.stack > 0).length <= 1) {
      this.runout = true;
      for (const state of this.live()) state.shown = true;
      return;
    }
    this.dealStreet();
    this.openBetting(this.button);
  }

  private dealStreet(): void {
    this.board.push(...this.deck.splice(0, this.board.length === 0 ? 3 : 1));
    this.phase = STREETS[STREETS.indexOf(this.phase) + 1]!;
  }

  // Часть ставки, которую никто не уравнял, возвращается ставившему.
  private refundUncalled(): void {
    const bets = [...this.seats.values()].sort((a, b) => b.bet - a.bet);
    const [top, next] = bets;
    const excess = top!.bet - (next?.bet ?? 0);
    // Ушедший из-за стола свою ставку назад не получает.
    if (excess <= 0 || top!.folded) return;
    top!.bet -= excess;
    top!.total -= excess;
    top!.stack += excess;
  }

  // Основной и побочные банки по вложенному каждым: на каждом уровне олл-ина — свой банк и свои претенденты.
  private pots(put: (state: Seat) => number): { amount: number; contenders: Seat[] }[] {
    const all = [...this.seats.values()];
    const levels = [...new Set(this.live().map(put))].filter((level) => level > 0).sort((a, b) => a - b);
    const pots: { amount: number; contenders: Seat[] }[] = [];
    let previous = 0;
    for (const level of levels) {
      const amount = all.reduce((sum, state) => sum + Math.max(0, Math.min(put(state), level) - previous), 0);
      pots.push({ amount, contenders: this.live().filter((state) => put(state) >= level) });
      previous = level;
    }
    // Вложенное сбросившими сверх последнего уровня остаётся в последнем банке.
    const rest = all.reduce((sum, state) => sum + Math.max(0, put(state) - previous), 0);
    if (rest > 0 && pots.length > 0) pots.at(-1)!.amount += rest;
    return pots;
  }

  private rank(state: Seat) {
    return rankHand([...state.cards, ...this.board], this.options.mode === 'short');
  }

  // Конец раздачи: банки расходятся по рукам, стеки пополняются.
  private finish(): void {
    this.turnSeat = null;
    this.refundUncalled();
    const live = this.live();
    const showdown = live.length > 1;

    if (!showdown) {
      live[0]!.won = [...this.seats.values()].reduce((sum, state) => sum + state.total, 0);
    } else {
      const scores = new Map(live.map((state) => [state, this.rank(state).score]));
      for (const pot of this.pots((state) => state.total)) {
        const best = Math.max(...pot.contenders.map((state) => scores.get(state)!));
        // Претенденты по часовой стрелке от кнопки: неделимые фишки достаются первым из них.
        const winners = this.order.map((seat) => this.seats.get(seat)!).filter((state) => pot.contenders.includes(state) && scores.get(state) === best);
        const share = Math.floor(pot.amount / winners.length);
        winners.forEach((state, index) => (state.won += share + (index < pot.amount % winners.length ? 1 : 0)));
      }
      // С олл-ином вскрываются все; без него — только забирающие банк, остальные уходят в пас закрытыми.
      const allInInvolved = live.some((state) => state.stack === 0);
      for (const state of live) if (allInInvolved || state.won > 0) state.shown = true;
    }

    for (const state of this.seats.values()) {
      state.stack += state.won;
      state.bet = 0;
    }
    this.settled = [...this.seats]
      .sort((a, b) => a[0] - b[0])
      .map(([seat, state]) => ({ seat, contributed: state.total, won: state.won, showdown: showdown && !state.folded }));
    this.phase = 'result';
  }
}
