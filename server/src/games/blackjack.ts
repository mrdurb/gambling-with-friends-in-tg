import {
  MAX_BET,
  MIN_BET,
  type BjAction,
  type BjDetails,
  type BjHandOutcome,
  type BjHandState,
  type BjHandView,
  type BjPhase,
  type BjView,
  type Card,
  type Rank,
  type RoundOutcome,
  type Suit,
} from '@casino/shared';

const DECKS = 6;
export const SHOE_SIZE = DECKS * 52;
// Башмак перетасовывается между раздачами, когда в нём осталось меньше четверти.
const RESHUFFLE_BELOW = SHOE_SIZE / 4;

const RANKS: Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS: Suit[] = ['S', 'H', 'D', 'C'];

// Новый перетасованный башмак. randomInt(n) возвращает целое от 0 до n − 1.
export function shuffledShoe(randomInt: (n: number) => number): Card[] {
  const shoe: Card[] = [];
  for (let deck = 0; deck < DECKS; deck++) for (const suit of SUITS) for (const rank of RANKS) shoe.push({ rank, suit });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shoe[i], shoe[j]] = [shoe[j]!, shoe[i]!];
  }
  return shoe;
}

const cardValue = (card: Card) => (card.rank === 'A' ? 11 : ['J', 'Q', 'K'].includes(card.rank) ? 10 : Number(card.rank));

function handValue(cards: Card[]): { total: number; soft: boolean } {
  let total = cards.reduce((sum, card) => sum + cardValue(card), 0);
  let aces = cards.filter((card) => card.rank === 'A').length;
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

interface Hand {
  cards: Card[];
  bet: number;
  doubled: boolean;
  fromSplit: boolean;
  state: BjHandState;
  outcome: BjHandOutcome | null;
  net: number | null;
}

interface SeatState {
  bet: number;
  hands: Hand[];
}

export type Result = { ok: true } | { ok: false; error: string };

export interface BjResult {
  seat: number;
  wagered: number;
  net: number;
  outcome: RoundOutcome;
  details: BjDetails;
}

const fail = (error: string): Result => ({ ok: false, error });

// Правила блэкджека как машина состояний. Игроков не знает — работает с номерами мест;
// таймеры, балансы и рассылка — забота стола. newShoe вызывается при каждой перетасовке.
export class Blackjack {
  phase: BjPhase = 'waiting';
  private shoe: Card[] = [];
  private dealer: Card[] = [];
  private holeHidden = false;
  // Текущая раздача началась с заново перетасованного башмака.
  private reshuffled = false;
  private everDealt = false;
  private readonly seats = new Map<number, SeatState>();
  private turn: { seat: number; hand: number } | null = null;

  constructor(private readonly newShoe: () => Card[]) {}

  // balance — сколько фишек у игрока сейчас.
  bet(seat: number, amount: number, balance: number): Result {
    if (this.phase === 'playing' || this.phase === 'result') return fail('round_in_progress');
    if (this.seats.has(seat)) return fail('already_bet');
    if (!Number.isInteger(amount) || amount < MIN_BET || amount > MAX_BET) return fail('bad_bet');
    if (amount > balance) return fail('insufficient');
    this.seats.set(seat, { bet: amount, hands: [] });
    this.phase = 'betting';
    return { ok: true };
  }

  cancelBet(seat: number): void {
    if (this.phase !== 'betting') return;
    this.seats.delete(seat);
    if (this.seats.size === 0) this.phase = 'waiting';
  }

  hasBet(seat: number): boolean {
    return this.seats.has(seat);
  }

  betCount(): number {
    return this.seats.size;
  }

  // Сколько фишек места сейчас на кону.
  stake(seat: number): number {
    const state = this.seats.get(seat);
    if (!state) return 0;
    return state.hands.length ? state.hands.reduce((sum, hand) => sum + hand.bet, 0) : state.bet;
  }

  currentSeat(): number | null {
    return this.turn?.seat ?? null;
  }

  start(): void {
    if (this.phase !== 'betting') return;
    if (this.shoe.length < RESHUFFLE_BELOW) {
      // Первый башмак за столом — не перетасовка, оповещать не о чем.
      this.reshuffled = this.everDealt;
      this.shoe = this.newShoe();
    }
    this.everDealt = true;

    const order = [...this.seats.keys()].sort((a, b) => a - b);
    for (const seat of order) {
      const state = this.seats.get(seat)!;
      state.hands = [
        { cards: [this.draw()], bet: state.bet, doubled: false, fromSplit: false, state: 'playing', outcome: null, net: null },
      ];
    }
    this.dealer = [this.draw()];
    for (const seat of order) this.seats.get(seat)!.hands[0]!.cards.push(this.draw());
    this.dealer.push(this.draw());
    this.holeHidden = true;
    this.phase = 'playing';

    for (const state of this.seats.values()) {
      const hand = state.hands[0]!;
      if (handValue(hand.cards).total === 21) hand.state = 'blackjack';
    }

    // Дилер подглядывает закрытую карту при тузе или десятке; его блэкджек заканчивает раздачу сразу.
    const dealerBlackjack = cardValue(this.dealer[0]!) >= 10 && handValue(this.dealer).total === 21;
    if (dealerBlackjack) {
      for (const state of this.seats.values()) {
        const hand = state.hands[0]!;
        if (hand.state === 'playing') hand.state = 'stood';
      }
      this.finish();
      return;
    }
    this.advance();
  }

  // freeBalance — фишки игрока, не стоящие на кону: ими оплачиваются удвоение и сплит.
  act(seat: number, action: BjAction, freeBalance: number): Result {
    if (this.phase !== 'playing' || this.turn?.seat !== seat) return fail('not_your_turn');
    if (!this.actions(freeBalance).includes(action)) return fail('not_allowed');

    const state = this.seats.get(seat)!;
    const hand = state.hands[this.turn.hand]!;

    if (action === 'stand') {
      hand.state = 'stood';
    } else if (action === 'hit') {
      hand.cards.push(this.draw());
      this.settleAfterCard(hand);
    } else if (action === 'double') {
      hand.bet *= 2;
      hand.doubled = true;
      hand.cards.push(this.draw());
      hand.state = handValue(hand.cards).total > 21 ? 'bust' : 'stood';
    } else {
      const aces = hand.cards[0]!.rank === 'A';
      const [first, second] = hand.cards as [Card, Card];
      state.hands = [first, second].map((card) => {
        const split: Hand = { ...hand, cards: [card, this.draw()], fromSplit: true };
        // На разделённые тузы — по одной карте без хода; 21 после сплита — обычные 21.
        if (aces || handValue(split.cards).total === 21) split.state = 'stood';
        return split;
      });
    }
    this.advance();
    return { ok: true };
  }

  // Время на ход вышло: текущая рука останавливается. Возвращает место, которое не походило.
  timeout(): number | null {
    if (this.phase !== 'playing' || !this.turn) return null;
    const { seat, hand } = this.turn;
    this.seats.get(seat)!.hands[hand]!.state = 'stood';
    this.advance();
    return seat;
  }

  // Игрок ушёл посреди раздачи: все его недоигранные руки останавливаются.
  forfeit(seat: number): void {
    if (this.phase !== 'playing') return;
    for (const hand of this.seats.get(seat)?.hands ?? []) if (hand.state === 'playing') hand.state = 'stood';
    this.advance();
  }

  results(): BjResult[] | null {
    if (this.phase !== 'result') return null;
    return [...this.seats.entries()].map(([seat, state]) => {
      const net = state.hands.reduce((sum, hand) => sum + (hand.net ?? 0), 0);
      const doubled = state.hands.filter((hand) => hand.doubled);
      return {
        seat,
        wagered: state.hands.reduce((sum, hand) => sum + hand.bet, 0),
        net,
        outcome: net > 0 ? 'win' : net < 0 ? 'lose' : 'push',
        details: {
          blackjack: state.hands.some((hand) => hand.state === 'blackjack'),
          bust: state.hands.some((hand) => hand.state === 'bust'),
          doubles: doubled.length,
          doublesWon: doubled.filter((hand) => (hand.net ?? 0) > 0).length,
        },
      };
    });
  }

  reset(): void {
    this.phase = 'waiting';
    this.seats.clear();
    this.dealer = [];
    this.holeHidden = false;
    this.reshuffled = false;
    this.turn = null;
  }

  // freeBalance — свободные фишки игрока, чей сейчас ход (от них зависят доступные действия).
  view(seatCount: number, freeBalance: number, timeLeftMs: number | null): BjView {
    const visible = this.holeHidden ? this.dealer.slice(0, 1) : this.dealer;
    return {
      phase: this.phase,
      dealer: { cards: visible, holeHidden: this.holeHidden, total: handValue(visible).total },
      seats: Array.from({ length: seatCount }, (_, seat) => {
        const state = this.seats.get(seat);
        if (!state) return null;
        const hands: BjHandView[] = state.hands.length
          ? state.hands.map(({ fromSplit: _fromSplit, ...hand }) => ({ ...hand, ...handValue(hand.cards) }))
          : [{ cards: [], bet: state.bet, total: 0, soft: false, doubled: false, state: 'playing', outcome: null, net: null }];
        const settled = this.phase === 'result';
        return { hands, net: settled ? hands.reduce((sum, hand) => sum + (hand.net ?? 0), 0) : null };
      }),
      turn: this.turn && { ...this.turn, actions: this.actions(freeBalance) },
      timeLeftMs,
      shoeReshuffled: this.reshuffled,
    };
  }

  private actions(freeBalance: number): BjAction[] {
    if (!this.turn) return [];
    const state = this.seats.get(this.turn.seat)!;
    const hand = state.hands[this.turn.hand]!;
    const actions: BjAction[] = ['hit', 'stand'];
    const firstTwo = hand.cards.length === 2;
    const canPay = freeBalance >= hand.bet;
    if (firstTwo && canPay) actions.push('double');
    if (firstTwo && canPay && state.hands.length === 1 && cardValue(hand.cards[0]!) === cardValue(hand.cards[1]!)) {
      actions.push('split');
    }
    return actions;
  }

  private draw(): Card {
    return this.shoe.shift()!;
  }

  private settleAfterCard(hand: Hand): void {
    const { total } = handValue(hand.cards);
    if (total > 21) hand.state = 'bust';
    else if (total === 21) hand.state = 'stood';
  }

  // Ход переходит к следующей недоигранной руке; если таких нет — играет дилер.
  private advance(): void {
    const order = [...this.seats.keys()].sort((a, b) => a - b);
    for (const seat of order) {
      const hand = this.seats.get(seat)!.hands.findIndex((h) => h.state === 'playing');
      if (hand !== -1) {
        this.turn = { seat, hand };
        return;
      }
    }
    this.finish();
  }

  private finish(): void {
    this.turn = null;
    this.holeHidden = false;
    const hands = [...this.seats.values()].flatMap((state) => state.hands);

    // Дилер добирает, только если есть рука, которой важен его результат.
    if (hands.some((hand) => hand.state === 'stood')) {
      while (handValue(this.dealer).total < 17) this.dealer.push(this.draw());
    }
    const dealerTotal = handValue(this.dealer).total;
    const dealerBlackjack = this.dealer.length === 2 && dealerTotal === 21;

    for (const hand of hands) {
      const { total } = handValue(hand.cards);
      if (hand.state === 'bust') {
        [hand.outcome, hand.net] = ['lose', -hand.bet];
      } else if (hand.state === 'blackjack') {
        [hand.outcome, hand.net] = dealerBlackjack ? ['push', 0] : ['blackjack', Math.ceil(hand.bet * 1.5)];
      } else if (dealerBlackjack || (dealerTotal <= 21 && dealerTotal > total)) {
        [hand.outcome, hand.net] = ['lose', -hand.bet];
      } else if (dealerTotal > 21 || total > dealerTotal) {
        [hand.outcome, hand.net] = ['win', hand.bet];
      } else {
        [hand.outcome, hand.net] = ['push', 0];
      }
    }
    this.phase = 'result';
  }
}
