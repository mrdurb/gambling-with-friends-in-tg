import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { isGameId, type Me } from '@casino/shared';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { AuthError, authenticate, type AuthConfig } from './auth.ts';
import type { Db } from './db.ts';
import { findPlayer, getBlackjackStats, getRating, getRouletteStats } from './stats.ts';
import { createTable, findTable, listVisitedTables, recordVisit } from './tables.ts';
import { upsertUser } from './users.ts';
import { WalletError, withdrawFromCashier } from './wallet.ts';

export interface AppOptions {
  // Папка с собранным клиентом; в разработке её нет, клиент раздаёт Vite.
  staticDir?: string;
  // Ссылка на приложение в Telegram, из неё собираются приглашения за стол.
  appLink?: string;
}

export function buildApp(db: Db, authConfig: AuthConfig, options: AppOptions = {}): FastifyInstance {
  const app = Fastify();
  const { staticDir, appLink = '' } = options;

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthError) return reply.code(401).send({ error: 'unauthorized' });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) return reply.code(status).send({ error: 'bad_request' });
    console.error(error);
    return reply.code(500).send({ error: 'internal' });
  });

  // Игрок, от имени которого пришёл запрос; при первом обращении создаётся.
  const currentUser = (request: FastifyRequest): Me =>
    upsertUser(db, authenticate(request.headers.authorization, authConfig));

  app.get('/api/me', async (request) => currentUser(request));

  app.post('/api/cashier', async (request, reply) => {
    const me = currentUser(request);
    const amount = (request.body as { amount?: unknown } | null)?.amount;
    try {
      return { balance: withdrawFromCashier(db, me.id, amount as number) };
    } catch (error) {
      if (error instanceof WalletError) return reply.code(400).send({ error: 'bad_amount' });
      throw error;
    }
  });

  // Игра не указана — блэкджек: так запрашивают клиенты, открытые до появления второй игры.
  app.post('/api/tables', async (request, reply) => {
    const me = currentUser(request);
    const game = (request.body as { game?: unknown } | null)?.game ?? 'blackjack';
    if (!isGameId(game)) return reply.code(400).send({ error: 'bad_game' });
    return createTable(db, me, appLink, game);
  });

  app.get('/api/tables', async (request, reply) => {
    const me = currentUser(request);
    const game = (request.query as { game?: unknown }).game ?? 'blackjack';
    if (!isGameId(game)) return reply.code(400).send({ error: 'bad_game' });
    return listVisitedTables(db, me.id, appLink, game);
  });

  app.get('/api/tables/:code', async (request, reply) => {
    const me = currentUser(request);
    const table = findTable(db, (request.params as { code: string }).code, appLink);
    if (!table) return reply.code(404).send({ error: 'not_found' });
    recordVisit(db, table.code, me.id);
    return table;
  });

  app.get('/api/rating', async (request) => {
    currentUser(request);
    return getRating(db);
  });

  app.get('/api/stats/:userId', async (request, reply) => {
    currentUser(request);
    const raw = (request.params as { userId: string }).userId;
    const player = /^\d{1,16}$/.test(raw) ? findPlayer(db, Number(raw)) : null;
    if (!player) return reply.code(404).send({ error: 'not_found' });
    return { player, blackjack: getBlackjackStats(db, player.id), roulette: getRouletteStats(db, player.id) };
  });

  if (staticDir) app.register(fastifyStatic, { root: resolve(staticDir) });

  return app;
}
