import {
  MAX_BET,
  MIN_BET,
  isRouletteField,
  roulettePayout,
  rouletteWins,
  type RouletteBets,
  type RouletteDetails,
  type RouletteField,
  type RoulettePhase,
  type RoundOutcome,
} from '@casino/shared';

export type Result = { ok: true } | { ok: false; error: string };

export interface RouletteResult {
  userId: number;
  wagered: number;
  net: number;
  outcome: RoundOutcome;
  details: RouletteDetails;
}

interface PlayerState {
  bets: Map<RouletteField, number>;
  ready: boolean;
}

const fail = (error: string): Result => ({ ok: false, error });
const total = (state: PlayerState | undefined) => [...(state?.bets.values() ?? [])].reduce((sum, amount) => sum + amount, 0);

// Правила рулетки как машина состояний по игрокам. Выпавшее число подаётся снаружи;
// таймеры, балансы и рассылка — забота стола.
export class Roulette {
  phase: RoulettePhase = 'waiting';
  private readonly players = new Map<number, PlayerState>();
  private number: number | null = null;
  private settled: RouletteResult[] | null = null;

  // freeBalance — сколько фишек у игрока свободно, уже за вычетом стоящих ставок.
  bet(userId: number, field: RouletteField, amount: number, freeBalance: number): Result {
    if (this.phase === 'spinning' || this.phase === 'result') return fail('round_in_progress');
    if (!isRouletteField(field)) return fail('bad_field');
    const state = this.players.get(userId);
    if (state?.ready) return fail('already_ready');
    if (!Number.isInteger(amount) || amount < MIN_BET) return fail('bad_bet');
    if (total(state) + amount > MAX_BET) return fail('over_limit');
    if (amount > freeBalance) return fail('insufficient');

    const bets = state?.bets ?? new Map<RouletteField, number>();
    bets.set(field, (bets.get(field) ?? 0) + amount);
    if (!state) this.players.set(userId, { bets, ready: false });
    this.phase = 'betting';
    return { ok: true };
  }

  // Снимает все ставки игрока.
  clear(userId: number): Result {
    const refusal = this.refusal(userId);
    if (refusal) return refusal;
    this.players.delete(userId);
    if (this.players.size === 0) this.phase = 'waiting';
    return { ok: true };
  }

  // Игрок закончил ставить: дальше менять ставки нельзя.
  ready(userId: number): Result {
    const refusal = this.refusal(userId);
    if (refusal) return refusal;
    this.players.get(userId)!.ready = true;
    return { ok: true };
  }

  hasBets(userId: number): boolean {
    return this.players.has(userId);
  }

  isReady(userId: number): boolean {
    return this.players.get(userId)?.ready ?? false;
  }

  bettors(): number[] {
    return [...this.players.keys()];
  }

  // Сколько фишек игрока сейчас на кону. После расчёта ставки уже учтены в балансе.
  stake(userId: number): number {
    return this.phase === 'result' ? 0 : total(this.players.get(userId));
  }

  spin(number: number): void {
    if (this.phase !== 'betting') return;
    this.number = number;
    this.phase = 'spinning';
  }

  // Колесо остановилось: считаем итоги.
  finish(): void {
    if (this.phase !== 'spinning') return;
    const number = this.number!;
    this.settled = [...this.players].map(([userId, state]) => {
      let net = 0;
      for (const [field, amount] of state.bets) net += rouletteWins(field, number) ? amount * roulettePayout(field) : -amount;
      return {
        userId,
        wagered: total(state),
        net,
        outcome: net > 0 ? 'win' : net < 0 ? 'lose' : 'push',
        details: { number, bets: Object.fromEntries(state.bets) as RouletteBets },
      };
    });
    this.phase = 'result';
  }

  // Итоги раунда; null, пока колесо не остановилось.
  results(): RouletteResult[] | null {
    return this.settled;
  }

  reset(): void {
    this.players.clear();
    this.number = null;
    this.settled = null;
    this.phase = 'waiting';
  }

  view(): { phase: RoulettePhase; number: number | null; players: { userId: number; bets: RouletteBets; ready: boolean; net: number | null }[] } {
    return {
      phase: this.phase,
      number: this.number,
      players: [...this.players].map(([userId, state]) => ({
        userId,
        bets: Object.fromEntries(state.bets) as RouletteBets,
        ready: state.ready,
        net: this.settled?.find((result) => result.userId === userId)?.net ?? null,
      })),
    };
  }

  private refusal(userId: number): Result | null {
    if (this.phase === 'spinning' || this.phase === 'result') return fail('round_in_progress');
    const state = this.players.get(userId);
    if (!state) return fail('no_bets');
    if (state.ready) return fail('already_ready');
    return null;
  }
}
