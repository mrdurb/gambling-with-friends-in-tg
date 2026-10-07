import { randomInt } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import {
  CHAT_MAX_LENGTH,
  CHAT_RATE_LIMIT,
  CHAT_RATE_WINDOW_MS,
  ROULETTE_RATE_LIMIT,
  REACTIONS,
  type Card,
  type ClientToServerEvents,
  type Me,
  type PlayerInfo,
  type ServerToClientEvents,
} from '@casino/shared';
import { Server, type Socket } from 'socket.io';
import { authenticate, type AuthConfig } from './auth.ts';
import type { Db } from './db.ts';
import { shuffledShoe } from './games/blackjack.ts';
import { Rooms } from './rooms.ts';
import { balanceOf, settleRound } from './rounds.ts';
import { findTable, recordVisit } from './tables.ts';
import { upsertUser } from './users.ts';

interface Deps {
  db: Db;
  authConfig: AuthConfig;
  appLink: string;
  // Подмена башмака в тестах; по умолчанию — честная перетасовка.
  newShoe?: () => Card[];
  // Подмена колеса рулетки в тестах; по умолчанию — честное случайное число.
  spinNumber?: () => number;
  spinMs?: number;
}

type Io = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: Me }>;
type Client = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: Me }>;

const toPlayerInfo = ({ id, firstName, lastName, photoUrl }: Me): PlayerInfo => ({ id, firstName, lastName, photoUrl });

// Сокеты поверх Rooms: авторизация, одно подключение на игрока, рассылка снимков по комнатам.
export function attachRealtime(httpServer: HttpServer, { db, authConfig, appLink, newShoe, spinNumber, spinMs }: Deps): Io {
  const io: Io = new Server(httpServer);
  const connections = new Map<number, Client>();
  const rooms = new Rooms({
    broadcast: (snapshot) => io.to(snapshot.table.code).emit('table:snapshot', snapshot),
    balanceOf: (userId) => balanceOf(db, userId),
    settle: (tableCode, results, game) => settleRound(db, tableCode, game, results),
    notifyBalance: (userId, balance) => connections.get(userId)?.emit('balance', balance),
    newShoe: newShoe ?? (() => shuffledShoe(randomInt)),
    spinNumber: spinNumber ?? (() => randomInt(37)),
    spinMs,
  });

  io.use((socket, next) => {
    try {
      socket.data.user = upsertUser(db, authenticate(socket.handshake.auth.token, authConfig));
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;

    const previous = connections.get(user.id);
    connections.set(user.id, socket);
    if (previous) {
      previous.emit('kicked');
      previous.disconnect(true);
    }

    const leaveSocketRooms = () => {
      for (const room of socket.rooms) if (room !== socket.id) socket.leave(room);
    };

    socket.on('table:join', (code, ack) => {
      if (typeof ack !== 'function') return;
      const table = typeof code === 'string' ? findTable(db, code, appLink) : null;
      if (!table) return ack({ ok: false, error: 'not_found' });
      recordVisit(db, table.code, user.id);
      leaveSocketRooms();
      socket.join(table.code);
      ack({ ok: true, snapshot: rooms.enter(table, toPlayerInfo(user)) });
    });

    socket.on('table:leave', () => {
      leaveSocketRooms();
      rooms.exit(user.id);
    });

    // Игровые события уходят ведущему стола как есть: имя события и аргументы; проверяет их он.
    const forward = (name: string, tooFast?: () => boolean) =>
      socket.on(name as 'game:bet', (...args: unknown[]) => {
        const ack = args.at(-1);
        if (typeof ack !== 'function') return void (name === 'seat:leave' && rooms.action(user.id, name, []));
        ack(tooFast?.() ? { ok: false, error: 'too_fast' } : rooms.action(user.id, name, args.slice(0, -1)));
      });

    // Предел частоты на подключение: не больше limit принятых действий за окно времени.
    const limiter = (limit: number) => {
      const acceptedAt: number[] = [];
      return () => {
        const now = Date.now();
        while (acceptedAt.length && now - acceptedAt[0]! >= CHAT_RATE_WINDOW_MS) acceptedAt.shift();
        if (acceptedAt.length >= limit) return true;
        acceptedAt.push(now);
        return false;
      };
    };
    // Общий предел для чата и реакций.
    const tooFast = limiter(CHAT_RATE_LIMIT);
    // Каждое принятое действие со ставками рассылает снимок всему столу.
    const bettingTooFast = limiter(ROULETTE_RATE_LIMIT);

    for (const name of ['seat:take', 'seat:leave', 'game:bet', 'game:action']) forward(name);
    for (const name of ['roulette:bet', 'roulette:clear', 'roulette:ready']) forward(name, bettingTooFast);

    // Чат и реакции нигде не сохраняются: проверили и сразу разослали тем, у кого открыт стол.
    socket.on('chat:send', (text, ack) => {
      if (typeof ack !== 'function') return;
      const code = rooms.tableOf(user.id);
      if (!code) return ack({ ok: false, error: 'not_at_table' });
      const trimmed = typeof text === 'string' ? text.trim() : '';
      if (!trimmed || [...trimmed].length > CHAT_MAX_LENGTH) return ack({ ok: false, error: 'bad_message' });
      if (tooFast()) return ack({ ok: false, error: 'too_fast' });
      io.to(code).emit('chat:message', { from: toPlayerInfo(user), text: trimmed, at: Date.now() });
      ack({ ok: true });
    });

    socket.on('reaction:send', (reaction, ack) => {
      if (typeof ack !== 'function') return;
      const code = rooms.tableOf(user.id);
      if (!code || !rooms.canReact(user.id)) return ack({ ok: false, error: 'not_seated' });
      const value = reaction?.kind === 'emoji' ? reaction.value : null;
      if (!(REACTIONS as readonly unknown[]).includes(value)) return ack({ ok: false, error: 'bad_reaction' });
      if (tooFast()) return ack({ ok: false, error: 'too_fast' });
      io.to(code).emit('reaction', { userId: user.id, reaction: { kind: 'emoji', value: value as string } });
      ack({ ok: true });
    });

    socket.on('disconnect', () => {
      // Вытесненное подключение не должно снимать игрока со стола: за него уже отвечает новое.
      if (connections.get(user.id) !== socket) return;
      connections.delete(user.id);
      rooms.exit(user.id);
    });
  });

  return io;
}
