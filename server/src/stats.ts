import type { BjDetails, BlackjackStats, PlayerInfo, RatingRow, RouletteDetails, RouletteStats } from '@casino/shared';
import type { Db } from './db.ts';

interface PlayerRow {
  id: number;
  first_name: string;
  last_name: string | null;
  photo_url: string | null;
}

const toPlayer = (row: PlayerRow): PlayerInfo => ({
  id: row.id,
  firstName: row.first_name,
  lastName: row.last_name,
  photoUrl: row.photo_url,
});

export function findPlayer(db: Db, userId: number): PlayerInfo | null {
  const row = db.prepare('SELECT id, first_name, last_name, photo_url FROM users WHERE id = ?').get(userId) as
    | PlayerRow
    | undefined;
  return row ? toPlayer(row) : null;
}

// Все игроки по убыванию чистого результата. Фишки из кассы и стартовые сюда не входят:
// считаются только итоги раздач.
export function getRating(db: Db): RatingRow[] {
  const rows = db
    .prepare(`
      SELECT u.id, u.first_name, u.last_name, u.photo_url,
        COALESCE(SUM(CASE WHEN r.net > 0 THEN r.net END), 0) AS won,
        COALESCE(SUM(CASE WHEN r.net < 0 THEN -r.net END), 0) AS lost
      FROM users u LEFT JOIN round_results r ON r.user_id = u.id
      GROUP BY u.id
      ORDER BY won - lost DESC, u.id
    `)
    .all() as unknown as (PlayerRow & { won: number; lost: number })[];
  return rows.map((row) => ({ player: toPlayer(row), won: row.won, lost: row.lost, net: row.won - row.lost }));
}

export function getBlackjackStats(db: Db, userId: number): BlackjackStats {
  const rounds = db
    .prepare(`
      SELECT rr.wagered, rr.net, rr.details FROM round_results rr JOIN rounds r ON r.id = rr.round_id
      WHERE rr.user_id = ? AND r.game = 'blackjack' ORDER BY rr.round_id
    `)
    .all(userId) as unknown as { wagered: number; net: number; details: string }[];
  const cashier = db
    .prepare("SELECT COUNT(*) AS visits, COALESCE(SUM(amount), 0) AS total FROM ledger WHERE user_id = ? AND type = 'cashier'")
    .get(userId) as { visits: number; total: number };

  const stats: BlackjackStats = {
    won: 0, lost: 0, net: 0, rounds: rounds.length, wins: 0, losses: 0, pushes: 0, winRate: 0, blackjacks: 0, bustRate: 0,
    biggestWin: 0, biggestBet: 0, longestWinStreak: 0, longestLoseStreak: 0, doubles: 0, doublesWonRate: 0,
    cashierVisits: cashier.visits, cashierTotal: cashier.total,
  };
  let busts = 0;
  let doublesWon = 0;
  let winStreak = 0;
  let loseStreak = 0;

  for (const round of rounds) {
    const details = JSON.parse(round.details) as BjDetails;
    if (round.net > 0) {
      stats.wins += 1;
      stats.won += round.net;
      winStreak += 1;
      loseStreak = 0;
    } else if (round.net < 0) {
      stats.losses += 1;
      stats.lost -= round.net;
      loseStreak += 1;
      winStreak = 0;
    } else {
      // Ничья серию не прерывает и не продлевает.
      stats.pushes += 1;
    }
    stats.longestWinStreak = Math.max(stats.longestWinStreak, winStreak);
    stats.longestLoseStreak = Math.max(stats.longestLoseStreak, loseStreak);
    stats.biggestWin = Math.max(stats.biggestWin, round.net);
    stats.biggestBet = Math.max(stats.biggestBet, round.wagered);
    if (details.blackjack) stats.blackjacks += 1;
    if (details.bust) busts += 1;
    stats.doubles += details.doubles;
    doublesWon += details.doublesWon;
  }

  stats.net = stats.won - stats.lost;
  if (stats.rounds > 0) {
    stats.winRate = stats.wins / stats.rounds;
    stats.bustRate = busts / stats.rounds;
  }
  if (stats.doubles > 0) stats.doublesWonRate = doublesWon / stats.doubles;
  return stats;
}

export function getRouletteStats(db: Db, userId: number): RouletteStats {
  const rounds = db
    .prepare(`
      SELECT rr.wagered, rr.net, rr.details FROM round_results rr JOIN rounds r ON r.id = rr.round_id
      WHERE rr.user_id = ? AND r.game = 'roulette'
    `)
    .all(userId) as unknown as { wagered: number; net: number; details: string }[];

  const stats: RouletteStats = { rounds: rounds.length, wagered: 0, net: 0, biggestWin: 0, numberHits: 0 };
  for (const round of rounds) {
    const details = JSON.parse(round.details) as RouletteDetails;
    stats.wagered += round.wagered;
    stats.net += round.net;
    stats.biggestWin = Math.max(stats.biggestWin, round.net);
    if (details.bets[`n${details.number}`]) stats.numberHits += 1;
  }
  return stats;
}
