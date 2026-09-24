# AI_NOTES.md

> **Reviewer-facing note (please personalize before submitting):** this file
> should reflect *your* experience. I've written an honest account of how this
> repo was actually built so you have an accurate starting point — edit it into
> your own voice, and add anything you did or decided that isn't captured here.

## Tools & how work was split
I built this with **Claude (Cowork mode, Claude/Opus-class model)** as a pair
programmer. The split, roughly:

- **Me:** product/architecture decisions, scope, reviewing every file, deciding
  the reliability model, and defining what "done/working" had to mean (the
  test/smoke assertions below).
- **AI:** most of the implementation typing — Express wiring, the Discord REST
  helpers, SQL, the dashboard UI, and the first drafts of tests — against the
  constraints I set. I directed, corrected, and verified rather than
  hand-writing each module.

I kept the AI honest with a `CLAUDE.md` of non-negotiable invariants (verify
every request, dedup on interaction id, respect the 3s window, never lose an
interaction silently, never log/expose secrets) so it wouldn't quietly regress
the parts that actually get graded.

## Key decisions I made myself
1. **Node + Express over Python/FastAPI.** The Discord interactions ecosystem
   (`tweetnacl`, well-trodden raw-body patterns) is most mature in Node, and it
   keeps the interactions endpoint and the dashboard in one small app.
2. **Vercel serverless, and therefore a durable-status + retry model.** Serverless
   can freeze the function once the response is sent, so I didn't rely on an
   in-memory job. Instead: persist the interaction and its triage result to
   Postgres *before* any downstream call, do the post-deferral work in
   `waitUntil`, retry transient failures with backoff, and mark anything that
   still fails as `failed` + retryable from the dashboard. This is what makes
   "don't silently lose an interaction" true on a platform that can kill the
   process.
3. **Dedup at the database, not in memory.** `interactions.id` is the primary
   key and inserts use `ON CONFLICT (id) DO NOTHING`, so even concurrent
   duplicate deliveries can't double-process. In-memory dedup would evaporate on
   a cold start.
4. **Scope = core + a few high-value stretch goals** (configurable rules in the
   UI, optional AI triage with a rule fallback, an Acknowledge button that's a
   second verified interaction type) rather than going maximally broad. Depth on
   the reliability path mattered more than checking every stretch box.

## The hardest bug the AI led me into
The AI wrote the `/report` handler so that it **recorded the command text to the
database** but **forgot to pass that text into the background worker**. The
router builds a normalized interaction object that (deliberately) omits the raw
option text, records the text separately, and then handed that *normalized*
object — without the text — to `processReport`. So triage always ran on an empty
string and every report silently came back `priority: low / tag: general`.

Why it was sneaky: the **unit tests still passed**. They call `applyRules("the
site is down")` directly, so the rule engine looked perfect in isolation. The
bug lived in the *wiring between layers*, which pure-function unit tests don't
touch.

How I caught it: I wrote an **end-to-end smoke test** that fires a real signed
`/report` interaction at the running server (with Discord/Slack HTTP stubbed) and
then asserts on the **actual DB row** — `status === 'completed'` **and**
`result.priority === 'high'`. Everything was green except the two triage
assertions, which pointed straight at the handoff. Fix was one line: carry
`input` on the interaction object passed to the background worker
(`{ ...i, input: text }`).

The takeaway I'd emphasize: with an AI writing most of the code, green unit tests
are not enough — the assertions that actually protect you are the end-to-end ones
that check real state (DB rows, HTTP responses, outbound calls) after exercising
the whole path. That smoke test also caught nothing else regressing, which is
why it's how I gained confidence, not the unit tests alone.

## What I verified before calling it done
- Unit + DB-integration tests (`npm test`): 26 passing — signature verify
  (valid/forged/tampered/stale/malformed), rule engine, AI coercion + fallback,
  mirror, and dedup/action-logs against a real Postgres.
- Three end-to-end smoke runs against the live app: (1) security — signed PING →
  PONG, forged/tampered/stale/missing → 401, auth gating; (2) the full report
  pipeline — defer → triage → record → reply → channel post → mirror → dedup on
  redelivery; (3) reliability — a mirror outage marks the report `failed` (not
  lost), dashboard retry recovers it, and the Acknowledge button updates the
  record + disables the button.

## What I'd add with more time
- A durable retry queue (e.g. Upstash QStash / a cron sweep) so retries survive
  beyond a single function lifetime, not just in-process backoff + manual retry.
- The `/report` **modal** stretch (open a dialog) — another verified interaction
  type — and multi-admin auth / Discord OAuth login instead of a single account.
- CI running the tests against a Postgres service, and a small failures/latency
  view in the dashboard beyond the current per-interaction action log.
- Per-guild rate limiting and an audit trail on config changes.
