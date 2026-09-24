// Minimal structured logger. Emits one JSON object per line so logs are
// grep-/parse-able in Vercel's log viewer. Never log secrets — callers pass
// only safe fields, and we defensively redact a few known-sensitive keys.

const REDACT = new Set([
  'token',
  'botToken',
  'authorization',
  'password',
  'apiKey',
  'api_key',
  'signature',
  'webhook',
  'webhookUrl',
  'mirror_target',
]);

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    if (REDACT.has(k)) out[k] = '[redacted]';
    else if (v && typeof v === 'object') out[k] = redact(v);
    else out[k] = v;
  }
  return out;
}

function emit(level, msg, fields) {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...(fields ? redact(fields) : {}),
  };
  const s = JSON.stringify(line);
  if (level === 'error') console.error(s);
  else if (level === 'warn') console.warn(s);
  else console.log(s);
}

export const logger = {
  info: (msg, fields) => emit('info', msg, fields),
  warn: (msg, fields) => emit('warn', msg, fields),
  error: (msg, fields) => emit('error', msg, fields),
  debug: (msg, fields) => {
    if (process.env.LOG_LEVEL === 'debug') emit('debug', msg, fields);
  },
};
