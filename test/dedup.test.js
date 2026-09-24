// Integration test for the dedup primitive and action logging. Runs only when
// DATABASE_URL is set (e.g. a local Postgres in CI). The dedup guarantee — the
// same interaction id can only be recorded once — is what stops us doing the
// same thing twice if Discord redelivers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const RUN = !!process.env.DATABASE_URL;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let repo, pool;

before(async () => {
  if (!RUN) return;
  ({ getPool } = await import('../src/db/pool.js'));
  pool = getPool();
  const sql = readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  repo = await import('../src/db/repo.js');
});

let getPool;

after(async () => {
  if (pool) await pool.end();
});

const uniqueId = () => 'test-' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
const guildId = 'test-guild-1';

test('recordInteraction inserts once, then reports duplicates', { skip: !RUN }, async () => {
  const id = uniqueId();
  const base = { id, guildId, channelId: 'c1', type: 2, commandName: 'report', userId: 'u1', username: 'tester', input: 'the site is down' };

  const first = await repo.recordInteraction(base);
  assert.equal(first.inserted, true, 'first delivery inserts');
  assert.equal(first.row.status, 'received');

  const second = await repo.recordInteraction(base);
  assert.equal(second.inserted, false, 'duplicate delivery is detected');
  assert.equal(second.row.id, id);

  const third = await repo.recordInteraction({ ...base, input: 'DIFFERENT payload same id' });
  assert.equal(third.inserted, false, 'same id is a dup even if payload differs');
});

test('status transitions and result persistence', { skip: !RUN }, async () => {
  const id = uniqueId();
  await repo.recordInteraction({ id, guildId, type: 2, commandName: 'report', input: 'urgent outage' });
  await repo.setInteractionStatus(id, 'processing');
  await repo.setInteractionStatus(id, 'completed', { result: { tag: 'incident', priority: 'high', source: 'rules' } });
  const row = await repo.getInteraction(id);
  assert.equal(row.status, 'completed');
  assert.equal(row.result.priority, 'high');
});

test('action logs are recorded and retrievable', { skip: !RUN }, async () => {
  const id = uniqueId();
  await repo.recordInteraction({ id, guildId, type: 2, commandName: 'report', input: 'x' });
  await repo.logAction({ interactionId: id, guildId, step: 'ai', status: 'failed', error: 'timeout' });
  await repo.logAction({ interactionId: id, guildId, step: 'mirror', status: 'success', detail: { target: 'slack' } });
  const actions = await repo.listActions({ interactionId: id });
  assert.equal(actions.length, 2);
  const steps = actions.map((a) => a.step).sort();
  assert.deepEqual(steps, ['ai', 'mirror']);
});

test('statsForGuild aggregates', { skip: !RUN }, async () => {
  const stats = await repo.statsForGuild(guildId);
  assert.ok(stats.total >= 2);
  assert.ok(typeof stats.completed === 'number');
});
