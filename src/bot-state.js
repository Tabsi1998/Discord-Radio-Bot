import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log, logStoreLoadError } from "./lib/logging.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const STATE_FILE = path.join(rootDir, "bot-state.json");
const STATE_BACKUP_FILE = `${STATE_FILE}.bak`;
const SPLIT_PROCESS_ROLE = String(process.env.BOT_PROCESS_ROLE || "").trim().toLowerCase();
const SPLIT_STATE_STORAGE_ENABLED = SPLIT_PROCESS_ROLE === "commander" || SPLIT_PROCESS_ROLE === "worker";
const SPLIT_STATE_DIR = path.join(rootDir, String(process.env.BOT_STATE_SPLIT_DIR || "bot-state").trim() || "bot-state");

function hasStateEntries(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function isPersistableGuildState(state) {
  return Boolean(state?.currentStationKey && state?.lastChannelId);
}

function readStateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    if (fs.statSync(filePath).isDirectory()) {
      log("WARN", `[bot-state] ${filePath} ist ein Verzeichnis (Docker-Mount Problem). Nutze leeren State.`);
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw || raw.trim().length === 0) return {};
    return JSON.parse(raw);
  } catch (err) {
    logStoreLoadError("bot-state", filePath, err);
    return null;
  }
}

function loadState() {
  return readStateFile(STATE_FILE) || readStateFile(STATE_BACKUP_FILE) || {};
}

function sanitizeStateFileSegment(raw) {
  return String(raw || "").trim().replace(/[^a-z0-9._-]/gi, "_");
}

function getSplitBotStateFile(botId) {
  const safeBotId = sanitizeStateFileSegment(botId);
  if (!safeBotId) return null;
  return path.join(SPLIT_STATE_DIR, `${safeBotId}.json`);
}

function getSplitBotBackupFile(botId) {
  const primary = getSplitBotStateFile(botId);
  return primary ? `${primary}.bak` : null;
}

function ensureDirectoryForFile(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function saveState(state) {
  const payload = JSON.stringify(state, null, 2);
  const tmpFile = `${STATE_FILE}.tmp-${process.pid}-${Date.now()}`;
  try {
    // Docker-Mount: Wenn es ein Verzeichnis ist, NICHT versuchen zu loeschen
    // (schlaegt fehl mit "Device or resource busy")
    if (fs.existsSync(STATE_FILE) && fs.statSync(STATE_FILE).isDirectory()) {
      log("WARN", `[bot-state] ${STATE_FILE} ist ein Verzeichnis - State wird nur im Speicher gehalten.`);
      log("WARN", `[bot-state] Fix: echo '{}' > ./bot-state.json && docker compose up -d`);
      return;
    }

    if (fs.existsSync(STATE_FILE)) {
      try {
        fs.copyFileSync(STATE_FILE, STATE_BACKUP_FILE);
      } catch {
        // ignore backup errors
      }
    }

    fs.writeFileSync(tmpFile, payload, "utf8");
    try {
      fs.renameSync(tmpFile, STATE_FILE);
    } catch {
      fs.writeFileSync(STATE_FILE, payload, "utf8");
    }
  } catch (err) {
    log("ERROR", `[bot-state] Fehler beim Speichern: ${err?.message || err}`);
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

function saveStateToFile(filePath, backupFilePath, state) {
  const payload = JSON.stringify(state, null, 2);
  const tmpFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    ensureDirectoryForFile(filePath);

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      log("WARN", `[bot-state] ${filePath} ist ein Verzeichnis - State wird nur im Speicher gehalten.`);
      return;
    }

    if (fs.existsSync(filePath) && backupFilePath) {
      try {
        fs.copyFileSync(filePath, backupFilePath);
      } catch {
        // ignore backup errors
      }
    }

    fs.writeFileSync(tmpFile, payload, "utf8");
    try {
      fs.renameSync(tmpFile, filePath);
    } catch {
      fs.writeFileSync(filePath, payload, "utf8");
    }
  } catch (err) {
    log("ERROR", `[bot-state] Fehler beim Speichern (${filePath}): ${err?.message || err}`);
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

function loadSplitBotState(botId) {
  const filePath = getSplitBotStateFile(botId);
  const backupFilePath = getSplitBotBackupFile(botId);
  if (!filePath) return {};
  const splitState = readStateFile(filePath) || readStateFile(backupFilePath) || {};
  if (hasStateEntries(splitState)) {
    return splitState;
  }

  const legacyState = loadState();
  const legacyBotState = legacyState?.[botId];
  if (!hasStateEntries(legacyBotState)) {
    return splitState;
  }

  saveStateToFile(filePath, backupFilePath, legacyBotState);
  delete legacyState[botId];
  saveState(legacyState);
  log(
    "INFO",
    `[bot-state] Legacy-State fuer ${botId} nach Split-Storage migriert (${Object.keys(legacyBotState).length} Guild(s)).`
  );
  return legacyBotState;
}

function saveBotState(botId, guildStates) {
  const botData = {};

  for (const [guildId, state] of guildStates.entries()) {
    if (!isPersistableGuildState(state)) continue;
    const scheduledEventStopAtMs = Number.parseInt(String(state.activeScheduledEventStopAtMs || 0), 10);
    botData[guildId] = {
      channelId: state.lastChannelId,
      stationKey: state.currentStationKey,
      stationName: state.currentStationName || null,
      volume: state.volume ?? 100,
      scheduledEventId: state.activeScheduledEventId || null,
      scheduledEventStopAtMs: Number.isFinite(scheduledEventStopAtMs) && scheduledEventStopAtMs > 0
        ? scheduledEventStopAtMs
        : 0,
      savedAt: new Date().toISOString(),
    };
  }

  if (SPLIT_STATE_STORAGE_ENABLED) {
    const filePath = getSplitBotStateFile(botId);
    const backupFilePath = getSplitBotBackupFile(botId);
    if (!filePath) return;
    saveStateToFile(filePath, backupFilePath, botData);
    return;
  }

  const allState = loadState();
  if (Object.keys(botData).length > 0) {
    allState[botId] = botData;
  } else {
    delete allState[botId];
  }

  saveState(allState);
}

function getBotState(botId) {
  if (SPLIT_STATE_STORAGE_ENABLED) {
    return loadSplitBotState(botId);
  }
  const allState = loadState();
  return allState[botId] || {};
}

function clearBotGuild(botId, guildId) {
  if (SPLIT_STATE_STORAGE_ENABLED) {
    const botState = loadSplitBotState(botId);
    delete botState[guildId];
    const filePath = getSplitBotStateFile(botId);
    const backupFilePath = getSplitBotBackupFile(botId);
    if (!filePath) return;
    if (Object.keys(botState).length === 0) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
      return;
    }
    saveStateToFile(filePath, backupFilePath, botState);
    return;
  }

  const allState = loadState();
  if (allState[botId]) {
    delete allState[botId][guildId];
    if (Object.keys(allState[botId]).length === 0) {
      delete allState[botId];
    }
    saveState(allState);
  }
}

export { saveBotState, getBotState, clearBotGuild, isPersistableGuildState, loadState, saveState };
