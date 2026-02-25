// ============================================================
// OmniFM: General Utility/Helper Functions
// ============================================================
import { BRAND, PLANS } from "../config/plans.js";

// ---- Constants ----
const YEARLY_DISCOUNT_MONTHS = 10;
const PRO_TRIAL_MONTHS = 1;
const PRO_TRIAL_SEATS = 1;
const DEFAULT_EXPIRY_REMINDER_DAYS = [30, 14, 7, 1];
const DURATION_OPTIONS = [1, 3, 6, 12];
const DURATION_PRICING_CENTS = {
  pro:      { 1: 299, 3: 249, 6: 229, 12: 199 },
  ultimate: { 1: 499, 3: 399, 6: 349, 12: 299 },
};

const TIERS = {
  free: { name: "Free", rank: 0, maxBots: 2, bitrate: null, reconnectDelayMs: 5000 },
  pro: { name: "Pro", rank: 1, maxBots: 8, bitrate: "128k", reconnectDelayMs: 1500 },
  ultimate: { name: "Ultimate", rank: 2, maxBots: 16, bitrate: "320k", reconnectDelayMs: 400 },
};
const TIER_RANK = { free: 0, pro: 1, ultimate: 2 };
const TRUST_PROXY_HEADERS = String(process.env.TRUST_PROXY_HEADERS || "0") === "1";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

// ---- Validation ----
function normalizeDuration(rawMonths) {
  const value = Number(rawMonths) || 1;
  const closest = DURATION_OPTIONS.reduce((best, opt) =>
    Math.abs(opt - value) < Math.abs(best - value) ? opt : best
  , DURATION_OPTIONS[0]);
  return closest;
}

function isValidEmailAddress(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function isProTrialEnabled() {
  return String(process.env.PRO_TRIAL_ENABLED || "1") !== "0";
}

function parseExpiryReminderDays(raw) {
  if (!raw || !String(raw).trim()) return DEFAULT_EXPIRY_REMINDER_DAYS;
  const parsed = String(raw)
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parsed.length > 0 ? parsed.sort((a, b) => b - a) : DEFAULT_EXPIRY_REMINDER_DAYS;
}

// ---- Pricing (Laufzeit-basiert) ----
function getPricePerMonthCents(tier, months = 1) {
  const normalizedTier = String(tier || "").toLowerCase();
  const tierPricing = DURATION_PRICING_CENTS[normalizedTier];
  if (!tierPricing) return 0;
  const normalizedMonths = normalizeDuration(months);
  return tierPricing[normalizedMonths] || tierPricing[1] || 0;
}

function calculatePrice(tier, months) {
  const perMonth = getPricePerMonthCents(tier, months);
  return perMonth * months;
}

function calculateUpgradePrice(serverId, currentLicense, targetTier) {
  if (!currentLicense || !currentLicense.expiresAt) return null;
  const remaining = Math.max(0, Math.ceil((new Date(currentLicense.expiresAt) - new Date()) / 86400000));
  if (remaining <= 0) return null;
  const oldMonthly = getPricePerMonthCents(currentLicense.plan, 1);
  const newMonthly = getPricePerMonthCents(targetTier, 1);
  const diff = newMonthly - oldMonthly;
  if (diff <= 0) return null;
  return Math.max(0, Math.round(diff * (remaining / 30)));
}

function durationPricingInEuro(tier) {
  const normalizedTier = String(tier || "").toLowerCase();
  const tierPricing = DURATION_PRICING_CENTS[normalizedTier];
  if (!tierPricing) return {};
  return Object.fromEntries(
    Object.entries(tierPricing).map(([months, cents]) => [months, (cents / 100).toFixed(2)])
  );
}

function formatEuroCentsDe(cents) {
  return (cents / 100).toFixed(2).replace(".", ",");
}

function sanitizeOfferCode(rawCode) {
  return String(rawCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 50);
}

function translateOfferReason(reason, language = "de") {
  const lang = String(language || "de").toLowerCase().startsWith("de") ? "de" : "en";
  const map = {
    "coupon_not_found": lang === "de" ? "Gutscheincode nicht gefunden." : "Coupon code not found.",
    "coupon_inactive": lang === "de" ? "Gutscheincode ist nicht aktiv." : "Coupon code is not active.",
    "coupon_expired": lang === "de" ? "Gutscheincode ist abgelaufen." : "Coupon code has expired.",
    "coupon_max_uses": lang === "de" ? "Gutscheincode wurde bereits zu oft eingeloest." : "Coupon code has already been redeemed too many times.",
    "coupon_wrong_tier": lang === "de" ? "Gutscheincode gilt nicht fuer diesen Plan." : "Coupon code is not valid for this plan.",
    "referral_not_found": lang === "de" ? "Empfehlungscode nicht gefunden." : "Referral code not found.",
    "referral_inactive": lang === "de" ? "Empfehlungscode ist nicht aktiv." : "Referral code is not active.",
    "referral_self": lang === "de" ? "Eigenen Empfehlungscode kann man nicht nutzen." : "You cannot use your own referral code.",
    "referral_wrong_tier": lang === "de" ? "Empfehlungscode gilt nicht fuer diesen Plan." : "Referral code is not valid for this plan.",
  };
  return map[reason] || String(reason || "");
}

// ---- Text ----
function clipText(value, max = 100) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}...` : text;
}

function clampVolume(value) {
  return Math.max(0, Math.min(1, value / 100));
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

// ---- Time / Environment ----
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

// ---- Bitrate ----
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

// ---- Uint8Array ----
function concatUint8Arrays(left, right) {
  if (!left.length) return right;
  if (!right.length) return left;
  const out = new Uint8Array(left.length + right.length);
  out.set(left, 0);
  out.set(right, left.length);
  return out;
}

// ---- Runtime Constants (parseEnvInt-based) ----
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

export {
  // Constants
  YEARLY_DISCOUNT_MONTHS,
  PRO_TRIAL_MONTHS,
  DEFAULT_EXPIRY_REMINDER_DAYS,
  DURATION_OPTIONS,
  DURATION_PRICING_CENTS,
  TIERS,
  TIER_RANK,
  TRUST_PROXY_HEADERS,
  MIME_TYPES,
  // Validation
  normalizeDuration,
  isValidEmailAddress,
  isProTrialEnabled,
  parseExpiryReminderDays,
  // Pricing
  getPricePerMonthCents,
  calculatePrice,
  calculateUpgradePrice,
  durationPricingInEuro,
  formatEuroCentsDe,
  sanitizeOfferCode,
  translateOfferReason,
  // Text
  clipText,
  clampVolume,
  sanitizeUrlForLog,
  splitTextForDiscord,
  concatUint8Arrays,
  // Time / Env
  waitMs,
  parseEnvInt,
  applyJitter,
  isLikelyNetworkFailureLine,
  // Bitrate
  parseBitrateKbps,
  buildTranscodeProfile,
  // Runtime Constants
  STREAM_STABLE_RESET_MS,
  STREAM_RESTART_BASE_MS,
  STREAM_RESTART_MAX_MS,
  STREAM_PROCESS_FAILURE_WINDOW_MS,
  STREAM_ERROR_COOLDOWN_THRESHOLD,
  STREAM_ERROR_COOLDOWN_MS,
  VOICE_RECONNECT_MAX_MS,
  VOICE_RECONNECT_EXP_STEPS,
  NETWORK_COOLDOWN_BASE_MS,
  NETWORK_COOLDOWN_MAX_MS,
  NETWORK_FAILURE_RESET_MS,
  NOW_PLAYING_ENABLED,
  NOW_PLAYING_POLL_MS,
  NOW_PLAYING_FETCH_TIMEOUT_MS,
  NOW_PLAYING_MAX_METAINT_BYTES,
  NOW_PLAYING_COVER_ENABLED,
  NOW_PLAYING_COVER_TIMEOUT_MS,
  NOW_PLAYING_COVER_CACHE_TTL_MS,
  SONG_HISTORY_ENABLED,
  SONG_HISTORY_MAX_PER_GUILD,
  SONG_HISTORY_DEDUPE_WINDOW_MS,
  EVENT_SCHEDULER_ENABLED,
  EVENT_SCHEDULER_POLL_MS,
  EVENT_SCHEDULER_RETRY_MS,
};
