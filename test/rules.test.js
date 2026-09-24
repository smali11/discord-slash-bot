import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRules, getCommandConfig, defaultConfig } from '../src/services/rules.js';

const reportCfg = defaultConfig().commands.report;

test('matches a keyword and assigns its label + priority', () => {
  const r = applyRules('the API is down for everyone', reportCfg);
  assert.equal(r.label, 'incident');
  assert.equal(r.priority, 'high');
  assert.ok(r.matched.includes('down'));
  assert.equal(r.source, 'rules');
});

test('highest-priority rule wins when several match', () => {
  // "bug" (medium) + "urgent" (high) -> urgent wins
  const r = applyRules('urgent bug in checkout', reportCfg);
  assert.equal(r.priority, 'high');
  assert.equal(r.label, 'urgent');
  assert.deepEqual(new Set(r.matched), new Set(['urgent', 'bug']));
});

test('falls back to defaults when nothing matches', () => {
  const r = applyRules('just saying hello', reportCfg);
  assert.equal(r.label, 'general');
  assert.equal(r.priority, 'low');
  assert.deepEqual(r.matched, []);
});

test('is case-insensitive', () => {
  const r = applyRules('SECURITY incident!!!', reportCfg);
  assert.equal(r.label, 'security');
  assert.equal(r.priority, 'high');
});

test('getCommandConfig merges guild overrides over defaults', () => {
  const merged = getCommandConfig({ commands: { report: { useAI: false } } }, 'report');
  assert.equal(merged.useAI, false);
  assert.equal(merged.postToChannel, true); // default preserved
  assert.ok(Array.isArray(merged.rules)); // default rules preserved
});

test('custom rules from config are honored', () => {
  const cfg = { rules: [{ keyword: 'refund', label: 'billing', priority: 'medium' }], defaultLabel: 'x', defaultPriority: 'low' };
  const r = applyRules('please process my refund', cfg);
  assert.equal(r.label, 'billing');
  assert.equal(r.priority, 'medium');
});
