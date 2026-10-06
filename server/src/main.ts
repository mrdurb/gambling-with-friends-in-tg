import { buildApp } from './app.ts';
import { openDb } from './db.ts';

const botToken = process.env.BOT_TOKEN ?? '';
const devAuth = process.env.DEV_AUTH === '1';
if (!botToken && !devAuth) throw new Error('BOT_TOKEN is required unless DEV_AUTH=1');

const db = openDb(process.env.DB_PATH ?? 'casino.db');
const app = buildApp(db, { botToken, devAuth });
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
console.log(`server listening on :${port}${devAuth ? ' (DEV_AUTH on)' : ''}`);
