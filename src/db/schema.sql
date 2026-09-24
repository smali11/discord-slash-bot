-- Schema for the Discord Slash-Command Bot.
-- Safe to run repeatedly (idempotent). Run via `npm run init-db`.

CREATE TABLE IF NOT EXISTS guilds (
  id             text PRIMARY KEY,                 -- Discord guild (server) id
  name           text,
  connected_at   timestamptz NOT NULL DEFAULT now(),
  post_channel_id text,                            -- channel the bot posts/replies to
  mirror_type    text NOT NULL DEFAULT 'none',     -- 'none' | 'discord' | 'slack'
  mirror_target  text,                             -- discord channel id OR slack webhook url (server-side only)
  config         jsonb NOT NULL DEFAULT '{}'::jsonb, -- per-command config + rules
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS interactions (
  id            text PRIMARY KEY,                  -- Discord interaction id — the dedup key
  guild_id      text,
  channel_id    text,
  type          integer,                           -- Discord interaction type
  command_name  text,                              -- 'report' | 'status' | component custom_id
  user_id       text,
  username      text,
  input         text,                              -- command text / component context
  status        text NOT NULL DEFAULT 'received',  -- received|processing|completed|failed|duplicate
  result        jsonb,                             -- ai summary/tag/priority, response, etc.
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_interactions_guild_created ON interactions (guild_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_interactions_status       ON interactions (status);

CREATE TABLE IF NOT EXISTS action_logs (
  id             bigserial PRIMARY KEY,
  interaction_id text,
  guild_id       text,
  step           text,                             -- signature|record|ai|discord_reply|mirror|component|retry
  status         text,                             -- success|failed|skipped
  attempts       integer NOT NULL DEFAULT 1,
  detail         jsonb,
  error          text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_action_logs_interaction ON action_logs (interaction_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_created     ON action_logs (created_at DESC);
