# CLAUDE.md — AI context for this repo

Context and conventions for AI assistants (Claude Code, Cursor, etc.) working in
this repository. Keep this file current when architecture changes.

## What this is
A Discord slash-command bot: an Express app deployed on Vercel that receives
Discord interactions, records/triages/responds/mirrors them, and serves a
login-gated dashboard. Postgres (Neon/Supabase) for storage.

## Non-negotiable invariants
These encode the grading criteria — do not regress them:

1. **Verify every interaction request.** `src/routes/interactions.js` uses
   `express.raw` and `verifySignature` over `timestamp + rawBody`. Never parse
   JSON before verifying, and never verify against a re-stringified body — the
   bytes must be exactly what Discord signed. Reject with 401 on failure. Also
   reject stale timestamps (`isTimestampFresh`).
2. **Dedup on interaction id.** All persistence goes through
   `recordInteraction` (`INSERT … ON CONFLICT (id) DO NOTHING`). A duplicate
   delivery must return a benign ack and must NOT re-run side effects.
3. **Respect the 3s window.** Anything slow (AI, mirror, channel post) happens
   after a deferred ack (type 5), scheduled via `runBackground` (`waitUntil` on
   Vercel). `/status` stays inline (type 4).
4. **Never lose an interaction silently.** Downstream calls use `withRetry`.
   Persist the triage result BEFORE downstream calls. On final failure, set
   status `failed`, capture the failing step in `action_logs`, and keep it
   retryable (`retryReportDelivery`).
5. **Never expose secrets.** Bot token, public key, mirror URLs → env / DB only.
   `logger` redacts sensitive keys; dashboard API masks Slack webhooks. Never
   log request headers.

## Architecture map
- Entrypoints: `api/index.js` (Vercel) and `local-server.js` (local) both use
  `src/app.js`. Route order in `app.js` matters — the raw interactions route is
  mounted before any JSON body parsing.
- Interaction flow: `routes/interactions.js` (verify) →
  `discord/interactions.js` (dedup + dispatch) → `commands/*` → `services/*`.
- `commands/report.js` owns the whole slow pipeline incl. retry + the
  Acknowledge button (`handleAcknowledge`).
- `services/rules.js` is the configurable rule engine and the fallback when AI
  is off/fails. `services/ai.js` is optional and must fail soft.
- `db/repo.js` is the only place with SQL. `db/schema.sql` is the source of
  truth for tables.

## Conventions
- ESM everywhere (`"type": "module"`), Node 20+.
- Config only via `src/config.js` (reads `process.env`); never read env
  elsewhere. Add new vars there and to `.env.example`.
- Structured logs via `src/util/logger.js` (one JSON object per line).
- Keep the dashboard build-free (vanilla JS in `public/`) so Vercel deploy stays
  a single function with no build pipeline.
- Tests are `node:test` under `test/`. DB tests self-skip unless `DATABASE_URL`
  is set. Pure logic (verify, rules) must stay unit-testable — no hidden I/O.

## Gotchas
- Vercel auto-body-parsing: the interactions route must read the raw body via
  `express.raw`; do not add a global `express.json()`.
- `editOriginalInteractionResponse` uses the interaction token, which expires
  ~15 min. Immediate follow-up uses it; dashboard **retry** only re-runs the
  token-independent steps (channel post + mirror).
- `normalize()` in `discord/interactions.js` does NOT include the command text;
  pass `input` explicitly when handing an interaction to the background worker.

## Commands
- `npm run dev` — local server
- `npm test` — tests
- `npm run init-db` — apply schema
- `npm run register [-- <guildId>]` — register slash commands
- `npm run hash-password -- '<pw>'` — bcrypt hash for the admin password
