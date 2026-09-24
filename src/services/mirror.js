// Mirrors a notification to a SECOND channel — either a Slack Incoming Webhook
// or a separate Discord channel — per the guild's config. One attempt per call;
// the caller wraps this in withRetry() and records success/failure so a brief
// downstream outage doesn't silently lose the notification.

import { postChannelMessage } from '../discord/api.js';

/**
 * @param {object} guild - guild row: { mirror_type, mirror_target }
 * @param {object} msg - { title, lines: string[] }
 * @returns {{skipped:boolean, target:string}} on success
 * @throws on delivery failure
 */
export async function deliverMirror(guild, msg) {
  const type = guild?.mirror_type || 'none';
  const target = guild?.mirror_target || '';

  if (type === 'none' || !target) return { skipped: true, target: type };

  const text = [msg.title, ...(msg.lines || [])].filter(Boolean).join('\n');

  if (type === 'slack') {
    const res = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Slack webhook ${res.status} ${body.slice(0, 200)}`);
    }
    return { skipped: false, target: 'slack' };
  }

  if (type === 'discord') {
    await postChannelMessage(target, { content: text.slice(0, 1900) });
    return { skipped: false, target: 'discord' };
  }

  throw new Error(`Unknown mirror type: ${type}`);
}
