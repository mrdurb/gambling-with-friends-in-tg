export const START_CHIPS = 1000;

// Касса: предел одной выдачи и быстрые суммы.
export const CASHIER_MAX = 100_000;
export const CASHIER_PRESETS = [1000, 5000, 25_000, 100_000] as const;

export interface Me {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  balance: number;
}

// ── Столы ────────────────────────────────────────────────────────────────

export const SEATS = 6;
// Сколько место ждёт игрока без связи, пока за столом не идёт раздача.
export const DISCONNECT_GRACE_MS = 60_000;

export type GameId = 'blackjack';

export interface PlayerInfo {
  id: number;
  firstName: string;
  lastName: string | null;
  photoUrl: string | null;
}

export interface TableInfo {
  code: string;
  name: string;
  game: GameId;
  inviteLink: string | null;
}

export interface SeatView {
  player: PlayerInfo;
  connected: boolean;
}

export interface TableSnapshot {
  table: TableInfo;
  seats: (SeatView | null)[];
  spectators: number;
  game: BjView;
}

export type Ack<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export interface ClientToServerEvents {
  'table:join': (code: string, ack: (result: Ack<{ snapshot: TableSnapshot }>) => void) => void;
  'table:leave': () => void;
  'seat:take': (seat: number, force: boolean, ack: (result: Ack) => void) => void;
  'seat:leave': () => void;
  'game:bet': (amount: number, ack: (result: Ack) => void) => void;
  'game:action': (action: BjAction, ack: (result: Ack) => void) => void;
  'chat:send': (text: string, ack: (result: Ack) => void) => void;
  'reaction:send': (reaction: Reaction, ack: (result: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'table:snapshot': (snapshot: TableSnapshot) => void;
  // Игрок открыл приложение в другом месте; это подключение больше не используется.
  kicked: () => void;
  // Баланс игрока изменился (расчёт раздачи).
  balance: (balance: number) => void;
  'chat:message': (message: ChatMessage) => void;
  reaction: (event: ReactionEvent) => void;
}

// ── Блэкджек ─────────────────────────────────────────────────────────────

export const MIN_BET = 5;
export const MAX_BET = 5000;
export const CHIP_VALUES = [1, 5, 25, 100, 500, 1000] as const;

export const BET_MS = 20_000;
export const TURN_MS = 30_000;
export const RESULT_MS = 5_000;
// Столько пропусков подряд (не поставил или не походил вовремя) — и игрок встаёт из-за стола.
export const MAX_MISSES = 2;

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type BjAction = 'hit' | 'stand' | 'double' | 'split';
export type BjPhase = 'waiting' | 'betting' | 'playing' | 'result';
export type BjHandState = 'playing' | 'stood' | 'bust' | 'blackjack';
export type BjHandOutcome = 'blackjack' | 'win' | 'push' | 'lose';
export type RoundOutcome = 'win' | 'lose' | 'push';

export interface BjHandView {
  cards: Card[];
  bet: number;
  total: number;
  soft: boolean;
  doubled: boolean;
  state: BjHandState;
  // Заполняются после расчёта.
  outcome: BjHandOutcome | null;
  net: number | null;
}

export interface BjSeatView {
  hands: BjHandView[];
  // Чистый результат игрока за раздачу; null, пока раздача не рассчитана.
  net: number | null;
}

export interface BjView {
  phase: BjPhase;
  dealer: {
    cards: Card[];
    // true, пока закрытая карта дилера не открыта (в cards её нет).
    holeHidden: boolean;
    total: number;
  };
  // По местам стола; null — место не участвует в раздаче.
  seats: (BjSeatView | null)[];
  turn: { seat: number; hand: number; actions: BjAction[] } | null;
  // Сколько миллисекунд осталось до конца текущего таймера (ставки, ход, показ результата).
  timeLeftMs: number | null;
  // true в течение раздачи, которая началась с заново перетасованного башмака.
  shoeReshuffled: boolean;
}

export interface BjDetails {
  blackjack: boolean;
  bust: boolean;
  doubles: number;
  doublesWon: number;
}

// ── Чат и реакции ────────────────────────────────────────────────────────

export const CHAT_MAX_LENGTH = 200;
export const REACTIONS = ['😂', '😡', '🎉', '😭', '😎', '🤔', '👍', '🤡'] as const;
// Сколько реакция видна возле аватарки.
export const REACTION_MS = 3000;

// kind оставляет место для кастомных эмодзи Telegram (отдельный вид с идентификатором).
export interface Reaction {
  kind: 'emoji';
  value: string;
}

export interface ChatMessage {
  from: PlayerInfo;
  text: string;
  at: number;
}

export interface ReactionEvent {
  userId: number;
  reaction: Reaction;
}

// ── Рейтинг и статистика ─────────────────────────────────────────────────

export interface RatingRow {
  player: PlayerInfo;
  won: number;
  lost: number;
  net: number;
}

// Доли (winRate, bustRate, doublesWonRate) — числа от 0 до 1.
export interface BlackjackStats {
  won: number;
  lost: number;
  net: number;
  rounds: number;
  wins: number;
  losses: number;
  pushes: number;
  winRate: number;
  blackjacks: number;
  bustRate: number;
  biggestWin: number;
  biggestBet: number;
  longestWinStreak: number;
  longestLoseStreak: number;
  doubles: number;
  doublesWonRate: number;
  cashierVisits: number;
  cashierTotal: number;
}

export interface PlayerStats {
  player: PlayerInfo;
  blackjack: BlackjackStats;
}
