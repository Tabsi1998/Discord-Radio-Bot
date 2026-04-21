import { getDb, isConnected } from "./db.js";

function sanitizeGuildId(value) {
  const text = String(value || "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
}

export async function loadGuildSettings(guildId) {
  const normalizedGuildId = sanitizeGuildId(guildId);
  if (!normalizedGuildId || !isConnected() || !getDb()) {
    return {};
  }

  try {
    return await getDb().collection("guild_settings").findOne(
      { guildId: normalizedGuildId },
      { projection: { _id: 0 } }
    ) || {};
  } catch {
    return {};
  }
}

export async function updateGuildSettings(guildId, updates, { unset = [] } = {}) {
  const normalizedGuildId = sanitizeGuildId(guildId);
  if (!normalizedGuildId || !isConnected() || !getDb()) {
    return { ok: false, error: "db_unavailable" };
  }

  const safeUpdates = updates && typeof updates === "object" ? { ...updates } : {};
  safeUpdates.guildId = normalizedGuildId;
  const safeUnset = Array.isArray(unset)
    ? unset.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  const operations = { $set: safeUpdates };
  if (safeUnset.length > 0) {
    operations.$unset = Object.fromEntries(safeUnset.map((key) => [key, ""]));
  }

  try {
    await getDb().collection("guild_settings").updateOne(
      { guildId: normalizedGuildId },
      operations,
      { upsert: true }
    );
    return { ok: true };
  } catch {
    return { ok: false, error: "db_write_failed" };
  }
}
