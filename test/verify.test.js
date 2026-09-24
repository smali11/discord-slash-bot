// Security-critical tests: the Ed25519 signature check is what keeps forged and
// replayed requests out. We generate a real keypair, sign as Discord would
// (timestamp + raw body), and assert valid/forged/tampered/stale all behave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import { verifySignature, isTimestampFresh } from '../src/discord/verify.js';

function makeSigned(bodyObj, keyPair, timestamp = String(Math.floor(Date.now() / 1000))) {
  const body = Buffer.from(JSON.stringify(bodyObj), 'utf8');
  const message = Buffer.concat([Buffer.from(timestamp), body]);
  const signature = Buffer.from(nacl.sign.detached(Uint8Array.from(message), keyPair.secretKey)).toString('hex');
  const publicKey = Buffer.from(keyPair.publicKey).toString('hex');
  return { body, timestamp, signature, publicKey };
}

test('accepts a correctly signed request', () => {
  const kp = nacl.sign.keyPair();
  const { body, timestamp, signature, publicKey } = makeSigned({ type: 1 }, kp);
  assert.equal(verifySignature(body, signature, timestamp, publicKey), true);
});

test('rejects a tampered body', () => {
  const kp = nacl.sign.keyPair();
  const { timestamp, signature, publicKey } = makeSigned({ type: 1 }, kp);
  const tampered = Buffer.from(JSON.stringify({ type: 2 }), 'utf8');
  assert.equal(verifySignature(tampered, signature, timestamp, publicKey), false);
});

test('rejects a tampered timestamp (replay of body with new time)', () => {
  const kp = nacl.sign.keyPair();
  const { body, signature, publicKey } = makeSigned({ type: 1 }, kp);
  assert.equal(verifySignature(body, signature, '9999999999', publicKey), false);
});

test('rejects a signature from a different key', () => {
  const kp = nacl.sign.keyPair();
  const other = nacl.sign.keyPair();
  const { body, timestamp, signature } = makeSigned({ type: 1 }, kp);
  const wrongKey = Buffer.from(other.publicKey).toString('hex');
  assert.equal(verifySignature(body, signature, timestamp, wrongKey), false);
});

test('rejects malformed hex inputs without throwing', () => {
  const kp = nacl.sign.keyPair();
  const { body, timestamp, publicKey } = makeSigned({ type: 1 }, kp);
  assert.equal(verifySignature(body, 'not-hex', timestamp, publicKey), false);
  assert.equal(verifySignature(body, 'abcd', timestamp, publicKey), false); // wrong length
  assert.equal(verifySignature(body, '00', timestamp, 'zz'), false);
  assert.equal(verifySignature(body, '', timestamp, publicKey), false);
});

test('rejects missing pieces', () => {
  assert.equal(verifySignature(null, 'aa', '1', 'bb'), false);
  assert.equal(verifySignature(Buffer.from('x'), '', '1', 'bb'), false);
});

test('timestamp freshness: fresh passes, stale fails, far-future fails', () => {
  const now = 1_000_000;
  assert.equal(isTimestampFresh(String(now), 300, now), true);
  assert.equal(isTimestampFresh(String(now - 100), 300, now), true);
  assert.equal(isTimestampFresh(String(now - 301), 300, now), false); // too old
  assert.equal(isTimestampFresh(String(now + 60), 300, now), false); // too far future
  assert.equal(isTimestampFresh('not-a-number', 300, now), false);
});
