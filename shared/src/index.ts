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
}

export type Ack<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

export interface ClientToServerEvents {
  'table:join': (code: string, ack: (result: Ack<{ snapshot: TableSnapshot }>) => void) => void;
  'table:leave': () => void;
  'seat:take': (seat: number, force: boolean, ack: (result: Ack) => void) => void;
  'seat:leave': () => void;
}

export interface ServerToClientEvents {
  'table:snapshot': (snapshot: TableSnapshot) => void;
  // Игрок открыл приложение в другом месте; это подключение больше не используется.
  kicked: () => void;
}
