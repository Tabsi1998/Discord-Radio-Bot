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
  maxSlots: Number(process.env.MAX_SLOTS || fileConfig.maxSlots || 3),
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
const MAX_SLOTS = Math.max(1, Math.min(3, config.maxSlots || 3));
const EPHEMERAL = 64;
const YTDLP_PATH = process.env.YTDLP_PATH || "yt-dlp";
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
  CREATE TABLE IF NOT EXISTS guild_streams (
    guild_id TEXT,
    slot INTEGER,
    voice_channel_id TEXT,
    stream_url TEXT,
    auto_play INTEGER DEFAULT 0,
    meta_channel_id TEXT,
    meta_thread_id TEXT,
    last_title TEXT,
    last_source TEXT,
    last_quality TEXT,
    last_url TEXT,
    updated_at INTEGER,
    PRIMARY KEY (guild_id, slot)
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
    db.prepare(`ALTER TABLE guild_streams ADD COLUMN ${name} ${type}`).run();
  } catch {
    // Column already exists.
  }
}

const hasLegacyTable = db.prepare(`
  SELECT name FROM sqlite_master WHERE type='table' AND name='guild_settings'
`).get();
if (hasLegacyTable) {
  const legacy = db.prepare(`
    SELECT guild_id, voice_channel_id, stream_url, auto_play FROM guild_settings
  `).all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO guild_streams (guild_id, slot, voice_channel_id, stream_url, auto_play, updated_at)
    VALUES (@guild_id, 1, @voice_channel_id, @stream_url, @auto_play, @updated_at)
  `);
  for (const row of legacy) {
    insert.run({ ...row, updated_at: Date.now() });
  }
  if (legacy.length) {
    log("db", "Legacy settings migriert", { count: legacy.length });
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

function stateKey(guildId, slot) {
  return `${guildId}:${slot}`;
}

function saveStreamSettings(guildId, slot, voiceChannelId, streamUrl, autoPlay) {
  const stmt = db.prepare(`
    INSERT INTO guild_streams (
      guild_id, slot, voice_channel_id, stream_url, auto_play,
      meta_channel_id, meta_thread_id, last_title, last_source, last_quality, last_url,
      updated_at
    )
    VALUES (
      @guildId, @slot, @voiceChannelId, @streamUrl, @autoPlay,
      @metaChannelId, @metaThreadId, @lastTitle, @lastSource, @lastQuality, @lastUrl,
      @updatedAt
    )
    ON CONFLICT(guild_id, slot) DO UPDATE SET
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
  const current = getStreamSettings(guildId, slot) || {};
  stmt.run({
    guildId,
    slot,
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

function getStreamSettings(guildId, slot) {
  return db.prepare(`
    SELECT guild_id, slot, voice_channel_id, stream_url, auto_play,
           meta_channel_id, meta_thread_id, last_title, last_source, last_quality, last_url
    FROM guild_streams WHERE guild_id = ? AND slot = ?
  `).get(guildId, slot);
}

function getGuildStreams(guildId) {
  return db.prepare(`
    SELECT guild_id, slot, voice_channel_id, stream_url, auto_play,
           meta_channel_id, meta_thread_id, last_title, last_source, last_quality, last_url
    FROM guild_streams WHERE guild_id = ?
  `).all(guildId);
}

function listAutoPlaySettings() {
  return db.prepare(`
    SELECT guild_id, slot, voice_channel_id, stream_url, auto_play,
           meta_channel_id, meta_thread_id, last_title, last_source, last_quality, last_url
    FROM guild_streams
    WHERE auto_play = 1 AND voice_channel_id IS NOT NULL AND stream_url IS NOT NULL
  `).all();
}

function ensureStreamRow(guildId, slot) {
  const existing = getStreamSettings(guildId, slot);
  if (!existing) {
    saveStreamSettings(guildId, slot, null, null, 0);
  }
}

function getGuildState(guildId, slot) {
  const key = stateKey(guildId, slot);
  if (!guildStates.has(key)) {
    const player = createAudioPlayer();
    const state = {
      player,
      connection: null,
      ffmpegProcess: null,
      currentUrl: null,
      guildId,
      slot,
    };

    player.on(AudioPlayerStatus.Idle, () => {
      if (state.currentUrl) {
        setTimeout(() => {
          play(guildId, slot, state.currentUrl).catch((err) => {
            log("play", `Retry failed [${guildId}#${slot}] ${err.message}`);
          });
        }, STREAM_RETRY_MS);
      }
    });

    player.on("stateChange", (oldState, newState) => {
      log("player", `State [${guildId}#${slot}] ${oldState.status} -> ${newState.status}`);
    });

    player.on("debug", (message) => {
      log("player", `Debug [${guildId}#${slot}] ${message}`);
    });

    player.on("error", (err) => {
      log("audio", `Fehler [${guildId}#${slot}] ${err.message}`);
      if (state.currentUrl) {
        setTimeout(() => {
          play(guildId, slot, state.currentUrl).catch((err2) => {
            log("play", `Retry failed [${guildId}#${slot}] ${err2.message}`);
          });
        }, STREAM_RETRY_MS);
      }
    });

    guildStates.set(key, state);
  }
  return guildStates.get(key);
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
  const info = await execFileCapture(YTDLP_PATH, ["-J", "--no-warnings", "--skip-download", url], 30_000);
  const json = JSON.parse(info.stdout);
  const stream = await execFileCapture(YTDLP_PATH, ["-f", "bestaudio", "-g", url], 30_000);
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

async function autoFetchMeta(url, guildId, slot) {
  let meta = null;
  if (ytdl.validateURL(url)) {
    meta = (await resolveYouTube(url)).meta;
  } else {
    meta = await resolveHttpMeta(url);
  }
  await updateStreamMeta(guildId, slot, meta, null, null);
  log("meta", `Auto meta [${guildId}#${slot}] ${meta?.title || "unknown"}`);
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
      log("ytdl", `yt-dlp Fehler [${state.guildId}#${state.slot}] ${err.message}`);
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
    log("ffmpeg", `Exit [${state.guildId}#${state.slot}] code=${code} signal=${signal}`);
  });
  state.ffmpegProcess.stderr?.on("data", (chunk) => {
    const text = chunk.toString().trim();
    if (text) {
      log("ffmpeg", `stderr [${state.guildId}#${state.slot}] ${text}`);
    }
  });

  return {
    resource: createAudioResource(state.ffmpegProcess.stdout, {
      inputType: StreamType.Raw,
    }),
    meta,
  };
}

async function play(guildId, slot, url) {
  const state = getGuildState(guildId, slot);
  state.currentUrl = url;
  const { resource, meta } = await createStreamResourceAsync(state, url);
  state.player.play(resource);
  log("play", `Start [${guildId}#${slot}] ${url}`);
  await updateNowPlaying(guildId, slot, meta);
}

async function connectToChannel(guild, channel, slot) {
  const state = getGuildState(guild.id, slot);

  if (state.connection) {
    state.connection.destroy();
    state.connection = null;
  }

  log("voice", `Join request [${guild.id}#${slot}] -> ${channel.name} (${channel.type})`);

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
  });

  connection.on("stateChange", (oldState, newState) => {
    log("voice", `State [${guild.id}#${slot}] ${oldState.status} -> ${newState.status}`);
  });

  connection.on("error", (err) => {
    log("voice", `Error [${guild.id}#${slot}] ${err.message}`);
  });

  connection.on("debug", (message) => {
    log("voice", `Debug [${guild.id}#${slot}] ${message}`);
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
      log("voice", `Disconnected [${guild.id}#${slot}]`);
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
      log("voice", `Stage unsuppressed [${guild.id}#${slot}]`);
    } catch (err) {
      log("voice", `Stage unsuppress failed [${guild.id}#${slot}] ${err.message}`);
    }
  }

  log("voice", `Verbunden [${guild.id}#${slot}] -> ${channel.name}`);
  return state;
}

async function startGuildFromSettings(guildId, slot) {
  const settings = getStreamSettings(guildId, slot);
  if (!settings || !settings.voice_channel_id || !settings.stream_url) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const channel = await guild.channels.fetch(settings.voice_channel_id);
  if (!channel || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) return;
  await connectToChannel(guild, channel, slot);
  await play(guildId, slot, settings.stream_url);
}

function stopGuildStream(guildId, slot) {
  const state = getGuildState(guildId, slot);
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
  log("play", `Stop [${guildId}#${slot}]`);
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

async function getOrCreateThread(baseChannel, voiceChannelName, slot, settings) {
  if (!baseChannel?.threads?.create) return null;

  if (settings?.meta_thread_id) {
    const thread = await baseChannel.threads.fetch(settings.meta_thread_id).catch(() => null);
    if (thread) return thread;
  }

  const threadName = `${voiceChannelName || "voice"}-slot-${slot}`;
  const thread = await baseChannel.threads.create({
    name: threadName.slice(0, 100),
    autoArchiveDuration: 1440,
    reason: "Radio stream updates",
  });
  return thread;
}

async function updateStreamMeta(guildId, slot, meta, metaChannelId, metaThreadId) {
  const current = getStreamSettings(guildId, slot) || {};
  const stmt = db.prepare(`
    UPDATE guild_streams SET
      meta_channel_id = @metaChannelId,
      meta_thread_id = @metaThreadId,
      last_title = @lastTitle,
      last_source = @lastSource,
      last_quality = @lastQuality,
      last_url = @lastUrl,
      updated_at = @updatedAt
    WHERE guild_id = @guildId AND slot = @slot
  `);
  stmt.run({
    guildId,
    slot,
    metaChannelId: metaChannelId ?? current.meta_channel_id ?? null,
    metaThreadId: metaThreadId ?? current.meta_thread_id ?? null,
    lastTitle: meta?.title ?? current.last_title ?? null,
    lastSource: meta?.source ?? current.last_source ?? null,
    lastQuality: meta?.quality ?? current.last_quality ?? null,
    lastUrl: meta?.url ?? current.last_url ?? null,
    updatedAt: Date.now(),
  });
}

async function updateNowPlaying(guildId, slot, meta) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const settings = getStreamSettings(guildId, slot) || {};
  const voiceChannel = settings.voice_channel_id
    ? await guild.channels.fetch(settings.voice_channel_id).catch(() => null)
    : null;

  updatePresence(meta?.title || "Radio");

  const baseChannel = await resolveMetaChannel(guild, voiceChannel, settings);
  if (!baseChannel) return;

  const thread = await getOrCreateThread(baseChannel, voiceChannel?.name, slot, settings);
  const target = thread || baseChannel;

  const title = meta?.title || settings.last_title || "Unbekannter Stream";
  const source = meta?.source || settings.last_source || "Quelle unbekannt";
  const quality = meta?.quality || settings.last_quality || "48 kHz (Discord)";
  const link = meta?.url || settings.last_url || settings.stream_url || "—";

  const message = [
    `**Jetzt laeuft (Slot ${slot})**`,
    `Titel: ${title}`,
    `Quelle: ${source}`,
    `Link: ${link}`,
    `Audio: ${quality}`,
  ].join("\n");

  await target.send({ content: message }).catch((err) => {
    log("meta", `Post failed [${guildId}#${slot}] ${err.message}`);
  });

  await updateStreamMeta(guildId, slot, meta, baseChannel.id, thread?.id || null);
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
      .setDescription("Setzt den Sprachkanal fuer einen Slot.")
      .addIntegerOption((option) =>
        option.setName("slot").setDescription("Slot 1-3").setRequired(true)
      )
      .addChannelOption((option) =>
        option.setName("kanal").setDescription("Sprachkanal").setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("setstream")
      .setDescription("Setzt die Stream-URL fuer einen Slot.")
      .addIntegerOption((option) =>
        option.setName("slot").setDescription("Slot 1-3").setRequired(true)
      )
      .addStringOption((option) =>
        option.setName("url").setDescription("Stream-URL").setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("play")
      .setDescription("Startet den Stream fuer einen Slot.")
      .addIntegerOption((option) =>
        option.setName("slot").setDescription("Slot 1-3").setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Stoppt den Stream fuer einen Slot.")
      .addIntegerOption((option) =>
        option.setName("slot").setDescription("Slot 1-3").setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Zeigt Einstellungen fuer alle Slots."),
    new SlashCommandBuilder()
      .setName("setmetachannel")
      .setDescription("Setzt den Textkanal fuer Now-Playing Updates.")
      .addIntegerOption((option) =>
        option.setName("slot").setDescription("Slot 1-3").setRequired(true)
      )
      .addChannelOption((option) =>
        option.setName("kanal").setDescription("Textkanal").setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("setmeta")
      .setDescription("Optional: Metadaten manuell setzen (ueberschreibt auto).")
      .addIntegerOption((option) =>
        option.setName("slot").setDescription("Slot 1-3").setRequired(true)
      )
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
  store: new SQLiteSessionStore({ client: sessionDb }),
  resave: false,
  saveUninitialized: false,
}));

app.get("/", (req, res) => {
  const totalGuilds = client.guilds.cache.size;
  const configured = db.prepare(`
    SELECT COUNT(DISTINCT guild_id) as count
    FROM guild_streams
    WHERE voice_channel_id IS NOT NULL AND stream_url IS NOT NULL
  `).get().count;
  const activeStreams = [...guildStates.values()].filter((state) => state.currentUrl).length;

  const body = `
    <section class="hero">
      <h1>Discord Radio Hosting</h1>
      <p>Ein Bot, viele Server. Ein Dashboard, um Kanal und Stream zu verwalten.</p>
      <div class="cta">
        <a class="button" href="${inviteUrl()}">Bot hinzufuegen</a>
        <a class="button secondary" href="/dashboard">Dashboard</a>
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

app.get("/dashboard", requireLogin, async (req, res) => {
  const flash = req.session.flash;
  req.session.flash = null;

  const user = req.session.user;
  const guilds = manageableGuilds(req.session.guilds || []);
  const cards = [];

  for (const guild of guilds) {
    const botGuild = client.guilds.cache.get(guild.id);
    const settingsRows = getGuildStreams(guild.id);
    const settingsBySlot = new Map(settingsRows.map((row) => [row.slot, row]));
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
      : `<a class="button secondary" href="${inviteUrl(guild.id)}">Bot hinzufuegen</a>`;

    const slots = [];
    for (let slot = 1; slot <= MAX_SLOTS; slot += 1) {
      const settings = settingsBySlot.get(slot) || {};
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

      slots.push(`
        <div class="card">
          <div class="row">
            <h3>Slot ${slot}</h3>
            ${slot === 1 ? `<span class="pill">Standard</span>` : `<span class="pill">Optional</span>`}
          </div>
          <form method="post" action="/guild/${escapeHtml(guild.id)}/slot/${slot}/settings">
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
            <form method="post" action="/guild/${escapeHtml(guild.id)}/slot/${slot}/start">
              <button class="button" type="submit" ${startDisabled}>Start</button>
            </form>
            <form method="post" action="/guild/${escapeHtml(guild.id)}/slot/${slot}/stop">
              <button class="button secondary" type="submit" ${isInstalled ? "" : "disabled"}>Stop</button>
            </form>
          </div>
        </div>
      `);
    }

    cards.push(`
      <div class="card">
        <div class="row">
          <h3>${escapeHtml(guild.name)}</h3>
          ${inviteButton}
        </div>
        <p class="muted">Server ID: ${escapeHtml(guild.id)}</p>
        <div class="grid">
          ${slots.join("")}
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

app.post("/guild/:id/slot/:slot/settings", requireLogin, async (req, res) => {
  const guildId = req.params.id;
  const slot = Number(req.params.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) {
    return res.status(400).send("Ungueltiger Slot.");
  }
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

  saveStreamSettings(guildId, slot, voiceChannelId, streamUrl, autoPlay);
  req.session.flash = "Einstellungen gespeichert.";

  if (autoPlay && voiceChannelId && streamUrl) {
    try {
      await startGuildFromSettings(guildId, slot);
    } catch (err) {
      log("autoplay", `Fehler [${guildId}#${slot}] ${err.message}`);
    }
  }

  return res.redirect("/dashboard");
});

app.post("/guild/:id/slot/:slot/start", requireLogin, async (req, res) => {
  const guildId = req.params.id;
  const slot = Number(req.params.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) {
    return res.status(400).send("Ungueltiger Slot.");
  }
  if (!hasManageGuild(req, guildId)) {
    return res.status(403).send("Keine Berechtigung.");
  }

  const settings = getStreamSettings(guildId, slot);
  if (!settings || !settings.voice_channel_id || !settings.stream_url) {
    req.session.flash = "Bitte Kanal und Stream zuerst setzen.";
    return res.redirect("/dashboard");
  }

  try {
    await startGuildFromSettings(guildId, slot);
    req.session.flash = "Stream gestartet.";
  } catch (err) {
    req.session.flash = `Start fehlgeschlagen: ${err.message}`;
  }

  return res.redirect("/dashboard");
});

app.post("/guild/:id/slot/:slot/stop", requireLogin, (req, res) => {
  const guildId = req.params.id;
  const slot = Number(req.params.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) {
    return res.status(400).send("Ungueltiger Slot.");
  }
  if (!hasManageGuild(req, guildId)) {
    return res.status(403).send("Keine Berechtigung.");
  }

  stopGuildStream(guildId, slot);
  req.session.flash = "Stream gestoppt.";
  return res.redirect("/dashboard");
});

client.on("guildCreate", (guild) => {
  const existing = getStreamSettings(guild.id, 1);
  if (!existing) {
    saveStreamSettings(guild.id, 1, null, null, 0);
  }
});

client.on("guildDelete", (guild) => {
  for (let slot = 1; slot <= MAX_SLOTS; slot += 1) {
    stopGuildStream(guild.id, slot);
  }
});

client.once(Events.ClientReady, async () => {
  log("bot", `Logged in as ${client.user.tag}`);
  registerCommands().catch((err) => {
    log("discord", `Command registration failed: ${err.message}`);
  });
  const autoPlay = listAutoPlaySettings();
  for (const entry of autoPlay) {
    try {
      await startGuildFromSettings(entry.guild_id, entry.slot);
    } catch (err) {
      log("autoplay", `Fehler [${entry.guild_id}#${entry.slot}] ${err.message}`);
    }
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;

  const guildId = interaction.guild.id;
  log("cmd", `/${interaction.commandName} by ${interaction.user?.tag || interaction.user?.id} in ${guildId}`);

  if (interaction.commandName === "help") {
    const help = [
      "/setchannel slot:<1-3> kanal:<Sprachkanal>",
      "/setstream slot:<1-3> url:<Stream-URL>",
      "/play slot:<1-3>",
      "/stop slot:<1-3>",
      "/status",
      "/setmetachannel slot:<1-3> kanal:<Textkanal>",
      "/setmeta slot:<1-3> titel:<...> quelle:<...> url:<...> qualitaet:<...>",
    ].join("\n");
    return interaction.reply({
      content: `Befehle:\n${help}`,
      flags: EPHEMERAL,
    });
  }

  if (interaction.commandName === "status") {
    const rows = getGuildStreams(guildId);
    if (!rows.length) {
      return interaction.reply({
        content: "Noch keine Einstellungen. Nutze /setchannel und /setstream.",
        flags: EPHEMERAL,
      });
    }
    const lines = rows
      .sort((a, b) => a.slot - b.slot)
      .map((row) => {
        const chan = row.voice_channel_id || "nicht gesetzt";
        const url = row.stream_url || "nicht gesetzt";
        const meta = row.meta_channel_id ? ` MetaChannel=${row.meta_channel_id}` : "";
        return `Slot ${row.slot}: Kanal=${chan} Stream=${url}${meta}`;
      })
      .join("\n");
    return interaction.reply({ content: lines, flags: EPHEMERAL });
  }

  const slot = interaction.options.getInteger("slot", true);
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) {
    return interaction.reply({
      content: `Slot muss zwischen 1 und ${MAX_SLOTS} liegen.`,
      flags: EPHEMERAL,
    });
  }

  if (interaction.commandName === "setchannel") {
    const channel = interaction.options.getChannel("kanal", true);
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
      return interaction.reply({
        content: "Bitte einen echten Sprachkanal waehlen.",
        flags: EPHEMERAL,
      });
    }
    const current = getStreamSettings(guildId, slot) || {};
    saveStreamSettings(guildId, slot, channel.id, current.stream_url || null, current.auto_play || 0);
    return interaction.reply({
      content: `Slot ${slot}: Sprachkanal gesetzt (${channel.name}).`,
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
    ensureStreamRow(guildId, slot);
    await updateStreamMeta(guildId, slot, null, channel.id, null);
    return interaction.reply({
      content: `Slot ${slot}: Meta-Channel gesetzt (${channel.name}).`,
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
    ensureStreamRow(guildId, slot);
    await updateStreamMeta(guildId, slot, meta, null, null);
    return interaction.reply({
      content: `Slot ${slot}: Metadaten gespeichert.`,
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
    const current = getStreamSettings(guildId, slot) || {};
    saveStreamSettings(guildId, slot, current.voice_channel_id || null, url, current.auto_play || 0);
    autoFetchMeta(url, guildId, slot).catch((err) => {
      log("meta", `Auto fetch failed [${guildId}#${slot}] ${err.message}`);
    });
    return interaction.reply({
      content: `Slot ${slot}: Stream-URL gespeichert.`,
      flags: EPHEMERAL,
    });
  }

  if (interaction.commandName === "play") {
    const settings = getStreamSettings(guildId, slot);
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
      log("cmd", `play [${guildId}#${slot}] channel=${channel.id} url=${settings.stream_url}`);
      await connectToChannel(interaction.guild, channel, slot);
      await play(guildId, slot, settings.stream_url);
    } catch (err) {
      log("cmd", `play failed [${guildId}#${slot}] ${err.message}`);
      return interaction.followUp({
        content: `Fehler beim Start: ${err.message}`,
        flags: EPHEMERAL,
      });
    }
    return;
  }

  if (interaction.commandName === "stop") {
    stopGuildStream(guildId, slot);
    return interaction.reply({
      content: `Slot ${slot}: Stream gestoppt.`,
      flags: EPHEMERAL,
    });
  }
});

client.login(config.token);

app.listen(config.port, () => {
  log("web", `Listening on port ${config.port}`);
});
