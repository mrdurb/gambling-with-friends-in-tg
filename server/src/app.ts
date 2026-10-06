import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { Me } from '@casino/shared';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { AuthError, authenticate, type AuthConfig } from './auth.ts';
import type { Db } from './db.ts';
import { upsertUser } from './users.ts';
import { WalletError, withdrawFromCashier } from './wallet.ts';

// staticDir — папка с собранным клиентом; в разработке её нет, клиент раздаёт Vite.
export function buildApp(db: Db, authConfig: AuthConfig, staticDir?: string): FastifyInstance {
  const app = Fastify();

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

  if (staticDir) app.register(fastifyStatic, { root: resolve(staticDir) });

  return app;
}
