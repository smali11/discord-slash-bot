// Local development server. Loads .env, then starts the Express app with a
// listener. On Vercel this file is not used (api/index.js is the entrypoint).
import 'dotenv/config';
import { app } from './src/app.js';
import { assertConfig } from './src/config.js';

const port = process.env.PORT || 3000;

try {
  assertConfig();
} catch (err) {
  console.error('\n[config] ' + err.message + '\n');
  console.error('Copy .env.example to .env and fill it in before starting.\n');
  // Still start so /api/health can report the problem, but warn loudly.
}

app.listen(port, () => {
  console.log(`\n  Discord Slash-Command Bot listening on http://localhost:${port}`);
  console.log(`  Dashboard:            http://localhost:${port}/`);
  console.log(`  Interactions endpoint: http://localhost:${port}/api/interactions`);
  console.log(`  (expose it with a tunnel, e.g. 'npx localtunnel --port ${port}' or ngrok)\n`);
});
