// ============================================================
// OmniFM: Network Recovery Coordinator
// ============================================================
import { log } from "../lib/logging.js";
import {
  NETWORK_COOLDOWN_BASE_MS,
  NETWORK_COOLDOWN_MAX_MS,
  NETWORK_FAILURE_RESET_MS,
  applyJitter,
} from "../lib/helpers.js";

class NetworkRecoveryCoordinator {
  constructor() {
    this.failureCount = 0;
    this.lastFailureAt = 0;
    this.lastSuccessAt = Date.now();
    this.listeners = new Set();
  }

  noteFailure(source, detail = "") {
    const now = Date.now();
    if (now - this.lastFailureAt > NETWORK_FAILURE_RESET_MS) {
      this.failureCount = 0;
    }
    this.failureCount += 1;
    this.lastFailureAt = now;
    if (this.failureCount <= 3) {
      log("INFO", `[NetworkRecovery] failure noted from ${source} (count=${this.failureCount})${detail ? `: ${detail}` : ""}`);
    }
  }

  noteSuccess(source) {
    const now = Date.now();
    const hadFailures = this.failureCount > 0;
    this.failureCount = 0;
    this.lastSuccessAt = now;
    if (hadFailures) {
      log("INFO", `[NetworkRecovery] success noted from ${source} - triggering recovery.`);
      for (const listener of this.listeners) {
        try {
          listener();
        } catch {
          // ignore
        }
      }
    }
  }

  onRecovered(fn) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getRecoveryDelayMs() {
    if (this.failureCount <= 0) return 0;
    const backoff = NETWORK_COOLDOWN_BASE_MS * Math.pow(1.6, Math.min(this.failureCount - 1, 10));
    return Math.min(NETWORK_COOLDOWN_MAX_MS, applyJitter(backoff, 0.25));
  }

  isNetworkHealthy() {
    return this.failureCount <= 0;
  }
}

const networkRecoveryCoordinator = new NetworkRecoveryCoordinator();

export { NetworkRecoveryCoordinator, networkRecoveryCoordinator };
