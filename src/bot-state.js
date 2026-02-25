// ============================================================================
// bot-state.js – MongoDB-basiert (migriert von JSON-Datei)
// ============================================================================
import { getDb } from "./lib/db.js";
import { log } from "./lib/logging.js";

const COLLECTION = "bot_state";

function col() {
  const db = getDb();
  return db ? db.collection(COLLECTION) : null;
}

async function saveBotState(state) {
  const c = col();
  if (!c) return;
  try {
    for (const [guildId, guildData] of Object.entries(state)) {
      await c.updateOne(
        { guildId },
        { $set: { guildId, ...guildData, updatedAt: new Date() } },
        { upsert: true }
      );
    }
  } catch (err) {
    log("ERROR", `saveBotState fehlgeschlagen: ${err.message}`);
  }
}

async function getBotState() {
  const c = col();
  if (!c) return {};
  try {
    const docs = await c.find({}, { projection: { _id: 0 } }).toArray();
    const state = {};
    for (const doc of docs) {
      if (doc.guildId) {
        const { guildId, updatedAt, ...rest } = doc;
        state[guildId] = rest;
      }
    }
    return state;
  } catch (err) {
    log("ERROR", `getBotState fehlgeschlagen: ${err.message}`);
    return {};
  }
}

async function clearBotGuild(guildId) {
  const c = col();
  if (!c) return;
  try {
    await c.deleteOne({ guildId: String(guildId) });
  } catch (err) {
    log("ERROR", `clearBotGuild fehlgeschlagen: ${err.message}`);
  }
}

// Legacy compat – loadState/saveState as no-ops since state is in MongoDB
function loadState() { return {}; }
function saveState() {}

export { saveBotState, getBotState, clearBotGuild, loadState, saveState };
