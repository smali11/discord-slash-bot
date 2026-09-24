import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiEnabled, triage, coerceResult, extractJson } from '../src/services/ai.js';

test('aiEnabled is false when no provider configured (default)', () => {
  // With no AI_PROVIDER/AI_API_KEY in the test env, AI is off.
  assert.equal(aiEnabled(), false);
});

test('triage throws when AI not configured (caller falls back to rules)', async () => {
  await assert.rejects(() => triage('some text'), /not configured/i);
});

test('coerceResult clamps priority and sanitizes tag', () => {
  const out = coerceResult({ summary: 'x'.repeat(500), tag: 'Sev-1 Incident!', priority: 'CRITICAL' });
  assert.equal(out.priority, 'low'); // unknown priority -> low
  assert.ok(out.summary.length <= 300);
  assert.match(out.tag, /^[a-z0-9_-]+$/);
});

test('coerceResult accepts valid priorities and category alias', () => {
  const out = coerceResult({ summary: 'db outage', category: 'incident', priority: 'high' });
  assert.equal(out.priority, 'high');
  assert.equal(out.tag, 'incident');
});

test('extractJson pulls a JSON object out of noisy model output', () => {
  const obj = extractJson('Sure! Here you go:\n```json\n{"summary":"a","tag":"bug","priority":"medium"}\n```');
  assert.equal(obj.tag, 'bug');
});

test('extractJson throws when there is no JSON', () => {
  assert.throws(() => extractJson('no json here'));
});
