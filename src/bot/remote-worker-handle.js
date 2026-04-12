import { sendWorkerCommandAndWait } from "../core/worker-bridge.js";

function toDateMs(value, fallbackValue = 0) {
  if (!value) return fallbackValue;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallbackValue;
}

function buildRemoteConnection(detail) {
  const channelId = String(detail?.channelId || "").trim();
  if (!channelId || detail?.playing !== true) return null;
  return {
    joinConfig: {
      channelId,
    },
  };
}

function normalizeRemoteVolume(value, fallback = 100) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(100, parsed));
}

function buildRemoteGuildState(detail = {}) {
  const channelId = String(detail?.channelId || "").trim();
  return {
    player: {
      state: {
        status: detail?.playing ? "playing" : (detail?.recovering ? "buffering" : "idle"),
        resource: null,
      },
    },
    connection: buildRemoteConnection(detail),
    currentStationKey: detail?.stationKey || null,
    currentStationName: detail?.stationName || null,
    currentMeta: detail?.meta || null,
    lastChannelId: channelId || null,
    volume: normalizeRemoteVolume(detail?.volume, 100),
    shouldReconnect: detail?.shouldReconnect === true,
    reconnectCount: Number(detail?.reconnectCount || 0) || 0,
    lastReconnectAt: detail?.lastReconnectAt || null,
    reconnectAttempts: Number(detail?.reconnectAttempts || 0) || 0,
    reconnectTimer: detail?.reconnectPending ? { active: true } : null,
    reconnectInFlight: detail?.reconnectInFlight === true,
    reconnectCircuitTripCount: Number(detail?.reconnectCircuitTripCount || 0) || 0,
    reconnectCircuitOpenUntil: Number(detail?.reconnectCircuitOpenUntil || 0) || 0,
    streamRestartTimer: detail?.streamRestartPending ? { active: true } : null,
    voiceConnectInFlight: detail?.voiceConnectInFlight === true,
    lastStreamErrorAt: detail?.lastStreamErrorAt || null,
    streamErrorCount: Number(detail?.streamErrorCount || 0) || 0,
    lastProcessExitCode: detail?.lastProcessExitCode ?? null,
    lastProcessExitDetail: detail?.lastProcessExitDetail || null,
    lastProcessExitAt: detail?.lastProcessExitAt || 0,
    lastStreamEndReason: detail?.lastStreamEndReason || null,
    lastStreamStartAt: toDateMs(detail?.lastStreamStartAt, 0),
    lastNetworkFailureAt: detail?.lastNetworkFailureAt || 0,
    voiceDisconnectObservedAt: detail?.voiceDisconnectObservedAt || 0,
    currentListenerCount: Number(detail?.listenerCount || 0) || 0,
    activeScheduledEventId: detail?.activeScheduledEventId || null,
    activeScheduledEventStopAtMs: Number(detail?.activeScheduledEventStopAtMs || 0) || 0,
    restoreBlockedUntil: Number(detail?.restoreBlockedUntil || 0) || 0,
    restoreBlockedAt: Number(detail?.restoreBlockedAt || 0) || 0,
    restoreBlockCount: Number(detail?.restoreBlockCount || 0) || 0,
    restoreBlockReason: detail?.restoreBlockReason || null,
    networkRecoveryDelayMs: Number(detail?.networkRecoveryDelayMs || 0) || 0,
  };
}

function buildRemoteGuildObject(summary = {}, detail = null) {
  const guildId = String(summary?.guildId || summary?.id || "").trim();
  const guildName = String(summary?.guildName || summary?.name || guildId || "Unknown").trim() || guildId;
  const channelId = String(detail?.channelId || "").trim();
  const channelName = String(detail?.channelName || channelId || "").trim();
  const channelCache = new Map();
  if (channelId) {
    channelCache.set(channelId, {
      id: channelId,
      name: channelName || channelId,
    });
  }

  const me = channelId
    ? { voice: { channelId } }
    : null;

  const guild = {
    id: guildId,
    name: guildName,
    memberCount: Number(summary?.memberCount || 0) || 0,
    channels: {
      cache: channelCache,
    },
    members: {
      me,
      async fetchMe() {
        return me;
      },
    },
  };

  return guild;
}

class RemoteWorkerHandle {
  constructor(config, options = {}) {
    this.config = config;
    this.role = "worker";
    this.remote = true;
    this.workerSlot = Number(options?.workerSlot || 0) || null;
    this.commandTimeoutMs = Math.max(5_000, Number(options?.commandTimeoutMs || 45_000) || 45_000);
    this.latestWorkerDoc = null;
    this.latestStatus = {
      botId: config?.id || null,
      id: config?.id || null,
      name: config?.name || "Worker",
      ready: false,
      guilds: 0,
      users: 0,
      connections: 0,
      listeners: 0,
      guildDetails: [],
    };
    this.guildState = new Map();
    this.guildCache = new Map();
    this.startedAt = Date.now();
    this.client = {
      isReady: () => this.isReady(),
      guilds: {
        cache: this.guildCache,
        fetch: async (guildId) => this.guildCache.get(String(guildId || "").trim()) || null,
      },
      user: {
        get tag() {
          return this._tag || null;
        },
        set tag(value) {
          this._tag = value;
        },
        displayAvatarURL: () => this.latestStatus?.avatarUrl || null,
      },
      shard: null,
    };
  }

  isReady() {
    const heartbeatAt = Date.parse(String(this.latestWorkerDoc?.heartbeatAt || "")) || 0;
    if (!heartbeatAt) return false;
    const staleAfterMs = Math.max(30_000, Number.parseInt(String(process.env.REMOTE_WORKER_STATUS_STALE_MS || "45000"), 10) || 45_000);
    if (Date.now() - heartbeatAt > staleAfterMs) {
      return false;
    }
    return this.latestStatus?.ready === true;
  }

  getApplicationId() {
    return String(this.latestStatus?.clientId || this.config?.clientId || "").trim() || null;
  }

  getRuntimeMetrics() {
    const metrics = this.latestWorkerDoc?.runtimeMetrics;
    return metrics && typeof metrics === "object" ? metrics : {};
  }

  applyRemoteStatus(workerDoc = null) {
    this.latestWorkerDoc = workerDoc || null;
    this.guildState.clear();
    this.guildCache.clear();

    if (!workerDoc || typeof workerDoc !== "object") {
      this.latestStatus = {
        botId: this.config?.id || null,
        id: this.config?.id || null,
        name: this.config?.name || "Worker",
        ready: false,
        guilds: 0,
        users: 0,
        connections: 0,
        listeners: 0,
        guildDetails: [],
      };
      this.client.user.tag = null;
      return;
    }

    const status = workerDoc.status && typeof workerDoc.status === "object"
      ? workerDoc.status
      : {};
    this.latestStatus = {
      ...status,
      ready: status.ready === true,
      guildDetails: Array.isArray(status.guildDetails) ? status.guildDetails : [],
    };

    const startedAtMs = Number(workerDoc?.runtimeMetrics?.startedAtMs || 0) || 0;
    if (startedAtMs > 0) {
      this.startedAt = startedAtMs;
    } else if (Number(this.latestStatus?.uptimeSec || 0) > 0) {
      this.startedAt = Date.now() - (Number(this.latestStatus.uptimeSec) * 1000);
    }

    this.client.user.tag = this.latestStatus?.userTag || null;

    const detailMap = new Map();
    for (const detail of this.latestStatus.guildDetails) {
      const guildId = String(detail?.guildId || "").trim();
      if (!guildId) continue;
      detailMap.set(guildId, detail);
      this.guildState.set(guildId, buildRemoteGuildState(detail));
    }

    const guildSummaries = Array.isArray(workerDoc.guilds) ? workerDoc.guilds : [];
    for (const summary of guildSummaries) {
      const guildId = String(summary?.guildId || summary?.id || "").trim();
      if (!guildId) continue;
      this.guildCache.set(guildId, buildRemoteGuildObject(summary, detailMap.get(guildId) || null));
    }

    for (const [guildId, detail] of detailMap.entries()) {
      if (!this.guildCache.has(guildId)) {
        this.guildCache.set(guildId, buildRemoteGuildObject({
          guildId,
          guildName: detail?.guildName || guildId,
          memberCount: 0,
        }, detail));
      }
    }
  }

  getState(guildId) {
    const normalizedGuildId = String(guildId || "").trim();
    return this.guildState.get(normalizedGuildId) || buildRemoteGuildState();
  }

  getGuildInfo(guildId) {
    const normalizedGuildId = String(guildId || "").trim();
    if (!normalizedGuildId) return null;
    const detail = this.latestStatus.guildDetails.find((entry) => String(entry?.guildId || "").trim() === normalizedGuildId) || null;
    if (!detail) return null;

    return {
      playing: detail?.playing === true,
      stationKey: detail?.stationKey || null,
      stationName: detail?.stationName || null,
      meta: detail?.meta || null,
      volume: normalizeRemoteVolume(detail?.volume, 100),
      channelId: detail?.channelId || null,
      listenerCount: Number(detail?.listenerCount || 0) || 0,
      reconnectAttempts: Number(detail?.reconnectAttempts || 0) || 0,
      reconnectCount: Number(detail?.reconnectCount || 0) || 0,
      lastReconnectAt: detail?.lastReconnectAt || null,
      shouldReconnect: detail?.shouldReconnect === true,
      recovering: detail?.recovering === true,
      streamErrorCount: Number(detail?.streamErrorCount || 0) || 0,
      lastStreamErrorAt: detail?.lastStreamErrorAt || null,
      lastProcessExitCode: detail?.lastProcessExitCode ?? null,
      lastProcessExitDetail: detail?.lastProcessExitDetail || null,
      lastProcessExitAt: detail?.lastProcessExitAt || 0,
      lastStreamEndReason: detail?.lastStreamEndReason || null,
      lastNetworkFailureAt: detail?.lastNetworkFailureAt || 0,
      voiceDisconnectObservedAt: detail?.voiceDisconnectObservedAt || 0,
      lastStreamStartAt: detail?.lastStreamStartAt || null,
      restoreBlockedUntil: Number(detail?.restoreBlockedUntil || 0) || 0,
      restoreBlockedAt: Number(detail?.restoreBlockedAt || 0) || 0,
      restoreBlockCount: Number(detail?.restoreBlockCount || 0) || 0,
      restoreBlockReason: detail?.restoreBlockReason || null,
      networkRecoveryDelayMs: Number(detail?.networkRecoveryDelayMs || 0) || 0,
      reconnectPending: detail?.reconnectPending === true,
      reconnectInFlight: detail?.reconnectInFlight === true,
      streamRestartPending: detail?.streamRestartPending === true,
      voiceConnectInFlight: detail?.voiceConnectInFlight === true,
      reconnectCircuitTripCount: Number(detail?.reconnectCircuitTripCount || 0) || 0,
      reconnectCircuitOpenUntil: Number(detail?.reconnectCircuitOpenUntil || 0) || 0,
      activeScheduledEventId: detail?.activeScheduledEventId || null,
    };
  }

  getCurrentListenerCount(guildId, state = null) {
    const info = this.getGuildInfo(guildId);
    if (info) return Number(info.listenerCount || 0) || 0;
    return Number(state?.currentListenerCount || 0) || 0;
  }

  getPlayingGuildCount() {
    let count = 0;
    for (const state of this.guildState.values()) {
      if (state?.currentStationKey && state?.connection) {
        count += 1;
      }
    }
    return count;
  }

  collectStats() {
    return {
      servers: Number(this.latestStatus?.guilds || this.guildCache.size) || 0,
      users: Number(this.latestStatus?.users || 0) || 0,
      connections: Number(this.latestStatus?.connections || 0) || 0,
      listeners: Number(this.latestStatus?.listeners || 0) || 0,
    };
  }

  buildStatusSnapshot({ includeGuildDetails = false } = {}) {
    if (includeGuildDetails) {
      return {
        ...this.latestStatus,
        guildDetails: Array.isArray(this.latestStatus?.guildDetails) ? this.latestStatus.guildDetails : [],
      };
    }
    const { guildDetails, ...rest } = this.latestStatus || {};
    return {
      ...rest,
      guildDetails: [],
    };
  }

  getPublicStatus() {
    return this.buildStatusSnapshot();
  }

  getDashboardStatus() {
    return this.buildStatusSnapshot({ includeGuildDetails: true });
  }

  getNetworkRecoveryDelayMs(guildId) {
    return Number(this.getGuildInfo(guildId)?.networkRecoveryDelayMs || 0) || 0;
  }

  clearScheduledEventPlaybackInGuild() {
    return { ok: true };
  }

  async sendCommand(type, payload = {}, options = {}) {
    if (!this.isReady()) {
      return {
        ok: false,
        error: "Worker ist offline oder kein Heartbeat verfuegbar.",
      };
    }
    try {
      const response = await sendWorkerCommandAndWait(
        this.config?.id,
        type,
        payload,
        {
          timeoutMs: Math.max(5_000, Number(options?.timeoutMs || 0) || this.commandTimeoutMs),
        }
      );
      return response?.result || {};
    } catch (err) {
      return {
        ok: false,
        error: err?.message || String(err),
      };
    }
  }

  async playInGuild(guildId, channelId, stationKey, stationsData, volume = undefined, options = {}) {
    const payload = {
      guildId,
      channelId,
      stationKey,
      stationsData,
      options,
    };
    const parsedVolume = Number.parseInt(String(volume ?? ""), 10);
    if (Number.isFinite(parsedVolume)) {
      payload.volume = Math.max(0, Math.min(100, parsedVolume));
    }
    return this.sendCommand("play", payload, { timeoutMs: 60_000 });
  }

  async stopInGuild(guildId) {
    return this.sendCommand("stop", { guildId }, { timeoutMs: 15_000 });
  }

  async pauseInGuild(guildId) {
    return this.sendCommand("pause", { guildId }, { timeoutMs: 15_000 });
  }

  async resumeInGuild(guildId) {
    return this.sendCommand("resume", { guildId }, { timeoutMs: 15_000 });
  }

  async setVolumeInGuild(guildId, value) {
    return this.sendCommand("setVolume", { guildId, value }, { timeoutMs: 15_000 });
  }
}

export { RemoteWorkerHandle };
