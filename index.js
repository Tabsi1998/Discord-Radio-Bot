const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const ytdl = require("ytdl-core");
const express = require("express");
const session = require("express-session");
const SQLiteSessionStore = require("better-sqlite3-session-store")(session);
const Database = require("better-sqlite3");
const {
  Client,
  GatewayIntentBits,
  ChannelType,
  REST,
  Routes,
  SlashCommandBuilder,
  Events,
  ActivityType,
  PermissionsBitField,
} = require("discord.js");
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  entersState,
} = require("@discordjs/voice");
let ffmpegPath = null;
try {
  ffmpegPath = require("ffmpeg-static");
} catch {
  ffmpegPath = null;
}
ffmpegPath = process.env.FFMPEG_PATH || ffmpegPath || "ffmpeg";

const configPath = path.join(__dirname, "config.json");
const fileConfig = fs.existsSync(configPath) ? require(configPath) : {};

const config = {
  token: process.env.DISCORD_TOKEN || fileConfig.token,
  clientId: process.env.DISCORD_CLIENT_ID || fileConfig.clientId,
  clientSecret: process.env.DISCORD_CLIENT_SECRET || fileConfig.clientSecret,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || fileConfig.publicBaseUrl,
  sessionSecret: process.env.SESSION_SECRET || fileConfig.sessionSecret,
  port: Number(process.env.PORT || fileConfig.port || 3000),
  dbPath: process.env.DB_PATH || fileConfig.dbPath || path.join(__dirname, "data", "data.sqlite"),
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
const BOT_PERMISSIONS = new PermissionsBitField([
  PermissionsBitField.Flags.Connect,
  PermissionsBitField.Flags.Speak,
  PermissionsBitField.Flags.SendMessages,
  PermissionsBitField.Flags.CreatePublicThreads,
  PermissionsBitField.Flags.SendMessagesInThreads,
]).bitfield;
const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.dbPath);
const sessionDb = new Database(path.join(dbDir, "sessions.sqlite"));
const logDir = path.join(dbDir, "logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}
const logFile = path.join(logDir, "app.log");
const EPHEMERAL = 64;
const YTDLP_PATH = process.env.YTDLP_PATH || "yt-dlp";
const YTDLP_COOKIES = process.env.YTDLP_COOKIES || path.join(__dirname, "data", "cookies.txt");
const YTDLP_ARGS = (process.env.YTDLP_ARGS || "").trim().split(/\s+/).filter(Boolean);
const STREAM_RETRY_MS = 2_000;

function log(scope, message, extra) {
  const stamp = new Date().toISOString();
  const line = extra
    ? `[${stamp}] [${scope}] ${message} ${JSON.stringify(extra)}`
    : `[${stamp}] [${scope}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(logFile, `${line}\n`);
  } catch (err) {
    console.error("Log write failed:", err.message);
  }
}
db.exec(`
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    voice_channel_id TEXT,
    stream_url TEXT,
    auto_play INTEGER DEFAULT 0,
    meta_channel_id TEXT,
    meta_thread_id TEXT,
    last_title TEXT,
    last_source TEXT,
    last_quality TEXT,
    last_url TEXT,
    updated_at INTEGER
  );
`);

const columnsToAdd = [
  ["meta_channel_id", "TEXT"],
  ["meta_thread_id", "TEXT"],
  ["last_title", "TEXT"],
  ["last_source", "TEXT"],
  ["last_quality", "TEXT"],
  ["last_url", "TEXT"],
];
for (const [name, type] of columnsToAdd) {
  try {
    db.prepare(`ALTER TABLE guild_settings ADD COLUMN ${name} ${type}`).run();
  } catch {
    // Column already exists.
  }
}

const hasStreamsTable = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table' AND name='guild_streams'
`).get();
if (hasStreamsTable) {
  const legacy = db.prepare(`
    SELECT guild_id, voice_channel_id, stream_url, auto_play, meta_channel_id, meta_thread_id,
           last_title, last_source, last_quality, last_url
    FROM guild_streams WHERE slot = 1
  `).all();
  const insert = db.prepare(`
    INSERT OR REPLACE INTO guild_settings
      (guild_id, voice_channel_id, stream_url, auto_play, meta_channel_id, meta_thread_id,
       last_title, last_source, last_quality, last_url, updated_at)
    VALUES
      (@guild_id, @voice_channel_id, @stream_url, @auto_play, @meta_channel_id, @meta_thread_id,
       @last_title, @last_source, @last_quality, @last_url, @updated_at)
  `);
  for (const row of legacy) {
    insert.run({ ...row, updated_at: Date.now() });
  }
  if (legacy.length) {
    log("db", "guild_streams -> guild_settings migriert", { count: legacy.length });
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

process.on("unhandledRejection", (reason) => {
  log("process", "UnhandledRejection", reason);
});

process.on("uncaughtException", (err) => {
  log("process", `UncaughtException ${err.message}`);
});

const guildStates = new Map();

function saveGuildSettings(guildId, voiceChannelId, streamUrl, autoPlay) {
  const stmt = db.prepare(`
    INSERT INTO guild_settings (
      guild_id, voice_channel_id, stream_url, auto_play,
      meta_channel_id, meta_thread_id, last_title, last_source, last_quality, last_url,
      updated_at
    )
    VALUES (
      @guildId, @voiceChannelId, @streamUrl, @autoPlay,
      @metaChannelId, @metaThreadId, @lastTitle, @lastSource, @lastQuality, @lastUrl,
      @updatedAt
    )
    ON CONFLICT(guild_id) DO UPDATE SET
      voice_channel_id = excluded.voice_channel_id,
      stream_url = excluded.stream_url,
      auto_play = excluded.auto_play,
      meta_channel_id = excluded.meta_channel_id,
      meta_thread_id = excluded.meta_thread_id,
      last_title = excluded.last_title,
      last_source = excluded.last_source,
      last_quality = excluded.last_quality,
      last_url = excluded.last_url,
      updated_at = excluded.updated_at;
  `);
  const current = getGuildSettings(guildId) || {};
  stmt.run({
    guildId,
    voiceChannelId,
    streamUrl,
    autoPlay,
    metaChannelId: current.meta_channel_id || null,
    metaThreadId: current.meta_thread_id || null,
    lastTitle: current.last_title || null,
    lastSource: current.last_source || null,
    lastQuality: current.last_quality || null,
    lastUrl: current.last_url || null,
    updatedAt: Date.now(),
  });
}

function getGuildSettings(guildId) {
  return db.prepare(`
    SELECT guild_id, voice_channel_id, stream_url, auto_play,
           meta_channel_id, meta_thread_id, last_title, last_source, last_quality, last_url
    FROM guild_settings WHERE guild_id = ?
  `).get(guildId);
}

function listAutoPlaySettings() {
  return db.prepare(`
    SELECT guild_id, voice_channel_id, stream_url, auto_play,
           meta_channel_id, meta_thread_id, last_title, last_source, last_quality, last_url
    FROM guild_settings
    WHERE auto_play = 1 AND voice_channel_id IS NOT NULL AND stream_url IS NOT NULL
  `).all();
}

function ensureGuildRow(guildId) {
  const existing = getGuildSettings(guildId);
  if (!existing) {
    saveGuildSettings(guildId, null, null, 0);
  }
}

function getGuildState(guildId) {
  if (!guildStates.has(guildId)) {
    const player = createAudioPlayer();
    const state = {
      player,
      connection: null,
      ffmpegProcess: null,
      currentUrl: null,
      guildId,
    };

    player.on(AudioPlayerStatus.Idle, () => {
      if (state.currentUrl) {
        setTimeout(() => {
          play(guildId, state.currentUrl).catch((err) => {
            log("play", `Retry failed [${guildId}] ${err.message}`);
          });
        }, STREAM_RETRY_MS);
      }
    });

    player.on("stateChange", (oldState, newState) => {
      log("player", `State [${guildId}] ${oldState.status} -> ${newState.status}`);
    });

    player.on("debug", (message) => {
      log("player", `Debug [${guildId}] ${message}`);
    });

    player.on("error", (err) => {
      log("audio", `Fehler [${guildId}] ${err.message}`);
      if (state.currentUrl) {
        setTimeout(() => {
          play(guildId, state.currentUrl).catch((err2) => {
            log("play", `Retry failed [${guildId}] ${err2.message}`);
          });
        }, STREAM_RETRY_MS);
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

function execFileCapture(command, args, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${command} timeout`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`${command} exited ${code}: ${stderr.trim()}`));
      } else {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      }
    });
  });
}

async function resolveYouTube(url) {
  const baseArgs = [
    "--no-warnings",
    "--no-playlist",
    "--ignore-errors",
    "--extractor-args",
    "youtube:player_client=android,ios,web",
    ...YTDLP_ARGS,
  ];
  if (fs.existsSync(YTDLP_COOKIES)) {
    baseArgs.push("--cookies", YTDLP_COOKIES);
  }
  const info = await execFileCapture(YTDLP_PATH, ["-J", "--skip-download", ...baseArgs, url], 30_000);
  const json = JSON.parse(info.stdout);
  const stream = await execFileCapture(
    YTDLP_PATH,
    ["-f", "bestaudio[ext=webm]/bestaudio/best", "-g", ...baseArgs, url],
    30_000
  );
  const directUrl = stream.stdout.split("\n").find(Boolean);
  const title = json.title || "YouTube";
  const uploader = json.uploader || json.channel || "YouTube";
  const quality = json.abr ? `${json.abr} kbps / 48 kHz` : "48 kHz (Discord)";
  return {
    inputUrl: directUrl,
    meta: {
      title,
      source: uploader,
      url: json.webpage_url || url,
      quality,
    },
  };
}

async function resolveHttpMeta(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    const icyName = res.headers.get("icy-name");
    const icyDesc = res.headers.get("icy-description");
    const title = icyName || null;
    const source = icyDesc || new URL(url).hostname;
    return {
      title,
      source,
      url,
      quality: "48 kHz (Discord)",
    };
  } catch {
    return {
      title: null,
      source: new URL(url).hostname,
      url,
      quality: "48 kHz (Discord)",
    };
  }
}

async function autoFetchMeta(url, guildId) {
  let meta = null;
  if (ytdl.validateURL(url)) {
    meta = (await resolveYouTube(url)).meta;
  } else {
    meta = await resolveHttpMeta(url);
  }
  await updateStreamMeta(guildId, meta, null, null);
  log("meta", `Auto meta [${guildId}] ${meta?.title || "unknown"}`);
}

async function createStreamResourceAsync(state, url) {
  cleanupFFmpeg(state);

  let inputUrl = url;
  let meta = null;

  if (ytdl.validateURL(url)) {
    try {
      const resolved = await resolveYouTube(url);
      inputUrl = resolved.inputUrl;
      meta = resolved.meta;
    } catch (err) {
      log("ytdl", `yt-dlp Fehler [${state.guildId}] ${err.message}`);
      throw err;
    }
  } else {
    meta = await resolveHttpMeta(url);
  }

  if (!ffmpegPath) {
    throw new Error("ffmpeg not found");
  }

  state.ffmpegProcess = spawn(ffmpegPath, [
    "-reconnect", "1",
    "-reconnect_streamed", "1",
    "-reconnect_delay_max", "5",
    "-i", inputUrl,
    "-analyzeduration", "0",
    "-loglevel", "error",
    "-vn",
    "-f", "s16le",
    "-ar", "48000",
    "-ac", "2",
    "pipe:1",
  ], { stdio: ["ignore", "pipe", "pipe"] });

  state.ffmpegProcess.on("exit", (code, signal) => {
    log("ffmpeg", `Exit [${state.guildId}] code=${code} signal=${signal}`);
  });
  state.ffmpegProcess.stderr?.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      log("ffmpeg", `stderr [${state.guildId}] ${text}`);
    }
  });

  return {
    resource: createAudioResource(state.ffmpegProcess.stdout, {
      inputType: StreamType.Raw,
    }),
    meta,
  };
}

async function play(guildId, url) {
  const state = getGuildState(guildId);
  state.currentUrl = url;
  const { resource, meta } = await createStreamResourceAsync(state, url);
  state.player.play(resource);
  log("play", `Start [${guildId}] ${url}`);
  await updateNowPlaying(guildId, meta);
}

async function connectToChannel(guild, channel) {
  const state = getGuildState(guild.id);

  if (state.connection) {
    state.connection.destroy();
    state.connection = null;
  }

  log("voice", `Join request [${guild.id}] -> ${channel.name} (${channel.type})`);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  connection.on("stateChange", (oldState, newState) => {
    log("voice", `State [${guild.id}] ${oldState.status} -> ${newState.status}`);
  });

  connection.on("error", (err) => {
    log("voice", `Error [${guild.id}] ${err.message}`);
  });

  connection.on("debug", (message) => {
    log("voice", `Debug [${guild.id}] ${message}`);
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
      log("voice", `Disconnected [${guild.id}]`);
    }
  });

  connection.subscribe(state.player);
  state.connection = connection;
  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  } catch (err) {
    connection.destroy();
    state.connection = null;
    throw new Error(`Voice connect timeout: ${err.message}`);
  }

  if (channel.type === ChannelType.GuildStageVoice) {
    try {
      const me = await guild.members.fetch(client.user.id);
      await me.voice.setSuppressed(false);
      log("voice", `Stage unsuppressed [${guild.id}]`);
    } catch (err) {
      log("voice", `Stage unsuppress failed [${guild.id}] ${err.message}`);
    }
  }

  log("voice", `Verbunden [${guild.id}] -> ${channel.name}`);
  return state;
}

async function startGuildFromSettings(guildId) {
  const settings = getGuildSettings(guildId);
  if (!settings || !settings.voice_channel_id || !settings.stream_url) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const channel = await guild.channels.fetch(settings.voice_channel_id);
  if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) return;
  await connectToChannel(guild, channel);
  await play(guildId, settings.stream_url);
}

function stopGuildStream(guildId) {
  const state = getGuildState(guildId);
  state.currentUrl = null;
  cleanupFFmpeg(state);
  state.player.stop();
  if (state.connection) {
    state.connection.destroy();
    state.connection = null;
  }
  const anyActive = [...guildStates.values()].some((s) => s.currentUrl);
  if (!anyActive && client.user) {
    client.user.setActivity("Radio", { type: ActivityType.Playing });
  }
  log("play", `Stop [${guildId}]`);
}

function updatePresence(title) {
  if (!client.user) return;
  const name = title ? `Radio: ${title}` : "Radio";
  client.user.setActivity(name.slice(0, 128), { type: ActivityType.Playing });
}

async function resolveMetaChannel(guild, voiceChannel, settings) {
  if (voiceChannel?.isTextBased?.()) {
    return voiceChannel;
  }

  if (settings?.meta_channel_id) {
    const channel = await guild.channels.fetch(settings.meta_channel_id).catch(() => null);
    if (channel && channel.isTextBased?.()) {
      return channel;
    }
  }

  if (guild.systemChannelId) {
    const channel = await guild.channels.fetch(guild.systemChannelId).catch(() => null);
    if (channel && channel.isTextBased?.()) {
      return channel;
    }
  }

  const channels = await guild.channels.fetch();
  const firstText = channels.find((ch) => ch.isTextBased?.());
  return firstText || null;
}

async function getOrCreateThread(baseChannel, voiceChannelName, settings) {
  if (!baseChannel?.threads?.create) return null;

  if (settings?.meta_thread_id) {
    const thread = await baseChannel.threads.fetch(settings.meta_thread_id).catch(() => null);
    if (thread) return thread;
  }

  const threadName = `${voiceChannelName || "voice"}-radio`;
  const thread = await baseChannel.threads.create({
    name: threadName.slice(0, 100),
    autoArchiveDuration: 1440,
    reason: "Radio stream updates",
  });
  return thread;
}

async function updateStreamMeta(guildId, meta, metaChannelId, metaThreadId) {
  const current = getGuildSettings(guildId) || {};
  const stmt = db.prepare(`
    UPDATE guild_settings SET
      meta_channel_id = @metaChannelId,
      meta_thread_id = @metaThreadId,
      last_title = @lastTitle,
      last_source = @lastSource,
      last_quality = @lastQuality,
      last_url = @lastUrl,
      updated_at = @updatedAt
    WHERE guild_id = @guildId
  `);
  stmt.run({
    guildId,
    metaChannelId: metaChannelId ?? current.meta_channel_id ?? null,
    metaThreadId: metaThreadId ?? current.meta_thread_id ?? null,
    lastTitle: meta?.title ?? current.last_title ?? null,
    lastSource: meta?.source ?? current.last_source ?? null,
    lastQuality: meta?.quality ?? current.last_quality ?? null,
    lastUrl: meta?.url ?? current.last_url ?? null,
    updatedAt: Date.now(),
  });
}

async function updateNowPlaying(guildId, meta) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const settings = getGuildSettings(guildId) || {};
  const voiceChannel = settings.voice_channel_id
    ? await guild.channels.fetch(settings.voice_channel_id).catch(() => null)
    : null;

  updatePresence(meta?.title || "Radio");

  const baseChannel = await resolveMetaChannel(guild, voiceChannel, settings);
  if (!baseChannel) {
    log("meta", `No text channel found [${guildId}]`);
    return;
  }

  const thread = await getOrCreateThread(baseChannel, voiceChannel?.name, settings);
  const target = thread || baseChannel;

  const title = meta?.title || settings.last_title || "Unbekannter Stream";
  const source = meta?.source || settings.last_source || "Quelle unbekannt";
  const quality = meta?.quality || settings.last_quality || "48 kHz (Discord)";
  const link = meta?.url || settings.last_url || settings.stream_url || "—";

  const message = [
    "**Jetzt laeuft**",
    `Titel: ${title}`,
    `Quelle: ${source}`,
    `Link: ${link}`,
    `Audio: ${quality}`,
  ].join("\n");

  await target.send({ content: message }).catch((err) => {
    log("meta", `Post failed [${guildId}] ${err.message}`);
  });

  await updateStreamMeta(guildId, meta, baseChannel.id, thread?.id || null);
  log("meta", `Posted [${guildId}] channel=${baseChannel.id} thread=${thread?.id || "none"}`);
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
    scope: "bot applications.commands",
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
    prompt: "consent",
  });
  return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Zeigt Hilfe und Befehle."),
    new SlashCommandBuilder()
      .setName("setchannel")
      .setDescription("Setzt den Sprachkanal fuer den Bot.")
      .addChannelOption((option) =>
        option.setName("kanal").setDescription("Sprachkanal").setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("setstream")
      .setDescription("Setzt die Stream-URL.")
      .addStringOption((option) =>
        option.setName("url").setDescription("Stream-URL").setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("play")
      .setDescription("Startet den Stream."),
    new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Stoppt den Stream."),
    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Zeigt aktuelle Einstellungen."),
    new SlashCommandBuilder()
      .setName("setmetachannel")
      .setDescription("Setzt den Textkanal fuer Now-Playing Updates.")
      .addChannelOption((option) =>
        option.setName("kanal").setDescription("Textkanal").setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("setmeta")
      .setDescription("Optional: Metadaten manuell setzen (ueberschreibt auto).")
      .addStringOption((option) =>
        option.setName("titel").setDescription("Titel/Name")
      )
      .addStringOption((option) =>
        option.setName("quelle").setDescription("Quelle/Rechte")
      )
      .addStringOption((option) =>
        option.setName("url").setDescription("Link zur Quelle")
      )
      .addStringOption((option) =>
        option.setName("qualitaet").setDescription("Audio-Qualitaet (z.B. 320kbps/48kHz)")
      ),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(config.token);
  await rest.put(Routes.applicationCommands(config.clientId), { body: commands });
  log("discord", "Slash-Commands registriert");
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
      ${user ? `<a href="/dashboard">Dashboard</a><a href="/docs">Docs</a><a href="/logout">Logout</a>` : `<a href="${loginUrl()}">Login</a>`}
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
app.use((req, res, next) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  next();
});
app.use(express.urlencoded({ extended: false }));
app.use(session({
  name: "radio_host",
  secret: config.sessionSecret,
  store: new SQLiteSessionStore({ client: sessionDb }),
  resave: false,
  saveUninitialized: false,
}));

app.get("/", (req, res) => {
  const totalGuilds = client.guilds.cache.size;
  const configured = db.prepare(`
    SELECT COUNT(DISTINCT guild_id) as count
    FROM guild_settings
    WHERE voice_channel_id IS NOT NULL AND stream_url IS NOT NULL
  `).get().count;
  const activeStreams = [...guildStates.values()].filter((state) => state.currentUrl).length;

  const body = `
    <section class="hero">
      <h1>Discord Radio Hosting</h1>
      <p>Ein Bot, viele Server. Ein Dashboard, um Kanal und Stream zu verwalten.</p>
      <div class="cta">
        ${req.session.user
          ? `<a class="button" href="${inviteUrl()}">Bot hinzufuegen</a>
             <a class="button secondary" href="/dashboard">Dashboard</a>`
          : `<a class="button" href="/login">Mit Discord anmelden</a>
             <a class="button secondary" href="/docs">Dokumentation</a>`}
      </div>
      <p class="muted">Hinweis: Fuer das Dashboard musst du dich mit Discord einloggen und "Server verwalten" besitzen.</p>
      <div class="stats">
        <div class="stat">
          <h3>${totalGuilds}</h3>
          <span>verbundene Server</span>
        </div>
        <div class="stat">
          <h3>${configured}</h3>
          <span>konfigurierte Server</span>
        </div>
        <div class="stat">
          <h3>${activeStreams}</h3>
          <span>aktive Streams</span>
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
  if (req.query.error) {
    const error = escapeHtml(req.query.error);
    const desc = escapeHtml(req.query.error_description || "");
    const body = `
      <section class="hero">
        <h1>Discord Login fehlgeschlagen</h1>
        <p class="muted">Fehler: ${error}</p>
        ${desc ? `<div class="flash">${desc}</div>` : ""}
        <div class="cta">
          <a class="button" href="/login">Erneut versuchen</a>
        </div>
      </section>
    `;
    return res.send(renderLayout({
      title: "Login Fehler",
      body,
      user: req.session.user,
    }));
  }

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

app.get("/add-bot/:id", requireLogin, (req, res) => {
  const guildId = req.params.id;
  if (!hasManageGuild(req, guildId)) {
    return res.status(403).send("Keine Berechtigung.");
  }
  return res.redirect(inviteUrl(guildId));
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

    const inviteButton = isInstalled
      ? `<span class="pill">Bot installiert</span>`
      : `<a class="button secondary" href="/add-bot/${escapeHtml(guild.id)}">Bot hinzufuegen</a>`;

    const selectedChannel = settings.voice_channel_id || "";
    const channelOptions = channels.length
      ? channels.map((channel) => {
          const selected = selectedChannel === channel.id ? "selected" : "";
          return `<option value="${escapeHtml(channel.id)}" ${selected}>${escapeHtml(channel.name)}</option>`;
        }).join("")
      : `<option value="">Keine Kanaele gefunden</option>`;

    const streamValue = settings.stream_url ? escapeHtml(settings.stream_url) : "";
    const autoPlayChecked = settings.auto_play ? "checked" : "";
    const startDisabled = (!settings.voice_channel_id || !settings.stream_url || !isInstalled) ? "disabled" : "";

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

app.get("/docs", requireLogin, (req, res) => {
  const body = `
    <section class="hero">
      <h1>Dokumentation</h1>
      <p>Hier findest du alle Befehle und gueltige Stream-Links.</p>
    </section>
    <section class="grid">
      <div class="card">
        <h3>Slash Commands</h3>
        <pre>
/help
/setchannel kanal:&lt;Sprachkanal&gt;
/setstream url:&lt;Stream-URL&gt;
/play
/stop
/status
/setmetachannel kanal:&lt;Textkanal&gt;
/setmeta titel:&lt;...&gt; quelle:&lt;...&gt; url:&lt;...&gt; qualitaet:&lt;...&gt;
        </pre>
      </div>
      <div class="card">
        <h3>Gueltige Links</h3>
        <p>Funktioniert:</p>
        <pre>
Direkter MP3/AAC/OGG Stream:
https://playerservices.streamtheworld.com/api/livestream-redirect/OWR_INTERNATIONAL.mp3
http://stream.live.vc.bbcmedia.co.uk/bbc_radio_fourlw_online_nonuk

YouTube (Live/VOD):
https://www.youtube.com/watch?v=VIDEO_ID
        </pre>
        <p class="muted">Hinweis: YouTube kann wegen Geo/Age/Cookies blockieren. In dem Fall hilft ein direkter Stream-Link oder eine Cookies-Datei.</p>
      </div>
      <div class="card">
        <h3>Stream-Quellen</h3>
        <p>Beispiel-Quelle fuer MP3-Streams:</p>
        <p><a href="https://somafm.com/" target="_blank" rel="noreferrer">SomaFM Streams</a></p>
      </div>
      <div class="card">
        <h3>Login & Datenschutz</h3>
        <p>Du meldest dich mit deinem Discord-Account an. Das Dashboard zeigt nur deine eigenen Server (mit "Server verwalten").</p>
        <p class="muted">Oeffentlich ist nur die Gesamtanzahl der Server, nicht deine Serverliste.</p>
      </div>
      <div class="card">
        <h3>Bot hinzufuegen</h3>
        <p>Nach dem Login siehst du pro Server einen Button "Bot hinzufuegen".</p>
      </div>
      <div class="card">
        <h3>Now-Playing</h3>
        <p>Der Bot postet automatisch Titel/Quelle/Qualitaet in einen Thread oder Textkanal.</p>
        <pre>
/setmetachannel kanal:#radio
        </pre>
      </div>
      <div class="card">
        <h3>Umlaute</h3>
        <p>UTF-8 ist aktiv. Umlaute wie ä, ö, ü, ß funktionieren in Messages, Web-UI und Logs.</p>
      </div>
      <div class="card">
        <h3>Wichtig</h3>
        <p>Pro Server kann der Bot nur in einem Sprachkanal gleichzeitig sein. Fuer mehrere Streams brauchst du mehrere Bot-Instanzen.</p>
      </div>
    </section>
  `;

  res.send(renderLayout({
    title: "Docs",
    body,
    user: req.session.user,
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
      log("autoplay", `Fehler [${guildId}] ${err.message}`);
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

  stopGuildStream(guildId);
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
  stopGuildStream(guild.id);
});

client.once(Events.ClientReady, async () => {
  log("bot", `Logged in as ${client.user.tag}`);
  registerCommands().catch((err) => {
    log("discord", `Command registration failed: ${err.message}`);
  });
  const autoPlay = listAutoPlaySettings();
  for (const entry of autoPlay) {
    try {
      await startGuildFromSettings(entry.guild_id);
    } catch (err) {
      log("autoplay", `Fehler [${entry.guild_id}] ${err.message}`);
    }
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  const guildId = interaction.guild.id;
  log("cmd", `/${interaction.commandName} by ${interaction.user?.tag || interaction.user?.id} in ${guildId}`);

  if (interaction.commandName === "help") {
    const help = [
      "So funktioniert es:",
      "1) /setchannel + /setstream",
      "2) /play",
      "",
      "Gueltige Links:",
      "- Direkter MP3/AAC/OGG Stream",
      "- YouTube (Live/VOD, kann wegen Geo/Age/Cookies blockieren)",
      "",
      "Beispiele:",
      "https://playerservices.streamtheworld.com/api/livestream-redirect/OWR_INTERNATIONAL.mp3",
      "http://stream.live.vc.bbcmedia.co.uk/bbc_radio_fourlw_online_nonuk",
      "/setchannel kanal:<Sprachkanal>",
      "/setstream url:<Stream-URL>",
      "/play",
      "/stop",
      "/status",
      "/setmetachannel kanal:<Textkanal>",
      "/setmeta titel:<...> quelle:<...> url:<...> qualitaet:<...>",
      "",
      "Hinweis: Pro Server nur 1 Voice-Connection gleichzeitig.",
      "Fuer mehrere Streams brauchst du mehrere Bot-Instanzen.",
      "Wenn YouTube blockiert: Cookies-Datei nutzen (YTDLP_COOKIES).",
    ].join("\n");
    return interaction.reply({
      content: `Hilfe:\n${help}`,
      flags: EPHEMERAL,
    });
  }

  if (interaction.commandName === "status") {
    const settings = getGuildSettings(guildId);
    if (!settings) {
      return interaction.reply({
        content: "Noch keine Einstellungen. Nutze /setchannel und /setstream.",
        flags: EPHEMERAL,
      });
    }
    const chan = settings.voice_channel_id || "nicht gesetzt";
    const url = settings.stream_url || "nicht gesetzt";
    const meta = settings.meta_channel_id ? ` MetaChannel=${settings.meta_channel_id}` : "";
    return interaction.reply({ content: `Kanal=${chan} Stream=${url}${meta}`, flags: EPHEMERAL });
  }

  if (interaction.commandName === "setchannel") {
    const channel = interaction.options.getChannel("kanal", true);
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
      return interaction.reply({
        content: "Bitte einen echten Sprachkanal waehlen.",
        flags: EPHEMERAL,
      });
    }
    const current = getGuildSettings(guildId) || {};
    saveGuildSettings(guildId, channel.id, current.stream_url || null, current.auto_play || 0);
    return interaction.reply({
      content: `Sprachkanal gesetzt (${channel.name}).`,
      flags: EPHEMERAL,
    });
  }

  if (interaction.commandName === "setmetachannel") {
    const channel = interaction.options.getChannel("kanal", true);
    if (!channel.isTextBased?.()) {
      return interaction.reply({
        content: "Bitte einen Textkanal waehlen.",
        flags: EPHEMERAL,
      });
    }
    ensureGuildRow(guildId);
    await updateStreamMeta(guildId, null, channel.id, null);
    return interaction.reply({
      content: `Meta-Channel gesetzt (${channel.name}).`,
      flags: EPHEMERAL,
    });
  }

  if (interaction.commandName === "setmeta") {
    const title = interaction.options.getString("titel");
    const source = interaction.options.getString("quelle");
    const url = interaction.options.getString("url");
    const quality = interaction.options.getString("qualitaet");
    const meta = {
      title: title || null,
      source: source || null,
      url: url || null,
      quality: quality || null,
    };
    ensureGuildRow(guildId);
    await updateStreamMeta(guildId, meta, null, null);
    return interaction.reply({
      content: "Metadaten gespeichert.",
      flags: EPHEMERAL,
    });
  }

  if (interaction.commandName === "setstream") {
    const url = interaction.options.getString("url", true).trim();
    const isValid = isHttpUrl(url) || ytdl.validateURL(url);
    if (!isValid) {
      return interaction.reply({
        content: "Bitte eine gueltige http(s)-URL oder YouTube-URL angeben.",
        flags: EPHEMERAL,
      });
    }
    const current = getGuildSettings(guildId) || {};
    saveGuildSettings(guildId, current.voice_channel_id || null, url, current.auto_play || 0);
    autoFetchMeta(url, guildId).catch((err) => {
      log("meta", `Auto fetch failed [${guildId}] ${err.message}`);
    });
    return interaction.reply({
      content: "Stream-URL gespeichert.",
      flags: EPHEMERAL,
    });
  }

  if (interaction.commandName === "play") {
    const settings = getGuildSettings(guildId);
    if (!settings || !settings.voice_channel_id || !settings.stream_url) {
      return interaction.reply({
        content: "Bitte erst /setchannel und /setstream ausfuehren.",
        flags: EPHEMERAL,
      });
    }
    const channel = await interaction.guild.channels.fetch(settings.voice_channel_id);
    if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
      return interaction.reply({
        content: "Sprachkanal existiert nicht mehr. Bitte neu setzen.",
        flags: EPHEMERAL,
      });
    }
    try {
      await interaction.reply({ content: "Starte Stream...", flags: EPHEMERAL });
      log("cmd", `play [${guildId}] channel=${channel.id} url=${settings.stream_url}`);
      await connectToChannel(interaction.guild, channel);
      await play(guildId, settings.stream_url);
      const baseChannel = await resolveMetaChannel(interaction.guild, channel, getGuildSettings(guildId));
      if (!baseChannel) {
        await interaction.followUp({
          content: "Kein Textkanal fuer Now-Playing gefunden. Bitte /setmetachannel setzen.",
          flags: EPHEMERAL,
        });
      }
    } catch (err) {
      log("cmd", `play failed [${guildId}] ${err.message}`);
      return interaction.followUp({
        content: `Fehler beim Start: ${err.message}`,
        flags: EPHEMERAL,
      });
    }
    return;
  }

  if (interaction.commandName === "stop") {
    stopGuildStream(guildId);
    return interaction.reply({
      content: "Stream gestoppt.",
      flags: EPHEMERAL,
    });
  }
});

client.login(config.token);

app.listen(config.port, () => {
  log("web", `Listening on port ${config.port}`);
});
