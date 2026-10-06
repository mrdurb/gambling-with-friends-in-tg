import { buildApp } from './app.ts';
import { loadAuthConfig } from './config.ts';
import { openDb } from './db.ts';

const authConfig = loadAuthConfig(process.env);
const db = openDb(process.env.DB_PATH ?? 'casino.db');
const app = buildApp(db, authConfig);
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: '0.0.0.0' });
console.log(`server listening on :${port}${authConfig.devAuth ? ' (DEV_AUTH on)' : ''}`);
