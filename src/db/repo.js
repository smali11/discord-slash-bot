// Data access layer. Keeps SQL in one place; the rest of the app calls these.
import { query } from './pool.js';

// ---------------- Guilds ----------------

export async function upsertGuild({ id, name, postChannelId, mirrorType, mirrorTarget }) {
  const { rows } = await query(
    `INSERT INTO guilds (id, name, post_channel_id, mirror_type, mirror_target, updated_at)
     VALUES ($1, $2, $3, COALESCE($4,'none'), $5, now())
     ON CONFLICT (id) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, guilds.name),
       post_channel_id = COALESCE(EXCLUDED.post_channel_id, guilds.post_channel_id),
       mirror_type = COALESCE(EXCLUDED.mirror_type, guilds.mirror_type),
       mirror_target = COALESCE(EXCLUDED.mirror_target, guilds.mirror_target),
       updated_at = now()
     RETURNING *`,
    [id, name || null, postChannelId || null, mirrorType || null, mirrorTarget || null]
  );
  return rows[0];
}

export async function getGuild(id) {
  const { rows } = await query(`SELECT * FROM guilds WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function listGuilds() {
  const { rows } = await query(`SELECT * FROM guilds ORDER BY connected_at DESC`);
  return rows;
}

export async function updateGuildConfig(id, config) {
  const { rows } = await query(
    `UPDATE guilds SET config = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(config)]
  );
  return rows[0] || null;
}

// ---------------- Interactions (dedup) ----------------

/**
 * Attempt to record a newly-arrived interaction. Returns:
 *   { inserted: true, row }  — first time we've seen this interaction id
 *   { inserted: false, row } — duplicate delivery (row is the existing record)
 * This is the atomic dedup primitive: the PRIMARY KEY on id guarantees only one
 * insert wins even under concurrent duplicate deliveries.
 */
export async function recordInteraction(i) {
  const { rows } = await query(
    `INSERT INTO interactions
       (id, guild_id, channel_id, type, command_name, user_id, username, input, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'received')
     ON CONFLICT (id) DO NOTHING
     RETURNING *`,
    [i.id, i.guildId || null, i.channelId || null, i.type, i.commandName || null,
     i.userId || null, i.username || null, i.input || null]
  );
  if (rows[0]) return { inserted: true, row: rows[0] };
  const existing = await getInteraction(i.id);
  return { inserted: false, row: existing };
}

export async function getInteraction(id) {
  const { rows } = await query(`SELECT * FROM interactions WHERE id = $1`, [id]);
  return rows[0] || null;
}

export async function setInteractionStatus(id, status, { result, error } = {}) {
  const { rows } = await query(
    `UPDATE interactions
        SET status = $2,
            result = COALESCE($3::jsonb, result),
            error  = $4,
            updated_at = now()
      WHERE id = $1
      RETURNING *`,
    [id, status, result === undefined ? null : JSON.stringify(result), error || null]
  );
  return rows[0] || null;
}

export async function listInteractions({ guildId, status, limit = 100, sinceId } = {}) {
  const where = [];
  const params = [];
  if (guildId) { params.push(guildId); where.push(`guild_id = $${params.length}`); }
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  params.push(Math.min(limit, 500));
  const limitClause = `$${params.length}`;
  const sql =
    `SELECT * FROM interactions
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY created_at DESC
     LIMIT ${limitClause}`;
  const { rows } = await query(sql, params);
  return rows;
}

// ---------------- Action logs ----------------

export async function logAction({ interactionId, guildId, step, status, attempts = 1, detail, error }) {
  const { rows } = await query(
    `INSERT INTO action_logs (interaction_id, guild_id, step, status, attempts, detail, error)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
     RETURNING *`,
    [interactionId || null, guildId || null, step, status, attempts,
     detail === undefined ? null : JSON.stringify(detail), error || null]
  );
  return rows[0];
}

export async function listActions({ interactionId, guildId, limit = 200 } = {}) {
  const where = [];
  const params = [];
  if (interactionId) { params.push(interactionId); where.push(`interaction_id = $${params.length}`); }
  if (guildId) { params.push(guildId); where.push(`guild_id = $${params.length}`); }
  params.push(Math.min(limit, 1000));
  const sql =
    `SELECT * FROM action_logs
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY created_at DESC
     LIMIT $${params.length}`;
  const { rows } = await query(sql, params);
  return rows;
}

// Interactions that ended in failure — surfaced in the dashboard for retry.
export async function listFailed({ guildId, limit = 100 } = {}) {
  return listInteractions({ guildId, status: 'failed', limit });
}

// Quick stats for the /status command and the dashboard header.
export async function statsForGuild(guildId) {
  const { rows } = await query(
    `SELECT
        count(*)                                            AS total,
        count(*) FILTER (WHERE status = 'completed')        AS completed,
        count(*) FILTER (WHERE status = 'failed')           AS failed,
        count(*) FILTER (WHERE command_name = 'report')     AS reports,
        max(created_at)                                     AS last_at
     FROM interactions
     WHERE guild_id = $1`,
    [guildId]
  );
  const r = rows[0] || {};
  return {
    total: Number(r.total || 0),
    completed: Number(r.completed || 0),
    failed: Number(r.failed || 0),
    reports: Number(r.reports || 0),
    lastAt: r.last_at || null,
  };
}
