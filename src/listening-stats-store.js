// ============================================================
// OmniFM: Listening Stats Store (MongoDB + JSON Fallback)
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, isConnected } from "./lib/db.js";
import { log } from "./lib/logging.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.resolve(__dirname, "..", "listening-stats.json");
const BACKUP_FILE = `${STORE_FILE}.bak`;

// ============================================================
// JSON Fallback (legacy, used when MongoDB is unavailable)
// ============================================================
function emptyState() {
  return { version: 2, guilds: {} };
}

function normalizeGuildId(guildId) {
  const value = String(guildId || "").trim();
  return /^\d{17,22}$/.test(value) ? value : null;
}

function normalizeText(value, maxLen = 160) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLen) : null;
}

function normalizeCount(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
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
  return Object.fromEntries(
    Object.entries(output)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, maxEntries)
  );
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
  for (let h = 0; h < 24; h++) output[String(h)] = 0;
  const input = source && typeof source === "object" ? source : {};
  for (const [rawH, rawV] of Object.entries(input)) {
    const hour = Number.parseInt(String(rawH || ""), 10);
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
      output[String(hour)] = normalizeCount(rawV);
    }
  }
  return output;
}

function normalizeDayOfWeekMap(source) {
  const output = {};
  for (let d = 0; d < 7; d++) output[String(d)] = 0;
  const input = source && typeof source === "object" ? source : {};
  for (const [rawD, rawV] of Object.entries(input)) {
    const day = Number.parseInt(String(rawD || ""), 10);
    if (Number.isFinite(day) && day >= 0 && day <= 6) {
      output[String(day)] = normalizeCount(rawV);
    }
  }
  return output;
}

function normalizeGuildStats(raw, guildId) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    guildId,
    // Core counters
    totalStarts: normalizeCount(s.totalStarts),
    totalStops: normalizeCount(s.totalStops),
    totalListeningMs: normalizeCount(s.totalListeningMs),
    totalSessions: normalizeCount(s.totalSessions),
    peakListeners: normalizeCount(s.peakListeners),
    peakConcurrentStreams: normalizeCount(s.peakConcurrentStreams),
    // Timestamps
    lastStartedAt: normalizeTimestamp(s.lastStartedAt),
    lastStoppedAt: normalizeTimestamp(s.lastStoppedAt),
    lastCommandAt: normalizeTimestamp(s.lastCommandAt),
    firstSeenAt: normalizeTimestamp(s.firstSeenAt),
    // Breakdown maps
    stationStarts: normalizeBucketMap(s.stationStarts, 200),
    stationListeningMs: normalizeBucketMap(s.stationListeningMs, 200),
    stationNames: normalizeTextMap(s.stationNames, 200),
    voiceChannels: normalizeBucketMap(s.voiceChannels, 120),
    commands: normalizeBucketMap(s.commands, 120),
    hours: normalizeHourMap(s.hours),
    daysOfWeek: normalizeDayOfWeekMap(s.daysOfWeek),
    // Connection health
    totalConnections: normalizeCount(s.totalConnections),
    totalReconnects: normalizeCount(s.totalReconnects),
    totalConnectionErrors: normalizeCount(s.totalConnectionErrors),
    avgSessionMs: normalizeCount(s.avgSessionMs),
    longestSessionMs: normalizeCount(s.longestSessionMs),
  };
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const guilds = {};
  const rawGuilds = source.guilds && typeof source.guilds === "object" ? source.guilds : {};
  for (const [rawGuildId, rawGuildStats] of Object.entries(rawGuilds)) {
    const gid = normalizeGuildId(rawGuildId);
    if (!gid) continue;
    guilds[gid] = normalizeGuildStats(rawGuildStats, gid);
  }
  return { version: 2, guilds };
}

// ---- JSON file I/O ----
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

function saveStateToFile() {
  const state = ensureState();
  const tmpFile = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(state, null, 2) + "\n";
  try {
    if (fs.existsSync(STORE_FILE)) {
      try { fs.copyFileSync(STORE_FILE, BACKUP_FILE); } catch {}
    }
    fs.writeFileSync(tmpFile, payload, "utf8");
    try { fs.renameSync(tmpFile, STORE_FILE); } catch { fs.writeFileSync(STORE_FILE, payload, "utf8"); }
  } finally {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
  }
}

function ensureGuildStatsLocal(guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return null;
  const state = ensureState();
  if (!state.guilds[gid]) state.guilds[gid] = normalizeGuildStats({}, gid);
  return state.guilds[gid];
}

function incrementBucket(map, key, amount = 1, maxLen = 120) {
  const k = normalizeText(key, maxLen);
  if (!k) return;
  map[k] = normalizeCount(map[k]) + Math.max(1, normalizeCount(amount) || 1);
}

function buildStationBucketKey(stationKey, stationName) {
  return normalizeText(stationName, 120) || normalizeText(stationKey, 120) || "unknown";
}

function resolveHourBucket(timestampMs) {
  const value = Number.isFinite(Number(timestampMs)) && Number(timestampMs) > 0 ? Number(timestampMs) : Date.now();
  return new Date(value).getHours();
}

function resolveDayOfWeekBucket(timestampMs) {
  const value = Number.isFinite(Number(timestampMs)) && Number(timestampMs) > 0 ? Number(timestampMs) : Date.now();
  return new Date(value).getDay();
}

function todayDateString(timestampMs) {
  const d = new Date(Number.isFinite(Number(timestampMs)) && Number(timestampMs) > 0 ? Number(timestampMs) : Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ============================================================
// MongoDB Operations
// ============================================================
function useMongo() {
  return isConnected() && getDb() !== null;
}

async function mongoSafe(fn) {
  if (!useMongo()) return null;
  try {
    return await fn(getDb());
  } catch (err) {
    log("WARN", `MongoDB Stats-Operation fehlgeschlagen: ${err?.message || err}`);
    return null;
  }
}

// ---- Write to both MongoDB + JSON ----
async function persistGuildStats(guildId, stats) {
  // Always write JSON fallback
  saveStateToFile();

  // Write to MongoDB if available
  await mongoSafe(async (db) => {
    const doc = { ...stats };
    delete doc._id;
    await db.collection("guild_stats").updateOne(
      { guildId },
      { $set: doc, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  });
}

// ============================================================
// Active Sessions Tracking (in-memory for active, MongoDB for completed)
// ============================================================
const activeSessions = new Map(); // key: `${guildId}:${botId}` -> session object

export function startListeningSession(guildId, {
  botId = "",
  stationKey = "",
  stationName = "",
  channelId = "",
  listenerCount = 0,
} = {}) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return null;

  const sessionKey = `${gid}:${botId || "default"}`;
  const now = Date.now();

  // End any existing session for this bot+guild
  endListeningSession(gid, { botId });

  const session = {
    guildId: gid,
    botId: String(botId || "").trim(),
    stationKey: normalizeText(stationKey, 120) || "unknown",
    stationName: normalizeText(stationName, 120) || normalizeText(stationKey, 120) || "unknown",
    channelId: String(channelId || "").trim(),
    startedAt: now,
    peakListeners: normalizeCount(listenerCount),
    listenerSamples: [{ t: now, n: normalizeCount(listenerCount) }],
  };

  activeSessions.set(sessionKey, session);
  return session;
}

export function updateSessionListeners(guildId, { botId = "", listenerCount = 0 } = {}) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return;

  const sessionKey = `${gid}:${botId || "default"}`;
  const session = activeSessions.get(sessionKey);
  if (!session) return;

  const count = normalizeCount(listenerCount);
  session.peakListeners = Math.max(session.peakListeners, count);

  // Sample at most every 60s
  const lastSample = session.listenerSamples[session.listenerSamples.length - 1];
  if (!lastSample || (Date.now() - lastSample.t) >= 60_000) {
    session.listenerSamples.push({ t: Date.now(), n: count });
    // Keep max 1440 samples (24h at 1/min)
    if (session.listenerSamples.length > 1440) {
      session.listenerSamples = session.listenerSamples.slice(-1440);
    }
  }
}

export async function endListeningSession(guildId, { botId = "" } = {}) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return null;

  const sessionKey = `${gid}:${botId || "default"}`;
  const session = activeSessions.get(sessionKey);
  if (!session) return null;

  activeSessions.delete(sessionKey);

  const endedAt = Date.now();
  const durationMs = Math.max(0, endedAt - session.startedAt);

  // Compute average listeners
  const samples = session.listenerSamples || [];
  const avgListeners = samples.length > 0
    ? Math.round(samples.reduce((sum, s) => sum + s.n, 0) / samples.length)
    : 0;

  const completedSession = {
    guildId: gid,
    botId: session.botId,
    stationKey: session.stationKey,
    stationName: session.stationName,
    channelId: session.channelId,
    startedAt: new Date(session.startedAt),
    endedAt: new Date(endedAt),
    durationMs,
    peakListeners: session.peakListeners,
    avgListeners,
  };

  // Update aggregate stats with duration
  const stats = ensureGuildStatsLocal(gid);
  if (stats) {
    stats.totalListeningMs += durationMs;
    stats.totalSessions += 1;
    stats.totalStops += 1;
    stats.lastStoppedAt = endedAt;
    stats.longestSessionMs = Math.max(stats.longestSessionMs || 0, durationMs);
    // Rolling average session duration
    if (stats.totalSessions > 0) {
      stats.avgSessionMs = Math.round(stats.totalListeningMs / stats.totalSessions);
    }
    incrementBucket(stats.stationListeningMs, session.stationKey, durationMs, 120);
  }

  // Save to MongoDB
  await mongoSafe(async (db) => {
    // Store completed session (without raw samples for space)
    await db.collection("listening_sessions").insertOne(completedSession);

    // Update daily stats
    const dateStr = todayDateString(session.startedAt);
    await db.collection("daily_stats").updateOne(
      { guildId: gid, date: dateStr },
      {
        $inc: {
          totalStarts: 0, // don't double-count, just ensure doc exists
          totalListeningMs: durationMs,
          totalSessions: 1,
        },
        $max: { peakListeners: session.peakListeners },
        $setOnInsert: { guildId: gid, date: dateStr, createdAt: new Date() },
      },
      { upsert: true }
    );
  });

  // Persist to file
  saveStateToFile();

  return completedSession;
}

export function getActiveSessionsForGuild(guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return [];
  const result = [];
  for (const [key, session] of activeSessions.entries()) {
    if (session.guildId === gid) {
      result.push({
        ...session,
        currentDurationMs: Date.now() - session.startedAt,
        currentListeners: session.listenerSamples.length > 0
          ? session.listenerSamples[session.listenerSamples.length - 1].n
          : 0,
      });
    }
  }
  return result;
}

// ============================================================
// Public API - Recording Functions
// ============================================================
export function recordCommandUsage(guildId, commandName, timestampMs = Date.now()) {
  const stats = ensureGuildStatsLocal(guildId);
  if (!stats) return { saved: false, reason: "invalid-guild" };
  incrementBucket(stats.commands, String(commandName || "").trim().toLowerCase(), 1, 80);
  stats.lastCommandAt = Number(timestampMs) || Date.now();
  saveStateToFile();

  // Async MongoDB write
  mongoSafe(async (db) => {
    const dateStr = todayDateString(timestampMs);
    const cmd = String(commandName || "").trim().toLowerCase();
    await db.collection("guild_stats").updateOne(
      { guildId: normalizeGuildId(guildId) },
      {
        $inc: { [`commands.${cmd}`]: 1 },
        $set: { lastCommandAt: Number(timestampMs) || Date.now() },
        $setOnInsert: { guildId: normalizeGuildId(guildId), createdAt: new Date() },
      },
      { upsert: true }
    );
  });

  return { saved: true };
}

export function recordStationStart(guildId, {
  stationKey = "",
  stationName = "",
  channelId = "",
  listenerCount = 0,
  timestampMs = Date.now(),
  botId = "",
} = {}) {
  const stats = ensureGuildStatsLocal(guildId);
  if (!stats) return { saved: false, reason: "invalid-guild" };

  const atMs = Number(timestampMs) || Date.now();
  const gid = normalizeGuildId(guildId);

  // Core counters
  stats.totalStarts += 1;
  stats.lastStartedAt = atMs;
  if (!stats.firstSeenAt) stats.firstSeenAt = atMs;

  // Station breakdown
  const stationBucketKey = buildStationBucketKey(stationKey, stationName);
  incrementBucket(stats.stationStarts, stationBucketKey, 1, 120);
  if (stationKey) {
    const skText = normalizeText(stationKey, 120);
    if (skText && stationName) {
      stats.stationNames[skText] = normalizeText(stationName, 120) || skText;
    }
  }

  // Channel tracking
  incrementBucket(stats.voiceChannels, channelId, 1, 40);

  // Time distribution
  const hourBucket = String(resolveHourBucket(atMs));
  stats.hours[hourBucket] = normalizeCount(stats.hours[hourBucket]) + 1;
  const dayBucket = String(resolveDayOfWeekBucket(atMs));
  stats.daysOfWeek[dayBucket] = normalizeCount(stats.daysOfWeek[dayBucket]) + 1;

  // Peak listeners
  stats.peakListeners = Math.max(stats.peakListeners, normalizeCount(listenerCount));

  saveStateToFile();

  // Start a listening session
  startListeningSession(guildId, { botId, stationKey, stationName, channelId, listenerCount });

  // Async MongoDB write
  mongoSafe(async (db) => {
    const dateStr = todayDateString(atMs);
    await db.collection("daily_stats").updateOne(
      { guildId: gid, date: dateStr },
      {
        $inc: { totalStarts: 1 },
        $max: { peakListeners: normalizeCount(listenerCount) },
        $setOnInsert: { guildId: gid, date: dateStr, createdAt: new Date(), totalListeningMs: 0, totalSessions: 0 },
      },
      { upsert: true }
    );
    await db.collection("guild_stats").updateOne(
      { guildId: gid },
      {
        $inc: { totalStarts: 1, [`stationStarts.${stationBucketKey}`]: 1, [`hours.${hourBucket}`]: 1, [`daysOfWeek.${dayBucket}`]: 1 },
        $max: { peakListeners: normalizeCount(listenerCount) },
        $set: { lastStartedAt: atMs },
        $setOnInsert: { guildId: gid, createdAt: new Date(), firstSeenAt: atMs },
      },
      { upsert: true }
    );
  });

  return { saved: true };
}

export function recordStationStop(guildId, { botId = "" } = {}) {
  endListeningSession(guildId, { botId });
}

export function recordListenerSample(guildId, listenerCount, timestampMs = Date.now()) {
  const stats = ensureGuildStatsLocal(guildId);
  if (!stats) return { saved: false, reason: "invalid-guild" };
  const count = normalizeCount(listenerCount);
  stats.peakListeners = Math.max(stats.peakListeners, count);
  stats.lastCommandAt = Math.max(stats.lastCommandAt, Number(timestampMs) || Date.now());
  saveStateToFile();

  // Update active session
  for (const [, session] of activeSessions.entries()) {
    if (session.guildId === normalizeGuildId(guildId)) {
      updateSessionListeners(guildId, { botId: session.botId, listenerCount: count });
    }
  }

  // Async MongoDB snapshot
  mongoSafe(async (db) => {
    const gid = normalizeGuildId(guildId);
    await db.collection("listener_snapshots").insertOne({
      guildId: gid,
      listeners: count,
      timestamp: new Date(Number(timestampMs) || Date.now()),
    });
    await db.collection("guild_stats").updateOne(
      { guildId: gid },
      {
        $max: { peakListeners: count },
        $setOnInsert: { guildId: gid, createdAt: new Date() },
      },
      { upsert: true }
    );
  });

  return { saved: true };
}

export function recordConnectionEvent(guildId, {
  botId = "",
  eventType = "connect",
  channelId = "",
  details = "",
} = {}) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return;

  const stats = ensureGuildStatsLocal(guildId);
  if (stats) {
    if (eventType === "connect") stats.totalConnections = (stats.totalConnections || 0) + 1;
    else if (eventType === "reconnect") stats.totalReconnects = (stats.totalReconnects || 0) + 1;
    else if (eventType === "error") stats.totalConnectionErrors = (stats.totalConnectionErrors || 0) + 1;
    saveStateToFile();
  }

  mongoSafe(async (db) => {
    await db.collection("connection_events").insertOne({
      guildId: gid,
      botId: String(botId || "").trim(),
      eventType: String(eventType || "unknown").trim(),
      channelId: String(channelId || "").trim(),
      details: normalizeText(details, 500) || "",
      timestamp: new Date(),
    });
  });
}

// ============================================================
// Public API - Read Functions
// ============================================================
export function getGuildListeningStats(guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return null;
  const state = ensureState();
  const stats = state.guilds[gid];
  const result = stats ? JSON.parse(JSON.stringify(stats)) : normalizeGuildStats({}, gid);

  // Enrich with active sessions
  const activeSess = getActiveSessionsForGuild(gid);
  result.activeSessions = activeSess.length;
  result.activeListeningMs = activeSess.reduce((sum, s) => sum + s.currentDurationMs, 0);
  result.currentTotalListeningMs = result.totalListeningMs + result.activeListeningMs;

  return result;
}

export function getTopGuildsByActivity(limit = 5) {
  const safeLimit = Math.max(1, Math.min(20, Number.parseInt(String(limit || 5), 10) || 5));
  const state = ensureState();
  return Object.values(state.guilds)
    .sort((a, b) => b.totalStarts - a.totalStarts || b.peakListeners - a.peakListeners || String(a.guildId).localeCompare(String(b.guildId)))
    .slice(0, safeLimit)
    .map((stats) => JSON.parse(JSON.stringify(stats)));
}

// ---- MongoDB-only queries for enhanced stats ----
export async function getGuildDailyStats(guildId, days = 30) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return [];

  const result = await mongoSafe(async (db) => {
    return db.collection("daily_stats")
      .find({ guildId: gid })
      .sort({ date: -1 })
      .limit(Math.min(days, 365))
      .toArray();
  });

  if (result) {
    return result.map((doc) => ({
      date: doc.date,
      totalStarts: doc.totalStarts || 0,
      totalListeningMs: doc.totalListeningMs || 0,
      totalSessions: doc.totalSessions || 0,
      peakListeners: doc.peakListeners || 0,
    }));
  }

  // Fallback: no daily data available without MongoDB
  return [];
}

export async function getGuildSessionHistory(guildId, limit = 20) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return [];

  const result = await mongoSafe(async (db) => {
    return db.collection("listening_sessions")
      .find({ guildId: gid })
      .sort({ startedAt: -1 })
      .limit(Math.min(limit, 100))
      .project({ _id: 0 })
      .toArray();
  });

  return result || [];
}

export async function getGuildConnectionHealth(guildId, days = 7) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return { connects: 0, reconnects: 0, errors: 0, events: [] };

  const result = await mongoSafe(async (db) => {
    const since = new Date(Date.now() - days * 86400_000);
    const events = await db.collection("connection_events")
      .find({ guildId: gid, timestamp: { $gte: since } })
      .sort({ timestamp: -1 })
      .limit(100)
      .project({ _id: 0 })
      .toArray();

    const counts = { connects: 0, reconnects: 0, errors: 0 };
    for (const ev of events) {
      if (ev.eventType === "connect") counts.connects++;
      else if (ev.eventType === "reconnect") counts.reconnects++;
      else if (ev.eventType === "error") counts.errors++;
    }

    return { ...counts, events };
  });

  return result || { connects: 0, reconnects: 0, errors: 0, events: [] };
}

export async function getGuildListenerTimeline(guildId, hours = 24) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return [];

  const result = await mongoSafe(async (db) => {
    const since = new Date(Date.now() - hours * 3600_000);
    return db.collection("listener_snapshots")
      .find({ guildId: gid, timestamp: { $gte: since } })
      .sort({ timestamp: 1 })
      .project({ _id: 0, listeners: 1, timestamp: 1 })
      .toArray();
  });

  return result || [];
}

export async function getGlobalStats() {
  // First try MongoDB
  const mongoResult = await mongoSafe(async (db) => {
    const pipeline = [
      {
        $group: {
          _id: null,
          totalGuilds: { $sum: 1 },
          totalStarts: { $sum: "$totalStarts" },
          totalListeningMs: { $sum: "$totalListeningMs" },
          totalSessions: { $sum: "$totalSessions" },
          globalPeakListeners: { $max: "$peakListeners" },
        },
      },
    ];
    const result = await db.collection("guild_stats").aggregate(pipeline).toArray();
    return result[0] || null;
  });

  if (mongoResult) {
    return {
      totalGuilds: mongoResult.totalGuilds || 0,
      totalStarts: mongoResult.totalStarts || 0,
      totalListeningMs: mongoResult.totalListeningMs || 0,
      totalSessions: mongoResult.totalSessions || 0,
      globalPeakListeners: mongoResult.globalPeakListeners || 0,
      totalListeningHours: Math.round((mongoResult.totalListeningMs || 0) / 3_600_000 * 10) / 10,
    };
  }

  // JSON fallback
  const state = ensureState();
  const guilds = Object.values(state.guilds);
  return {
    totalGuilds: guilds.length,
    totalStarts: guilds.reduce((sum, g) => sum + (g.totalStarts || 0), 0),
    totalListeningMs: guilds.reduce((sum, g) => sum + (g.totalListeningMs || 0), 0),
    totalSessions: guilds.reduce((sum, g) => sum + (g.totalSessions || 0), 0),
    globalPeakListeners: Math.max(0, ...guilds.map((g) => g.peakListeners || 0)),
    totalListeningHours: Math.round(guilds.reduce((sum, g) => sum + (g.totalListeningMs || 0), 0) / 3_600_000 * 10) / 10,
  };
}

// ============================================================
// Migration: Import JSON data to MongoDB on first connect
// ============================================================
export async function migrateJsonToMongo() {
  if (!useMongo()) return { migrated: false, reason: "mongodb-not-connected" };

  const db = getDb();
  const existingCount = await db.collection("guild_stats").countDocuments();
  if (existingCount > 0) return { migrated: false, reason: "data-exists" };

  const state = ensureState();
  const guilds = Object.values(state.guilds);
  if (guilds.length === 0) return { migrated: false, reason: "no-json-data" };

  let migrated = 0;
  for (const guildStats of guilds) {
    try {
      const doc = { ...guildStats };
      delete doc._id;
      doc.createdAt = new Date();
      doc.migratedFromJson = true;
      await db.collection("guild_stats").updateOne(
        { guildId: doc.guildId },
        { $set: doc },
        { upsert: true }
      );
      migrated++;
    } catch (err) {
      log("WARN", `Migration Guild ${guildStats.guildId} fehlgeschlagen: ${err?.message || err}`);
    }
  }

  log("INFO", `JSON -> MongoDB Migration: ${migrated}/${guilds.length} Guilds migriert.`);
  return { migrated: true, count: migrated, total: guilds.length };
}
