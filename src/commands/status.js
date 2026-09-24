// /status — a FAST command. Answers immediately (within the 3s window) with a
// short summary of activity for this server. No deferral, no downstream calls.

import { InteractionResponseType, MessageFlags } from '../discord/constants.js';
import { statsForGuild } from '../db/repo.js';

export async function handleStatus({ guildId }, cmdConfig) {
  let stats = { total: 0, completed: 0, failed: 0, reports: 0, lastAt: null };
  try {
    if (guildId) stats = await statsForGuild(guildId);
  } catch {
    // If stats fail we still answer — /status must never hang.
  }

  const last = stats.lastAt ? `<t:${Math.floor(new Date(stats.lastAt).getTime() / 1000)}:R>` : 'never';
  const content =
    `**Bot status: online** ✅\n` +
    `• Commands processed: **${stats.total}** (${stats.reports} reports)\n` +
    `• Completed: **${stats.completed}** · Failed: **${stats.failed}**\n` +
    `• Last activity: ${last}`;

  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: {
      content,
      flags: cmdConfig.ephemeral ? MessageFlags.EPHEMERAL : 0,
    },
  };
}
