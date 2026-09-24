// Thin wrapper over the Discord REST API. All calls use the bot token, which
// stays server-side. Errors throw with a descriptive message so callers can
// retry or record a failure.

import { config } from '../config.js';
import { logger } from '../util/logger.js';

const BASE = config.discord.apiBase;

async function discordFetch(path, { method = 'GET', body, auth = true, absolute = false } = {}) {
  const url = absolute ? path : `${BASE}${path}`;
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = `Bot ${config.discord.botToken}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* ignore */
    }
    // Never log the token; discordFetch headers are not logged.
    logger.warn('discord_api_error', { path, status: res.status });
    const err = new Error(`Discord API ${method} ${path} -> ${res.status} ${detail.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// --- Interaction responses / follow-ups (uses interaction token, no bot auth needed) ---

// Edit the original (deferred) response after slow work completes.
export function editOriginalInteractionResponse(interactionToken, payload) {
  const appId = config.discord.applicationId;
  return discordFetch(`/webhooks/${appId}/${interactionToken}/messages/@original`, {
    method: 'PATCH',
    body: payload,
    auth: false,
  });
}

// Send an additional follow-up message on an interaction.
export function createFollowupMessage(interactionToken, payload) {
  const appId = config.discord.applicationId;
  return discordFetch(`/webhooks/${appId}/${interactionToken}`, {
    method: 'POST',
    body: payload,
    auth: false,
  });
}

// --- Channel messages (bot token) ---

export function postChannelMessage(channelId, payload) {
  return discordFetch(`/channels/${channelId}/messages`, { method: 'POST', body: payload });
}

// --- Onboarding helpers: discover where the bot can act ---

// Guilds the bot is a member of.
export function listBotGuilds() {
  return discordFetch('/users/@me/guilds');
}

// Text channels in a guild the bot can see.
export async function listGuildTextChannels(guildId) {
  const channels = await discordFetch(`/guilds/${guildId}/channels`);
  // type 0 = GUILD_TEXT, 5 = GUILD_ANNOUNCEMENT (both accept messages)
  return (channels || [])
    .filter((c) => c.type === 0 || c.type === 5)
    .map((c) => ({ id: c.id, name: c.name, position: c.position }))
    .sort((a, b) => a.position - b.position);
}

// The OAuth2 URL an admin visits to add the bot to a server.
export function buildInviteUrl() {
  const params = new URLSearchParams({
    client_id: config.discord.applicationId,
    scope: 'bot applications.commands',
    permissions: config.discord.invitePermissions,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}
