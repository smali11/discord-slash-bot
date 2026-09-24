// /report <text> — a SLOW command. We defer immediately (type 5, within the 3s
// window) and finish the work in the background: triage (AI with rule fallback),
// durably record the result, edit the deferred reply with an embed + an
// "Acknowledge" button, post to the configured channel, and mirror a
// notification to the second channel. Every downstream step is retried and
// logged so nothing is silently lost; failures are surfaced for dashboard retry.

import {
  InteractionResponseType,
  MessageFlags,
  ComponentType,
  ButtonStyle,
} from '../discord/constants.js';
import { editOriginalInteractionResponse, postChannelMessage } from '../discord/api.js';
import { setInteractionStatus, logAction, getInteraction } from '../db/repo.js';
import { applyRules } from '../services/rules.js';
import { triage, aiEnabled } from '../services/ai.js';
import { deliverMirror } from '../services/mirror.js';
import { withRetry } from '../util/background.js';
import { logger } from '../util/logger.js';

const PRIORITY_COLOR = { high: 0xed4245, medium: 0xe67e22, low: 0x57f287 };
const PRIORITY_EMOJI = { high: '🔴', medium: '🟠', low: '🟢' };

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// The immediate acknowledgement Discord requires within ~3 seconds.
export function buildDeferredAck(cmdConfig) {
  return {
    type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
    data: { flags: cmdConfig.ephemeralAck ? MessageFlags.EPHEMERAL : 0 },
  };
}

function buildEmbed(result, { username, text, acknowledgedBy }) {
  const fields = [
    { name: 'Priority', value: `${PRIORITY_EMOJI[result.priority] || ''} ${result.priority}`, inline: true },
    { name: 'Tag', value: '`' + result.tag + '`', inline: true },
    { name: 'Triaged by', value: result.source === 'ai' ? `AI (${result.provider})` : 'rules', inline: true },
  ];
  if (result.matched && result.matched.length) {
    fields.push({ name: 'Matched rules', value: result.matched.map((m) => '`' + m + '`').join(' '), inline: false });
  }
  if (acknowledgedBy) {
    fields.push({ name: 'Acknowledged', value: `by ${acknowledgedBy}`, inline: false });
  }
  return {
    title: `📝 Report: ${truncate(result.summary || text, 120)}`,
    description: truncate(text, 1000),
    color: PRIORITY_COLOR[result.priority] || 0x5865f2,
    fields,
    footer: { text: `Reported by ${username || 'unknown'}` },
    timestamp: new Date().toISOString(),
  };
}

function buildComponents(reportId, { disabled = false } = {}) {
  return [
    {
      type: ComponentType.ACTION_ROW,
      components: [
        {
          type: ComponentType.BUTTON,
          style: ButtonStyle.SUCCESS,
          label: disabled ? 'Acknowledged' : 'Acknowledge',
          custom_id: `ack:${reportId}`,
          disabled,
        },
      ],
    },
  ];
}

// ------------- background processing -------------

export async function processReport({ interaction, guild, cmdConfig }) {
  const id = interaction.id;
  const text = interaction.input || '';
  const guildId = interaction.guildId;

  await setInteractionStatus(id, 'processing');

  // 1) Deterministic baseline (also the fallback if AI is off/broken).
  const rules = applyRules(text, cmdConfig);

  // 2) Optional AI triage.
  let ai = null;
  if (cmdConfig.useAI && aiEnabled()) {
    try {
      ai = await triage(text);
      await logAction({ interactionId: id, guildId, step: 'ai', status: 'success', detail: { tag: ai.tag, priority: ai.priority, provider: ai.provider } });
    } catch (err) {
      await logAction({ interactionId: id, guildId, step: 'ai', status: 'failed', error: String(err.message || err) });
      logger.warn('ai_triage_failed_falling_back', { interactionId: id, error: String(err.message || err) });
    }
  } else {
    await logAction({ interactionId: id, guildId, step: 'ai', status: 'skipped', detail: { reason: cmdConfig.useAI ? 'no_provider' : 'disabled' } });
  }

  const result = {
    summary: ai?.summary || truncate(text, 200),
    tag: ai?.tag || rules.label,
    priority: ai?.priority || rules.priority,
    source: ai ? 'ai' : 'rules',
    provider: ai?.provider || null,
    matched: rules.matched,
  };

  // Persist the triage result immediately — before any downstream call — so the
  // record survives even if Discord/mirror is momentarily unavailable.
  await setInteractionStatus(id, 'processing', { result });

  const failedSteps = [];
  const delivered = {};

  // 3) Edit the deferred reply with the embed + Acknowledge button.
  // Small guard: on serverless the deferred ack and this background work run
  // concurrently, so give Discord a moment to register the deferral before we
  // PATCH @original (withRetry also covers a transient 404 if this races).
  await new Promise((r) => setTimeout(r, 400));
  try {
    await withRetry(
      () =>
        editOriginalInteractionResponse(interaction.token, {
          content: `Report logged and triaged as **${result.priority}** priority.`,
          embeds: [buildEmbed(result, { username: interaction.username, text })],
          components: buildComponents(id),
        }),
      { attempts: 3, label: 'discord_reply' }
    );
    await logAction({ interactionId: id, guildId, step: 'discord_reply', status: 'success' });
    delivered.reply = true;
  } catch (err) {
    await logAction({ interactionId: id, guildId, step: 'discord_reply', status: 'failed', attempts: 3, error: String(err.message || err) });
    failedSteps.push('discord_reply');
  }

  // 4) Post to the configured channel (skip if it's the same channel the reply
  //    already landed in, to avoid duplicates).
  if (cmdConfig.postToChannel && guild?.post_channel_id && guild.post_channel_id !== interaction.channelId) {
    try {
      await withRetry(
        () => postChannelMessage(guild.post_channel_id, { embeds: [buildEmbed(result, { username: interaction.username, text })] }),
        { attempts: 3, label: 'channel_post' }
      );
      await logAction({ interactionId: id, guildId, step: 'channel_post', status: 'success', detail: { channel: guild.post_channel_id } });
      delivered.channelPost = true;
    } catch (err) {
      await logAction({ interactionId: id, guildId, step: 'channel_post', status: 'failed', attempts: 3, error: String(err.message || err) });
      failedSteps.push('channel_post');
    }
  } else {
    await logAction({ interactionId: id, guildId, step: 'channel_post', status: 'skipped' });
  }

  // 5) Mirror a notification to the second channel.
  if (cmdConfig.mirror) {
    await runMirror({ id, guildId, guild, result, interaction, failedSteps, delivered });
  } else {
    await logAction({ interactionId: id, guildId, step: 'mirror', status: 'skipped' });
  }

  const finalStatus = failedSteps.length ? 'failed' : 'completed';
  await setInteractionStatus(id, finalStatus, {
    result: { ...result, delivered, failedSteps },
    error: failedSteps.length ? `Failed steps: ${failedSteps.join(', ')}` : null,
  });

  logger.info('report_processed', { interactionId: id, status: finalStatus, priority: result.priority, source: result.source });
}

async function runMirror({ id, guildId, guild, result, interaction, failedSteps, delivered }) {
  try {
    const res = await withRetry(
      () =>
        deliverMirror(guild, {
          title: `🔔 New ${result.priority.toUpperCase()} report [${result.tag}]`,
          lines: [
            `> ${truncate(result.summary, 240)}`,
            `From: ${interaction.username || 'unknown'} · Server: ${guild?.name || guildId}`,
          ],
        }),
      { attempts: 3, label: 'mirror' }
    );
    await logAction({ interactionId: id, guildId, step: 'mirror', status: res.skipped ? 'skipped' : 'success', detail: { target: res.target } });
    delivered.mirror = !res.skipped;
  } catch (err) {
    await logAction({ interactionId: id, guildId, step: 'mirror', status: 'failed', attempts: 3, error: String(err.message || err) });
    failedSteps.push('mirror');
  }
}

// ------------- retry (from dashboard) -------------
// Re-runs the token-independent downstream steps (channel post + mirror). The
// deferred reply uses the interaction token which expires ~15 min, so it is not
// retried here; the record and the notification are what matter later.
export async function retryReportDelivery(interactionRow, guild) {
  const id = interactionRow.id;
  const guildId = interactionRow.guild_id;
  const result = interactionRow.result || {};
  const cmdConfigFailed = new Set((result.failedSteps) || []);
  const failedSteps = [];
  const delivered = { ...(result.delivered || {}) };

  await logAction({ interactionId: id, guildId, step: 'retry', status: 'success', detail: { steps: [...cmdConfigFailed] } });

  const fakeInteraction = { username: interactionRow.username, channelId: interactionRow.channel_id };

  if (cmdConfigFailed.has('channel_post') && guild?.post_channel_id) {
    try {
      await withRetry(
        () => postChannelMessage(guild.post_channel_id, { embeds: [buildEmbed(result, { username: interactionRow.username, text: interactionRow.input })] }),
        { attempts: 3, label: 'channel_post_retry' }
      );
      await logAction({ interactionId: id, guildId, step: 'channel_post', status: 'success', detail: { retry: true } });
      delivered.channelPost = true;
    } catch (err) {
      await logAction({ interactionId: id, guildId, step: 'channel_post', status: 'failed', error: String(err.message || err) });
      failedSteps.push('channel_post');
    }
  }

  if (cmdConfigFailed.has('mirror')) {
    await runMirror({ id, guildId, guild, result, interaction: fakeInteraction, failedSteps, delivered });
  }

  const finalStatus = failedSteps.length ? 'failed' : 'completed';
  await setInteractionStatus(id, finalStatus, {
    result: { ...result, delivered, failedSteps },
    error: failedSteps.length ? `Failed steps: ${failedSteps.join(', ')}` : null,
  });
  return finalStatus;
}

// ------------- button (Acknowledge) handler -------------
// A second interaction type (MESSAGE_COMPONENT) that we also verify. Fast enough
// to answer inline with UPDATE_MESSAGE (type 7).
export async function handleAcknowledge({ component, reportId }) {
  const ackBy = component.username;
  try {
    const report = await getInteraction(reportId);
    if (report) {
      const result = { ...(report.result || {}), acknowledgedBy: ackBy, acknowledgedAt: new Date().toISOString() };
      await setInteractionStatus(reportId, report.status === 'failed' ? 'failed' : 'completed', { result });
    }
    await logAction({ interactionId: reportId, guildId: component.guildId, step: 'component', status: 'success', detail: { action: 'acknowledge', by: ackBy } });
  } catch (err) {
    await logAction({ interactionId: reportId, guildId: component.guildId, step: 'component', status: 'failed', error: String(err.message || err) });
  }

  // Edit the message the button is on: append acknowledgement + disable button.
  const msg = component.message || {};
  const embeds = Array.isArray(msg.embeds) ? msg.embeds.slice(0, 1) : [];
  if (embeds[0]) {
    embeds[0].fields = [...(embeds[0].fields || []), { name: 'Acknowledged', value: `by ${ackBy}`, inline: false }];
  }
  return {
    type: InteractionResponseType.UPDATE_MESSAGE,
    data: {
      embeds,
      components: buildComponents(reportId, { disabled: true }),
    },
  };
}
