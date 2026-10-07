import type { PlayerInfo, TableInfo, TableSnapshot } from '@casino/shared';
import type { PlayerResult } from '../rounds.ts';

export type Timer = ReturnType<typeof setTimeout>;

// Ведущий стола: всё, что зависит от игры. Общий слой (Rooms) знает о нём только это.
export interface TableHost {
  // Игрок открыл стол (или вернулся после обрыва связи).
  enter(player: PlayerInfo): void;
  // Игрок закрыл стол или потерял связь.
  exit(userId: number): void;
  // Сколько фишек игрока сейчас на кону за этим столом.
  stakeOf(userId: number): number;
  // За столом ничего не происходит: его можно убрать из памяти, когда никто не смотрит.
  isIdle(): boolean;
  snapshot(): TableSnapshot;
}

// Что общий слой даёт ведущему стола.
export interface HostContext {
  table: TableInfo;
  // Игроки, у которых стол сейчас открыт.
  present: Map<number, PlayerInfo>;
  // Разослать текущий снимок стола.
  publish(): void;
  // Баланс игрока за вычетом всего, что у него на кону за любым столом.
  freeBalance(userId: number): number;
  balanceOf(userId: number): number;
  // Записывает итоги раунда и сообщает участникам новые балансы. false — раунд не записался:
  // фишки ни у кого не изменились, и стол должен аннулировать раунд, не показывая результата.
  payOut(results: PlayerResult[]): boolean;
}

// Таймер текущей фазы стола: один на стол, с известным временем окончания.
export class PhaseTimer {
  private current: { handle: Timer; endsAt: number } | null = null;

  set(ms: number, onElapsed: () => void): void {
    this.clear();
    this.current = { handle: setTimeout(onElapsed, ms), endsAt: Date.now() + ms };
  }

  clear(): void {
    clearTimeout(this.current?.handle);
    this.current = null;
  }

  leftMs(): number | null {
    return this.current && Math.max(0, this.current.endsAt - Date.now());
  }
}
