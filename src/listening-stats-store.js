import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.resolve(__dirname, "..", "listening-stats.json");
const BACKUP_FILE = `${STORE_FILE}.bak`;

const MAX_STATION_ROWS = 400;
const MAX_CHANNEL_ROWS = 200;
const MAX_DAILY_ROWS = 550;

function emptyState() {
  return {
    version: 2,
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

function normalizeSeconds(value) {
  const parsed = Number.parseFloat(String(value || ""));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.max(0, Math.floor(parsed));
}

function normalizeTimestamp(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function buildLocalDayKey(timestampMs) {
  const value = Number.isFinite(Number(timestampMs)) && Number(timestampMs) > 0 ? Number(timestampMs) : Date.now();
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDayKeyToMs(dayKey) {
  const value = String(dayKey || "").trim();
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return 0;
  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return 0;
  return new Date(year, month - 1, day).getTime();
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

function normalizeHourSecondsMap(source) {
  const output = {};
  for (let hour = 0; hour < 24; hour += 1) {
    output[String(hour)] = 0;
  }
  const input = source && typeof source === "object" ? source : {};
  for (const [rawHour, rawValue] of Object.entries(input)) {
    const hour = Number.parseInt(String(rawHour || ""), 10);
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue;
    output[String(hour)] = normalizeSeconds(rawValue);
  }
  return output;
}

function normalizeStationStatsRow(rawValue, fallbackKey = "") {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  const key = normalizeText(source.key || fallbackKey, 120);
  const name = normalizeText(source.name || source.stationName || fallbackKey, 120) || key || "unknown";
  return {
    key: key || name,
    name,
    totalStarts: normalizeCount(source.totalStarts ?? source.starts),
    totalStreamSeconds: normalizeSeconds(source.totalStreamSeconds ?? source.streamSeconds),
    totalListenerSeconds: normalizeSeconds(source.totalListenerSeconds ?? source.listenerSeconds),
    totalActiveSeconds: normalizeSeconds(source.totalActiveSeconds ?? source.activeSeconds),
    peakListeners: normalizeCount(source.peakListeners),
    lastStartedAt: normalizeTimestamp(source.lastStartedAt),
    lastListenerAt: normalizeTimestamp(source.lastListenerAt),
  };
}

function normalizeStationStatsMap(source, maxEntries = MAX_STATION_ROWS) {
  const input = source && typeof source === "object" ? source : {};
  const rows = [];
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const row = normalizeStationStatsRow(rawValue, rawKey);
    if (!row.key) continue;
    rows.push(row);
  }
  rows.sort((a, b) =>
    b.totalListenerSeconds - a.totalListenerSeconds
    || b.totalStarts - a.totalStarts
    || b.peakListeners - a.peakListeners
    || a.name.localeCompare(b.name)
  );
  return Object.fromEntries(rows.slice(0, maxEntries).map((row) => [row.key, row]));
}

function normalizeChannelStatsRow(rawValue, fallbackId = "") {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  const channelId = normalizeText(source.channelId || fallbackId, 40);
  const name = normalizeText(source.name || source.channelName || fallbackId, 120) || channelId || "Voice";
  return {
    channelId: channelId || name,
    name,
    totalStarts: normalizeCount(source.totalStarts ?? source.starts),
    totalStreamSeconds: normalizeSeconds(source.totalStreamSeconds ?? source.streamSeconds),
    totalListenerSeconds: normalizeSeconds(source.totalListenerSeconds ?? source.listenerSeconds),
    totalActiveSeconds: normalizeSeconds(source.totalActiveSeconds ?? source.activeSeconds),
    peakListeners: normalizeCount(source.peakListeners),
    lastStartedAt: normalizeTimestamp(source.lastStartedAt),
    lastListenerAt: normalizeTimestamp(source.lastListenerAt),
  };
}

function normalizeChannelStatsMap(source, maxEntries = MAX_CHANNEL_ROWS) {
  const input = source && typeof source === "object" ? source : {};
  const rows = [];
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const row = normalizeChannelStatsRow(rawValue, rawKey);
    if (!row.channelId) continue;
    rows.push(row);
  }
  rows.sort((a, b) =>
    b.totalListenerSeconds - a.totalListenerSeconds
    || b.totalStarts - a.totalStarts
    || b.peakListeners - a.peakListeners
    || a.name.localeCompare(b.name)
  );
  return Object.fromEntries(rows.slice(0, maxEntries).map((row) => [row.channelId, row]));
}

function normalizeDailyStatsRow(rawValue, fallbackDay = "") {
  const source = rawValue && typeof rawValue === "object" ? rawValue : {};
  const day = normalizeText(source.day || fallbackDay, 10);
  return {
    day,
    starts: normalizeCount(source.starts),
    streamSeconds: normalizeSeconds(source.streamSeconds),
    listenerSeconds: normalizeSeconds(source.listenerSeconds),
    activeSeconds: normalizeSeconds(source.activeSeconds),
    peakListeners: normalizeCount(source.peakListeners),
  };
}

function normalizeDailyStatsMap(source, maxEntries = MAX_DAILY_ROWS) {
  const input = source && typeof source === "object" ? source : {};
  const rows = [];
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const row = normalizeDailyStatsRow(rawValue, rawKey);
    if (!row.day || parseDayKeyToMs(row.day) <= 0) continue;
    rows.push(row);
  }
  rows.sort((a, b) => parseDayKeyToMs(b.day) - parseDayKeyToMs(a.day));
  return Object.fromEntries(rows.slice(0, maxEntries).map((row) => [row.day, row]));
}

function normalizeGuildStats(raw, guildId) {
  const source = raw && typeof raw === "object" ? raw : {};
  const stationStarts = normalizeBucketMap(source.stationStarts, 200);
  const stationNames = normalizeTextMap(source.stationNames, 200);
  const voiceChannels = normalizeBucketMap(source.voiceChannels, 120);
  const stationStats = normalizeStationStatsMap(source.stationStats, MAX_STATION_ROWS);
  const channelStats = normalizeChannelStatsMap(source.channelStats, MAX_CHANNEL_ROWS);
  const dailyStats = normalizeDailyStatsMap(source.dailyStats, MAX_DAILY_ROWS);

  if (!Object.keys(stationStats).length) {
    for (const [bucketName, starts] of Object.entries(stationStarts)) {
      stationStats[bucketName] = normalizeStationStatsRow({
        key: bucketName,
        name: bucketName,
        totalStarts: starts,
      }, bucketName);
    }
  }

  if (!Object.keys(channelStats).length) {
    for (const [channelId, starts] of Object.entries(voiceChannels)) {
      channelStats[channelId] = normalizeChannelStatsRow({
        channelId,
        name: channelId,
        totalStarts: starts,
      }, channelId);
    }
  }

  return {
    guildId,
    totalStarts: normalizeCount(source.totalStarts),
    totalStreamSeconds: normalizeSeconds(source.totalStreamSeconds),
    totalListenerSeconds: normalizeSeconds(source.totalListenerSeconds),
    totalActiveSeconds: normalizeSeconds(source.totalActiveSeconds),
    peakListeners: normalizeCount(source.peakListeners),
    lastStartedAt: normalizeTimestamp(source.lastStartedAt),
    lastCommandAt: normalizeTimestamp(source.lastCommandAt),
    stationStarts,
    stationNames,
    voiceChannels,
    commands: normalizeBucketMap(source.commands, 120),
    hours: normalizeHourMap(source.hours),
    hourListenerSeconds: normalizeHourSecondsMap(source.hourListenerSeconds),
    stationStats,
    channelStats,
    dailyStats,
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
  return { version: 2, guilds };
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

function ensureStationStats(stats, stationKey, stationName) {
  const key = normalizeText(stationKey, 120) || normalizeText(stationName, 120) || "unknown";
  if (!stats.stationStats[key]) {
    stats.stationStats[key] = normalizeStationStatsRow({
      key,
      name: stationName || key,
    }, key);
  } else if (stationName) {
    stats.stationStats[key].name = normalizeText(stationName, 120) || stats.stationStats[key].name || key;
  }
  return stats.stationStats[key];
}

function ensureChannelStats(stats, channelId, channelName) {
  const key = normalizeText(channelId, 40);
  if (!key) return null;
  if (!stats.channelStats[key]) {
    stats.channelStats[key] = normalizeChannelStatsRow({
      channelId: key,
      name: channelName || key,
    }, key);
  } else if (channelName) {
    stats.channelStats[key].name = normalizeText(channelName, 120) || stats.channelStats[key].name || key;
  }
  return stats.channelStats[key];
}

function ensureDailyStats(stats, timestampMs) {
  const day = buildLocalDayKey(timestampMs);
  if (!stats.dailyStats[day]) {
    stats.dailyStats[day] = normalizeDailyStatsRow({ day }, day);
  }
  return stats.dailyStats[day];
}

function trimGuildStats(stats) {
  stats.stationStats = normalizeStationStatsMap(stats.stationStats, MAX_STATION_ROWS);
  stats.channelStats = normalizeChannelStatsMap(stats.channelStats, MAX_CHANNEL_ROWS);
  stats.dailyStats = normalizeDailyStatsMap(stats.dailyStats, MAX_DAILY_ROWS);
  stats.stationStarts = normalizeBucketMap(stats.stationStarts, 200);
  stats.stationNames = normalizeTextMap(stats.stationNames, 200);
  stats.voiceChannels = normalizeBucketMap(stats.voiceChannels, 120);
  stats.commands = normalizeBucketMap(stats.commands, 120);
  stats.hours = normalizeHourMap(stats.hours);
  stats.hourListenerSeconds = normalizeHourSecondsMap(stats.hourListenerSeconds);
}

function normalizeListenerSampleInput(rawSample, legacyTimestampMs = Date.now()) {
  if (rawSample && typeof rawSample === "object") {
    return {
      listenerCount: normalizeCount(rawSample.listenerCount),
      stationKey: normalizeText(rawSample.stationKey, 120) || "",
      stationName: normalizeText(rawSample.stationName, 120) || "",
      channelId: normalizeText(rawSample.channelId, 40) || "",
      channelName: normalizeText(rawSample.channelName, 120) || "",
      sampleDurationMs: Math.max(0, Number.parseInt(String(rawSample.sampleDurationMs || 0), 10) || 0),
      timestampMs: Number(rawSample.timestampMs) || Number(legacyTimestampMs) || Date.now(),
    };
  }

  return {
    listenerCount: normalizeCount(rawSample),
    stationKey: "",
    stationName: "",
    channelId: "",
    channelName: "",
    sampleDurationMs: 0,
    timestampMs: Number(legacyTimestampMs) || Date.now(),
  };
}

function toAnalyticsStationRows(stats) {
  const rows = Object.values(stats?.stationStats || {}).map((row) => ({
    key: row.key || row.name || "unknown",
    name: row.name || row.key || "unknown",
    starts: normalizeCount(row.totalStarts),
    streamSeconds: normalizeSeconds(row.totalStreamSeconds),
    listenerSeconds: normalizeSeconds(row.totalListenerSeconds),
    activeSeconds: normalizeSeconds(row.totalActiveSeconds),
    peakListeners: normalizeCount(row.peakListeners),
    lastStartedAt: normalizeTimestamp(row.lastStartedAt),
    lastListenerAt: normalizeTimestamp(row.lastListenerAt),
  }));

  if (rows.length) {
    return rows.sort((a, b) =>
      b.listenerSeconds - a.listenerSeconds
      || b.starts - a.starts
      || b.peakListeners - a.peakListeners
      || a.name.localeCompare(b.name)
    );
  }

  return Object.entries(stats?.stationStarts || {})
    .map(([name, starts]) => ({
      key: name,
      name,
      starts: normalizeCount(starts),
      streamSeconds: 0,
      listenerSeconds: 0,
      activeSeconds: 0,
      peakListeners: 0,
      lastStartedAt: 0,
      lastListenerAt: 0,
    }))
    .sort((a, b) => b.starts - a.starts || a.name.localeCompare(b.name));
}

function toAnalyticsChannelRows(stats) {
  const rows = Object.values(stats?.channelStats || {}).map((row) => ({
    channelId: row.channelId || row.name || "voice",
    name: row.name || row.channelId || "Voice",
    starts: normalizeCount(row.totalStarts),
    streamSeconds: normalizeSeconds(row.totalStreamSeconds),
    listenerSeconds: normalizeSeconds(row.totalListenerSeconds),
    activeSeconds: normalizeSeconds(row.totalActiveSeconds),
    peakListeners: normalizeCount(row.peakListeners),
    lastStartedAt: normalizeTimestamp(row.lastStartedAt),
    lastListenerAt: normalizeTimestamp(row.lastListenerAt),
  }));

  if (rows.length) {
    return rows.sort((a, b) =>
      b.listenerSeconds - a.listenerSeconds
      || b.starts - a.starts
      || b.peakListeners - a.peakListeners
      || a.name.localeCompare(b.name)
    );
  }

  return Object.entries(stats?.voiceChannels || {})
    .map(([channelId, starts]) => ({
      channelId,
      name: channelId,
      starts: normalizeCount(starts),
      streamSeconds: 0,
      listenerSeconds: 0,
      activeSeconds: 0,
      peakListeners: 0,
      lastStartedAt: 0,
      lastListenerAt: 0,
    }))
    .sort((a, b) => b.starts - a.starts || a.name.localeCompare(b.name));
}

function toAnalyticsDailyRows(stats) {
  return Object.values(stats?.dailyStats || {})
    .map((row) => ({
      day: row.day,
      timestampMs: parseDayKeyToMs(row.day),
      starts: normalizeCount(row.starts),
      streamSeconds: normalizeSeconds(row.streamSeconds),
      listenerSeconds: normalizeSeconds(row.listenerSeconds),
      activeSeconds: normalizeSeconds(row.activeSeconds),
      peakListeners: normalizeCount(row.peakListeners),
    }))
    .filter((row) => row.timestampMs > 0)
    .sort((a, b) => b.timestampMs - a.timestampMs);
}

function toAnalyticsHourRows(stats) {
  const hourListenerSeconds = normalizeHourSecondsMap(stats?.hourListenerSeconds);
  const legacyHours = normalizeHourMap(stats?.hours);
  return Object.keys(hourListenerSeconds)
    .map((hour) => ({
      hour: Number.parseInt(hour, 10),
      listenerSeconds: normalizeSeconds(hourListenerSeconds[hour]),
      starts: normalizeCount(legacyHours[hour]),
    }))
    .sort((a, b) => b.listenerSeconds - a.listenerSeconds || b.starts - a.starts || a.hour - b.hour);
}

function aggregateDailyRows(rows) {
  return rows.reduce((summary, row) => {
    summary.totalStarts += row.starts;
    summary.totalStreamSeconds += row.streamSeconds;
    summary.totalListenerSeconds += row.listenerSeconds;
    summary.totalActiveSeconds += row.activeSeconds;
    summary.peakListeners = Math.max(summary.peakListeners, row.peakListeners);
    return summary;
  }, {
    totalStarts: 0,
    totalStreamSeconds: 0,
    totalListenerSeconds: 0,
    totalActiveSeconds: 0,
    peakListeners: 0,
  });
}

export function recordCommandUsage(guildId, commandName, timestampMs = Date.now()) {
  const stats = ensureGuildStats(guildId);
  if (!stats) return { saved: false, reason: "invalid-guild" };
  incrementBucket(stats.commands, String(commandName || "").trim().toLowerCase(), 1, 80);
  stats.lastCommandAt = Number(timestampMs) || Date.now();
  trimGuildStats(stats);
  saveState();
  return { saved: true };
}

export function recordStationStart(guildId, {
  stationKey = "",
  stationName = "",
  channelId = "",
  channelName = "",
  listenerCount = 0,
  timestampMs = Date.now(),
} = {}) {
  const stats = ensureGuildStats(guildId);
  if (!stats) return { saved: false, reason: "invalid-guild" };

  const atMs = Number(timestampMs) || Date.now();
  const stationBucketKey = buildStationBucketKey(stationKey, stationName);
  const stationKeyText = normalizeText(stationKey, 120) || stationBucketKey;

  stats.totalStarts += 1;
  stats.lastStartedAt = atMs;
  incrementBucket(stats.stationStarts, stationBucketKey, 1, 120);
  if (stationKeyText && stationName) {
    stats.stationNames[stationKeyText] = normalizeText(stationName, 120) || stationKeyText;
  }
  incrementBucket(stats.voiceChannels, channelId, 1, 40);

  const stationRow = ensureStationStats(stats, stationKeyText, stationName || stationBucketKey);
  stationRow.totalStarts += 1;
  stationRow.lastStartedAt = atMs;
  stationRow.peakListeners = Math.max(stationRow.peakListeners, normalizeCount(listenerCount));

  const channelRow = ensureChannelStats(stats, channelId, channelName);
  if (channelRow) {
    channelRow.totalStarts += 1;
    channelRow.lastStartedAt = atMs;
    channelRow.peakListeners = Math.max(channelRow.peakListeners, normalizeCount(listenerCount));
  }

  const dayRow = ensureDailyStats(stats, atMs);
  dayRow.starts += 1;
  dayRow.peakListeners = Math.max(dayRow.peakListeners, normalizeCount(listenerCount));

  stats.peakListeners = Math.max(stats.peakListeners, normalizeCount(listenerCount));
  trimGuildStats(stats);
  saveState();
  return { saved: true };
}

export function recordListenerSample(guildId, rawSample, timestampMs = Date.now()) {
  const stats = ensureGuildStats(guildId);
  if (!stats) return { saved: false, reason: "invalid-guild" };

  const sample = normalizeListenerSampleInput(rawSample, timestampMs);
  const listenerCount = sample.listenerCount;
  const atMs = sample.timestampMs || Date.now();
  const durationSeconds = Math.max(0, Math.floor(sample.sampleDurationMs / 1000));
  const weightedListenerSeconds = listenerCount > 0 ? listenerCount * durationSeconds : 0;

  stats.peakListeners = Math.max(stats.peakListeners, listenerCount);
  if (durationSeconds > 0) {
    stats.totalStreamSeconds += durationSeconds;
    stats.totalListenerSeconds += weightedListenerSeconds;
    if (listenerCount > 0) {
      stats.totalActiveSeconds += durationSeconds;
      const hourBucket = String(resolveHourBucket(atMs));
      stats.hourListenerSeconds[hourBucket] = normalizeSeconds(stats.hourListenerSeconds[hourBucket]) + weightedListenerSeconds;
    }

    const dayRow = ensureDailyStats(stats, atMs);
    dayRow.streamSeconds += durationSeconds;
    dayRow.listenerSeconds += weightedListenerSeconds;
    if (listenerCount > 0) {
      dayRow.activeSeconds += durationSeconds;
    }
    dayRow.peakListeners = Math.max(dayRow.peakListeners, listenerCount);

    const stationRow = ensureStationStats(stats, sample.stationKey, sample.stationName);
    stationRow.totalStreamSeconds += durationSeconds;
    stationRow.totalListenerSeconds += weightedListenerSeconds;
    if (listenerCount > 0) {
      stationRow.totalActiveSeconds += durationSeconds;
    }
    stationRow.peakListeners = Math.max(stationRow.peakListeners, listenerCount);
    stationRow.lastListenerAt = atMs;

    const channelRow = ensureChannelStats(stats, sample.channelId, sample.channelName);
    if (channelRow) {
      channelRow.totalStreamSeconds += durationSeconds;
      channelRow.totalListenerSeconds += weightedListenerSeconds;
      if (listenerCount > 0) {
        channelRow.totalActiveSeconds += durationSeconds;
      }
      channelRow.peakListeners = Math.max(channelRow.peakListeners, listenerCount);
      channelRow.lastListenerAt = atMs;
    }
  }

  stats.lastCommandAt = Math.max(stats.lastCommandAt, atMs);
  trimGuildStats(stats);
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

export function buildListeningAnalyticsFromStats(statsInput, {
  windowDays = 30,
  stationLimit = 10,
  channelLimit = 8,
  dailyLimit = 30,
} = {}) {
  const stats = normalizeGuildStats(statsInput, statsInput?.guildId || "");
  const safeWindowDays = Math.max(1, Number.parseInt(String(windowDays || 30), 10) || 30);
  const stationRows = toAnalyticsStationRows(stats);
  const channelRows = toAnalyticsChannelRows(stats);
  const dailyRows = toAnalyticsDailyRows(stats);
  const hourRows = toAnalyticsHourRows(stats);
  const cutoffMs = Date.now() - (safeWindowDays * 24 * 60 * 60 * 1000);
  const windowRows = dailyRows.filter((row) => row.timestampMs >= cutoffMs);
  const windowSummary = aggregateDailyRows(windowRows);
  const topDay = [...windowRows].sort((a, b) =>
    b.listenerSeconds - a.listenerSeconds
    || b.starts - a.starts
    || b.peakListeners - a.peakListeners
    || b.timestampMs - a.timestampMs
  )[0] || null;
  const topHour = hourRows[0] || null;
  const topStation = stationRows[0] || null;
  const topChannel = channelRows[0] || null;

  return {
    lifetime: {
      totalStarts: normalizeCount(stats.totalStarts),
      totalStreamSeconds: normalizeSeconds(stats.totalStreamSeconds),
      totalListenerSeconds: normalizeSeconds(stats.totalListenerSeconds),
      totalActiveSeconds: normalizeSeconds(stats.totalActiveSeconds),
      peakListeners: normalizeCount(stats.peakListeners),
      lastStartedAt: normalizeTimestamp(stats.lastStartedAt),
      trackedDays: dailyRows.length,
      stationCount: stationRows.length,
      channelCount: channelRows.length,
    },
    window: {
      days: safeWindowDays,
      totalStarts: windowSummary.totalStarts,
      totalStreamSeconds: windowSummary.totalStreamSeconds,
      totalListenerSeconds: windowSummary.totalListenerSeconds,
      totalActiveSeconds: windowSummary.totalActiveSeconds,
      peakListeners: windowSummary.peakListeners,
      activeDays: windowRows.length,
      topDay,
    },
    topStation,
    topChannel,
    topHour,
    stations: stationRows.slice(0, Math.max(1, stationLimit)),
    allStations: stationRows,
    channels: channelRows.slice(0, Math.max(1, channelLimit)),
    allChannels: channelRows,
    daily: dailyRows.slice(0, Math.max(1, dailyLimit)),
    allDaily: dailyRows,
    hourly: hourRows,
    raw: stats,
  };
}

export function buildGuildListeningAnalytics(guildId, options = {}) {
  const stats = getGuildListeningStats(guildId);
  return buildListeningAnalyticsFromStats(stats, options);
}

export function getTopGuildsByActivity(limit = 5) {
  const safeLimit = Math.max(1, Math.min(20, Number.parseInt(String(limit || 5), 10) || 5));
  const state = ensureState();
  return Object.values(state.guilds)
    .sort((a, b) =>
      normalizeSeconds(b.totalListenerSeconds) - normalizeSeconds(a.totalListenerSeconds)
      || normalizeCount(b.totalStarts) - normalizeCount(a.totalStarts)
      || normalizeCount(b.peakListeners) - normalizeCount(a.peakListeners)
      || String(a.guildId).localeCompare(String(b.guildId))
    )
    .slice(0, safeLimit)
    .map((stats) => JSON.parse(JSON.stringify(stats)));
}
