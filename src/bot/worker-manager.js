// ============================================================
// OmniFM: Worker Manager - Worker Assignment & Coordination
// ============================================================
import { log } from "../lib/logging.js";
import { TIERS, TIER_RANK } from "../lib/helpers.js";
import { getTier } from "../core/entitlements.js";

class WorkerManager {
  /**
   * @param {BotRuntime[]} workers - Worker bot instances
   */
  constructor(workers = []) {
    this.workers = workers;
  }

  /**
   * Get the max worker index allowed for a tier.
   * Free: 1-2, Pro: 1-8, Ultimate: 1-16
   */
  getMaxWorkerIndex(tier) {
    const t = String(tier || "free").toLowerCase();
    return TIERS[t]?.maxBots ?? 2;
  }

  /**
   * Get workers available for a guild based on tier.
   * A worker is available if:
   * 1. Its index is within the tier's max (Free: 1-2, Pro: 1-8, Ultimate: 1-16)
   * 2. The worker's Discord client is in the guild (invited)
   * 3. The worker is not already streaming in this guild
   */
  getAvailableWorkers(guildId, tier = "free") {
    const maxIndex = this.getMaxWorkerIndex(tier);
    return this.workers.filter((w) => {
      const idx = Number(w.config.index || 0);
      if (idx < 1 || idx > maxIndex) return false;
      if (!w.client?.isReady()) return false;
      if (!w.client.guilds.cache.has(guildId)) return false;
      const state = w.guildState.get(guildId);
      if (state?.currentStationKey && state?.connection) return false;
      return true;
    });
  }

  /**
   * Get all workers that are invited to a guild (regardless of streaming state).
   */
  getInvitedWorkers(guildId) {
    return this.workers.filter((w) => {
      if (!w.client?.isReady()) return false;
      return w.client.guilds.cache.has(guildId);
    });
  }

  /**
   * Find the best free worker for a guild.
   * Prefers lowest index that is available.
   */
  findFreeWorker(guildId, tier = "free") {
    const available = this.getAvailableWorkers(guildId, tier);
    if (available.length === 0) return null;
    available.sort((a, b) => Number(a.config.index || 0) - Number(b.config.index || 0));
    return available[0];
  }

  /**
   * Get a specific worker by index.
   */
  getWorkerByIndex(index) {
    return this.workers.find((w) => Number(w.config.index || 0) === Number(index));
  }

  /**
   * Get the worker currently streaming in a guild.
   * Returns the first worker found streaming (there should be at most one per user expectation,
   * but multiple are possible if users manually assigned different workers).
   */
  getStreamingWorkers(guildId) {
    return this.workers.filter((w) => {
      const state = w.guildState.get(guildId);
      return state?.currentStationKey && state?.connection;
    });
  }

  /**
   * Get all worker statuses for the API / web display.
   */
  getAllStatuses() {
    return this.workers.map((w) => {
      const idx = Number(w.config.index || 0);
      const guilds = [];
      if (w.client?.isReady()) {
        for (const [guildId, state] of w.guildState.entries()) {
          if (state?.currentStationKey && state?.connection) {
            const guild = w.client.guilds.cache.get(guildId);
            guilds.push({
              guildId,
              guildName: guild?.name || "Unknown",
              stationKey: state.currentStationKey || null,
              stationName: state.currentStationName || null,
              channelId: state.lastChannelId || null,
            });
          }
        }
      }

      return {
        index: idx,
        name: w.config.name,
        online: Boolean(w.client?.isReady()),
        totalGuilds: w.client?.isReady() ? w.client.guilds.cache.size : 0,
        activeStreams: guilds.length,
        streams: guilds,
        clientId: w.getApplicationId() || w.config.clientId || "",
      };
    });
  }

  /**
   * Check if a specific worker can be used in a guild for a given tier.
   */
  canUseWorker(workerIndex, guildId, tier = "free") {
    const maxIndex = this.getMaxWorkerIndex(tier);
    if (workerIndex < 1 || workerIndex > maxIndex) {
      return { ok: false, reason: "tier", maxIndex };
    }
    const worker = this.getWorkerByIndex(workerIndex);
    if (!worker) {
      return { ok: false, reason: "not_configured" };
    }
    if (!worker.client?.isReady()) {
      return { ok: false, reason: "offline" };
    }
    if (!worker.client.guilds.cache.has(guildId)) {
      return { ok: false, reason: "not_invited" };
    }
    return { ok: true, worker };
  }
}

export { WorkerManager };
