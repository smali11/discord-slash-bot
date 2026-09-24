// Ed25519 request-signature verification for Discord interactions.
//
// Discord signs every request with Ed25519. The signed message is the exact
// bytes of (X-Signature-Timestamp header) concatenated with the raw request
// body. We verify against the application's Public Key. If verification fails
// we MUST reject with 401 — Discord itself will refuse to register an endpoint
// that doesn't, and forged/replayed junk must never reach our logic.
//
// This module holds only pure, dependency-light functions so they are trivially
// unit-testable (see test/verify.test.js).

import nacl from 'tweetnacl';

const HEX_RE = /^[0-9a-fA-F]+$/;

function hexToBytes(hex) {
  if (typeof hex !== 'string' || hex.length === 0 || hex.length % 2 !== 0 || !HEX_RE.test(hex)) {
    return null;
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/**
 * Verify a Discord interaction signature.
 * @param {Buffer|Uint8Array} rawBody - the exact raw request body bytes
 * @param {string} signature - X-Signature-Ed25519 header (hex)
 * @param {string} timestamp - X-Signature-Timestamp header
 * @param {string} publicKey - application public key (hex)
 * @returns {boolean}
 */
export function verifySignature(rawBody, signature, timestamp, publicKey) {
  if (!rawBody || !signature || !timestamp || !publicKey) return false;

  const sigBytes = hexToBytes(signature);
  const keyBytes = hexToBytes(publicKey);
  if (!sigBytes || !keyBytes) return false;
  // Ed25519: 64-byte signature, 32-byte public key. Reject anything malformed
  // before handing it to nacl (which would otherwise throw).
  if (sigBytes.length !== 64 || keyBytes.length !== 32) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const message = Buffer.concat([Buffer.from(String(timestamp), 'utf8'), body]);

  try {
    return nacl.sign.detached.verify(
      Uint8Array.from(message),
      sigBytes,
      keyBytes
    );
  } catch {
    return false;
  }
}

/**
 * Replay guard: the signature covers the timestamp, so an attacker cannot forge
 * a fresh one, but they *could* replay a previously-valid request verbatim.
 * Rejecting stale timestamps shrinks that window; duplicate-interaction dedup
 * (in the DB) closes it entirely for anything that slips through.
 * @returns {boolean} true if the timestamp is within the allowed age.
 */
export function isTimestampFresh(timestamp, maxAgeSeconds, nowSeconds = Math.floor(Date.now() / 1000)) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const age = nowSeconds - ts;
  // Allow a little clock skew into the future (30s); reject anything too old.
  if (age > maxAgeSeconds) return false;
  if (age < -30) return false;
  return true;
}
