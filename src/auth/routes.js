// Auth routes: login, logout, and "who am I".
import express from 'express';
import { verifyCredentials, issueToken, sessionCookie, clearCookie, readTokenFromRequest, verifyToken } from './session.js';
import { logger } from '../util/logger.js';

export const authRouter = express.Router();

authRouter.post('/login', express.json(), async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  const ok = await verifyCredentials(username, password);
  if (!ok) {
    logger.warn('login_failed', { username: String(username).slice(0, 40) });
    return res.status(401).json({ error: 'invalid credentials' });
  }
  const token = issueToken(username);
  res.setHeader('Set-Cookie', sessionCookie(token));
  logger.info('login_success', { username: String(username).slice(0, 40) });
  return res.json({ ok: true, username });
});

authRouter.post('/logout', (req, res) => {
  res.setHeader('Set-Cookie', clearCookie());
  return res.json({ ok: true });
});

authRouter.get('/me', (req, res) => {
  const token = readTokenFromRequest(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload) return res.status(401).json({ error: 'unauthorized' });
  return res.json({ username: payload.sub, role: payload.role });
});
