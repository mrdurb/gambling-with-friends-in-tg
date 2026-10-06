import { DISCONNECT_GRACE_MS, type PlayerInfo, type TableInfo, type TableSnapshot } from '@casino/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rooms } from '../src/rooms.ts';

const tableA: TableInfo = { code: 'AAAAAAAA', name: 'A', game: 'blackjack', inviteLink: null };
const tableB: TableInfo = { code: 'BBBBBBBB', name: 'B', game: 'blackjack', inviteLink: null };
const player = (id: number): PlayerInfo => ({ id, firstName: `Игрок ${id}`, lastName: null, photoUrl: null });

function setup() {
  const sent: TableSnapshot[] = [];
  const rooms = new Rooms((snapshot) => sent.push(snapshot));
  const last = (code: string) => sent.filter((s) => s.table.code === code).at(-1)!;
  return { rooms, sent, last };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('entering a table', () => {
  it('starts with six empty seats and counts the visitor as a spectator', () => {
    const { rooms } = setup();
    const snapshot = rooms.enter(tableA, player(1));
    expect(snapshot.seats).toEqual([null, null, null, null, null, null]);
    expect(snapshot.spectators).toBe(1);
    expect(snapshot.table).toEqual(tableA);
  });

  it('tells everyone at the table when someone enters or leaves', () => {
    const { rooms, last } = setup();
    rooms.enter(tableA, player(1));
    rooms.enter(tableA, player(2));
    expect(last('AAAAAAAA').spectators).toBe(2);
    rooms.exit(2);
    expect(last('AAAAAAAA').spectators).toBe(1);
  });

  it('moves the player out of the previous table when they open another one', () => {
    const { rooms, last } = setup();
    rooms.enter(tableA, player(1));
    rooms.enter(tableB, player(1));
    expect(last('AAAAAAAA').spectators).toBe(0);
    expect(last('BBBBBBBB').spectators).toBe(1);
  });
});

describe('seats', () => {
  it('seats a player and stops counting them as a spectator', () => {
    const { rooms, last } = setup();
    rooms.enter(tableA, player(1));
    expect(rooms.sit(1, 2)).toEqual({ ok: true });
    expect(last('AAAAAAAA').seats[2]).toEqual({ player: player(1), connected: true });
    expect(last('AAAAAAAA').spectators).toBe(0);
  });

  it('refuses a taken seat, a seat outside the table, and a second seat', () => {
    const { rooms } = setup();
    rooms.enter(tableA, player(1));
    rooms.enter(tableA, player(2));
    rooms.sit(1, 0);
    expect(rooms.sit(2, 0)).toEqual({ ok: false, error: 'seat_taken' });
    expect(rooms.sit(2, 6)).toEqual({ ok: false, error: 'bad_seat' });
    expect(rooms.sit(2, -1)).toEqual({ ok: false, error: 'bad_seat' });
    expect(rooms.sit(2, 1.5)).toEqual({ ok: false, error: 'bad_seat' });
    expect(rooms.sit(1, 1)).toEqual({ ok: false, error: 'already_seated' });
  });

  it('refuses to seat someone who has not opened a table', () => {
    const { rooms } = setup();
    expect(rooms.sit(1, 0)).toEqual({ ok: false, error: 'not_at_table' });
  });

  it('frees the seat when the player stands up', () => {
    const { rooms, last } = setup();
    rooms.enter(tableA, player(1));
    rooms.sit(1, 0);
    rooms.stand(1);
    expect(last('AAAAAAAA').seats[0]).toBeNull();
    expect(last('AAAAAAAA').spectators).toBe(1);
  });

  it('lets a player sit at only one table unless they agree to move', () => {
    const { rooms, last } = setup();
    rooms.enter(tableA, player(1));
    rooms.sit(1, 0);
    rooms.enter(tableB, player(1));

    expect(rooms.sit(1, 3)).toEqual({ ok: false, error: 'seated_elsewhere' });
    expect(last('AAAAAAAA').seats[0]?.player.id).toBe(1);

    expect(rooms.sit(1, 3, true)).toEqual({ ok: true });
    expect(last('AAAAAAAA').seats[0]).toBeNull();
    expect(last('BBBBBBBB').seats[3]?.player.id).toBe(1);
  });
});

describe('losing the connection', () => {
  it('keeps the seat, shows the player as disconnected, and restores them on return', () => {
    const { rooms, last } = setup();
    rooms.enter(tableA, player(1));
    rooms.enter(tableA, player(2));
    rooms.sit(1, 0);

    rooms.exit(1);
    expect(last('AAAAAAAA').seats[0]).toEqual({ player: player(1), connected: false });

    vi.advanceTimersByTime(DISCONNECT_GRACE_MS - 1);
    const back = rooms.enter(tableA, player(1));
    expect(back.seats[0]).toEqual({ player: player(1), connected: true });

    vi.advanceTimersByTime(DISCONNECT_GRACE_MS * 2);
    expect(last('AAAAAAAA').seats[0]?.player.id).toBe(1);
  });

  it('frees the seat after the grace period', () => {
    const { rooms, last } = setup();
    rooms.enter(tableA, player(1));
    rooms.enter(tableA, player(2));
    rooms.sit(1, 0);
    rooms.exit(1);

    vi.advanceTimersByTime(DISCONNECT_GRACE_MS);
    expect(last('AAAAAAAA').seats[0]).toBeNull();
    expect(rooms.sit(2, 0)).toEqual({ ok: true });
  });

  it('treats opening another table as leaving the seat unattended', () => {
    const { rooms, last } = setup();
    rooms.enter(tableA, player(1));
    rooms.sit(1, 0);
    rooms.enter(tableB, player(1));
    expect(last('AAAAAAAA').seats[0]?.connected).toBe(false);
    vi.advanceTimersByTime(DISCONNECT_GRACE_MS);
    expect(last('AAAAAAAA').seats[0]).toBeNull();
  });

  it('ignores an exit from someone who is not at any table', () => {
    const { rooms, sent } = setup();
    rooms.exit(99);
    expect(sent).toHaveLength(0);
  });

  it('uses the freshest profile when the player comes back', () => {
    const { rooms } = setup();
    rooms.enter(tableA, player(1));
    rooms.sit(1, 0);
    rooms.exit(1);
    const renamed = { ...player(1), firstName: 'Новое имя' };
    expect(rooms.enter(tableA, renamed).seats[0]?.player.firstName).toBe('Новое имя');
  });
});
