import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { REST } from "@discordjs/rest";
import { ActivityType, ChannelType, Client, GatewayIntentBits, PermissionFlagsBits, Routes } from "discord.js";
import {
  AudioPlayerStatus,
  VoiceConnectionStatus,
  NoSubscriberBehavior,
  createAudioPlayer,
  createAudioResource,
  demuxProbe,
  entersState,
  joinVoiceChannel,
  StreamType
} from "@discordjs/voice";
import dotenv from "dotenv";
import { BRAND, PLANS } from "./config/plans.js";
import { setLicenseProvider, getServerPlan, getServerPlanConfig, requirePlan, requireFeature, getBitrateFlag, getReconnectDelay, getMaxBots, isBotAllowed, planAtLeast } from "./core/entitlements.js";
import { premiumStationEmbed, hqAudioEmbed, customStationEmbed, botLimitEmbed } from "./ui/upgradeEmbeds.js";
import {
  isConfigured as isEmailConfigured,
  sendMail, getSmtpConfig,
  buildPurchaseEmail, buildAdminNotification, buildInvoiceEmail,
  buildExpiryWarningEmail, buildExpiryEmail
} from "./email.js";
import { loadBotConfigs, buildInviteUrl } from "./bot-config.js";
import {
  getServerLicense, listLicenses as listRawLicenses,
  createLicense, linkServerToLicense, unlinkServerFromLicense, getLicenseById, extendLicense,
  isSessionProcessed, markSessionProcessed, isEventProcessed, markEventProcessed,
  addLicenseForServer, patchLicenseForServer, upgradeLicenseForServer,
} from "./premium-store.js";
import { saveBotState, getBotState, clearBotGuild } from "./bot-state.js";
import { buildCommandBuilders } from "./commands.js";
import { loadStations, resolveStation, filterStationsByTier, getFallbackKey } from "./stations-store.js";
import { getGuildStations, addGuildStation, removeGuildStation, countGuildStations, MAX_STATIONS_PER_GUILD } from "./custom-stations.js";

dotenv.config();

// ============================================================
// OmniFM: Entitlements Wiring & Legacy Compatibility
// ============================================================
setLicenseProvider(getServerLicense);

const PRICE_PER_MONTH_CENTS = { free: 0, pro: 299, ultimate: 499 };

const TIERS = Object.fromEntries(
  Object.entries(PLANS).map(([key, plan]) => [key, {
    ...plan, tier: key, pricePerMonth: PRICE_PER_MONTH_CENTS[key] || 0,
  }])
);

function getTierConfig(serverId) {
  const config = getServerPlanConfig(serverId);
  return { ...config, tier: config.plan };
}

function getTier(serverId) {
  return getServerPlan(serverId);
}

function getLicense(serverId) {
  return getServerLicense(serverId);
}

function addLicense(serverId, tier, months, activatedBy, note) {
  return addLicenseForServer(serverId, tier, months, activatedBy, note);
}

function patchLicense(serverId, patch) {
  return patchLicenseForServer(serverId, patch);
}

function upgradeLicense(serverId, newTier) {
  return upgradeLicenseForServer(serverId, newTier);
}

function calculatePrice(tier, months) {
  const ppm = PRICE_PER_MONTH_CENTS[tier];
  if (!ppm) return 0;
  if (months >= 12) return ppm * 10;
  return ppm * months;
}

function calculateUpgradePrice(serverId, targetTier) {
  const lic = getServerLicense(serverId);
  if (!lic || lic.expired || !lic.active) return null;
  const oldTier = lic.plan || "free";
  if (oldTier === targetTier) return null;
  if (!planAtLeast(targetTier, oldTier)) return null;
  const daysLeft = lic.remainingDays || 0;
  if (daysLeft <= 0) return null;
  const oldPpm = PRICE_PER_MONTH_CENTS[oldTier] || 0;
  const newPpm = PRICE_PER_MONTH_CENTS[targetTier] || 0;
  const diff = newPpm - oldPpm;
  if (diff <= 0) return null;
  return { oldTier, targetTier, daysLeft, upgradeCost: Math.ceil(diff * daysLeft / 30) };
}

function listLicenses() {
  const raw = listRawLicenses();
  const byServer = {};
  for (const [, lic] of Object.entries(raw)) {
    for (const sid of (lic.linkedServerIds || [])) {
      byServer[sid] = { ...lic, tier: lic.plan };
    }
  }
  return byServer;
}
// ============================================================

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

function clipText(value, max = 100) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
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

const TIER_RANK = { free: 0, pro: 1, ultimate: 2 };

function getStripeSecretKey() {
  return String(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || "").trim();
}

function getRequestOrigin(req) {
  const host = String(req.headers.host || "").trim();
  if (!host) return null;
  const protoHeader = String(req.headers["x-forwarded-proto"] || "").trim().toLowerCase();
  const proto = protoHeader === "https" ? "https" : "http";
  return `${proto}://${host}`;
}

function toOrigin(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function buildAllowedReturnOrigins(publicUrl, req) {
  const configured = String(process.env.CHECKOUT_RETURN_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  const candidates = [
    ...configured,
    publicUrl,
    getRequestOrigin(req),
    "http://localhost",
    "http://127.0.0.1"
  ];

  const allowed = new Set();
  for (const candidate of candidates) {
    const origin = toOrigin(candidate);
    if (origin) allowed.add(origin);
  }
  return allowed;
}

function resolveCheckoutReturnBase(returnUrl, publicUrl, req) {
  const fallback = toOrigin(publicUrl) || toOrigin(getRequestOrigin(req)) || "http://localhost";
  if (!returnUrl) return fallback;

  let parsed;
  try {
    parsed = new URL(String(returnUrl).trim());
  } catch {
    return fallback;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fallback;

  const allowed = buildAllowedReturnOrigins(publicUrl, req);
  if (!allowed.has(parsed.origin)) {
    log("INFO", `Checkout returnUrl verworfen (nicht erlaubt): ${parsed.origin}`);
    return fallback;
  }

  const safePath = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
  return `${parsed.origin}${safePath}`;
}

function buildApiCommands() {
  return buildCommandBuilders().map((builder) => {
    const json = builder.toJSON();
    const args = Array.isArray(json.options)
      ? json.options
          .filter((opt) => opt.type === 3 || opt.type === 4)
          .map((opt) => (opt.required ? `<${opt.name}>` : `[${opt.name}]`))
          .join(" ")
      : "";

    return {
      name: `/${json.name}`,
      args,
      description: json.description,
    };
  });
}

const API_COMMANDS = buildApiCommands();

async function fetchStreamInfo(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Icy-MetaData": "1",
        "User-Agent": "OmniFM/3.0"
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

async function createResource(url, volume, qualityPreset, botName, bitrateOverride) {
  const preset = qualityPreset || "custom";
  const presetBitrate =
    preset === "low" ? "96k" : preset === "medium" ? "128k" : preset === "high" ? "192k" : null;

  const transcode = String(process.env.TRANSCODE || "0") === "1" || preset !== "custom" || !!bitrateOverride;
  if (transcode) {
    const mode = String(process.env.TRANSCODE_MODE || "opus").toLowerCase();
    const args = [
      "-loglevel", "warning",
      // === Stable streaming: small buffer for resilience, low latency ===
      "-fflags", "+flush_packets+genpts+discardcorrupt",
      "-flags", "+low_delay",
      "-probesize", "32768",
      "-analyzeduration", "500000",
      "-thread_queue_size", "1024",
      // === Reconnect bei Stream-Abbruch ===
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_delay_max", "5",
      "-reconnect_on_network_error", "1",
      "-reconnect_on_http_error", "4xx,5xx",
      "-rw_timeout", "15000000",
      "-timeout", "15000000",
      // === Input ===
      "-i", url,
      "-ar", "48000",
      "-ac", "2",
      "-vn",
      "-flush_packets", "1",
    ];

    let inputType = StreamType.Raw;
    if (mode === "opus") {
      const bitrate = bitrateOverride || presetBitrate || String(process.env.OPUS_BITRATE || "192k");
      const vbr = String(process.env.OPUS_VBR || "on");
      // compression_level 5 statt 10 = weniger CPU-Last = weniger Latenz
      const compression = String(process.env.OPUS_COMPRESSION || "5");
      const frame = String(process.env.OPUS_FRAME || "20");

      args.push(
        "-c:a", "libopus",
        "-b:a", bitrate,
        "-vbr", vbr,
        "-compression_level", compression,
        "-frame_duration", frame,
        "-application", "lowdelay",
        "-packet_loss", "3",
        "-cutoff", "20000",
        "-f", "ogg",
        "pipe:1"
      );
      inputType = StreamType.OggOpus;
    } else {
      args.push("-f", "s16le", "-acodec", "pcm_s16le", "pipe:1");
      inputType = StreamType.Raw;
    }

    log("INFO", `[${botName}] ffmpeg ${args.join(" ")}`);
    const ffmpeg = spawn("ffmpeg", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, AV_LOG_FORCE_NOCOLOR: "1" }
    });

    let stderrBuffer = "";
    ffmpeg.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) log("INFO", `[${botName}] ffmpeg: ${trimmed}`);
      }
    });

    ffmpeg.on("error", (err) => {
      log("ERROR", `[${botName}] ffmpeg process error: ${err?.message || err}`);
    });

    const resource = createAudioResource(ffmpeg.stdout, {
      inputType,
      inlineVolume: true,
    });
    if (resource.volume) {
      resource.volume.setVolume(clampVolume(volume));
    }

    return { resource, process: ffmpeg };
  }

  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "OmniFM/3.0" },
    signal: AbortSignal.timeout(10_000)
  });
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
    this.voiceGroup = `bot-${this.config.clientId}`;
    this.rest = new REST({ version: "10" }).setToken(this.config.token);
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
    });
    this.guildState = new Map();
    this.startedAt = Date.now();
    this.readyAt = null;
    this.startError = null;

    this.client.once("clientReady", () => {
      this.readyAt = Date.now();
      log("INFO", `[${this.config.name}] Eingeloggt als ${this.client.user.tag}`);
      this.updatePresence();
      this.enforcePremiumGuildScope("startup").catch((err) => {
        log("ERROR", `[${this.config.name}] Premium-Guild-Scope Pruefung fehlgeschlagen: ${err?.message || err}`);
      });
      this.refreshGuildCommandsOnReady().catch((err) => {
        log("ERROR", `[${this.config.name}] Guild-Command-Sync fehlgeschlagen: ${err?.message || err}`);
      });
    });

    this.client.on("interactionCreate", (interaction) => {
      this.handleInteraction(interaction).catch((err) => {
        log("ERROR", `[${this.config.name}] interaction error: ${err?.stack || err}`);
      });
    });

    this.client.on("voiceStateUpdate", (oldState, newState) => {
      this.handleBotVoiceStateUpdate(oldState, newState);
    });

    this.client.on("guildCreate", (guild) => {
      this.handleGuildJoin(guild).then((allowed) => {
        if (!allowed) return;
        this.syncGuildCommandForGuild(guild.id, "join").catch((err) => {
          log("ERROR", `[${this.config.name}] Guild-Command-Sync (join) fehlgeschlagen: ${err?.message || err}`);
        });
      }).catch((err) => {
        log("ERROR", `[${this.config.name}] guildCreate handling error: ${err?.message || err}`);
      });
    });

    this.client.on("guildDelete", (guild) => {
      this.resetGuildRuntimeState(guild?.id);
    });
  }

  getState(guildId) {
    if (!this.guildState.has(guildId)) {
      const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play }
      });
      const state = {
        player,
        connection: null,
        currentStationKey: null,
        currentStationName: null,
        currentMeta: null,
        lastChannelId: null,
        volume: 100,
        currentProcess: null,
        lastStreamErrorAt: null,
        reconnectCount: 0,
        lastReconnectAt: null,
        reconnectAttempts: 0,
        reconnectTimer: null,
        streamRestartTimer: null,
        shouldReconnect: false,
        streamErrorCount: 0
      };

      player.on(AudioPlayerStatus.Idle, () => {
        this.handleStreamEnd(guildId, state, "idle");
      });

      player.on("error", (err) => {
        state.lastStreamErrorAt = new Date().toISOString();
        log("ERROR", `[${this.config.name}] AudioPlayer error: ${err?.message || err}`);
        this.handleStreamEnd(guildId, state, "error");
      });

      this.guildState.set(guildId, state);
    }

    return this.guildState.get(guildId);
  }

  isPremiumOnlyBot() {
    const requiredTier = String(this.config.requiredTier || "free").toLowerCase();
    return requiredTier !== "free";
  }

  resetGuildRuntimeState(guildId) {
    if (!guildId) return;
    const state = this.guildState.get(guildId);
    if (state) {
      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      state.player.stop();
      this.clearCurrentProcess(state);
      if (state.connection) {
        try { state.connection.destroy(); } catch {}
      }
      this.guildState.delete(guildId);
    }
    clearBotGuild(this.config.id, guildId);
  }

  async enforceGuildAccessForGuild(guild, source = "scope") {
    if (!this.isPremiumOnlyBot()) return true;
    if (!guild?.id) return false;

    const access = this.getGuildAccess(guild.id);
    if (access.allowed) return true;

    const reason = !access.tierAllowed ? "tier" : "maxBots";
    log(
      "INFO",
      `[${this.config.name}] Verlasse Guild ${guild.name} (${guild.id}) - Zugriff verweigert (${reason}, source=${source}, guildTier=${access.guildTier}, required=${access.requiredTier}, botIndex=${access.botIndex}, maxBots=${access.maxBots})`
    );
    this.resetGuildRuntimeState(guild.id);
    try {
      await guild.leave();
    } catch (err) {
      log("ERROR", `[${this.config.name}] Konnte Guild ${guild.id} nicht verlassen: ${err?.message || err}`);
    }
    return false;
  }

  async enforcePremiumGuildScope(source = "scope") {
    if (!this.isPremiumOnlyBot()) return;
    for (const guild of this.client.guilds.cache.values()) {
      // eslint-disable-next-line no-await-in-loop
      await this.enforceGuildAccessForGuild(guild, source);
    }
  }

  async handleGuildJoin(guild) {
    return this.enforceGuildAccessForGuild(guild, "join");
  }

  async refreshGuildCommandsOnReady() {
    await this.cleanupGlobalCommands();
    await this.cleanupGuildCommands();
    await this.syncGuildCommands("startup");
  }

  isGuildCommandSyncEnabled() {
    return String(process.env.SYNC_GUILD_COMMANDS_ON_BOOT ?? "1") !== "0";
  }

  buildGuildCommandPayload() {
    return buildCommandBuilders().map((builder) => builder.toJSON());
  }

  isGlobalCommandCleanupEnabled() {
    if (!this.isGuildCommandSyncEnabled()) return false;
    return String(process.env.CLEAN_GLOBAL_COMMANDS_ON_BOOT ?? "1") !== "0";
  }

  async syncGuildCommandForGuild(guildId, source = "sync", commandPayload = null) {
    if (!this.isGuildCommandSyncEnabled()) return false;
    if (!guildId) return false;
    const payload = commandPayload || this.buildGuildCommandPayload();
    await this.rest.put(Routes.applicationGuildCommands(this.config.clientId, guildId), { body: payload });
    return true;
  }

  async syncGuildCommands(source = "sync") {
    if (!this.isGuildCommandSyncEnabled()) return;

    const guildIds = [...this.client.guilds.cache.keys()];
    if (!guildIds.length) return;

    const payload = this.buildGuildCommandPayload();
    let synced = 0;
    let failed = 0;
    log("INFO", `[${this.config.name}] Synchronisiere Guild-Commands in ${guildIds.length} Servern (source=${source})...`);

    for (const guildId of guildIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.syncGuildCommandForGuild(guildId, source, payload);
        synced += 1;
      } catch (err) {
        failed += 1;
        log(
          "ERROR",
          `[${this.config.name}] Guild-Command-Sync fehlgeschlagen (guild=${guildId}, source=${source}): ${err?.message || err}`
        );
      }
    }

    log("INFO", `[${this.config.name}] Guild-Command-Sync fertig: ok=${synced}, failed=${failed}`);
  }

  async cleanupGlobalCommands() {
    if (!this.isGlobalCommandCleanupEnabled()) return;

    try {
      await this.rest.put(Routes.applicationCommands(this.config.clientId), { body: [] });
      log("INFO", `[${this.config.name}] Globale Commands bereinigt (Vermeidung doppelter Commands).`);
    } catch (err) {
      log("ERROR", `[${this.config.name}] Global-Command-Cleanup fehlgeschlagen: ${err?.message || err}`);
    }
  }

  clearReconnectTimer(state) {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.streamRestartTimer) {
      clearTimeout(state.streamRestartTimer);
      state.streamRestartTimer = null;
    }
  }

  clearCurrentProcess(state) {
    if (state.currentProcess) {
      try {
        state.currentProcess.kill("SIGKILL");
      } catch {
        // process may already be dead
      }
      state.currentProcess = null;
    }
  }

  trackProcessLifecycle(state, process) {
    if (!process) return;
    process.on("close", (code) => {
      if (state.currentProcess === process) {
        state.currentProcess = null;
      }
      if (code && code !== 0) {
        log("INFO", `[${this.config.name}] ffmpeg exited with code ${code}`);
      }
    });
    process.on("error", (err) => {
      log("ERROR", `[${this.config.name}] ffmpeg process error: ${err?.message || err}`);
      if (state.currentProcess === process) {
        state.currentProcess = null;
      }
    });
  }

  handleStreamEnd(guildId, state, reason) {
    if (!state.shouldReconnect || !state.currentStationKey) return;
    // Don't restart stream if there's no voice connection (reconnect handler will deal with it)
    if (!state.connection) return;

    if (reason === "error") {
      state.streamErrorCount = (state.streamErrorCount || 0) + 1;
    } else {
      state.streamErrorCount = 0;
    }

    const errorCount = state.streamErrorCount || 0;
    const tierConfig = getTierConfig(guildId);
    let delay;

    if (reason === "error") {
      // Exponential backoff: 1s, 2s, 4s, 8s, max 15s
      delay = Math.min(15000, 1000 * Math.pow(2, Math.min(errorCount - 1, 4)));
    } else {
      delay = Math.max(100, tierConfig.reconnectMs / 2);
    }

    // Too many consecutive errors: cool down for 30s
    if (errorCount >= 10) {
      delay = 30000;
      log("INFO", `[${this.config.name}] Too many stream errors (${errorCount}) guild=${guildId}, cooling down 30s`);
    }

    log("INFO", `[${this.config.name}] Stream ${reason} guild=${guildId} errors=${errorCount}, restart in ${delay}ms`);

    if (state.streamRestartTimer) {
      clearTimeout(state.streamRestartTimer);
    }

    state.streamRestartTimer = setTimeout(() => {
      state.streamRestartTimer = null;
      this.restartCurrentStation(state, guildId).catch((err) => {
        log("ERROR", `[${this.config.name}] Stream restart failed: ${err?.message || err}`);
      });
    }, delay);
  }

  async playStation(state, stations, key, guildId) {
    const station = stations.stations[key];
    if (!station) throw new Error("Station nicht gefunden.");

    this.clearCurrentProcess(state);

    // Premium: override bitrate based on tier
    let bitrateOverride = null;
    if (guildId) {
      const tierConfig = getTierConfig(guildId);
      bitrateOverride = tierConfig.bitrate;
    }

    const { resource, process } = await createResource(
      station.url,
      state.volume,
      stations.qualityPreset,
      this.config.name,
      bitrateOverride
    );

    state.currentProcess = process;
    this.trackProcessLifecycle(state, process);

    state.player.play(resource);
    state.currentStationKey = key;
    state.currentStationName = station.name || key;
    state.currentMeta = null;
    this.updatePresence();
    this.persistState();

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

  async restartCurrentStation(state, guildId) {
    if (!state.shouldReconnect || !state.currentStationKey) return;

    const stations = loadStations();
    const key = state.currentStationKey;
    if (!stations.stations[key]) {
      state.currentStationKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      this.updatePresence();
      return;
    }

    try {
      this.clearCurrentProcess(state);
      await this.playStation(state, stations, key, guildId);
      state.streamErrorCount = 0;
      log("INFO", `[${this.config.name}] Stream restarted: ${key}`);
    } catch (err) {
      state.lastStreamErrorAt = new Date().toISOString();
      log("ERROR", `[${this.config.name}] Auto-restart error for ${key}: ${err.message}`);

      const fallbackKey = getFallbackKey(stations, key);
      if (fallbackKey && stations.stations[fallbackKey]) {
        try {
          await this.playStation(state, stations, fallbackKey, guildId);
          log("INFO", `[${this.config.name}] Fallback to ${fallbackKey} after restart failure`);
        } catch (fallbackErr) {
          log("ERROR", `[${this.config.name}] Fallback restart also failed: ${fallbackErr.message}`);
        }
      }
    }
  }

  async cleanupGuildCommands() {
    const enabled = String(process.env.CLEAN_GUILD_COMMANDS_ON_BOOT ?? "1") !== "0";
    if (!enabled) return;

    const guildIds = [...this.client.guilds.cache.keys()];
    if (!guildIds.length) return;

    let cleaned = 0;
    let failed = 0;
    log("INFO", `[${this.config.name}] Bereinige Guild-Commands in ${guildIds.length} Servern...`);

    for (const guildId of guildIds) {
      try {
        await this.rest.put(Routes.applicationGuildCommands(this.config.clientId, guildId), { body: [] });
        cleaned += 1;
      } catch (err) {
        failed += 1;
        log(
          "ERROR",
          `[${this.config.name}] Guild-Command-Cleanup fehlgeschlagen (guild=${guildId}): ${err?.message || err}`
        );
      }
    }

    log(
      "INFO",
      `[${this.config.name}] Guild-Command-Cleanup fertig: ok=${cleaned}, failed=${failed}.`
    );
  }

  async resolveBotMember(guild) {
    if (guild.members.me) return guild.members.me;
    return guild.members.fetchMe().catch(() => null);
  }

  async listVoiceChannels(guild) {
    let channels = [...guild.channels.cache.values()];
    if (!channels.length) {
      await guild.channels.fetch().catch(() => null);
      channels = [...guild.channels.cache.values()];
    }

    return channels
      .filter(
        (channel) =>
          channel &&
          channel.isVoiceBased() &&
          (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)
      )
      .sort((a, b) => {
        const posDiff = (a.rawPosition || 0) - (b.rawPosition || 0);
        if (posDiff !== 0) return posDiff;
        return a.name.localeCompare(b.name, "de");
      });
  }

  async resolveVoiceChannelFromInput(guild, inputValue) {
    const raw = String(inputValue || "").trim();
    if (!raw) return null;

    const mention = raw.match(/^<#(\d+)>$/);
    const idInput = mention ? mention[1] : /^\d+$/.test(raw) ? raw : null;

    if (idInput) {
      const byId = guild.channels.cache.get(idInput) || (await guild.channels.fetch(idInput).catch(() => null));
      if (
        byId &&
        byId.isVoiceBased() &&
        (byId.type === ChannelType.GuildVoice || byId.type === ChannelType.GuildStageVoice)
      ) {
        return byId;
      }
    }

    const channels = await this.listVoiceChannels(guild);
    const query = raw.toLowerCase();
    const exact = channels.find((channel) => channel.name.toLowerCase() === query);
    if (exact) return exact;

    const startsWith = channels.find((channel) => channel.name.toLowerCase().startsWith(query));
    if (startsWith) return startsWith;

    return channels.find((channel) => channel.name.toLowerCase().includes(query)) || null;
  }

  buildPresenceActivity() {
    const activeStations = [];
    for (const state of this.guildState.values()) {
      if (!state.currentStationKey) continue;
      activeStations.push(clipText(state.currentStationName || state.currentStationKey, 96));
    }

    const publicUrl = String(process.env.PUBLIC_WEB_URL || "").trim();

    if (activeStations.length === 0) {
      return {
        type: ActivityType.Listening,
        name: publicUrl ? `${BRAND.name} | /play | ${publicUrl}` : `${BRAND.name} | /play`
      };
    }

    if (activeStations.length === 1) {
      return {
        type: ActivityType.Listening,
        name: activeStations[0]
      };
    }

    // Mehrere Guilds: Zwischen Station-Namen rotieren
    if (!this._presenceRotationIndex) this._presenceRotationIndex = 0;
    this._presenceRotationIndex = this._presenceRotationIndex % activeStations.length;
    const currentStation = activeStations[this._presenceRotationIndex];
    this._presenceRotationIndex++;
    return {
      type: ActivityType.Listening,
      name: `${currentStation} (+${activeStations.length - 1})`
    };
  }

  updatePresence() {
    if (!this.client.user) return;
    const activity = this.buildPresenceActivity();
    try {
      this.client.user.setPresence({
        status: "online",
        activities: [activity]
      });
    } catch (err) {
      log("ERROR", `[${this.config.name}] Presence update fehlgeschlagen: ${err?.message || err}`);
    }

    // Rotation starten/stoppen basierend auf Anzahl aktiver Guilds
    const activeCount = [...this.guildState.values()].filter(s => s.currentStationKey).length;
    if (activeCount > 1) {
      this.startPresenceRotation();
    } else {
      this.stopPresenceRotation();
    }
  }

  startPresenceRotation() {
    if (this._presenceInterval) return;
    this._presenceInterval = setInterval(() => this.updatePresence(), 30000);
  }

  stopPresenceRotation() {
    if (this._presenceInterval) {
      clearInterval(this._presenceInterval);
      this._presenceInterval = null;
    }
  }

  handleBotVoiceStateUpdate(oldState, newState) {
    if (!this.client.user) return;
    if (newState.id !== this.client.user.id) return;

    const guildId = newState.guild.id;
    const state = this.getState(guildId);
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    // Bot hat Channel gewechselt oder ist einem beigetreten
    if (newChannelId) {
      state.lastChannelId = newChannelId;
      return;
    }

    // Bot hat Voice verlassen
    if (!oldChannelId) return;

    // Destroy connection FIRST (so handleStreamEnd triggered by player.stop sees connection=null and skips)
    if (state.connection) {
      try { state.connection.destroy(); } catch {}
      state.connection = null;
    }
    // Now safe to stop player - Idle event fires, handleStreamEnd checks connection (null) and returns
    state.player.stop();
    this.clearCurrentProcess(state);

    // Auto-reconnect: schedule if we should reconnect and had an active station
    if (state.shouldReconnect && state.currentStationKey && state.lastChannelId) {
      log("INFO",
        `[${this.config.name}] Voice lost (Guild ${guildId}, Channel ${oldChannelId}). Scheduling auto-reconnect...`
      );
      // scheduleReconnect has built-in dedup (checks reconnectTimer)
      this.scheduleReconnect(guildId);
      return;
    }

    // Intentional disconnect (/stop or shouldReconnect=false) - clean up fully
    log("INFO",
      `[${this.config.name}] Voice left (Guild ${guildId}, Channel ${oldChannelId}). No reconnect.`
    );
    this.clearReconnectTimer(state);
    state.currentStationKey = null;
    state.currentStationName = null;
    state.currentMeta = null;
    state.lastChannelId = null;
    state.reconnectAttempts = 0;
    state.streamErrorCount = 0;
    this.updatePresence();
    this.persistState();
  }

  attachConnectionHandlers(guildId, connection) {
    const state = this.getState(guildId);

    const markDisconnected = () => {
      if (state.connection === connection) {
        state.connection = null;
      }
    };

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (!state.shouldReconnect) {
        markDisconnected();
        return;
      }

      // Try to recover the existing connection first (e.g. after region move)
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        // Connection is recovering on its own
        log("INFO", `[${this.config.name}] Voice connection recovering for guild=${guildId}`);
      } catch {
        // Recovery failed - destroy connection, voiceStateUpdate will handle reconnect
        log("INFO", `[${this.config.name}] Voice connection recovery failed for guild=${guildId}, destroying`);
        markDisconnected();
        try { connection.destroy(); } catch { /* ignore */ }
      }
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

  async connectToVoice(interaction, targetChannel = null) {
    const member = interaction.member;
    const channel = targetChannel || member?.voice?.channel;
    if (!channel) {
      await interaction.reply({
        content: "Waehle einen Voice-Channel im Command oder trete selbst einem Voice-Channel bei.",
        ephemeral: true
      });
      return null;
    }
    if (!channel.isVoiceBased()) {
      await interaction.reply({ content: "Bitte waehle einen Voice- oder Stage-Channel.", ephemeral: true });
      return null;
    }
    if (channel.guildId !== interaction.guildId) {
      await interaction.reply({ content: "Der ausgewaehlte Channel ist nicht in diesem Server.", ephemeral: true });
      return null;
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: "Guild konnte nicht ermittelt werden.", ephemeral: true });
      return null;
    }

    const me = await this.resolveBotMember(guild);
    if (!me) {
      await interaction.reply({ content: "Bot-Mitglied im Server konnte nicht geladen werden.", ephemeral: true });
      return null;
    }

    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.Connect)) {
      await interaction.reply({
        content: `Ich habe keine Berechtigung fuer ${channel.toString()} (Connect fehlt).`,
        ephemeral: true
      });
      return null;
    }
    if (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) {
      await interaction.reply({
        content: `Ich habe keine Berechtigung fuer ${channel.toString()} (Speak fehlt).`,
        ephemeral: true
      });
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
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      group: this.voiceGroup,
      selfDeaf: true
    });
    log("INFO", `[${this.config.name}] Join Voice: guild=${guild.id} channel=${channel.id} group=${this.voiceGroup}`);

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
      try { state.connection.destroy(); } catch {}
      state.connection = null;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      group: this.voiceGroup,
      selfDeaf: true
    });
    log("INFO", `[${this.config.name}] Rejoin Voice: guild=${guild.id} channel=${channel.id} group=${this.voiceGroup}`);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      try { connection.destroy(); } catch {}
      return;
    }

    connection.subscribe(state.player);
    state.connection = connection;
    state.reconnectAttempts = 0;
    state.lastReconnectAt = new Date().toISOString();
    this.clearReconnectTimer(state);
    this.attachConnectionHandlers(guildId, connection);

    // Always restart station on reconnect (stream is stale after disconnect)
    if (state.currentStationKey) {
      state.streamErrorCount = 0;
      try {
        await this.restartCurrentStation(state, guildId);
        log("INFO", `[${this.config.name}] Reconnect successful: guild=${guildId}`);
      } catch (err) {
        log("ERROR", `[${this.config.name}] Station restart after reconnect failed: ${err?.message || err}`);
      }
    }
  }

  scheduleReconnect(guildId) {
    const state = this.getState(guildId);
    if (!state.shouldReconnect || !state.lastChannelId) return;
    if (state.reconnectTimer) return;

    const attempt = state.reconnectAttempts + 1;
    state.reconnectAttempts = attempt;

    // Plan-based reconnect: use tier's reconnectMs as base, with exponential backoff
    const tierConfig = getTierConfig(guildId);
    const baseDelay = tierConfig.reconnectMs || 5000;
    const delay = Math.min(30_000, baseDelay * Math.pow(1.5, Math.min(attempt - 1, 5)));

    log("INFO", `[${this.config.name}] Reconnecting guild=${guildId} in ${Math.round(delay)}ms (attempt ${attempt}, plan=${tierConfig.tier})`);
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

  getGuildAccess(guildId) {
    const tierConfig = getTierConfig(guildId);
    const guildTier = tierConfig.tier || "free";
    const requiredTier = this.config.requiredTier || "free";
    const tierAllowed = (TIER_RANK[guildTier] ?? 0) >= (TIER_RANK[requiredTier] ?? 0);
    const botIndex = Number(this.config.index || 1);
    const maxBots = Number(tierConfig.maxBots || 0);
    const withinBotLimit = botIndex <= maxBots;

    return {
      allowed: tierAllowed && withinBotLimit,
      guildTier,
      requiredTier,
      tierAllowed,
      botIndex,
      maxBots,
      withinBotLimit,
    };
  }

  async replyAccessDenied(interaction, access) {
    if (!access.tierAllowed) {
      await interaction.reply({
        content:
          `Dieser Bot erfordert **${access.requiredTier.toUpperCase()}**.\n` +
          `Dein Server hat aktuell **${access.guildTier.toUpperCase()}**.\n` +
          `Upgrade: ${BRAND.upgradeUrl || "https://discord.gg/UeRkfGS43R"}`,
        ephemeral: true
      });
      return;
    }

    await interaction.reply(botLimitEmbed(access.guildTier, access.maxBots, access.botIndex));
  }

  async handleAutocomplete(interaction) {
    try {
      if (interaction.guildId) {
        const access = this.getGuildAccess(interaction.guildId);
        if (!access.allowed) {
          await interaction.respond([]);
          return;
        }
      }

      const focused = interaction.options.getFocused(true);

      if (focused.name === "station") {
        const stations = loadStations();
        const guildId = interaction.guildId;
        const guildTier = getTier(guildId);
        const query = String(focused.value || "").toLowerCase().trim();

        // Standard-Stationen nach Tier gefiltert
        const available = filterStationsByTier(stations.stations, guildTier);
        const allStations = Object.entries(available)
          .map(([key, value]) => {
            const badge = value.tier && value.tier !== "free" ? ` [${value.tier.toUpperCase()}]` : "";
            return { key, name: value.name, display: `${value.name}${badge}` };
          });

        // Custom Stationen (Ultimate)
        if (guildTier === "ultimate") {
          const custom = getGuildStations(guildId);
          for (const [key, station] of Object.entries(custom)) {
            allStations.push({ key, name: station.name, display: `${station.name} [CUSTOM]` });
          }
        }

        const items = (query
          ? allStations.filter((item) =>
              item.key.toLowerCase().includes(query) ||
              item.name.toLowerCase().includes(query)
            )
          : allStations
        )
          .slice(0, 25)
          .map((item) => ({ name: clipText(`${item.display} (${item.key})`, 100), value: item.key }));

        await interaction.respond(items);
        return;
      }

      // Autocomplete fuer /removestation key
      if (focused.name === "key" && interaction.commandName === "removestation") {
        const guildId = interaction.guildId;
        const custom = getGuildStations(guildId);
        const query = String(focused.value || "").toLowerCase().trim();
        const items = Object.entries(custom)
          .filter(([k, v]) => !query || k.includes(query) || v.name.toLowerCase().includes(query))
          .slice(0, 25)
          .map(([k, v]) => ({ name: `${v.name} (${k})`, value: k }));
        await interaction.respond(items);
        return;
      }

      if (focused.name === "channel") {
        if (!interaction.guild) {
          await interaction.respond([]);
          return;
        }

        const query = String(focused.value || "").trim().toLowerCase();

        // Fetch channels fresh to ensure we have the latest list
        try {
          await interaction.guild.channels.fetch();
        } catch {
          // Fallback to cached channels
        }

        const channels = await this.listVoiceChannels(interaction.guild);
        const items = channels
          .filter((channel) => {
            if (!query) return true;
            if (channel.id.includes(query)) return true;
            return channel.name.toLowerCase().includes(query);
          })
          .slice(0, 25)
          .map((channel) => {
            const prefix = channel.type === ChannelType.GuildStageVoice ? "Stage" : "Voice";
            const count = Number(channel.members?.size || 0);
            return {
              name: clipText(`${prefix}: ${channel.name} (${count})`, 100),
              value: channel.id
            };
          });

        log("INFO", `[${this.config.name}] Autocomplete channel: query="${query}" results=${items.length}/${channels.length}`);
        await interaction.respond(items);
        return;
      }

      // Unknown option
      await interaction.respond([]);
    } catch (err) {
      log("ERROR", `[${this.config.name}] Autocomplete error: ${err?.message || err}`);
      try {
        await interaction.respond([]);
      } catch {
        // interaction might have already been responded to
      }
    }
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

    const unrestrictedCommands = new Set(["premium", "license"]);
    if (!unrestrictedCommands.has(interaction.commandName)) {
      const access = this.getGuildAccess(interaction.guildId);
      if (!access.allowed) {
        await this.replyAccessDenied(interaction, access);
        return;
      }
    }

    const stations = loadStations();
    const state = this.getState(interaction.guildId);

    if (interaction.commandName === "stations") {
      const guildTier = getTier(interaction.guildId);
      const available = filterStationsByTier(stations.stations, guildTier);
      const tierLabel = guildTier !== "free" ? ` [${guildTier.toUpperCase()}]` : "";
      const list = Object.entries(available).map(([k, v]) => {
        const badge = v.tier && v.tier !== "free" ? ` [${v.tier.toUpperCase()}]` : "";
        return `\`${k}\` - ${v.name}${badge}`;
      }).join("\n");
      const custom = guildTier === "ultimate" ? getGuildStations(interaction.guildId) : {};
      const customList = Object.entries(custom).map(([k, v]) => `\`${k}\` - ${v.name} [CUSTOM]`).join("\n");
      let content = `**Verfuegbare Stationen${tierLabel} (${Object.keys(available).length}):**\n${list}`;
      if (customList) content += `\n\n**Custom Stationen (${Object.keys(custom).length}):**\n${customList}`;
      await interaction.reply({ content, ephemeral: true });
      return;
    }

    if (interaction.commandName === "list") {
      const guildTier = getTier(interaction.guildId);
      const available = filterStationsByTier(stations.stations, guildTier);
      const keys = Object.keys(available);
      const page = Math.max(1, interaction.options.getInteger("page") || 1);
      const perPage = 10;
      const start = (page - 1) * perPage;
      const end = start + perPage;
      const pageKeys = keys.slice(start, end);
      const totalPages = Math.ceil(keys.length / perPage);
      if (pageKeys.length === 0) {
        await interaction.reply({ content: `Seite ${page} hat keine Eintraege (${totalPages} Seiten).`, ephemeral: true });
        return;
      }
      const list = pageKeys.map(k => {
        const badge = available[k].tier !== "free" ? ` [${available[k].tier.toUpperCase()}]` : "";
        return `\`${k}\` - ${available[k].name}${badge}`;
      }).join("\n");
      await interaction.reply({ content: `**Stationen (Seite ${page}/${totalPages}):**\n${list}`, ephemeral: true });
      return;
    }

    if (interaction.commandName === "now") {
      const playingGuilds = this.getPlayingGuildCount();
      if (!state.currentStationKey) {
        await interaction.reply({
          content: `Hier laeuft gerade nichts.\nDieser Bot streamt aktuell auf ${playingGuilds} Server${playingGuilds === 1 ? "" : "n"}.`,
          ephemeral: true
        });
        return;
      }

      const current = stations.stations[state.currentStationKey];
      if (!current) {
        await interaction.reply({ content: "Aktuelle Station wurde entfernt.", ephemeral: true });
        return;
      }

      const channelId = state.connection?.joinConfig?.channelId || state.lastChannelId || null;
      const lines = [
        `Jetzt auf diesem Server: ${current.name}`,
        `Channel: ${channelId ? `<#${channelId}>` : "unbekannt"}`,
        `Aktiv auf ${playingGuilds} Server${playingGuilds === 1 ? "" : "n"}.`,
      ];

      const meta = state.currentMeta;
      if (meta && (meta.name || meta.description)) {
        lines.push(`Meta: ${meta.name || "-"}${meta.description ? ` | ${meta.description}` : ""}`);
      }

      await interaction.reply({
        content: lines.join("\n"),
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
      state.currentStationName = null;
      state.currentMeta = null;
      state.reconnectAttempts = 0;
      state.streamErrorCount = 0;
      this.updatePresence();

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

    if (interaction.commandName === "premium") {
      const gid = interaction.guildId;
      const tierConfig = getTierConfig(gid);
      const license = getLicense(gid);

      const tierEmoji = { free: "", pro: " [PRO]", ultimate: " [ULTIMATE]" };
      const lines = [
        `**${BRAND.name}** Premium Status${tierEmoji[tierConfig.tier] || ""}`,
        `Server: ${interaction.guild?.name || gid}`,
        `Server-ID: ${gid}`,
        `Plan: ${tierConfig.name}`,
        `Audio: ${tierConfig.bitrate} Opus`,
        `Reconnect: ${tierConfig.reconnectMs}ms`,
        `Max Bots: ${tierConfig.maxBots}`,
      ];
      if (license && !license.expired) {
        const expDate = new Date(license.expiresAt).toLocaleDateString("de-DE");
        lines.push(`Laeuft ab: ${expDate} (${license.remainingDays} Tage uebrig)`);
      } else if (license && license.expired) {
        lines.push(`Status: ABGELAUFEN`);
      }
      if (tierConfig.tier === "free") {
        lines.push("", `Upgrade auf ${BRAND.name} Pro/Ultimate fuer hoehere Qualitaet!`);
        lines.push("Infos & Support: https://discord.gg/UeRkfGS43R");
      } else {
        lines.push("", "Support: https://discord.gg/UeRkfGS43R");
      }
      await interaction.reply({ content: lines.join("\n"), ephemeral: true });
      return;
    }

    if (interaction.commandName === "health") {
      const content = [
        `Bot: ${this.config.name}`,
        `Ready: ${this.client.isReady() ? "ja" : "nein"}`,
        `Letzter Stream-Fehler: ${state.lastStreamErrorAt || "-"}`,
        `Stream-Fehler (Reihe): ${state.streamErrorCount || 0}`,
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

    if (interaction.commandName === "addstation") {
      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);
      if (guildTier !== "ultimate") {
        await interaction.reply(customStationEmbed());
        return;
      }
      const key = interaction.options.getString("key");
      const name = interaction.options.getString("name");
      const url = interaction.options.getString("url");
      const result = addGuildStation(guildId, key, name, url);
      if (result.error) {
        await interaction.reply({ content: result.error, ephemeral: true });
      } else {
        const count = countGuildStations(guildId);
        await interaction.reply({ content: `Custom Station hinzugefuegt: **${result.station.name}** (Key: \`${result.key}\`)\n${count}/${MAX_STATIONS_PER_GUILD} Slots belegt.`, ephemeral: true });
      }
      return;
    }

    if (interaction.commandName === "removestation") {
      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);
      if (guildTier !== "ultimate") {
        await interaction.reply(customStationEmbed());
        return;
      }
      const key = interaction.options.getString("key");
      if (removeGuildStation(guildId, key)) {
        await interaction.reply({ content: `Station \`${key}\` entfernt.`, ephemeral: true });
      } else {
        await interaction.reply({ content: `Station \`${key}\` nicht gefunden.`, ephemeral: true });
      }
      return;
    }

    if (interaction.commandName === "mystations") {
      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);
      if (guildTier !== "ultimate") {
        await interaction.reply(customStationEmbed());
        return;
      }
      const custom = getGuildStations(guildId);
      const keys = Object.keys(custom);
      if (keys.length === 0) {
        await interaction.reply({ content: "Keine Custom Stationen. Nutze `/addstation` um eine hinzuzufuegen.", ephemeral: true });
      } else {
        const list = keys.map(k => `\`${k}\` - ${custom[k].name}`).join("\n");
        await interaction.reply({ content: `**Custom Stationen (${keys.length}/${MAX_STATIONS_PER_GUILD}):**\n${list}`, ephemeral: true });
      }
      return;
    }

    // === /license Command ===
    if (interaction.commandName === "license") {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guildId;

      if (sub === "activate") {
        const key = interaction.options.getString("key").trim().toUpperCase();
        const lic = getLicenseById(key);

        if (!lic) {
          await interaction.reply({ content: "Lizenz-Key nicht gefunden. Bitte pruefe den Key und versuche es erneut.", ephemeral: true });
          return;
        }
        if (lic.expired) {
          await interaction.reply({ content: "Diese Lizenz ist abgelaufen. Bitte erneuere dein Abo.", ephemeral: true });
          return;
        }

        const result = linkServerToLicense(guildId, key);
        if (!result.ok) {
          const msg = result.message.includes("already linked")
            ? "Dieser Server ist bereits mit dieser Lizenz verknuepft."
            : result.message.includes("seat")
              ? `Alle ${lic.seats} Server-Slots sind belegt. Entferne zuerst einen Server mit \`/license remove\` oder upgrade auf mehr Seats.`
              : result.message;
          await interaction.reply({ content: msg, ephemeral: true });
          return;
        }

        const planName = PLANS[lic.plan]?.name || lic.plan;
        const expDate = lic.expiresAt ? new Date(lic.expiresAt).toLocaleDateString("de-DE") : "Unbegrenzt";
        const usedSeats = (lic.linkedServerIds?.length || 0) + 1;
        await interaction.reply({
          embeds: [{
            color: lic.plan === "ultimate" ? 0xBD00FF : 0xFFB800,
            title: "Lizenz aktiviert!",
            description: `Dieser Server wurde erfolgreich mit deiner **${planName}**-Lizenz verknuepft.`,
            fields: [
              { name: "Lizenz-Key", value: `\`${key}\``, inline: true },
              { name: "Plan", value: planName, inline: true },
              { name: "Server-Slots", value: `${usedSeats}/${lic.seats}`, inline: true },
              { name: "Gueltig bis", value: expDate, inline: true },
            ],
            footer: { text: "OmniFM Premium" },
          }],
          ephemeral: true,
        });
        return;
      }

      if (sub === "info") {
        const lic = getServerLicense(guildId);
        if (!lic) {
          await interaction.reply({
            content: "Dieser Server hat keine aktive Lizenz.\nNutze `/license activate <key>` um einen Lizenz-Key zu aktivieren.",
            ephemeral: true,
          });
          return;
        }

        const planName = PLANS[lic.plan]?.name || lic.plan;
        const expDate = lic.expiresAt ? new Date(lic.expiresAt).toLocaleDateString("de-DE") : "Unbegrenzt";
        const linked = lic.linkedServerIds || [];
        const tierConfig = PLANS[lic.plan] || PLANS.free;
        await interaction.reply({
          embeds: [{
            color: lic.plan === "ultimate" ? 0xBD00FF : 0xFFB800,
            title: `OmniFM ${planName}`,
            fields: [
              { name: "Plan", value: planName, inline: true },
              { name: "Server-Slots", value: `${linked.length}/${lic.seats}`, inline: true },
              { name: "Gueltig bis", value: expDate, inline: true },
              { name: "Verbleibend", value: `${lic.remainingDays} Tage`, inline: true },
              { name: "Audio", value: tierConfig.bitrate, inline: true },
              { name: "Max Bots", value: `${tierConfig.maxBots}`, inline: true },
              { name: "Reconnect", value: `${tierConfig.reconnectMs}ms`, inline: true },
            ],
            footer: { text: lic.expired ? "ABGELAUFEN" : "OmniFM Premium" },
          }],
          ephemeral: true,
        });
        return;
      }

      if (sub === "remove") {
        const lic = getServerLicense(guildId);
        if (!lic || !lic.id) {
          await interaction.reply({ content: "Dieser Server hat keine aktive Lizenz.", ephemeral: true });
          return;
        }

        const result = unlinkServerFromLicense(guildId, lic.id);
        if (!result.ok) {
          await interaction.reply({ content: "Fehler beim Entfernen: " + result.message, ephemeral: true });
          return;
        }

        await interaction.reply({
          content: "Server wurde von der Lizenz entfernt. Der Server-Slot ist jetzt frei und kann fuer einen anderen Server genutzt werden.\nNutze `/license activate <key>` um eine neue Lizenz zu aktivieren.",
          ephemeral: true,
        });
        return;
      }
    }

    if (interaction.commandName === "play") {
      const requested = interaction.options.getString("station");
      const requestedChannelInput = interaction.options.getString("channel");
      let requestedChannel = null;

      if (requestedChannelInput) {
        requestedChannel = await this.resolveVoiceChannelFromInput(interaction.guild, requestedChannelInput);
      }

      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);

      // Check standard stations first, then custom stations (Ultimate only)
      let key = resolveStation(stations, requested);
      let isCustom = false;
      let customUrl = null;

      if (key) {
        // Check tier access
        const stationTier = stations.stations[key]?.tier || "free";
        const tierRank = { free: 0, pro: 1, ultimate: 2 };
        if ((tierRank[stationTier] || 0) > (tierRank[guildTier] || 0)) {
          await interaction.reply(premiumStationEmbed(stations.stations[key].name, stationTier));
          return;
        }
      } else {
        // Check custom stations (Ultimate feature)
        const customStations = getGuildStations(guildId);
        const customKey = Object.keys(customStations).find(k => k === requested || customStations[k].name.toLowerCase() === (requested || "").toLowerCase());
        if (customKey && guildTier === "ultimate") {
          key = `custom:${customKey}`;
          isCustom = true;
          customUrl = customStations[customKey].url;
          stations.stations[key] = { name: customStations[customKey].name, url: customUrl, tier: "ultimate" };
        } else if (customKey) {
          await interaction.reply(customStationEmbed());
          return;
        } else {
          await interaction.reply({ content: "Unbekannte Station.", ephemeral: true });
          return;
        }
      }

      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({ content: "Guild konnte nicht ermittelt werden.", ephemeral: true });
        return;
      }

      if (!requestedChannel && requestedChannelInput) {
        await interaction.reply({
          content: "Voice-Channel nicht gefunden.",
          ephemeral: true
        });
        return;
      }

      const memberChannelId = interaction.member?.voice?.channel?.id || null;
      log("INFO", `[${this.config.name}] /play guild=${guildId} station=${key} custom=${isCustom} tier=${guildTier}`);

      const selectedStation = stations.stations[key];
      const connection = await this.connectToVoice(interaction, requestedChannel);
      if (!connection) return;

      state.shouldReconnect = true;
      await interaction.deferReply();

      try {
        await this.playStation(state, stations, key, guildId);
        const tierConfig = getTierConfig(guildId);
        const tierLabel = tierConfig.tier !== "free" ? ` [${tierConfig.name} ${tierConfig.bitrate}]` : "";
        await interaction.editReply(`Starte: ${selectedStation?.name || key}${tierLabel}`);
      } catch (err) {
        log("ERROR", `[${this.config.name}] Play error: ${err.message}`);
        state.lastStreamErrorAt = new Date().toISOString();

        const fallbackKey = getFallbackKey(stations, key);
        if (fallbackKey && fallbackKey !== key && stations.stations[fallbackKey]) {
          try {
            await this.playStation(state, stations, fallbackKey, guildId);
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
        state.currentStationName = null;
        this.updatePresence();
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

  collectStats() {
    const servers = this.client.guilds.cache.size;
    const users = this.client.guilds.cache.reduce((sum, guild) => sum + (Number(guild.memberCount) || 0), 0);

    let connections = 0;
    let listeners = 0;
    for (const state of this.guildState.values()) {
      if (state.connection) connections += 1;
      if (state.connection && state.currentStationKey) listeners += 1;
    }

    return { servers, users, connections, listeners };
  }

  getPlayingGuildCount() {
    let count = 0;
    for (const state of this.guildState.values()) {
      if (state.currentStationKey) count += 1;
    }
    return count;
  }

  getPublicStatus() {
    const stats = this.collectStats();
    // Per-guild details: was spielt wo
    const guildDetails = [];
    for (const [guildId, state] of this.guildState.entries()) {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) continue;
      guildDetails.push({
        guildId,
        guildName: guild.name,
        stationKey: state.currentStationKey || null,
        stationName: state.currentStationName || null,
        channelId: state.lastChannelId || null,
        channelName: state.lastChannelId ? guild.channels.cache.get(state.lastChannelId)?.name || null : null,
        volume: state.volume,
        playing: !!state.currentStationKey,
        meta: state.currentMeta || null,
      });
    }
    const isPremiumBot = this.config.requiredTier && this.config.requiredTier !== "free";
    return {
      id: this.config.id,
      name: this.config.name,
      clientId: isPremiumBot ? null : this.config.clientId,
      inviteUrl: isPremiumBot ? null : buildInviteUrl(this.config),
      requiredTier: this.config.requiredTier || "free",
      ready: this.client.isReady(),
      userTag: this.client.user?.tag || null,
      avatarUrl: this.client.user?.displayAvatarURL({ extension: "png", size: 256 }) || null,
      guilds: stats.servers,
      servers: stats.servers,
      users: stats.users,
      connections: stats.connections,
      listeners: stats.listeners,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      error: this.startError ? String(this.startError.message || this.startError) : null,
      guildDetails,
    };
  }

  // === State Persistence: Speichert aktuellen Zustand fuer Auto-Reconnect nach Restart ===
  persistState() {
    const activeCount = [...this.guildState.entries()].filter(([_, s]) => s.currentStationKey && s.lastChannelId).length;
    saveBotState(this.config.id, this.guildState);
    if (activeCount > 0) {
      log("INFO", `[${this.config.name}] State gespeichert (${activeCount} aktive Verbindung(en)).`);
    }
  }

  async restoreState(stations) {
    const saved = getBotState(this.config.id);
    if (!saved || Object.keys(saved).length === 0) {
      log("INFO", `[${this.config.name}] Kein gespeicherter State gefunden (bot-id: ${this.config.id}).`);
      return;
    }

    log("INFO", `[${this.config.name}] Stelle ${Object.keys(saved).length} Verbindung(en) wieder her...`);

    for (const [guildId, data] of Object.entries(saved)) {
      try {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
          log("INFO", `[${this.config.name}] Guild ${guildId} nicht gefunden (${this.client.guilds.cache.size} Guilds im Cache), ueberspringe.`);
          clearBotGuild(this.config.id, guildId);
          continue;
        }

        const allowedForRestore = await this.enforceGuildAccessForGuild(guild, "restore");
        if (!allowedForRestore) {
          continue;
        }

        // Fetch channel from API if not in cache
        let channel = guild.channels.cache.get(data.channelId);
        if (!channel) {
          channel = await guild.channels.fetch(data.channelId).catch(() => null);
        }
        if (!channel || !channel.isVoiceBased()) {
          log("INFO", `[${this.config.name}] Channel ${data.channelId} in ${guild.name} nicht gefunden.`);
          clearBotGuild(this.config.id, guildId);
          continue;
        }

        const stationKey = resolveStation(stations, data.stationKey);
        if (!stationKey) {
          log("INFO", `[${this.config.name}] Station ${data.stationKey} nicht mehr vorhanden.`);
          clearBotGuild(this.config.id, guildId);
          continue;
        }

        log("INFO", `[${this.config.name}] Reconnect: ${guild.name} / #${channel.name} / ${stations.stations[stationKey].name}`);

        const state = this.getState(guildId);
        state.volume = data.volume ?? 100;
        state.shouldReconnect = true;
        state.lastChannelId = data.channelId;

        const connection = joinVoiceChannel({
          channelId: channel.id,
          guildId,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: true,
          selfMute: false,
          group: this.voiceGroup,
        });

        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
        } catch {
          log("ERROR", `[${this.config.name}] Voice-Verbindung zu ${guild.name} fehlgeschlagen (Timeout).`);
          try { connection.destroy(); } catch {}
          continue;
        }

        state.connection = connection;
        connection.subscribe(state.player);
        this.attachConnectionHandlers(guildId, connection);

        await this.playStation(state, stations, stationKey, guildId);
        log("INFO", `[${this.config.name}] Wiederhergestellt: ${guild.name} -> ${stations.stations[stationKey].name}`);

        // Kurze Pause zwischen Reconnects um Rate-Limits zu vermeiden
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        log("ERROR", `[${this.config.name}] Restore fehlgeschlagen fuer Guild ${guildId}: ${err?.message || err}`);
      }
    }
  }

  async stop() {
    for (const state of this.guildState.values()) {
      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      state.player.stop();
      this.clearCurrentProcess(state);
      if (state.connection) {
        try { state.connection.destroy(); } catch { /* ignore */ }
        state.connection = null;
      }
      state.currentStationKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.streamErrorCount = 0;
    }

    try {
      this.client.destroy();
    } catch {
      // ignore
    }
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  });
  res.end(JSON.stringify(payload));
}

function sendStaticFile(res, filePath) {
  const resolved = path.resolve(filePath);
  const resolvedWebDir = path.resolve(webDir);
  if (!resolved.startsWith(resolvedWebDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(resolved)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const cacheControl = ext === ".html" ? "no-cache" : "public, max-age=86400";

  res.writeHead(200, { "Content-Type": contentType, "Cache-Control": cacheControl });
  fs.createReadStream(resolved).pipe(res);
}

function getBotAccessForTier(botConfig, tierConfig) {
  const serverTier = tierConfig?.tier || "free";
  const serverRank = TIER_RANK[serverTier] ?? 0;
  const maxBots = Number(tierConfig?.maxBots || 0);
  const botTier = botConfig.requiredTier || "free";
  const botRank = TIER_RANK[botTier] ?? 0;
  const botIndex = Number(botConfig.index || 0);
  const withinBotLimit = botIndex > 0 && botIndex <= maxBots;
  const hasTierAccess = serverRank >= botRank;

  return {
    hasTierAccess,
    withinBotLimit,
    hasAccess: hasTierAccess && withinBotLimit,
    reason: !hasTierAccess ? "tier" : !withinBotLimit ? "maxBots" : null,
  };
}

function resolvePublicWebsiteUrl() {
  const raw = String(process.env.PUBLIC_WEB_URL || "").trim();
  if (!raw) return "https://discord.gg/UeRkfGS43R";
  try {
    return new URL(raw).toString();
  } catch {
    return "https://discord.gg/UeRkfGS43R";
  }
}

function getBotInviteBucket(botConfig) {
  const index = Number(botConfig.index || 0);
  if (index >= 1 && index <= 4) return "free";
  if (index >= 5 && index <= 10) return "pro";
  if (index >= 11 && index <= 20) return "ultimate";
  const requiredTier = String(botConfig.requiredTier || "free").toLowerCase();
  if (requiredTier === "ultimate") return "ultimate";
  if (requiredTier === "pro") return "pro";
  return "free";
}

function buildInviteOverviewForTier(runtimes, tier) {
  const normalizedTier = String(tier || "free").toLowerCase();
  const hasPro = normalizedTier === "pro" || normalizedTier === "ultimate";
  const hasUltimate = normalizedTier === "ultimate";
  const overview = {
    freeWebsiteUrl: resolvePublicWebsiteUrl(),
    freeInfo: "OmniFM Bot #1 bis #4 kannst du jederzeit ueber die Webseite einladen.",
    proBots: [],
    ultimateBots: [],
  };

  const sorted = [...runtimes].sort((a, b) => Number(a.config.index || 0) - Number(b.config.index || 0));
  const seenPro = new Set();
  const seenUltimate = new Set();

  for (const runtime of sorted) {
    const index = Number(runtime.config.index || 0);
    if (hasPro && index >= 5 && index <= 10 && !seenPro.has(index)) {
      seenPro.add(index);
      overview.proBots.push({
        index,
        name: runtime.config.name,
        url: buildInviteUrl(runtime.config),
      });
      continue;
    }

    if (hasUltimate && index >= 11 && index <= 20 && !seenUltimate.has(index)) {
      seenUltimate.add(index);
      overview.ultimateBots.push({
        index,
        name: runtime.config.name,
        url: buildInviteUrl(runtime.config),
      });
      continue;
    }

    const bucket = getBotInviteBucket(runtime.config);
    if (bucket !== "pro" && bucket !== "ultimate") continue;
    const target = bucket === "ultimate" ? overview.ultimateBots : overview.proBots;
    if ((bucket === "pro" && !hasPro) || (bucket === "ultimate" && !hasUltimate)) continue;
    const seen = bucket === "ultimate" ? seenUltimate : seenPro;
    if (seen.has(index)) continue;
    seen.add(index);
    target.push({
      index: Number(runtime.config.index || 0),
      name: runtime.config.name,
      url: buildInviteUrl(runtime.config),
    });
  }

  return overview;
}

async function activatePaidStripeSession(session, runtimes, source = "verify") {
  if (!session || session.payment_status !== "paid" || !session.metadata) {
    return { success: false, status: 400, message: "Zahlung nicht abgeschlossen oder ungueltig." };
  }

  const sessionId = String(session.id || "").trim();
  if (!sessionId) {
    return { success: false, status: 400, message: "session.id fehlt." };
  }

  const { serverId, tier, months, seats, isUpgrade } = session.metadata;
  const cleanServerId = String(serverId || "").trim();
  const cleanTier = String(tier || "").trim().toLowerCase();
  const cleanSeats = [1, 2, 3, 5].includes(Number(seats)) ? Number(seats) : 1;
  const upgrade = String(isUpgrade || "false").toLowerCase() === "true";

  if (!/^\d{17,22}$/.test(cleanServerId) || !["pro", "ultimate"].includes(cleanTier)) {
    return { success: false, status: 400, message: "Session-Metadaten sind ungueltig." };
  }

  if (isSessionProcessed(sessionId)) {
    const existing = getLicense(cleanServerId);
    return {
      success: true,
      replay: true,
      serverId: cleanServerId,
      tier: cleanTier,
      expiresAt: existing?.expiresAt || null,
      remainingDays: existing?.remainingDays || 0,
      message: `Session ${sessionId} wurde bereits verarbeitet.`,
    };
  }

  let license;
  try {
    if (upgrade) {
      license = upgradeLicense(cleanServerId, cleanTier);
    } else {
      const durationMonths = Math.max(1, parseInt(months, 10) || 1);
      license = addLicense(cleanServerId, cleanTier, durationMonths, "stripe", `Session: ${sessionId}`);
    }
  } catch (err) {
    return { success: false, status: 400, message: err.message || String(err) };
  }

  markSessionProcessed(sessionId, {
    serverId: cleanServerId,
    tier: cleanTier,
    isUpgrade: upgrade,
    source,
    expiresAt: license.expiresAt,
  });

  const licInfo = getLicense(cleanServerId);
  const customerEmail = String(session.customer_details?.email || "").trim().toLowerCase();
  if (customerEmail) {
    patchLicense(cleanServerId, { contactEmail: customerEmail });
  }

  if (isEmailConfigured() && customerEmail) {
    const tierConfig = TIERS[cleanTier];
    const inviteOverview = buildInviteOverviewForTier(runtimes, cleanTier);
    const normalizedMonths = Math.max(0, parseInt(months, 10) || 0);
    const amountPaid = Number(session.amount_total || 0);

    const purchaseHtml = buildPurchaseEmail({
      tier: cleanTier,
      tierName: tierConfig.name,
      months: normalizedMonths,
      serverId: cleanServerId,
      expiresAt: license.expiresAt,
      inviteOverview,
      dashboardUrl: resolvePublicWebsiteUrl(),
      isUpgrade: upgrade,
      pricePaid: amountPaid,
      currency: session.currency || "eur",
    });
    sendMail(customerEmail, `Premium ${tierConfig.name} aktiviert!`, purchaseHtml).catch(() => {});

    const invoiceId = `OF-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${sessionId.slice(-8).toUpperCase()}`;
    const invoiceHtml = buildInvoiceEmail({
      invoiceId,
      sessionId,
      serverId: cleanServerId,
      tierName: tierConfig.name,
      tier: cleanTier,
      months: normalizedMonths,
      isUpgrade: upgrade,
      amountPaid,
      currency: session.currency || "eur",
      issuedAt: new Date().toISOString(),
      expiresAt: license.expiresAt,
      customerEmail,
      customerName: session.customer_details?.name || "",
    });
    sendMail(customerEmail, `Kaufbeleg ${invoiceId} - OmniFM Premium`, invoiceHtml).catch(() => {});

    const adminEmail = getSmtpConfig()?.adminEmail;
    if (adminEmail) {
      const adminHtml = buildAdminNotification({
        tier: cleanTier,
        tierName: tierConfig.name,
        months: normalizedMonths,
        serverId: cleanServerId,
        expiresAt: license.expiresAt,
        pricePaid: amountPaid,
      });
      sendMail(adminEmail, `Neuer Premium-Kauf: ${tierConfig.name}`, adminHtml).catch(() => {});
    }
  }

  for (const runtime of runtimes) {
    try {
      if (!runtime.client.isReady()) continue;

      // Nach Upgrade/Lizenz-Aktivierung direkte Durchsetzung + sofortige Command-Sichtbarkeit.
      // So muss niemand auf globale Command-Propagation warten.
      await runtime.enforcePremiumGuildScope("license-update");
      if (runtime.client.guilds.cache.has(cleanServerId)) {
        await runtime.syncGuildCommandForGuild(cleanServerId, "license-update");
      }
    } catch (err) {
      log("ERROR", `[${runtime.config.name}] Post-license Sync fehlgeschlagen: ${err?.message || err}`);
    }
  }

  return {
    success: true,
    replay: false,
    serverId: cleanServerId,
    tier: cleanTier,
    expiresAt: license.expiresAt,
    remainingDays: licInfo?.remainingDays || 0,
    message: upgrade
      ? `Server ${cleanServerId} auf ${TIERS[cleanTier].name} upgraded!`
      : `Server ${cleanServerId} auf ${TIERS[cleanTier].name} aktiviert (${Math.max(1, parseInt(months, 10) || 1)} Monat${parseInt(months, 10) > 1 ? "e" : ""})!`,
  };
}

function startWebServer(runtimes) {
  const webInternalPort = Number(process.env.WEB_INTERNAL_PORT || "8080");
  const webPort = Number(process.env.WEB_PORT || "8081");
  const webBind = process.env.WEB_BIND || "0.0.0.0";
  const publicUrl = String(process.env.PUBLIC_WEB_URL || "").trim();

  const server = http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url || "/", "http://localhost");

    // CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // --- Helper to read request body ---
    function readRawBody(maxBytes = 1024 * 1024) {
      return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            reject(new Error("Body too large"));
            req.destroy();
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
      });
    }

    async function readJsonBody() {
      const raw = await readRawBody();
      if (!raw.trim()) return {};
      try {
        return JSON.parse(raw);
      } catch {
        throw new Error("Invalid JSON");
      }
    }

    // --- API routes ---
    if (requestUrl.pathname === "/api/bots") {
      const bots = runtimes.map((runtime) => runtime.getPublicStatus());
      const totals = bots.reduce(
        (acc, bot) => {
          acc.servers += Number(bot.servers) || 0;
          acc.users += Number(bot.users) || 0;
          acc.connections += Number(bot.connections) || 0;
          acc.listeners += Number(bot.listeners) || 0;
          return acc;
        },
        { servers: 0, users: 0, connections: 0, listeners: 0 }
      );

      sendJson(res, 200, { bots, totals });
      return;
    }

    if (requestUrl.pathname === "/api/commands") {
      sendJson(res, 200, { commands: API_COMMANDS });
      return;
    }

    if (requestUrl.pathname === "/api/stats") {
      const bots = runtimes.map((runtime) => runtime.getPublicStatus());
      const totals = bots.reduce(
        (acc, bot) => {
          acc.servers += Number(bot.servers) || 0;
          acc.users += Number(bot.users) || 0;
          acc.connections += Number(bot.connections) || 0;
          acc.listeners += Number(bot.listeners) || 0;
          return acc;
        },
        { servers: 0, users: 0, connections: 0, listeners: 0 }
      );
      const stationCount = Object.keys(loadStations().stations).length;
      sendJson(res, 200, {
        ...totals,
        bots: runtimes.length,
        stations: stationCount,
      });
      return;
    }

    if (requestUrl.pathname === "/api/stations") {
      const stations = loadStations();
      const stationArr = Object.entries(stations.stations).map(([key, value]) => ({
        key,
        name: value.name,
        url: value.url,
        tier: value.tier || "free",
      }));
      // Sort: free first, then pro, then ultimate
      const tierOrder = { free: 0, pro: 1, ultimate: 2 };
      stationArr.sort((a, b) => (tierOrder[a.tier] || 0) - (tierOrder[b.tier] || 0) || a.name.localeCompare(b.name));
      sendJson(res, 200, {
        defaultStationKey: stations.defaultStationKey,
        qualityPreset: stations.qualityPreset,
        total: stationArr.length,
        stations: stationArr,
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

    // --- Premium API ---
    if (requestUrl.pathname === "/api/premium/check" && req.method === "GET") {
      const serverId = requestUrl.searchParams.get("serverId");
      if (!serverId || !/^\d{17,22}$/.test(serverId)) {
        sendJson(res, 400, { error: "serverId muss 17-22 Ziffern sein." });
        return;
      }
      const tierConfig = getTierConfig(serverId);
      const license = getLicense(serverId);
      sendJson(res, 200, { serverId, ...tierConfig, license });
      return;
    }

    // Premium Bot Invite-Links: nur fuer berechtigte Server
    if (requestUrl.pathname === "/api/premium/invite-links" && req.method === "GET") {
      const serverId = requestUrl.searchParams.get("serverId");
      if (!serverId || !/^\d{17,22}$/.test(serverId)) {
        sendJson(res, 400, { error: "serverId muss 17-22 Ziffern sein." });
        return;
      }
      const tierConfig = getTierConfig(serverId);
      const links = runtimes.map((rt) => {
        const botTier = rt.config.requiredTier || "free";
        const access = getBotAccessForTier(rt.config, tierConfig);
        return {
          botId: rt.config.id,
          name: rt.config.name,
          index: rt.config.index,
          requiredTier: botTier,
          hasAccess: access.hasAccess,
          blockedReason: access.reason,
          inviteUrl: access.hasAccess ? buildInviteUrl(rt.config) : null,
        };
      });

      sendJson(res, 200, { serverId, serverTier: tierConfig.tier, bots: links });
      return;
    }

    if (requestUrl.pathname === "/api/premium/tiers" && req.method === "GET") {
      sendJson(res, 200, { tiers: TIERS });
      return;
    }

    if (requestUrl.pathname === "/api/premium/checkout" && req.method === "POST") {
      try {
        const body = await readJsonBody();
        const { tier, email, months, seats: rawSeats, returnUrl } = body;
        if (!tier || !email) {
          sendJson(res, 400, { error: "tier und email erforderlich." });
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          sendJson(res, 400, { error: "Bitte eine gueltige E-Mail-Adresse eingeben." });
          return;
        }
        if (tier !== "pro" && tier !== "ultimate") {
          sendJson(res, 400, { error: "tier muss 'pro' oder 'ultimate' sein." });
          return;
        }

        const seats = [1, 2, 3, 5].includes(Number(rawSeats)) ? Number(rawSeats) : 1;

        const stripeKey = getStripeSecretKey();
        if (!stripeKey) {
          sendJson(res, 503, { error: "Stripe nicht konfiguriert. Nutze: ./update.sh --stripe" });
          return;
        }

        const durationMonths = Math.max(1, parseInt(months) || 1);
        const priceInCents = calculatePrice(tier, durationMonths) * seats;
        const tierName = TIERS[tier].name;
        const seatsLabel = seats > 1 ? ` (${seats} Server)` : "";
        let description;
        if (durationMonths >= 12) {
          description = `${tierName}${seatsLabel} - ${durationMonths} Monate (Jahresrabatt: 2 Monate gratis!)`;
        } else {
          description = `${tierName}${seatsLabel} - ${durationMonths} Monat${durationMonths > 1 ? "e" : ""}`;
        }

        const stripe = await import("stripe");
        const stripeClient = new stripe.default(stripeKey);

        const session = await stripeClient.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: email.trim().toLowerCase(),
          line_items: [{
            price_data: {
              currency: "eur",
              product_data: {
                name: `${BRAND.name} ${TIERS[tier].name}`,
                description,
              },
              unit_amount: priceInCents,
            },
            quantity: 1,
          }],
          metadata: {
            email: email.trim().toLowerCase(),
            tier,
            seats: String(seats),
            months: String(durationMonths),
            isUpgrade: "false",
            checkoutCreatedAt: new Date().toISOString(),
          },
          success_url: resolveCheckoutReturnBase(returnUrl, publicUrl, req) + "?payment=success&session_id={CHECKOUT_SESSION_ID}",
          cancel_url: resolveCheckoutReturnBase(returnUrl, publicUrl, req) + "?payment=cancelled",
        });

        sendJson(res, 200, { sessionId: session.id, url: session.url });
      } catch (err) {
        log("ERROR", `Stripe checkout error: ${err.message}`);
        sendJson(res, 500, { error: "Checkout fehlgeschlagen: " + err.message });
      }
      return;
    }

    if (requestUrl.pathname === "/api/premium/webhook" && req.method === "POST") {
      try {
        const stripeKey = getStripeSecretKey();
        const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
        if (!stripeKey || !webhookSecret) {
          sendJson(res, 503, { error: "Stripe Webhook nicht konfiguriert." });
          return;
        }

        const signatureHeader = req.headers["stripe-signature"];
        const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
        if (!signature) {
          sendJson(res, 400, { error: "Stripe-Signatur fehlt." });
          return;
        }

        const rawBody = await readRawBody(2 * 1024 * 1024);
        const stripe = await import("stripe");
        const stripeClient = new stripe.default(stripeKey);

        let event;
        try {
          event = stripeClient.webhooks.constructEvent(rawBody, signature, webhookSecret);
        } catch (err) {
          sendJson(res, 400, { error: `Webhook-Signatur ungueltig: ${err.message}` });
          return;
        }

        if (!event?.id) {
          sendJson(res, 400, { error: "Webhook-Event ungueltig." });
          return;
        }

        if (isEventProcessed(event.id)) {
          sendJson(res, 200, { received: true, duplicate: true });
          return;
        }

        if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
          const result = await activatePaidStripeSession(event.data.object, runtimes, `webhook:${event.type}`);
          markEventProcessed(event.id, {
            type: event.type,
            sessionId: event.data?.object?.id || null,
            success: result.success,
          });
          sendJson(res, 200, {
            received: true,
            processed: result.success,
            replay: !!result.replay,
            message: result.message,
          });
          return;
        }

        markEventProcessed(event.id, { type: event.type, ignored: true });
        sendJson(res, 200, { received: true, ignored: true });
      } catch (err) {
        log("ERROR", `Stripe webhook error: ${err.message}`);
        sendJson(res, 500, { error: "Webhook-Verarbeitung fehlgeschlagen: " + err.message });
      }
      return;
    }

    if (requestUrl.pathname === "/api/premium/verify" && req.method === "POST") {
      try {
        const body = await readJsonBody();
        const { sessionId } = body;
        if (!sessionId) {
          sendJson(res, 400, { error: "sessionId erforderlich." });
          return;
        }

        const stripeKey = getStripeSecretKey();
        if (!stripeKey) {
          sendJson(res, 503, { error: "Stripe nicht konfiguriert." });
          return;
        }

        const normalizedSessionId = String(sessionId).trim();
        if (isSessionProcessed(normalizedSessionId)) {
          const stripe = await import("stripe");
          const stripeClient = new stripe.default(stripeKey);
          const replaySession = await stripeClient.checkout.sessions.retrieve(normalizedSessionId);
          const replayResult = await activatePaidStripeSession(replaySession, runtimes, "verify:replay");
          sendJson(res, 200, {
            success: true,
            replay: true,
            serverId: replayResult.serverId || null,
            tier: replayResult.tier || null,
            expiresAt: replayResult.expiresAt || null,
            remainingDays: replayResult.remainingDays || 0,
            message: replayResult.message,
          });
          return;
        }

        const stripe = await import("stripe");
        const stripeClient = new stripe.default(stripeKey);
        const session = await stripeClient.checkout.sessions.retrieve(normalizedSessionId);
        const result = await activatePaidStripeSession(session, runtimes, "verify");
        if (!result.success) {
          sendJson(res, result.status || 400, { success: false, message: result.message });
          return;
        }

        sendJson(res, 200, {
          success: true,
          replay: !!result.replay,
          serverId: result.serverId,
          tier: result.tier,
          expiresAt: result.expiresAt,
          remainingDays: result.remainingDays,
          message: result.message,
        });
      } catch (err) {
        log("ERROR", `Stripe verify error: ${err.message}`);
        sendJson(res, 500, { error: "Verifizierung fehlgeschlagen: " + err.message });
      }
      return;
    }

    // --- Pricing info endpoint ---
    if (requestUrl.pathname === "/api/premium/pricing" && req.method === "GET") {
      const serverId = requestUrl.searchParams.get("serverId");
      const result = {
        brand: BRAND.name,
        tiers: {
          free: {
            name: "Free",
            pricePerMonth: 0,
            features: [
              "64k Bitrate",
              "Bis zu 2 Bots",
              "20 Free Stationen",
              "Standard Reconnect (5s)",
            ]
          },
          pro: {
            name: "Pro",
            pricePerMonth: TIERS.pro.pricePerMonth,
            startingAt: "2,99",
            seatPricing: { 1: 2.99, 2: 5.49, 3: 7.49, 5: 11.49 },
            features: [
              "128k Bitrate (HQ Opus)",
              "Bis zu 8 Bots",
              "120 Stationen (Free + Pro)",
              "Priority Reconnect (1,5s)",
              "Server-Lizenz (1/2/3/5 Server)",
            ]
          },
          ultimate: {
            name: "Ultimate",
            pricePerMonth: TIERS.ultimate.pricePerMonth,
            startingAt: "4,99",
            seatPricing: { 1: 4.99, 2: 7.99, 3: 10.99, 5: 16.99 },
            features: [
              "320k Bitrate (Ultra HQ)",
              "Bis zu 16 Bots",
              "Alle Stationen + Custom URLs",
              "Instant Reconnect (0,4s)",
              "Server-Lizenz Bundles",
            ]
          },
        },
        yearlyDiscount: "12 Monate = 10 bezahlen (2 Monate gratis)",
        seatOptions: [1, 2, 3, 5],
      };

      if (serverId && /^\d{17,22}$/.test(serverId)) {
        const license = getLicense(serverId);
        if (license && !license.expired) {
          result.currentLicense = {
            tier: license.tier || license.plan,
            expiresAt: license.expiresAt,
            remainingDays: license.remainingDays,
          };
          if ((license.tier || license.plan) === "pro") {
            const upgrade = calculateUpgradePrice(serverId, "ultimate");
            if (upgrade) {
              result.upgrade = {
                to: "ultimate",
                cost: upgrade.upgradeCost,
                daysLeft: upgrade.daysLeft,
              };
            }
          }
        }
      }

      sendJson(res, 200, result);
      return;
    }

    // --- Static file serving from web/ ---
    const safePath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
    const filePath = path.join(webDir, safePath);
    sendStaticFile(res, filePath);
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

// Auto-Restore: Vorherigen Zustand wiederherstellen (Voice Channels + Stationen)
const stations = loadStations();
for (const runtime of runtimes) {
  // Use clientReady (not deprecated "ready") and handle both cases
  const doRestore = () => {
    log("INFO", `[${runtime.config.name}] Starte Auto-Restore...`);
    runtime.restoreState(stations).catch((err) => {
      log("ERROR", `[${runtime.config.name}] Auto-Restore fehlgeschlagen: ${err?.message || err}`);
    });
  };

  if (runtime.client.isReady()) {
    doRestore();
  } else {
    // Wait for bot to be fully ready before restoring
    runtime.client.once("clientReady", () => {
      // Small delay to ensure guild cache is populated
      setTimeout(doRestore, 2000);
    });
  }
}

const webServer = startWebServer(runtimes);

// Periodisches Speichern des Bot-State (alle 60s) als Backup
setInterval(() => {
  for (const runtime of runtimes) {
    if (runtime.client.isReady()) {
      runtime.persistState();
    }
  }
}, 60_000);

// Lizenz-Ablauf pruefen (alle 6 Stunden)
setInterval(async () => {
  if (!isEmailConfigured()) return;
  try {
    const all = listLicenses();
    for (const [serverId, lic] of Object.entries(all)) {
      if (!lic.expiresAt) continue;
      const daysLeft = Math.max(0, Math.ceil((new Date(lic.expiresAt) - new Date()) / 86400000));
      const tierName = TIERS[lic.tier]?.name || lic.tier;

      // Warnung bei 7 Tagen
      const warningAlreadySent = lic._warning7ForExpiryAt === lic.expiresAt;
      if (daysLeft === 7 && lic.contactEmail && !warningAlreadySent) {
        const html = buildExpiryWarningEmail({ tierName, serverId, expiresAt: lic.expiresAt, daysLeft });
        const result = await sendMail(lic.contactEmail, `Premium ${tierName} laeuft in 7 Tagen ab!`, html);
        if (result?.success) {
          patchLicense(serverId, { _warning7ForExpiryAt: lic.expiresAt });
          log("INFO", `[Email] Ablauf-Warnung gesendet an ${lic.contactEmail} fuer ${serverId}`);
        } else {
          log("ERROR", `[Email] Ablauf-Warnung fehlgeschlagen fuer ${serverId}: ${result?.error || "Unbekannter Fehler"}`);
        }
      }

      // Abgelaufen
      const expiredAlreadyNotified =
        lic._expiredNotifiedForExpiryAt === lic.expiresAt || lic._expiredNotified === true;
      if (daysLeft === 0 && lic.contactEmail && !expiredAlreadyNotified) {
        const html = buildExpiryEmail({ tierName, serverId });
        const result = await sendMail(lic.contactEmail, `Premium ${tierName} abgelaufen`, html);
        if (result?.success) {
          patchLicense(serverId, { _expiredNotifiedForExpiryAt: lic.expiresAt, _expiredNotified: true });
          log("INFO", `[Email] Ablauf-Benachrichtigung gesendet an ${lic.contactEmail} fuer ${serverId}`);
        } else {
          log("ERROR", `[Email] Ablauf-Benachrichtigung fehlgeschlagen fuer ${serverId}: ${result?.error || "Unbekannter Fehler"}`);
        }
      }
    }
  } catch (err) {
    log("ERROR", `[ExpiryCheck] ${err.message}`);
  }
}, 6 * 60 * 60 * 1000);

// Premium-Bot-Guild-Scope regelmaessig durchsetzen (z.B. nach Lizenzablauf/Downgrade)
setInterval(() => {
  for (const runtime of runtimes) {
    if (!runtime.client.isReady()) continue;
    runtime.enforcePremiumGuildScope("periodic").catch((err) => {
      log("ERROR", `[${runtime.config.name}] Periodische Premium-Guild-Scope Pruefung fehlgeschlagen: ${err?.message || err}`);
    });
  }
}, 10 * 60 * 1000);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("INFO", `Shutdown via ${signal}...`);

  // State speichern BEVOR alles gestoppt wird
  log("INFO", "Speichere Bot-State fuer Auto-Reconnect...");
  for (const runtime of runtimes) {
    runtime.persistState();
  }
  log("INFO", "Bot-State gespeichert.");

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
