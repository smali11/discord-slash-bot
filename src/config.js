// Central config. Reads from process.env only — never hard-code secrets.
// On Vercel, env vars are injected. Locally, local-server.js loads .env via dotenv
// before importing anything that reads this module.

function bool(v, def = false) {
  if (v === undefined) return def;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function int(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export const config = {
  nodeEnv: process.env.NODE_ENV || 'development',
  // On Vercel the platform sets VERCEL=1; used to pick the background-work strategy.
  isVercel: bool(process.env.VERCEL, false),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',

  discord: {
    applicationId: process.env.DISCORD_APPLICATION_ID || '',
    publicKey: process.env.DISCORD_PUBLIC_KEY || '',
    botToken: process.env.DISCORD_BOT_TOKEN || '',
    // Default invite permissions: View Channels + Send Messages (+ embed links, read history).
    // 3072 = VIEW_CHANNEL(1024) + SEND_MESSAGES(2048). We add a bit more for usability.
    invitePermissions: process.env.DISCORD_INVITE_PERMISSIONS || '277025508352',
    apiBase: 'https://discord.com/api/v10',
  },

  database: {
    url: process.env.DATABASE_URL || '',
    // Neon/Supabase require SSL. `pg` needs rejectUnauthorized:false for their default certs.
    ssl: bool(process.env.DATABASE_SSL, true),
  },

  auth: {
    sessionSecret: process.env.SESSION_SECRET || '',
    sessionTtlSeconds: int(process.env.SESSION_TTL_SECONDS, 60 * 60 * 12), // 12h
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPasswordHash: process.env.ADMIN_PASSWORD_HASH || '',
    adminPassword: process.env.ADMIN_PASSWORD || '', // fallback for quick start; hash is preferred
    cookieName: 'dsb_session',
  },

  security: {
    // Reject requests whose signed timestamp is older than this (replay guard).
    signatureMaxAgeSeconds: int(process.env.SIGNATURE_MAX_AGE_SECONDS, 300),
  },

  ai: {
    provider: (process.env.AI_PROVIDER || 'none').toLowerCase(), // gemini | groq | none
    apiKey: process.env.AI_API_KEY || '',
    model: process.env.AI_MODEL || '',
    timeoutMs: int(process.env.AI_TIMEOUT_MS, 8000),
  },

  mirror: {
    // Per-guild mirror config lives in the DB. These are optional global fallbacks
    // used only if a guild has not configured its own mirror.
    defaultSlackWebhook: process.env.DEFAULT_SLACK_WEBHOOK_URL || '',
  },
};

// Validate the vars the server cannot run without. Called by app startup, not by tests.
export function assertConfig() {
  const missing = [];
  const need = {
    DISCORD_APPLICATION_ID: config.discord.applicationId,
    DISCORD_PUBLIC_KEY: config.discord.publicKey,
    DISCORD_BOT_TOKEN: config.discord.botToken,
    DATABASE_URL: config.database.url,
    SESSION_SECRET: config.auth.sessionSecret,
  };
  for (const [k, v] of Object.entries(need)) if (!v) missing.push(k);
  if (!config.auth.adminPasswordHash && !config.auth.adminPassword) {
    missing.push('ADMIN_PASSWORD_HASH (or ADMIN_PASSWORD)');
  }
  if (missing.length) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        `See .env.example.`
    );
  }
  if (config.auth.sessionSecret && config.auth.sessionSecret.length < 16) {
    throw new Error('SESSION_SECRET should be a long random string (>= 16 chars).');
  }
}
