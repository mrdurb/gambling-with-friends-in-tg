import type { BjDetails, RoundOutcome } from '@casino/shared';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { openDb, type Db } from '../src/db.ts';
import { settleRound } from '../src/rounds.ts';
import { getBlackjackStats, getRating } from '../src/stats.ts';
import { upsertUser } from '../src/users.ts';
import { withdrawFromCashier } from '../src/wallet.ts';

function setup(ids = [1, 2, 3]) {
  const db = openDb(':memory:');
  for (const id of ids) upsertUser(db, { id, firstName: `И${id}`, lastName: null, username: null, photoUrl: null });
  return db;
}

const plain: BjDetails = { blackjack: false, bust: false, doubles: 0, doublesWon: 0 };

// Раунд одного игрока: чистый результат, поставлено, подробности.
function round(db: Db, userId: number, net: number, wagered = Math.abs(net) || 10, details: Partial<BjDetails> = {}) {
  const outcome: RoundOutcome = net > 0 ? 'win' : net < 0 ? 'lose' : 'push';
  settleRound(db, 'TABLE001', 'blackjack', [{ userId, wagered, net, outcome, details: { ...plain, ...details } }]);
}

describe('rating', () => {
  it('sums won and lost chips separately and sorts by net result', () => {
    const db = setup();
    round(db, 1, 100);
    round(db, 1, -30);
    round(db, 2, 500);
    round(db, 2, -700);
    round(db, 2, 0);

    expect(getRating(db).map((row) => [row.player.id, row.won, row.lost, row.net])).toEqual([
      [1, 100, 30, 70],
      [3, 0, 0, 0],
      [2, 500, 700, -200],
    ]);
  });

  it('ignores chips taken from the cashier and the start chips', () => {
    const db = setup([1]);
    withdrawFromCashier(db, 1, 50_000);
    expect(getRating(db)).toMatchObject([{ won: 0, lost: 0, net: 0 }]);
  });

  it('carries the player profile', () => {
    const db = setup([1]);
    upsertUser(db, { id: 1, firstName: 'Стас', lastName: 'К', username: null, photoUrl: 'https://t.me/p.jpg' });
    expect(getRating(db)[0]!.player).toEqual({ id: 1, firstName: 'Стас', lastName: 'К', photoUrl: 'https://t.me/p.jpg' });
  });
});

describe('blackjack statistics', () => {
  it('is all zeros for a player who has not played', () => {
    const db = setup([1]);
    expect(getBlackjackStats(db, 1)).toEqual({
      won: 0, lost: 0, net: 0, rounds: 0, wins: 0, losses: 0, pushes: 0, winRate: 0, blackjacks: 0, bustRate: 0,
      biggestWin: 0, biggestBet: 0, longestWinStreak: 0, longestLoseStreak: 0, doubles: 0, doublesWonRate: 0,
      cashierVisits: 0, cashierTotal: 0,
    });
  });

  it('counts results, rates and records', () => {
    const db = setup([1, 2]);
    round(db, 1, 150, 100, { blackjack: true });
    round(db, 1, -200, 200, { bust: true, doubles: 1 });
    round(db, 1, 400, 400, { doubles: 2, doublesWon: 2 });
    round(db, 1, 0, 50);
    round(db, 1, -25, 25, { bust: true });
    round(db, 2, 9999, 5000); // чужие раздачи не учитываются

    expect(getBlackjackStats(db, 1)).toMatchObject({
      won: 550,
      lost: 225,
      net: 325,
      rounds: 5,
      wins: 2,
      losses: 2,
      pushes: 1,
      winRate: 0.4,
      blackjacks: 1,
      bustRate: 0.4,
      biggestWin: 400,
      biggestBet: 400,
      doubles: 3,
      doublesWonRate: 2 / 3,
    });
  });

  it('finds the longest streaks; a push neither breaks nor extends one', () => {
    const db = setup([1]);
    for (const net of [10, 10, 0, 10, -10, 10, 10, -10, -10, 0, 0, -10, -10, 10]) round(db, 1, net);
    expect(getBlackjackStats(db, 1)).toMatchObject({ longestWinStreak: 3, longestLoseStreak: 4 });
  });

  it('counts cashier visits and chips, without the start chips', () => {
    const db = setup([1, 2]);
    withdrawFromCashier(db, 1, 5000);
    withdrawFromCashier(db, 1, 37);
    withdrawFromCashier(db, 2, 100_000);
    expect(getBlackjackStats(db, 1)).toMatchObject({ cashierVisits: 2, cashierTotal: 5037 });
  });
});

describe('stats API', () => {
  function api() {
    const db = setup([1, 2]);
    round(db, 2, 300);
    const app = buildApp(db, { botToken: '', devAuth: true });
    const get = (url: string, auth: string | null = 'dev 1') => app.inject({ url, headers: auth ? { authorization: auth } : {} });
    return { get };
  }

  it('returns the rating', async () => {
    const res = await api().get('/api/rating');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject([{ player: { id: 2 }, net: 300 }, { player: { id: 1 }, net: 0 }]);
  });

  it('returns the statistics of any player', async () => {
    const res = await api().get('/api/stats/2');
    expect(res.json()).toMatchObject({ player: { id: 2, firstName: 'И2' }, blackjack: { rounds: 1, wins: 1, net: 300 } });
  });

  it('answers 404 for an unknown or malformed player id', async () => {
    const { get } = api();
    expect((await get('/api/stats/999')).statusCode).toBe(404);
    expect((await get('/api/stats/abc')).statusCode).toBe(404);
    expect((await get('/api/stats/2%20OR%201=1')).statusCode).toBe(404);
  });

  it('requires authorization', async () => {
    const { get } = api();
    expect((await get('/api/rating', null)).statusCode).toBe(401);
    expect((await get('/api/stats/2', null)).statusCode).toBe(401);
  });
});
