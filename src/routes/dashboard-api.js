// Authenticated JSON API that powers the dashboard.
import express from 'express';
import { config } from '../config.js';
import { requireAuth } from '../auth/middleware.js';
import {
  listInteractions,
  listActions,
  listGuilds,
  getGuild,
  upsertGuild,
  updateGuildConfig,
  getInteraction,
  statsForGuild,
} from '../db/repo.js';
import { defaultConfig, getCommandConfig } from '../services/rules.js';
import { retryReportDelivery } from '../commands/report.js';
import { buildInviteUrl, listBotGuilds, listGuildTextChannels } from '../discord/api.js';
import { aiEnabled } from '../services/ai.js';
import { logger } from '../util/logger.js';

export const dashboardRouter = express.Router();
dashboardRouter.use(requireAuth);
dashboardRouter.use(express.json());

// Never leak a Slack webhook URL to the client. Discord channel ids are not
// secret, so those can be shown.
function sanitizeGuild(g) {
  if (!g) return null;
  return {
    id: g.id,
    name: g.name,
    connected_at: g.connected_at,
    post_channel_id: g.post_channel_id,
    mirror_type: g.mirror_type,
    mirror_configured: !!g.mirror_target,
    mirror_target_display:
      g.mirror_type === 'discord' ? g.mirror_target : g.mirror_target ? 'configured (hidden)' : '',
    config: g.config || {},
  };
}

function interactionsEndpoint(req) {
  if (config.publicBaseUrl) return `${config.publicBaseUrl.replace(/\/$/, '')}/api/interactions`;
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${req.get('host')}/api/interactions`;
}

// --- Overview ---
dashboardRouter.get('/overview', async (req, res) => {
  try {
    const guilds = await listGuilds();
    const withStats = await Promise.all(
      guilds.map(async (g) => ({ ...sanitizeGuild(g), stats: await statsForGuild(g.id) }))
    );
    res.json({
      admin: req.admin,
      interactionsEndpoint: interactionsEndpoint(req),
      inviteUrl: buildInviteUrl(),
      aiProvider: config.ai.provider,
      aiEnabled: aiEnabled(),
      guilds: withStats,
    });
  } catch (err) {
    logger.error('overview_error', { error: String(err.message || err) });
    res.status(500).json({ error: 'failed to load overview' });
  }
});

// --- Command log (live) ---
dashboardRouter.get('/interactions', async (req, res) => {
  try {
    const rows = await listInteractions({
      guildId: req.query.guildId || undefined,
      status: req.query.status || undefined,
      limit: Number(req.query.limit) || 100,
    });
    res.json({ interactions: rows });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// --- Per-interaction action log ---
dashboardRouter.get('/interactions/:id/actions', async (req, res) => {
  try {
    const actions = await listActions({ interactionId: req.params.id });
    res.json({ actions });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// --- Retry a failed report's downstream delivery ---
dashboardRouter.post('/interactions/:id/retry', async (req, res) => {
  try {
    const row = await getInteraction(req.params.id);
    if (!row) return res.status(404).json({ error: 'not found' });
    if (row.command_name !== 'report') return res.status(400).json({ error: 'only reports can be retried' });
    const guild = row.guild_id ? await getGuild(row.guild_id) : null;
    const status = await retryReportDelivery(row, guild);
    res.json({ ok: true, status });
  } catch (err) {
    logger.error('retry_error', { error: String(err.message || err) });
    res.status(500).json({ error: String(err.message || err) });
  }
});

// --- Guild config (merged view for editing) ---
dashboardRouter.get('/guilds/:id/config', async (req, res) => {
  try {
    const g = await getGuild(req.params.id);
    if (!g) return res.status(404).json({ error: 'guild not found' });
    const stored = g.config || {};
    // Present the effective config (defaults merged) so the UI has all fields.
    const effective = {
      commands: {
        status: getCommandConfig(stored, 'status'),
        report: getCommandConfig(stored, 'report'),
      },
    };
    res.json({ guild: sanitizeGuild(g), stored, effective, defaults: defaultConfig() });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

dashboardRouter.put('/guilds/:id/config', async (req, res) => {
  try {
    const g = await getGuild(req.params.id);
    if (!g) return res.status(404).json({ error: 'guild not found' });
    const incoming = req.body && req.body.config;
    if (!incoming || typeof incoming !== 'object') {
      return res.status(400).json({ error: 'config object required' });
    }
    const updated = await updateGuildConfig(req.params.id, incoming);
    res.json({ ok: true, guild: sanitizeGuild(updated) });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// --- Onboarding: connect a server / pick channels / set mirror ---
dashboardRouter.post('/guilds/:id/connect', async (req, res) => {
  try {
    const { name, postChannelId, mirrorType, mirrorTarget } = req.body || {};
    if (mirrorType && !['none', 'discord', 'slack'].includes(mirrorType)) {
      return res.status(400).json({ error: 'invalid mirrorType' });
    }
    const updated = await upsertGuild({
      id: req.params.id,
      name,
      postChannelId,
      mirrorType,
      // Empty string clears; undefined leaves as-is (handled by COALESCE upstream).
      mirrorTarget: mirrorTarget === '' ? null : mirrorTarget,
    });
    res.json({ ok: true, guild: sanitizeGuild(updated) });
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

// --- Discord discovery for the onboarding UI ---
dashboardRouter.get('/discord/invite-url', (req, res) => {
  res.json({ url: buildInviteUrl() });
});

dashboardRouter.get('/discord/guilds', async (req, res) => {
  try {
    const [botGuilds, known] = await Promise.all([listBotGuilds(), listGuilds()]);
    const knownIds = new Set(known.map((g) => g.id));
    res.json({
      guilds: (botGuilds || []).map((g) => ({ id: g.id, name: g.name, connected: knownIds.has(g.id) })),
    });
  } catch (err) {
    logger.error('discord_guilds_error', { error: String(err.message || err) });
    res.status(502).json({ error: 'could not reach Discord — check the bot token' });
  }
});

dashboardRouter.get('/discord/guilds/:id/channels', async (req, res) => {
  try {
    const channels = await listGuildTextChannels(req.params.id);
    res.json({ channels });
  } catch (err) {
    logger.error('discord_channels_error', { error: String(err.message || err) });
    res.status(502).json({ error: 'could not list channels — is the bot in that server?' });
  }
});
