import { loadGuildSettings } from "../../lib/guild-settings.js";

export async function loadDashboardGuildSettings(guildId) {
  return loadGuildSettings(guildId);
}
