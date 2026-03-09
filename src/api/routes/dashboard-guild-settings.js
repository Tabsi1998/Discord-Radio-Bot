import { getDb, isConnected } from "../../lib/db.js";

export async function loadDashboardGuildSettings(guildId) {
  if (!isConnected() || !getDb()) {
    return {};
  }

  try {
    return await getDb().collection("guild_settings").findOne(
      { guildId },
      { projection: { _id: 0 } }
    ) || {};
  } catch {
    return {};
  }
}
