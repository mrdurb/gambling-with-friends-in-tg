import { buildApp } from './app.ts';
import { loadAuthConfig } from './config.ts';
import { openDb } from './db.ts';
import { attachRealtime } from './realtime.ts';

const authConfig = loadAuthConfig(process.env);
const appLink = process.env.APP_LINK ?? '';
const db = openDb(process.env.DB_PATH ?? 'casino.db');
const app = buildApp(db, authConfig, { staticDir: process.env.STATIC_DIR, appLink });
attachRealtime(app.server, { db, authConfig, appLink });
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
console.log(`server listening on :${port}${authConfig.devAuth ? ' (DEV_AUTH on)' : ''}`);
