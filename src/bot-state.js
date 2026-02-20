import fs from "node:fs";
import path from "node:path";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const rootDir = path.resolve(__dirname, "..");
const STATE_FILE = path.join(rootDir, "bot-state.json");

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, "utf8");
      if (!raw || raw.trim().length === 0) return {};
      return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`[bot-state] Fehler beim Laden von ${STATE_FILE}: ${err.message}`);
  }
  return {};
}

function saveState(state) {
  try {
    // Sicherstellen dass die Datei existiert und kein Verzeichnis ist
    if (fs.existsSync(STATE_FILE) && fs.statSync(STATE_FILE).isDirectory()) {
      fs.rmSync(STATE_FILE, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.error(`[bot-state] Fehler beim Speichern: ${err.message}`);
  }
}

function saveBotState(botId, guildStates) {
  const allState = loadState();
  const botData = {};

  for (const [guildId, state] of guildStates.entries()) {
    if (!state.currentStationKey || !state.lastChannelId) continue;
    botData[guildId] = {
      channelId: state.lastChannelId,
      stationKey: state.currentStationKey,
      stationName: state.currentStationName || null,
      volume: state.volume ?? 100,
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
