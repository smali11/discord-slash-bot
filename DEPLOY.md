# Deployment guide

Everything here is free and needs **no credit card**. Estimated time: ~20–30
minutes. You'll end with a live URL, a bot in a server, and a working dashboard.

Order matters a little: create the external accounts first, deploy, then point
Discord at the deployed URL.

---

## 0. Push the code to GitHub

```bash
cd discord-slash-bot
git init
git add .
git commit -m "Discord slash-command bot"
gh repo create discord-slash-bot --private --source=. --push
# or create a repo on github.com and: git remote add origin <url> && git push -u origin main
```

---

## 1. Create the Discord application + bot

1. Go to <https://discord.com/developers/applications> → **New Application** →
   name it → **Create**.
2. **General Information** tab:
   - Copy **Application ID** → this is `DISCORD_APPLICATION_ID`.
   - Copy **Public Key** → this is `DISCORD_PUBLIC_KEY`.
3. **Bot** tab → **Reset Token** → copy it → this is `DISCORD_BOT_TOKEN`
   (treat it like a password).
   - Under **Privileged Gateway Intents** you don't need any for interactions.
4. Leave the Interactions Endpoint URL blank for now — you'll set it in step 5,
   after the app is deployed.

You'll also need a **test server**. Any free personal Discord server works
(server list → **+** → Create My Own). Enable Developer Mode
(User Settings → Advanced) so you can right-click → **Copy Server ID** when you
need your guild id.

---

## 2. Provision a free Postgres (Neon)

1. Go to <https://neon.tech> → sign up (GitHub login, no card) → **Create
   project**.
2. On the project dashboard, copy the **connection string** (use the
   **Pooled connection**). It looks like:
   `postgresql://user:pass@ep-xxxx-pooler.region.aws.neon.tech/neondb?sslmode=require`
3. That's your `DATABASE_URL`. Keep `DATABASE_SSL=true`.

*(Supabase works too: Project Settings → Database → Connection string → URI.)*

---

## 3. Deploy to Vercel

1. Go to <https://vercel.com> → sign up with GitHub (no card) → **Add New… →
   Project** → import your `discord-slash-bot` repo.
2. Framework preset: **Other** (it's a plain Node/Express function; `vercel.json`
   already routes everything to `api/index.js`). No build command needed.
3. **Environment Variables** — add all of these (Production):

   | Key | Value |
   |---|---|
   | `DISCORD_APPLICATION_ID` | from step 1 |
   | `DISCORD_PUBLIC_KEY` | from step 1 |
   | `DISCORD_BOT_TOKEN` | from step 1 |
   | `DATABASE_URL` | from step 2 |
   | `DATABASE_SSL` | `true` |
   | `ADMIN_USERNAME` | e.g. `admin` |
   | `ADMIN_PASSWORD_HASH` | run `npm run hash-password -- 'yourpass'` locally and paste |
   | `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
   | `AI_PROVIDER` | `gemini` or `groq` or `none` |
   | `AI_API_KEY` | your free key (if using AI) |
   | `PUBLIC_BASE_URL` | your Vercel URL (add after first deploy, then redeploy) |

4. **Deploy**. Note the URL, e.g. `https://discord-slash-bot.vercel.app`.
5. (Optional) set `PUBLIC_BASE_URL` to that URL and redeploy so the dashboard
   shows the exact endpoint + invite link.

Sanity check: open `https://<your-app>.vercel.app/api/health` → you should see
`{"ok":true,"configOk":true}`.

---

## 4. Create the tables + register commands

Run these from your machine with the **production** env values (easiest: put
them in a local `.env`, or prefix inline):

```bash
# create the tables in your Neon DB
DATABASE_URL='postgres://…neon…?sslmode=require' DATABASE_SSL=true npm run init-db

# register the two slash commands (guild-scoped = appears instantly)
DISCORD_APPLICATION_ID='…' DISCORD_BOT_TOKEN='…' npm run register -- <YOUR_TEST_GUILD_ID>
```

Global registration (`npm run register` with no guild id) makes the commands
available in every server the bot joins, but can take up to an hour to appear
the first time — use guild-scoped for testing.

---

## 5. Point Discord at your endpoint

1. Back in the Developer Portal → **General Information** → set
   **Interactions Endpoint URL** to:
   ```
   https://<your-app>.vercel.app/api/interactions
   ```
2. Click **Save Changes**. Discord immediately sends a signed **PING**; the app
   verifies the signature and replies **PONG**. If the key/URL are right, it
   saves. If it refuses, double-check `DISCORD_PUBLIC_KEY` and that
   `/api/health` shows `configOk:true`.

---

## 6. Add the bot + connect a server

1. Open `https://<your-app>.vercel.app/` and log in with your admin credentials.
2. Overview tab → **Add bot to a server** → authorize it into your test server.
3. Click **Load my servers** → pick your server → choose:
   - **Post channel** — where `/report` posts.
   - **Mirror type** — *Slack webhook* (paste an Incoming Webhook URL) or
     *Discord channel* (pick a second channel). Save.

### Getting a Slack Incoming Webhook (optional, for the mirror)
Slack → create an app at <https://api.slack.com/apps> → **Incoming Webhooks** →
activate → **Add New Webhook to Workspace** → pick a channel → copy the URL
(`https://hooks.slack.com/services/…`). Paste it as the mirror target.
*(Or just use a second Discord channel — no external setup.)*

---

## 7. Test it

In your Discord server:

```
/status
/report the checkout page is down, urgent
```

- `/status` replies instantly with counts.
- `/report` shows “thinking…”, then edits to an embed with a priority + tag and
  an **Acknowledge** button; a copy is posted to your configured channel; a
  notification appears in the mirror channel.
- The **dashboard → Command Log** shows both, live, with expandable per-step
  action logs. Click **Acknowledge** in Discord and watch the record update.

### Try the unhappy paths (this is the interesting part)
- Send junk to the endpoint — it's rejected with 401:
  ```bash
  curl -i -X POST https://<your-app>.vercel.app/api/interactions \
    -H 'Content-Type: application/json' -d '{"type":1}'
  # -> 401 invalid request signature   (no valid Ed25519 signature)
  ```
- Temporarily break the mirror (e.g. a bad Slack URL) and run `/report` → the
  row shows **failed** with the mirror step captured → fix the URL → click
  **Retry** in the dashboard → it goes green.
