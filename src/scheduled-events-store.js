import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_FILE = path.resolve(__dirname, "..", "scheduled-events.json");
const SUPPORTED_REPEAT = new Set(["none", "daily", "weekly"]);

function emptyState() {
  return {
    version: 1,
    events: [],
  };
}

function sanitizeId(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
}

function sanitizeDiscordId(raw) {
  const id = String(raw || "").trim();
  return /^\d{17,22}$/.test(id) ? id : null;
}

function sanitizeStationKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 80);
}

function sanitizeRepeat(raw) {
  const repeat = String(raw || "none").trim().toLowerCase();
  return SUPPORTED_REPEAT.has(repeat) ? repeat : "none";
}

function sanitizeText(raw, maxLen = 300) {
  const text = String(raw || "").trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

function sanitizeRunAtMs(raw) {
  const runAtMs = Number.parseInt(String(raw || ""), 10);
  if (!Number.isFinite(runAtMs) || runAtMs <= 0) return null;
  return runAtMs;
}

function sanitizeBoolean(raw, fallback = false) {
  if (raw === undefined || raw === null) return Boolean(fallback);
  if (typeof raw === "boolean") return raw;
  const text = String(raw).trim().toLowerCase();
  if (!text) return Boolean(fallback);
  if (["1", "true", "yes", "on", "ja", "j"].includes(text)) return true;
  if (["0", "false", "no", "off", "nein", "n"].includes(text)) return false;
  return Boolean(fallback);
}

function sanitizeLastRunAtMs(raw) {
  const value = Number.parseInt(String(raw || ""), 10);
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object") return null;

  const id = sanitizeId(raw.id);
  const guildId = sanitizeDiscordId(raw.guildId);
  const voiceChannelId = sanitizeDiscordId(raw.voiceChannelId);
  const stationKey = sanitizeStationKey(raw.stationKey);
  const botId = sanitizeText(raw.botId, 60);
  const name = sanitizeText(raw.name, 120);
  const runAtMs = sanitizeRunAtMs(raw.runAtMs);
  const repeat = sanitizeRepeat(raw.repeat);
  const createdAt = sanitizeText(raw.createdAt, 64) || new Date().toISOString();
  const createdByUserId = sanitizeDiscordId(raw.createdByUserId);
  const textChannelId = sanitizeDiscordId(raw.textChannelId);
  const announceMessage = sanitizeText(raw.announceMessage, 1200);
  const stageTopic = sanitizeText(raw.stageTopic, 120);
  const createDiscordEvent = sanitizeBoolean(raw.createDiscordEvent, false);
  const discordScheduledEventId = sanitizeDiscordId(raw.discordScheduledEventId);

  if (!id || !guildId || !voiceChannelId || !stationKey || !botId || !name || !runAtMs) {
    return null;
  }

  return {
    id,
    guildId,
    botId,
    name,
    stationKey,
    voiceChannelId,
    textChannelId: textChannelId || null,
    announceMessage: announceMessage || null,
    stageTopic: stageTopic || null,
    createDiscordEvent,
    discordScheduledEventId: discordScheduledEventId || null,
    repeat,
    runAtMs,
    createdAt,
    createdByUserId: createdByUserId || null,
    enabled: raw.enabled !== false,
    lastRunAtMs: sanitizeLastRunAtMs(raw.lastRunAtMs),
  };
}

function normalizeState(input) {
  if (!input || typeof input !== "object") return emptyState();
  const events = Array.isArray(input.events)
    ? input.events
      .map((entry) => normalizeEvent(entry))
      .filter(Boolean)
    : [];
  events.sort((a, b) => a.runAtMs - b.runAtMs);
  return {
    version: 1,
    events,
  };
}

function loadRawState() {
  try {
    if (!fs.existsSync(EVENTS_FILE)) return emptyState();
    if (fs.statSync(EVENTS_FILE).isDirectory()) {
      console.warn(`[scheduled-events] ${EVENTS_FILE} ist ein Verzeichnis - nutze leeren State.`);
      return emptyState();
    }
    const raw = fs.readFileSync(EVENTS_FILE, "utf8");
    if (!raw.trim()) return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch (err) {
    console.error(`[scheduled-events] Load error: ${err?.message || err}`);
    return emptyState();
  }
}

function saveRawState(state) {
  const normalized = normalizeState(state);
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  const tempPath = `${EVENTS_FILE}.tmp-${process.pid}-${Date.now()}`;

  try {
    fs.writeFileSync(tempPath, serialized, "utf8");
    try {
      fs.renameSync(tempPath, EVENTS_FILE);
    } catch (renameErr) {
      const code = String(renameErr?.code || "");
      if (["EBUSY", "EPERM", "EACCES", "EXDEV"].includes(code)) {
        fs.writeFileSync(EVENTS_FILE, serialized, "utf8");
      } else {
        throw renameErr;
      }
    }
  } catch (err) {
    console.error(`[scheduled-events] Save error: ${err?.message || err}`);
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
  }

  return normalized;
}

function buildEventId() {
  return `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function listScheduledEvents({ guildId = null, botId = null, includeDisabled = true } = {}) {
  const state = loadRawState();
  return state.events
    .filter((entry) => {
      if (guildId && entry.guildId !== String(guildId)) return false;
      if (botId && entry.botId !== String(botId)) return false;
      if (!includeDisabled && !entry.enabled) return false;
      return true;
    })
    .sort((a, b) => a.runAtMs - b.runAtMs);
}

function createScheduledEvent(input) {
  const state = loadRawState();
  const event = normalizeEvent({
    id: buildEventId(),
    ...input,
    createdAt: new Date().toISOString(),
    enabled: true,
    lastRunAtMs: 0,
  });

  if (!event) {
    return { ok: false, message: "Event ist ungueltig." };
  }

  state.events.push(event);
  const next = saveRawState(state);
  const saved = next.events.find((entry) => entry.id === event.id) || event;
  return { ok: true, event: saved };
}

function deleteScheduledEvent(id, { guildId = null, botId = null } = {}) {
  const eventId = sanitizeId(id);
  if (!eventId) return { ok: false, message: "Event-ID fehlt." };

  const state = loadRawState();
  const before = state.events.length;
  state.events = state.events.filter((entry) => {
    if (entry.id !== eventId) return true;
    if (guildId && entry.guildId !== String(guildId)) return true;
    if (botId && entry.botId !== String(botId)) return true;
    return false;
  });

  if (state.events.length === before) {
    return { ok: false, message: "Event nicht gefunden." };
  }

  saveRawState(state);
  return { ok: true };
}

function patchScheduledEvent(id, patch) {
  const eventId = sanitizeId(id);
  if (!eventId) return { ok: false, message: "Event-ID fehlt." };

  const state = loadRawState();
  const index = state.events.findIndex((entry) => entry.id === eventId);
  if (index < 0) return { ok: false, message: "Event nicht gefunden." };

  const current = state.events[index];
  const next = normalizeEvent({ ...current, ...patch, id: current.id, guildId: current.guildId, botId: current.botId });
  if (!next) return { ok: false, message: "Event-Update ist ungueltig." };

  state.events[index] = next;
  saveRawState(state);
  return { ok: true, event: next };
}

function getScheduledEvent(id) {
  const eventId = sanitizeId(id);
  if (!eventId) return null;
  const state = loadRawState();
  return state.events.find((entry) => entry.id === eventId) || null;
}

function deleteScheduledEventsByFilter({ guildId = null, botId = null } = {}) {
  const state = loadRawState();
  const before = state.events.length;
  state.events = state.events.filter((entry) => {
    if (guildId && entry.guildId !== String(guildId)) return true;
    if (botId && entry.botId !== String(botId)) return true;
    if (!guildId && !botId) return true;
    return false;
  });

  if (state.events.length === before) return { ok: true, removed: 0 };
  saveRawState(state);
  return { ok: true, removed: before - state.events.length };
}

export {
  listScheduledEvents,
  createScheduledEvent,
  deleteScheduledEvent,
  patchScheduledEvent,
  getScheduledEvent,
  deleteScheduledEventsByFilter,
};
