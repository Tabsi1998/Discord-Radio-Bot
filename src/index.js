import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
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
import { loadStations } from "./stations-store.js";
import { loadBotConfigs, buildInviteUrl } from "./bot-config.js";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const webDir = path.join(rootDir, "web");
const logsDir = path.join(rootDir, "logs");
const logFile = path.join(logsDir, "bot.log");
const maxLogSizeBytes = Number(process.env.LOG_MAX_MB || "5") * 1024 * 1024;
const appStartTime = Date.now();

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
    // ignore
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
    // ignore
  }
}

function clampVolume(value) {
  return Math.max(0, Math.min(1, value / 100));
}

function formatStationPage(stations, pageInput, perPage = 10) {
  const entries = Object.entries(stations.stations);
  if (entries.length === 0) {
    return { page: 1, totalPages: 1, content: "Keine Stationen konfiguriert." };
  }

  const totalPages = Math.max(1, Math.ceil(entries.length / perPage));
  let page = Number(pageInput) || 1;
  if (page < 1) page = 1;
  if (page > totalPages) page = totalPages;

  const start = (page - 1) * perPage;
  const slice = entries.slice(start, start + perPage);
  const lines = slice.map(([key, value]) => `- ${value.name} (key: ${key})`);

  return {
    page,
    totalPages,
    content: `Seite ${page}/${totalPages}\n${lines.join("\n")}`
  };
}

function resolveStation(stations, key) {
  if (!key) {
    return stations.stations[stations.defaultStationKey]
      ? stations.defaultStationKey
      : Object.keys(stations.stations)[0] || null;
  }
  return stations.stations[key] ? key : null;
}

function getFallbackKey(stations, currentKey) {
  if (Array.isArray(stations.fallbackKeys) && stations.fallbackKeys.length) {
    const next = stations.fallbackKeys.find((k) => stations.stations[k] && k !== currentKey);
    if (next) return next;
  }

  if (stations.defaultStationKey && stations.defaultStationKey !== currentKey) {
    return stations.defaultStationKey;
  }

  const keys = Object.keys(stations.stations);
  return keys.find((k) => k !== currentKey) || null;
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

async function createResource(url, volume, qualityPreset, botName) {
  const preset = qualityPreset || "custom";
  const presetBitrate =
    preset === "low" ? "96k" : preset === "medium" ? "128k" : preset === "high" ? "192k" : null;

  const transcode = String(process.env.TRANSCODE || "0") === "1" || preset !== "custom";
  if (transcode) {
    const mode = String(process.env.TRANSCODE_MODE || "opus").toLowerCase();
    const args = [
      "-loglevel",
      "warning",
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "5",
      "-i",
      url,
      "-ar",
      "48000",
      "-ac",
      "2",
      "-af",
      "aresample=resampler=soxr"
    ];

    let inputType = StreamType.Raw;
    if (mode === "opus") {
      const bitrate = presetBitrate || String(process.env.OPUS_BITRATE || "192k");
      const vbr = String(process.env.OPUS_VBR || "on");
      const compression = String(process.env.OPUS_COMPRESSION || "10");
      const frame = String(process.env.OPUS_FRAME || "20");

      args.push(
        "-c:a",
        "libopus",
        "-b:a",
        bitrate,
        "-vbr",
        vbr,
        "-compression_level",
        compression,
        "-frame_duration",
        frame,
        "-f",
        "opus",
        "pipe:1"
      );
      inputType = StreamType.Opus;
    } else {
      args.push("-f", "s16le", "-acodec", "pcm_s16le", "pipe:1");
      inputType = StreamType.Raw;
    }

    log("INFO", `[${botName}] ffmpeg ${args.join(" ")}`);
    const ffmpeg = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    ffmpeg.stderr.on("data", (chunk) => {
      const line = chunk.toString().trim();
      if (line) log("INFO", `[${botName}] ffmpeg: ${line}`);
    });

    const resource = createAudioResource(ffmpeg.stdout, { inputType, inlineVolume: true });
    if (resource.volume) {
      resource.volume.setVolume(clampVolume(volume));
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
    resource.volume.setVolume(clampVolume(volume));
  }

  return { resource, process: null };
}

class BotRuntime {
  constructor(config) {
    this.config = config;
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
    });
    this.guildState = new Map();
    this.startedAt = Date.now();
    this.readyAt = null;
    this.startError = null;

    this.client.once("ready", () => {
      this.readyAt = Date.now();
      log("INFO", `[${this.config.name}] Eingeloggt als ${this.client.user.tag}`);
    });

    this.client.on("interactionCreate", (interaction) => {
      this.handleInteraction(interaction).catch((err) => {
        log("ERROR", `[${this.config.name}] interaction error: ${err?.stack || err}`);
      });
    });
  }

  getState(guildId) {
    if (!this.guildState.has(guildId)) {
      const player = createAudioPlayer();
      const state = {
        player,
        connection: null,
        currentStationKey: null,
        currentMeta: null,
        lastChannelId: null,
        volume: 100,
        currentProcess: null,
        lastStreamErrorAt: null,
        reconnectCount: 0,
        lastReconnectAt: null,
        reconnectAttempts: 0,
        reconnectTimer: null,
        shouldReconnect: false
      };

      player.on(AudioPlayerStatus.Idle, () => {
        this.restartCurrentStation(state).catch(() => {
          // ignore idle retry errors
        });
      });

      player.on("error", (err) => {
        state.lastStreamErrorAt = new Date().toISOString();
        log("ERROR", `[${this.config.name}] AudioPlayer error: ${err?.message || err}`);
      });

      this.guildState.set(guildId, state);
    }

    return this.guildState.get(guildId);
  }

  clearReconnectTimer(state) {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
  }

  clearCurrentProcess(state) {
    if (state.currentProcess) {
      state.currentProcess.kill("SIGKILL");
      state.currentProcess = null;
    }
  }

  trackProcessLifecycle(state, process) {
    if (!process) return;
    process.on("close", () => {
      if (state.currentProcess === process) {
        state.currentProcess = null;
      }
    });
  }

  async playStation(state, stations, key) {
    const station = stations.stations[key];
    if (!station) throw new Error("Station nicht gefunden.");

    this.clearCurrentProcess(state);
    const { resource, process } = await createResource(
      station.url,
      state.volume,
      stations.qualityPreset,
      this.config.name
    );

    state.currentProcess = process;
    this.trackProcessLifecycle(state, process);

    state.player.play(resource);
    state.currentStationKey = key;
    state.currentMeta = null;

    fetchStreamInfo(station.url)
      .then((meta) => {
        if (state.currentStationKey === key) {
          state.currentMeta = meta;
        }
      })
      .catch(() => {
        // ignore metadata lookup errors
      });
  }

  async restartCurrentStation(state) {
    if (!state.shouldReconnect || !state.currentStationKey) return;

    const stations = loadStations();
    const key = state.currentStationKey;
    if (!stations.stations[key]) {
      state.currentStationKey = null;
      state.currentMeta = null;
      return;
    }

    try {
      await this.playStation(state, stations, key);
    } catch (err) {
      state.lastStreamErrorAt = new Date().toISOString();
      log("ERROR", `[${this.config.name}] Auto-restart error: ${err.message}`);
    }
  }

  attachConnectionHandlers(guildId, connection) {
    const state = this.getState(guildId);

    const markDisconnected = () => {
      if (state.connection === connection) {
        state.connection = null;
      }
    };

    connection.on(VoiceConnectionStatus.Disconnected, () => {
      markDisconnected();
      if (!state.shouldReconnect) return;
      this.scheduleReconnect(guildId);
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      markDisconnected();
    });

    connection.on("error", (err) => {
      log("ERROR", `[${this.config.name}] VoiceConnection error: ${err?.message || err}`);
      markDisconnected();
      if (!state.shouldReconnect) return;
      this.scheduleReconnect(guildId);
    });
  }

  async connectToVoice(interaction) {
    const member = interaction.member;
    const channel = member?.voice?.channel;
    if (!channel) {
      await interaction.reply({ content: "Du musst in einem Voice-Channel sein.", ephemeral: true });
      return null;
    }

    const guildId = interaction.guildId;
    const state = this.getState(guildId);
    state.lastChannelId = channel.id;

    if (state.connection) {
      const currentChannelId = state.connection.joinConfig?.channelId;
      if (currentChannelId === channel.id) {
        return state.connection;
      }

      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      state.connection.destroy();
      state.connection = null;
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
    state.lastReconnectAt = new Date().toISOString();
    this.clearReconnectTimer(state);

    this.attachConnectionHandlers(guildId, connection);
    return connection;
  }

  async tryReconnect(guildId) {
    const state = this.getState(guildId);
    if (!state.shouldReconnect || !state.lastChannelId) return;

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;

    const channel = await guild.channels.fetch(state.lastChannelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) return;

    if (state.connection) {
      state.connection.destroy();
      state.connection = null;
    }

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
    state.lastReconnectAt = new Date().toISOString();
    this.clearReconnectTimer(state);
    this.attachConnectionHandlers(guildId, connection);

    if (state.player.state.status === AudioPlayerStatus.Idle) {
      await this.restartCurrentStation(state);
    }
  }

  scheduleReconnect(guildId) {
    const state = this.getState(guildId);
    if (!state.shouldReconnect || !state.lastChannelId) return;
    if (state.reconnectTimer) return;

    const attempt = state.reconnectAttempts + 1;
    state.reconnectAttempts = attempt;
    const delay = Math.min(30_000, 1_000 * Math.pow(2, attempt));

    log("INFO", `[${this.config.name}] Reconnecting in ${delay}ms (attempt ${attempt})`);
    state.reconnectTimer = setTimeout(async () => {
      state.reconnectTimer = null;
      if (!state.shouldReconnect) return;

      await this.tryReconnect(guildId);
      if (state.shouldReconnect && !state.connection) {
        this.scheduleReconnect(guildId);
      }
    }, delay);

    state.reconnectCount += 1;
    state.lastReconnectAt = new Date().toISOString();
  }

  async handleAutocomplete(interaction) {
    const stations = loadStations();
    const focused = interaction.options.getFocused(true);

    if (focused.name !== "station") {
      await interaction.respond([]);
      return;
    }

    const query = String(focused.value || "").toLowerCase();
    const items = Object.entries(stations.stations)
      .map(([key, value]) => ({ key, name: value.name }))
      .filter((item) => item.key.toLowerCase().includes(query) || item.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map((item) => ({ name: `${item.name} (${item.key})`, value: item.key }));

    await interaction.respond(items);
  }

  async handleInteraction(interaction) {
    if (interaction.isAutocomplete()) {
      await this.handleAutocomplete(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (!interaction.guildId) {
      await interaction.reply({ content: "Dieser Bot funktioniert nur auf Servern.", ephemeral: true });
      return;
    }

    const stations = loadStations();
    const state = this.getState(interaction.guildId);

    if (interaction.commandName === "stations") {
      const result = formatStationPage(stations, 1, 15);
      await interaction.reply({ content: result.content, ephemeral: true });
      return;
    }

    if (interaction.commandName === "list") {
      const result = formatStationPage(stations, interaction.options.getInteger("page") || 1, 10);
      await interaction.reply({ content: result.content, ephemeral: true });
      return;
    }

    if (interaction.commandName === "now") {
      if (!state.currentStationKey) {
        await interaction.reply({ content: "Gerade laeuft nichts.", ephemeral: true });
        return;
      }

      const current = stations.stations[state.currentStationKey];
      if (!current) {
        await interaction.reply({ content: "Aktuelle Station wurde entfernt.", ephemeral: true });
        return;
      }

      const meta = state.currentMeta;
      const metaLine =
        meta && (meta.name || meta.description)
          ? `\nMeta: ${meta.name || "-"}${meta.description ? ` | ${meta.description}` : ""}`
          : "";

      await interaction.reply({
        content: `Aktuell: ${current.name}\nURL: ${current.url}${metaLine}`,
        ephemeral: false
      });
      return;
    }

    if (interaction.commandName === "pause") {
      if (!state.currentStationKey) {
        await interaction.reply({ content: "Es laeuft nichts.", ephemeral: true });
        return;
      }

      state.player.pause(true);
      await interaction.reply({ content: "Pausiert.", ephemeral: false });
      return;
    }

    if (interaction.commandName === "resume") {
      if (!state.currentStationKey) {
        await interaction.reply({ content: "Es laeuft nichts.", ephemeral: true });
        return;
      }

      state.player.unpause();
      await interaction.reply({ content: "Weiter gehts.", ephemeral: false });
      return;
    }

    if (interaction.commandName === "stop") {
      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      state.player.stop();
      this.clearCurrentProcess(state);

      if (state.connection) {
        state.connection.destroy();
        state.connection = null;
      }

      state.currentStationKey = null;
      state.currentMeta = null;
      state.reconnectAttempts = 0;

      await interaction.reply({ content: "Gestoppt und Channel verlassen.", ephemeral: false });
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
      if (resource?.volume) {
        resource.volume.setVolume(clampVolume(value));
      }

      await interaction.reply({ content: `Lautstaerke gesetzt: ${value}`, ephemeral: false });
      return;
    }

    if (interaction.commandName === "health") {
      const content = [
        `Bot: ${this.config.name}`,
        `Ready: ${this.client.isReady() ? "ja" : "nein"}`,
        `Letzter Stream-Fehler: ${state.lastStreamErrorAt || "-"}`,
        `Reconnects: ${state.reconnectCount}`,
        `Letzter Reconnect: ${state.lastReconnectAt || "-"}`,
        `Auto-Reconnect aktiv: ${state.shouldReconnect ? "ja" : "nein"}`
      ].join("\n");

      await interaction.reply({ content, ephemeral: true });
      return;
    }

    if (interaction.commandName === "status") {
      const connected = state.connection ? "ja" : "nein";
      const channelId = state.connection?.joinConfig?.channelId || state.lastChannelId || "-";
      const uptimeSec = Math.floor((Date.now() - this.startedAt) / 1000);
      const load = os.loadavg().map((v) => v.toFixed(2)).join(", ");
      const mem = `${Math.round(process.memoryUsage().rss / (1024 * 1024))}MB`;
      const station = state.currentStationKey || "-";

      const content = [
        `Bot: ${this.config.name}`,
        `Guilds (dieser Bot): ${this.client.guilds.cache.size}`,
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
      const requested = interaction.options.getString("station");
      const key = resolveStation(stations, requested);
      if (!key) {
        await interaction.reply({ content: "Unbekannte Station.", ephemeral: true });
        return;
      }

      const selectedStation = stations.stations[key];
      const connection = await this.connectToVoice(interaction);
      if (!connection) return;

      state.shouldReconnect = true;
      await interaction.deferReply();

      try {
        await this.playStation(state, stations, key);
        await interaction.editReply(`Starte: ${selectedStation?.name || key}`);
      } catch (err) {
        log("ERROR", `[${this.config.name}] Play error: ${err.message}`);
        state.lastStreamErrorAt = new Date().toISOString();

        const fallbackKey = getFallbackKey(stations, key);
        if (fallbackKey && fallbackKey !== key && stations.stations[fallbackKey]) {
          try {
            await this.playStation(state, stations, fallbackKey);
            await interaction.editReply(
              `Fehler bei ${selectedStation?.name || key}. Fallback: ${stations.stations[fallbackKey].name}`
            );
            return;
          } catch (fallbackErr) {
            log("ERROR", `[${this.config.name}] Fallback error: ${fallbackErr.message}`);
            state.lastStreamErrorAt = new Date().toISOString();
          }
        }

        state.shouldReconnect = false;
        state.player.stop();
        this.clearCurrentProcess(state);
        if (state.connection) {
          state.connection.destroy();
          state.connection = null;
        }
        state.currentStationKey = null;
        await interaction.editReply(`Fehler beim Starten: ${err.message}`);
      }
    }
  }

  async start() {
    try {
      await this.client.login(this.config.token);
      return true;
    } catch (err) {
      this.startError = err;
      log("ERROR", `[${this.config.name}] Login fehlgeschlagen: ${err?.message || err}`);
      return false;
    }
  }

  getPublicStatus() {
    return {
      id: this.config.id,
      name: this.config.name,
      clientId: this.config.clientId,
      inviteUrl: buildInviteUrl(this.config),
      ready: this.client.isReady(),
      userTag: this.client.user?.tag || null,
      guilds: this.client.guilds.cache.size,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      error: this.startError ? String(this.startError.message || this.startError) : null
    };
  }

  async stop() {
    for (const state of this.guildState.values()) {
      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      state.player.stop();
      this.clearCurrentProcess(state);
      if (state.connection) {
        state.connection.destroy();
        state.connection = null;
      }
    }

    try {
      this.client.destroy();
    } catch {
      // ignore
    }
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filename, contentType) {
  const filePath = path.join(webDir, filename);
  if (!filePath.startsWith(webDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

function startWebServer(runtimes) {
  const webInternalPort = Number(process.env.WEB_INTERNAL_PORT || "8080");
  const webPort = Number(process.env.WEB_PORT || "8081");
  const webBind = process.env.WEB_BIND || "0.0.0.0";
  const publicUrl = String(process.env.PUBLIC_WEB_URL || "").trim();

  const server = http.createServer((req, res) => {
    const requestUrl = new URL(req.url || "/", "http://localhost");

    if (requestUrl.pathname === "/api/bots") {
      sendJson(res, 200, {
        bots: runtimes.map((runtime) => runtime.getPublicStatus())
      });
      return;
    }

    if (requestUrl.pathname === "/api/stations") {
      const stations = loadStations();
      sendJson(res, 200, {
        defaultStationKey: stations.defaultStationKey,
        qualityPreset: stations.qualityPreset,
        total: Object.keys(stations.stations).length,
        stations: Object.entries(stations.stations).map(([key, value]) => ({
          key,
          name: value.name,
          url: value.url
        }))
      });
      return;
    }

    if (requestUrl.pathname === "/api/health") {
      const readyBots = runtimes.filter((runtime) => runtime.client.isReady()).length;
      sendJson(res, 200, {
        ok: true,
        uptimeSec: Math.floor((Date.now() - appStartTime) / 1000),
        bots: runtimes.length,
        readyBots
      });
      return;
    }

    if (requestUrl.pathname === "/") {
      sendFile(res, "index.html", "text/html; charset=utf-8");
      return;
    }

    if (requestUrl.pathname === "/app.js") {
      sendFile(res, "app.js", "text/javascript; charset=utf-8");
      return;
    }

    if (requestUrl.pathname === "/styles.css") {
      sendFile(res, "styles.css", "text/css; charset=utf-8");
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  });

  server.listen(webInternalPort, webBind, () => {
    log("INFO", `Webseite aktiv (container) auf http://${webBind}:${webInternalPort}`);
    log("INFO", `Webseite Host-Port: ${webPort}`);
    if (publicUrl) {
      log("INFO", `Public URL: ${publicUrl}`);
    }
  });

  return server;
}

let botConfigs;
try {
  botConfigs = loadBotConfigs(process.env);
} catch (err) {
  log("ERROR", err.message || String(err));
  process.exit(1);
}

const runtimes = botConfigs.map((config) => new BotRuntime(config));
const startResults = await Promise.all(runtimes.map((runtime) => runtime.start()));

if (!startResults.some(Boolean)) {
  log("ERROR", "Kein Bot konnte gestartet werden. Backend wird beendet.");
  process.exit(1);
}

const webServer = startWebServer(runtimes);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("INFO", `Shutdown via ${signal}...`);

  webServer.close();
  await Promise.all(runtimes.map((runtime) => runtime.stop()));
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT").catch(() => process.exit(1));
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch(() => process.exit(1));
});
