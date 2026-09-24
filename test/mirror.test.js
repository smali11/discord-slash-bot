import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverMirror } from '../src/services/mirror.js';

test('mirror is skipped when type is none', async () => {
  const res = await deliverMirror({ mirror_type: 'none', mirror_target: '' }, { title: 't', lines: [] });
  assert.equal(res.skipped, true);
});

test('slack mirror posts to the webhook and succeeds on 200', async () => {
  const orig = globalThis.fetch;
  let calledUrl = null;
  let calledBody = null;
  globalThis.fetch = async (url, opts) => {
    calledUrl = url;
    calledBody = JSON.parse(opts.body);
    return { ok: true, status: 200, text: async () => 'ok' };
  };
  try {
    const res = await deliverMirror(
      { mirror_type: 'slack', mirror_target: 'https://hooks.slack.com/services/XXX' },
      { title: 'Hello', lines: ['line1', 'line2'] }
    );
    assert.equal(res.skipped, false);
    assert.equal(res.target, 'slack');
    assert.equal(calledUrl, 'https://hooks.slack.com/services/XXX');
    assert.match(calledBody.text, /Hello/);
    assert.match(calledBody.text, /line1/);
  } finally {
    globalThis.fetch = orig;
  }
});

test('slack mirror throws on non-2xx (so caller can retry)', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500, text: async () => 'boom' });
  try {
    await assert.rejects(
      () => deliverMirror({ mirror_type: 'slack', mirror_target: 'https://x' }, { title: 't', lines: [] }),
      /Slack webhook 500/
    );
  } finally {
    globalThis.fetch = orig;
  }
});
