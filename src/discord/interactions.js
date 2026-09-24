// Central interaction router. Given a *verified*, parsed interaction, decides
// what to do and returns the JSON response Discord should receive. Slow work is
// scheduled in the background so we always answer within the 3s window.

import { InteractionType, InteractionResponseType } from './constants.js';
import { recordInteraction, getGuild, upsertGuild, logAction } from '../db/repo.js';
import { getCommandConfig } from '../services/rules.js';
import { handleStatus } from '../commands/status.js';
import { buildDeferredAck, processReport, handleAcknowledge } from '../commands/report.js';
import { runBackground } from '../util/background.js';
import { logger } from '../util/logger.js';

// Normalize the parts of the payload we use, tolerating DM vs guild shapes.
function normalize(interaction) {
  const user = interaction.member?.user || interaction.user || {};
  return {
    id: interaction.id,
    type: interaction.type,
    token: interaction.token,
    guildId: interaction.guild_id || interaction.guild?.id || null,
    guildName: interaction.guild?.name || null,
    channelId: interaction.channel_id || interaction.channel?.id || null,
    userId: user.id || null,
    username: user.global_name || user.username || null,
    data: interaction.data || {},
    message: interaction.message || null,
  };
}

function getOption(data, name) {
  const opt = (data.options || []).find((o) => o.name === name);
  return opt ? opt.value : null;
}

export async function handleInteraction(rawInteraction) {
  const i = normalize(rawInteraction);

  // 1) PING — answer PONG. Discord sends this to validate the endpoint.
  if (i.type === InteractionType.PING) {
    return { type: InteractionResponseType.PONG };
  }

  // 2) Slash commands.
  if (i.type === InteractionType.APPLICATION_COMMAND) {
    const name = i.data.name;
    const text = getOption(i.data, 'text');

    const dedup = await recordInteraction({
      id: i.id,
      guildId: i.guildId,
      channelId: i.channelId,
      type: i.type,
      commandName: name,
      userId: i.userId,
      username: i.username,
      input: text,
    });

    // Ensure the guild exists in our records (so it shows in the dashboard even
    // before formal onboarding), and load its config.
    let guild = null;
    if (i.guildId) {
      guild = await getGuild(i.guildId);
      if (!guild) guild = await upsertGuild({ id: i.guildId, name: i.guildName });
    }
    const guildConfig = (guild && guild.config) || {};

    // Duplicate delivery: do NOT reprocess. Return a benign, idempotent ack.
    if (!dedup.inserted) {
      await logAction({ interactionId: i.id, guildId: i.guildId, step: 'record', status: 'skipped', detail: { reason: 'duplicate' } });
      logger.warn('duplicate_interaction', { interactionId: i.id, command: name });
      if (name === 'report') return buildDeferredAck(getCommandConfig(guildConfig, 'report'));
      return handleStatus(i, getCommandConfig(guildConfig, 'status'));
    }

    await logAction({ interactionId: i.id, guildId: i.guildId, step: 'record', status: 'success', detail: { command: name } });

    if (name === 'status') {
      const cfg = getCommandConfig(guildConfig, 'status');
      if (cfg.enabled === false) {
        return replyEphemeral('The `/status` command is disabled for this server.');
      }
      return handleStatus(i, cfg);
    }

    if (name === 'report') {
      const cfg = getCommandConfig(guildConfig, 'report');
      if (cfg.enabled === false) {
        return replyEphemeral('The `/report` command is disabled for this server.');
      }
      if (!text || !text.trim()) {
        return replyEphemeral('Please include some text: `/report <what happened>`.');
      }
      // Defer now, finish in the background. Carry the command text on the
      // interaction object (normalize() doesn't include it).
      const reportInteraction = { ...i, input: text };
      runBackground('processReport', () => processReport({ interaction: reportInteraction, guild, cmdConfig: cfg }));
      return buildDeferredAck(cfg);
    }

    // Unknown command.
    return replyEphemeral(`Unknown command: \`/${name}\`.`);
  }

  // 3) Message components (buttons) — the Acknowledge button on a report.
  if (i.type === InteractionType.MESSAGE_COMPONENT) {
    const customId = i.data.custom_id || '';

    const dedup = await recordInteraction({
      id: i.id,
      guildId: i.guildId,
      channelId: i.channelId,
      type: i.type,
      commandName: customId,
      userId: i.userId,
      username: i.username,
      input: customId,
    });
    if (!dedup.inserted) {
      logger.warn('duplicate_component', { interactionId: i.id, customId });
      return { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE };
    }

    if (customId.startsWith('ack:')) {
      const reportId = customId.slice(4);
      return handleAcknowledge({ component: i, reportId });
    }

    return { type: InteractionResponseType.DEFERRED_UPDATE_MESSAGE };
  }

  // 4) Anything else (autocomplete, modal submit) — acknowledge harmlessly.
  logger.warn('unhandled_interaction_type', { type: i.type });
  return replyEphemeral('This interaction type is not supported.');
}

function replyEphemeral(content) {
  return {
    type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
    data: { content, flags: 1 << 6 },
  };
}
