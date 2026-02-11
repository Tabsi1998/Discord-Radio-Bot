import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { Client, GatewayIntentBits } from "discord.js";
import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  entersState,
  joinVoiceChannel,
  StreamType
} from "@discordjs/voice";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stationsPath = path.resolve(__dirname, "..", "stations.json");
const logsDir = path.resolve(__dirname, "..", "logs");
const logFile = path.join(logsDir, "bot.log");
const maxLogSizeBytes = 5 * 1024 * 1024;
const startTime = Date.now();

function ensureLogsDir() {
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

function rotateLogIfNeeded() {
  try {
    if (!fs.existsSync(logFile)) return;
    const size = fs.statSync(logFile).size;
    if (size < maxLogSizeBytes) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rotated = path.join(logsDir, `bot-${stamp}.log`);
    fs.renameSync(logFile, rotated);
  } catch {
    // ignore log rotation errors
  }
}

function log(level, message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}`;
  if (level === "ERROR") {
    console.error(line);
  } else {
    console.log(line);
  }
  try {
    ensureLogsDir();
    rotateLogIfNeeded();
    fs.appendFileSync(logFile, `${line}\n`);
  } catch {
    // ignore logging errors
  }
}

function loadStations() {
  if (!fs.existsSync(stationsPath)) {
    return { defaultStationKey: null, stations: {} };
  }
  const data = JSON.parse(fs.readFileSync(stationsPath, "utf8"));
  if (!data || typeof data !== "object" || !data.stations || typeof data.stations !== "object") {
    return { defaultStationKey: null, stations: {} };
  }
  return data;
}

function saveStations(data) {
  fs.writeFileSync(stationsPath, JSON.stringify(data, null, 2));
}

let stations = loadStations();

const { DISCORD_TOKEN } = process.env;
if (!DISCORD_TOKEN) {
  log("ERROR", "Fehlende ENV Variable: DISCORD_TOKEN");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

const guildState = new Map();

function getState(guildId) {
  if (!guildState.has(guildId)) {
    const player = createAudioPlayer();
    const state = {
      player,
      connection: null,
      currentStationKey: null,
      currentMeta: null,
      lastChannelId: null,
      volume: 100,
      currentProcess: null,
      reconnectAttempts: 0,
      reconnectTimer: null
    };
    player.on(AudioPlayerStatus.Idle, async () => {
      if (!state.currentStationKey) return;
      const current = stations.stations[state.currentStationKey];
      if (!current) return;
      try {
        if (state.currentProcess) {
          state.currentProcess.kill("SIGKILL");
          state.currentProcess = null;
        }
        const { resource, process } = await createResource(current.url, state.volume);
        state.currentProcess = process;
        if (process) {
          process.on("close", () => {
            if (state.currentProcess === process) {
              state.currentProcess = null;
            }
          });
        }
        player.play(resource);
      } catch {
        // ignore; next /play will retry
      }
    });
    player.on("error", () => {
      // keep running; next idle handler will retry if possible
    });
    guildState.set(guildId, state);
  }
  return guildState.get(guildId);
}

async function fetchStreamInfo(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Icy-MetaData": "1",
        "User-Agent": "discord-radio-bot"
      },
      redirect: "follow"
    });
    const icyName = res.headers.get("icy-name");
    const icyDesc = res.headers.get("icy-description");
    if (res.body) {
      try {
        await res.body.cancel();
      } catch {
        // ignore
      }
    }
    return { name: icyName || null, description: icyDesc || null };
  } catch {
    return { name: null, description: null };
  }
}

function resolveStation(key) {
  if (!key) return stations.stations[stations.defaultStationKey] ? stations.defaultStationKey : Object.keys(stations.stations)[0];
  return stations.stations[key] ? key : null;
}

async function createResource(url, volume) {
  const transcode = String(process.env.TRANSCODE || "0") === "1";
  if (transcode) {
    const mode = String(process.env.TRANSCODE_MODE || "opus").toLowerCase();
    const args = [
      "-loglevel", "warning",
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "5",
      "-i", url,
      "-ar", "48000",
      "-ac", "2",
      "-af", "aresample=resampler=soxr"
    ];

    let inputType = StreamType.Raw;
    if (mode === "opus") {
      const bitrate = String(process.env.OPUS_BITRATE || "192k");
      const vbr = String(process.env.OPUS_VBR || "on");
      const compression = String(process.env.OPUS_COMPRESSION || "10");
      const frame = String(process.env.OPUS_FRAME || "20");
      args.push(
        "-c:a", "libopus",
        "-b:a", bitrate,
        "-vbr", vbr,
        "-compression_level", compression,
        "-frame_duration", frame,
        "-f", "opus",
        "pipe:1"
      );
      inputType = StreamType.Opus;
    } else {
      args.push(
        "-f", "s16le",
        "-acodec", "pcm_s16le",
        "pipe:1"
      );
      inputType = StreamType.Raw;
    }

    log("INFO", `ffmpeg ${args.join(" ")}`);
    const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    ffmpeg.stderr.on("data", (chunk) => {
      const line = chunk.toString().trim();
      if (line) log("INFO", `ffmpeg: ${line}`);
    });
    const resource = createAudioResource(ffmpeg.stdout, { inputType, inlineVolume: true });
    if (resource.volume) {
      resource.volume.setVolume(Math.max(0, Math.min(1, volume / 100)));
    }
    return { resource, process: ffmpeg };
  }

  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) {
    throw new Error(`Stream konnte nicht geladen werden: ${res.status}`);
  }
  const stream = Readable.fromWeb(res.body);
  const probe = await demuxProbe(stream);
  const resource = createAudioResource(probe.stream, { inputType: probe.type, inlineVolume: true });
  if (resource.volume) {
    resource.volume.setVolume(Math.max(0, Math.min(1, volume / 100)));
  }
  return { resource, process: null };
}

async function connectToVoice(interaction) {
  const member = interaction.member;
  const channel = member?.voice?.channel;
  if (!channel) {
    await interaction.reply({ content: "Du musst in einem Voice-Channel sein.", ephemeral: true });
    return null;
  }

  const state = getState(interaction.guildId);
  state.lastChannelId = channel.id;

  if (state.connection) {
    return state.connection;
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    connection.destroy();
    await interaction.reply({ content: "Konnte dem Voice-Channel nicht beitreten.", ephemeral: true });
    return null;
  }

  connection.subscribe(state.player);
  state.connection = connection;
  state.reconnectAttempts = 0;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    scheduleReconnect(interaction.guildId);
  });

  return connection;
}

async function tryReconnect(guildId) {
  const state = getState(guildId);
  if (!state.lastChannelId) return;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;
  const channel = await guild.channels.fetch(state.lastChannelId).catch(() => null);
  if (!channel || !channel.isVoiceBased()) return;

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: guild.id,
    adapterCreator: guild.voiceAdapterCreator
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
  } catch {
    connection.destroy();
    return;
  }

  connection.subscribe(state.player);
  state.connection = connection;
  state.reconnectAttempts = 0;
  state.reconnectTimer = null;
}

function scheduleReconnect(guildId) {
  const state = getState(guildId);
  if (state.reconnectTimer) return;
  const attempt = state.reconnectAttempts + 1;
  state.reconnectAttempts = attempt;
  const delay = Math.min(30_000, 1_000 * Math.pow(2, attempt));
  log("INFO", `Reconnecting in ${delay}ms (attempt ${attempt})`);
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    await tryReconnect(guildId);
    if (!state.connection) {
      scheduleReconnect(guildId);
    }
  }, delay);
}

client.once("ready", () => {
  log("INFO", `Eingeloggt als ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "station" || focused.name === "key") {
      const query = String(focused.value || "").toLowerCase();
      const items = Object.entries(stations.stations)
        .map(([key, value]) => ({ key, name: value.name }))
        .filter((item) => item.key.toLowerCase().includes(query) || item.name.toLowerCase().includes(query))
        .slice(0, 25)
        .map((item) => ({ name: `${item.name} (${item.key})`, value: item.key }));
      await interaction.respond(items);
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const state = getState(interaction.guildId);

  if (interaction.commandName === "stations") {
    const list = Object.entries(stations.stations)
      .map(([key, value]) => `• ${value.name} (key: ${key})`)
      .join("\n");
    await interaction.reply({ content: list || "Keine Stationen konfiguriert.", ephemeral: true });
    return;
  }

  if (interaction.commandName === "list") {
    const perPage = 10;
    const entries = Object.entries(stations.stations);
    if (entries.length === 0) {
      await interaction.reply({ content: "Keine Stationen konfiguriert.", ephemeral: true });
      return;
    }
    const totalPages = Math.max(1, Math.ceil(entries.length / perPage));
    let page = interaction.options.getInteger("page") || 1;
    if (page < 1) page = 1;
    if (page > totalPages) page = totalPages;
    const start = (page - 1) * perPage;
    const slice = entries.slice(start, start + perPage);
    const list = slice.map(([key, value]) => `• ${value.name} (key: ${key})`).join("\n");
    await interaction.reply({ content: `Seite ${page}/${totalPages}\n${list}`, ephemeral: true });
    return;
  }

  if (interaction.commandName === "now") {
    if (!state.currentStationKey) {
      await interaction.reply({ content: "Gerade läuft nichts.", ephemeral: true });
      return;
    }
    const current = stations.stations[state.currentStationKey];
    const meta = state.currentMeta;
    const metaLine = meta && (meta.name || meta.description)
      ? `\nMeta: ${meta.name || "-"}${meta.description ? ` | ${meta.description}` : ""}`
      : "";
    await interaction.reply({ content: `Aktuell: ${current.name}\nURL: ${current.url}${metaLine}`, ephemeral: false });
    return;
  }

  if (interaction.commandName === "pause") {
    state.player.pause(true);
    await interaction.reply({ content: "Pausiert.", ephemeral: false });
    return;
  }

  if (interaction.commandName === "resume") {
    state.player.unpause();
    await interaction.reply({ content: "Weiter geht's.", ephemeral: false });
    return;
  }

  if (interaction.commandName === "stop") {
    state.player.stop();
    if (state.currentProcess) {
      state.currentProcess.kill("SIGKILL");
      state.currentProcess = null;
    }
    if (state.connection) {
      state.connection.destroy();
      state.connection = null;
    }
    state.currentStationKey = null;
    await interaction.reply({ content: "Gestoppt und Channel verlassen.", ephemeral: false });
    return;
  }

  if (interaction.commandName === "addstation") {
    const name = interaction.options.getString("name", true).trim();
    const url = interaction.options.getString("url", true).trim();
    let key = interaction.options.getString("key", false);
    if (key) {
      key = key.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    } else {
      key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    }
    if (!key) {
      await interaction.reply({ content: "Ungültiger Key.", ephemeral: true });
      return;
    }
    if (stations.stations[key]) {
      await interaction.reply({ content: "Key existiert bereits.", ephemeral: true });
      return;
    }
    stations.stations[key] = { name, url };
    if (!stations.defaultStationKey) {
      stations.defaultStationKey = key;
    }
    saveStations(stations);
    await interaction.reply({ content: `Station hinzugefügt: ${name} (key: ${key})`, ephemeral: false });
    return;
  }

  if (interaction.commandName === "setdefault") {
    const key = interaction.options.getString("key", true);
    if (!stations.stations[key]) {
      await interaction.reply({ content: "Station nicht gefunden.", ephemeral: true });
      return;
    }
    stations.defaultStationKey = key;
    saveStations(stations);
    await interaction.reply({ content: `Default gesetzt: ${key}`, ephemeral: false });
    return;
  }

  if (interaction.commandName === "renamestation") {
    const key = interaction.options.getString("key", true);
    const name = interaction.options.getString("name", true).trim();
    if (!stations.stations[key]) {
      await interaction.reply({ content: "Station nicht gefunden.", ephemeral: true });
      return;
    }
    stations.stations[key].name = name;
    saveStations(stations);
    await interaction.reply({ content: `Station umbenannt: ${key} -> ${name}`, ephemeral: false });
    return;
  }

  if (interaction.commandName === "removestation") {
    const key = interaction.options.getString("key", true);
    if (!stations.stations[key]) {
      await interaction.reply({ content: "Station nicht gefunden.", ephemeral: true });
      return;
    }
    delete stations.stations[key];
    if (stations.defaultStationKey === key) {
      stations.defaultStationKey = Object.keys(stations.stations)[0] || null;
    }
    if (state.currentStationKey === key) {
      state.player.stop();
      state.currentStationKey = null;
    }
    saveStations(stations);
    await interaction.reply({ content: `Station entfernt: ${key}`, ephemeral: false });
    return;
  }

  if (interaction.commandName === "setvolume") {
    const value = interaction.options.getInteger("value", true);
    if (value < 0 || value > 100) {
      await interaction.reply({ content: "Wert muss zwischen 0 und 100 liegen.", ephemeral: true });
      return;
    }
    state.volume = value;
    const resource = state.player.state.resource;
    if (resource && resource.volume) {
      resource.volume.setVolume(Math.max(0, Math.min(1, value / 100)));
    }
    await interaction.reply({ content: `Lautstärke gesetzt: ${value}`, ephemeral: false });
    return;
  }

  if (interaction.commandName === "status") {
    const connected = state.connection ? "ja" : "nein";
    const channelId = state.connection?.joinConfig?.channelId || state.lastChannelId || "-";
    const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
    const load = os.loadavg().map((v) => v.toFixed(2)).join(", ");
    const mem = `${Math.round(process.memoryUsage().rss / (1024 * 1024))}MB`;
    const station = state.currentStationKey ? `${state.currentStationKey}` : "-";
    const content = [
      `Verbunden: ${connected}`,
      `Channel: ${channelId}`,
      `Station: ${station}`,
      `Uptime: ${uptimeSec}s`,
      `Load: ${load}`,
      `RAM: ${mem}`
    ].join("\n");
    await interaction.reply({ content, ephemeral: true });
    return;
  }

  if (interaction.commandName === "play") {
    const key = resolveStation(interaction.options.getString("station"));
    if (!key) {
      await interaction.reply({ content: "Unbekannte Station.", ephemeral: true });
      return;
    }

    const station = stations.stations[key];
    const connection = await connectToVoice(interaction);
    if (!connection) return;

    await interaction.deferReply();

    try {
      if (state.currentProcess) {
        state.currentProcess.kill("SIGKILL");
        state.currentProcess = null;
      }
      const { resource, process } = await createResource(station.url, state.volume);
      state.currentProcess = process;
      if (process) {
        process.on("close", () => {
          if (state.currentProcess === process) {
            state.currentProcess = null;
          }
        });
      }
      state.player.play(resource);
      state.currentStationKey = key;
      state.currentMeta = null;
      fetchStreamInfo(station.url).then((meta) => {
        state.currentMeta = meta;
      });
      await interaction.editReply(`Starte: ${station.name}`);
    } catch (err) {
      log("ERROR", `Play error: ${err.message}`);
      await interaction.editReply(`Fehler beim Starten: ${err.message}`);
    }
  }
});

client.login(DISCORD_TOKEN);
