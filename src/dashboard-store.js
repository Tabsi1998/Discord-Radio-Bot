import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.resolve(__dirname, "..", "dashboard.json");
const BACKUP_FILE = `${STORE_FILE}.bak`;

function emptyState() {
  return {
    version: 1,
    events: {},
    perms: {},
    telemetry: {},
    authSessions: {},
    oauthStates: {},
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeText(value, maxLen = 200) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, maxLen);
}

function sanitizeSnowflake(value) {
  const text = String(value || "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
}

function normalizeGuildRow(rawGuild) {
  if (!isObject(rawGuild)) return null;
  const guildId = sanitizeSnowflake(rawGuild.id);
  if (!guildId) return null;
  return {
    id: guildId,
    name: sanitizeText(rawGuild.name, 120) || guildId,
    icon: sanitizeText(rawGuild.icon, 120),
    owner: Boolean(rawGuild.owner),
    permissions: sanitizeText(rawGuild.permissions, 40) || "0",
  };
}

function normalizeUserRow(rawUser) {
  if (!isObject(rawUser)) return {};
  return {
    id: sanitizeSnowflake(rawUser.id),
    username: sanitizeText(rawUser.username, 80) || "Discord User",
    globalName: sanitizeText(rawUser.globalName || rawUser.global_name, 80),
    avatar: sanitizeText(rawUser.avatar, 120),
  };
}

function normalizeAuthSession(rawSession) {
  if (!isObject(rawSession)) return null;
  const expiresAt = Number.parseInt(String(rawSession.expiresAt || 0), 10);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null;

  const guilds = Array.isArray(rawSession.guilds)
    ? rawSession.guilds.map((guild) => normalizeGuildRow(guild)).filter(Boolean)
    : [];

  return {
    user: normalizeUserRow(rawSession.user),
    guilds,
    createdAt: Number.parseInt(String(rawSession.createdAt || 0), 10) || Math.floor(Date.now() / 1000),
    expiresAt,
  };
}

function normalizeOauthState(rawState) {
  if (!isObject(rawState)) return null;
  const token = sanitizeText(rawState.token, 120);
  const expiresAt = Number.parseInt(String(rawState.expiresAt || 0), 10);
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= 0) return null;
  return {
    token,
    nextPage: sanitizeText(rawState.nextPage, 40) || "dashboard",
    origin: sanitizeText(rawState.origin, 200),
    createdAt: Number.parseInt(String(rawState.createdAt || 0), 10) || Math.floor(Date.now() / 1000),
    expiresAt,
  };
}

function normalizeTelemetryRow(rawTelemetry) {
  return isObject(rawTelemetry) ? deepClone(rawTelemetry) : {};
}

function normalizeState(rawState) {
  const source = isObject(rawState) ? rawState : {};
  const normalized = emptyState();

  for (const [guildId, telemetry] of Object.entries(source.telemetry || {})) {
    const safeGuildId = sanitizeSnowflake(guildId);
    if (!safeGuildId) continue;
    normalized.telemetry[safeGuildId] = normalizeTelemetryRow(telemetry);
  }

  for (const [token, session] of Object.entries(source.authSessions || {})) {
    const safeToken = sanitizeText(token, 160);
    const normalizedSession = normalizeAuthSession(session);
    if (!safeToken || !normalizedSession) continue;
    normalized.authSessions[safeToken] = normalizedSession;
  }

  for (const [token, state] of Object.entries(source.oauthStates || {})) {
    const normalizedStateRow = normalizeOauthState({ ...state, token });
    if (!normalizedStateRow) continue;
    normalized.oauthStates[normalizedStateRow.token] = {
      nextPage: normalizedStateRow.nextPage,
      origin: normalizedStateRow.origin,
      createdAt: normalizedStateRow.createdAt,
      expiresAt: normalizedStateRow.expiresAt,
    };
  }

  if (isObject(source.events)) normalized.events = deepClone(source.events);
  if (isObject(source.perms)) normalized.perms = deepClone(source.perms);

  return normalized;
}

function readStateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    if (!fs.statSync(filePath).isFile()) return null;
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
  const payload = JSON.stringify(normalizeState(state), null, 2) + "\n";
  const tmpFile = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`;

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
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
  }
}

function cleanupExpiredAuthEntries(nowTs = Math.floor(Date.now() / 1000)) {
  const state = ensureState();
  let changed = false;

  for (const [token, session] of Object.entries(state.authSessions)) {
    const expiresAt = Number.parseInt(String(session?.expiresAt || 0), 10);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowTs) {
      delete state.authSessions[token];
      changed = true;
    }
  }

  for (const [token, oauthState] of Object.entries(state.oauthStates)) {
    const expiresAt = Number.parseInt(String(oauthState?.expiresAt || 0), 10);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowTs) {
      delete state.oauthStates[token];
      changed = true;
    }
  }

  if (changed) saveState();
}

export function getDashboardTelemetry(serverId) {
  const guildId = sanitizeSnowflake(serverId);
  if (!guildId) return {};
  const state = ensureState();
  return deepClone(state.telemetry[guildId] || {});
}

export function setDashboardTelemetry(serverId, telemetry) {
  const guildId = sanitizeSnowflake(serverId);
  if (!guildId) return {};
  const state = ensureState();
  state.telemetry[guildId] = normalizeTelemetryRow(telemetry);
  saveState();
  return deepClone(state.telemetry[guildId]);
}

export function setDashboardOauthState(token, payload) {
  const safeToken = sanitizeText(token, 160);
  const stateRow = normalizeOauthState({ ...payload, token: safeToken });
  if (!safeToken || !stateRow) return null;
  cleanupExpiredAuthEntries();
  const state = ensureState();
  state.oauthStates[safeToken] = {
    nextPage: stateRow.nextPage,
    origin: stateRow.origin,
    createdAt: stateRow.createdAt,
    expiresAt: stateRow.expiresAt,
  };
  saveState();
  return deepClone(state.oauthStates[safeToken]);
}

export function popDashboardOauthState(token) {
  const safeToken = sanitizeText(token, 160);
  if (!safeToken) return null;
  cleanupExpiredAuthEntries();
  const state = ensureState();
  const value = state.oauthStates[safeToken] || null;
  if (value) {
    delete state.oauthStates[safeToken];
    saveState();
  }
  return value ? deepClone(value) : null;
}

export function setDashboardAuthSession(token, payload) {
  const safeToken = sanitizeText(token, 160);
  const normalizedSession = normalizeAuthSession(payload);
  if (!safeToken || !normalizedSession) return null;
  cleanupExpiredAuthEntries();
  const state = ensureState();
  state.authSessions[safeToken] = normalizedSession;
  saveState();
  return deepClone(state.authSessions[safeToken]);
}

export function getDashboardAuthSession(token) {
  const safeToken = sanitizeText(token, 160);
  if (!safeToken) return null;
  cleanupExpiredAuthEntries();
  const state = ensureState();
  const session = state.authSessions[safeToken];
  return session ? deepClone(session) : null;
}

export function deleteDashboardAuthSession(token) {
  const safeToken = sanitizeText(token, 160);
  if (!safeToken) return false;
  const state = ensureState();
  if (!state.authSessions[safeToken]) return false;
  delete state.authSessions[safeToken];
  saveState();
  return true;
}

export function cleanupDashboardAuthState(nowTs) {
  cleanupExpiredAuthEntries(nowTs);
}
