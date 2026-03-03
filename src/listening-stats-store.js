import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.resolve(__dirname, "..", "listening-stats.json");
const BACKUP_FILE = `${STORE_FILE}.bak`;

function emptyState() {
  return {
    version: 1,
    guilds: {},
  };
}

function normalizeGuildId(guildId) {
  const value = String(guildId || "").trim();
  return /^\d{17,22}$/.test(value) ? value : null;
}

function normalizeText(value, maxLen = 160) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

function normalizeCount(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeTimestamp(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeBucketMap(source, maxEntries = 200) {
  const input = source && typeof source === "object" ? source : {};
  const output = {};
  for (const [key, rawValue] of Object.entries(input)) {
    const normalizedKey = normalizeText(key, 120);
    if (!normalizedKey) continue;
    output[normalizedKey] = normalizeCount(rawValue);
  }

  const sorted = Object.entries(output)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxEntries);
  return Object.fromEntries(sorted);
}

function normalizeTextMap(source, maxEntries = 200) {
  const input = source && typeof source === "object" ? source : {};
  const output = {};
  for (const [key, rawValue] of Object.entries(input)) {
    const normalizedKey = normalizeText(key, 120);
    const normalizedValue = normalizeText(rawValue, 120);
    if (!normalizedKey || !normalizedValue) continue;
    output[normalizedKey] = normalizedValue;
  }

  return Object.fromEntries(Object.entries(output).slice(0, maxEntries));
}

function normalizeHourMap(source) {
  const output = {};
  for (let hour = 0; hour < 24; hour += 1) {
    output[String(hour)] = 0;
  }
  const input = source && typeof source === "object" ? source : {};
  for (const [rawHour, rawValue] of Object.entries(input)) {
    const hour = Number.parseInt(String(rawHour || ""), 10);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue;
    output[String(hour)] = normalizeCount(rawValue);
  }
  return output;
}

function normalizeGuildStats(raw, guildId) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    guildId,
    totalStarts: normalizeCount(source.totalStarts),
    peakListeners: normalizeCount(source.peakListeners),
    lastStartedAt: normalizeTimestamp(source.lastStartedAt),
    lastCommandAt: normalizeTimestamp(source.lastCommandAt),
    stationStarts: normalizeBucketMap(source.stationStarts, 200),
    stationNames: normalizeTextMap(source.stationNames, 200),
    voiceChannels: normalizeBucketMap(source.voiceChannels, 120),
    commands: normalizeBucketMap(source.commands, 120),
    hours: normalizeHourMap(source.hours),
  };
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const guilds = {};
  const rawGuilds = source.guilds && typeof source.guilds === "object" ? source.guilds : {};
  for (const [rawGuildId, rawGuildStats] of Object.entries(rawGuilds)) {
    const guildId = normalizeGuildId(rawGuildId);
    if (!guildId) continue;
    guilds[guildId] = normalizeGuildStats(rawGuildStats, guildId);
  }
  return { version: 1, guilds };
}

function readStateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

let stateCache = null;

function ensureState() {
  if (stateCache) return stateCache;
  stateCache = readStateFile(STORE_FILE) || readStateFile(BACKUP_FILE) || emptyState();
  return stateCache;
}

function saveState() {
  const state = ensureState();
  const tmpFile = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(state, null, 2) + "\n";
  try {
    if (fs.existsSync(STORE_FILE)) {
      try { fs.copyFileSync(STORE_FILE, BACKUP_FILE); } catch {}
    }
    fs.writeFileSync(tmpFile, payload, "utf8");
    try {
      fs.renameSync(tmpFile, STORE_FILE);
    } catch {
      fs.writeFileSync(STORE_FILE, payload, "utf8");
    }
  } finally {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
  }
}

function ensureGuildStats(guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return null;
  const state = ensureState();
  if (!state.guilds[gid]) {
    state.guilds[gid] = normalizeGuildStats({}, gid);
  }
  return state.guilds[gid];
}

function incrementBucket(map, key, amount = 1, maxLen = 120) {
  const normalizedKey = normalizeText(key, maxLen);
  if (!normalizedKey) return;
  map[normalizedKey] = normalizeCount(map[normalizedKey]) + Math.max(1, normalizeCount(amount) || 1);
}

function buildStationBucketKey(stationKey, stationName) {
  return normalizeText(stationName, 120) || normalizeText(stationKey, 120) || "unknown";
}

function resolveHourBucket(timestampMs) {
  const value = Number.isFinite(Number(timestampMs)) && Number(timestampMs) > 0 ? Number(timestampMs) : Date.now();
  return new Date(value).getHours();
}

export function recordCommandUsage(guildId, commandName, timestampMs = Date.now()) {
  const stats = ensureGuildStats(guildId);
  if (!stats) return { saved: false, reason: "invalid-guild" };
  incrementBucket(stats.commands, String(commandName || "").trim().toLowerCase(), 1, 80);
  stats.lastCommandAt = Number(timestampMs) || Date.now();
  saveState();
  return { saved: true };
}

export function recordStationStart(guildId, {
  stationKey = "",
  stationName = "",
  channelId = "",
  listenerCount = 0,
  timestampMs = Date.now(),
} = {}) {
  const stats = ensureGuildStats(guildId);
  if (!stats) return { saved: false, reason: "invalid-guild" };

  const atMs = Number(timestampMs) || Date.now();
  stats.totalStarts += 1;
  stats.lastStartedAt = atMs;
  incrementBucket(stats.stationStarts, buildStationBucketKey(stationKey, stationName), 1, 120);
  if (stationKey) {
    const stationKeyText = normalizeText(stationKey, 120);
    if (stationKeyText && stationName) {
      stats.stationNames[stationKeyText] = normalizeText(stationName, 120) || stationKeyText;
    }
  }
  incrementBucket(stats.voiceChannels, channelId, 1, 40);
  const hourBucket = String(resolveHourBucket(atMs));
  stats.hours[hourBucket] = normalizeCount(stats.hours[hourBucket]) + 1;
  stats.peakListeners = Math.max(stats.peakListeners, normalizeCount(listenerCount));
  saveState();
  return { saved: true };
}

export function recordListenerSample(guildId, listenerCount, timestampMs = Date.now()) {
  const stats = ensureGuildStats(guildId);
  if (!stats) return { saved: false, reason: "invalid-guild" };
  stats.peakListeners = Math.max(stats.peakListeners, normalizeCount(listenerCount));
  stats.lastCommandAt = Math.max(stats.lastCommandAt, Number(timestampMs) || Date.now());
  saveState();
  return { saved: true };
}

export function getGuildListeningStats(guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return null;
  const state = ensureState();
  const stats = state.guilds[gid];
  return stats ? JSON.parse(JSON.stringify(stats)) : normalizeGuildStats({}, gid);
}

export function getTopGuildsByActivity(limit = 5) {
  const safeLimit = Math.max(1, Math.min(20, Number.parseInt(String(limit || 5), 10) || 5));
  const state = ensureState();
  return Object.values(state.guilds)
    .sort((a, b) => b.totalStarts - a.totalStarts || b.peakListeners - a.peakListeners || String(a.guildId).localeCompare(String(b.guildId)))
    .slice(0, safeLimit)
    .map((stats) => JSON.parse(JSON.stringify(stats)));
}
