import {
  RESULT_MS,
  ROULETTE_BET_MS,
  ROULETTE_HISTORY,
  SPIN_MS,
  type Ack,
  type PlayerInfo,
  type RouletteField,
  type TableSnapshot,
} from '@casino/shared';
import { Roulette } from '../games/roulette.ts';
import { PhaseTimer, type HostContext, type TableHost } from './host.ts';

// Стол рулетки: мест нет, ставит любой, у кого стол открыт. Фазы и их таймеры, история чисел.
export class RouletteTable implements TableHost {
  private readonly game = new Roulette();
  // Таймер фазы: приём ставок, вращение или показ результата.
  private readonly timer = new PhaseTimer();
  // Поставившие в этом раунде: нужны, чтобы показать и тех, кто уже закрыл стол.
  private readonly bettors = new Map<number, PlayerInfo>();
  // Последние выпавшие числа, новые первыми.
  private history: number[] = [];

  constructor(
    private readonly ctx: HostContext,
    private readonly spinNumber: () => number,
    private readonly spinMs = SPIN_MS,
  ) {}

  enter(): void {}

  // Ушедший после ставки остаётся в раунде. Сам уход колесо не запускает: связь могла оборваться
  // на секунду, пока игрок ещё ставил. Но когда «Готов» нажмут оставшиеся, ушедшего ждать не будут.
  exit(): void {}

  bet(userId: number, field: RouletteField, amount: number): Ack {
    const first = this.game.phase === 'waiting';
    const result = this.game.bet(userId, field, amount, this.ctx.freeBalance(userId));
    if (!result.ok) return result;
    this.bettors.set(userId, this.ctx.present.get(userId)!);
    if (first) this.timer.set(ROULETTE_BET_MS, () => this.spin());
    this.ctx.publish();
    return result;
  }

  clear(userId: number): Ack {
    const result = this.game.clear(userId);
    if (!result.ok) return result;
    this.bettors.delete(userId);
    if (this.game.phase === 'waiting') this.timer.clear();
    if (!this.spinIfAllReady()) this.ctx.publish();
    return result;
  }

  ready(userId: number): Ack {
    const result = this.game.ready(userId);
    if (!result.ok) return result;
    if (!this.spinIfAllReady()) this.ctx.publish();
    return result;
  }

  stakeOf(userId: number): number {
    return this.game.stake(userId);
  }

  isIdle(): boolean {
    return this.game.phase === 'waiting';
  }

  snapshot(): TableSnapshot {
    const { present } = this.ctx;
    const view = this.game.view();
    const gone = [...this.bettors.values()].filter((player) => !present.has(player.id));
    return {
      kind: 'roulette',
      table: this.ctx.table,
      game: {
        phase: view.phase,
        players: [...present.values(), ...gone].map((player) => {
          const state = view.players.find((item) => item.userId === player.id);
          return {
            player,
            connected: present.has(player.id),
            bets: state?.bets ?? {},
            ready: state?.ready ?? false,
            net: state?.net ?? null,
          };
        }),
        timeLeftMs: this.timer.leftMs(),
        number: view.number,
        history: this.history,
      },
    };
  }

  // Досрочный старт: «Готов» у всех поставивших, у кого стол сейчас открыт.
  private spinIfAllReady(): boolean {
    const waitingFor = this.game.bettors().filter((userId) => this.ctx.present.has(userId));
    if (this.game.phase !== 'betting' || waitingFor.length === 0) return false;
    if (!waitingFor.every((userId) => this.game.isReady(userId))) return false;
    this.spin();
    return true;
  }

  // Число известно сразу, чтобы клиенты довели анимацию до него; фишки меняются, когда колесо остановится.
  private spin(): void {
    this.game.spin(this.spinNumber());
    this.timer.set(this.spinMs, () => this.settle());
    this.ctx.publish();
  }

  private settle(): void {
    this.game.finish();
    // Раунд не записался — аннулируется сразу, чтобы стол не показывал выигрыши, которых никто не получил.
    if (!this.ctx.payOut(this.game.results() ?? [])) return this.endRound();
    this.history = [this.game.view().number!, ...this.history].slice(0, ROULETTE_HISTORY);
    this.timer.set(RESULT_MS, () => this.endRound());
    this.ctx.publish();
  }

  private endRound(): void {
    this.timer.clear();
    this.game.reset();
    this.bettors.clear();
    this.ctx.publish();
  }
}
