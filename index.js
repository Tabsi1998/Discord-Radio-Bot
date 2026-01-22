const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ytdl = require("ytdl-core");
const express = require("express");
const session = require("express-session");
const Database = require("better-sqlite3");
const { Client, GatewayIntentBits, ChannelType } = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");
const ffmpegPath = require("ffmpeg-static");

const configPath = path.join(__dirname, "config.json");
const fileConfig = fs.existsSync(configPath) ? require(configPath) : {};

const config = {
  token: process.env.DISCORD_TOKEN || fileConfig.token,
  clientId: process.env.DISCORD_CLIENT_ID || fileConfig.clientId,
  clientSecret: process.env.DISCORD_CLIENT_SECRET || fileConfig.clientSecret,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || fileConfig.publicBaseUrl,
  sessionSecret: process.env.SESSION_SECRET || fileConfig.sessionSecret,
  port: Number(process.env.PORT || fileConfig.port || 3000),
};

if (!config.token || !config.clientId || !config.clientSecret) {
  console.error("config.json needs token, clientId, clientSecret.");
  process.exit(1);
}
if (!config.publicBaseUrl || !config.sessionSecret) {
  console.error("config.json needs publicBaseUrl and sessionSecret.");
  process.exit(1);
}

const DISCORD_API = "https://discord.com/api";
const MANAGE_GUILD = 0x20n;
const BOT_PERMISSIONS = 3145728;

const db = new Database(path.join(__dirname, "data.sqlite"));
db.exec(`
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    voice_channel_id TEXT,
    stream_url TEXT,
    auto_play INTEGER DEFAULT 0,
    updated_at INTEGER
  );
`);

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const guildStates = new Map();

function saveGuildSettings(guildId, voiceChannelId, streamUrl, autoPlay) {
  const stmt = db.prepare(`
    INSERT INTO guild_settings (guild_id, voice_channel_id, stream_url, auto_play, updated_at)
    VALUES (@guildId, @voiceChannelId, @streamUrl, @autoPlay, @updatedAt)
    ON CONFLICT(guild_id) DO UPDATE SET
      voice_channel_id = excluded.voice_channel_id,
      stream_url = excluded.stream_url,
      auto_play = excluded.auto_play,
      updated_at = excluded.updated_at;
  `);
  stmt.run({
    guildId,
    voiceChannelId,
    streamUrl,
    autoPlay,
    updatedAt: Date.now(),
  });
}

function getGuildSettings(guildId) {
  return db.prepare(`
    SELECT guild_id, voice_channel_id, stream_url, auto_play
    FROM guild_settings WHERE guild_id = ?
  `).get(guildId);
}

function listAutoPlaySettings() {
  return db.prepare(`
    SELECT guild_id, voice_channel_id, stream_url, auto_play
    FROM guild_settings
    WHERE auto_play = 1 AND voice_channel_id IS NOT NULL AND stream_url IS NOT NULL
  `).all();
}

function getGuildState(guildId) {
  if (!guildStates.has(guildId)) {
    const player = createAudioPlayer();
    const state = {
      player,
      connection: null,
      ffmpegProcess: null,
      currentUrl: null,
    };

    player.on(AudioPlayerStatus.Idle, () => {
      if (state.currentUrl) {
        setTimeout(() => play(guildId, state.currentUrl), 2_000);
      }
    });

    player.on("error", (err) => {
      console.error(`Audio error [${guildId}]:`, err.message);
      if (state.currentUrl) {
        setTimeout(() => play(guildId, state.currentUrl), 2_000);
      }
    });

    guildStates.set(guildId, state);
  }
  return guildStates.get(guildId);
}

function cleanupFFmpeg(state) {
  if (state.ffmpegProcess) {
    state.ffmpegProcess.kill("SIGKILL");
    state.ffmpegProcess = null;
  }
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function createStreamResource(state, url) {
  cleanupFFmpeg(state);

  if (ytdl.validateURL(url)) {
    const stream = ytdl(url, {
      filter: "audioonly",
      quality: "highestaudio",
      highWaterMark: 1 << 25,
    });
    return createAudioResource(stream, {
      inputType: StreamType.WebmOpus,
    });
  }

  state.ffmpegProcess = spawn(ffmpegPath, [
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-i", url,
    "-analyzeduration", "0",
    "-loglevel", "0",
    "-vn",
    "-f", "s16le",
    "-ar", "48000",
    "-ac", "2",
    "pipe:1",
  ], { stdio: ["ignore", "pipe", "ignore"] });

  return createAudioResource(state.ffmpegProcess.stdout, {
    inputType: StreamType.Raw,
  });
}

function play(guildId, url) {
  const state = getGuildState(guildId);
  state.currentUrl = url;
  const resource = createStreamResource(state, url);
  state.player.play(resource);
}

async function connectToChannel(guild, channel) {
  const state = getGuildState(guild.id);

  if (state.connection) {
    state.connection.destroy();
    state.connection = null;
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      connection.destroy();
      state.connection = null;
    }
  });

  connection.subscribe(state.player);
  state.connection = connection;
  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  return state;
}

async function startGuildFromSettings(guildId) {
  const settings = getGuildSettings(guildId);
  if (!settings || !settings.voice_channel_id || !settings.stream_url) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const channel = await guild.channels.fetch(settings.voice_channel_id);
  if (!channel || channel.type !== ChannelType.GuildVoice) return;
  await connectToChannel(guild, channel);
  play(guildId, settings.stream_url);
}

function stopGuild(guildId) {
  const state = getGuildState(guildId);
  state.currentUrl = null;
  cleanupFFmpeg(state);
  state.player.stop();
  if (state.connection) {
    state.connection.destroy();
    state.connection = null;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function inviteUrl(guildId) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: "bot",
    permissions: String(BOT_PERMISSIONS),
  });
  if (guildId) {
    params.set("guild_id", guildId);
    params.set("disable_guild_select", "true");
  }
  return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

function loginUrl() {
  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: `${config.publicBaseUrl}/auth/callback`,
    scope: "identify guilds",
  });
  return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

function renderLayout({ title, body, user }) {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet"/>
  <style>
    :root {
      --bg: #0f1419;
      --bg-soft: #1b222a;
      --card: #141b22;
      --accent: #ff7a1a;
      --accent-soft: rgba(255, 122, 26, 0.2);
      --text: #f4f5f7;
      --muted: #9ba3ae;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Space Grotesk", sans-serif;
      background: radial-gradient(circle at top, #1b2430 0%, #0f1419 60%);
      color: var(--text);
      min-height: 100vh;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 24px 40px;
    }
    header a {
      color: var(--text);
      text-decoration: none;
      font-weight: 600;
    }
    .logo {
      font-size: 20px;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .container {
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 24px 60px;
    }
    .hero {
      display: grid;
      gap: 24px;
      padding: 40px 0 20px;
    }
    .hero h1 {
      font-size: 44px;
      margin: 0;
    }
    .hero p {
      color: var(--muted);
      font-size: 18px;
      margin: 0;
      max-width: 650px;
    }
    .cta {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }
    .button {
      background: var(--accent);
      color: #0f1419;
      border: none;
      padding: 12px 18px;
      border-radius: 10px;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
    }
    .button.secondary {
      background: var(--bg-soft);
      color: var(--text);
      border: 1px solid #2b3440;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-top: 20px;
    }
    .stat {
      background: var(--card);
      border: 1px solid #232c36;
      padding: 16px;
      border-radius: 12px;
    }
    .stat h3 {
      margin: 0 0 6px;
    }
    .stat span {
      color: var(--muted);
    }
    .grid {
      display: grid;
      gap: 18px;
      margin-top: 24px;
    }
    .card {
      background: var(--card);
      border: 1px solid #232c36;
      padding: 18px;
      border-radius: 12px;
    }
    .card h3 {
      margin: 0 0 6px;
    }
    .muted {
      color: var(--muted);
    }
    form {
      display: grid;
      gap: 10px;
      margin-top: 12px;
    }
    input, select {
      background: #0d1217;
      color: var(--text);
      border: 1px solid #27313b;
      border-radius: 8px;
      padding: 10px;
      font-family: inherit;
    }
    .row {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .pill {
      display: inline-block;
      background: var(--accent-soft);
      color: var(--accent);
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
    }
    .flash {
      background: #1f2a33;
      border: 1px solid #32404e;
      padding: 12px;
      border-radius: 10px;
    }
  </style>
</head>
<body>
  <header>
    <div class="logo">Radio Host</div>
    <nav class="row">
      <a href="/">Start</a>
      ${user ? `<a href="/dashboard">Dashboard</a><a href="/logout">Logout</a>` : `<a href="${loginUrl()}">Login</a>`}
    </nav>
  </header>
  <main class="container">
    ${body}
  </main>
</body>
</html>`;
}

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  return next();
}

function manageableGuilds(guilds) {
  return guilds.filter((guild) => {
    const perms = BigInt(guild.permissions || "0");
    return (perms & MANAGE_GUILD) === MANAGE_GUILD;
  });
}

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "radio_host",
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
}));

app.get("/", (req, res) => {
  const totalGuilds = client.guilds.cache.size;
  const configured = db.prepare(`
    SELECT COUNT(*) as count
    FROM guild_settings
    WHERE voice_channel_id IS NOT NULL AND stream_url IS NOT NULL
  `).get().count;

  const body = `
    <section class="hero">
      <h1>Discord Radio Hosting</h1>
      <p>Ein Bot, viele Server. Ein Dashboard, um Kanal und Stream zu verwalten.</p>
      <div class="cta">
        <a class="button" href="${inviteUrl()}">Bot hinzufuegen</a>
        <a class="button secondary" href="/dashboard">Dashboard</a>
      </div>
      <div class="stats">
        <div class="stat">
          <h3>${totalGuilds}</h3>
          <span>verbundene Server</span>
        </div>
        <div class="stat">
          <h3>${configured}</h3>
          <span>konfigurierte Server</span>
        </div>
      </div>
    </section>
  `;

  res.send(renderLayout({
    title: "Radio Host",
    body,
    user: req.session.user,
  }));
});

app.get("/login", (req, res) => {
  res.redirect(loginUrl());
});

app.get("/auth/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send("Kein Code erhalten.");
  }

  const tokenResponse = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${config.publicBaseUrl}/auth/callback`,
    }),
  });

  if (!tokenResponse.ok) {
    const text = await tokenResponse.text();
    console.error("Token error:", text);
    return res.status(500).send("Discord Login fehlgeschlagen.");
  }

  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token;

  const [userRes, guildsRes] = await Promise.all([
    fetch(`${DISCORD_API}/users/@me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
    fetch(`${DISCORD_API}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    }),
  ]);

  if (!userRes.ok || !guildsRes.ok) {
    return res.status(500).send("Discord Login fehlgeschlagen.");
  }

  req.session.user = await userRes.json();
  req.session.guilds = await guildsRes.json();
  return res.redirect("/dashboard");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.get("/dashboard", requireLogin, async (req, res) => {
  const flash = req.session.flash;
  req.session.flash = null;

  const user = req.session.user;
  const guilds = manageableGuilds(req.session.guilds || []);
  const cards = [];

  for (const guild of guilds) {
    const botGuild = client.guilds.cache.get(guild.id);
    const settings = getGuildSettings(guild.id) || {};
    const isInstalled = Boolean(botGuild);
    let channels = [];

    if (botGuild) {
      const fetched = await botGuild.channels.fetch();
      channels = fetched
        .filter((channel) => channel.type === ChannelType.GuildVoice)
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
        }));
    }

    const channelOptions = channels.length
      ? channels.map((channel) => {
          const selected = settings.voice_channel_id === channel.id ? "selected" : "";
          return `<option value="${escapeHtml(channel.id)}" ${selected}>${escapeHtml(channel.name)}</option>`;
        }).join("")
      : `<option value="">Keine Kanaele gefunden</option>`;

    const streamValue = settings.stream_url ? escapeHtml(settings.stream_url) : "";
    const autoPlayChecked = settings.auto_play ? "checked" : "";
    const startDisabled = (!settings.voice_channel_id || !settings.stream_url || !isInstalled) ? "disabled" : "";

    const inviteButton = isInstalled
      ? `<span class="pill">Bot installiert</span>`
      : `<a class="button secondary" href="${inviteUrl(guild.id)}">Bot hinzufuegen</a>`;

    cards.push(`
      <div class="card">
        <div class="row">
          <h3>${escapeHtml(guild.name)}</h3>
          ${inviteButton}
        </div>
        <p class="muted">Server ID: ${escapeHtml(guild.id)}</p>
        <form method="post" action="/guild/${escapeHtml(guild.id)}/settings">
          <label>Sprachkanal</label>
          <select name="voiceChannelId" ${isInstalled ? "" : "disabled"}>
            <option value="">Bitte waehlen</option>
            ${channelOptions}
          </select>
          <label>Stream URL</label>
          <input name="streamUrl" placeholder="https://..." value="${streamValue}" ${isInstalled ? "" : "disabled"}/>
          <label>
            <input type="checkbox" name="autoPlay" value="1" ${autoPlayChecked} ${isInstalled ? "" : "disabled"}/>
            Auto-Play nach Neustart
          </label>
          <button class="button" type="submit" ${isInstalled ? "" : "disabled"}>Speichern</button>
        </form>
        <div class="row">
          <form method="post" action="/guild/${escapeHtml(guild.id)}/start">
            <button class="button" type="submit" ${startDisabled}>Start</button>
          </form>
          <form method="post" action="/guild/${escapeHtml(guild.id)}/stop">
            <button class="button secondary" type="submit" ${isInstalled ? "" : "disabled"}>Stop</button>
          </form>
        </div>
      </div>
    `);
  }

  const body = `
    <section class="hero">
      <h1>Dashboard</h1>
      <p>Hallo ${escapeHtml(user.username || "User")}. Verwalte deine Server.</p>
      ${flash ? `<div class="flash">${escapeHtml(flash)}</div>` : ""}
    </section>
    <section class="grid">
      ${cards.join("") || "<p>Keine Server gefunden.</p>"}
    </section>
  `;

  res.send(renderLayout({
    title: "Dashboard",
    body,
    user,
  }));
});

function hasManageGuild(req, guildId) {
  const guilds = manageableGuilds(req.session.guilds || []);
  return guilds.some((guild) => guild.id === guildId);
}

app.post("/guild/:id/settings", requireLogin, async (req, res) => {
  const guildId = req.params.id;
  if (!hasManageGuild(req, guildId)) {
    return res.status(403).send("Keine Berechtigung.");
  }

  const voiceChannelId = req.body.voiceChannelId || null;
  const streamUrl = (req.body.streamUrl || "").trim() || null;
  const autoPlay = req.body.autoPlay === "1" ? 1 : 0;

  if (streamUrl && !(isHttpUrl(streamUrl) || ytdl.validateURL(streamUrl))) {
    req.session.flash = "Ungueltige Stream URL.";
    return res.redirect("/dashboard");
  }

  saveGuildSettings(guildId, voiceChannelId, streamUrl, autoPlay);
  req.session.flash = "Einstellungen gespeichert.";

  if (autoPlay && voiceChannelId && streamUrl) {
    try {
      await startGuildFromSettings(guildId);
    } catch (err) {
      console.error("Auto-play error:", err.message);
    }
  }

  return res.redirect("/dashboard");
});

app.post("/guild/:id/start", requireLogin, async (req, res) => {
  const guildId = req.params.id;
  if (!hasManageGuild(req, guildId)) {
    return res.status(403).send("Keine Berechtigung.");
  }

  const settings = getGuildSettings(guildId);
  if (!settings || !settings.voice_channel_id || !settings.stream_url) {
    req.session.flash = "Bitte Kanal und Stream zuerst setzen.";
    return res.redirect("/dashboard");
  }

  try {
    await startGuildFromSettings(guildId);
    req.session.flash = "Stream gestartet.";
  } catch (err) {
    req.session.flash = `Start fehlgeschlagen: ${err.message}`;
  }

  return res.redirect("/dashboard");
});

app.post("/guild/:id/stop", requireLogin, (req, res) => {
  const guildId = req.params.id;
  if (!hasManageGuild(req, guildId)) {
    return res.status(403).send("Keine Berechtigung.");
  }

  stopGuild(guildId);
  req.session.flash = "Stream gestoppt.";
  return res.redirect("/dashboard");
});

client.on("guildCreate", (guild) => {
  const existing = getGuildSettings(guild.id);
  if (!existing) {
    saveGuildSettings(guild.id, null, null, 0);
  }
});

client.on("guildDelete", (guild) => {
  stopGuild(guild.id);
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  const autoPlay = listAutoPlaySettings();
  for (const entry of autoPlay) {
    try {
      await startGuildFromSettings(entry.guild_id);
    } catch (err) {
      console.error(`Auto-play failed [${entry.guild_id}]:`, err.message);
    }
  }
});

client.login(config.token);

app.listen(config.port, () => {
  console.log(`Web listening on port ${config.port}`);
});
