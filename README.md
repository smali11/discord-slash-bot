# Discord Slash-Command Bot

A small but real full-stack product: a deployed web app + a Discord bot that
reacts to slash commands, records every interaction, applies configurable rules,
replies in Discord, mirrors a notification to a second channel, and shows a
live, login-gated dashboard.

It is built to run **unattended**: it verifies Discord's Ed25519 signature on
every request, de-duplicates redelivered interactions, respects the ~3-second
response window (defer + background follow-up), retries transient downstream
failures, and never loses an interaction silently — failures are recorded and
retryable from the dashboard.

---

## What it does

1. **Admin signs in** to the web app and connects it to a Discord server — adds
   the bot (OAuth2 invite) and picks the channel it posts to plus a mirror
   target (a Slack Incoming Webhook **or** a second Discord channel).
2. **Users run slash commands** in Discord:
   - `/status` — a fast command; replies immediately with activity stats.
   - `/report <text>` — a slow command; deferred, then triaged, recorded,
     replied to with an embed + an **Acknowledge** button, posted to the
     configured channel, and mirrored to the second channel.
3. **Each interaction is processed** at the interactions endpoint: signature
   verified → deduped → recorded → rule/AI triage → responded → mirrored, with
   every step logged.
4. **The dashboard** (behind login) shows a live log of every command and the
   actions taken, lets the admin retry failed deliveries, and edit per-command
   configuration (rules, toggles) live.

### Slash commands

| Command | Type | Behavior |
|---|---|---|
| `/status` | fast, inline reply | Bot status + per-server counts (total, reports, completed, failed, last activity). |
| `/report <text>` | deferred + follow-up | Triage → record → reply with embed + Acknowledge button → post to channel → mirror to 2nd channel. |

---

## Tech stack

- **Runtime/API:** Node.js 20+, Express (ESM).
- **Hosting:** Vercel (serverless). Background work after the deferral is kept
  alive with `@vercel/functions` `waitUntil`; `maxDuration` is 60s.
- **Database:** Postgres (Neon or Supabase) via `pg`.
- **Crypto:** `tweetnacl` for Ed25519 verification.
- **Auth:** single admin account; `jsonwebtoken` session in an httpOnly cookie;
  `bcryptjs` password hashing.
- **AI (optional stretch):** Google Gemini (AI Studio) or Groq — free tiers.
- **Dashboard:** static HTML/CSS + vanilla JS (no build step) served by Express.

---

## How it meets the quality bar

| Requirement | How |
|---|---|
| **Not foolable by forged/replayed requests** | Ed25519 verification over the exact raw body + timestamp on every request (`src/discord/verify.js`), 401 on failure. PING answered correctly. Stale timestamps rejected (replay window), and duplicate interaction ids are deduped. |
| **No double-processing** | `interactions.id` is the primary key; `recordInteraction` does `INSERT … ON CONFLICT (id) DO NOTHING`. A duplicate delivery returns a benign ack and does **not** reprocess. |
| **No silent loss on downstream outage** | Every downstream call is retried with backoff (`withRetry`). If it still fails, the interaction is marked `failed` with the failing step captured in `action_logs`, surfaced in the dashboard, and **retryable**. |
| **Respects the ~3s window** | `/report` returns a deferred ack (type 5) immediately; the real work runs in the background (`waitUntil`) and edits the reply via `PATCH …/@original`. |
| **Never exposes secrets** | Bot token, public key, and mirror URLs live only in env / server-side DB. The dashboard API masks Slack webhook URLs. The logger redacts sensitive keys. `.gitignore` excludes `.env`. |

---

## Repository structure

```
api/index.js              Vercel entrypoint (exports the Express app)
local-server.js           Local dev server (adds a listener)
vercel.json               Rewrites all routes to the function; maxDuration 60s
src/
  config.js               Env loading + validation
  app.js                  Express app assembly (route ordering matters)
  discord/
    verify.js             Ed25519 verification + timestamp freshness (replay guard)
    interactions.js       Router: PING/PONG, dedup, command + component dispatch
    api.js                Discord REST helpers (guilds, channels, post, edit)
    constants.js          Interaction/response type constants
  commands/
    status.js             /status (fast, inline)
    report.js             /report (defer, triage, reply, post, mirror, retry, ack)
  services/
    rules.js              Configurable keyword rule engine (+ defaults)
    ai.js                 Gemini/Groq triage with graceful fallback
    mirror.js             Slack webhook / Discord channel mirror
  auth/
    session.js            JWT + password verification + cookies
    middleware.js         requireAuth
    routes.js             /login /logout /me
  routes/
    interactions.js       POST /api/interactions (raw body + verify)
    dashboard-api.js      Authenticated dashboard + onboarding API
  db/
    schema.sql            Tables: guilds, interactions, action_logs
    pool.js               pg pool (Neon/Supabase SSL)
    repo.js               All queries incl. the dedup primitive
  util/
    logger.js             Structured JSON logs with redaction
    background.js         waitUntil wrapper + withRetry
public/                   Dashboard UI (login.html, dashboard.html, app.js, styles.css)
scripts/
  init-db.js              Apply schema.sql
  register-commands.js    Register /status and /report
  hash-password.js        Generate ADMIN_PASSWORD_HASH
test/                     node:test suites (verify, rules, ai, mirror, dedup)
```

---

## Run it locally

### Prerequisites
- Node.js 20+
- A Postgres database URL (Neon/Supabase free tier, or a local Postgres)
- A Discord application (see the deploy guide for how to create one) — only
  needed to actually receive interactions; the tests and dashboard run without it.

### Steps

```bash
# 1. Install
npm install

# 2. Configure
cp .env.example .env
# then fill in .env (see the variables table below)

# 3. Create the tables
npm run init-db

# 4. (Optional but recommended) hash your admin password
npm run hash-password -- 'your-admin-password'
# paste the printed ADMIN_PASSWORD_HASH into .env, remove ADMIN_PASSWORD

# 5. Register the slash commands (guild-scoped registration appears instantly)
npm run register -- <YOUR_TEST_GUILD_ID>
#   or, for all servers:  npm run register

# 6. Start the app
npm run dev
#   Dashboard:             http://localhost:3000/
#   Interactions endpoint: http://localhost:3000/api/interactions
```

Discord must reach your interactions endpoint over HTTPS — it can’t call
`localhost`. For local testing, expose it with a tunnel and paste the public URL
into the Developer Portal:

```bash
npx localtunnel --port 3000      # or: ngrok http 3000
```

### Run the tests

```bash
npm test
```

The suite covers signature verification (valid / forged / tampered / stale /
malformed), the rule engine, AI coercion + fallback, and the mirror service.
The dedup + action-log tests run automatically when `DATABASE_URL` is set
(otherwise they’re skipped):

```bash
DATABASE_URL=postgres://… DATABASE_SSL=true npm test
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `DISCORD_APPLICATION_ID` | ✅ | Application ID (also the OAuth client id for the invite link). |
| `DISCORD_PUBLIC_KEY` | ✅ | Ed25519 public key used to verify request signatures. |
| `DISCORD_BOT_TOKEN` | ✅ | Bot token (server-side only). |
| `DISCORD_INVITE_PERMISSIONS` | | Override the invite permission integer. |
| `DATABASE_URL` | ✅ | Postgres connection string (Neon/Supabase). |
| `DATABASE_SSL` | | `true` (default) for Neon/Supabase; `false` for local. |
| `ADMIN_USERNAME` | | Admin login (default `admin`). |
| `ADMIN_PASSWORD_HASH` | ✅* | bcrypt hash of the admin password (recommended). |
| `ADMIN_PASSWORD` | ✅* | Plaintext fallback if no hash is set. |
| `SESSION_SECRET` | ✅ | Long random string for signing session cookies. |
| `SIGNATURE_MAX_AGE_SECONDS` | | Replay window (default 300). |
| `AI_PROVIDER` | | `gemini` \| `groq` \| `none` (default `none`). |
| `AI_API_KEY` | | Free API key for the chosen provider. |
| `AI_MODEL` | | Optional model override. |
| `PUBLIC_BASE_URL` | | Deployed URL, used to display the endpoint + invite link. |
| `DEFAULT_SLACK_WEBHOOK_URL` | | Optional global mirror fallback. |

\* Provide either `ADMIN_PASSWORD_HASH` (preferred) or `ADMIN_PASSWORD`.

A full annotated template is in [`.env.example`](./.env.example).

---

## Deploy it (free, no credit card)

See **[DEPLOY.md](./DEPLOY.md)** for the full click-by-click walkthrough:
create the Discord application, provision Neon Postgres, deploy to Vercel, set
the Interactions Endpoint URL, register the commands, and connect a server. The
short version:

1. **Discord Developer Portal** → New Application → copy Application ID + Public
   Key → Bot → copy token.
2. **Neon** → new project → copy the pooled connection string → set as
   `DATABASE_URL`.
3. **Vercel** → import the GitHub repo → add all env vars → deploy → note the
   URL.
4. Run `npm run init-db` and `npm run register` (pointed at prod env).
5. In the Portal, set **Interactions Endpoint URL** to
   `https://<your-app>.vercel.app/api/interactions` (Discord sends a PING to
   validate — the app answers it).
6. Open the deployed dashboard, log in, **Add bot to a server**, then connect it
   and pick the post channel + mirror.
7. Run `/status` and `/report something is down` in Discord and watch the
   dashboard.

---

## Security notes

- Secrets never appear in the repo, client code, or logs. The logger redacts
  known-sensitive keys; the dashboard API masks Slack webhook URLs.
- The interactions route parses the **raw** body so verification runs over the
  exact bytes Discord signed (re-stringifying parsed JSON would break it).
- All dashboard/onboarding routes are behind `requireAuth`.
- Timestamp freshness + interaction-id dedup together close the replay window.
