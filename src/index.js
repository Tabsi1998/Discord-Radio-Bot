import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { REST } from "@discordjs/rest";
import {
  ActivityType,
  ChannelType,
  Client,
  GatewayIntentBits,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  PermissionFlagsBits,
  Routes,
} from "discord.js";
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
import { setLicenseProvider, getServerPlan, getServerPlanConfig, requireFeature, planAtLeast } from "./core/entitlements.js";
import { premiumStationEmbed, customStationEmbed, botLimitEmbed } from "./ui/upgradeEmbeds.js";
import {
  isConfigured as isEmailConfigured,
  sendMail,
  buildPurchaseEmail, buildInvoiceEmail, buildAdminNotification,
  buildExpiryWarningEmail, buildExpiryEmail
} from "./email.js";
import { loadBotConfigs, buildInviteUrl } from "./bot-config.js";
import {
  getServerLicense, listLicenses as listRawLicenses,
  createLicense, linkServerToLicense, unlinkServerFromLicense, getLicenseById,
  isSessionProcessed, markSessionProcessed, isEventProcessed, markEventProcessed,
  reserveTrialClaim, finalizeTrialClaim, releaseTrialClaim,
  createOrExtendLicenseForEmail, listLicensesByContactEmail, patchLicenseById,
} from "./premium-store.js";
import { saveBotState, getBotState, clearBotGuild } from "./bot-state.js";
import { buildCommandBuilders } from "./commands.js";
import { loadStations, resolveStation, filterStationsByTier, getFallbackKey, normalizeKey } from "./stations-store.js";
import { getGuildStations, addGuildStation, removeGuildStation, countGuildStations, MAX_STATIONS_PER_GUILD, validateCustomStationUrl } from "./custom-stations.js";
import {
  listScheduledEvents,
  createScheduledEvent,
  getScheduledEvent,
  deleteScheduledEvent,
  patchScheduledEvent,
  deleteScheduledEventsByFilter,
} from "./scheduled-events-store.js";
import { normalizeLanguage, resolveLanguageFromAcceptLanguage, getDefaultLanguage } from "./i18n.js";
import {
  evaluateCommandPermission,
  getGuildCommandPermissionRules,
  getSupportedPermissionCommands,
  removeCommandRolePermission,
  resetCommandPermissions,
  setCommandRolePermission,
} from "./command-permissions-store.js";
import { isPermissionManagedCommand, normalizePermissionCommandName } from "./config/command-permissions.js";
import { syncGuildCommandsSafe } from "./discord/syncGuildCommandsSafe.js";
import { appendSongHistory, getSongHistory } from "./song-history-store.js";
import { clearGuildLanguage, getGuildLanguage, setGuildLanguage } from "./guild-language-store.js";
import {
  deleteOffer,
  getOffer,
  listOffers,
  listRecentRedemptions,
  markOfferRedemption,
  previewCheckoutOffer,
  setOfferActive,
  upsertOffer,
} from "./coupon-store.js";

dotenv.config();

// ============================================================
// OmniFM: Entitlements Wiring & Legacy Compatibility
// ============================================================
setLicenseProvider(getServerLicense);

const YEARLY_DISCOUNT_MONTHS = 10;
const PRO_TRIAL_MONTHS = 1;
const PRO_TRIAL_SEATS = 1;
const DEFAULT_EXPIRY_REMINDER_DAYS = [30, 14, 7, 1];
const SEAT_OPTIONS = [1, 2, 3, 5];
const SEAT_PRICING_CENTS = {
  pro: { 1: 299, 2: 549, 3: 749, 5: 1149 },
  ultimate: { 1: 499, 2: 799, 3: 1099, 5: 1699 },
};

function normalizeSeats(rawSeats) {
  const seats = Number(rawSeats);
  return SEAT_OPTIONS.includes(seats) ? seats : 1;
}

function isValidEmailAddress(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function isProTrialEnabled() {
  return String(process.env.PRO_TRIAL_ENABLED ?? "1").trim() !== "0";
}

function parseExpiryReminderDays(raw) {
  const values = String(raw || "")
    .split(",")
    .map((entry) => Number.parseInt(String(entry).trim(), 10))
    .filter((day) => Number.isInteger(day) && day > 0 && day <= 3650);

  const unique = [...new Set(values)].sort((a, b) => b - a);
  return unique.length > 0 ? unique : [...DEFAULT_EXPIRY_REMINDER_DAYS];
}

const EXPIRY_REMINDER_DAYS = parseExpiryReminderDays(
  process.env.LICENSE_EXPIRY_REMINDER_DAYS || DEFAULT_EXPIRY_REMINDER_DAYS.join(",")
);

function getSeatPricePerMonthCents(tier, seats = 1) {
  if (tier === "free") return 0;
  const pricing = SEAT_PRICING_CENTS[tier];
  if (!pricing) return 0;
  const normalizedSeats = normalizeSeats(seats);
  return pricing[normalizedSeats] || pricing[1] || 0;
}

const TIERS = Object.fromEntries(
  Object.entries(PLANS).map(([key, plan]) => [key, {
    ...plan, tier: key, pricePerMonth: getSeatPricePerMonthCents(key, 1),
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

function calculatePrice(tier, months, seats = 1) {
  const ppm = getSeatPricePerMonthCents(tier, seats);
  if (!ppm) return 0;
  const durationMonths = Math.max(1, parseInt(months, 10) || 1);
  if (durationMonths >= 12) {
    const fullYears = Math.floor(durationMonths / 12);
    const remaining = durationMonths % 12;
    return (fullYears * YEARLY_DISCOUNT_MONTHS * ppm) + (remaining * ppm);
  }
  return ppm * durationMonths;
}

function calculateUpgradePrice(serverId, targetTier) {
  const lic = getServerLicense(serverId);
  if (!lic || lic.expired || !lic.active) return null;
  const oldTier = lic.plan || "free";
  if (oldTier === targetTier) return null;
  if (!planAtLeast(targetTier, oldTier)) return null;
  const daysLeft = lic.remainingDays || 0;
  if (daysLeft <= 0) return null;
  const seats = normalizeSeats(lic.seats || 1);
  const oldPpm = getSeatPricePerMonthCents(oldTier, seats);
  const newPpm = getSeatPricePerMonthCents(targetTier, seats);
  const diff = newPpm - oldPpm;
  if (diff <= 0) return null;
  return { oldTier, targetTier, daysLeft, seats, upgradeCost: Math.ceil(diff * daysLeft / 30) };
}

function seatPricingInEuro(tier) {
  const out = {};
  for (const seats of SEAT_OPTIONS) {
    const cents = getSeatPricePerMonthCents(tier, seats);
    if (cents > 0) out[seats] = Number((cents / 100).toFixed(2));
  }
  return out;
}

function formatEuroCentsDe(cents) {
  return (Number(cents || 0) / 100).toFixed(2).replace(".", ",");
}

function sanitizeOfferCode(rawCode) {
  return String(rawCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 40);
}

function translateOfferReason(reason, language = "de") {
  const isDe = String(language || "de").toLowerCase() === "de";
  const map = {
    code_missing: isDe ? "Kein Code angegeben." : "No code provided.",
    offer_not_found: isDe ? "Code nicht gefunden." : "Code not found.",
    offer_kind_mismatch: isDe ? "Code-Typ passt nicht." : "Code type mismatch.",
    offer_inactive: isDe ? "Code ist deaktiviert." : "Code is inactive.",
    offer_not_started: isDe ? "Code ist noch nicht aktiv." : "Code is not active yet.",
    offer_expired: isDe ? "Code ist abgelaufen." : "Code has expired.",
    offer_tier_mismatch: isDe ? "Code gilt nicht fuer dieses Paket." : "Code does not apply to this plan.",
    offer_seat_mismatch: isDe ? "Code gilt nicht fuer diese Server-Anzahl." : "Code does not apply to this seat count.",
    offer_months_mismatch: isDe ? "Code gilt nicht fuer diese Laufzeit." : "Code does not apply to this duration.",
    offer_maxed_out: isDe ? "Code ist bereits ausgeschopft." : "Code has reached its redemption limit.",
    offer_email_limit_reached: isDe ? "Code wurde fuer diese E-Mail bereits genutzt." : "Code has already been used for this email.",
    invalid_base_amount: isDe ? "Ungueltiger Basispreis fuer Rabattberechnung." : "Invalid base amount for discount calculation.",
    invalid_discount: isDe ? "Rabatt ist fuer diese Bestellung nicht gueltig." : "Discount is not valid for this checkout.",
  };
  return map[String(reason || "")] || (isDe ? "Code kann nicht angewendet werden." : "Code cannot be applied.");
}

function parseBitrateKbps(rawBitrate) {
  if (rawBitrate === null || rawBitrate === undefined) return null;
  const str = String(rawBitrate).trim().toLowerCase();
  if (!str) return null;
  const match = str.match(/^(\d+)\s*k?$/i);
  if (!match) return null;
  const kbps = Number.parseInt(match[1], 10);
  return Number.isFinite(kbps) && kbps > 0 ? kbps : null;
}

function buildTranscodeProfile({ bitrateOverride, qualityPreset }) {
  const overrideKbps = parseBitrateKbps(bitrateOverride);
  const requestedKbps = overrideKbps || parseBitrateKbps(process.env.OPUS_BITRATE || "192k") || 192;
  const isUltra = requestedKbps >= 256 || String(qualityPreset || "").toLowerCase() === "high";

  return {
    requestedKbps,
    isUltra,
    threadQueueSize: String(process.env.FFMPEG_THREAD_QUEUE_SIZE || (isUltra ? "4096" : "2048")),
    probeSize: String(process.env.FFMPEG_PROBESIZE || (isUltra ? "262144" : "131072")),
    analyzeDuration: String(process.env.FFMPEG_ANALYZE_US || (isUltra ? "3000000" : "2000000")),
    rtbufsize: String(process.env.FFMPEG_RTBUFSIZE || (isUltra ? "96M" : "64M")),
    maxDelayUs: String(process.env.FFMPEG_MAX_DELAY_US || (isUltra ? "600000" : "400000")),
    rwTimeoutUs: String(process.env.FFMPEG_RW_TIMEOUT_US || "20000000"),
    ioTimeoutUs: String(process.env.FFMPEG_IO_TIMEOUT_US || "20000000"),
    outputFlushPackets: String(process.env.FFMPEG_OUTPUT_FLUSH_PACKETS || "0"),
  };
}

function shouldLogFfmpegStderrLine(line) {
  const text = String(line || "").trim();
  if (!text) return false;

  const mode = String(process.env.FFMPEG_STDERR_VERBOSITY || "warn").trim().toLowerCase();
  if (mode === "all" || mode === "debug" || mode === "info") return true;
  if (mode === "off" || mode === "none") return false;

  const lc = text.toLowerCase();
  return lc.includes("error")
    || lc.includes("failed")
    || lc.includes("invalid")
    || lc.includes("warn")
    || lc.includes("timed out")
    || lc.includes("http error")
    || lc.includes("reconnect");
}

// ============================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const webDir = path.join(rootDir, "web");
const logsDir = path.join(rootDir, "logs");
const logFile = path.join(logsDir, "bot.log");
const maxLogSizeBytes = Number(process.env.LOG_MAX_MB || "5") * 1024 * 1024;
const logRotateCheckIntervalMs = Number(process.env.LOG_ROTATE_CHECK_MS || "5000");
const logPruneCheckIntervalMs = Number(process.env.LOG_PRUNE_CHECK_MS || "600000");
const maxRotatedLogFiles = Math.max(
  1,
  Number.parseInt(String(process.env.LOG_MAX_FILES || "30"), 10) || 30
);
const maxRotatedLogDays = Math.max(
  1,
  Number.parseInt(String(process.env.LOG_MAX_DAYS || "14"), 10) || 14
);
const appStartTime = Date.now();
let logWriteQueue = Promise.resolve();
let lastLogRotateCheckAt = 0;
let lastLogPruneCheckAt = 0;

async function ensureLogsDir() {
  await fs.promises.mkdir(logsDir, { recursive: true });
}

async function rotateLogIfNeeded() {
  const now = Date.now();
  if (now - lastLogRotateCheckAt < logRotateCheckIntervalMs) return;
  lastLogRotateCheckAt = now;

  try {
    const stat = await fs.promises.stat(logFile).catch(() => null);
    if (!stat) return;
    const size = stat.size;
    if (size < maxLogSizeBytes) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rotated = path.join(logsDir, `bot-${stamp}.log`);
    await fs.promises.rename(logFile, rotated);
  } catch {
    // ignore
  }
}

async function pruneRotatedLogsIfNeeded() {
  const now = Date.now();
  if (now - lastLogPruneCheckAt < logPruneCheckIntervalMs) return;
  lastLogPruneCheckAt = now;

  const retentionMs = maxRotatedLogDays * 24 * 60 * 60 * 1000;
  try {
    const entries = await fs.promises.readdir(logsDir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
      if (!entry?.isFile?.()) continue;
      if (!/^bot-.*\.log$/i.test(entry.name)) continue;
      const filePath = path.join(logsDir, entry.name);
      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (!stat) continue;
      files.push({ filePath, mtimeMs: stat.mtimeMs });
    }

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (let index = 0; index < files.length; index++) {
      const info = files[index];
      const olderThanLimit = now - info.mtimeMs > retentionMs;
      const exceedsCountLimit = index >= maxRotatedLogFiles;
      if (!olderThanLimit && !exceedsCountLimit) continue;
      // eslint-disable-next-line no-await-in-loop
      await fs.promises.unlink(info.filePath).catch(() => null);
    }
  } catch {
    // ignore
  }
}

function queueLogWrite(line) {
  logWriteQueue = logWriteQueue
    .then(async () => {
      await ensureLogsDir();
      await rotateLogIfNeeded();
      await pruneRotatedLogsIfNeeded();
      await fs.promises.appendFile(logFile, `${line}\n`, "utf8");
    })
    .catch(() => {
      // ignore
    });
}

function log(level, message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}`;
  if (level === "ERROR") {
    console.error(line);
  } else {
    console.log(line);
  }

  queueLogWrite(line);
}

function clampVolume(value) {
  return Math.max(0, Math.min(1, value / 100));
}

function clipText(value, max = 100) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
}

function sanitizeUrlForLog(rawUrl) {
  const text = String(rawUrl || "").trim();
  if (!text) return "-";
  try {
    const parsed = new URL(text);
    if (parsed.username) parsed.username = "***";
    if (parsed.password) parsed.password = "***";
    if (parsed.search) parsed.search = "?...";
    if (parsed.hash) parsed.hash = "";
    return parsed.toString();
  } catch {
    return clipText(text, 180);
  }
}

function waitMs(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

function parseEnvInt(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(process.env[name] ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function applyJitter(baseMs, ratio = 0.2) {
  const ms = Math.max(0, Number(baseMs) || 0);
  if (ms <= 0) return 0;
  const spread = Math.max(0, Math.min(0.9, Number(ratio) || 0));
  const factor = 1 - spread + (Math.random() * spread * 2);
  return Math.max(0, Math.round(ms * factor));
}

function isLikelyNetworkFailureLine(line) {
  const text = String(line || "").trim().toLowerCase();
  if (!text) return false;

  if (text.includes("failed to resolve hostname")) return true;
  if (text.includes("temporary failure in name resolution")) return true;
  if (text.includes("name or service not known")) return true;
  if (text.includes("network is unreachable")) return true;
  if (text.includes("no route to host")) return true;
  if (text.includes("could not resolve host")) return true;

  return false;
}

function resolveLanguageFromDiscordLocale(rawLocale, fallbackLanguage = getDefaultLanguage()) {
  const locale = String(rawLocale || "").trim().toLowerCase();
  if (!locale) return normalizeLanguage(fallbackLanguage, getDefaultLanguage());
  return locale.startsWith("de") ? "de" : "en";
}

function languagePick(language, de, en) {
  return normalizeLanguage(language, "de") === "de" ? de : en;
}

function translatePermissionStoreMessage(message, language = "de") {
  const value = String(message || "").trim();
  const map = {
    "Ungueltige Guild-ID.": "Invalid guild ID.",
    "Command wird nicht unterstuetzt.": "Command is not supported.",
    "Ungueltige Rollen-ID.": "Invalid role ID.",
    "Mode muss 'allow' oder 'deny' sein.": "Mode must be 'allow' or 'deny'.",
  };
  return languagePick(language, value, map[value] || value);
}

function translateScheduledEventStoreMessage(message, language = "de") {
  const value = String(message || "").trim();
  const map = {
    "Event ist ungueltig.": "Event is invalid.",
    "Event-ID fehlt.": "Event ID is missing.",
    "Event nicht gefunden.": "Event was not found.",
    "Event-Update ist ungueltig.": "Event update is invalid.",
  };
  return languagePick(language, value, map[value] || value);
}

function translateCustomStationErrorMessage(message, language = "de") {
  const value = String(message || "").trim();
  if (!value) return value;
  const maxStationsMatch = value.match(/^Maximum (\d+) Custom-Stationen erreicht\.$/);
  if (maxStationsMatch) {
    return languagePick(
      language,
      value,
      `Maximum of ${maxStationsMatch[1]} custom stations reached.`
    );
  }
  const map = {
    "Ungueltiger Station-Key.": "Invalid station key.",
    "Name darf nicht leer sein.": "Name must not be empty.",
    "URL darf nicht leer sein.": "URL must not be empty.",
    "URL-Format ungueltig.": "Invalid URL format.",
    "URL muss mit http:// oder https:// beginnen.": "URL must start with http:// or https://.",
    "URL mit Benutzername/Passwort sind nicht erlaubt.": "URLs with username/password are not allowed.",
    "Lokale/private Hosts sind nicht erlaubt.": "Local/private hosts are not allowed.",
  };
  return languagePick(language, value, map[value] || value);
}

function getFeatureRequirementMessage(featureResult, language = "de") {
  if (!featureResult || featureResult.ok) return "";
  if (normalizeLanguage(language, "de") !== "de") {
    return String(featureResult.message || "Feature not available.");
  }
  const labels = {
    hqAudio: "HQ Audio (128k Opus)",
    ultraAudio: "Ultra HQ Audio (320k)",
    priorityReconnect: "Priority Auto-Reconnect",
    instantReconnect: "Instant Reconnect",
    premiumStations: "100+ Premium Stationen",
    customStationURLs: "Custom-Station URLs",
    commandPermissions: "Rollenbasierte Command-Berechtigungen",
    scheduledEvents: "Event-Scheduler mit Auto-Play",
  };
  const label = labels[featureResult.featureKey] || featureResult.featureKey || "Dieses Feature";
  const requiredPlanName = PLANS[featureResult.requiredPlan]?.name || String(featureResult.requiredPlan || "Pro");
  return `**${label}** erfordert ${BRAND.name} **${requiredPlanName}** oder hoeher.`;
}

function parseEventStartDateTime(rawInput, language = "de") {
  const raw = String(rawInput || "").trim();
  if (!raw) {
    return {
      ok: false,
      message: languagePick(language, "Zeit fehlt.", "Time is missing."),
    };
  }

  const normalized = raw.replace("T", " ");
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/);
  if (!match) {
    return {
      ok: false,
      message: languagePick(
        language,
        "Ungueltiges Format. Nutze `YYYY-MM-DD HH:MM` (z.B. `2026-03-01 20:30`).",
        "Invalid format. Use `YYYY-MM-DD HH:MM` (for example `2026-03-01 20:30`)."
      ),
    };
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const hour = Number.parseInt(match[4], 10);
  const minute = Number.parseInt(match[5], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return {
      ok: false,
      message: languagePick(language, "Datum/Uhrzeit ungueltig.", "Date/time is invalid."),
    };
  }

  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== (month - 1)
    || parsed.getDate() !== day
    || parsed.getHours() !== hour
    || parsed.getMinutes() !== minute
  ) {
    return {
      ok: false,
      message: languagePick(language, "Datum/Uhrzeit ungueltig.", "Date/time is invalid."),
    };
  }

  return { ok: true, runAtMs: parsed.getTime(), parsed };
}

function formatDateTime(ms, language = "de") {
  const value = Number.parseInt(String(ms || ""), 10);
  if (!Number.isFinite(value) || value <= 0) return "-";
  const locale = normalizeLanguage(language, "de") === "de" ? "de-DE" : "en-US";
  return new Date(value).toLocaleString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeRepeatMode(raw) {
  const repeat = String(raw || "none").trim().toLowerCase();
  if (repeat === "daily" || repeat === "weekly") return repeat;
  return "none";
}

function getRepeatLabel(raw, language = "de") {
  const repeat = normalizeRepeatMode(raw);
  const isDe = normalizeLanguage(language, "de") === "de";
  if (repeat === "daily") return isDe ? "taeglich" : "daily";
  if (repeat === "weekly") return isDe ? "woechentlich" : "weekly";
  return isDe ? "einmalig" : "once";
}

function computeNextEventRunAtMs(runAtMs, repeat, nowMs = Date.now()) {
  const base = Number.parseInt(String(runAtMs || ""), 10);
  if (!Number.isFinite(base) || base <= 0) return null;

  const mode = normalizeRepeatMode(repeat);
  if (mode === "none") return null;

  const stepMs = mode === "weekly" ? 7 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
  let next = base + stepMs;
  while (next <= nowMs) {
    next += stepMs;
  }
  return next;
}

function renderEventAnnouncement(template, values, language = "de") {
  const fallback = languagePick(
    language,
    "Event **{event}** startet jetzt: **{station}** in {voice}.",
    "Event **{event}** is starting now: **{station}** in {voice}."
  );
  const base = String(template || "").trim() || fallback;
  return base
    .replace(/\{event\}/gi, String(values?.event || "-"))
    .replace(/\{station\}/gi, String(values?.station || "-"))
    .replace(/\{voice\}/gi, String(values?.voice || "-"))
    .replace(/\{time\}/gi, String(values?.time || "-"))
    .trim();
}

function renderStageTopic(template, values) {
  const base = String(template || "").trim() || "{event} - {station}";
  return base
    .replace(/\{event\}/gi, String(values?.event || "-"))
    .replace(/\{station\}/gi, String(values?.station || "-"))
    .replace(/\{time\}/gi, String(values?.time || "-"))
    .trim();
}

const STREAM_STABLE_RESET_MS = parseEnvInt("STREAM_STABLE_RESET_MS", 15_000, 1_000, 10 * 60_000);
const STREAM_RESTART_BASE_MS = parseEnvInt("STREAM_RESTART_BASE_MS", 1_000, 250, 120_000);
const STREAM_RESTART_MAX_MS = parseEnvInt("STREAM_RESTART_MAX_MS", 120_000, 1_000, 30 * 60_000);
const STREAM_PROCESS_FAILURE_WINDOW_MS = parseEnvInt("STREAM_PROCESS_FAILURE_WINDOW_MS", 12_000, 1_000, 300_000);
const STREAM_ERROR_COOLDOWN_THRESHOLD = parseEnvInt("STREAM_ERROR_COOLDOWN_THRESHOLD", 8, 2, 100);
const STREAM_ERROR_COOLDOWN_MS = parseEnvInt("STREAM_ERROR_COOLDOWN_MS", 60_000, 1_000, 30 * 60_000);
const VOICE_RECONNECT_MAX_MS = parseEnvInt("VOICE_RECONNECT_MAX_MS", 120_000, 1_000, 30 * 60_000);
const VOICE_RECONNECT_EXP_STEPS = parseEnvInt("VOICE_RECONNECT_EXP_STEPS", 10, 1, 20);
const NETWORK_COOLDOWN_BASE_MS = parseEnvInt("NETWORK_COOLDOWN_BASE_MS", 10_000, 1_000, 10 * 60_000);
const NETWORK_COOLDOWN_MAX_MS = parseEnvInt("NETWORK_COOLDOWN_MAX_MS", 180_000, 10_000, 60 * 60_000);
const NETWORK_FAILURE_RESET_MS = parseEnvInt("NETWORK_FAILURE_RESET_MS", 45_000, 1_000, 10 * 60_000);
const NOW_PLAYING_ENABLED = String(process.env.NOW_PLAYING_ENABLED ?? "1").trim() !== "0";
const NOW_PLAYING_POLL_MS = parseEnvInt("NOW_PLAYING_POLL_MS", 45_000, 15_000, 10 * 60_000);
const NOW_PLAYING_FETCH_TIMEOUT_MS = parseEnvInt("NOW_PLAYING_FETCH_TIMEOUT_MS", 12_000, 3_000, 30_000);
const NOW_PLAYING_MAX_METAINT_BYTES = parseEnvInt("NOW_PLAYING_MAX_METAINT_BYTES", 262_144, 8_192, 2_000_000);
const NOW_PLAYING_COVER_ENABLED = String(process.env.NOW_PLAYING_COVER_ENABLED ?? "1").trim() !== "0";
const NOW_PLAYING_COVER_TIMEOUT_MS = parseEnvInt("NOW_PLAYING_COVER_TIMEOUT_MS", 6_000, 1_500, 20_000);
const NOW_PLAYING_COVER_CACHE_TTL_MS = parseEnvInt(
  "NOW_PLAYING_COVER_CACHE_TTL_MS",
  6 * 60 * 60 * 1000,
  5 * 60 * 1000,
  7 * 24 * 60 * 60 * 1000
);
const SONG_HISTORY_ENABLED = String(process.env.SONG_HISTORY_ENABLED ?? "1").trim() !== "0";
const SONG_HISTORY_MAX_PER_GUILD = parseEnvInt("SONG_HISTORY_MAX_PER_GUILD", 120, 20, 500);
const SONG_HISTORY_DEDUPE_WINDOW_MS = parseEnvInt("SONG_HISTORY_DEDUPE_WINDOW_MS", 120_000, 15_000, 10 * 60_000);
const EVENT_SCHEDULER_ENABLED = String(process.env.EVENT_SCHEDULER_ENABLED ?? "1").trim() !== "0";
const EVENT_SCHEDULER_POLL_MS = parseEnvInt("EVENT_SCHEDULER_POLL_MS", 15_000, 5_000, 10 * 60_000);
const EVENT_SCHEDULER_RETRY_MS = parseEnvInt("EVENT_SCHEDULER_RETRY_MS", 120_000, 15_000, 6 * 60 * 60_000);

class NetworkRecoveryCoordinator {
  constructor() {
    this.failureStreak = 0;
    this.cooldownUntil = 0;
    this.lastFailureAt = 0;
    this.recoveryHandlers = new Set();
  }

  getRecoveryDelayMs(now = Date.now()) {
    return Math.max(0, this.cooldownUntil - now);
  }

  noteFailure(source, detail = "") {
    const now = Date.now();
    if (now - this.lastFailureAt > NETWORK_FAILURE_RESET_MS) {
      this.failureStreak = 0;
    }
    const previousHoldMs = this.getRecoveryDelayMs(now);

    this.failureStreak += 1;
    this.lastFailureAt = now;

    const exp = Math.min(this.failureStreak - 1, 8);
    const cooldownMs = Math.min(NETWORK_COOLDOWN_MAX_MS, NETWORK_COOLDOWN_BASE_MS * Math.pow(2, exp));
    const jittered = applyJitter(cooldownMs, 0.15);
    const nextCooldownUntil = now + jittered;
    const extended = nextCooldownUntil > this.cooldownUntil;
    if (extended) {
      this.cooldownUntil = nextCooldownUntil;
    }

    const holdIncreaseMs = this.getRecoveryDelayMs(now) - previousHoldMs;
    if (this.failureStreak === 1 || this.failureStreak % 5 === 0 || holdIncreaseMs >= 5_000) {
      const msg = clipText(detail || source || "-", 160);
      log(
        "INFO",
        `[Net] Stoerung erkannt (streak=${this.failureStreak}, holdMs=${this.getRecoveryDelayMs(now)}): ${msg}`
      );
    }
  }

  noteSuccess(source = "success") {
    const now = Date.now();
    const wasInCooldown = this.getRecoveryDelayMs(now) > 0;
    const previousStreak = this.failureStreak;
    this.failureStreak = 0;
    this.lastFailureAt = 0;
    this.cooldownUntil = 0;

    if (!wasInCooldown) return;

    log("INFO", `[Net] Verbindung stabilisiert (${clipText(source, 120)}), Cooldown beendet.`);
    for (const handler of this.recoveryHandlers) {
      try {
        handler({ source, previousStreak });
      } catch (err) {
        log("ERROR", `[Net] Recovery-Handler fehlgeschlagen: ${err?.message || err}`);
      }
    }
  }

  onRecovered(handler) {
    if (typeof handler !== "function") return () => {};
    this.recoveryHandlers.add(handler);
    return () => this.recoveryHandlers.delete(handler);
  }
}

const networkRecoveryCoordinator = new NetworkRecoveryCoordinator();
const nowPlayingCoverCache = new Map();
const nowPlayingCoverInFlight = new Map();

function concatUint8Arrays(left, right) {
  const a = left instanceof Uint8Array ? left : new Uint8Array(0);
  const b = right instanceof Uint8Array ? right : new Uint8Array(0);
  if (!a.length) return b;
  if (!b.length) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function extractIcyField(metadataText, fieldName) {
  const escapedFieldName = String(fieldName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escapedFieldName) return null;
  const match = String(metadataText || "").match(new RegExp(`${escapedFieldName}\\s*=\\s*'([^']*)'`, "i"));
  return match?.[1] || null;
}

function normalizeTrackText(raw) {
  const text = String(raw || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const blockedValues = new Set(["-", "--", "n/a", "na", "none", "null", "undefined", "unknown"]);
  if (blockedValues.has(lower)) return null;
  return text;
}

function parseTrackFromStreamTitle(rawTitle) {
  const cleaned = normalizeTrackText(rawTitle);
  if (!cleaned) {
    return { raw: null, artist: null, title: null, displayTitle: null };
  }

  const separators = [" - ", " – ", " — ", " | ", " ~ ", " / ", " :: ", ": "];
  for (const separator of separators) {
    const index = cleaned.indexOf(separator);
    if (index <= 0 || index >= cleaned.length - separator.length) continue;
    const left = normalizeTrackText(cleaned.slice(0, index));
    const right = normalizeTrackText(cleaned.slice(index + separator.length));
    if (!left || !right) continue;
    return {
      raw: cleaned,
      artist: left,
      title: right,
      displayTitle: `${left} - ${right}`,
    };
  }

  return {
    raw: cleaned,
    artist: null,
    title: cleaned,
    displayTitle: cleaned,
  };
}

async function fetchCoverArtForTrack(artist, title) {
  if (!NOW_PLAYING_COVER_ENABLED) return null;

  const artistPart = normalizeTrackText(artist);
  const titlePart = normalizeTrackText(title);
  const query = clipText([artistPart, titlePart].filter(Boolean).join(" "), 180);
  if (!query || query.length < 3) return null;

  const cacheKey = query.toLowerCase();
  const now = Date.now();
  const cached = nowPlayingCoverCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.url || null;

  if (nowPlayingCoverInFlight.has(cacheKey)) {
    return nowPlayingCoverInFlight.get(cacheKey);
  }

  const request = (async () => {
    let artworkUrl = null;
    try {
      const endpoint = new URL("https://itunes.apple.com/search");
      endpoint.searchParams.set("term", query);
      endpoint.searchParams.set("media", "music");
      endpoint.searchParams.set("entity", "song");
      endpoint.searchParams.set("limit", "1");

      const response = await fetch(endpoint.toString(), {
        method: "GET",
        headers: { "User-Agent": "OmniFM/3.0" },
        signal: AbortSignal.timeout(NOW_PLAYING_COVER_TIMEOUT_MS),
      });
      if (!response.ok) {
        nowPlayingCoverCache.set(cacheKey, { url: null, expiresAt: now + NOW_PLAYING_COVER_CACHE_TTL_MS });
        return null;
      }

      const payload = await response.json().catch(() => null);
      const result = Array.isArray(payload?.results) ? payload.results[0] : null;
      artworkUrl = result?.artworkUrl100 || result?.artworkUrl60 || null;
      if (artworkUrl) {
        artworkUrl = artworkUrl.replace(/\/\d+x\d+bb\./i, "/600x600bb.");
      }
    } catch {
      artworkUrl = null;
    }

    nowPlayingCoverCache.set(cacheKey, {
      url: artworkUrl || null,
      expiresAt: now + NOW_PLAYING_COVER_CACHE_TTL_MS,
    });
    return artworkUrl || null;
  })().finally(() => {
    nowPlayingCoverInFlight.delete(cacheKey);
  });

  nowPlayingCoverInFlight.set(cacheKey, request);
  return request;
}

async function fetchStreamSnapshot(url, { includeCover = false } = {}) {
  const empty = {
    name: null,
    description: null,
    streamTitle: null,
    artist: null,
    title: null,
    displayTitle: null,
    artworkUrl: null,
  };

  let res = null;
  let reader = null;

  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "Icy-MetaData": "1",
        "User-Agent": "OmniFM/3.0"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(NOW_PLAYING_FETCH_TIMEOUT_MS)
    });

    const snapshot = {
      ...empty,
      name: normalizeTrackText(res.headers.get("icy-name")),
      description: normalizeTrackText(res.headers.get("icy-description")),
    };

    const metaint = Number.parseInt(String(res.headers.get("icy-metaint") || "").trim(), 10);
    if (!res.body || !Number.isFinite(metaint) || metaint <= 0 || metaint > NOW_PLAYING_MAX_METAINT_BYTES) {
      return snapshot;
    }

    reader = res.body.getReader();
    let buffer = new Uint8Array(0);

    const readAtLeast = async (requiredBytes) => {
      while (buffer.length < requiredBytes) {
        const { done, value } = await reader.read();
        if (done) return false;
        if (value?.length) {
          buffer = concatUint8Arrays(buffer, value);
        }
      }
      return true;
    };

    if (!(await readAtLeast(metaint + 1))) {
      return snapshot;
    }

    buffer = buffer.slice(metaint);
    const metadataLength = (buffer[0] || 0) * 16;
    buffer = buffer.slice(1);
    if (metadataLength <= 0) {
      return snapshot;
    }

    if (!(await readAtLeast(metadataLength))) {
      return snapshot;
    }

    const metadataChunk = buffer.slice(0, metadataLength);
    const metadataText = new TextDecoder("utf-8")
      .decode(metadataChunk)
      .replace(/\u0000+/g, "")
      .trim();
    const track = parseTrackFromStreamTitle(extractIcyField(metadataText, "StreamTitle"));
    snapshot.streamTitle = track.raw;
    snapshot.artist = track.artist;
    snapshot.title = track.title;
    snapshot.displayTitle = track.displayTitle;

    if (includeCover && track.displayTitle) {
      snapshot.artworkUrl = await fetchCoverArtForTrack(track.artist, track.title || track.displayTitle);
    }

    return snapshot;
  } catch {
    return empty;
  } finally {
    try {
      if (reader) await reader.cancel();
    } catch {
      // ignore
    }
    try {
      await res?.body?.cancel?.();
    } catch {
      // ignore
    }
  }
}

function splitTextForDiscord(content, maxLength = 1900) {
  const text = String(content ?? "");
  if (!text) return [""];

  const lines = text.split("\n");
  const chunks = [];
  let current = "";

  const flushCurrent = () => {
    if (!current) return;
    chunks.push(current);
    current = "";
  };

  for (const rawLine of lines) {
    const line = String(rawLine ?? "");

    if (line.length > maxLength) {
      flushCurrent();
      for (let i = 0; i < line.length; i += maxLength) {
        chunks.push(line.slice(i, i + maxLength));
      }
      continue;
    }

    if (!current) {
      current = line;
      continue;
    }

    if ((current.length + 1 + line.length) > maxLength) {
      flushCurrent();
      current = line;
      continue;
    }

    current += `\n${line}`;
  }

  flushCurrent();
  return chunks.length ? chunks : [""];
}

const TIER_RANK = { free: 0, pro: 1, ultimate: 2 };
const TRUST_PROXY_HEADERS = String(process.env.TRUST_PROXY_HEADERS || "0") === "1";

function getStripeSecretKey() {
  return String(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || "").trim();
}

function sanitizeHostHeader(rawHost) {
  const host = String(rawHost || "").trim();
  if (!host) return "";
  if (/[\s/\\]/.test(host)) return "";
  return host;
}

function getRequestOrigin(req) {
  const host = sanitizeHostHeader(req.headers.host);
  if (!host) return null;
  const forwardedProto = TRUST_PROXY_HEADERS
    ? String(req.headers["x-forwarded-proto"] || "").trim().toLowerCase().split(",")[0].trim()
    : "";
  const socketProto = req.socket?.encrypted ? "https" : "http";
  const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : socketProto;
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

function parseCsvEnv(rawValue) {
  return String(rawValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildWebDomainOriginCandidates() {
  const rawDomain = String(process.env.WEB_DOMAIN || "").trim();
  if (!rawDomain) return [];

  let host = rawDomain.replace(/^https?:\/\//i, "").trim();
  host = host.replace(/\/.*$/, "").trim();
  if (!host || /[\s/\\]/.test(host)) return [];

  let hostOnly = host;
  let portPart = "";
  const lastColon = host.lastIndexOf(":");
  if (lastColon > 0 && /^\d+$/.test(host.slice(lastColon + 1))) {
    hostOnly = host.slice(0, lastColon);
    portPart = `:${host.slice(lastColon + 1)}`;
  }

  const candidates = [`https://${host}`];
  if (/^www\./i.test(hostOnly)) {
    candidates.push(`https://${hostOnly.replace(/^www\./i, "")}${portPart}`);
  } else if (hostOnly.includes(".")) {
    candidates.push(`https://www.${hostOnly}${portPart}`);
  }

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const origin = toOrigin(candidate);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    unique.push(origin);
  }
  return unique;
}

function getConfiguredPublicOrigin(publicUrl) {
  const explicit = toOrigin(publicUrl);
  if (explicit) return explicit;
  const domainOrigins = buildWebDomainOriginCandidates();
  return domainOrigins[0] || "http://localhost";
}

function buildAllowedReturnOrigins(publicUrl, req) {
  const configured = [
    ...parseCsvEnv(process.env.CHECKOUT_RETURN_ORIGINS || ""),
    ...parseCsvEnv(process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || ""),
  ];

  const candidates = [
    ...configured,
    publicUrl,
    ...buildWebDomainOriginCandidates(),
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
  const fallback = getConfiguredPublicOrigin(publicUrl);
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

function buildAllowedApiOrigins(publicUrl, req) {
  const configured = parseCsvEnv(process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || "");

  const candidates = [
    ...configured,
    publicUrl,
    ...buildWebDomainOriginCandidates(),
    getRequestOrigin(req),
    "http://localhost",
    "http://127.0.0.1",
    "http://localhost:3000",
    "http://127.0.0.1:3000"
  ];

  const allowed = new Set();
  for (const candidate of candidates) {
    const origin = toOrigin(candidate);
    if (origin) allowed.add(origin);
  }
  return allowed;
}

function applyCors(req, res, publicUrl) {
  const originHeader = String(req.headers.origin || "").trim();
  const allowedOrigins = buildAllowedApiOrigins(publicUrl, req);
  const normalizedOrigin = toOrigin(originHeader);
  const hasOriginHeader = originHeader.length > 0;

  let originAllowed = !hasOriginHeader;
  if (hasOriginHeader && normalizedOrigin && allowedOrigins.has(normalizedOrigin)) {
    originAllowed = true;
    res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
    res.setHeader("Vary", "Origin");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token, X-Admin-User");
  return originAllowed;
}

function getAdminApiToken() {
  return String(process.env.API_ADMIN_TOKEN || process.env.ADMIN_API_TOKEN || "").trim();
}

function safeTokenEquals(rawLeft, rawRight) {
  const left = Buffer.from(String(rawLeft || ""), "utf8");
  const right = Buffer.from(String(rawRight || ""), "utf8");
  if (left.length === 0 || right.length === 0) return false;
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function isAdminApiRequest(req) {
  const configuredToken = getAdminApiToken();
  if (!configuredToken) return false;

  const headerToken = String(req.headers["x-admin-token"] || "").trim();
  if (headerToken && safeTokenEquals(headerToken, configuredToken)) return true;

  const auth = String(req.headers.authorization || "").trim();
  if (/^Bearer\s+/i.test(auth)) {
    const bearer = auth.replace(/^Bearer\s+/i, "").trim();
    if (bearer && safeTokenEquals(bearer, configuredToken)) return true;
  }

  return false;
}

function sanitizeLicenseForApi(license, includeSensitive = false) {
  if (!license) return null;

  const safe = {
    tier: license.plan || "free",
    plan: license.plan || "free",
    seats: normalizeSeats(license.seats || 1),
    active: Boolean(license.active) && !Boolean(license.expired),
    expired: Boolean(license.expired),
    expiresAt: license.expiresAt || null,
    remainingDays: Number.isFinite(license.remainingDays) ? license.remainingDays : null,
  };

  if (includeSensitive) {
    safe.id = license.id || null;
    safe.linkedServerIds = Array.isArray(license.linkedServerIds) ? [...license.linkedServerIds] : [];
  }

  return safe;
}

const COMMAND_ARG_OPTION_TYPES = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11]);

function formatCommandArgToken(option) {
  const name = String(option?.name || "").trim();
  if (!name) return "";
  return option.required ? `<${name}>` : `[${name}]`;
}

function buildCommandArgsFromOptions(options) {
  if (!Array.isArray(options) || !options.length) return "";

  const subcommands = options.filter((opt) => opt?.type === 1 && opt?.name);
  if (subcommands.length) {
    const parts = subcommands.map((sub) => {
      const subArgs = buildCommandArgsFromOptions(sub.options);
      return subArgs ? `${sub.name} ${subArgs}` : sub.name;
    });
    return `<${parts.join(" | ")}>`;
  }

  const subcommandGroups = options.filter((opt) => opt?.type === 2 && opt?.name);
  if (subcommandGroups.length) {
    const parts = subcommandGroups.map((group) => {
      const nestedSubs = Array.isArray(group.options)
        ? group.options.filter((opt) => opt?.type === 1 && opt?.name)
        : [];
      if (!nestedSubs.length) return String(group.name);
      const nested = nestedSubs.map((sub) => {
        const subArgs = buildCommandArgsFromOptions(sub.options);
        return subArgs ? `${sub.name} ${subArgs}` : sub.name;
      });
      return `${group.name} ${nested.join(" | ")}`;
    });
    return `<${parts.join(" | ")}>`;
  }

  return options
    .filter((opt) => COMMAND_ARG_OPTION_TYPES.has(opt?.type))
    .map((opt) => formatCommandArgToken(opt))
    .filter(Boolean)
    .join(" ");
}

function buildApiCommands() {
  return buildCommandBuilders().map((builder) => {
    const json = builder.toJSON();
    const args = buildCommandArgsFromOptions(json.options);

    return {
      name: `/${json.name}`,
      args,
      description: json.description,
    };
  });
}

const API_COMMANDS = buildApiCommands();

async function fetchStreamInfo(url) {
  const snapshot = await fetchStreamSnapshot(url, { includeCover: false });
  return {
    name: snapshot.name,
    description: snapshot.description,
    streamTitle: snapshot.streamTitle,
    artist: snapshot.artist,
    title: snapshot.title,
    displayTitle: snapshot.displayTitle,
    artworkUrl: null,
    updatedAt: new Date().toISOString(),
  };
}

async function createResource(url, volume, qualityPreset, botName, bitrateOverride) {
  const preset = qualityPreset || "custom";
  const presetBitrate =
    preset === "low" ? "96k" : preset === "medium" ? "128k" : preset === "high" ? "192k" : null;
  const profile = buildTranscodeProfile({ bitrateOverride, qualityPreset: preset });

  const transcode = String(process.env.TRANSCODE || "0") === "1" || preset !== "custom" || !!bitrateOverride;
  if (transcode) {
    const mode = String(process.env.TRANSCODE_MODE || "opus").toLowerCase();
    const args = [
      "-loglevel", "warning",
      // === Stable streaming profile (favors fewer dropouts over minimum latency) ===
      "-fflags", "+genpts+discardcorrupt",
      "-probesize", profile.probeSize,
      "-analyzeduration", profile.analyzeDuration,
      "-thread_queue_size", profile.threadQueueSize,
      "-rtbufsize", profile.rtbufsize,
      "-max_delay", profile.maxDelayUs,
      // === Reconnect bei Stream-Abbruch ===
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_delay_max", "5",
      "-reconnect_on_network_error", "1",
      "-reconnect_on_http_error", "4xx,5xx",
      "-rw_timeout", profile.rwTimeoutUs,
      "-timeout", profile.ioTimeoutUs,
      // === Input ===
      "-i", url,
      "-ar", "48000",
      "-ac", "2",
      "-vn",
      "-af", "aresample=async=1:first_pts=0",
      "-flush_packets", profile.outputFlushPackets,
    ];

    let inputType = StreamType.Raw;
    if (mode === "opus") {
      const bitrate = bitrateOverride || presetBitrate || String(process.env.OPUS_BITRATE || "192k");
      const vbr = String(process.env.OPUS_VBR || "on");
      // compression_level 5 statt 10 = weniger CPU-Last = weniger Latenz
      const compression = String(process.env.OPUS_COMPRESSION || "5");
      const frame = String(process.env.OPUS_FRAME || "20");
      const application = String(process.env.OPUS_APPLICATION || (profile.isUltra ? "audio" : "lowdelay")).toLowerCase();
      const packetLoss = String(process.env.OPUS_PACKET_LOSS || (profile.isUltra ? "8" : "3"));

      args.push(
        "-c:a", "libopus",
        "-b:a", bitrate,
        "-vbr", vbr,
        "-compression_level", compression,
        "-frame_duration", frame,
        "-application", application,
        "-packet_loss", packetLoss,
        "-cutoff", "20000",
        "-f", "ogg",
        "pipe:1"
      );
      inputType = StreamType.OggOpus;
    } else {
      args.push("-f", "s16le", "-acodec", "pcm_s16le", "pipe:1");
      inputType = StreamType.Raw;
    }

    log("INFO", `[${botName}] ffmpeg profile=${profile.isUltra ? "ultra-stable" : "stable"} bitrate=${profile.requestedKbps}k queue=${profile.threadQueueSize} probe=${profile.probeSize} analyzeUs=${profile.analyzeDuration}`);
    const loggedArgs = args.map((value, index) => {
      const raw = String(value || "");
      if ((index > 0 && args[index - 1] === "-i") || /^https?:\/\//i.test(raw)) {
        return sanitizeUrlForLog(raw);
      }
      return raw;
    });
    log("INFO", `[${botName}] ffmpeg ${loggedArgs.join(" ")}`);
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
        if (isLikelyNetworkFailureLine(trimmed)) {
          networkRecoveryCoordinator.noteFailure(`${botName} ffmpeg`, trimmed);
        }
        if (!shouldLogFfmpegStderrLine(trimmed)) continue;
        log("INFO", `[${botName}] ffmpeg: ${clipText(trimmed, 500)}`);
      }
    });

    ffmpeg.stdout.once("data", () => {
      networkRecoveryCoordinator.noteSuccess(`${botName} ffmpeg audio`);
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
  networkRecoveryCoordinator.noteSuccess(`${botName} fetch-stream`);
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
    this.eventSchedulerTimer = null;
    this.scheduledEventInFlight = new Set();
    this.unsubscribeNetworkRecovery = networkRecoveryCoordinator.onRecovered(() => {
      this.handleNetworkRecovered();
    });

    this.client.once("clientReady", () => {
      this.readyAt = Date.now();
      log("INFO", `[${this.config.name}] Eingeloggt als ${this.client.user.tag}`);
      const runtimeAppId = this.getApplicationId();
      if (runtimeAppId && runtimeAppId !== String(this.config.clientId || "")) {
        log(
          "INFO",
          `[${this.config.name}] CLIENT_ID mismatch erkannt (env=${this.config.clientId}, runtime=${runtimeAppId}). Command-Sync nutzt runtime-ID.`
        );
      }
      this.updatePresence();
      this.enforcePremiumGuildScope("startup").catch((err) => {
        log("ERROR", `[${this.config.name}] Premium-Guild-Scope Pruefung fehlgeschlagen: ${err?.message || err}`);
      });
      this.refreshGuildCommandsOnReady().catch((err) => {
        log("ERROR", `[${this.config.name}] Guild-Command-Sync fehlgeschlagen: ${err?.message || err}`);
      });
      this.startEventScheduler();
    });

    this.client.on("interactionCreate", (interaction) => {
      this.handleInteraction(interaction).catch(async (err) => {
        log("ERROR", `[${this.config.name}] interaction error: ${err?.stack || err}`);
        try {
          if (!interaction.isRepliable || !interaction.isRepliable()) return;
          const { t } = this.createInteractionTranslator(interaction);
          const errorMessage = t(
            "Es ist ein Fehler aufgetreten. Bitte versuche es erneut.",
            "An error occurred. Please try again."
          );
          if (interaction.deferred || interaction.replied) {
            await interaction.editReply({ content: errorMessage });
          } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
          }
        } catch {
          // ignore secondary reply failures
        }
      });
    });

    this.client.on("voiceStateUpdate", (oldState, newState) => {
      this.handleBotVoiceStateUpdate(oldState, newState);
    });

    this.client.on("guildCreate", (guild) => {
      this.handleGuildJoin(guild).then((allowed) => {
        if (!allowed) return;
        this.syncGuildCommands("join", { guildId: guild?.id }).catch((err) => {
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
        streamStableTimer: null,
        lastStreamErrorAt: null,
        reconnectCount: 0,
        lastReconnectAt: null,
        reconnectAttempts: 0,
        reconnectTimer: null,
        streamRestartTimer: null,
        shouldReconnect: false,
        streamErrorCount: 0,
        lastStreamStartAt: null,
        lastProcessExitCode: null,
        lastProcessExitAt: 0,
        lastNetworkFailureAt: 0,
        nowPlayingRefreshTimer: null,
        nowPlayingMessageId: null,
        nowPlayingChannelId: null,
        nowPlayingSignature: null,
        nowPlayingLastErrorAt: 0,
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

  getStreamDiagnostics(guildId, state) {
    const tierConfig = getTierConfig(guildId);
    const stations = loadStations();
    const preset = stations.qualityPreset || "custom";
    const bitrateOverride = tierConfig.bitrate;
    const transcodeEnabled = String(process.env.TRANSCODE || "0") === "1" || preset !== "custom" || !!bitrateOverride;
    const profile = buildTranscodeProfile({ bitrateOverride, qualityPreset: preset });
    const streamLifetimeSec = state.lastStreamStartAt ? Math.floor((Date.now() - state.lastStreamStartAt) / 1000) : 0;

    return {
      preset,
      tier: tierConfig.tier,
      bitrateOverride,
      transcodeEnabled,
      transcodeMode: String(process.env.TRANSCODE_MODE || "opus").toLowerCase(),
      requestedBitrateKbps: profile.requestedKbps,
      profile: profile.isUltra ? "ultra-stable" : "stable",
      queue: profile.threadQueueSize,
      probeSize: profile.probeSize,
      analyzeUs: profile.analyzeDuration,
      streamLifetimeSec,
    };
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
      this.clearNowPlayingTimer(state);
      state.player.stop();
      this.clearCurrentProcess(state);
      if (state.connection) {
        try { state.connection.destroy(); } catch {}
      }
      this.guildState.delete(guildId);
    }
    deleteScheduledEventsByFilter({ guildId, botId: this.config.id });
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
    if (this.isGuildCommandCleanupEnabled()) {
      log(
        "INFO",
        `[${this.config.name}] CLEAN_GUILD_COMMANDS_ON_BOOT=1 erkannt, Cleanup wird im Schutzmodus uebersprungen. Es erfolgt ein direkter Voll-Sync.`
      );
    }
    await this.syncGuildCommands("startup");
  }

  isGuildCommandSyncEnabled() {
    return String(process.env.SYNC_GUILD_COMMANDS_ON_BOOT ?? "1") !== "0";
  }

  buildGuildCommandPayload() {
    return buildCommandBuilders().map((builder) => builder.toJSON());
  }

  getApplicationId() {
    return String(this.client.user?.id || this.config.clientId || "").trim();
  }

  isGuildCommandCleanupEnabled() {
    if (!this.isGuildCommandSyncEnabled()) return false;
    return String(process.env.CLEAN_GUILD_COMMANDS_ON_BOOT ?? "0") !== "0";
  }

  async syncGuildCommands(source = "sync", options = {}) {
    if (!this.isGuildCommandSyncEnabled()) return;
    const payload = this.buildGuildCommandPayload();
    const targetGuildIds = Array.isArray(options?.guildIds)
      ? options.guildIds
      : options?.guildId
        ? [options.guildId]
        : null;
    await syncGuildCommandsSafe({
      client: this.client,
      rest: this.rest,
      routes: Routes,
      commands: payload,
      guildIds: targetGuildIds,
      botToken: this.config.token,
      botLabel: `${this.config.name}`,
      source,
      logFn: (level, message) => log(level, message),
    });
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
    this.clearStreamStabilityTimer(state);
  }

  clearStreamStabilityTimer(state) {
    if (state.streamStableTimer) {
      clearTimeout(state.streamStableTimer);
      state.streamStableTimer = null;
    }
  }

  clearNowPlayingTimer(state) {
    if (state.nowPlayingRefreshTimer) {
      clearInterval(state.nowPlayingRefreshTimer);
      state.nowPlayingRefreshTimer = null;
    }
  }

  logNowPlayingIssue(guildId, state, message) {
    const now = Date.now();
    const cooldownMs = 120_000;
    if (state.nowPlayingLastErrorAt && now - state.nowPlayingLastErrorAt < cooldownMs) return;
    state.nowPlayingLastErrorAt = now;
    log("INFO", `[${this.config.name}] NowPlaying guild=${guildId}: ${message}`);
  }

  async resolveNowPlayingChannel(guildId, state) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return null;

    const channelId = state.connection?.joinConfig?.channelId || state.lastChannelId || null;
    if (!channelId) return null;

    let channel = guild.channels.cache.get(channelId);
    if (!channel) {
      channel = await guild.channels.fetch(channelId).catch(() => null);
    }
    if (!channel || typeof channel.send !== "function") return null;

    const me = await this.resolveBotMember(guild);
    if (!me) return null;
    const perms = channel.permissionsFor?.(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel)) return null;
    if (!perms?.has(PermissionFlagsBits.SendMessages)) return null;

    return channel;
  }

  buildNowPlayingEmbed(guildId, station, meta) {
    const tierConfig = getTierConfig(guildId);
    const trackLabel = clipText(meta?.displayTitle || meta?.streamTitle || "", 180);
    const hasTrack = Boolean(trackLabel);
    const fields = [
      {
        name: "Sender",
        value: clipText(station?.name || meta?.name || "-", 120) || "-",
        inline: true,
      },
      {
        name: "Qualitaet",
        value: tierConfig.bitrate || "-",
        inline: true,
      },
    ];

    if (meta?.artist) {
      fields.push({ name: "Artist", value: clipText(meta.artist, 120), inline: true });
    }
    if (meta?.title) {
      fields.push({ name: "Titel", value: clipText(meta.title, 120), inline: true });
    }
    if (meta?.description) {
      fields.push({ name: "Stream-Info", value: clipText(meta.description, 240), inline: false });
    }

    const embed = {
      color: hasTrack ? 0xFFB800 : 0x5865F2,
      title: "Now Playing",
      description: hasTrack
        ? `**${trackLabel}**`
        : "Keine Live-Track-Metadaten vom Radiosender verfuegbar.",
      fields,
      footer: {
        text: `${this.config.name} | Auto-Update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`
      },
      timestamp: new Date().toISOString(),
    };

    if (meta?.artworkUrl) {
      embed.thumbnail = { url: meta.artworkUrl };
    }

    return embed;
  }

  recordSongHistory(guildId, state, station, meta) {
    if (!SONG_HISTORY_ENABLED) return;
    if (!meta) return;

    const displayTitle = clipText(meta.displayTitle || meta.streamTitle || "", 220);
    if (!displayTitle) return;

    try {
      appendSongHistory(guildId, {
        botId: this.config.id,
        stationKey: state.currentStationKey || null,
        stationName: station?.name || state.currentStationName || null,
        displayTitle,
        streamTitle: clipText(meta.streamTitle || "", 220) || null,
        artist: clipText(meta.artist || "", 120) || null,
        title: clipText(meta.title || "", 120) || null,
        artworkUrl: clipText(meta.artworkUrl || "", 600) || null,
        timestampMs: Date.now(),
      }, {
        maxPerGuild: SONG_HISTORY_MAX_PER_GUILD,
        dedupeWindowMs: SONG_HISTORY_DEDUPE_WINDOW_MS,
      });
    } catch (err) {
      this.logNowPlayingIssue(guildId, state, `SongHistory: ${clipText(err?.message || String(err), 180)}`);
    }
  }

  async upsertNowPlayingMessage(guildId, state, embed, channelOverride = null) {
    const channel = channelOverride || await this.resolveNowPlayingChannel(guildId, state);
    if (!channel) return false;

    if (state.nowPlayingChannelId && state.nowPlayingChannelId !== channel.id) {
      state.nowPlayingMessageId = null;
    }
    state.nowPlayingChannelId = channel.id;

    const payload = {
      embeds: [embed],
      allowedMentions: { parse: [] },
    };

    if (state.nowPlayingMessageId && channel.messages?.fetch) {
      const existing = await channel.messages.fetch(state.nowPlayingMessageId).catch(() => null);
      if (existing?.edit) {
        try {
          await existing.edit(payload);
          return true;
        } catch {
          state.nowPlayingMessageId = null;
        }
      }
    }

    try {
      const sent = await channel.send(payload);
      if (sent?.id) {
        state.nowPlayingMessageId = sent.id;
      }
      return true;
    } catch {
      return false;
    }
  }

  async updateNowPlayingEmbed(guildId, state, { force = false } = {}) {
    if (!NOW_PLAYING_ENABLED) return;
    if (!state.currentStationKey) return;
    if (!state.connection) return;
    const channel = await this.resolveNowPlayingChannel(guildId, state);
    if (!channel) return;

    const stationKey = state.currentStationKey;
    const stations = loadStations();
    const station = stations.stations[stationKey];
    if (!station?.url) return;

    try {
      const snapshot = await fetchStreamSnapshot(station.url, { includeCover: NOW_PLAYING_COVER_ENABLED });
      if (state.currentStationKey !== stationKey) return;

      const nextMeta = {
        name: snapshot.name || state.currentMeta?.name || station.name || stationKey,
        description: snapshot.description || state.currentMeta?.description || null,
        streamTitle: snapshot.streamTitle || null,
        artist: snapshot.artist || null,
        title: snapshot.title || null,
        displayTitle: snapshot.displayTitle || snapshot.streamTitle || null,
        artworkUrl: snapshot.artworkUrl || null,
        updatedAt: new Date().toISOString(),
      };
      state.currentMeta = nextMeta;
      this.recordSongHistory(guildId, state, station, nextMeta);

      const signature = [
        stationKey,
        nextMeta.displayTitle || "",
        nextMeta.artist || "",
        nextMeta.title || "",
        nextMeta.artworkUrl || "",
      ].join("|").toLowerCase();

      if (!force && signature === state.nowPlayingSignature) {
        return;
      }

      const embed = this.buildNowPlayingEmbed(guildId, station, nextMeta);
      const sent = await this.upsertNowPlayingMessage(guildId, state, embed, channel);
      if (sent) {
        state.nowPlayingSignature = signature;
      }
    } catch (err) {
      this.logNowPlayingIssue(guildId, state, clipText(err?.message || String(err), 200));
    }
  }

  startNowPlayingLoop(guildId, state) {
    this.clearNowPlayingTimer(state);
    state.nowPlayingSignature = null;
    if (!NOW_PLAYING_ENABLED || !state.currentStationKey) return;

    const update = () => {
      this.updateNowPlayingEmbed(guildId, state).catch((err) => {
        this.logNowPlayingIssue(guildId, state, clipText(err?.message || String(err), 200));
      });
    };

    update();
    state.nowPlayingRefreshTimer = setInterval(update, NOW_PLAYING_POLL_MS);
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

  armStreamStabilityReset(guildId, state) {
    this.clearStreamStabilityTimer(state);
    state.streamStableTimer = setTimeout(() => {
      state.streamStableTimer = null;
      if (!state.currentStationKey) return;
      state.streamErrorCount = 0;
      state.lastProcessExitCode = null;
      state.lastProcessExitAt = 0;
      state.lastNetworkFailureAt = 0;
      networkRecoveryCoordinator.noteSuccess(`${this.config.name} stable-stream guild=${guildId}`);
    }, STREAM_STABLE_RESET_MS);
  }

  trackProcessLifecycle(guildId, state, process) {
    if (!process) return;
    let stderrBuffer = "";

    if (process.stderr?.on) {
      process.stderr.on("data", (chunk) => {
        stderrBuffer += chunk.toString();
        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!isLikelyNetworkFailureLine(trimmed)) continue;
          state.lastNetworkFailureAt = Date.now();
        }
      });
    }

    process.on("close", (code) => {
      if (state.currentProcess === process) {
        state.currentProcess = null;
      }
      state.lastProcessExitAt = Date.now();
      state.lastProcessExitCode = Number.isFinite(code) ? Number(code) : null;
      if (code && code !== 0) {
        state.lastStreamErrorAt = new Date().toISOString();
        log("INFO", `[${this.config.name}] ffmpeg exited with code ${code} (guild=${guildId})`);
      }
    });
    process.on("error", (err) => {
      log("ERROR", `[${this.config.name}] ffmpeg process error: ${err?.message || err}`);
      state.lastStreamErrorAt = new Date().toISOString();
      if (state.currentProcess === process) {
        state.currentProcess = null;
      }
    });
  }

  scheduleStreamRestart(guildId, state, delayMs, reason = "restart") {
    if (state.streamRestartTimer) {
      clearTimeout(state.streamRestartTimer);
    }

    const delay = applyJitter(Math.max(250, Number(delayMs) || 0), 0.15);
    state.streamRestartTimer = setTimeout(() => {
      state.streamRestartTimer = null;
      this.restartCurrentStation(state, guildId).catch((err) => {
        log("ERROR", `[${this.config.name}] Stream restart failed (${reason}): ${err?.message || err}`);
      });
    }, delay);
  }

  handleStreamEnd(guildId, state, reason) {
    if (!state.shouldReconnect || !state.currentStationKey) return;
    // Don't restart stream if there's no voice connection (reconnect handler will deal with it)
    if (!state.connection) return;

    const now = Date.now();
    const streamLifetimeMs = state.lastStreamStartAt ? (now - state.lastStreamStartAt) : 0;
    const earlyIdle = reason === "idle" && streamLifetimeMs > 0 && streamLifetimeMs < 5000;
    const recentProcessFailure = (state.lastProcessExitCode ?? 0) !== 0
      && state.lastProcessExitAt > 0
      && (now - state.lastProcessExitAt) <= STREAM_PROCESS_FAILURE_WINDOW_MS;
    const recentNetworkFailure = state.lastNetworkFailureAt > 0
      && (now - state.lastNetworkFailureAt) <= Math.max(60_000, STREAM_RESTART_MAX_MS);
    const treatAsError = reason === "error" || earlyIdle || recentProcessFailure;

    if (treatAsError) {
      state.streamErrorCount = (state.streamErrorCount || 0) + 1;
    } else {
      state.streamErrorCount = 0;
    }

    const errorCount = state.streamErrorCount || 0;
    const tierConfig = getTierConfig(guildId);
    let delay = Math.max(1_000, tierConfig.reconnectMs);

    if (treatAsError) {
      const exp = Math.min(Math.max(errorCount - 1, 0), 8);
      delay = Math.min(STREAM_RESTART_MAX_MS, STREAM_RESTART_BASE_MS * Math.pow(2, exp));
    } else {
      delay = Math.max(delay, STREAM_RESTART_BASE_MS);
    }

    if (recentNetworkFailure) {
      const penalty = Math.min(STREAM_RESTART_MAX_MS, STREAM_RESTART_BASE_MS * Math.pow(2, Math.min(errorCount + 1, 8)));
      delay = Math.max(delay, penalty);
    }

    if (errorCount >= STREAM_ERROR_COOLDOWN_THRESHOLD) {
      delay = Math.max(delay, STREAM_ERROR_COOLDOWN_MS);
      log(
        "INFO",
        `[${this.config.name}] Viele Stream-Fehler (${errorCount}) guild=${guildId}, Cooldown ${STREAM_ERROR_COOLDOWN_MS}ms`
      );
    }

    const networkCooldownMs = networkRecoveryCoordinator.getRecoveryDelayMs(now);
    if (networkCooldownMs > 0) {
      delay = Math.max(delay, networkCooldownMs);
    }

    const reasonLabel = recentProcessFailure && reason === "idle"
      ? "idle-after-ffmpeg-exit"
      : earlyIdle
        ? "idle-early"
        : reason;
    log(
      "INFO",
      `[${this.config.name}] Stream ${reasonLabel} guild=${guildId} lifetimeMs=${streamLifetimeMs} errors=${errorCount}, restart in ${Math.round(delay)}ms`
    );

    this.scheduleStreamRestart(guildId, state, delay, reasonLabel);
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
    this.trackProcessLifecycle(guildId, state, process);

    state.player.play(resource);
    state.currentStationKey = key;
    state.currentStationName = station.name || key;
    state.currentMeta = null;
    state.nowPlayingSignature = null;
    state.lastStreamStartAt = Date.now();
    state.lastProcessExitCode = null;
    state.lastProcessExitAt = 0;
    this.armStreamStabilityReset(guildId, state);
    this.updatePresence();
    this.persistState();
    this.startNowPlayingLoop(guildId, state);

    fetchStreamInfo(station.url)
      .then((meta) => {
        if (state.currentStationKey === key) {
          const prevMeta = state.currentMeta || {};
          state.currentMeta = {
            ...prevMeta,
            name: meta.name || prevMeta.name || station.name || key,
            description: meta.description || prevMeta.description || null,
            streamTitle: meta.streamTitle || prevMeta.streamTitle || null,
            artist: meta.artist || prevMeta.artist || null,
            title: meta.title || prevMeta.title || null,
            displayTitle: meta.displayTitle || prevMeta.displayTitle || meta.streamTitle || prevMeta.streamTitle || null,
            artworkUrl: prevMeta.artworkUrl || null,
            updatedAt: new Date().toISOString(),
          };
          this.recordSongHistory(guildId, state, station, state.currentMeta);
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
      this.clearNowPlayingTimer(state);
      state.currentStationKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.nowPlayingSignature = null;
      this.updatePresence();
      return;
    }

    const networkCooldownMs = networkRecoveryCoordinator.getRecoveryDelayMs();
    if (networkCooldownMs > 0) {
      this.scheduleStreamRestart(guildId, state, Math.max(1_000, networkCooldownMs), "network-cooldown");
      return;
    }

    try {
      this.clearCurrentProcess(state);
      await this.playStation(state, stations, key, guildId);
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
    if (!this.isGuildCommandCleanupEnabled()) return;
    const applicationId = this.getApplicationId();
    if (!applicationId) {
      log("ERROR", `[${this.config.name}] Guild-Command-Cleanup uebersprungen: Application ID fehlt.`);
      return;
    }

    const guildIds = [...this.client.guilds.cache.keys()];
    if (!guildIds.length) return;

    let cleaned = 0;
    let failed = 0;
    log("INFO", `[${this.config.name}] Bereinige Guild-Commands in ${guildIds.length} Servern...`);

    for (const guildId of guildIds) {
      try {
        await this.rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] });
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
      if (!state.currentStationKey || !state.connection) continue;
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
      this.clearNowPlayingTimer(state);
      log("INFO",
        `[${this.config.name}] Voice lost (Guild ${guildId}, Channel ${oldChannelId}). Scheduling auto-reconnect...`
      );
      // scheduleReconnect has built-in dedup (checks reconnectTimer)
      this.scheduleReconnect(guildId, { reason: "voice-lost" });
      return;
    }

    // Intentional disconnect (/stop or shouldReconnect=false) - clean up fully
    log("INFO",
      `[${this.config.name}] Voice left (Guild ${guildId}, Channel ${oldChannelId}). No reconnect.`
    );
    this.clearReconnectTimer(state);
    this.clearNowPlayingTimer(state);
    state.currentStationKey = null;
    state.currentStationName = null;
    state.currentMeta = null;
    state.nowPlayingSignature = null;
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
      this.scheduleReconnect(guildId, { reason: "voice-error" });
    });
  }

  hasGuildManagePermissions(interaction) {
    if (!interaction) return false;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || false;
  }

  isGuildOwner(interaction) {
    const ownerId = String(interaction?.guild?.ownerId || "").trim();
    const userId = String(interaction?.user?.id || "").trim();
    return Boolean(ownerId && userId && ownerId === userId);
  }

  hasPermissionAdminBypass(interaction) {
    return this.isGuildOwner(interaction) || this.hasGuildManagePermissions(interaction);
  }

  resolveGuildLanguage(guildId) {
    const guildKey = String(guildId || "").trim();
    const guildOverride = guildKey ? getGuildLanguage(guildKey) : null;
    if (guildOverride) return guildOverride;

    const guild = guildKey ? this.client.guilds.cache.get(guildKey) : null;
    return resolveLanguageFromDiscordLocale(guild?.preferredLocale, getDefaultLanguage());
  }

  resolveInteractionLanguage(interaction) {
    const guildId = String(interaction?.guildId || "").trim();
    const guildOverride = guildId ? getGuildLanguage(guildId) : null;
    if (guildOverride) return guildOverride;

    const raw = String(
      interaction?.guildLocale
      || interaction?.guild?.preferredLocale
      || interaction?.locale
      || ""
    ).trim();
    return resolveLanguageFromDiscordLocale(raw, getDefaultLanguage());
  }

  createInteractionTranslator(interaction) {
    const language = this.resolveInteractionLanguage(interaction);
    const isDe = language === "de";
    return {
      language,
      isDe,
      t: (de, en) => (isDe ? de : en),
    };
  }

  buildHelpMessage(interaction) {
    const language = this.resolveInteractionLanguage(interaction);
    const isDe = language === "de";
    const guildId = interaction?.guildId;
    const tierConfig = guildId ? getTierConfig(guildId) : PLANS.free;

    if (isDe) {
      const lines = [
        `**${BRAND.name} Hilfe**`,
        `Server: ${interaction.guild?.name || guildId || "-"}`,
        `Plan: ${tierConfig.name} | Audio: ${tierConfig.bitrate} | Max Bots: ${tierConfig.maxBots}`,
        "",
        "**Schnellstart**",
        "1) `/play [station] [channel]` startet Musik im Voice-Channel.",
        "2) `/stations` zeigt alle verfuegbaren Sender fuer deinen Plan.",
        "3) `/stop` beendet den Stream und verlaesst den Channel.",
        "",
        "**Basis-Commands**",
        "`/help` Hilfe anzeigen",
        "`/play [station] [channel]` Sender starten",
        "`/pause` `/resume` Pause/Fortsetzen",
        "`/stop` Stream stoppen",
        "`/setvolume <0-100>` Lautstaerke setzen",
        "`/stations` und `/list [page]` Sender anzeigen",
        "`/now` aktuelle Wiedergabe",
        "`/history [limit]` zuletzt erkannte Songs",
        "`/status`, `/health`, `/diag` Bot- und Stream-Status",
        "`/premium` Premium-Status",
        "`/language show|set|reset` Bot-Sprache (auto nach Server-Sprache oder fix)",
        "`/license activate|info|remove` Lizenz verwalten",
        "",
        "**Pro/Ultimate**",
        "`/perm allow|deny|remove|list|reset` Rollenrechte pro Command (Berechtigung: Server verwalten)",
        "`/event create|list|delete` Events planen (Voice/Stage + optionale Text-Info + Server-Event)",
        "",
        "**Ultimate**",
        "`/addstation <key> <name> <url>` eigene Station hinzufuegen",
        "`/removestation <key>` eigene Station entfernen",
        "`/mystations` eigene Stationen anzeigen",
        "",
        "Support: https://discord.gg/UeRkfGS43R",
      ];
      return lines.join("\n");
    }

    const lines = [
      `**${BRAND.name} Help**`,
      `Server: ${interaction.guild?.name || guildId || "-"}`,
      `Plan: ${tierConfig.name} | Audio: ${tierConfig.bitrate} | Max bots: ${tierConfig.maxBots}`,
      "",
      "**Quick start**",
      "1) `/play [station] [channel]` starts radio in your voice channel.",
      "2) `/stations` shows available stations for your plan.",
      "3) `/stop` ends playback and leaves the channel.",
      "",
      "**Core commands**",
      "`/help` show this help",
      "`/play [station] [channel]` start station",
      "`/pause` `/resume` pause/resume",
      "`/stop` stop stream",
      "`/setvolume <0-100>` set volume",
      "`/stations` and `/list [page]` browse stations",
      "`/now` current playback",
      "`/history [limit]` recently detected songs",
      "`/status`, `/health`, `/diag` bot/stream status",
      "`/premium` premium status",
      "`/language show|set|reset` bot language (auto from server locale or fixed)",
      "`/license activate|info|remove` license management",
      "",
      "**Pro/Ultimate**",
      "`/perm allow|deny|remove|list|reset` role permissions per command (requires: Manage Server)",
      "`/event create|list|delete` schedule events (voice/stage + optional text notice + server event)",
      "",
      "**Ultimate**",
      "`/addstation <key> <name> <url>` add custom station",
      "`/removestation <key>` remove custom station",
      "`/mystations` list custom stations",
      "",
      "Support: https://discord.gg/UeRkfGS43R",
    ];
    return lines.join("\n");
  }

  getInteractionRoleIds(interaction) {
    const ids = new Set();
    const rawRoles = interaction?.member?.roles;

    if (rawRoles?.cache && typeof rawRoles.cache.keys === "function") {
      for (const roleId of rawRoles.cache.keys()) {
        const id = String(roleId || "").trim();
        if (/^\d{17,22}$/.test(id)) ids.add(id);
      }
    } else if (Array.isArray(rawRoles)) {
      for (const roleId of rawRoles) {
        const id = String(roleId || "").trim();
        if (/^\d{17,22}$/.test(id)) ids.add(id);
      }
    } else if (Array.isArray(rawRoles?.value)) {
      for (const roleId of rawRoles.value) {
        const id = String(roleId || "").trim();
        if (/^\d{17,22}$/.test(id)) ids.add(id);
      }
    }

    if (interaction?.guildId) {
      ids.add(String(interaction.guildId));
    }
    return [...ids];
  }

  formatPermissionRoleMentions(roleIds) {
    const ids = Array.isArray(roleIds) ? roleIds.filter((id) => /^\d{17,22}$/.test(String(id || "").trim())) : [];
    if (!ids.length) return "-";
    return ids.map((id) => `<@&${id}>`).join(", ");
  }

  checkCommandRolePermission(interaction, commandName) {
    const guildId = interaction?.guildId;
    const command = normalizePermissionCommandName(commandName);
    if (!guildId || !isPermissionManagedCommand(command)) {
      return { ok: true, enforced: false };
    }

    const { t } = this.createInteractionTranslator(interaction);

    const feature = requireFeature(guildId, "commandPermissions");
    if (!feature.ok) {
      return { ok: true, enforced: false };
    }

    if (this.hasPermissionAdminBypass(interaction)) {
      return { ok: true, enforced: true, bypass: true };
    }

    const roleIds = this.getInteractionRoleIds(interaction);
    const decision = evaluateCommandPermission(guildId, command, roleIds);
    if (decision.allowed) {
      return { ok: true, enforced: decision.configured, decision };
    }

    if (decision.reason === "deny") {
      const blocked = this.formatPermissionRoleMentions(decision.matchedRoleIds || decision.denyRoleIds);
      return {
        ok: false,
        enforced: true,
        decision,
        message: t(
          `Du darfst \`/${command}\` nicht nutzen. Deine Rolle ist dafuer gesperrt (${blocked}).`,
          `You are not allowed to use \`/${command}\`. Your role is blocked for this command (${blocked}).`
        ),
      };
    }

    const requiredRoles = this.formatPermissionRoleMentions(decision.allowRoleIds);
    return {
      ok: false,
      enforced: true,
      decision,
      message: t(
        `Du darfst \`/${command}\` nicht nutzen. Erlaubte Rollen: ${requiredRoles}.`,
        `You are not allowed to use \`/${command}\`. Allowed roles: ${requiredRoles}.`
      ),
    };
  }

  async handlePermissionCommand(interaction) {
    const guildId = interaction.guildId;
    const { t, language } = this.createInteractionTranslator(interaction);

    if (!this.hasGuildManagePermissions(interaction)) {
      await interaction.reply({
        content: t(
          "Du brauchst die Berechtigung `Server verwalten` fuer `/perm`.",
          "You need the `Manage Server` permission for `/perm`."
        ),
        ephemeral: true,
      });
      return;
    }

    const feature = requireFeature(guildId, "commandPermissions");
    if (!feature.ok) {
      await interaction.reply({
        content: `${getFeatureRequirementMessage(feature, language)}\nUpgrade: ${BRAND.upgradeUrl || "https://discord.gg/UeRkfGS43R"}`,
        ephemeral: true,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const rawCommand = interaction.options.getString("command");
    const command = rawCommand ? normalizePermissionCommandName(rawCommand) : null;
    if (command && !isPermissionManagedCommand(command)) {
      await interaction.reply({
        content: t(
          `Unbekannter Command: \`${rawCommand}\``,
          `Unknown command: \`${rawCommand}\``
        ),
        ephemeral: true,
      });
      return;
    }

    if (sub === "allow" || sub === "deny") {
      const role = interaction.options.getRole("role", true);
      const result = setCommandRolePermission(guildId, command, role.id, sub);
      if (!result.ok) {
        const storeMessage = translatePermissionStoreMessage(result.message, language);
        await interaction.reply({ content: t(`Fehler: ${storeMessage}`, `Error: ${storeMessage}`), ephemeral: true });
        return;
      }
      await this.respondLongInteraction(
        interaction,
        `${t("Rolle", "Role")} ${role.toString()} ${t("ist jetzt fuer", "is now")} \`/${command}\` ${sub === "allow" ? t("erlaubt", "allowed") : t("gesperrt", "blocked")}.\n` +
          `Allow: ${this.formatPermissionRoleMentions(result.rule.allowRoleIds)}\n` +
          `Deny: ${this.formatPermissionRoleMentions(result.rule.denyRoleIds)}`,
        { ephemeral: true }
      );
      return;
    }

    if (sub === "remove") {
      const role = interaction.options.getRole("role", true);
      const result = removeCommandRolePermission(guildId, command, role.id);
      if (!result.ok) {
        const storeMessage = translatePermissionStoreMessage(result.message, language);
        await interaction.reply({ content: t(`Fehler: ${storeMessage}`, `Error: ${storeMessage}`), ephemeral: true });
        return;
      }
      await this.respondLongInteraction(
        interaction,
        `${t("Regel fuer", "Rule for")} ${role.toString()} ${t("bei", "on")} \`/${command}\` ${result.changed ? t("entfernt", "removed") : t("war nicht gesetzt", "was not set")}.\n` +
          `Allow: ${this.formatPermissionRoleMentions(result.rule.allowRoleIds)}\n` +
          `Deny: ${this.formatPermissionRoleMentions(result.rule.denyRoleIds)}`,
        { ephemeral: true }
      );
      return;
    }

    if (sub === "reset") {
      const result = resetCommandPermissions(guildId, command || null);
      if (!result.ok) {
        const storeMessage = translatePermissionStoreMessage(result.message, language);
        await interaction.reply({ content: t(`Fehler: ${storeMessage}`, `Error: ${storeMessage}`), ephemeral: true });
        return;
      }

      if (command) {
        await interaction.reply({
          content: result.changed
            ? t(`Regeln fuer \`/${command}\` wurden zurueckgesetzt.`, `Rules for \`/${command}\` were reset.`)
            : t(`Fuer \`/${command}\` waren keine Regeln gesetzt.`, `No rules were configured for \`/${command}\`.`),
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: result.changed
            ? t("Alle Command-Regeln fuer diesen Server wurden zurueckgesetzt.", "All command rules for this server were reset.")
            : t("Es waren keine Command-Regeln gesetzt.", "No command rules were configured."),
          ephemeral: true,
        });
      }
      return;
    }

    if (sub === "list") {
      const rulesByCommand = getGuildCommandPermissionRules(guildId);
      const commands = command ? [command] : getSupportedPermissionCommands();
      const lines = [];

      for (const name of commands) {
        const rule = rulesByCommand[name] || { allowRoleIds: [], denyRoleIds: [] };
        const allowCount = rule.allowRoleIds.length;
        const denyCount = rule.denyRoleIds.length;
        if (!command && allowCount === 0 && denyCount === 0) continue;
        lines.push(
          `\`/${name}\` -> Allow: ${this.formatPermissionRoleMentions(rule.allowRoleIds)} | Deny: ${this.formatPermissionRoleMentions(rule.denyRoleIds)}`
        );
      }

      if (!lines.length) {
        await interaction.reply({
          content: command
            ? t(`Fuer \`/${command}\` sind keine Rollenregeln gesetzt.`, `No role rules are configured for \`/${command}\`.`)
            : t("Keine Command-Rollenregeln gesetzt.", "No command role rules are configured."),
          ephemeral: true,
        });
        return;
      }

      const header = command
        ? t(`Regeln fuer \`/${command}\`:`, `Rules for \`/${command}\`:`)
        : t(`Aktive Command-Rollenregeln (${lines.length}):`, `Active command role rules (${lines.length}):`);
      await this.respondLongInteraction(interaction, `${header}\n${lines.join("\n")}`, { ephemeral: true });
      return;
    }

    await interaction.reply({ content: t("Unbekannte /perm Aktion.", "Unknown /perm action."), ephemeral: true });
  }

  resolveStationForGuild(guildId, rawStationKey, language = "de") {
    const t = (de, en) => languagePick(language, de, en);
    const key = normalizeKey(rawStationKey);
    if (!key) {
      return { ok: false, message: t("Stations-Key ist ungueltig.", "Station key is invalid.") };
    }

    const stations = loadStations();
    const guildTier = getTier(guildId);
    const available = filterStationsByTier(stations.stations, guildTier);
    if (available[key]) {
      stations.stations[key] = available[key];
      return { ok: true, key, station: available[key], stations };
    }

    if (guildTier === "ultimate") {
      const customStations = getGuildStations(guildId);
      const custom = customStations[key];
      if (custom) {
        const validation = validateCustomStationUrl(custom.url);
        if (!validation.ok) {
          const translated = translateCustomStationErrorMessage(validation.error, language);
          return { ok: false, message: t(`Custom-Station kann nicht genutzt werden: ${translated}`, `Custom station cannot be used: ${translated}`) };
        }
        const station = { name: custom.name, url: validation.url, tier: "ultimate" };
        stations.stations[key] = station;
        return { ok: true, key, station, stations };
      }
    }

    if (stations.stations[key]) {
      return { ok: false, message: t(`Station \`${key}\` ist in deinem Plan nicht verfuegbar.`, `Station \`${key}\` is not available in your plan.`) };
    }
    return { ok: false, message: t(`Station \`${key}\` wurde nicht gefunden.`, `Station \`${key}\` was not found.`) };
  }

  async resolveGuildVoiceChannel(guildId, channelId) {
    const guild = this.client.guilds.cache.get(guildId) || await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { guild: null, channel: null };

    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) return { guild, channel: null };
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
      return { guild, channel: null };
    }

    return { guild, channel };
  }

  async ensureStageChannelReady(guild, channel, {
    topic = null,
    guildScheduledEventId = null,
    createInstance = true,
    ensureSpeaker = true,
  } = {}) {
    if (!guild || !channel || channel.type !== ChannelType.GuildStageVoice) return null;

    const me = await this.resolveBotMember(guild);
    if (!me) return null;

    const desiredTopic = clipText(
      String(topic || "").trim() || channel.topic || `${BRAND.name} Live`,
      120
    );

    let stageInstance = channel.stageInstance || await guild.stageInstances.fetch(channel.id).catch(() => null);

    if (!stageInstance && createInstance && desiredTopic) {
      const createOptions = {
        topic: desiredTopic,
        sendStartNotification: false,
      };
      if (/^\d{17,22}$/.test(String(guildScheduledEventId || ""))) {
        createOptions.guildScheduledEvent = String(guildScheduledEventId);
      }
      stageInstance = await channel.createStageInstance(createOptions).catch((err) => {
        log(
          "WARN",
          `[${this.config.name}] Stage-Instance konnte nicht erstellt werden (guild=${guild.id}, channel=${channel.id}): ${err?.message || err}`
        );
        return null;
      });
      if (!stageInstance) {
        stageInstance = channel.stageInstance || await guild.stageInstances.fetch(channel.id).catch(() => null);
      }
    }

    if (stageInstance && desiredTopic && stageInstance.topic !== desiredTopic) {
      stageInstance = await stageInstance.setTopic(desiredTopic).catch((err) => {
        log(
          "WARN",
          `[${this.config.name}] Stage-Topic Update fehlgeschlagen (guild=${guild.id}, channel=${channel.id}): ${err?.message || err}`
        );
        return stageInstance;
      });
    }

    if (ensureSpeaker && me.voice?.channelId === channel.id) {
      const perms = channel.permissionsFor(me);
      if (perms?.has(PermissionFlagsBits.MuteMembers)) {
        await me.voice.setSuppressed(false).catch(() => null);
      } else {
        await me.voice.setRequestToSpeak(true).catch(() => null);
      }
    }

    return stageInstance;
  }

  async deleteDiscordScheduledEventById(guildId, scheduledEventId) {
    const eventId = String(scheduledEventId || "").trim();
    if (!/^\d{17,22}$/.test(eventId)) return false;

    const guild = this.client.guilds.cache.get(guildId) || await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return false;

    const scheduled = await guild.scheduledEvents.fetch(eventId).catch(() => null);
    if (!scheduled) return false;

    await scheduled.delete().catch(() => null);
    return true;
  }

  async syncDiscordScheduledEvent(event, station, { runAtMs = null, forceCreate = false } = {}) {
    if (!event?.createDiscordEvent) return null;

    const { guild, channel } = await this.resolveGuildVoiceChannel(event.guildId, event.voiceChannelId);
    if (!guild || !channel) {
      throw new Error("Voice- oder Stage-Channel fuer Server-Event nicht gefunden.");
    }

    const requestedRunAtMs = Number.parseInt(String(runAtMs ?? event.runAtMs ?? 0), 10);
    const minDiscordStartMs = Date.now() + 60_000;
    const scheduledRunAtMs = Number.isFinite(requestedRunAtMs) && requestedRunAtMs > 0
      ? Math.max(requestedRunAtMs, minDiscordStartMs)
      : minDiscordStartMs;

    const stationName = clipText(station?.name || event.stationKey || "-", 100) || "-";
    const payload = {
      name: clipText(event.name || stationName || `${BRAND.name} Event`, 100),
      scheduledStartTime: new Date(scheduledRunAtMs),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: channel.type === ChannelType.GuildStageVoice
        ? GuildScheduledEventEntityType.StageInstance
        : GuildScheduledEventEntityType.Voice,
      channel,
      description: clipText(`OmniFM Auto-Event | Station: ${stationName}`, 1000),
      reason: `OmniFM scheduled event ${event.id}`,
    };

    const existingId = String(event.discordScheduledEventId || "").trim();
    let scheduledEvent = null;

    if (existingId && forceCreate) {
      await this.deleteDiscordScheduledEventById(guild.id, existingId);
    } else if (existingId) {
      const existingEvent = await guild.scheduledEvents.fetch(existingId).catch(() => null);
      if (existingEvent) {
        scheduledEvent = await existingEvent.edit(payload).catch(() => null);
      }
    }

    if (!scheduledEvent) {
      scheduledEvent = await guild.scheduledEvents.create(payload);
    }

    if (scheduledEvent?.id && scheduledEvent.id !== existingId) {
      patchScheduledEvent(event.id, { discordScheduledEventId: scheduledEvent.id });
    }

    return scheduledEvent || null;
  }

  async ensureVoiceConnectionForChannel(guildId, channelId, state) {
    const { guild, channel } = await this.resolveGuildVoiceChannel(guildId, channelId);
    if (!guild) throw new Error("Guild nicht gefunden.");
    if (!channel) throw new Error("Voice- oder Stage-Channel nicht gefunden.");

    const me = await this.resolveBotMember(guild);
    if (!me) throw new Error("Bot-Mitglied nicht aufloesbar.");

    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.Connect)) {
      throw new Error(`Keine Connect-Berechtigung fuer ${channel.toString()}.`);
    }
    if (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) {
      throw new Error(`Keine Speak-Berechtigung fuer ${channel.toString()}.`);
    }

    state.lastChannelId = channel.id;

    if (state.connection) {
      const currentChannelId = state.connection.joinConfig?.channelId;
      if (currentChannelId === channel.id) {
        state.shouldReconnect = true;
        if (channel.type === ChannelType.GuildStageVoice) {
          await this.ensureStageChannelReady(guild, channel, { createInstance: false, ensureSpeaker: true });
        }
        return { connection: state.connection, guild, channel };
      }

      const previousShouldReconnect = state.shouldReconnect;
      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      try { state.connection.destroy(); } catch {}
      state.connection = null;
      state.shouldReconnect = previousShouldReconnect;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      group: this.voiceGroup,
      selfDeaf: true
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      try { connection.destroy(); } catch {}
      throw new Error("Voice-Verbindung konnte nicht hergestellt werden.");
    }

    connection.subscribe(state.player);
    state.connection = connection;
    state.reconnectAttempts = 0;
    state.lastReconnectAt = new Date().toISOString();
    state.shouldReconnect = true;
    this.clearReconnectTimer(state);
    this.attachConnectionHandlers(guildId, connection);
    networkRecoveryCoordinator.noteSuccess(`${this.config.name} voice-ready guild=${guildId}`);

    if (channel.type === ChannelType.GuildStageVoice) {
      await this.ensureStageChannelReady(guild, channel, { createInstance: false, ensureSpeaker: true });
    }

    return { connection, guild, channel };
  }

  async postScheduledEventAnnouncement(event, station, language = "de") {
    if (!event?.textChannelId) return;

    const guild = this.client.guilds.cache.get(event.guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(event.textChannelId)
      || await guild.channels.fetch(event.textChannelId).catch(() => null);
    if (!channel || typeof channel.send !== "function") return;

    const me = await this.resolveBotMember(guild);
    if (!me) return;

    const perms = channel.permissionsFor?.(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) return;

    const rendered = renderEventAnnouncement(event.announceMessage, {
      event: event.name,
      station: station?.name || event.stationKey,
      voice: `<#${event.voiceChannelId}>`,
      time: formatDateTime(event.runAtMs, language),
    }, language);
    if (!rendered) return;

    await channel.send({
      content: clipText(rendered, 1800),
      allowedMentions: { parse: [] },
    });
  }

  async executeScheduledEvent(event) {
    const now = Date.now();
    if (!this.client.guilds.cache.has(event.guildId)) {
      deleteScheduledEvent(event.id, { guildId: event.guildId, botId: this.config.id });
      return;
    }

    const feature = requireFeature(event.guildId, "scheduledEvents");
    if (!feature.ok) {
      patchScheduledEvent(event.id, { enabled: false, lastRunAtMs: now });
      log(
        "INFO",
        `[${this.config.name}] Event deaktiviert (Plan zu niedrig): guild=${event.guildId} id=${event.id}`
      );
      return;
    }

    const state = this.getState(event.guildId);
    const eventLanguage = this.resolveGuildLanguage(event.guildId);
    const stationResult = this.resolveStationForGuild(event.guildId, event.stationKey, eventLanguage);
    if (!stationResult.ok) {
      patchScheduledEvent(event.id, { runAtMs: now + EVENT_SCHEDULER_RETRY_MS, enabled: true });
      log(
        "ERROR",
        `[${this.config.name}] Event ${event.id} konnte nicht starten: ${stationResult.message}`
      );
      return;
    }

    try {
      const connectionInfo = await this.ensureVoiceConnectionForChannel(event.guildId, event.voiceChannelId, state);
      if (connectionInfo?.channel?.type === ChannelType.GuildStageVoice) {
        const stageTopic = renderStageTopic(event.stageTopic, {
          event: event.name,
          station: stationResult.station?.name || event.stationKey,
          time: formatDateTime(event.runAtMs, eventLanguage),
        });
        await this.ensureStageChannelReady(connectionInfo.guild, connectionInfo.channel, {
          topic: stageTopic,
          guildScheduledEventId: event.discordScheduledEventId || null,
          createInstance: true,
          ensureSpeaker: true,
        });
      }

      await this.playStation(state, stationResult.stations, stationResult.key, event.guildId);
      await this.postScheduledEventAnnouncement(event, stationResult.station, eventLanguage);

      const nextRunAtMs = computeNextEventRunAtMs(event.runAtMs, event.repeat, now);
      if (nextRunAtMs) {
        let nextDiscordScheduledEventId = event.discordScheduledEventId || null;
        if (event.createDiscordEvent) {
          try {
            const nextDiscordEvent = await this.syncDiscordScheduledEvent(event, stationResult.station, {
              runAtMs: nextRunAtMs,
              forceCreate: true,
            });
            nextDiscordScheduledEventId = nextDiscordEvent?.id || nextDiscordScheduledEventId;
          } catch (syncErr) {
            log(
              "WARN",
              `[${this.config.name}] Discord-Server-Event konnte nicht auf Folgetermin gesetzt werden (guild=${event.guildId}, id=${event.id}): ${syncErr?.message || syncErr}`
            );
          }
        }

        patchScheduledEvent(event.id, {
          runAtMs: nextRunAtMs,
          lastRunAtMs: now,
          enabled: true,
          discordScheduledEventId: nextDiscordScheduledEventId,
        });
      } else {
        if (event.discordScheduledEventId) {
          await this.deleteDiscordScheduledEventById(event.guildId, event.discordScheduledEventId);
        }
        deleteScheduledEvent(event.id, { guildId: event.guildId, botId: this.config.id });
      }

      log(
        "INFO",
        `[${this.config.name}] Event gestartet: guild=${event.guildId} id=${event.id} station=${stationResult.key}`
      );
    } catch (err) {
      patchScheduledEvent(event.id, { runAtMs: now + EVENT_SCHEDULER_RETRY_MS, enabled: true });
      log(
        "ERROR",
        `[${this.config.name}] Event ${event.id} Startfehler: ${err?.message || err}`
      );
    }
  }

  async tickScheduledEvents() {
    if (!EVENT_SCHEDULER_ENABLED) return;
    if (!this.client.isReady()) return;

    const now = Date.now();
    const events = listScheduledEvents({
      botId: this.config.id,
      includeDisabled: false,
    });

    for (const event of events) {
      if (event.runAtMs > now + 1000) continue;
      if (event.lastRunAtMs && event.lastRunAtMs >= event.runAtMs) continue;
      if (this.scheduledEventInFlight.has(event.id)) continue;

      this.scheduledEventInFlight.add(event.id);
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.executeScheduledEvent(event);
      } finally {
        this.scheduledEventInFlight.delete(event.id);
      }
    }
  }

  startEventScheduler() {
    if (!EVENT_SCHEDULER_ENABLED) return;
    if (this.eventSchedulerTimer) return;

    const run = () => {
      this.tickScheduledEvents().catch((err) => {
        log("ERROR", `[${this.config.name}] Event-Scheduler Fehler: ${err?.message || err}`);
      });
    };

    run();
    this.eventSchedulerTimer = setInterval(run, EVENT_SCHEDULER_POLL_MS);
  }

  stopEventScheduler() {
    if (this.eventSchedulerTimer) {
      clearInterval(this.eventSchedulerTimer);
      this.eventSchedulerTimer = null;
    }
    this.scheduledEventInFlight.clear();
  }

  async handleEventCommand(interaction) {
    const guildId = interaction.guildId;
    const { t, language } = this.createInteractionTranslator(interaction);
    if (!this.hasGuildManagePermissions(interaction)) {
      await interaction.reply({
        content: t(
          "Du brauchst die Berechtigung `Server verwalten` fuer `/event`.",
          "You need the `Manage Server` permission for `/event`."
        ),
        ephemeral: true,
      });
      return;
    }

    const feature = requireFeature(guildId, "scheduledEvents");
    if (!feature.ok) {
      await interaction.reply({
        content: `${getFeatureRequirementMessage(feature, language)}\nUpgrade: ${BRAND.upgradeUrl || "https://discord.gg/UeRkfGS43R"}`,
        ephemeral: true,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "create") {
      const name = clipText(interaction.options.getString("name", true).trim(), 120);
      if (!name) {
        await interaction.reply({ content: t("Eventname darf nicht leer sein.", "Event name cannot be empty."), ephemeral: true });
        return;
      }
      const stationRaw = interaction.options.getString("station", true);
      const voiceChannel = interaction.options.getChannel("voice", true);
      const startRaw = interaction.options.getString("start", true);
      const repeat = normalizeRepeatMode(interaction.options.getString("repeat") || "none");
      const textChannel = interaction.options.getChannel("text");
      const createDiscordEvent = interaction.options.getBoolean("serverevent") === true;
      const stageTopicTemplate = clipText(interaction.options.getString("stagetopic") || "", 120);
      const message = clipText(interaction.options.getString("message") || "", 1200);

      if (voiceChannel.guildId !== guildId) {
        await interaction.reply({ content: t("Der gewaehlte Voice/Stage-Channel ist nicht in diesem Server.", "The selected voice/stage channel is not in this server."), ephemeral: true });
        return;
      }
      if (stageTopicTemplate && voiceChannel.type !== ChannelType.GuildStageVoice) {
        await interaction.reply({
          content: t("`stagetopic` funktioniert nur mit Stage-Channels.", "`stagetopic` only works with stage channels."),
          ephemeral: true,
        });
        return;
      }

      const me = interaction.guild ? await this.resolveBotMember(interaction.guild) : null;
      if (!me) {
        await interaction.reply({ content: t("Bot-Mitglied im Server konnte nicht geladen werden.", "Could not load bot member in this server."), ephemeral: true });
        return;
      }
      const perms = voiceChannel.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.Connect)) {
        await interaction.reply({ content: t(`Ich habe keine Connect-Berechtigung fuer ${voiceChannel.toString()}.`, `I do not have Connect permission for ${voiceChannel.toString()}.`), ephemeral: true });
        return;
      }
      if (voiceChannel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) {
        await interaction.reply({ content: t(`Ich habe keine Speak-Berechtigung fuer ${voiceChannel.toString()}.`, `I do not have Speak permission for ${voiceChannel.toString()}.`), ephemeral: true });
        return;
      }

      const parsed = parseEventStartDateTime(startRaw, language);
      if (!parsed.ok) {
        await interaction.reply({ content: parsed.message, ephemeral: true });
        return;
      }
      const minFutureMs = Date.now() + 30_000;
      if (parsed.runAtMs < minFutureMs) {
        await interaction.reply({
          content: t("Startzeit muss mindestens 30 Sekunden in der Zukunft liegen.", "Start time must be at least 30 seconds in the future."),
          ephemeral: true,
        });
        return;
      }
      if (createDiscordEvent && parsed.runAtMs < Date.now() + 60_000) {
        await interaction.reply({
          content: t(
            "Mit `serverevent` muss die Startzeit mindestens 60 Sekunden in der Zukunft liegen.",
            "With `serverevent`, start time must be at least 60 seconds in the future."
          ),
          ephemeral: true,
        });
        return;
      }

      const station = this.resolveStationForGuild(guildId, stationRaw, language);
      if (!station.ok) {
        await interaction.reply({ content: station.message, ephemeral: true });
        return;
      }

      const created = createScheduledEvent({
        guildId,
        botId: this.config.id,
        name,
        stationKey: station.key,
        voiceChannelId: voiceChannel.id,
        textChannelId: textChannel?.id || null,
        announceMessage: message || null,
        stageTopic: stageTopicTemplate || null,
        createDiscordEvent,
        discordScheduledEventId: null,
        repeat,
        runAtMs: parsed.runAtMs,
        createdByUserId: interaction.user?.id || null,
      });

      if (!created.ok) {
        const storeMessage = translateScheduledEventStoreMessage(created.message, language);
        await interaction.reply({ content: t(`Event konnte nicht gespeichert werden: ${storeMessage}`, `Could not save event: ${storeMessage}`), ephemeral: true });
        return;
      }

      let serverEventWarning = "";
      let serverEventId = null;
      if (createDiscordEvent) {
        try {
          const scheduledEvent = await this.syncDiscordScheduledEvent(created.event, station.station, {
            runAtMs: created.event.runAtMs,
            forceCreate: false,
          });
          serverEventId = scheduledEvent?.id || null;
        } catch (err) {
          serverEventWarning = `\n${t("Server-Event Hinweis", "Server event note")}: ${clipText(err?.message || err, 180)}`;
          log(
            "WARN",
            `[${this.config.name}] Event ${created.event.id}: Discord-Server-Event konnte nicht erstellt werden: ${err?.message || err}`
          );
        }
      }

      const channelLabel = voiceChannel.type === ChannelType.GuildStageVoice ? "Stage" : "Voice";
      const stageTopicPreview = voiceChannel.type === ChannelType.GuildStageVoice
        ? renderStageTopic(stageTopicTemplate, {
          event: created.event.name,
          station: station.station?.name || created.event.stationKey,
          time: formatDateTime(created.event.runAtMs, language),
        })
        : null;
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || t("Serverzeit", "server time");
      await interaction.reply({
        content:
          `${t("Event erstellt", "Event created")}: **${created.event.name}**\n` +
          `ID: \`${created.event.id}\`\n` +
          `${t("Station", "Station")}: \`${created.event.stationKey}\` (${station.station?.name || "-"})\n` +
          `${channelLabel}: <#${created.event.voiceChannelId}>\n` +
          `${t("Start", "Start")}: ${formatDateTime(created.event.runAtMs, language)} (${tz})\n` +
          `${t("Wiederholung", "Repeat")}: ${getRepeatLabel(created.event.repeat, language)}\n` +
          `${t("Ankuendigung", "Announcement")}: ${created.event.textChannelId ? `<#${created.event.textChannelId}>` : t("aus", "off")}\n` +
          `${t("Server-Event", "Server event")}: ${createDiscordEvent ? (serverEventId ? `${t("aktiv", "active")} (\`${serverEventId}\`)` : t("aktiviert, Erstellung fehlgeschlagen", "enabled, creation failed")) : t("aus", "off")}\n` +
          `${t("Stage-Thema", "Stage topic")}: ${stageTopicPreview ? `\`${stageTopicPreview}\`` : t("auto/aus", "auto/off")}` +
          serverEventWarning,
        ephemeral: true,
      });
      return;
    }

    if (sub === "list") {
      const events = listScheduledEvents({
        guildId,
        botId: this.config.id,
        includeDisabled: false,
      });

      if (!events.length) {
        await interaction.reply({ content: t("Keine geplanten Events.", "No scheduled events."), ephemeral: true });
        return;
      }

      const lines = events.map((event) =>
        `\`${event.id}\` | **${clipText(event.name, 70)}** | \`${event.stationKey}\` | ` +
        `Voice/Stage <#${event.voiceChannelId}> | ${formatDateTime(event.runAtMs, language)} | ${getRepeatLabel(event.repeat, language)}` +
        `${event.createDiscordEvent ? ` | ${t("Server-Event", "Server event")} ${event.discordScheduledEventId ? `\`${event.discordScheduledEventId}\`` : t("an", "on")}` : ""}` +
        `${event.stageTopic ? ` | ${t("Stage-Thema", "Stage topic")}` : ""}`
      );
      await this.respondLongInteraction(interaction, `**${t("Geplante Events", "Scheduled events")} (${events.length}):**\n${lines.join("\n")}`, { ephemeral: true });
      return;
    }

    if (sub === "delete") {
      const id = interaction.options.getString("id", true);
      const existing = getScheduledEvent(id);
      let removedDiscordEvent = false;
      if (existing && existing.guildId === guildId && existing.botId === this.config.id && existing.discordScheduledEventId) {
        removedDiscordEvent = await this.deleteDiscordScheduledEventById(guildId, existing.discordScheduledEventId);
      }
      const removed = deleteScheduledEvent(id, { guildId, botId: this.config.id });
      if (!removed.ok) {
        await interaction.reply({ content: translateScheduledEventStoreMessage(removed.message, language), ephemeral: true });
        return;
      }
      await interaction.reply({
        content: `${t("Event", "Event")} \`${id}\` ${t("entfernt", "removed")}.${removedDiscordEvent ? ` ${t("Discord-Server-Event ebenfalls entfernt.", "Discord server event was removed too.")}` : ""}`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content: t("Unbekannte /event Aktion.", "Unknown /event action."), ephemeral: true });
  }

  async handleLanguageCommand(interaction) {
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const { t, language } = this.createInteractionTranslator(interaction);
    const override = getGuildLanguage(guildId);
    const effectiveLanguage = this.resolveInteractionLanguage(interaction);

    if (sub === "show") {
      await interaction.reply({
        content:
          `**${t("OmniFM Sprache", "OmniFM language")}**\n` +
          `${t("Aktiv", "Active")}: \`${effectiveLanguage}\`\n` +
          `${t("Quelle", "Source")}: ${override ? t("Manuell gesetzt", "Manually set") : t("Discord Server-Sprache", "Discord server locale")}\n` +
          `${t("Deine Discord-Client-Sprache", "Your Discord client language")}: \`${resolveLanguageFromDiscordLocale(interaction.locale, language)}\``,
        ephemeral: true,
      });
      return;
    }

    if (!this.hasGuildManagePermissions(interaction)) {
      await interaction.reply({
        content: t(
          "Du brauchst die Berechtigung `Server verwalten` fuer `/language set` und `/language reset`.",
          "You need the `Manage Server` permission for `/language set` and `/language reset`."
        ),
        ephemeral: true,
      });
      return;
    }

    if (sub === "set") {
      const value = normalizeLanguage(interaction.options.getString("value", true), getDefaultLanguage());
      setGuildLanguage(guildId, value);
      await interaction.reply({
        content: t(
          `Sprache fuer diesen Server wurde auf \`${value}\` gesetzt.`,
          `Language for this server was set to \`${value}\`.`
        ),
        ephemeral: true,
      });
      return;
    }

    if (sub === "reset") {
      const changed = clearGuildLanguage(guildId);
      const next = this.resolveInteractionLanguage(interaction);
      await interaction.reply({
        content: changed
          ? t(
            `Manuelle Sprache entfernt. OmniFM nutzt jetzt wieder die Discord-Server-Sprache (\`${next}\`).`,
            `Manual language override removed. OmniFM now uses the Discord server locale again (\`${next}\`).`
          )
          : t(
            `Es war keine manuelle Sprache gesetzt. Aktive Sprache bleibt \`${next}\`.`,
            `No manual language override was set. Active language remains \`${next}\`.`
          ),
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content: t("Unbekannte /language Aktion.", "Unknown /language action."), ephemeral: true });
  }

  async respondInteraction(interaction, payload) {
    if (interaction.deferred || interaction.replied) {
      const editPayload = { ...payload };
      delete editPayload.ephemeral;
      if (!editPayload.content && !editPayload.embeds) {
        const { t } = this.createInteractionTranslator(interaction);
        editPayload.content = t("Es ist ein Fehler aufgetreten.", "An error occurred.");
      }
      return interaction.editReply(editPayload);
    }
    return interaction.reply(payload);
  }

  async respondLongInteraction(interaction, content, { ephemeral = true } = {}) {
    const chunks = splitTextForDiscord(content, 1900);
    if (!chunks.length) {
      await this.respondInteraction(interaction, { content: "-", ephemeral });
      return;
    }

    await this.respondInteraction(interaction, { content: chunks[0], ephemeral });
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ content: chunks[i], ephemeral });
    }
  }

  async connectToVoice(interaction, targetChannel = null, { silent = false } = {}) {
    const { t } = this.createInteractionTranslator(interaction);
    const sendError = async (message) => {
      if (!silent) {
        await this.respondInteraction(interaction, { content: message, ephemeral: true });
      }
      return { connection: null, error: message };
    };

    const member = interaction.member;
    const channel = targetChannel || member?.voice?.channel;
    if (!channel) {
      return sendError(
        t(
          "Waehle einen Voice-Channel im Command oder trete selbst einem Voice-Channel bei.",
          "Select a voice channel in the command or join one yourself."
        )
      );
    }
    if (!channel.isVoiceBased()) {
      return sendError(t("Bitte waehle einen Voice- oder Stage-Channel.", "Please choose a voice or stage channel."));
    }
    if (channel.guildId !== interaction.guildId) {
      return sendError(t("Der ausgewaehlte Channel ist nicht in diesem Server.", "The selected channel is not in this server."));
    }

    const guild = interaction.guild;
    if (!guild) {
      return sendError(t("Guild konnte nicht ermittelt werden.", "Could not resolve guild."));
    }

    const me = await this.resolveBotMember(guild);
    if (!me) {
      return sendError(t("Bot-Mitglied im Server konnte nicht geladen werden.", "Could not load bot member in this server."));
    }

    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.Connect)) {
      return sendError(
        t(
          `Ich habe keine Berechtigung fuer ${channel.toString()} (Connect fehlt).`,
          `I don't have permission for ${channel.toString()} (Connect missing).`
        )
      );
    }
    if (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) {
      return sendError(
        t(
          `Ich habe keine Berechtigung fuer ${channel.toString()} (Speak fehlt).`,
          `I don't have permission for ${channel.toString()} (Speak missing).`
        )
      );
    }

    const guildId = interaction.guildId;
    const state = this.getState(guildId);
    state.lastChannelId = channel.id;

    if (state.connection) {
      const currentChannelId = state.connection.joinConfig?.channelId;
      if (currentChannelId === channel.id) {
        if (channel.type === ChannelType.GuildStageVoice) {
          await this.ensureStageChannelReady(guild, channel, { createInstance: true, ensureSpeaker: true });
        }
        return { connection: state.connection, error: null };
      }

      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
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
      return sendError(t("Konnte dem Voice-Channel nicht beitreten.", "Could not join the voice channel."));
    }

    connection.subscribe(state.player);
    state.connection = connection;
    state.reconnectAttempts = 0;
    state.lastReconnectAt = new Date().toISOString();
    this.clearReconnectTimer(state);
    networkRecoveryCoordinator.noteSuccess(`${this.config.name} voice-ready guild=${guildId}`);

    this.attachConnectionHandlers(guildId, connection);
    if (channel.type === ChannelType.GuildStageVoice) {
      await this.ensureStageChannelReady(guild, channel, { createInstance: true, ensureSpeaker: true });
    }
    return { connection, error: null };
  }

  async tryReconnect(guildId) {
    const state = this.getState(guildId);
    if (!state.shouldReconnect || !state.lastChannelId) return;

    const networkCooldownMs = networkRecoveryCoordinator.getRecoveryDelayMs();
    if (networkCooldownMs > 0) {
      log(
        "INFO",
        `[${this.config.name}] Reconnect fuer guild=${guildId} verschoben (Netz-Cooldown ${Math.round(networkCooldownMs)}ms)`
      );
      return;
    }

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
      networkRecoveryCoordinator.noteFailure(`${this.config.name} reconnect-timeout`, `guild=${guildId}`);
      try { connection.destroy(); } catch {}
      return;
    }

    connection.subscribe(state.player);
    state.connection = connection;
    state.reconnectAttempts = 0;
    state.lastReconnectAt = new Date().toISOString();
    this.clearReconnectTimer(state);
    this.attachConnectionHandlers(guildId, connection);
    networkRecoveryCoordinator.noteSuccess(`${this.config.name} rejoin-ready guild=${guildId}`);
    if (channel.type === ChannelType.GuildStageVoice) {
      await this.ensureStageChannelReady(guild, channel, { createInstance: true, ensureSpeaker: true });
    }

    // Always restart station on reconnect (stream is stale after disconnect)
    if (state.currentStationKey) {
      try {
        await this.restartCurrentStation(state, guildId);
        log("INFO", `[${this.config.name}] Reconnect successful: guild=${guildId}`);
      } catch (err) {
        log("ERROR", `[${this.config.name}] Station restart after reconnect failed: ${err?.message || err}`);
      }
    }
  }

  handleNetworkRecovered() {
    for (const [guildId, state] of this.guildState.entries()) {
      if (!state.shouldReconnect || !state.currentStationKey || !state.lastChannelId) continue;

      if (!state.connection) {
        if (state.reconnectTimer) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
        this.scheduleReconnect(guildId, { resetAttempts: true, reason: "network-recovered" });
        continue;
      }

      if (state.player.state.status === AudioPlayerStatus.Idle && !state.streamRestartTimer) {
        this.scheduleStreamRestart(guildId, state, 750, "network-recovered");
      }
    }
  }

  scheduleReconnect(guildId, options = {}) {
    const state = this.getState(guildId);
    if (!state.shouldReconnect || !state.lastChannelId) return;
    if (options.resetAttempts) {
      state.reconnectAttempts = 0;
    }
    if (state.reconnectTimer) return;

    const attempt = state.reconnectAttempts + 1;
    state.reconnectAttempts = attempt;

    const tierConfig = getTierConfig(guildId);
    const baseDelay = Math.max(400, tierConfig.reconnectMs || 5_000);
    const exp = Math.min(attempt - 1, VOICE_RECONNECT_EXP_STEPS);
    let delay = Math.min(VOICE_RECONNECT_MAX_MS, baseDelay * Math.pow(1.8, exp));

    const networkCooldownMs = networkRecoveryCoordinator.getRecoveryDelayMs();
    if (networkCooldownMs > 0) {
      delay = Math.max(delay, networkCooldownMs);
    }

    delay = applyJitter(delay, 0.2);
    const reason = String(options.reason || "auto");

    log(
      "INFO",
      `[${this.config.name}] Reconnecting guild=${guildId} in ${Math.round(delay)}ms (attempt ${attempt}, plan=${tierConfig.tier}, reason=${reason})`
    );
    state.reconnectTimer = setTimeout(async () => {
      state.reconnectTimer = null;
      if (!state.shouldReconnect) return;

      await this.tryReconnect(guildId);
      if (state.shouldReconnect && !state.connection) {
        this.scheduleReconnect(guildId, { reason: "retry" });
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
    const { t } = this.createInteractionTranslator(interaction);
    if (!access.tierAllowed) {
      await interaction.reply({
        content:
          t(
            `Dieser Bot erfordert **${access.requiredTier.toUpperCase()}**.\n` +
              `Dein Server hat aktuell **${access.guildTier.toUpperCase()}**.\n` +
              `Upgrade: ${BRAND.upgradeUrl || "https://discord.gg/UeRkfGS43R"}`,
            `This bot requires **${access.requiredTier.toUpperCase()}**.\n` +
              `Your server currently has **${access.guildTier.toUpperCase()}**.\n` +
              `Upgrade: ${BRAND.upgradeUrl || "https://discord.gg/UeRkfGS43R"}`
          ),
        ephemeral: true
      });
      return;
    }

    await interaction.reply(
      botLimitEmbed(access.guildTier, access.maxBots, access.botIndex, this.resolveInteractionLanguage(interaction))
    );
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

      const commandPermission = this.checkCommandRolePermission(interaction, interaction.commandName);
      if (!commandPermission.ok) {
        await interaction.respond([]);
        return;
      }
      if (interaction.commandName === "event") {
        const feature = requireFeature(interaction.guildId, "scheduledEvents");
        if (!feature.ok) {
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

      if (focused.name === "id" && interaction.commandName === "event") {
        const guildId = interaction.guildId;
        const query = String(focused.value || "").toLowerCase().trim();
        const events = listScheduledEvents({
          guildId,
          botId: this.config.id,
          includeDisabled: false,
        });
        const language = this.resolveInteractionLanguage(interaction);

        const items = events
          .filter((event) =>
            !query
            || event.id.includes(query)
            || String(event.name || "").toLowerCase().includes(query)
            || String(event.stationKey || "").toLowerCase().includes(query)
          )
          .slice(0, 25)
          .map((event) => ({
            name: clipText(`${event.name} | ${formatDateTime(event.runAtMs, language)} | ${event.id}`, 100),
            value: event.id,
          }));

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
      const isDe = resolveLanguageFromDiscordLocale(interaction?.locale, getDefaultLanguage()) === "de";
      await interaction.reply({
        content: isDe ? "Dieser Bot funktioniert nur auf Servern." : "This bot only works in servers.",
        ephemeral: true,
      });
      return;
    }

    const { t, language } = this.createInteractionTranslator(interaction);
    const unrestrictedCommands = new Set(["help", "premium", "license", "language"]);
    if (!unrestrictedCommands.has(interaction.commandName)) {
      const access = this.getGuildAccess(interaction.guildId);
      if (!access.allowed) {
        await this.replyAccessDenied(interaction, access);
        return;
      }
    }

    if (interaction.commandName === "help") {
      await this.respondLongInteraction(interaction, this.buildHelpMessage(interaction), { ephemeral: true });
      return;
    }

    if (interaction.commandName === "language") {
      await this.handleLanguageCommand(interaction);
      return;
    }

    if (interaction.commandName === "perm") {
      await this.handlePermissionCommand(interaction);
      return;
    }

    const commandPermission = this.checkCommandRolePermission(interaction, interaction.commandName);
    if (!commandPermission.ok) {
      await interaction.reply({ content: commandPermission.message, ephemeral: true });
      return;
    }

    if (interaction.commandName === "event") {
      await this.handleEventCommand(interaction);
      return;
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
      let content = `**${t("Verfuegbare Stationen", "Available stations")}${tierLabel} (${Object.keys(available).length}):**\n${list}`;
      if (customList) content += `\n\n**${t("Custom Stationen", "Custom stations")} (${Object.keys(custom).length}):**\n${customList}`;
      await this.respondLongInteraction(interaction, content, { ephemeral: true });
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
        await interaction.reply({
          content: t(
            `Seite ${page} hat keine Eintraege (${totalPages} Seiten).`,
            `Page ${page} has no entries (${totalPages} pages).`
          ),
          ephemeral: true,
        });
        return;
      }
      const list = pageKeys.map(k => {
        const badge = available[k].tier !== "free" ? ` [${available[k].tier.toUpperCase()}]` : "";
        return `\`${k}\` - ${available[k].name}${badge}`;
      }).join("\n");
      await this.respondLongInteraction(
        interaction,
        `**${t("Stationen", "Stations")} (${t("Seite", "Page")} ${page}/${totalPages}):**\n${list}`,
        { ephemeral: true }
      );
      return;
    }

    if (interaction.commandName === "now") {
      const playingGuilds = this.getPlayingGuildCount();
      if (!state.currentStationKey) {
        await interaction.reply({
          content: t(
            `Hier laeuft gerade nichts.\nDieser Bot streamt aktuell auf ${playingGuilds} Server${playingGuilds === 1 ? "" : "n"}.`,
            `Nothing is playing here right now.\nThis bot is currently streaming in ${playingGuilds} server${playingGuilds === 1 ? "" : "s"}.`
          ),
          ephemeral: true
        });
        return;
      }

      const current = stations.stations[state.currentStationKey];
      if (!current) {
        await interaction.reply({ content: t("Aktuelle Station wurde entfernt.", "Current station was removed."), ephemeral: true });
        return;
      }

      const channelId = state.connection?.joinConfig?.channelId || state.lastChannelId || null;
      const lines = [
        `${t("Jetzt auf diesem Server", "Now playing in this server")}: ${current.name}`,
        `${t("Channel", "Channel")}: ${channelId ? `<#${channelId}>` : t("unbekannt", "unknown")}`,
        `${t("Aktiv auf", "Active in")} ${playingGuilds} ${t(`Server${playingGuilds === 1 ? "" : "n"}.`, `server${playingGuilds === 1 ? "" : "s"}.`)}`,
      ];

      const meta = state.currentMeta;
      if (meta?.displayTitle || meta?.streamTitle) {
        lines.push(`${t("Jetzt laeuft", "Now Playing")}: ${clipText(meta.displayTitle || meta.streamTitle, 160)}`);
      }
      if (meta?.artist && meta?.title) {
        lines.push(`${t("Titel", "Track")}: ${clipText(meta.artist, 90)} - ${clipText(meta.title, 90)}`);
      }
      if (meta?.artworkUrl) {
        lines.push(`${t("Cover", "Cover")}: ${meta.artworkUrl}`);
      }
      if (meta && (meta.name || meta.description)) {
        const metaName = clipText(meta.name || "-", 120);
        const metaDesc = clipText(meta.description || "", 240);
        lines.push(`${t("Meta", "Meta")}: ${metaName}${metaDesc ? ` | ${metaDesc}` : ""}`);
      }

      await this.respondLongInteraction(interaction, lines.join("\n"), { ephemeral: true });
      return;
    }

    if (interaction.commandName === "history") {
      if (!SONG_HISTORY_ENABLED) {
        await interaction.reply({
          content: t(
            "Song-History ist aktuell deaktiviert (`SONG_HISTORY_ENABLED=0`).",
            "Song history is currently disabled (`SONG_HISTORY_ENABLED=0`)."
          ),
          ephemeral: true
        });
        return;
      }

      const requestedLimit = interaction.options.getInteger("limit") || 10;
      const limit = Math.max(1, Math.min(20, requestedLimit));
      const history = getSongHistory(interaction.guildId, { limit });

      if (!history.length) {
        await interaction.reply({
          content: t(
            "Noch keine Song-History verfuegbar. Starte zuerst eine Station mit `/play`.",
            "No song history yet. Start a station with `/play` first."
          ),
          ephemeral: true
        });
        return;
      }

      const lines = history.map((entry, index) => {
        const unix = Number.isFinite(entry.timestampMs) ? Math.floor(entry.timestampMs / 1000) : null;
        const when = unix ? `<t:${unix}:R>` : "-";
        const title = clipText(entry.displayTitle || entry.streamTitle || "-", 150);
        const station = entry.stationName ? clipText(entry.stationName, 80) : null;
        const stationSuffix = station ? ` | ${station}` : "";
        return `${index + 1}. ${when} - **${title}**${stationSuffix}`;
      });

      await this.respondLongInteraction(
        interaction,
        `**${t("Song-History", "Song history")} (${t("letzte", "latest")} ${history.length}):**\n${lines.join("\n")}`,
        { ephemeral: true }
      );
      return;
    }

    if (interaction.commandName === "pause") {
      if (!state.currentStationKey) {
        await interaction.reply({ content: t("Es laeuft nichts.", "Nothing is playing."), ephemeral: true });
        return;
      }

      state.player.pause(true);
      await interaction.reply({ content: t("Pausiert.", "Paused."), ephemeral: true });
      return;
    }

    if (interaction.commandName === "resume") {
      if (!state.currentStationKey) {
        await interaction.reply({ content: t("Es laeuft nichts.", "Nothing is playing."), ephemeral: true });
        return;
      }

      state.player.unpause();
      await interaction.reply({ content: t("Weiter gehts.", "Resumed."), ephemeral: true });
      return;
    }

    if (interaction.commandName === "stop") {
      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      state.player.stop();
      this.clearCurrentProcess(state);

      if (state.connection) {
        state.connection.destroy();
        state.connection = null;
      }

      state.currentStationKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.nowPlayingSignature = null;
      state.reconnectAttempts = 0;
      state.streamErrorCount = 0;
      this.updatePresence();

      await interaction.reply({ content: t("Gestoppt und Channel verlassen.", "Stopped and left the channel."), ephemeral: true });
      return;
    }

    if (interaction.commandName === "setvolume") {
      const value = interaction.options.getInteger("value", true);
      if (value < 0 || value > 100) {
        await interaction.reply({ content: t("Wert muss zwischen 0 und 100 liegen.", "Value must be between 0 and 100."), ephemeral: true });
        return;
      }

      state.volume = value;
      const resource = state.player.state.resource;
      if (resource?.volume) {
        resource.volume.setVolume(clampVolume(value));
      }

      await interaction.reply({ content: t(`Lautstaerke gesetzt: ${value}`, `Volume set to: ${value}`), ephemeral: true });
      return;
    }

    if (interaction.commandName === "premium") {
      const gid = interaction.guildId;
      const tierConfig = getTierConfig(gid);
      const license = getLicense(gid);

      const tierEmoji = { free: "", pro: " [PRO]", ultimate: " [ULTIMATE]" };
      const lines = [
        `**${BRAND.name}** ${t("Premium Status", "Premium status")}${tierEmoji[tierConfig.tier] || ""}`,
        `Server: ${interaction.guild?.name || gid}`,
        `${t("Server-ID", "Server ID")}: ${gid}`,
        `Plan: ${tierConfig.name}`,
        `Audio: ${tierConfig.bitrate} Opus`,
        `Reconnect: ${tierConfig.reconnectMs}ms`,
        `${t("Max Bots", "Max bots")}: ${tierConfig.maxBots}`,
      ];
      if (license && !license.expired) {
        const expDate = new Date(license.expiresAt).toLocaleDateString(t("de-DE", "en-US"));
        lines.push(
          t(
            `Laeuft ab: ${expDate} (${license.remainingDays} Tage uebrig)`,
            `Expires: ${expDate} (${license.remainingDays} day${license.remainingDays === 1 ? "" : "s"} left)`
          )
        );
      } else if (license && license.expired) {
        lines.push(t("Status: ABGELAUFEN", "Status: EXPIRED"));
      }
      if (tierConfig.tier === "free") {
        lines.push("", t(`Upgrade auf ${BRAND.name} Pro/Ultimate fuer hoehere Qualitaet!`, `Upgrade to ${BRAND.name} Pro/Ultimate for higher quality!`));
        lines.push(t("Infos & Support: https://discord.gg/UeRkfGS43R", "Info & support: https://discord.gg/UeRkfGS43R"));
      } else {
        lines.push("", "Support: https://discord.gg/UeRkfGS43R");
      }
      await interaction.reply({ content: lines.join("\n"), ephemeral: true });
      return;
    }

    if (interaction.commandName === "health") {
      const networkHoldMs = networkRecoveryCoordinator.getRecoveryDelayMs();
      const content = [
        `Bot: ${this.config.name}`,
        `Ready: ${this.client.isReady() ? t("ja", "yes") : t("nein", "no")}`,
        `${t("Letzter Stream-Fehler", "Last stream error")}: ${state.lastStreamErrorAt || "-"}`,
        `${t("Stream-Fehler (Reihe)", "Stream errors (streak)")}: ${state.streamErrorCount || 0}`,
        `${t("Letzter ffmpeg Exit-Code", "Last ffmpeg exit code")}: ${state.lastProcessExitCode ?? "-"}`,
        `Reconnects: ${state.reconnectCount}`,
        `${t("Letzter Reconnect", "Last reconnect")}: ${state.lastReconnectAt || "-"}`,
        `${t("Auto-Reconnect aktiv", "Auto reconnect enabled")}: ${state.shouldReconnect ? t("ja", "yes") : t("nein", "no")}`,
        `${t("Netz-Cooldown", "Network cooldown")}: ${networkHoldMs > 0 ? `${t("ja", "yes")} (${Math.round(networkHoldMs)}ms)` : t("nein", "no")}`
      ].join("\n");

      await interaction.reply({ content, ephemeral: true });
      return;
    }

    if (interaction.commandName === "diag") {
      const connected = state.connection ? t("ja", "yes") : t("nein", "no");
      const channelId = state.connection?.joinConfig?.channelId || state.lastChannelId || "-";
      const station = state.currentStationKey || "-";
      const diag = this.getStreamDiagnostics(interaction.guildId, state);
      const restartPending = state.streamRestartTimer ? t("ja", "yes") : t("nein", "no");
      const reconnectPending = state.reconnectTimer ? t("ja", "yes") : t("nein", "no");
      const networkHoldMs = networkRecoveryCoordinator.getRecoveryDelayMs();

      const content = [
        `Bot: ${this.config.name}`,
        `Server: ${interaction.guild?.name || interaction.guildId}`,
        `Plan: ${diag.tier.toUpperCase()} | preset=${diag.preset} | transcode=${diag.transcodeEnabled ? "on" : "off"} (${diag.transcodeMode})`,
        `Bitrate Ziel: ${diag.bitrateOverride || "-"} (${diag.requestedBitrateKbps}k) | Profil: ${diag.profile}`,
        `FFmpeg Buffer: queue=${diag.queue} probe=${diag.probeSize} analyzeUs=${diag.analyzeUs}`,
        `Verbunden: ${connected} | Channel: ${channelId} | Station: ${station}`,
        `Stream-Laufzeit: ${diag.streamLifetimeSec}s | Errors in Reihe: ${state.streamErrorCount || 0}`,
        `Restart geplant: ${restartPending} | Reconnect geplant: ${reconnectPending}`,
        `Netz-Cooldown: ${networkHoldMs > 0 ? `${Math.round(networkHoldMs)}ms` : "0ms"}`,
      ].join("\n");

      await interaction.reply({ content, ephemeral: true });
      return;
    }

    if (interaction.commandName === "status") {
      const connected = state.connection ? t("ja", "yes") : t("nein", "no");
      const channelId = state.connection?.joinConfig?.channelId || state.lastChannelId || "-";
      const uptimeSec = Math.floor((Date.now() - this.startedAt) / 1000);
      const load = os.loadavg().map((v) => v.toFixed(2)).join(", ");
      const mem = `${Math.round(process.memoryUsage().rss / (1024 * 1024))}MB`;
      const station = state.currentStationKey || "-";

      const content = [
        `Bot: ${this.config.name}`,
        `${t("Guilds (dieser Bot)", "Guilds (this bot)")}: ${this.client.guilds.cache.size}`,
        `${t("Verbunden", "Connected")}: ${connected}`,
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
        await interaction.reply(customStationEmbed(language));
        return;
      }
      const key = interaction.options.getString("key");
      const name = interaction.options.getString("name");
      const url = interaction.options.getString("url");
      const result = addGuildStation(guildId, key, name, url);
      if (result.error) {
        await interaction.reply({ content: translateCustomStationErrorMessage(result.error, language), ephemeral: true });
      } else {
        const count = countGuildStations(guildId);
        await interaction.reply({
          content: t(
            `Custom Station hinzugefuegt: **${result.station.name}** (Key: \`${result.key}\`)\n${count}/${MAX_STATIONS_PER_GUILD} Slots belegt.`,
            `Custom station added: **${result.station.name}** (Key: \`${result.key}\`)\n${count}/${MAX_STATIONS_PER_GUILD} slots used.`
          ),
          ephemeral: true,
        });
      }
      return;
    }

    if (interaction.commandName === "removestation") {
      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);
      if (guildTier !== "ultimate") {
        await interaction.reply(customStationEmbed(language));
        return;
      }
      const key = interaction.options.getString("key");
      if (removeGuildStation(guildId, key)) {
        await interaction.reply({ content: t(`Station \`${key}\` entfernt.`, `Station \`${key}\` removed.`), ephemeral: true });
      } else {
        await interaction.reply({ content: t(`Station \`${key}\` nicht gefunden.`, `Station \`${key}\` was not found.`), ephemeral: true });
      }
      return;
    }

    if (interaction.commandName === "mystations") {
      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);
      if (guildTier !== "ultimate") {
        await interaction.reply(customStationEmbed(language));
        return;
      }
      const custom = getGuildStations(guildId);
      const keys = Object.keys(custom);
      if (keys.length === 0) {
        await interaction.reply({ content: t("Keine Custom Stationen. Nutze `/addstation` um eine hinzuzufuegen.", "No custom stations. Use `/addstation` to add one."), ephemeral: true });
      } else {
        const list = keys.map(k => `\`${k}\` - ${custom[k].name}`).join("\n");
        await this.respondLongInteraction(
          interaction,
          `**${t("Custom Stationen", "Custom stations")} (${keys.length}/${MAX_STATIONS_PER_GUILD}):**\n${list}`,
          { ephemeral: true }
        );
      }
      return;
    }

    // === /license Command ===
    if (interaction.commandName === "license") {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guildId;
      const requiresManagePermission = sub === "activate" || sub === "remove";
      if (requiresManagePermission && !this.hasGuildManagePermissions(interaction)) {
        await interaction.reply({
          content: t(
            "Du brauchst die Berechtigung `Server verwalten` um Lizenz-Aktionen auszufuehren.",
            "You need the `Manage Server` permission to execute license actions."
          ),
          ephemeral: true
        });
        return;
      }

      if (sub === "activate") {
        const rawKey = interaction.options.getString("key").trim();
        const keyCandidates = [...new Set([rawKey, rawKey.toLowerCase(), rawKey.toUpperCase()])];
        let lic = null;
        let resolvedKey = null;
        for (const candidate of keyCandidates) {
          lic = getLicenseById(candidate);
          if (lic) {
            resolvedKey = lic.id || candidate;
            break;
          }
        }

        if (!lic) {
          await interaction.reply({ content: t("Lizenz-Key nicht gefunden. Bitte pruefe den Key und versuche es erneut.", "License key not found. Please verify it and try again."), ephemeral: true });
          return;
        }
        if (lic.expired) {
          await interaction.reply({ content: t("Diese Lizenz ist abgelaufen. Bitte erneuere dein Abo.", "This license has expired. Please renew your subscription."), ephemeral: true });
          return;
        }

        const result = linkServerToLicense(guildId, resolvedKey);
        if (!result.ok) {
          const msg = result.message.includes("already linked")
            ? t("Dieser Server ist bereits mit dieser Lizenz verknuepft.", "This server is already linked to this license.")
            : result.message.includes("seat")
              ? t(
                `Alle ${lic.seats} Server-Slots sind belegt. Entferne zuerst einen Server mit \`/license remove\` oder upgrade auf mehr Seats.`,
                `All ${lic.seats} server seats are used. Remove a server with \`/license remove\` or upgrade to more seats first.`
              )
              : result.message;
          await interaction.reply({ content: msg, ephemeral: true });
          return;
        }

        const refreshedLicense = getLicenseById(resolvedKey) || lic;
        const planName = PLANS[refreshedLicense.plan]?.name || refreshedLicense.plan;
        const expDate = refreshedLicense.expiresAt
          ? new Date(refreshedLicense.expiresAt).toLocaleDateString(t("de-DE", "en-US"))
          : t("Unbegrenzt", "Unlimited");
        const usedSeats = refreshedLicense.linkedServerIds?.length || 0;
        await interaction.reply({
          embeds: [{
            color: refreshedLicense.plan === "ultimate" ? 0xBD00FF : 0xFFB800,
            title: t("Lizenz aktiviert!", "License activated!"),
            description: t(
              `Dieser Server wurde erfolgreich mit deiner **${planName}**-Lizenz verknuepft.`,
              `This server was linked successfully with your **${planName}** license.`
            ),
            fields: [
              { name: t("Lizenz-Key", "License key"), value: `\`${resolvedKey}\``, inline: true },
              { name: t("Plan", "Plan"), value: planName, inline: true },
              { name: t("Server-Slots", "Server seats"), value: `${usedSeats}/${refreshedLicense.seats}`, inline: true },
              { name: t("Gueltig bis", "Valid until"), value: expDate, inline: true },
            ],
            footer: { text: t("OmniFM Premium", "OmniFM Premium") },
          }],
          ephemeral: true,
        });
        return;
      }

      if (sub === "info") {
        const lic = getServerLicense(guildId);
        if (!lic) {
          await interaction.reply({
            content: t(
              "Dieser Server hat keine aktive Lizenz.\nNutze `/license activate <key>` um einen Lizenz-Key zu aktivieren.",
              "This server has no active license.\nUse `/license activate <key>` to activate one."
            ),
            ephemeral: true,
          });
          return;
        }

        const planName = PLANS[lic.plan]?.name || lic.plan;
        const expDate = lic.expiresAt ? new Date(lic.expiresAt).toLocaleDateString(t("de-DE", "en-US")) : t("Unbegrenzt", "Unlimited");
        const linked = lic.linkedServerIds || [];
        const tierConfig = PLANS[lic.plan] || PLANS.free;
        await interaction.reply({
          embeds: [{
            color: lic.plan === "ultimate" ? 0xBD00FF : 0xFFB800,
            title: `OmniFM ${planName}`,
            fields: [
              { name: t("Lizenz-Key", "License key"), value: `\`${lic.id || "-"}\``, inline: true },
              { name: t("Plan", "Plan"), value: planName, inline: true },
              { name: t("Server-Slots", "Server seats"), value: `${linked.length}/${lic.seats}`, inline: true },
              { name: t("Gueltig bis", "Valid until"), value: expDate, inline: true },
              { name: t("Verbleibend", "Remaining"), value: t(`${lic.remainingDays} Tage`, `${lic.remainingDays} days`), inline: true },
              { name: t("Audio", "Audio"), value: tierConfig.bitrate, inline: true },
              { name: t("Max Bots", "Max bots"), value: `${tierConfig.maxBots}`, inline: true },
              { name: t("Reconnect", "Reconnect"), value: `${tierConfig.reconnectMs}ms`, inline: true },
            ],
            footer: { text: lic.expired ? t("ABGELAUFEN", "EXPIRED") : "OmniFM Premium" },
          }],
          ephemeral: true,
        });
        return;
      }

      if (sub === "remove") {
        const lic = getServerLicense(guildId);
        if (!lic || !lic.id) {
          await interaction.reply({ content: t("Dieser Server hat keine aktive Lizenz.", "This server has no active license."), ephemeral: true });
          return;
        }

        const result = unlinkServerFromLicense(guildId, lic.id);
        if (!result.ok) {
          await interaction.reply({ content: t("Fehler beim Entfernen: ", "Error while removing: ") + result.message, ephemeral: true });
          return;
        }

        await interaction.reply({
          content: t(
            "Server wurde von der Lizenz entfernt. Der Server-Slot ist jetzt frei und kann fuer einen anderen Server genutzt werden.\nNutze `/license activate <key>` um eine neue Lizenz zu aktivieren.",
            "Server was unlinked from the license. The seat is now free and can be used for another server.\nUse `/license activate <key>` to activate a new license."
          ),
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
          await interaction.reply(premiumStationEmbed(stations.stations[key].name, stationTier, language));
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
          const customUrlValidation = validateCustomStationUrl(customUrl);
          if (!customUrlValidation.ok) {
            const translated = translateCustomStationErrorMessage(customUrlValidation.error, language);
            await interaction.reply({
              content: t(
                `Custom-Station kann nicht genutzt werden: ${translated}`,
                `Custom station cannot be used: ${translated}`
              ),
              ephemeral: true
            });
            return;
          }
          stations.stations[key] = { name: customStations[customKey].name, url: customUrlValidation.url, tier: "ultimate" };
        } else if (customKey) {
          await interaction.reply(customStationEmbed(language));
          return;
        } else {
          await interaction.reply({ content: t("Unbekannte Station.", "Unknown station."), ephemeral: true });
          return;
        }
      }

      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({ content: t("Guild konnte nicht ermittelt werden.", "Could not resolve guild."), ephemeral: true });
        return;
      }

      if (!requestedChannel && requestedChannelInput) {
        await interaction.reply({
          content: t("Voice-Channel nicht gefunden.", "Voice channel not found."),
          ephemeral: true
        });
        return;
      }

      log("INFO", `[${this.config.name}] /play guild=${guildId} station=${key} custom=${isCustom} tier=${guildTier}`);

      const selectedStation = stations.stations[key];
      await interaction.deferReply({ ephemeral: true });
      const { connection, error: connectError } = await this.connectToVoice(interaction, requestedChannel, { silent: true });
      if (!connection) {
        await interaction.editReply(connectError || t("Konnte keine Voice-Verbindung herstellen.", "Could not establish a voice connection."));
        return;
      }
      state.shouldReconnect = true;

      try {
        await this.playStation(state, stations, key, guildId);
        const tierConfig = getTierConfig(guildId);
        const tierLabel = tierConfig.tier !== "free" ? ` [${tierConfig.name} ${tierConfig.bitrate}]` : "";
        await interaction.editReply(t(`Starte: ${selectedStation?.name || key}${tierLabel}`, `Starting: ${selectedStation?.name || key}${tierLabel}`));
      } catch (err) {
        log("ERROR", `[${this.config.name}] Play error: ${err.message}`);
        state.lastStreamErrorAt = new Date().toISOString();

        const fallbackKey = getFallbackKey(stations, key);
        if (fallbackKey && fallbackKey !== key && stations.stations[fallbackKey]) {
          try {
            await this.playStation(state, stations, fallbackKey, guildId);
            await interaction.editReply(
              t(
                `Fehler bei ${selectedStation?.name || key}. Fallback: ${stations.stations[fallbackKey].name}`,
                `Error on ${selectedStation?.name || key}. Fallback: ${stations.stations[fallbackKey].name}`
              )
            );
            return;
          } catch (fallbackErr) {
            log("ERROR", `[${this.config.name}] Fallback error: ${fallbackErr.message}`);
            state.lastStreamErrorAt = new Date().toISOString();
          }
        }

        state.shouldReconnect = false;
        this.clearNowPlayingTimer(state);
        state.player.stop();
        this.clearCurrentProcess(state);
        if (state.connection) {
          state.connection.destroy();
          state.connection = null;
        }
        state.currentStationKey = null;
        state.currentStationName = null;
        state.currentMeta = null;
        state.nowPlayingSignature = null;
        this.updatePresence();
        await interaction.editReply(t(`Fehler beim Starten: ${err.message}`, `Error while starting: ${err.message}`));
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
      if (state.currentStationKey && state.connection) count += 1;
    }
    return count;
  }

  getPublicStatus() {
    const stats = this.collectStats();
    const resolvedClientId = this.getApplicationId() || this.config.clientId;
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
        playing: Boolean(state.connection && state.currentStationKey),
        meta: state.currentMeta || null,
      });
    }
    const isPremiumBot = this.config.requiredTier && this.config.requiredTier !== "free";
    return {
      id: this.config.id,
      name: this.config.name,
      clientId: isPremiumBot ? null : resolvedClientId,
      inviteUrl: isPremiumBot ? null : buildInviteUrl({ ...this.config, clientId: resolvedClientId }),
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
    const activeCount = [...this.guildState.entries()].filter(
      ([_, s]) => s.currentStationKey && s.lastChannelId && s.connection
    ).length;
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
        state.currentStationKey = stationKey;
        state.currentStationName = stations.stations[stationKey].name || stationKey;

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
          networkRecoveryCoordinator.noteFailure(`${this.config.name} restore-voice-timeout`, `guild=${guildId}`);
          try { connection.destroy(); } catch {}
          this.scheduleReconnect(guildId, { reason: "restore-ready-timeout" });
          continue;
        }

        state.connection = connection;
        connection.subscribe(state.player);
        this.attachConnectionHandlers(guildId, connection);
        networkRecoveryCoordinator.noteSuccess(`${this.config.name} restore-ready guild=${guildId}`);

        await this.playStation(state, stations, stationKey, guildId);
        log("INFO", `[${this.config.name}] Wiederhergestellt: ${guild.name} -> ${stations.stations[stationKey].name}`);

        // Kurze Pause zwischen Reconnects um Rate-Limits zu vermeiden
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        log("ERROR", `[${this.config.name}] Restore fehlgeschlagen fuer Guild ${guildId}: ${err?.message || err}`);
        const state = this.guildState.get(guildId);
        if (state?.shouldReconnect && state.lastChannelId && state.currentStationKey) {
          this.scheduleReconnect(guildId, { reason: "restore-error" });
        }
      }
    }
  }

  async stop() {
    if (typeof this.unsubscribeNetworkRecovery === "function") {
      this.unsubscribeNetworkRecovery();
      this.unsubscribeNetworkRecovery = null;
    }
    this.stopEventScheduler();

    for (const state of this.guildState.values()) {
      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      state.player.stop();
      this.clearCurrentProcess(state);
      if (state.connection) {
        try { state.connection.destroy(); } catch { /* ignore */ }
        state.connection = null;
      }
      state.currentStationKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.nowPlayingSignature = null;
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

function getCommonSecurityHeaders() {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  };
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...getCommonSecurityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function methodNotAllowed(res, allowedMethods = ["GET"]) {
  const methods = Array.isArray(allowedMethods) && allowedMethods.length
    ? allowedMethods
    : ["GET"];
  res.setHeader("Allow", methods.join(", "));
  sendJson(res, 405, { error: `Method not allowed. Use: ${methods.join(", ")}` });
}

function sendStaticFile(res, filePath) {
  const resolved = path.resolve(filePath);
  const resolvedWebDir = path.resolve(webDir);
  const relativePath = path.relative(resolvedWebDir, resolved);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(resolved)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const cacheControl = ext === ".html" ? "no-cache" : "public, max-age=86400";

  res.writeHead(200, {
    ...getCommonSecurityHeaders(),
    "Content-Type": contentType,
    "Cache-Control": cacheControl
  });
  const stream = fs.createReadStream(resolved);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal server error");
      return;
    }
    res.destroy();
  });
  stream.pipe(res);
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

function resolveRuntimeClientId(runtimeOrConfig) {
  if (!runtimeOrConfig) return "";
  if (typeof runtimeOrConfig.getApplicationId === "function") {
    const runtimeId = String(runtimeOrConfig.getApplicationId() || "").trim();
    if (runtimeId) return runtimeId;
  }
  const config = runtimeOrConfig.config || runtimeOrConfig;
  return String(config?.clientId || "").trim();
}

function buildInviteUrlForRuntime(runtimeOrConfig) {
  const config = runtimeOrConfig?.config || runtimeOrConfig;
  if (!config) return null;
  const resolvedClientId = resolveRuntimeClientId(runtimeOrConfig);
  if (!resolvedClientId) return null;
  return buildInviteUrl({ ...config, clientId: resolvedClientId });
}

function resolvePublicWebsiteUrl() {
  const raw = String(process.env.PUBLIC_WEB_URL || "").trim();
  if (!raw) {
    const rawDomain = String(process.env.WEB_DOMAIN || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    if (rawDomain && !/[\s/\\]/.test(rawDomain)) {
      const fromDomain = toOrigin(`https://${rawDomain}`);
      if (fromDomain) return fromDomain;
    }
    return "https://discord.gg/UeRkfGS43R";
  }
  try {
    return new URL(raw).toString();
  } catch {
    return "https://discord.gg/UeRkfGS43R";
  }
}

function buildInviteOverviewForTier(runtimes, tier) {
  const normalizedTier = String(tier || "free").toLowerCase();
  const hasPro = normalizedTier === "pro" || normalizedTier === "ultimate";
  const hasUltimate = normalizedTier === "ultimate";
  const overview = {
    freeWebsiteUrl: resolvePublicWebsiteUrl(),
    freeInfo: "Free-Bots sind bereits enthalten. Hier sind nur zusaetzlich freigeschaltete Premium-Bots gelistet.",
    proBots: [],
    ultimateBots: [],
  };

  const sorted = [...runtimes].sort((a, b) => Number(a.config.index || 0) - Number(b.config.index || 0));
  const seenPro = new Set();
  const seenUltimate = new Set();

  for (const runtime of sorted) {
    const index = Number(runtime.config.index || 0);
    const bucket = String(runtime.config.requiredTier || "free").toLowerCase();
    if (bucket !== "pro" && bucket !== "ultimate") continue;
    const target = bucket === "ultimate" ? overview.ultimateBots : overview.proBots;
    if ((bucket === "pro" && !hasPro) || (bucket === "ultimate" && !hasUltimate)) continue;
    const seen = bucket === "ultimate" ? seenUltimate : seenPro;
    if (seen.has(index)) continue;
    seen.add(index);
    const inviteUrl = buildInviteUrlForRuntime(runtime);
    if (!inviteUrl) continue;
    target.push({
      index: Number(runtime.config.index || 0),
      name: runtime.config.name,
      url: inviteUrl,
    });
  }

  overview.proBots.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  overview.ultimateBots.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  return overview;
}

async function sendMailWithRetry({ to, subject, html, label, maxAttempts = 2 }) {
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await sendMail(to, subject, html);
    if (result?.success) {
      log("INFO", `[Email] ${label} sent to ${to} (attempt ${attempt}/${maxAttempts})`);
      return { success: true, attempts: attempt };
    }

    lastError = String(result?.error || "unknown email error");
    log("ERROR", `[Email] ${label} failed for ${to} (attempt ${attempt}/${maxAttempts}): ${lastError}`);
    if (attempt < maxAttempts) {
      await waitMs(1000 * attempt);
    }
  }

  return { success: false, error: lastError, attempts: maxAttempts };
}

function resolveCheckoutOfferForRequest({
  tier,
  seats,
  months,
  email,
  couponCode,
  referralCode,
  baseAmountCents,
  language,
}) {
  const checkoutLanguage = normalizeLanguage(language, getDefaultLanguage());
  const normalizedCouponCode = sanitizeOfferCode(couponCode);
  const normalizedReferralCode = sanitizeOfferCode(referralCode);

  const preview = previewCheckoutOffer({
    tier,
    seats,
    months,
    email,
    baseAmountCents,
    couponCode: normalizedCouponCode,
    referralCode: normalizedReferralCode,
  });

  const couponProvided = Boolean(normalizedCouponCode);
  const referralProvided = Boolean(normalizedReferralCode);

  if (couponProvided && (!preview.coupon?.ok || preview.applied?.kind !== "coupon")) {
    return {
      ok: false,
      status: 400,
      error: translateOfferReason(preview.coupon?.reason, checkoutLanguage),
      preview,
    };
  }

  if (!couponProvided && referralProvided && (!preview.referral?.ok || preview.applied?.kind !== "referral")) {
    return {
      ok: false,
      status: 400,
      error: translateOfferReason(preview.referral?.reason, checkoutLanguage),
      preview,
    };
  }

  return {
    ok: true,
    preview,
    couponCode: normalizedCouponCode || null,
    referralCode: normalizedReferralCode || null,
  };
}

async function activatePaidStripeSession(session, runtimes, source = "verify") {
  const fallbackLanguage = normalizeLanguage(session?.metadata?.language, getDefaultLanguage());
  const t = (de, en) => (fallbackLanguage === "de" ? de : en);
  if (!session || session.payment_status !== "paid" || !session.metadata) {
    return { success: false, status: 400, message: t("Zahlung nicht abgeschlossen oder ungueltig.", "Payment not completed or invalid.") };
  }

  const sessionId = String(session.id || "").trim();
  if (!sessionId) {
    return { success: false, status: 400, message: t("session.id fehlt.", "session.id is missing.") };
  }

  const {
    email: metaEmail,
    tier,
    months,
    seats,
    language,
    appliedOfferCode: metaAppliedOfferCode,
    appliedOfferKind: metaAppliedOfferKind,
    couponCode: metaCouponCode,
    referralCode: metaReferralCode,
    discountCents: metaDiscountCents,
    baseAmountCents: metaBaseAmountCents,
    finalAmountCents: metaFinalAmountCents,
    offerOwnerLabel: metaOfferOwnerLabel,
  } = session.metadata;
  const customerEmail = String(metaEmail || session.customer_details?.email || "").trim().toLowerCase();
  const cleanTier = String(tier || "").trim().toLowerCase();
  const cleanSeats = [1, 2, 3, 5].includes(Number(seats)) ? Number(seats) : 1;
  const durationMonths = Math.max(1, parseInt(months, 10) || 1);
  const customerLanguage = normalizeLanguage(language, fallbackLanguage);
  const amountPaid = Math.max(0, Number.parseInt(String(session.amount_total || 0), 10) || 0);
  const baseAmountCentsMeta = Math.max(0, Number.parseInt(String(metaBaseAmountCents || 0), 10) || 0);
  const discountCentsMeta = Math.max(0, Number.parseInt(String(metaDiscountCents || 0), 10) || 0);
  const finalAmountCentsMeta = Math.max(0, Number.parseInt(String(metaFinalAmountCents || 0), 10) || 0);
  const appliedOfferCode = sanitizeOfferCode(metaAppliedOfferCode || metaCouponCode);
  const referralCode = sanitizeOfferCode(metaReferralCode);
  const appliedOfferKind = ["coupon", "referral"].includes(String(metaAppliedOfferKind || "").toLowerCase())
    ? String(metaAppliedOfferKind).toLowerCase()
    : (appliedOfferCode ? "coupon" : null);
  const offerOwnerLabel = clipText(metaOfferOwnerLabel || "", 160) || null;

  const baseAmountCents = baseAmountCentsMeta > 0
    ? baseAmountCentsMeta
    : Math.max(0, amountPaid + discountCentsMeta);
  const discountCents = Math.max(
    0,
    discountCentsMeta > 0
      ? discountCentsMeta
      : Math.max(0, baseAmountCents - Math.max(amountPaid, finalAmountCentsMeta))
  );
  const finalAmountCents = Math.max(
    0,
    amountPaid > 0
      ? amountPaid
      : (finalAmountCentsMeta > 0 ? finalAmountCentsMeta : Math.max(0, baseAmountCents - discountCents))
  );

  if (!customerEmail || !["pro", "ultimate"].includes(cleanTier)) {
    return {
      success: false,
      status: 400,
      message: customerLanguage === "de"
        ? "Session-Metadaten sind ungueltig (email oder tier fehlt)."
        : "Session metadata is invalid (email or tier missing).",
    };
  }

  if (isSessionProcessed(sessionId)) {
    return {
      success: true,
      replay: true,
      email: customerEmail,
      tier: cleanTier,
      message: customerLanguage === "de"
        ? `Session ${sessionId} wurde bereits verarbeitet.`
        : `Session ${sessionId} has already been processed.`,
    };
  }

  let license;
  let licenseChange;
  try {
    licenseChange = createOrExtendLicenseForEmail({
      plan: cleanTier,
      seats: cleanSeats,
      billingPeriod: durationMonths >= 12 ? "yearly" : "monthly",
      months: durationMonths,
      activatedBy: "stripe",
      note: `Session: ${sessionId}`,
      contactEmail: customerEmail,
      preferredLanguage: customerLanguage,
    });
    license = licenseChange.license;
  } catch (err) {
    return { success: false, status: 400, message: err.message || String(err) };
  }

  const effectiveTier = String(license?.plan || cleanTier);
  const effectiveSeats = normalizeSeats(license?.seats || cleanSeats);
  const isUpgrade = Boolean(licenseChange?.upgraded);
  const isRenewal = Boolean(licenseChange?.extended && !licenseChange?.upgraded);

  if (appliedOfferCode || referralCode) {
    markOfferRedemption(sessionId, {
      source,
      email: customerEmail,
      code: appliedOfferCode || null,
      kind: appliedOfferKind || null,
      referralCode: referralCode || null,
      tier: effectiveTier,
      seats: effectiveSeats,
      months: durationMonths,
      baseAmountCents,
      discountCents,
      finalAmountCents,
    });
  }

  markSessionProcessed(sessionId, {
    email: customerEmail,
    tier: effectiveTier,
    licenseId: license.id,
    source,
    expiresAt: license.expiresAt,
    language: customerLanguage,
    appliedOfferCode: appliedOfferCode || null,
    appliedOfferKind: appliedOfferKind || null,
    referralCode: referralCode || null,
    baseAmountCents,
    discountCents,
    finalAmountCents,
  });

  const emailDelivery = {
    smtpConfigured: isEmailConfigured(),
    purchaseSent: false,
    invoiceSent: false,
    adminSent: false,
    errors: [],
  };

  if (emailDelivery.smtpConfigured && customerEmail) {
    const tierConfig = TIERS[effectiveTier] || TIERS[cleanTier];
    const inviteOverview = buildInviteOverviewForTier(runtimes, effectiveTier);

    const purchaseHtml = buildPurchaseEmail({
      tier: effectiveTier,
      tierName: tierConfig.name,
      months: durationMonths,
      licenseKey: license.id,
      seats: effectiveSeats,
      email: customerEmail,
      expiresAt: license.expiresAt,
      inviteOverview,
      dashboardUrl: resolvePublicWebsiteUrl(),
      isUpgrade,
      isRenewal,
      pricePaid: amountPaid,
      baseAmountCents,
      discountCents,
      appliedOfferCode,
      appliedOfferKind,
      referralCode,
      offerOwnerLabel,
      currency: session.currency || "eur",
      language: customerLanguage,
    });
    let purchaseSubject;
    if (isUpgrade) {
      purchaseSubject = customerLanguage === "de"
        ? `OmniFM ${tierConfig.name} - Upgrade bestaetigt`
        : `OmniFM ${tierConfig.name} - Upgrade confirmed`;
    } else if (isRenewal) {
      purchaseSubject = customerLanguage === "de"
        ? `OmniFM ${tierConfig.name} - Verlaengerung bestaetigt`
        : `OmniFM ${tierConfig.name} - Renewal confirmed`;
    } else {
      purchaseSubject = customerLanguage === "de"
        ? `OmniFM ${tierConfig.name} - Dein Lizenz-Key`
        : `OmniFM ${tierConfig.name} - Your license key`;
    }

    const invoiceId = `OFM-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${sessionId.slice(-8).toUpperCase()}`;
    const invoiceHtml = buildInvoiceEmail({
      invoiceId,
      sessionId,
      customerEmail,
      tier: effectiveTier,
      tierName: tierConfig.name,
      months: durationMonths,
      seats: effectiveSeats,
      isUpgrade,
      isRenewal,
      amountPaid,
      currency: session.currency || "eur",
      licenseKey: license.id,
      expiresAt: license.expiresAt,
      baseAmountCents,
      discountCents,
      appliedOfferCode,
      appliedOfferKind,
      referralCode,
      offerOwnerLabel,
      language: customerLanguage,
    });
    const invoiceSubject = customerLanguage === "de"
      ? `OmniFM Rechnung ${invoiceId}`
      : `OmniFM Invoice ${invoiceId}`;

    const [purchaseResult, invoiceResult] = await Promise.all([
      sendMailWithRetry({
        to: customerEmail,
        subject: purchaseSubject,
        html: purchaseHtml,
        label: "purchase-mail",
        maxAttempts: 2,
      }),
      sendMailWithRetry({
        to: customerEmail,
        subject: invoiceSubject,
        html: invoiceHtml,
        label: "invoice-mail",
        maxAttempts: 2,
      }),
    ]);

    emailDelivery.purchaseSent = Boolean(purchaseResult?.success);
    emailDelivery.invoiceSent = Boolean(invoiceResult?.success);
    if (!emailDelivery.purchaseSent) emailDelivery.errors.push(`purchase:${purchaseResult?.error || "unknown"}`);
    if (!emailDelivery.invoiceSent) emailDelivery.errors.push(`invoice:${invoiceResult?.error || "unknown"}`);

    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (adminEmail) {
      const adminHtml = buildAdminNotification({
        tier: effectiveTier,
        tierName: tierConfig.name,
        months: durationMonths,
        serverId: "-",
        expiresAt: license.expiresAt,
        pricePaid: amountPaid,
        language: customerLanguage,
      });
      const adminSubject = customerLanguage === "de"
        ? `OmniFM Kauf eingegangen (${tierConfig.name})`
        : `OmniFM purchase received (${tierConfig.name})`;
      const adminResult = await sendMailWithRetry({
        to: adminEmail,
        subject: adminSubject,
        html: adminHtml,
        label: "admin-notification",
        maxAttempts: 1,
      });
      emailDelivery.adminSent = Boolean(adminResult?.success);
      if (!emailDelivery.adminSent) emailDelivery.errors.push(`admin:${adminResult?.error || "unknown"}`);
    }
  } else if (!emailDelivery.smtpConfigured) {
    emailDelivery.errors.push("smtp_not_configured");
    log("ERROR", `[Email] SMTP nicht konfiguriert - keine Kauf-E-Mail fuer ${customerEmail} moeglich.`);
  } else {
    emailDelivery.errors.push("customer_email_missing");
    log("ERROR", "[Email] Kunden-E-Mail fehlt - keine Kauf-E-Mail moeglich.");
  }

  log(
    "INFO",
    `[License] ${licenseChange?.created ? "Erstellt" : isUpgrade ? "Upgrade+Verlaengerung" : "Verlaengert"}: ${license.id} fuer ${customerEmail} (${effectiveTier}, ${effectiveSeats} Seats, +${durationMonths}mo, paid=${amountPaid}, discount=${discountCents}, code=${appliedOfferCode || "-"}, ref=${referralCode || "-"}) via ${source} | email purchase=${emailDelivery.purchaseSent} invoice=${emailDelivery.invoiceSent} admin=${emailDelivery.adminSent}`
  );

  const tierNameForMessage = TIERS[effectiveTier]?.name || TIERS[cleanTier]?.name || "Premium";
  let message;
  if (isUpgrade) {
    message = customerLanguage === "de"
      ? `Upgrade auf ${tierNameForMessage} abgeschlossen! Dein Lizenz-Key bleibt: ${license.id} - Pruefe deine E-Mail (${customerEmail}).`
      : `Upgrade to ${tierNameForMessage} completed! Your license key remains: ${license.id} - Check your email (${customerEmail}).`;
  } else if (isRenewal) {
    message = customerLanguage === "de"
      ? `${tierNameForMessage} verlaengert! Dein bestehender Lizenz-Key bleibt: ${license.id} - Pruefe deine E-Mail (${customerEmail}).`
      : `${tierNameForMessage} renewed! Your existing license key remains: ${license.id} - Check your email (${customerEmail}).`;
  } else {
    message = customerLanguage === "de"
      ? `${tierNameForMessage} aktiviert! Lizenz-Key: ${license.id} - Pruefe deine E-Mail (${customerEmail}).`
      : `${tierNameForMessage} activated! License key: ${license.id} - Check your email (${customerEmail}).`;
  }

  if (discountCents > 0 && appliedOfferCode) {
    const discountLabel = customerLanguage === "de"
      ? ` Rabatt angewendet: ${formatEuroCentsDe(discountCents)} EUR (${appliedOfferCode}).`
      : ` Discount applied: EUR ${(discountCents / 100).toFixed(2)} (${appliedOfferCode}).`;
    message += discountLabel;
  }

  if (!emailDelivery.smtpConfigured) {
    message += customerLanguage === "de"
      ? " Hinweis: SMTP ist aktuell nicht konfiguriert, daher wurde keine E-Mail versendet."
      : " Note: SMTP is not configured, so no email could be sent.";
  } else if (!emailDelivery.purchaseSent || !emailDelivery.invoiceSent) {
    const missingPartsDe = [
      !emailDelivery.purchaseSent ? "Lizenz-Mail" : "",
      !emailDelivery.invoiceSent ? "Rechnung" : "",
    ].filter(Boolean).join(" + ");
    const missingPartsEn = [
      !emailDelivery.purchaseSent ? "license email" : "",
      !emailDelivery.invoiceSent ? "invoice" : "",
    ].filter(Boolean).join(" + ");
    message += customerLanguage === "de"
      ? ` Achtung: ${missingPartsDe} konnte nicht zugestellt werden. Bitte Support kontaktieren.`
      : ` Warning: ${missingPartsEn} could not be delivered. Please contact support.`;
  }

  return {
    success: true,
    email: customerEmail,
    tier: effectiveTier,
    licenseKey: license.id,
    expiresAt: license.expiresAt,
    seats: effectiveSeats,
    language: customerLanguage,
    amountPaid,
    discountCents,
    baseAmountCents,
    finalAmountCents,
    appliedOfferCode: appliedOfferCode || null,
    appliedOfferKind: appliedOfferKind || null,
    referralCode: referralCode || null,
    emailStatus: emailDelivery,
    message,
    created: Boolean(licenseChange?.created),
    renewed: isRenewal,
    upgraded: isUpgrade,
  };
}

async function activateProTrial({ email, language, runtimes, source = "trial" }) {
  const customerLanguage = normalizeLanguage(language, getDefaultLanguage());
  const t = (de, en) => (customerLanguage === "de" ? de : en);
  const customerEmail = String(email || "").trim().toLowerCase();

  if (!isProTrialEnabled()) {
    return {
      success: false,
      status: 403,
      message: t(
        "Der Pro-Testmonat ist aktuell deaktiviert.",
        "The Pro trial month is currently disabled."
      ),
    };
  }

  if (!isValidEmailAddress(customerEmail)) {
    return {
      success: false,
      status: 400,
      message: t(
        "Bitte eine gueltige E-Mail-Adresse eingeben.",
        "Please enter a valid email address."
      ),
    };
  }

  const existingForEmail = listLicensesByContactEmail(customerEmail);
  if (existingForEmail.length > 0) {
    return {
      success: false,
      status: 409,
      message: t(
        "Fuer diese E-Mail existiert bereits eine Lizenz. Der Testmonat ist nur einmalig fuer Neukunden verfuegbar.",
        "A license already exists for this email. The trial month is only available once for new customers."
      ),
    };
  }

  const reserved = reserveTrialClaim(customerEmail, {
    source,
    preferredLanguage: customerLanguage,
    requestedAt: new Date().toISOString(),
  });

  if (!reserved.ok) {
    return {
      success: false,
      status: 409,
      message: t(
        "Der Pro-Testmonat wurde fuer diese E-Mail bereits genutzt.",
        "The Pro trial month has already been used for this email."
      ),
    };
  }

  let license;
  try {
    license = createLicense({
      plan: "pro",
      seats: PRO_TRIAL_SEATS,
      billingPeriod: "monthly",
      months: PRO_TRIAL_MONTHS,
      activatedBy: "trial",
      note: `Trial via ${source}`,
      contactEmail: customerEmail,
      preferredLanguage: customerLanguage,
    });
  } catch (err) {
    releaseTrialClaim(customerEmail);
    return {
      success: false,
      status: 500,
      message: t(
        "Der Pro-Testmonat konnte nicht erstellt werden. Bitte spaeter erneut versuchen.",
        "Could not create the Pro trial month. Please try again later."
      ),
      detail: err?.message || String(err),
    };
  }

  finalizeTrialClaim(customerEmail, {
    source,
    licenseId: license.id,
    tier: "pro",
    seats: PRO_TRIAL_SEATS,
    months: PRO_TRIAL_MONTHS,
    expiresAt: license.expiresAt,
    activatedBy: "trial",
  });

  const emailDelivery = {
    smtpConfigured: isEmailConfigured(),
    purchaseSent: false,
    invoiceSent: false,
    adminSent: false,
    errors: [],
  };

  if (emailDelivery.smtpConfigured) {
    const tierConfig = TIERS.pro;
    const isDe = customerLanguage === "de";
    const inviteOverview = buildInviteOverviewForTier(runtimes, "pro");
    const purchaseHtml = buildPurchaseEmail({
      tier: "pro",
      tierName: isDe ? `${tierConfig.name} Testmonat` : `${tierConfig.name} Trial Month`,
      months: PRO_TRIAL_MONTHS,
      licenseKey: license.id,
      seats: PRO_TRIAL_SEATS,
      email: customerEmail,
      expiresAt: license.expiresAt,
      inviteOverview,
      dashboardUrl: resolvePublicWebsiteUrl(),
      isUpgrade: false,
      pricePaid: 0,
      currency: "eur",
      language: customerLanguage,
    });
    const purchaseSubject = isDe
      ? "OmniFM Pro Testmonat - Dein Lizenz-Key"
      : "OmniFM Pro Trial Month - Your license key";

    const purchaseResult = await sendMailWithRetry({
      to: customerEmail,
      subject: purchaseSubject,
      html: purchaseHtml,
      label: "trial-license-mail",
      maxAttempts: 2,
    });
    emailDelivery.purchaseSent = Boolean(purchaseResult?.success);
    if (!emailDelivery.purchaseSent) {
      emailDelivery.errors.push(`purchase:${purchaseResult?.error || "unknown"}`);
    }

    const adminEmail = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
    if (adminEmail) {
      const adminHtml = buildAdminNotification({
        tier: "pro",
        tierName: isDe ? "Pro Testmonat" : "Pro Trial Month",
        months: PRO_TRIAL_MONTHS,
        serverId: "-",
        expiresAt: license.expiresAt,
        pricePaid: 0,
        language: customerLanguage,
      });
      const adminSubject = isDe
        ? "OmniFM Pro-Testmonat aktiviert"
        : "OmniFM Pro trial activated";
      const adminResult = await sendMailWithRetry({
        to: adminEmail,
        subject: adminSubject,
        html: adminHtml,
        label: "trial-admin-notification",
        maxAttempts: 1,
      });
      emailDelivery.adminSent = Boolean(adminResult?.success);
      if (!emailDelivery.adminSent) {
        emailDelivery.errors.push(`admin:${adminResult?.error || "unknown"}`);
      }
    }
  } else {
    emailDelivery.errors.push("smtp_not_configured");
    log("ERROR", `[Email] SMTP nicht konfiguriert - keine Trial-E-Mail fuer ${customerEmail} moeglich.`);
  }

  log(
    "INFO",
    `[Trial] Pro-Test aktiviert: ${license.id} fuer ${customerEmail} | email purchase=${emailDelivery.purchaseSent} admin=${emailDelivery.adminSent}`
  );

  let message = customerLanguage === "de"
    ? `Pro-Testmonat aktiviert! Lizenz-Key: ${license.id} - Pruefe deine E-Mail (${customerEmail}).`
    : `Pro trial month activated! License key: ${license.id} - Check your email (${customerEmail}).`;

  if (!emailDelivery.smtpConfigured) {
    message = customerLanguage === "de"
      ? `Pro-Testmonat aktiviert! Lizenz-Key: ${license.id}. Hinweis: SMTP ist nicht konfiguriert, daher wurde keine E-Mail versendet.`
      : `Pro trial month activated! License key: ${license.id}. Note: SMTP is not configured, so no email was sent.`;
  } else if (!emailDelivery.purchaseSent) {
    message = customerLanguage === "de"
      ? `Pro-Testmonat aktiviert! Lizenz-Key: ${license.id}. Achtung: Die Lizenz-Mail konnte nicht zugestellt werden. Bitte Support kontaktieren.`
      : `Pro trial month activated! License key: ${license.id}. Warning: The license email could not be delivered. Please contact support.`;
  }

  return {
    success: true,
    email: customerEmail,
    tier: "pro",
    licenseKey: license.id,
    expiresAt: license.expiresAt,
    seats: PRO_TRIAL_SEATS,
    months: PRO_TRIAL_MONTHS,
    language: customerLanguage,
    emailStatus: emailDelivery,
    message,
  };
}

const webhookEventsInFlight = new Set();
const apiRateLimitState = new Map();
const MAX_API_RATE_STATE_ENTRIES = Math.max(
  1_000,
  Number.parseInt(String(process.env.API_RATE_STATE_MAX_ENTRIES || "50000"), 10) || 50_000
);

function firstHeaderValue(rawHeader) {
  const value = String(rawHeader || "").trim();
  if (!value) return "";
  const first = value.split(",")[0].trim();
  return first || "";
}

function getClientIp(req) {
  if (TRUST_PROXY_HEADERS) {
    const forwardedFor = firstHeaderValue(req.headers["x-forwarded-for"]);
    if (forwardedFor) return forwardedFor;
    const realIp = firstHeaderValue(req.headers["x-real-ip"]);
    if (realIp) return realIp;
  }
  return String(req.socket?.remoteAddress || "unknown");
}

function getApiRateLimitSpec(pathname) {
  if (!String(pathname || "").startsWith("/api/premium")) return null;
  if (pathname === "/api/premium/webhook") {
    return {
      scope: "webhook",
      windowMs: Number(process.env.API_RATE_WEBHOOK_WINDOW_MS || "60000"),
      max: Number(process.env.API_RATE_WEBHOOK_MAX || "300"),
    };
  }

  if (
    pathname === "/api/premium/checkout"
    || pathname === "/api/premium/verify"
    || pathname === "/api/premium/trial"
  ) {
    return {
      scope: "write",
      windowMs: Number(process.env.API_RATE_WRITE_WINDOW_MS || "60000"),
      max: Number(process.env.API_RATE_WRITE_MAX || "20"),
    };
  }

  return {
    scope: "read",
    windowMs: Number(process.env.API_RATE_READ_WINDOW_MS || "60000"),
    max: Number(process.env.API_RATE_READ_MAX || "120"),
  };
}

function cleanupRateLimitState(now = Date.now()) {
  if (apiRateLimitState.size < 10_000 && apiRateLimitState.size <= MAX_API_RATE_STATE_ENTRIES) return;
  for (const [key, value] of apiRateLimitState.entries()) {
    if (!value || value.resetAt <= now) {
      apiRateLimitState.delete(key);
    }
  }

  if (apiRateLimitState.size > MAX_API_RATE_STATE_ENTRIES) {
    const entriesByReset = [...apiRateLimitState.entries()]
      .sort((a, b) => Number(a[1]?.resetAt || 0) - Number(b[1]?.resetAt || 0));
    const removeCount = apiRateLimitState.size - MAX_API_RATE_STATE_ENTRIES;
    for (let index = 0; index < removeCount; index++) {
      apiRateLimitState.delete(entriesByReset[index][0]);
    }
  }
}

function enforceApiRateLimit(req, res, pathname) {
  const spec = getApiRateLimitSpec(pathname);
  if (!spec) return true;

  const windowMs = Math.max(1_000, Number(spec.windowMs) || 60_000);
  const maxRequests = Math.max(1, Number(spec.max) || 1);
  const now = Date.now();
  cleanupRateLimitState(now);
  const ip = getClientIp(req);
  const key = `${spec.scope}:${req.method}:${pathname}:${ip}`;

  let entry = apiRateLimitState.get(key);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + windowMs };
  }

  entry.count += 1;
  apiRateLimitState.set(key, entry);

  if (entry.count > maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    sendJson(res, 429, {
      error: "Rate limit erreicht. Bitte spaeter erneut versuchen.",
      retryAfterSeconds,
    });
    return false;
  }

  return true;
}

function startWebServer(runtimes) {
  const webInternalPort = Number(process.env.WEB_INTERNAL_PORT || "8080");
  const webPort = Number(process.env.WEB_PORT || "8081");
  const webBind = process.env.WEB_BIND || "0.0.0.0";
  const publicUrl = String(process.env.PUBLIC_WEB_URL || "").trim();

  const server = http.createServer(async (req, res) => {
    let requestUrl;
    try {
      requestUrl = new URL(req.url || "/", "http://localhost");
    } catch {
      sendJson(res, 400, { error: "Ungueltige Request-URL." });
      return;
    }

    // CORS
    const originAllowed = applyCors(req, res, publicUrl);
    if (req.method === "OPTIONS") {
      if (!originAllowed) {
        sendJson(res, 403, { error: "Origin nicht erlaubt." });
        return;
      }
      res.writeHead(204, { ...getCommonSecurityHeaders() });
      res.end();
      return;
    }
    if (!originAllowed) {
      sendJson(res, 403, { error: "Origin nicht erlaubt." });
      return;
    }

    if (!enforceApiRateLimit(req, res, requestUrl.pathname)) {
      return;
    }

    // --- Helper to read request body ---
    function readRawBody(maxBytes = 1024 * 1024) {
      return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;

        const fail = (status, message, err = null) => {
          if (settled) return;
          settled = true;
          const error = err || new Error(message);
          error.status = status;
          reject(error);
        };

        req.on("data", (chunk) => {
          if (settled) return;
          size += chunk.length;
          if (size > maxBytes) {
            fail(413, "Body too large");
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (settled) return;
          settled = true;
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
        req.on("error", (err) => fail(400, err?.message || "Body read error", err));
      });
    }

    async function readJsonBody() {
      const raw = await readRawBody();
      if (!raw.trim()) return {};
      try {
        return JSON.parse(raw);
      } catch {
        const err = new Error("Invalid JSON");
        err.status = 400;
        throw err;
      }
    }

    // --- API routes ---
    if (requestUrl.pathname === "/api/bots") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
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
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      sendJson(res, 200, { commands: API_COMMANDS });
      return;
    }

    if (requestUrl.pathname === "/api/stats") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
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
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
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
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
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
    if (requestUrl.pathname === "/api/premium/check") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const serverId = requestUrl.searchParams.get("serverId");
      if (!serverId || !/^\d{17,22}$/.test(serverId)) {
        sendJson(res, 400, { error: "serverId muss 17-22 Ziffern sein." });
        return;
      }
      const tierConfig = getTierConfig(serverId);
      const license = getLicense(serverId);
      const includeSensitive = isAdminApiRequest(req);
      sendJson(res, 200, {
        serverId,
        tier: tierConfig.tier,
        name: tierConfig.name,
        bitrate: tierConfig.bitrate,
        reconnectMs: tierConfig.reconnectMs,
        maxBots: tierConfig.maxBots,
        license: sanitizeLicenseForApi(license, includeSensitive),
      });
      return;
    }

    // Premium Bot Invite-Links: nur fuer berechtigte Server
    if (requestUrl.pathname === "/api/premium/invite-links") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
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
          inviteUrl: access.hasAccess ? buildInviteUrlForRuntime(rt) : null,
        };
      });

      sendJson(res, 200, { serverId, serverTier: tierConfig.tier, bots: links });
      return;
    }

    if (requestUrl.pathname === "/api/premium/tiers") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      sendJson(res, 200, { tiers: TIERS });
      return;
    }

    if (requestUrl.pathname === "/api/premium/trial") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
      try {
        const body = await readJsonBody();
        const { email, language: rawLanguage } = body;
        const acceptLanguage = req.headers["accept-language"];
        const trialLanguage = normalizeLanguage(
          rawLanguage,
          resolveLanguageFromAcceptLanguage(acceptLanguage, getDefaultLanguage())
        );
        const t = (de, en) => (trialLanguage === "de" ? de : en);

        if (!isProTrialEnabled()) {
          sendJson(res, 403, {
            success: false,
            message: t(
              "Der Pro-Testmonat ist aktuell deaktiviert.",
              "The Pro trial month is currently disabled."
            ),
          });
          return;
        }

        if (!isValidEmailAddress(email)) {
          sendJson(res, 400, {
            success: false,
            message: t(
              "Bitte eine gueltige E-Mail-Adresse eingeben.",
              "Please enter a valid email address."
            ),
          });
          return;
        }

        const result = await activateProTrial({
          email,
          language: trialLanguage,
          runtimes,
          source: "api:trial",
        });
        if (!result.success) {
          sendJson(res, result.status || 400, {
            success: false,
            message: result.message,
          });
          return;
        }

        sendJson(res, 200, {
          success: true,
          email: result.email,
          tier: result.tier,
          licenseKey: result.licenseKey,
          expiresAt: result.expiresAt,
          seats: result.seats,
          months: result.months,
          message: result.message,
          emailStatus: result.emailStatus,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          const fallbackLanguage = resolveLanguageFromAcceptLanguage(req.headers["accept-language"], getDefaultLanguage());
          sendJson(res, status, {
            success: false,
            message: fallbackLanguage === "de"
              ? status === 413
                ? "Request-Body ist zu gross."
                : "Ungueltiges JSON im Request-Body."
              : status === 413
                ? "Request body is too large."
                : "Invalid JSON in request body.",
          });
          return;
        }
        log("ERROR", `Pro trial activation error: ${err.message}`);
        const fallbackLanguage = resolveLanguageFromAcceptLanguage(req.headers["accept-language"], getDefaultLanguage());
        sendJson(res, 500, {
          success: false,
          message: fallbackLanguage === "de"
            ? "Der Pro-Testmonat konnte nicht aktiviert werden."
            : "Could not activate the Pro trial month.",
        });
      }
      return;
    }

    if (requestUrl.pathname === "/api/premium/checkout") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
      try {
        const body = await readJsonBody();
        const {
          tier,
          email,
          months,
          seats: rawSeats,
          returnUrl,
          language: rawLanguage,
          couponCode: rawCouponCode,
          referralCode: rawReferralCode,
        } = body;
        const acceptLanguage = req.headers["accept-language"];
        const checkoutLanguage = normalizeLanguage(
          rawLanguage,
          resolveLanguageFromAcceptLanguage(acceptLanguage, getDefaultLanguage())
        );
        const isDe = checkoutLanguage === "de";
        const t = (de, en) => (isDe ? de : en);
        if (!tier || !email) {
          sendJson(res, 400, { error: t("tier und email erforderlich.", "tier and email are required.") });
          return;
        }
        if (!isValidEmailAddress(email)) {
          sendJson(res, 400, { error: t("Bitte eine gueltige E-Mail-Adresse eingeben.", "Please enter a valid email address.") });
          return;
        }
        if (tier !== "pro" && tier !== "ultimate") {
          sendJson(res, 400, { error: t("tier muss 'pro' oder 'ultimate' sein.", "tier must be 'pro' or 'ultimate'.") });
          return;
        }

        const seats = normalizeSeats(rawSeats);

        const stripeKey = getStripeSecretKey();
        if (!stripeKey) {
          sendJson(res, 503, { error: t("Stripe nicht konfiguriert. Nutze: ./update.sh --stripe", "Stripe is not configured. Use: ./update.sh --stripe") });
          return;
        }

        const durationMonths = Math.max(1, parseInt(months) || 1);
        const basePriceInCents = calculatePrice(tier, durationMonths, seats);
        if (basePriceInCents <= 0) {
          sendJson(res, 400, { error: t("Ungueltige Preisberechnung fuer die gewaehlte Kombination.", "Invalid price calculation for the selected combination.") });
          return;
        }
        const offerResolution = resolveCheckoutOfferForRequest({
          tier,
          seats,
          months: durationMonths,
          email: email.trim().toLowerCase(),
          couponCode: rawCouponCode,
          referralCode: rawReferralCode,
          baseAmountCents: basePriceInCents,
          language: checkoutLanguage,
        });
        if (!offerResolution.ok) {
          sendJson(res, offerResolution.status || 400, {
            error: offerResolution.error || t("Rabattcode konnte nicht angewendet werden.", "Could not apply discount code."),
            discount: offerResolution.preview || null,
          });
          return;
        }
        const offerPreview = offerResolution.preview;
        const priceInCents = Math.max(0, Number(offerPreview?.finalAmountCents || basePriceInCents));
        const discountCents = Math.max(0, Number(offerPreview?.discountCents || 0));
        const appliedOfferCode = sanitizeOfferCode(offerPreview?.applied?.code);
        const appliedOfferKind = String(offerPreview?.applied?.kind || "").trim().toLowerCase();
        const referralCode = sanitizeOfferCode(offerPreview?.attributionReferralCode || "");
        if (priceInCents <= 0) {
          sendJson(res, 400, { error: t("Preis ist nach Rabatt ungueltig.", "Price is invalid after discount.") });
          return;
        }
        const tierName = TIERS[tier].name;
        const seatsLabel = seats > 1 ? (isDe ? ` (${seats} Server)` : ` (${seats} server${seats > 1 ? "s" : ""})`) : "";
        let description;
        if (durationMonths >= 12) {
          description = isDe
            ? `${tierName}${seatsLabel} - ${durationMonths} Monate (Jahresrabatt: 2 Monate gratis!)`
            : `${tierName}${seatsLabel} - ${durationMonths} months (yearly discount: 2 months free!)`;
        } else {
          description = isDe
            ? `${tierName}${seatsLabel} - ${durationMonths} Monat${durationMonths > 1 ? "e" : ""}`
            : `${tierName}${seatsLabel} - ${durationMonths} month${durationMonths > 1 ? "s" : ""}`;
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
            language: checkoutLanguage,
            isUpgrade: "false",
            checkoutCreatedAt: new Date().toISOString(),
            couponCode: offerResolution.couponCode || "",
            referralCode: referralCode || "",
            appliedOfferCode: appliedOfferCode || "",
            appliedOfferKind: appliedOfferKind || "",
            offerOwnerLabel: String(offerPreview?.applied?.ownerLabel || ""),
            baseAmountCents: String(basePriceInCents),
            discountCents: String(discountCents),
            finalAmountCents: String(priceInCents),
          },
          success_url: resolveCheckoutReturnBase(returnUrl, publicUrl, req) + "?payment=success&session_id={CHECKOUT_SESSION_ID}",
          cancel_url: resolveCheckoutReturnBase(returnUrl, publicUrl, req) + "?payment=cancelled",
        });

        sendJson(res, 200, {
          sessionId: session.id,
          url: session.url,
          pricing: {
            baseAmountCents: basePriceInCents,
            discountCents,
            finalAmountCents: priceInCents,
          },
          discount: offerPreview,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          const fallbackLanguage = resolveLanguageFromAcceptLanguage(req.headers["accept-language"], getDefaultLanguage());
          sendJson(res, status, {
            error: fallbackLanguage === "de"
              ? status === 413
                ? "Request-Body ist zu gross."
                : "Ungueltiges JSON im Request-Body."
              : status === 413
                ? "Request body is too large."
                : "Invalid JSON in request body.",
          });
          return;
        }
        log("ERROR", `Stripe checkout error: ${err.message}`);
        const fallbackLanguage = resolveLanguageFromAcceptLanguage(req.headers["accept-language"], getDefaultLanguage());
        sendJson(res, 500, {
          error: fallbackLanguage === "de"
            ? "Checkout fehlgeschlagen: " + err.message
            : "Checkout failed: " + err.message,
        });
      }
      return;
    }

    if (requestUrl.pathname === "/api/premium/offer/preview") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
      try {
        const body = await readJsonBody();
        const {
          tier,
          email,
          months,
          seats: rawSeats,
          couponCode,
          referralCode,
          language: rawLanguage,
        } = body || {};
        const acceptLanguage = req.headers["accept-language"];
        const previewLanguage = normalizeLanguage(
          rawLanguage,
          resolveLanguageFromAcceptLanguage(acceptLanguage, getDefaultLanguage())
        );
        const isDe = previewLanguage === "de";
        const t = (de, en) => (isDe ? de : en);

        const cleanTier = String(tier || "").trim().toLowerCase();
        if (!["pro", "ultimate"].includes(cleanTier)) {
          sendJson(res, 400, { success: false, error: t("tier muss 'pro' oder 'ultimate' sein.", "tier must be 'pro' or 'ultimate'.") });
          return;
        }

        const durationMonths = Math.max(1, parseInt(months, 10) || 1);
        const seats = normalizeSeats(rawSeats);
        const baseAmountCents = calculatePrice(cleanTier, durationMonths, seats);
        if (baseAmountCents <= 0) {
          sendJson(res, 400, {
            success: false,
            error: t("Ungueltige Preisberechnung fuer die gewaehlte Kombination.", "Invalid price calculation for the selected combination."),
          });
          return;
        }

        const resolved = resolveCheckoutOfferForRequest({
          tier: cleanTier,
          seats,
          months: durationMonths,
          email: String(email || "").trim().toLowerCase(),
          couponCode,
          referralCode,
          baseAmountCents,
          language: previewLanguage,
        });

        if (!resolved.ok) {
          sendJson(res, resolved.status || 400, {
            success: false,
            error: resolved.error,
            discount: resolved.preview || null,
          });
          return;
        }

        sendJson(res, 200, {
          success: true,
          discount: resolved.preview,
          pricing: {
            baseAmountCents,
            discountCents: resolved.preview?.discountCents || 0,
            finalAmountCents: resolved.preview?.finalAmountCents || baseAmountCents,
          },
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, {
            success: false,
            error: status === 413 ? "Request-Body ist zu gross." : "Ungueltiges JSON im Request-Body.",
          });
          return;
        }
        log("ERROR", `Offer preview error: ${err.message}`);
        sendJson(res, 500, { success: false, error: "Offer-Vorschau fehlgeschlagen: " + err.message });
      }
      return;
    }

    if (requestUrl.pathname === "/api/premium/offers") {
      if (!isAdminApiRequest(req)) {
        sendJson(res, 401, { error: "Unauthorized. API admin token required." });
        return;
      }

      if (req.method === "GET") {
        const includeInactive = requestUrl.searchParams.get("includeInactive") !== "0";
        const includeStats = requestUrl.searchParams.get("includeStats") !== "0";
        const offers = listOffers({ includeInactive, includeStats });
        sendJson(res, 200, { offers });
        return;
      }

      if (req.method === "POST" || req.method === "PATCH") {
        try {
          const body = await readJsonBody();
          const actor = clipText(req.headers["x-admin-user"] || body?.updatedBy || "api-admin", 120);
          const offer = upsertOffer({
            ...(body || {}),
            updatedBy: actor,
            createdBy: body?.createdBy || actor,
          }, {
            partial: req.method === "PATCH",
          });
          sendJson(res, 200, { success: true, offer });
        } catch (err) {
          sendJson(res, 400, { success: false, error: err?.message || String(err) });
        }
        return;
      }

      if (req.method === "DELETE") {
        const code = sanitizeOfferCode(requestUrl.searchParams.get("code") || "");
        if (!code) {
          sendJson(res, 400, { success: false, error: "code ist erforderlich." });
          return;
        }
        const deleted = deleteOffer(code);
        sendJson(res, deleted ? 200 : 404, { success: deleted, code });
        return;
      }

      methodNotAllowed(res, ["GET", "POST", "PATCH", "DELETE"]);
      return;
    }

    if (requestUrl.pathname === "/api/premium/offers/active") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
      if (!isAdminApiRequest(req)) {
        sendJson(res, 401, { error: "Unauthorized. API admin token required." });
        return;
      }
      try {
        const body = await readJsonBody();
        const code = sanitizeOfferCode(body?.code || "");
        const active = body?.active !== undefined ? Boolean(body.active) : true;
        if (!code) {
          sendJson(res, 400, { success: false, error: "code ist erforderlich." });
          return;
        }
        const offer = setOfferActive(code, active);
        if (!offer) {
          sendJson(res, 404, { success: false, error: "Code nicht gefunden." });
          return;
        }
        sendJson(res, 200, { success: true, offer });
      } catch (err) {
        sendJson(res, 400, { success: false, error: err?.message || String(err) });
      }
      return;
    }

    if (requestUrl.pathname === "/api/premium/redemptions") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      if (!isAdminApiRequest(req)) {
        sendJson(res, 401, { error: "Unauthorized. API admin token required." });
        return;
      }
      const limit = Number.parseInt(String(requestUrl.searchParams.get("limit") || "100"), 10);
      const redemptions = listRecentRedemptions(limit);
      sendJson(res, 200, { redemptions });
      return;
    }

    if (requestUrl.pathname === "/api/premium/offer") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const code = sanitizeOfferCode(requestUrl.searchParams.get("code") || "");
      if (!code) {
        sendJson(res, 400, { error: "code ist erforderlich." });
        return;
      }
      const offer = getOffer(code);
      if (!offer) {
        sendJson(res, 404, { error: "Code nicht gefunden." });
        return;
      }
      sendJson(res, 200, { offer });
      return;
    }

    if (requestUrl.pathname === "/api/premium/webhook") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
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

        if (webhookEventsInFlight.has(event.id)) {
          sendJson(res, 200, { received: true, duplicate: true, inFlight: true });
          return;
        }
        webhookEventsInFlight.add(event.id);

        try {
          if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
            const result = await activatePaidStripeSession(event.data.object, runtimes, `webhook:${event.type}`);
            if (!result.success) {
              log("ERROR", `Webhook-Aktivierung fehlgeschlagen (event=${event.id}, type=${event.type}): ${result.message}`);
              sendJson(res, 500, {
                received: true,
                processed: false,
                replay: !!result.replay,
                message: result.message,
              });
              return;
            }

            markEventProcessed(event.id, {
              type: event.type,
              sessionId: event.data?.object?.id || null,
              success: true,
            });
            sendJson(res, 200, {
              received: true,
              processed: true,
              replay: !!result.replay,
              message: result.message,
            });
            return;
          }

          markEventProcessed(event.id, { type: event.type, ignored: true });
          sendJson(res, 200, { received: true, ignored: true });
        } finally {
          webhookEventsInFlight.delete(event.id);
        }
      } catch (err) {
        if (Number(err?.status || 0) === 413) {
          sendJson(res, 413, { error: "Webhook-Body ist zu gross." });
          return;
        }
        log("ERROR", `Stripe webhook error: ${err.message}`);
        sendJson(res, 500, { error: "Webhook-Verarbeitung fehlgeschlagen: " + err.message });
      }
      return;
    }

    if (requestUrl.pathname === "/api/premium/verify") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
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
            email: replayResult.email || null,
            licenseKey: replayResult.licenseKey || null,
            tier: replayResult.tier || null,
            discountCents: replayResult.discountCents || 0,
            appliedOfferCode: replayResult.appliedOfferCode || null,
            appliedOfferKind: replayResult.appliedOfferKind || null,
            referralCode: replayResult.referralCode || null,
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
          email: result.email,
          licenseKey: result.licenseKey,
          tier: result.tier,
          expiresAt: result.expiresAt,
          seats: result.seats,
           discountCents: result.discountCents || 0,
           appliedOfferCode: result.appliedOfferCode || null,
           appliedOfferKind: result.appliedOfferKind || null,
           referralCode: result.referralCode || null,
          message: result.message,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, {
            error: status === 413
              ? "Request-Body ist zu gross."
              : "Ungueltiges JSON im Request-Body.",
          });
          return;
        }
        log("ERROR", `Stripe verify error: ${err.message}`);
        sendJson(res, 500, { error: "Verifizierung fehlgeschlagen: " + err.message });
      }
      return;
    }

    // --- Pricing info endpoint ---
    if (requestUrl.pathname === "/api/premium/pricing") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
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
            startingAt: formatEuroCentsDe(getSeatPricePerMonthCents("pro", 1)),
            seatPricing: seatPricingInEuro("pro"),
            features: [
              "128k Bitrate (HQ Opus)",
              "Bis zu 8 Bots",
              "120 Stationen (Free + Pro)",
              "Priority Reconnect (1,5s)",
              "Server-Lizenz (1/2/3/5 Server)",
              "Rollenbasierte Command-Berechtigungen",
            ]
          },
          ultimate: {
            name: "Ultimate",
            pricePerMonth: TIERS.ultimate.pricePerMonth,
            startingAt: formatEuroCentsDe(getSeatPricePerMonthCents("ultimate", 1)),
            seatPricing: seatPricingInEuro("ultimate"),
            features: [
              "320k Bitrate (Ultra HQ)",
              "Bis zu 16 Bots",
              "Alle Stationen + Custom URLs",
              "Instant Reconnect (0,4s)",
              "Server-Lizenz Bundles",
              "Rollenbasierte Command-Berechtigungen",
            ]
          },
        },
        yearlyDiscount: "12 Monate = 10 bezahlen (2 Monate gratis)",
        seatOptions: [...SEAT_OPTIONS],
        trial: {
          enabled: isProTrialEnabled(),
          tier: "pro",
          months: PRO_TRIAL_MONTHS,
          seats: PRO_TRIAL_SEATS,
          oneTimePerEmail: true,
        },
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

    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "API route not found." });
      return;
    }

    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return;
    }

    // --- Static file serving from web/ ---
    const staticPath = requestUrl.pathname === "/"
      ? "index.html"
      : requestUrl.pathname.replace(/^\/+/, "");
    const filePath = path.join(webDir, staticPath);
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
const startedRuntimes = [];
const failedRuntimes = [];

for (let index = 0; index < runtimes.length; index++) {
  if (startResults[index]) {
    startedRuntimes.push(runtimes[index]);
  } else {
    failedRuntimes.push(runtimes[index]);
  }
}

log(
  "INFO",
  `Bot-Startup abgeschlossen: started=${startedRuntimes.length}/${runtimes.length}, failed=${failedRuntimes.length}/${runtimes.length}`
);

for (const failedRuntime of failedRuntimes) {
  const errText = failedRuntime.startError?.message || String(failedRuntime.startError || "unbekannt");
  log(
    "ERROR",
    `[${failedRuntime.config.name}] Start fehlgeschlagen. Dieser Bot liefert keine Slash-Commands, bis der Login/Token-Fehler behoben ist. Grund: ${errText}`
  );
}

if (!startResults.some(Boolean)) {
  log("ERROR", "Kein Bot konnte gestartet werden. Backend wird beendet.");
  process.exit(1);
}

// Auto-Restore: Vorherigen Zustand wiederherstellen (Voice Channels + Stationen)
const stations = loadStations();
for (const runtime of startedRuntimes) {
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
  for (const runtime of startedRuntimes) {
    if (runtime.client.isReady()) {
      runtime.persistState();
    }
  }
}, 60_000);

const periodicGuildSyncIntervalRaw = Number.parseInt(String(process.env.PERIODIC_GUILD_COMMAND_SYNC_MS ?? "1800000"), 10);
const periodicGuildSyncIntervalMs = Number.isFinite(periodicGuildSyncIntervalRaw) && periodicGuildSyncIntervalRaw >= 60_000
  ? periodicGuildSyncIntervalRaw
  : 0;
let periodicGuildSyncRunning = false;

if (periodicGuildSyncIntervalMs > 0) {
  log("INFO", `Periodischer Guild-Command-Sync aktiv: alle ${Math.round(periodicGuildSyncIntervalMs / 1000)}s.`);
  setInterval(() => {
    if (periodicGuildSyncRunning) return;
    periodicGuildSyncRunning = true;
    (async () => {
      for (const runtime of runtimes) {
        if (!runtime.client.isReady()) continue;
        if (!runtime.isGuildCommandSyncEnabled()) continue;
        // eslint-disable-next-line no-await-in-loop
        await runtime.syncGuildCommands("periodic");
      }
    })()
      .catch((err) => {
        log("ERROR", `[GuildSync] Periodischer Sync fehlgeschlagen: ${err?.message || err}`);
      })
      .finally(() => {
        periodicGuildSyncRunning = false;
      });
  }, periodicGuildSyncIntervalMs);
} else {
  log("INFO", "Periodischer Guild-Command-Sync deaktiviert (PERIODIC_GUILD_COMMAND_SYNC_MS=0).");
}

// Lizenz-Ablauf pruefen (alle 6 Stunden)
log("INFO", `Lizenz-Reminder aktiv fuer: ${EXPIRY_REMINDER_DAYS.join(", ")} Tage vor Ablauf + abgelaufen.`);
setInterval(async () => {
  if (!isEmailConfigured()) return;
  try {
    const all = listRawLicenses();
    for (const [rawLicenseId, lic] of Object.entries(all)) {
      if (!lic?.expiresAt) continue;

      const licenseId = String(lic.id || rawLicenseId || "").trim();
      const serverId = String((lic.linkedServerIds || [])[0] || "-");
      const tierKey = String(lic.plan || lic.tier || "free");
      const tierName = TIERS[tierKey]?.name || tierKey;
      const emailLanguage = normalizeLanguage(lic.preferredLanguage || lic.language, getDefaultLanguage());
      const contactEmail = String(lic.contactEmail || "").trim().toLowerCase();
      const daysUntilExpiry = Math.ceil((new Date(lic.expiresAt) - new Date()) / 86400000);

      if (daysUntilExpiry > 0) {
        for (let idx = 0; idx < EXPIRY_REMINDER_DAYS.length; idx++) {
          const reminderDay = EXPIRY_REMINDER_DAYS[idx];
          const nextLowerDay = EXPIRY_REMINDER_DAYS[idx + 1] ?? 0;
          const withinWindow = daysUntilExpiry <= reminderDay && daysUntilExpiry > nextLowerDay;
          if (!withinWindow) continue;

          const warningFlagField = `_warning${reminderDay}ForExpiryAt`;
          const warningAlreadySent = lic[warningFlagField] === lic.expiresAt;
          if (warningAlreadySent) break;
          if (!contactEmail) break;

          const html = buildExpiryWarningEmail({
            tierName,
            serverId,
            expiresAt: lic.expiresAt,
            daysLeft: Math.max(1, daysUntilExpiry),
            language: emailLanguage,
          });
          const warningSubject = emailLanguage === "de"
            ? `Premium ${tierName} laeuft in ${Math.max(1, daysUntilExpiry)} ${Math.max(1, daysUntilExpiry) === 1 ? "Tag" : "Tagen"} ab!`
            : `Premium ${tierName} expires in ${Math.max(1, daysUntilExpiry)} day${Math.max(1, daysUntilExpiry) === 1 ? "" : "s"}!`;
          const result = await sendMail(contactEmail, warningSubject, html);
          if (result?.success) {
            patchLicenseById(licenseId, { [warningFlagField]: lic.expiresAt });
            log("INFO", `[Email] Ablauf-Warnung (${reminderDay}d) gesendet an ${contactEmail} fuer Lizenz ${licenseId} (Server ${serverId})`);
          } else {
            log("ERROR", `[Email] Ablauf-Warnung (${reminderDay}d) fehlgeschlagen fuer Lizenz ${licenseId}: ${result?.error || "Unbekannter Fehler"}`);
          }
          break;
        }
      }

      // Abgelaufen
      const expiredAlreadyNotified =
        lic._expiredNotifiedForExpiryAt === lic.expiresAt || lic._expiredNotified === true;
      if (daysUntilExpiry <= 0 && contactEmail && !expiredAlreadyNotified) {
        const html = buildExpiryEmail({ tierName, serverId, language: emailLanguage });
        const expiredSubject = emailLanguage === "de"
          ? `Premium ${tierName} abgelaufen`
          : `Premium ${tierName} expired`;
        const result = await sendMail(contactEmail, expiredSubject, html);
        if (result?.success) {
          patchLicenseById(licenseId, { _expiredNotifiedForExpiryAt: lic.expiresAt, _expiredNotified: true });
          log("INFO", `[Email] Ablauf-Benachrichtigung gesendet an ${contactEmail} fuer Lizenz ${licenseId} (Server ${serverId})`);
        } else {
          log("ERROR", `[Email] Ablauf-Benachrichtigung fehlgeschlagen fuer Lizenz ${licenseId}: ${result?.error || "Unbekannter Fehler"}`);
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
  try {
    await logWriteQueue;
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT").catch(() => process.exit(1));
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch(() => process.exit(1));
});
