// ============================================================================
// custom-stations.js – MongoDB-basiert (migriert von JSON-Datei)
// ============================================================================
import { getDb } from "./lib/db.js";
import { log } from "./lib/logging.js";

const COLLECTION = "custom_stations";
const MAX_STATIONS_PER_GUILD = 10;

function col() {
  const db = getDb();
  return db ? db.collection(COLLECTION) : null;
}

function validateCustomStationUrl(url) {
  if (!url || typeof url !== "string") return { ok: false, error: "URL fehlt." };
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://"))
    return { ok: false, error: "URL muss mit http:// oder https:// beginnen." };
  if (trimmed.length > 512)
    return { ok: false, error: "URL darf max. 512 Zeichen lang sein." };
  return { ok: true, error: null };
}

async function getGuildStations(guildId) {
  const c = col();
  if (!c) return {};
  try {
    const docs = await c
      .find({ guildId: String(guildId) }, { projection: { _id: 0, guildId: 0, createdAt: 0 } })
      .toArray();
    const result = {};
    for (const doc of docs) {
      result[doc.key] = { name: doc.name, url: doc.url };
    }
    return result;
  } catch (err) {
    log("ERROR", `getGuildStations fehlgeschlagen: ${err.message}`);
    return {};
  }
}

async function addGuildStation(guildId, key, name, url) {
  const c = col();
  if (!c) return { ok: false, error: "DB nicht verfuegbar." };
  const gid = String(guildId);
  const normalizedKey = String(key).toLowerCase().trim();

  try {
    const count = await c.countDocuments({ guildId: gid });
    if (count >= MAX_STATIONS_PER_GUILD) {
      return { ok: false, error: `Max. ${MAX_STATIONS_PER_GUILD} Custom-Stationen erreicht.` };
    }

    const existing = await c.findOne({ guildId: gid, key: normalizedKey });
    if (existing) {
      return { ok: false, error: `Station '${normalizedKey}' existiert bereits.` };
    }

    await c.insertOne({
      guildId: gid,
      key: normalizedKey,
      name: String(name).trim(),
      url: String(url).trim(),
      createdAt: new Date(),
    });
    return { ok: true };
  } catch (err) {
    log("ERROR", `addGuildStation fehlgeschlagen: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function removeGuildStation(guildId, key) {
  const c = col();
  if (!c) return { ok: false, error: "DB nicht verfuegbar." };
  try {
    const result = await c.deleteOne({ guildId: String(guildId), key: String(key).toLowerCase().trim() });
    if (result.deletedCount === 0) {
      return { ok: false, error: "Station nicht gefunden." };
    }
    return { ok: true };
  } catch (err) {
    log("ERROR", `removeGuildStation fehlgeschlagen: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function listGuildStations(guildId) {
  return getGuildStations(guildId);
}

async function countGuildStations(guildId) {
  const c = col();
  if (!c) return 0;
  try {
    return await c.countDocuments({ guildId: String(guildId) });
  } catch (err) {
    log("ERROR", `countGuildStations fehlgeschlagen: ${err.message}`);
    return 0;
  }
}

async function clearGuildStations(guildId) {
  const c = col();
  if (!c) return false;
  try {
    await c.deleteMany({ guildId: String(guildId) });
    return true;
  } catch (err) {
    log("ERROR", `clearGuildStations fehlgeschlagen: ${err.message}`);
    return false;
  }
}

// Legacy compat
const addCustomStation = addGuildStation;
const removeCustomStation = removeGuildStation;
const listCustomStations = listGuildStations;

export {
  getGuildStations,
  addGuildStation,
  removeGuildStation,
  listGuildStations,
  countGuildStations,
  clearGuildStations,
  MAX_STATIONS_PER_GUILD,
  validateCustomStationUrl,
  addCustomStation,
  removeCustomStation,
  listCustomStations,
};
