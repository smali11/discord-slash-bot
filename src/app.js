// Express app assembly. This module exports the app; api/index.js adapts it for
// Vercel and local-server.js runs it with a listener.
//
// Route ordering matters: the interactions endpoint uses a RAW body parser and
// must be mounted before anything that parses JSON globally. We never call
// express.json() app-wide for that reason — each router opts in.

import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertConfig } from './config.js';
import { logger } from './util/logger.js';
import { interactionsRouter } from './routes/interactions.js';
import { authRouter } from './auth/routes.js';
import { dashboardRouter } from './routes/dashboard-api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');

let configError = null;
try {
  assertConfig();
} catch (err) {
  configError = err.message;
  logger.error('config_incomplete', { error: err.message });
}

export function createApp() {
  const app = express();
  app.set('trust proxy', true);
  app.disable('x-powered-by');

  // Health / readiness.
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, configOk: !configError, configError: configError || undefined });
  });

  // Discord interactions (raw body) — mount first.
  app.use('/api', interactionsRouter);

  // Auth + dashboard API.
  app.use('/api/auth', authRouter);
  app.use('/api', dashboardRouter);

  // Static dashboard assets.
  app.use(express.static(publicDir, { index: false, extensions: ['html'] }));
  app.get('/', (req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
  app.get('/login', (req, res) => res.sendFile(path.join(publicDir, 'login.html')));

  // JSON 404 for unknown API routes; otherwise fall back to the dashboard shell.
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
    return res.status(404).sendFile(path.join(publicDir, 'login.html'));
  });

  return app;
}

export const app = createApp();
