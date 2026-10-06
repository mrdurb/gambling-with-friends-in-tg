import Fastify, { type FastifyInstance } from 'fastify';
import { AuthError, authenticate, type AuthConfig } from './auth.ts';
import type { Db } from './db.ts';
import { upsertUser } from './users.ts';

export function buildApp(db: Db, authConfig: AuthConfig): FastifyInstance {
  const app = Fastify();

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AuthError) return reply.code(401).send({ error: 'unauthorized' });
    console.error(error);
    return reply.code(500).send({ error: 'internal' });
  });

  app.get('/api/me', async (request) => {
    const user = authenticate(request.headers.authorization, authConfig);
    return upsertUser(db, user);
  });

  return app;
}
