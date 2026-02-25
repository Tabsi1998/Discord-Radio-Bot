// ============================================================================
// scheduled-events-store.js – MongoDB-basiert (migriert von JSON-Datei)
// ============================================================================
import { getDb } from "./lib/db.js";
import { log } from "./lib/logging.js";

const COLLECTION = "scheduled_events";

function col() {
  const db = getDb();
  return db ? db.collection(COLLECTION) : null;
}

function generateEventId() {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function listAllEvents() {
  const c = col();
  if (!c) return [];
  try {
    return await c.find({}, { projection: { _id: 0 } }).toArray();
  } catch (err) {
    log("ERROR", `listAllEvents fehlgeschlagen: ${err.message}`);
    return [];
  }
}

async function listScheduledEvents(guildId) {
  const c = col();
  if (!c) return [];
  try {
    return await c.find({ guildId: String(guildId) }, { projection: { _id: 0 } }).toArray();
  } catch (err) {
    log("ERROR", `listScheduledEvents fehlgeschlagen: ${err.message}`);
    return [];
  }
}

async function getEvent(eventId) {
  const c = col();
  if (!c) return null;
  try {
    return await c.findOne({ eventId: String(eventId) }, { projection: { _id: 0 } });
  } catch (err) {
    log("ERROR", `getEvent fehlgeschlagen: ${err.message}`);
    return null;
  }
}

async function getScheduledEvent(guildId, eventId) {
  const c = col();
  if (!c) return null;
  try {
    return await c.findOne(
      { guildId: String(guildId), eventId: String(eventId) },
      { projection: { _id: 0 } }
    );
  } catch (err) {
    log("ERROR", `getScheduledEvent fehlgeschlagen: ${err.message}`);
    return null;
  }
}

async function addEvent(eventData) {
  const c = col();
  if (!c) return null;
  try {
    const eventId = eventData.eventId || generateEventId();
    const doc = {
      ...eventData,
      eventId,
      createdAt: new Date(),
    };
    await c.insertOne(doc);
    return eventId;
  } catch (err) {
    log("ERROR", `addEvent fehlgeschlagen: ${err.message}`);
    return null;
  }
}

async function createScheduledEvent(guildId, eventData) {
  const eventId = generateEventId();
  const doc = {
    ...eventData,
    guildId: String(guildId),
    eventId,
    createdAt: new Date(),
  };
  return addEvent(doc);
}

async function removeEvent(eventId) {
  const c = col();
  if (!c) return false;
  try {
    const result = await c.deleteOne({ eventId: String(eventId) });
    return result.deletedCount > 0;
  } catch (err) {
    log("ERROR", `removeEvent fehlgeschlagen: ${err.message}`);
    return false;
  }
}

async function deleteScheduledEvent(guildId, eventId) {
  const c = col();
  if (!c) return false;
  try {
    const result = await c.deleteOne({ guildId: String(guildId), eventId: String(eventId) });
    return result.deletedCount > 0;
  } catch (err) {
    log("ERROR", `deleteScheduledEvent fehlgeschlagen: ${err.message}`);
    return false;
  }
}

async function deleteScheduledEventsByFilter(filter) {
  const c = col();
  if (!c) return 0;
  try {
    const result = await c.deleteMany(filter);
    return result.deletedCount;
  } catch (err) {
    log("ERROR", `deleteScheduledEventsByFilter fehlgeschlagen: ${err.message}`);
    return 0;
  }
}

async function patchScheduledEvent(guildId, eventId, patch) {
  const c = col();
  if (!c) return false;
  try {
    const result = await c.updateOne(
      { guildId: String(guildId), eventId: String(eventId) },
      { $set: { ...patch, updatedAt: new Date() } }
    );
    return result.matchedCount > 0;
  } catch (err) {
    log("ERROR", `patchScheduledEvent fehlgeschlagen: ${err.message}`);
    return false;
  }
}

async function updateEventRunAtMs(eventId, runAtMs) {
  const c = col();
  if (!c) return false;
  try {
    const result = await c.updateOne(
      { eventId: String(eventId) },
      { $set: { runAtMs, updatedAt: new Date() } }
    );
    return result.matchedCount > 0;
  } catch (err) {
    log("ERROR", `updateEventRunAtMs fehlgeschlagen: ${err.message}`);
    return false;
  }
}

export {
  listAllEvents,
  listScheduledEvents,
  addEvent,
  removeEvent,
  updateEventRunAtMs,
  getEvent,
  getScheduledEvent,
  createScheduledEvent,
  deleteScheduledEvent,
  deleteScheduledEventsByFilter,
  patchScheduledEvent,
};
