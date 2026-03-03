import { MongoClient } from "mongodb";
import { log } from "./logging.js";

const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "radio_bot";

let client = null;
let db = null;
let connectPromise = null;
let initialized = false;

async function initCollections(database) {
  if (initialized) return;
  try {
    const existing = await database.listCollections().toArray();
    const names = new Set(existing.map((c) => c.name));

    // listening_sessions: anonymous session tracking
    if (!names.has("listening_sessions")) {
      await database.createCollection("listening_sessions");
    }
    await database.collection("listening_sessions").createIndexes([
      { key: { guildId: 1, startedAt: -1 }, name: "guild_time" },
      { key: { guildId: 1, stationKey: 1 }, name: "guild_station" },
      { key: { endedAt: 1 }, name: "ended", expireAfterSeconds: 86400 * 180 },
    ]).catch(() => null);

    // daily_stats: per-guild daily aggregates
    if (!names.has("daily_stats")) {
      await database.createCollection("daily_stats");
    }
    await database.collection("daily_stats").createIndexes([
      { key: { guildId: 1, date: -1 }, name: "guild_date", unique: true },
    ]).catch(() => null);

    // connection_events: connection health log
    if (!names.has("connection_events")) {
      await database.createCollection("connection_events");
    }
    await database.collection("connection_events").createIndexes([
      { key: { guildId: 1, timestamp: -1 }, name: "guild_time" },
      { key: { timestamp: 1 }, name: "ttl", expireAfterSeconds: 86400 * 90 },
    ]).catch(() => null);

    // guild_stats: aggregated stats per guild
    if (!names.has("guild_stats")) {
      await database.createCollection("guild_stats");
    }
    await database.collection("guild_stats").createIndexes([
      { key: { guildId: 1 }, name: "guild_unique", unique: true },
    ]).catch(() => null);

    // listener_snapshots: periodic listener count samples
    if (!names.has("listener_snapshots")) {
      await database.createCollection("listener_snapshots");
    }
    await database.collection("listener_snapshots").createIndexes([
      { key: { guildId: 1, timestamp: -1 }, name: "guild_time" },
      { key: { timestamp: 1 }, name: "ttl", expireAfterSeconds: 86400 * 30 },
    ]).catch(() => null);

    // guild_settings: per-guild settings (weekly digest, fallback station)
    if (!names.has("guild_settings")) {
      await database.createCollection("guild_settings");
    }
    await database.collection("guild_settings").createIndexes([
      { key: { guildId: 1 }, name: "guild_unique", unique: true },
    ]).catch(() => null);

    initialized = true;
    log("INFO", "MongoDB Kollektionen und Indizes initialisiert.");
  } catch (err) {
    log("WARN", `MongoDB initCollections Fehler: ${err?.message || err}`);
  }
}

async function connect() {
  if (db) return db;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      client = new MongoClient(MONGO_URL, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      await client.connect();
      db = client.db(DB_NAME);
      log("INFO", `MongoDB verbunden: ${DB_NAME}`);
      await initCollections(db);
      return db;
    } catch (err) {
      connectPromise = null;
      throw err;
    }
  })();

  return connectPromise;
}

function getDb() {
  return db;
}

function isConnected() {
  return db !== null;
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    connectPromise = null;
    initialized = false;
  }
}

export { connect, getDb, isConnected, close };
