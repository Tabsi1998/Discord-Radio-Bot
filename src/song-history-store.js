// ============================================================================
// song-history-store.js – MongoDB-basiert (migriert von JSON-Datei)
// ============================================================================
import { getDb } from "./lib/db.js";
import { log } from "./lib/logging.js";

const COLLECTION = "song_history";
const DEFAULT_MAX = 100;
const DEFAULT_DEDUPE_MS = 120_000;

function col() {
  const db = getDb();
  return db ? db.collection(COLLECTION) : null;
}

async function appendSongHistory(guildId, track, options = {}) {
  const c = col();
  if (!c) return false;
  const gid = String(guildId);
  const maxEntries = options.maxEntries || DEFAULT_MAX;
  const dedupeMs = options.dedupeMs ?? DEFAULT_DEDUPE_MS;

  try {
    // Dedupe check
    if (dedupeMs > 0) {
      const cutoff = new Date(Date.now() - dedupeMs);
      const recent = await c.findOne(
        { guildId: gid, "track.title": track.title, playedAt: { $gte: cutoff } },
        { projection: { _id: 1 } }
      );
      if (recent) return false;
    }

    await c.insertOne({
      guildId: gid,
      track: {
        title: track.title || "Unknown",
        artist: track.artist || null,
        stationKey: track.stationKey || null,
        stationName: track.stationName || null,
        coverUrl: track.coverUrl || null,
      },
      playedAt: new Date(),
    });

    // Trim to maxEntries
    const count = await c.countDocuments({ guildId: gid });
    if (count > maxEntries) {
      const toDelete = count - maxEntries;
      const oldest = await c
        .find({ guildId: gid })
        .sort({ playedAt: 1 })
        .limit(toDelete)
        .project({ _id: 1 })
        .toArray();
      if (oldest.length > 0) {
        await c.deleteMany({ _id: { $in: oldest.map((d) => d._id) } });
      }
    }

    return true;
  } catch (err) {
    log("ERROR", `appendSongHistory fehlgeschlagen: ${err.message}`);
    return false;
  }
}

async function getSongHistory(guildId, limit = 20) {
  const c = col();
  if (!c) return [];
  try {
    const docs = await c
      .find({ guildId: String(guildId) }, { projection: { _id: 0, guildId: 0 } })
      .sort({ playedAt: -1 })
      .limit(limit)
      .toArray();
    return docs.map((d) => ({
      ...d.track,
      playedAt: d.playedAt?.toISOString() || null,
    }));
  } catch (err) {
    log("ERROR", `getSongHistory fehlgeschlagen: ${err.message}`);
    return [];
  }
}

async function clearSongHistory(guildId) {
  const c = col();
  if (!c) return false;
  try {
    await c.deleteMany({ guildId: String(guildId) });
    return true;
  } catch (err) {
    log("ERROR", `clearSongHistory fehlgeschlagen: ${err.message}`);
    return false;
  }
}

// Legacy compat aliases
const addSongEntry = appendSongHistory;
const getHistory = getSongHistory;
const getGuildSongHistory = getSongHistory;

export {
  appendSongHistory,
  getSongHistory,
  clearSongHistory,
  addSongEntry,
  getHistory,
  getGuildSongHistory,
};
