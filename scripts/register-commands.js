// Registers the slash commands with Discord.
//
// Usage:
//   npm run register                 -> registers GLOBALLY (available in every
//                                       server the bot joins; can take up to 1h
//                                       to appear the first time)
//   npm run register -- <GUILD_ID>   -> registers to one guild (appears INSTANTLY;
//                                       great for testing). Or set REGISTER_GUILD_ID.
import 'dotenv/config';

const APP_ID = process.env.DISCORD_APPLICATION_ID;
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const guildId = process.argv[2] || process.env.REGISTER_GUILD_ID || '';

if (!APP_ID || !TOKEN) {
  console.error('✗ DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN must be set (see .env.example).');
  process.exit(1);
}

// STRING option type = 3.
const commands = [
  {
    name: 'status',
    description: 'Show bot status and activity for this server',
    type: 1,
  },
  {
    name: 'report',
    description: 'File a report — it gets triaged, logged, and mirrored',
    type: 1,
    options: [
      {
        name: 'text',
        description: 'What happened?',
        type: 3,
        required: true,
      },
    ],
  },
];

const url = guildId
  ? `https://discord.com/api/v10/applications/${APP_ID}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${APP_ID}/commands`;

const res = await fetch(url, {
  method: 'PUT', // bulk overwrite
  headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(commands),
});

if (!res.ok) {
  console.error(`✗ Registration failed: ${res.status}`);
  console.error(await res.text());
  process.exit(1);
}

const data = await res.json();
console.log(
  `✓ Registered ${data.length} command(s) ${guildId ? `to guild ${guildId} (instant)` : 'globally (may take up to 1h the first time)'}:`
);
for (const c of data) console.log(`  /${c.name}`);
