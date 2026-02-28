// ============================================================
// OmniFM: Now-Playing Update Queue + Shared Cache
// Verhindert Overload bei vielen parallelen Updates
// ============================================================

import { log } from "./logging.js";

class NowPlayingQueue {
  constructor(maxConcurrent = 5, cacheMaxSize = 1000) {
    this.queue = [];
    this.active = new Set();
    this.queuedById = new Map();
    this.sharedCoverCache = new Map();
    this.maxConcurrent = maxConcurrent;
    this.cacheMaxSize = cacheMaxSize;
    this.stats = {
      totalEnqueued: 0,
      totalProcessed: 0,
      cacheHits: 0,
      cacheMisses: 0,
    };
  }

  /**
   * Enqueue an update task
   * @param {string} taskId - Unique ID (e.g., "guildId-serverId")
   * @param {Function} updateFn - Async function to execute
   * @returns {Promise} Resolves when task completes
   */
  enqueue(taskId, updateFn) {
    const normalizedTaskId = String(taskId || "").trim();
    const existingQueued = normalizedTaskId ? this.queuedById.get(normalizedTaskId) : null;
    if (existingQueued) {
      existingQueued.fn = updateFn;
      return existingQueued.promise;
    }

    const task = {
      id: normalizedTaskId || taskId,
      fn: updateFn,
      resolve: null,
      reject: null,
      enqueuedAt: Date.now(),
      promise: null,
    };

    task.promise = new Promise((resolve, reject) => {
      task.resolve = resolve;
      task.reject = reject;
    });

    this.queue.push(task);
    if (normalizedTaskId) {
      this.queuedById.set(normalizedTaskId, task);
    }
    this.stats.totalEnqueued++;
    this.process();
    return task.promise;
  }

  /**
   * Process queue - maintains max concurrent limit
   */
  async process() {
    while (this.active.size < this.maxConcurrent && this.queue.length > 0) {
      const task = this.queue.shift();
      if (task?.id) {
        this.queuedById.delete(String(task.id));
      }
      
      const promise = (async () => {
        try {
          const result = await task.fn();
          task.resolve(result);
        } catch (err) {
          log("ERROR", `[NowPlayingQueue] Task ${task.id} failed: ${err?.message || err}`);
          task.reject(err);
        } finally {
          this.active.delete(promise);
          this.stats.totalProcessed++;
          this.process(); // Continue processing next task
        }
      })();

      this.active.add(promise);
    }
  }

  /**
   * Get cached cover art
   * @param {string} cacheKey - e.g., "artist|title"
   * @returns {string|null} Cover URL or null
   */
  getCachedCover(cacheKey) {
    if (!cacheKey) return null;
    
    const cached = this.sharedCoverCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      this.stats.cacheHits++;
      return cached.url || null;
    }
    
    this.stats.cacheMisses++;
    return null;
  }

  /**
   * Set cover art cache
   * @param {string} cacheKey - e.g., "artist|title"
   * @param {string|null} url - Cover URL
   * @param {number} ttlMs - Time to live in milliseconds
   */
  setCachedCover(cacheKey, url, ttlMs) {
    if (!cacheKey) return;
    
    // Prevent cache explosion
    if (this.sharedCoverCache.size >= this.cacheMaxSize) {
      const oldestKey = Array.from(this.sharedCoverCache.entries())
        .sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0]?.[0];
      
      if (oldestKey) {
        this.sharedCoverCache.delete(oldestKey);
      }
    }

    this.sharedCoverCache.set(cacheKey, {
      url: url || null,
      expiresAt: Date.now() + ttlMs,
      createdAt: Date.now(),
    });
  }

  /**
   * Clear all caches and queue
   */
  clear() {
    this.queue = [];
    this.active.clear();
    this.queuedById.clear();
    this.sharedCoverCache.clear();
  }

  /**
   * Get queue statistics
   */
  getStats() {
    return {
      ...this.stats,
      queueLength: this.queue.length,
      activeCount: this.active.size,
      cacheSize: this.sharedCoverCache.size,
      maxConcurrent: this.maxConcurrent,
      cacheHitRate: this.stats.totalProcessed > 0 
        ? Math.round((this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses)) * 100)
        : 0,
    };
  }

  /**
   * Get queue status for diagnostics
   */
  getStatus() {
    const stats = this.getStats();
    return {
      status: this.active.size < this.maxConcurrent ? "idle" : "busy",
      line: `Queue: ${stats.queueLength} waiting, ${stats.activeCount}/${stats.maxConcurrent} active, Cache: ${stats.cacheSize}/${this.cacheMaxSize} (${stats.cacheHitRate}% hits)`,
    };
  }
}

export { NowPlayingQueue };
