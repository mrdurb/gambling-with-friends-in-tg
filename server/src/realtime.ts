import type { Server as HttpServer } from 'node:http';
import type { ClientToServerEvents, Me, PlayerInfo, ServerToClientEvents } from '@casino/shared';
import { Server, type Socket } from 'socket.io';
import { authenticate, type AuthConfig } from './auth.ts';
import type { Db } from './db.ts';
import { Rooms } from './rooms.ts';
import { findTable, recordVisit } from './tables.ts';
import { upsertUser } from './users.ts';

interface Deps {
  db: Db;
  authConfig: AuthConfig;
  appLink: string;
}

type Io = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: Me }>;
type Client = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, { user: Me }>;

const toPlayerInfo = ({ id, firstName, lastName, photoUrl }: Me): PlayerInfo => ({ id, firstName, lastName, photoUrl });

// Сокеты поверх Rooms: авторизация, одно подключение на игрока, рассылка снимков по комнатам.
export function attachRealtime(httpServer: HttpServer, { db, authConfig, appLink }: Deps): Io {
  const io: Io = new Server(httpServer);
  const rooms = new Rooms((snapshot) => io.to(snapshot.table.code).emit('table:snapshot', snapshot));
  const connections = new Map<number, Client>();

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

    socket.on('seat:take', (seat, force, ack) => {
      if (typeof ack !== 'function') return;
      ack(rooms.sit(user.id, seat, force === true));
    });

    socket.on('seat:leave', () => rooms.stand(user.id));

    socket.on('disconnect', () => {
      // Вытесненное подключение не должно снимать игрока со стола: за него уже отвечает новое.
      if (connections.get(user.id) !== socket) return;
      connections.delete(user.id);
      rooms.exit(user.id);
    });
  });

  return io;
}
