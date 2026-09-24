// POST /api/interactions — the Discord Interactions Endpoint.
//
// This route uses express.raw so we verify the signature over the EXACT bytes
// Discord signed (re-stringifying parsed JSON would change the bytes and break
// verification). Order is deliberate: verify signature -> check freshness ->
// parse -> dispatch. A forged, unsigned, or stale request is rejected with 401
// before any application logic runs.

import express from 'express';
import { config } from '../config.js';
import { verifySignature, isTimestampFresh } from '../discord/verify.js';
import { handleInteraction } from '../discord/interactions.js';
import { logger } from '../util/logger.js';

export const interactionsRouter = express.Router();

interactionsRouter.post(
  '/interactions',
  express.raw({ type: '*/*', limit: '256kb' }),
  async (req, res) => {
    const signature = req.get('X-Signature-Ed25519');
    const timestamp = req.get('X-Signature-Timestamp');
    const rawBody = req.body; // Buffer, thanks to express.raw

    // 1) Signature must be present and valid.
    if (!signature || !timestamp || !Buffer.isBuffer(rawBody)) {
      logger.warn('interaction_rejected', { reason: 'missing_signature_or_body' });
      return res.status(401).send('invalid request signature');
    }
    const valid = verifySignature(rawBody, signature, timestamp, config.discord.publicKey);
    if (!valid) {
      logger.warn('interaction_rejected', { reason: 'bad_signature' });
      return res.status(401).send('invalid request signature');
    }

    // 2) Replay guard: reject stale timestamps.
    if (!isTimestampFresh(timestamp, config.security.signatureMaxAgeSeconds)) {
      logger.warn('interaction_rejected', { reason: 'stale_timestamp', timestamp });
      return res.status(401).send('stale request');
    }

    // 3) Parse and dispatch.
    let interaction;
    try {
      interaction = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).send('invalid json');
    }

    try {
      const response = await handleInteraction(interaction);
      return res.status(200).json(response);
    } catch (err) {
      // Return 500 so Discord surfaces the failure (and may redeliver, which our
      // dedup handles) rather than silently dropping the interaction.
      logger.error('interaction_handler_error', { error: String(err && err.message || err), interactionId: interaction?.id });
      return res.status(500).json({ error: 'internal error' });
    }
  }
);
