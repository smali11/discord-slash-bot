// Creates the database tables. Idempotent — safe to re-run.
// Usage: npm run init-db
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { getPool } from '../src/db/pool.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  const pool = getPool();
  console.log('Applying schema…');
  await pool.query(sql);
  console.log('✓ Schema applied. Tables: guilds, interactions, action_logs.');
  await pool.end();
}

main().catch((err) => {
  console.error('✗ init-db failed:', err.message);
  process.exit(1);
});
