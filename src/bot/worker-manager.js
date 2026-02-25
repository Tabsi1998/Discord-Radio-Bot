// ============================================================
// OmniFM: Worker Manager - Worker Assignment & Coordination
// ============================================================
import { TIERS } from "../lib/helpers.js";

class WorkerManager {
  /**
   * @param {BotRuntime[]} workers - Worker bot instances
   */
  constructor(workers = []) {
    this.workers = [...workers].sort((a, b) => Number(a?.config?.index || 0) - Number(b?.config?.index || 0));
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
   * Resolve worker slot (1-based) for a runtime instance.
   */
  getWorkerSlot(workerRuntime) {
    const idx = this.workers.findIndex((w) => w === workerRuntime);
    return idx >= 0 ? idx + 1 : null;
  }

  /**
   * Resolve worker by slot number (1-based).
   */
  getWorkerBySlot(slot) {
    const workerSlot = Number.parseInt(String(slot || ""), 10);
    if (!Number.isFinite(workerSlot) || workerSlot < 1) return null;
    return this.workers[workerSlot - 1] || null;
  }

  /**
   * Resolve worker by absolute BOT_N index from config.
   */
  getWorkerByBotIndex(botIndex) {
    const botIdx = Number.parseInt(String(botIndex || ""), 10);
    if (!Number.isFinite(botIdx) || botIdx < 1) return null;
    return this.workers.find((w) => Number(w?.config?.index || 0) === botIdx) || null;
  }

  /**
   * Resolve input index to worker + slot.
   * Primary mode is worker-slot (1..N). For compatibility, BOT_N index is accepted as fallback.
   */
  resolveWorker(inputIndex) {
    const bySlot = this.getWorkerBySlot(inputIndex);
    if (bySlot) {
      return { worker: bySlot, workerSlot: this.getWorkerSlot(bySlot), mode: "slot" };
    }
    const byBotIndex = this.getWorkerByBotIndex(inputIndex);
    if (byBotIndex) {
      return { worker: byBotIndex, workerSlot: this.getWorkerSlot(byBotIndex), mode: "botIndex" };
    }
    return null;
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
      const workerSlot = this.getWorkerSlot(w);
      if (!workerSlot || workerSlot > maxIndex) return false;
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
  getInvitedWorkers(guildId, tier = null) {
    const maxIndex = tier ? this.getMaxWorkerIndex(tier) : Number.POSITIVE_INFINITY;
    return this.workers.filter((w) => {
      const workerSlot = this.getWorkerSlot(w);
      if (!workerSlot || workerSlot > maxIndex) return false;
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
    available.sort((a, b) => Number(this.getWorkerSlot(a) || 0) - Number(this.getWorkerSlot(b) || 0));
    return available[0];
  }

  /**
   * Get a specific worker by slot (preferred) or BOT_N index (fallback).
   */
  getWorkerByIndex(index) {
    return this.resolveWorker(index)?.worker || null;
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
      const slot = this.getWorkerSlot(w);
      const botIndex = Number(w?.config?.index || 0) || null;
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
        index: slot,
        botIndex,
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
    const resolved = this.resolveWorker(workerIndex);
    if (!resolved) {
      return { ok: false, reason: "not_configured", maxIndex };
    }
    const workerSlot = Number(resolved.workerSlot || 0);
    if (!workerSlot || workerSlot > maxIndex) {
      return { ok: false, reason: "tier", maxIndex };
    }
    const worker = resolved.worker;
    if (!worker.client?.isReady()) {
      return { ok: false, reason: "offline" };
    }
    if (!worker.client.guilds.cache.has(guildId)) {
      return { ok: false, reason: "not_invited" };
    }
    return { ok: true, worker, workerSlot, mode: resolved.mode };
  }
}

export { WorkerManager };
