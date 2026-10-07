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

export const GAME_IDS = ['blackjack', 'roulette'] as const;
export type GameId = (typeof GAME_IDS)[number];
export const isGameId = (value: unknown): value is GameId => (GAME_IDS as readonly unknown[]).includes(value);

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
  // Игрок встал посреди раздачи: место освободится после её расчёта.
  leaving: boolean;
}

export interface BlackjackSnapshot {
  kind: 'blackjack';
  table: TableInfo;
  seats: (SeatView | null)[];
  spectators: number;
  game: BjView;
}

export interface RouletteSnapshot {
  kind: 'roulette';
  table: TableInfo;
  game: RouletteView;
}

export type TableSnapshot = BlackjackSnapshot | RouletteSnapshot;

export type Ack<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export interface ClientToServerEvents {
  'table:join': (code: string, ack: (result: Ack<{ snapshot: TableSnapshot }>) => void) => void;
  'table:leave': () => void;
  'seat:take': (seat: number, force: boolean, ack: (result: Ack) => void) => void;
  'seat:leave': () => void;
  'game:bet': (amount: number, ack: (result: Ack) => void) => void;
  'game:action': (action: BjAction, ack: (result: Ack) => void) => void;
  'roulette:bet': (field: RouletteField, amount: number, ack: (result: Ack) => void) => void;
  'roulette:clear': (ack: (result: Ack) => void) => void;
  'roulette:ready': (ack: (result: Ack) => void) => void;
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
export const RESULT_MS = 3_000;
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

// ── Рулетка ──────────────────────────────────────────────────────────────

// Сколько длится приём ставок после первой ставки, вращение колеса.
export const ROULETTE_BET_MS = 25_000;
export const SPIN_MS = 5_000;
// Сколько последних выпавших чисел помнит стол.
export const ROULETTE_HISTORY = 5;
// Сколько действий со ставками (поставить, сбросить, «Готов») игрок может сделать за CHAT_RATE_WINDOW_MS.
export const ROULETTE_RATE_LIMIT = 30;
// Номиналы фишек рулетки: ставка на поле — не меньше MIN_BET.
export const ROULETTE_CHIPS = CHIP_VALUES.filter((value) => value >= MIN_BET);

// Числа европейского колеса по часовой стрелке, начиная с зеро.
export const WHEEL_ORDER: readonly number[] = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28,
  12, 35, 3, 26,
];
export const RED_NUMBERS: ReadonlySet<number> = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);

const ROULETTE_GROUPS = [
  'red',
  'black',
  'even',
  'odd',
  'low',
  'high',
  'dozen1',
  'dozen2',
  'dozen3',
  'col1',
  'col2',
  'col3',
] as const;
type RouletteGroup = (typeof ROULETTE_GROUPS)[number];
// Поле для ставки: число `n0`…`n36` или группа чисел.
export type RouletteField = `n${number}` | RouletteGroup;
export const ROULETTE_FIELDS: readonly RouletteField[] = [
  ...Array.from({ length: 37 }, (_, number): RouletteField => `n${number}`),
  ...ROULETTE_GROUPS,
];
export const isRouletteField = (value: unknown): value is RouletteField =>
  (ROULETTE_FIELDS as readonly unknown[]).includes(value);

const GROUP_WINS: Record<RouletteGroup, (number: number) => boolean> = {
  red: (n) => RED_NUMBERS.has(n),
  black: (n) => !RED_NUMBERS.has(n),
  even: (n) => n % 2 === 0,
  odd: (n) => n % 2 === 1,
  low: (n) => n <= 18,
  high: (n) => n >= 19,
  dozen1: (n) => n <= 12,
  dozen2: (n) => n >= 13 && n <= 24,
  dozen3: (n) => n >= 25,
  col1: (n) => n % 3 === 1,
  col2: (n) => n % 3 === 2,
  col3: (n) => n % 3 === 0,
};

// Выигрывает ли поле при выпавшем числе. При зеро выигрывает только ставка на само зеро.
export function rouletteWins(field: RouletteField, number: number): boolean {
  // Ни одна группа не начинается с «n».
  if (field.startsWith('n')) return field === `n${number}`;
  return number !== 0 && GROUP_WINS[field as RouletteGroup](number);
}

// Выплата поля: сколько ставок игрок получает сверх своей.
export function roulettePayout(field: RouletteField): 35 | 2 | 1 {
  if (field.startsWith('n')) return 35;
  return field.startsWith('dozen') || field.startsWith('col') ? 2 : 1;
}

export type RoulettePhase = 'waiting' | 'betting' | 'spinning' | 'result';
export type RouletteBets = Partial<Record<RouletteField, number>>;

export interface RoulettePlayerView {
  player: PlayerInfo;
  connected: boolean;
  bets: RouletteBets;
  ready: boolean;
  // Чистый результат игрока за раунд; null, пока раунд не рассчитан.
  net: number | null;
}

export interface RouletteView {
  phase: RoulettePhase;
  players: RoulettePlayerView[];
  // Сколько миллисекунд осталось до конца текущего таймера (ставки, вращение, показ результата).
  timeLeftMs: number | null;
  // Выпавшее число: известно с начала вращения.
  number: number | null;
  // Последние выпавшие числа, новые первыми.
  history: number[];
}

// Подробности раунда рулетки для статистики.
export interface RouletteDetails {
  number: number;
  bets: RouletteBets;
}

// ── Чат и реакции ────────────────────────────────────────────────────────

export const CHAT_MAX_LENGTH = 200;
// Сколько сообщений и реакций один игрок может отправить за окно времени.
export const CHAT_RATE_LIMIT = 5;
export const CHAT_RATE_WINDOW_MS = 5000;
// Сколько последних сообщений чата держит клиент.
export const CHAT_HISTORY = 200;
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

export interface RouletteStats {
  rounds: number;
  // Сколько фишек поставлено за все раунды.
  wagered: number;
  net: number;
  // Крупнейший чистый выигрыш за раунд.
  biggestWin: number;
  // Сколько раз выиграла ставка на число.
  numberHits: number;
}

export interface PlayerStats {
  player: PlayerInfo;
  blackjack: BlackjackStats;
  roulette: RouletteStats;
}
