// Session + credential helpers. The dashboard is protected by a single admin
// account whose credentials live in env (hashed password recommended). On login
// we issue a signed JWT stored in an httpOnly cookie.

import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { serialize, parse } from 'cookie';
import { config } from '../config.js';

// Constant-time string compare (for the plaintext fallback path).
function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    // Still do a compare to keep timing roughly constant.
    crypto.timingSafeEqual(ba, ba);
    return false;
  }
  return crypto.timingSafeEqual(ba, bb);
}

export async function verifyCredentials(username, password) {
  if (!safeEqual(username, config.auth.adminUsername)) return false;
  if (config.auth.adminPasswordHash) {
    try {
      return await bcrypt.compare(String(password), config.auth.adminPasswordHash);
    } catch {
      return false;
    }
  }
  if (config.auth.adminPassword) {
    return safeEqual(password, config.auth.adminPassword);
  }
  return false;
}

export function issueToken(username) {
  return jwt.sign({ sub: username, role: 'admin' }, config.auth.sessionSecret, {
    expiresIn: config.auth.sessionTtlSeconds,
  });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, config.auth.sessionSecret);
  } catch {
    return null;
  }
}

export function sessionCookie(token) {
  return serialize(config.auth.cookieName, token, {
    httpOnly: true,
    secure: config.nodeEnv === 'production' || config.isVercel,
    sameSite: 'lax',
    path: '/',
    maxAge: config.auth.sessionTtlSeconds,
  });
}

export function clearCookie() {
  return serialize(config.auth.cookieName, '', {
    httpOnly: true,
    secure: config.nodeEnv === 'production' || config.isVercel,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export function readTokenFromRequest(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  const cookies = parse(header);
  return cookies[config.auth.cookieName] || null;
}
