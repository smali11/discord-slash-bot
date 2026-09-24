// Lazily-created Postgres pool. Works with Neon or Supabase (both need SSL).
import pg from 'pg';
import { config } from '../config.js';

let pool = null;

export function getPool() {
  if (pool) return pool;
  if (!config.database.url) {
    throw new Error('DATABASE_URL is not set. See .env.example.');
  }
  pool = new pg.Pool({
    connectionString: config.database.url,
    // Neon/Supabase present certs that Node does not have in its trust store by
    // default; rejectUnauthorized:false keeps the connection encrypted while
    // accepting their cert. Set DATABASE_SSL=false only for a local Postgres.
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    max: 5, // serverless: keep the pool small
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => {
    // Background idle-client errors shouldn't crash the process.
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ level: 'error', msg: 'pg_pool_error', error: String(err.message) }));
  });
  return pool;
}

export function query(text, params) {
  return getPool().query(text, params);
}
