// requireAuth — gate for all dashboard API routes. Reads the session cookie,
// verifies the JWT, and either attaches req.admin or returns 401.

import { readTokenFromRequest, verifyToken } from './session.js';

export function requireAuth(req, res, next) {
  const token = readTokenFromRequest(req);
  const payload = token ? verifyToken(token) : null;
  if (!payload || payload.role !== 'admin') {
    return res.status(401).json({ error: 'unauthorized' });
  }
  req.admin = { username: payload.sub };
  next();
}
