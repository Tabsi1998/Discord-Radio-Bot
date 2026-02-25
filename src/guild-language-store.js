// ============================================================================
// guild-language-store.js – MongoDB-basiert (migriert von JSON-Datei)
// ============================================================================
import { getDb } from "./lib/db.js";
import { log } from "./lib/logging.js";

const COLLECTION = "guild_languages";

function col() {
  const db = getDb();
  return db ? db.collection(COLLECTION) : null;
}

async function getGuildLanguage(guildId) {
  const c = col();
  if (!c) return null;
  try {
    const doc = await c.findOne({ guildId: String(guildId) }, { projection: { _id: 0 } });
    return doc?.language || null;
  } catch (err) {
    log("ERROR", `getGuildLanguage fehlgeschlagen: ${err.message}`);
    return null;
  }
}

async function setGuildLanguage(guildId, language) {
  const c = col();
  if (!c) return false;
  try {
    await c.updateOne(
      { guildId: String(guildId) },
      { $set: { guildId: String(guildId), language, updatedAt: new Date() } },
      { upsert: true }
    );
    return true;
  } catch (err) {
    log("ERROR", `setGuildLanguage fehlgeschlagen: ${err.message}`);
    return false;
  }
}

async function resetGuildLanguage(guildId) {
  const c = col();
  if (!c) return false;
  try {
    await c.deleteOne({ guildId: String(guildId) });
    return true;
  } catch (err) {
    log("ERROR", `resetGuildLanguage fehlgeschlagen: ${err.message}`);
    return false;
  }
}

async function getAllGuildLanguages() {
  const c = col();
  if (!c) return {};
  try {
    const docs = await c.find({}, { projection: { _id: 0 } }).toArray();
    const result = {};
    for (const doc of docs) {
      if (doc.guildId && doc.language) {
        result[doc.guildId] = doc.language;
      }
    }
    return result;
  } catch (err) {
    log("ERROR", `getAllGuildLanguages fehlgeschlagen: ${err.message}`);
    return {};
  }
}

export {
  getGuildLanguage,
  setGuildLanguage,
  resetGuildLanguage,
  getAllGuildLanguages,
};
