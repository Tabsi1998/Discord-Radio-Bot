import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultLanguage, normalizeLanguage } from "./i18n.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.resolve(__dirname, "..", "guild-languages.json");
const BACKUP_FILE = `${STORE_FILE}.bak`;

function emptyState() {
  return {
    version: 1,
    guilds: {},
  };
}

function sanitizeGuildId(rawGuildId) {
  const guildId = String(rawGuildId || "").trim();
  return /^\d{17,22}$/.test(guildId) ? guildId : null;
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const guilds = source.guilds && typeof source.guilds === "object" ? source.guilds : {};
  const out = {};

  for (const [rawGuildId, rawLanguage] of Object.entries(guilds)) {
    const guildId = sanitizeGuildId(rawGuildId);
    if (!guildId) continue;
    out[guildId] = normalizeLanguage(rawLanguage, getDefaultLanguage());
  }

  return {
    version: 1,
    guilds: out,
  };
}

function readState(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch (err) {
    console.error(`[guild-languages] Load error (${filePath}): ${err.message}`);
    return null;
  }
}

function loadState() {
  return readState(STORE_FILE) || readState(BACKUP_FILE) || emptyState();
}

function saveState(state) {
  const normalized = normalizeState(state);
  const payload = `${JSON.stringify(normalized, null, 2)}\n`;
  const tmpFile = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (fs.existsSync(STORE_FILE)) {
      try {
        fs.copyFileSync(STORE_FILE, BACKUP_FILE);
      } catch {
        // ignore backup errors
      }
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
    } catch {
      // ignore
    }
  }
}

let cache = null;
function ensureState() {
  if (cache) return cache;
  cache = loadState();
  return cache;
}

export function getGuildLanguage(guildId) {
  const id = sanitizeGuildId(guildId);
  if (!id) return null;
  const state = ensureState();
  return state.guilds[id] || null;
}

export function setGuildLanguage(guildId, language) {
  const id = sanitizeGuildId(guildId);
  if (!id) return null;
  const state = ensureState();
  const nextLanguage = normalizeLanguage(language, getDefaultLanguage());
  state.guilds[id] = nextLanguage;
  saveState(state);
  return nextLanguage;
}

export function clearGuildLanguage(guildId) {
  const id = sanitizeGuildId(guildId);
  if (!id) return false;
  const state = ensureState();
  if (!state.guilds[id]) return false;
  delete state.guilds[id];
  saveState(state);
  return true;
}

export function resetGuildLanguage(guildId) {
  return clearGuildLanguage(guildId);
}

export function getAllGuildLanguages() {
  const state = ensureState();
  return { ...(state.guilds || {}) };
}
