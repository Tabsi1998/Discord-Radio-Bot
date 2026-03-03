import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const STATE_FILE = path.join(rootDir, "bot-state.json");
const STATE_BACKUP_FILE = `${STATE_FILE}.bak`;

function readStateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    if (fs.statSync(filePath).isDirectory()) {
      console.warn(`[bot-state] ${filePath} ist ein Verzeichnis (Docker-Mount Problem). Nutze leeren State.`);
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw || raw.trim().length === 0) return {};
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[bot-state] Fehler beim Laden von ${filePath}: ${err.message}`);
    return null;
  }
}

function loadState() {
  return readStateFile(STATE_FILE) || readStateFile(STATE_BACKUP_FILE) || {};
}

function saveState(state) {
  const payload = JSON.stringify(state, null, 2);
  const tmpFile = `${STATE_FILE}.tmp-${process.pid}-${Date.now()}`;
  try {
    // Docker-Mount: Wenn es ein Verzeichnis ist, NICHT versuchen zu loeschen
    // (schlaegt fehl mit "Device or resource busy")
    if (fs.existsSync(STATE_FILE) && fs.statSync(STATE_FILE).isDirectory()) {
      console.warn(`[bot-state] ${STATE_FILE} ist ein Verzeichnis - State wird nur im Speicher gehalten.`);
      console.warn(`[bot-state] Fix: echo '{}' > ./bot-state.json && docker compose up -d`);
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
    console.error(`[bot-state] Fehler beim Speichern: ${err.message}`);
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

function saveBotState(botId, guildStates) {
  const allState = loadState();
  const botData = {};

  for (const [guildId, state] of guildStates.entries()) {
    if (!state.currentStationKey || !state.lastChannelId) continue;
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

  if (Object.keys(botData).length > 0) {
    allState[botId] = botData;
  } else {
    delete allState[botId];
  }

  saveState(allState);
}

function getBotState(botId) {
  const allState = loadState();
  return allState[botId] || {};
}

function clearBotGuild(botId, guildId) {
  const allState = loadState();
  if (allState[botId]) {
    delete allState[botId][guildId];
    if (Object.keys(allState[botId]).length === 0) {
      delete allState[botId];
    }
    saveState(allState);
  }
}

export { saveBotState, getBotState, clearBotGuild, loadState, saveState };
