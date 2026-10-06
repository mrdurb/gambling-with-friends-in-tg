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
