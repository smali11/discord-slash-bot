// Runs slow follow-up work *after* we've already answered Discord within the
// 3-second window.
//
// On Vercel serverless, once the HTTP response is sent the function can be
// frozen/terminated — so we register the promise with `waitUntil`, which keeps
// the invocation alive until the work finishes (up to the function's maxDuration,
// set to 60s in vercel.json). Locally (a long-lived process) we just let the
// promise run.
//
// Either way the work is wrapped so a rejection can never crash the process or
// take down the request; durability/retry is handled by the DB status model,
// not by this helper.

import { logger } from './logger.js';

let waitUntil = null;
try {
  // Loaded lazily; absent in plain Node/test environments.
  ({ waitUntil } = await import('@vercel/functions'));
} catch {
  waitUntil = null;
}

export function runBackground(label, work) {
  const guarded = Promise.resolve()
    .then(work)
    .catch((err) => {
      logger.error('background_task_failed', { label, error: String(err && err.message || err) });
    });

  if (waitUntil) {
    try {
      waitUntil(guarded);
      return;
    } catch (err) {
      // waitUntil throws if called outside a request context; fall through.
      logger.warn('waitUntil_unavailable', { label, error: String(err && err.message || err) });
    }
  }
  // Local / non-Vercel: fire and forget (process stays alive).
  guarded;
}

// Small helper: retry an async op with exponential backoff. Used for downstream
// calls (mirror, Discord follow-up) so a *brief* outage doesn't lose the action.
export async function withRetry(fn, { attempts = 3, baseMs = 300, label = 'op' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const wait = baseMs * Math.pow(2, i);
      logger.warn('retrying', { label, attempt: i + 1, attempts, waitMs: wait, error: String(err && err.message || err) });
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
