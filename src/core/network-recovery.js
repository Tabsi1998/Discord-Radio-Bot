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

function normalizeOptions(options = {}) {
  if (typeof options === "string") {
    return { scope: options };
  }
  if (!options || typeof options !== "object") {
    return {};
  }
  return options;
}

function normalizeScope(rawScope) {
  return String(rawScope || "global").trim() || "global";
}

class NetworkRecoveryCoordinator {
  constructor() {
    this.scopes = new Map();
    this.listeners = new Set();
  }

  getScopeState(scope = "global", { createIfMissing = true } = {}) {
    const key = normalizeScope(scope);
    if (!this.scopes.has(key)) {
      if (!createIfMissing) return null;
      this.scopes.set(key, {
        failureCount: 0,
        lastFailureAt: 0,
        lastSuccessAt: Date.now(),
      });
    }
    return this.scopes.get(key);
  }

  noteFailure(source, detail = "", options = {}) {
    const { scope } = normalizeOptions(options);
    const scopeKey = normalizeScope(scope);
    const scopeState = this.getScopeState(scopeKey);
    const now = Date.now();
    if (now - scopeState.lastFailureAt > NETWORK_FAILURE_RESET_MS) {
      scopeState.failureCount = 0;
    }
    scopeState.failureCount += 1;
    scopeState.lastFailureAt = now;
    if (scopeState.failureCount <= 3) {
      log(
        "INFO",
        `[NetworkRecovery] failure noted from ${source} (scope=${scopeKey}, count=${scopeState.failureCount})${detail ? `: ${detail}` : ""}`
      );
    }
  }

  noteSuccess(source, options = {}) {
    const { scope } = normalizeOptions(options);
    const scopeKey = normalizeScope(scope);
    const scopeState = this.getScopeState(scopeKey, { createIfMissing: false });
    if (!scopeState) return;
    const now = Date.now();
    const hadFailures = scopeState.failureCount > 0;
    scopeState.failureCount = 0;
    scopeState.lastSuccessAt = now;
    if (hadFailures) {
      const event = {
        scope: scopeKey,
        source,
        recoveredAt: now,
      };
      log("INFO", `[NetworkRecovery] success noted from ${source} (scope=${scopeKey}) - triggering recovery.`);
      for (const listener of this.listeners) {
        try {
          listener(event);
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

  getRecoveryDelayMs(options = {}) {
    const { scope } = normalizeOptions(options);
    const scopeKey = normalizeScope(scope);
    const scopeState = this.getScopeState(scopeKey, { createIfMissing: false });
    if (!scopeState) return 0;
    if (scopeState.failureCount <= 0) return 0;
    const backoff = NETWORK_COOLDOWN_BASE_MS * Math.pow(1.6, Math.min(scopeState.failureCount - 1, 10));
    return Math.min(NETWORK_COOLDOWN_MAX_MS, applyJitter(backoff, 0.25));
  }

  isNetworkHealthy(options = {}) {
    return this.getRecoveryDelayMs(options) <= 0;
  }

  reset(options = {}) {
    const normalized = normalizeOptions(options);
    const hasScope = Object.prototype.hasOwnProperty.call(normalized, "scope");
    if (!hasScope) {
      this.scopes.clear();
      return;
    }

    const scopeKey = normalizeScope(normalized.scope);
    this.scopes.delete(scopeKey);
  }
}

const networkRecoveryCoordinator = new NetworkRecoveryCoordinator();

export { NetworkRecoveryCoordinator, networkRecoveryCoordinator };
