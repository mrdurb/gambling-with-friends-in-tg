import type { Ack, BjAction, PokerActionKind, RouletteField } from '@casino/shared';
import type { Rooms } from '../src/rooms.ts';

// Короткие имена для действий, которые тесты шлют через общий метод Rooms.action.
export function drive(rooms: Rooms) {
  const act = (userId: number, name: string, ...args: unknown[]): Ack => rooms.action(userId, name, args);
  return Object.assign(rooms, {
    sit: (userId: number, seat: number, force = false) => act(userId, 'seat:take', seat, force),
    stand: (userId: number) => void act(userId, 'seat:leave'),
    bet: (userId: number, amount: number) => act(userId, 'game:bet', amount),
    act: (userId: number, action: BjAction) => act(userId, 'game:action', action),
    rouletteBet: (userId: number, field: RouletteField, amount: number) => act(userId, 'roulette:bet', field, amount),
    rouletteClear: (userId: number) => act(userId, 'roulette:clear'),
    rouletteReady: (userId: number) => act(userId, 'roulette:ready'),
    pokerSit: (userId: number, seat: number, buyIn: number) => act(userId, 'poker:sit', seat, buyIn),
    pokerLeave: (userId: number) => void act(userId, 'poker:leave'),
    pokerRebuy: (userId: number, amount: number) => act(userId, 'poker:rebuy', amount),
    pokerAct: (userId: number, kind: PokerActionKind, amount?: number) => act(userId, 'poker:action', kind, amount),
    pokerDiscard: (userId: number, index: number) => act(userId, 'poker:discard', index),
    pokerShow: (userId: number) => act(userId, 'poker:show'),
  });
}
