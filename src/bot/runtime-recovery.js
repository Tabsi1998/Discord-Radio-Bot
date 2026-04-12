import { ChannelType, PermissionFlagsBits } from "discord.js";
import {
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";

import { log } from "../lib/logging.js";
import {
  applyJitter,
  isLikelyNetworkFailureLine,
  waitMs,
  VOICE_RECONNECT_MAX_MS,
  VOICE_RECONNECT_EXP_STEPS,
} from "../lib/helpers.js";
import { clearBotGuild, getBotState } from "../bot-state.js";
import { getServerPlanConfig } from "../core/entitlements.js";
import { networkRecoveryCoordinator } from "../core/network-recovery.js";
import {
  recordStationStop,
  recordConnectionEvent,
} from "../listening-stats-store.js";

function toPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue ?? fallbackValue), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

const VOICE_STATE_RECONCILE_ENABLED = String(process.env.VOICE_STATE_RECONCILE_ENABLED ?? "1") !== "0";
const VOICE_STATE_RECONCILE_MS = Math.max(15_000, toPositiveInt(process.env.VOICE_STATE_RECONCILE_MS, 30_000));
const VOICE_TRANSIENT_RECHECK_MS = Math.max(2_000, toPositiveInt(process.env.VOICE_TRANSIENT_RECHECK_MS, 5_000));
const VOICE_STATE_MISSING_CONFIRMATIONS = Math.max(2, toPositiveInt(process.env.VOICE_STATE_MISSING_CONFIRMATIONS, 2));
const VOICE_RECONNECT_RESOURCE_CONFIRMATIONS = Math.max(2, toPositiveInt(process.env.VOICE_RECONNECT_RESOURCE_CONFIRMATIONS, 3));
const VOICE_RECONNECT_PERMISSION_CONFIRMATIONS = Math.max(
  VOICE_RECONNECT_RESOURCE_CONFIRMATIONS,
  toPositiveInt(process.env.VOICE_RECONNECT_PERMISSION_CONFIRMATIONS, 6)
);
const VOICE_RECONNECT_READY_FAILURE_CONFIRMATIONS = Math.max(
  2,
  toPositiveInt(process.env.VOICE_RECONNECT_READY_FAILURE_CONFIRMATIONS, 4)
);
const VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS = Math.max(
  5,
  toPositiveInt(process.env.VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS, 30)
);
const VOICE_RECONNECT_CIRCUIT_BREAKER_MS = Math.max(
  60_000,
  toPositiveInt(process.env.VOICE_RECONNECT_CIRCUIT_BREAKER_MS, 15 * 60_000)
);
const VOICE_RECONNECT_MAX_CIRCUIT_TRIPS = Math.max(
  1,
  toPositiveInt(process.env.VOICE_RECONNECT_MAX_CIRCUIT_TRIPS, 3)
);
const RESTORE_RETRY_BASE_MS = Math.max(5_000, toPositiveInt(process.env.RESTORE_RETRY_BASE_MS, 15_000));
const RESTORE_RETRY_MAX_MS = Math.max(30_000, toPositiveInt(process.env.RESTORE_RETRY_MAX_MS, 5 * 60_000));
const VOICE_NETWORK_ERROR_RETRY_MIN_MS = 15_000;
const VOICE_NETWORK_ERROR_RETRY_JITTER = 0.6;

const PERMANENT_RESTORE_GUILD_ERROR_CODES = new Set([10004, 50001]);
const PERMANENT_RESTORE_CHANNEL_ERROR_CODES = new Set([10003]);

function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

function getRuntimeRecoveryDelayMs(runtime, guildId) {
  if (typeof runtime?.getNetworkRecoveryDelayMs === "function") {
    return runtime.getNetworkRecoveryDelayMs(guildId);
  }
  return networkRecoveryCoordinator.getRecoveryDelayMs();
}

function noteRuntimeRecoveryFailure(runtime, guildId, source, detail = "") {
  if (typeof runtime?.noteNetworkRecoveryFailure === "function") {
    runtime.noteNetworkRecoveryFailure(guildId, source, detail);
    return;
  }
  networkRecoveryCoordinator.noteFailure(source, detail);
}

function noteRuntimeRecoverySuccess(runtime, guildId, source) {
  if (typeof runtime?.noteNetworkRecoverySuccess === "function") {
    runtime.noteNetworkRecoverySuccess(guildId, source);
    return;
  }
  networkRecoveryCoordinator.noteSuccess(source);
}

function runtimeRecoveryScopeMatches(runtime, guildId, recoveryEvent = null) {
  const recoveredScope = String(recoveryEvent?.scope || "").trim();
  if (!recoveredScope) return true;
  if (typeof runtime?.getNetworkRecoveryScope !== "function") return true;
  return runtime.getNetworkRecoveryScope(guildId) === recoveredScope;
}

function hasRecoverableRuntimeState(state) {
  return Boolean(
    state?.currentStationKey
    && state?.lastChannelId
    && (
      state?.connection
      || state?.currentProcess
      || state?.reconnectTimer
      || state?.reconnectInFlight
      || state?.voiceConnectInFlight
      || state?.shouldReconnect
    )
  );
}

function getRuntimeErrorMessage(err) {
  return String(err?.message || err || "unknown").trim() || "unknown";
}

function isRecoverableVoiceConnectionError(err) {
  return isLikelyNetworkFailureLine(getRuntimeErrorMessage(err));
}

function shouldLogRecurringTransientIssue(issue) {
  const count = Number(issue?.count || 0);
  return count === 1 || (count % 5) === 0;
}

function getTransientVoiceIssues(state) {
  if (!state.transientVoiceIssues || typeof state.transientVoiceIssues !== "object") {
    state.transientVoiceIssues = {};
  }
  return state.transientVoiceIssues;
}

function clearTransientVoiceIssue(state, code) {
  if (!state?.transientVoiceIssues || !code) return;
  delete state.transientVoiceIssues[code];
}

function clearTransientVoiceIssues(state, codes = []) {
  if (!state) return;
  if (!Array.isArray(codes) || codes.length === 0) {
    state.transientVoiceIssues = {};
    return;
  }
  for (const code of codes) {
    clearTransientVoiceIssue(state, code);
  }
}

function noteTransientVoiceIssue(state, code, detail = "") {
  const issues = getTransientVoiceIssues(state);
  const now = Date.now();
  const current = issues[code] || {
    count: 0,
    firstSeenAt: now,
    lastSeenAt: 0,
    lastDetail: "",
  };
  const next = {
    count: Number(current.count || 0) + 1,
    firstSeenAt: current.firstSeenAt || now,
    lastSeenAt: now,
    lastDetail: String(detail || ""),
  };
  issues[code] = next;
  return next;
}

function abortRuntimeReconnectTarget(runtime, guildId, state, reason, { logLevel = "WARN" } = {}) {
  const channelId = String(state?.lastChannelId || "").trim();
  const detail = String(reason || "unknown").trim().slice(0, 200) || "unknown";
  log(logLevel, `[${runtime.config.name}] Auto-Reconnect gestoppt fuer guild=${guildId}: ${detail}`);
  recordConnectionEvent(guildId, {
    botId: runtime.config.id || "",
    eventType: "error",
    channelId,
    details: `Auto reconnect stopped: ${detail}`.slice(0, 200),
  });
  runtime.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
}

function getDiscordErrorCode(err) {
  const parsed = Number.parseInt(String(err?.code ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPermanentRestoreResourceError(err, resourceType) {
  const code = getDiscordErrorCode(err);
  if (!Number.isFinite(code)) return false;
  if (resourceType === "guild") return PERMANENT_RESTORE_GUILD_ERROR_CODES.has(code);
  if (resourceType === "channel") return PERMANENT_RESTORE_CHANNEL_ERROR_CODES.has(code);
  return false;
}

function getRuntimeRestoreTimers(runtime) {
  if (!(runtime.pendingRestoreTimers instanceof Map)) {
    runtime.pendingRestoreTimers = new Map();
  }
  return runtime.pendingRestoreTimers;
}

function getRuntimeRestoreRetryCounts(runtime) {
  if (!(runtime.restoreRetryCounts instanceof Map)) {
    runtime.restoreRetryCounts = new Map();
  }
  return runtime.restoreRetryCounts;
}

export function clearRuntimeRestoreRetry(runtime, guildId) {
  const key = String(guildId || "").trim();
  if (!key) return;
  const timers = getRuntimeRestoreTimers(runtime);
  const retryCounts = getRuntimeRestoreRetryCounts(runtime);
  const timer = timers.get(key);
  if (timer) {
    clearTimeout(timer);
    timers.delete(key);
  }
  retryCounts.delete(key);
}

function getRestoreRetryDelay(runtime, guildId) {
  const key = String(guildId || "").trim();
  const retryCounts = getRuntimeRestoreRetryCounts(runtime);
  const attempt = Number(retryCounts.get(key) || 0) + 1;
  retryCounts.set(key, attempt);
  const exp = Math.min(Math.max(0, attempt - 1), 6);
  const baseDelay = Math.min(RESTORE_RETRY_MAX_MS, RESTORE_RETRY_BASE_MS * Math.pow(2, exp));
  return {
    attempt,
    delay: applyJitter(baseDelay, 0.2),
  };
}

async function fetchRestoreGuild(runtime, guildId) {
  const cachedGuild = runtime.client.guilds.cache.get(guildId);
  if (cachedGuild) {
    return { guild: cachedGuild, error: null, source: "cache" };
  }
  try {
    const guild = await runtime.client.guilds.fetch(guildId);
    return { guild, error: null, source: "api" };
  } catch (err) {
    return { guild: null, error: err, source: "api" };
  }
}

async function fetchRestoreChannel(guild, channelId) {
  const cachedChannel = guild.channels.cache.get(channelId);
  if (cachedChannel) {
    return { channel: cachedChannel, error: null, source: "cache" };
  }
  try {
    const channel = await guild.channels.fetch(channelId);
    return { channel, error: null, source: "api" };
  } catch (err) {
    return { channel: null, error: err, source: "api" };
  }
}

function scheduleRuntimeRestoreRetry(runtime, guildId, data, stations, reason = "retry") {
  const key = String(guildId || "").trim();
  if (!key) return;
  const timers = getRuntimeRestoreTimers(runtime);
  if (timers.has(key)) return;

  const { attempt, delay } = getRestoreRetryDelay(runtime, key);
  log(
    "WARN",
    `[${runtime.config.name}] Restore fuer guild=${key} verschoben (${reason}) - retry in ${Math.round(delay)}ms (attempt ${attempt}).`
  );

  const timer = setTimeout(() => {
    timers.delete(key);
    restoreRuntimeGuildEntry(runtime, key, data, stations, { source: "restore-retry", reason }).catch((err) => {
      log("ERROR", `[${runtime.config.name}] Restore-Retry fehlgeschlagen fuer Guild ${key}: ${err?.message || err}`);
      const state = runtime.guildState?.get?.(key);
      if (state?.shouldReconnect && state?.currentStationKey && state?.lastChannelId) {
        runtime.scheduleReconnect?.(key, { reason: "restore-retry-error" });
      }
    });
  }, delay);
  if (typeof timer?.unref === "function") {
    timer.unref();
  }
  timers.set(key, timer);
}

function syncObservedRuntimeChannel(runtime, state, actualChannelId) {
  const normalizedActualChannelId = String(actualChannelId || "").trim();
  if (!normalizedActualChannelId) return false;
  if (String(state?.lastChannelId || "").trim() === normalizedActualChannelId) {
    return false;
  }
  runtime.markNowPlayingTargetDirty(state, normalizedActualChannelId);
  state.lastChannelId = normalizedActualChannelId;
  runtime.persistState();
  return true;
}

function confirmTransientVoiceIssue(runtime, guildId, state, code, detail, {
  threshold,
  recheckReason,
  logMessage,
} = {}) {
  const issue = noteTransientVoiceIssue(state, code, detail);
  const needed = Math.max(1, Number(threshold || 1) || 1);
  const confirmed = issue.count >= needed;
  if (!confirmed) {
    log(
      "WARN",
      `[${runtime.config.name}] ${logMessage} guild=${guildId} (${issue.count}/${needed}) - warte auf Bestaetigung.`
    );
    runtime.queueVoiceStateReconcile(guildId, recheckReason || code, VOICE_TRANSIENT_RECHECK_MS);
  }
  return { ...issue, confirmed, threshold: needed };
}

export function handleRuntimeBotVoiceStateUpdate(runtime, oldState, newState) {
  if (!runtime.client.user) return;
  if (newState.id !== runtime.client.user.id) return;

  const guildId = newState.guild.id;
  const state = runtime.getState(guildId);
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;

  if (newChannelId) {
    clearTransientVoiceIssues(state);
    state.voiceDisconnectObservedAt = 0;
    if (state.lastChannelId !== newChannelId) {
      runtime.markNowPlayingTargetDirty(state, newChannelId);
      runtime.invalidateVoiceStatus?.(state);
    }
    state.lastChannelId = newChannelId;
    if (state.reconnectTimer) {
      runtime.clearReconnectTimer(state);
      state.reconnectAttempts = 0;
    }
    runtime.persistState();
    if (state.currentStationKey) {
      runtime.syncVoiceChannelStatus(guildId, state.currentStationName || state.currentStationKey).catch(() => null);
    }
    runtime.queueVoiceStateReconcile(guildId, "voice-state-update", 1500);
    return;
  }

  if (!oldChannelId) return;

  const shouldAutoReconnect = Boolean(state.shouldReconnect && state.currentStationKey && state.lastChannelId);

  if (shouldAutoReconnect) {
    runtime.invalidateVoiceStatus?.(state);
    state.voiceDisconnectObservedAt = state.voiceDisconnectObservedAt || Date.now();
    const issue = noteTransientVoiceIssue(
      state,
      "voice-state-update-missing",
      `${oldChannelId}:${state.lastChannelId || oldChannelId}`
    );
    if (issue.count === 1 || (issue.count % 5) === 0) {
      const phase = state.voiceConnectInFlight || state.reconnectInFlight || state.reconnectTimer
        ? " (connect/reconnect aktiv)"
        : "";
      log(
        "WARN",
        `[${runtime.config.name}] Voice-State meldet Disconnect guild=${guildId} channel=${oldChannelId}${phase} - warte auf Reconcile (${issue.count}).`
      );
    }
    runtime.queueVoiceStateReconcile(guildId, "voice-state-update-missing", 1500);
    return;
  }

  runtime.resetVoiceSession(guildId, state, {
    preservePlaybackTarget: false,
    clearLastChannel: true,
  });
  log(
    "INFO",
    `[${runtime.config.name}] Voice left (Guild ${guildId}, Channel ${oldChannelId}). No reconnect.`
  );
}

export function resetRuntimeVoiceSession(
  runtime,
  guildId,
  state,
  { preservePlaybackTarget = false, clearLastChannel = false } = {}
) {
  if (!state) return;
  if (!preservePlaybackTarget) {
    clearRuntimeRestoreRetry(runtime, guildId);
  }
  runtime.clearQueuedVoiceReconcile(guildId);
  clearTransientVoiceIssues(state);
  runtime.invalidateVoiceStatus?.(state, { clearText: true });

  if (!preservePlaybackTarget && state.currentStationKey) {
    recordStationStop(guildId, { botId: runtime.config.id || "" });
  }

  if (state.connection) {
    try { state.connection.destroy(); } catch {}
    state.connection = null;
  }

  state.player.stop();
  runtime.clearCurrentProcess(state);
  runtime.clearReconnectTimer(state);
  runtime.clearNowPlayingTimer(state);
  runtime.syncVoiceChannelStatus(guildId, "").catch(() => null);
  state.voiceDisconnectObservedAt = 0;

  if (!preservePlaybackTarget) {
    state.currentStationKey = null;
    state.currentStationName = null;
    state.currentMeta = null;
    state.nowPlayingSignature = null;
    state.nowPlayingMessageId = null;
    state.nowPlayingChannelId = null;
    runtime.clearScheduledEventPlayback(state);
  }

  if (clearLastChannel) {
    state.lastChannelId = null;
  }

  if (!preservePlaybackTarget) {
    state.reconnectAttempts = 0;
    state.streamErrorCount = 0;
    state.idleRestartStreak = 0;
    state.lastIdleRestartAt = 0;
    state.lastProcessExitDetail = null;
    state.lastStreamEndReason = null;
  }

  runtime.updatePresence();
  runtime.persistState();
}

export function clearQueuedRuntimeVoiceReconcile(runtime, guildId) {
  const key = String(guildId || "").trim();
  const timer = runtime.pendingVoiceReconcileTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    runtime.pendingVoiceReconcileTimers.delete(key);
  }
}

export function queueRuntimeVoiceStateReconcile(runtime, guildId, reason = "queued", delayMs = 1200) {
  const key = String(guildId || "").trim();
  if (!key) return;
  runtime.clearQueuedVoiceReconcile(key);
  const timer = setTimeout(() => {
    runtime.pendingVoiceReconcileTimers.delete(key);
    runtime.reconcileGuildVoiceState(key, { reason }).catch((err) => {
      log("WARN", `[${runtime.config.name}] Voice-State-Reconcile (${reason}) fehlgeschlagen guild=${key}: ${err?.message || err}`);
    });
  }, Math.max(0, delayMs));
  if (typeof timer?.unref === "function") {
    timer.unref();
  }
  runtime.pendingVoiceReconcileTimers.set(key, timer);
}

export async function confirmRuntimeBotVoiceChannel(
  runtime,
  guildId,
  expectedChannelId,
  { timeoutMs = 10_000, intervalMs = 800 } = {}
) {
  const normalizedGuildId = String(guildId || "").trim();
  const normalizedChannelId = String(expectedChannelId || "").trim();
  if (!normalizedGuildId || !normalizedChannelId) return false;

  const startedAt = Date.now();
  while ((Date.now() - startedAt) <= Math.max(intervalMs, timeoutMs)) {
    const { channelId } = await runtime.fetchBotVoiceState(normalizedGuildId);
    if (String(channelId || "").trim() === normalizedChannelId) {
      return true;
    }
    await waitMs(intervalMs);
  }
  return false;
}

export async function fetchRuntimeBotVoiceState(runtime, guildId) {
  const guild = runtime.client.guilds.cache.get(guildId) || await runtime.client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { guild: null, voiceState: null, channelId: null };

  try {
    const voiceState = await guild.voiceStates.fetch("@me", { force: true, cache: true });
    return { guild, voiceState, channelId: voiceState?.channelId || null };
  } catch {
    const cachedMember = guild.members?.me || null;
    const cachedChannelId = String(cachedMember?.voice?.channelId || "").trim();
    if (cachedChannelId) {
      return { guild, voiceState: cachedMember.voice || null, channelId: cachedChannelId };
    }

    const fetchedMember = await guild.members?.fetchMe?.().catch(() => null);
    const memberChannelId = String(fetchedMember?.voice?.channelId || "").trim();
    return {
      guild,
      voiceState: fetchedMember?.voice || null,
      channelId: memberChannelId || null,
    };
  }
}

export async function reconcileRuntimeGuildVoiceState(runtime, guildId, { reason = "periodic" } = {}) {
  if (!runtime.client.isReady()) return;
  const state = runtime.guildState.get(guildId);
  if (!state) return;
  if (!state.connection && !state.currentStationKey && !state.lastChannelId) return;

  const { channelId: actualChannelId } = await runtime.fetchBotVoiceState(guildId);
  const connectionChannelId = String(state.connection?.joinConfig?.channelId || "").trim() || null;
  let expectedChannelId = connectionChannelId || state.lastChannelId || null;

  if (actualChannelId && !expectedChannelId) {
    syncObservedRuntimeChannel(runtime, state, actualChannelId);
    expectedChannelId = String(actualChannelId || "").trim() || null;
  } else if (actualChannelId && connectionChannelId && actualChannelId === connectionChannelId) {
    if (syncObservedRuntimeChannel(runtime, state, actualChannelId)) {
      expectedChannelId = String(actualChannelId || "").trim() || null;
    }
  }

  const voiceOperationInFlight = Boolean(
    state.voiceConnectInFlight
    || state.reconnectInFlight
    || state.reconnectTimer
  );
  if (voiceOperationInFlight && (!actualChannelId || (expectedChannelId && actualChannelId !== expectedChannelId))) {
    runtime.queueVoiceStateReconcile(guildId, `voice-op-inflight-${reason}`, 1500);
    return;
  }

  if (!actualChannelId) {
    const shouldReconnect = Boolean(state.shouldReconnect && state.currentStationKey && state.lastChannelId);
    if (!state.connection && !state.currentProcess && !shouldReconnect) return;
    if (!state.connection && shouldReconnect && voiceOperationInFlight) {
      return;
    }
    const issue = confirmTransientVoiceIssue(
      runtime,
      guildId,
      state,
      "voice-state-missing",
      `${expectedChannelId || "-"}:${reason}`,
      {
        threshold: VOICE_STATE_MISSING_CONFIRMATIONS,
        recheckReason: `voice-state-confirm-${reason}`,
        logMessage: `Voice-State abweichend erkannt (expected=${expectedChannelId || "-"}, reason=${reason})`,
      }
    );
    if (!issue.confirmed) {
      return;
    }
    clearTransientVoiceIssue(state, "voice-state-missing");
    log(
      "WARN",
      `[${runtime.config.name}] Voice-State abweichung bestaetigt (guild=${guildId}, expected=${expectedChannelId || "-"}, reason=${reason}).`
    );
    state.voiceDisconnectObservedAt = state.voiceDisconnectObservedAt || Date.now();
    runtime.resetVoiceSession(guildId, state, {
      preservePlaybackTarget: shouldReconnect,
      clearLastChannel: !shouldReconnect,
    });
    if (shouldReconnect) {
      runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: `voice-state-${reason}` });
    }
    return;
  }
  clearTransientVoiceIssue(state, "voice-state-missing");
  clearTransientVoiceIssue(state, "voice-state-update-missing");
  state.voiceDisconnectObservedAt = 0;

  if (expectedChannelId && actualChannelId !== expectedChannelId) {
    const issue = confirmTransientVoiceIssue(
      runtime,
      guildId,
      state,
      "voice-channel-mismatch",
      `${expectedChannelId}:${actualChannelId}:${reason}`,
      {
        threshold: VOICE_STATE_MISSING_CONFIRMATIONS,
        recheckReason: `voice-channel-mismatch-confirm-${reason}`,
        logMessage: `Voice-Channel-Mismatch erkannt (expected=${expectedChannelId}, actual=${actualChannelId}, reason=${reason})`,
      }
    );
    if (!issue.confirmed) {
      return;
    }
    clearTransientVoiceIssue(state, "voice-channel-mismatch");
    syncObservedRuntimeChannel(runtime, state, actualChannelId);
    if (!state.currentProcess && state.player.state.status === AudioPlayerStatus.Idle && !state.reconnectTimer) {
      runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: "voice-channel-mismatch" });
      return;
    }
  } else {
    clearTransientVoiceIssue(state, "voice-channel-mismatch");
  }

  if (!state.connection && state.currentStationKey && state.lastChannelId) {
    if (voiceOperationInFlight) return;
    runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: `voice-no-local-connection-${reason}` });
    return;
  }

  if (state.currentStationKey && state.player.state.status === AudioPlayerStatus.Idle && !state.streamRestartTimer && !state.reconnectTimer) {
    runtime.scheduleStreamRestart(guildId, state, 750, `voice-health-${reason}`);
  }
  if (state.currentStationKey) {
    runtime.syncVoiceChannelStatus(guildId, state.currentStationName || state.currentStationKey).catch(() => null);
  }
}

export async function tickRuntimeVoiceStateHealth(runtime) {
  if (!VOICE_STATE_RECONCILE_ENABLED) return;
  if (!runtime.client.isReady()) return;

  for (const guildId of runtime.guildState.keys()) {
    // eslint-disable-next-line no-await-in-loop
    await runtime.reconcileGuildVoiceState(guildId, { reason: "timer" });
  }
}

export function startRuntimeVoiceStateReconciler(runtime) {
  if (!VOICE_STATE_RECONCILE_ENABLED) return;
  if (runtime.voiceHealthTimer) return;

  const run = () => {
    runtime.tickVoiceStateHealth().catch((err) => {
      log("ERROR", `[${runtime.config.name}] Voice-State-Reconcile Fehler: ${err?.message || err}`);
    });
  };

  run();
  runtime.voiceHealthTimer = setInterval(run, VOICE_STATE_RECONCILE_MS);
}

export function stopRuntimeVoiceStateReconciler(runtime) {
  if (runtime.voiceHealthTimer) {
    clearInterval(runtime.voiceHealthTimer);
    runtime.voiceHealthTimer = null;
  }
  for (const guildId of runtime.pendingVoiceReconcileTimers.keys()) {
    runtime.clearQueuedVoiceReconcile(guildId);
  }
}

export function attachRuntimeConnectionHandlers(runtime, guildId, connection) {
  const state = runtime.getState(guildId);

  const markDisconnected = () => {
    if (state.connection === connection) {
      state.connection = null;
      runtime.invalidateVoiceStatus?.(state);
    }
  };

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    recordConnectionEvent(guildId, {
      botId: runtime.config.id || "",
      eventType: "disconnect",
      channelId: state.lastChannelId || "",
      details: "VoiceConnectionStatus.Disconnected",
    });
    if (!state.shouldReconnect) {
      markDisconnected();
      return;
    }

    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      log("INFO", `[${runtime.config.name}] Voice connection recovering for guild=${guildId}`);
    } catch {
      log("INFO", `[${runtime.config.name}] Voice connection recovery failed for guild=${guildId}, destroying`);
      markDisconnected();
      try { connection.destroy(); } catch {}
      runtime.scheduleReconnect(guildId, { reason: "voice-disconnected" });
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    markDisconnected();
    if (state.shouldReconnect && state.currentStationKey && state.lastChannelId) {
      runtime.scheduleReconnect(guildId, { reason: "voice-destroyed" });
    }
  });

  connection.on("error", (err) => {
    const errorMessage = getRuntimeErrorMessage(err);
    const recoverableNetworkError = isRecoverableVoiceConnectionError(errorMessage);
    if (recoverableNetworkError) {
      noteRuntimeRecoveryFailure(runtime, guildId, `${runtime.config.name} voice-error`, `guild=${guildId}: ${errorMessage}`);
    }
    log(recoverableNetworkError ? "WARN" : "ERROR", `[${runtime.config.name}] VoiceConnection error: ${errorMessage}`);
    recordConnectionEvent(guildId, {
      botId: runtime.config.id || "",
      eventType: "error",
      channelId: state.lastChannelId || "",
      details: errorMessage.slice(0, 200),
    });
    markDisconnected();
    if (!state.shouldReconnect) return;
    runtime.scheduleReconnect(
      guildId,
      recoverableNetworkError
        ? {
            reason: "voice-network-error",
            minDelayMs: VOICE_NETWORK_ERROR_RETRY_MIN_MS,
            jitterFactor: VOICE_NETWORK_ERROR_RETRY_JITTER,
          }
        : { reason: "voice-error" }
    );
  });
}

export async function tryRuntimeReconnect(runtime, guildId) {
  const state = runtime.getState(guildId);
  if (state.reconnectInFlight || state.voiceConnectInFlight) return;
  if (!state.shouldReconnect || !state.lastChannelId) return;
  if (runtime.isScheduledEventStopDue(state.activeScheduledEventStopAtMs)) {
    runtime.stopInGuild(guildId);
    return;
  }

  state.reconnectInFlight = true;
  try {
    const networkCooldownMs = getRuntimeRecoveryDelayMs(runtime, guildId);
    if (networkCooldownMs > 0) {
      log(
        "INFO",
        `[${runtime.config.name}] Reconnect fuer guild=${guildId} verschoben (Netz-Cooldown ${Math.round(networkCooldownMs)}ms)`
      );
      return;
    }

    const { guild, error: guildError } = await fetchRestoreGuild(runtime, guildId);
    if (!guild) {
      if (isPermanentRestoreResourceError(guildError, "guild")) {
        clearTransientVoiceIssue(state, "reconnect-guild-missing");
        log("INFO", `[${runtime.config.name}] Reconnect-Ziel Guild ${guildId} ist nicht mehr verfuegbar. Verwerfe Playback-Target.`);
        runtime.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
        return;
      }
      const issue = noteTransientVoiceIssue(
        state,
        "reconnect-guild-missing",
        `${guildId}:${getRuntimeErrorMessage(guildError)}`
      );
      if (shouldLogRecurringTransientIssue(issue)) {
        log(
          "WARN",
          `[${runtime.config.name}] Reconnect kann Guild noch nicht aufloesen guild=${guildId} ` +
          `(${issue.count}/${VOICE_RECONNECT_RESOURCE_CONFIRMATIONS}, detail=${getRuntimeErrorMessage(guildError)}) - retry folgt.`
        );
      }
      return;
    }
    clearTransientVoiceIssue(state, "reconnect-guild-missing");

    const { channel, error: channelError } = await fetchRestoreChannel(guild, state.lastChannelId);
    if (!channel) {
      if (isPermanentRestoreResourceError(channelError, "channel")) {
        clearTransientVoiceIssue(state, "reconnect-channel-missing");
        log(
          "INFO",
          `[${runtime.config.name}] Reconnect-Ziel Channel ${state.lastChannelId || "-"} in guild=${guildId} existiert nicht mehr. Verwerfe Playback-Target.`
        );
        runtime.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
        return;
      }
      const issue = noteTransientVoiceIssue(
        state,
        "reconnect-channel-missing",
        `${guildId}:${state.lastChannelId || "-"}:${getRuntimeErrorMessage(channelError)}`
      );
      if (shouldLogRecurringTransientIssue(issue)) {
        log(
          "WARN",
          `[${runtime.config.name}] Reconnect abgebrochen: Voice-Channel fehlt guild=${guildId} channel=${state.lastChannelId || "-"} ` +
          `(${issue.count}/${VOICE_RECONNECT_RESOURCE_CONFIRMATIONS}, detail=${getRuntimeErrorMessage(channelError)}) - retry folgt.`
        );
      }
      return;
    }
    if (!channel.isVoiceBased()) {
      clearTransientVoiceIssue(state, "reconnect-channel-missing");
      log(
        "INFO",
        `[${runtime.config.name}] Reconnect-Ziel Channel ${state.lastChannelId || "-"} in guild=${guildId} ist kein Voice-/Stage-Channel mehr. Verwerfe Playback-Target.`
      );
      runtime.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
      return;
    }
    clearTransientVoiceIssue(state, "reconnect-channel-missing");

    const me = await runtime.resolveBotMember(guild);
    const perms = me ? channel.permissionsFor(me) : null;
    if (!me || !perms?.has(PermissionFlagsBits.Connect) || (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak))) {
      const missingBits = [];
      if (!me) missingBits.push("member-unresolved");
      if (!perms?.has(PermissionFlagsBits.Connect)) missingBits.push("connect");
      if (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) missingBits.push("speak");
      const issue = noteTransientVoiceIssue(
        state,
        "reconnect-permissions-missing",
        `${guildId}:${channel.id}:${missingBits.join(",") || "unknown"}`
      );
      if (issue.count >= VOICE_RECONNECT_PERMISSION_CONFIRMATIONS) {
        abortRuntimeReconnectTarget(
          runtime,
          guildId,
          state,
          `permissions still missing after ${issue.count} checks (channel=${channel.id}, detail=${missingBits.join(",") || "unknown"})`
        );
        return;
      }
      if (shouldLogRecurringTransientIssue(issue)) {
        log(
          "WARN",
          `[${runtime.config.name}] Reconnect abgebrochen: Rechte/Bot-Member fehlen guild=${guildId} channel=${channel.id} ` +
          `(${issue.count}/${VOICE_RECONNECT_PERMISSION_CONFIRMATIONS}, detail=${missingBits.join(",") || "unknown"}) - retry folgt.`
        );
      }
      return;
    }
    clearTransientVoiceIssue(state, "reconnect-permissions-missing");

    if (state.connection) {
      try { state.connection.destroy(); } catch {}
      state.connection = null;
    }

    const originalAdapter = guild.voiceAdapterCreator;
    const botName = runtime.config.name;
    const wrappedAdapter = (methods) => {
      const adapter = originalAdapter(methods);
      const originalSendPayload = adapter.sendPayload.bind(adapter);
      adapter.sendPayload = (data) => {
        const result = originalSendPayload(data);
        if (!result) {
          log("WARN", `[${botName}] Reconnect sendPayload returned false for guild=${guildId}`);
        }
        return result;
      };
      return adapter;
    };

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: wrappedAdapter,
      group: runtime.voiceGroup,
      selfDeaf: true,
      debug: true,
    });

    connection.on("stateChange", (oldState, newState) => {
      const oldStatus = String(oldState?.status || "");
      const newStatus = String(newState?.status || "");
      if (!newStatus || oldStatus === newStatus) return;
      log("INFO", `[${botName}] ReconnectVoiceState: ${oldStatus} -> ${newStatus} guild=${guildId}`);
    });

    log("INFO", `[${runtime.config.name}] Rejoin Voice: guild=${guild.id} channel=${channel.id} group=${runtime.voiceGroup}`);
    state.connection = connection;

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch {
      log("WARN", `[${runtime.config.name}] Reconnect Voice-Timeout: guild=${guildId} channel=${channel.id} state=${connection.state?.status || "unknown"}`);
      if (state.connection === connection) {
        state.connection = null;
      }
      noteRuntimeRecoveryFailure(runtime, guildId, `${runtime.config.name} reconnect-timeout`, `guild=${guildId}`);
      try { connection.destroy(); } catch {}
      const issue = noteTransientVoiceIssue(
        state,
        "reconnect-ready-timeout",
        `${guildId}:${channel.id}:${connection.state?.status || "unknown"}`
      );
      if (issue.count >= VOICE_RECONNECT_READY_FAILURE_CONFIRMATIONS) {
        abortRuntimeReconnectTarget(
          runtime,
          guildId,
          state,
          `voice ready timeout repeated ${issue.count}x (channel=${channel.id}, state=${connection.state?.status || "unknown"})`,
          { logLevel: "ERROR" }
        );
      }
      return;
    }

    const joinedVoiceState = await runtime.confirmBotVoiceChannel(guildId, channel.id, { timeoutMs: 10_000, intervalMs: 700 });
    if (!joinedVoiceState) {
      if (state.connection === connection) {
        state.connection = null;
      }
      noteRuntimeRecoveryFailure(runtime, guildId, `${runtime.config.name} reconnect-ghost`, `guild=${guildId}`);
      try { connection.destroy(); } catch {}
      const issue = noteTransientVoiceIssue(
        state,
        "reconnect-voice-confirmation-failed",
        `${guildId}:${channel.id}`
      );
      if (issue.count >= VOICE_RECONNECT_READY_FAILURE_CONFIRMATIONS) {
        abortRuntimeReconnectTarget(
          runtime,
          guildId,
          state,
          `voice state confirmation failed ${issue.count}x (channel=${channel.id})`,
          { logLevel: "ERROR" }
        );
      }
      return;
    }

    if (!state.shouldReconnect || !state.currentStationKey || !state.lastChannelId) {
      if (state.connection === connection) {
        state.connection = null;
      }
      try { connection.destroy(); } catch {}
      return;
    }

    connection.subscribe(state.player);
    clearTransientVoiceIssues(state);
    state.reconnectAttempts = 0;
    state.reconnectCircuitTripCount = 0;
    state.reconnectCircuitOpenUntil = 0;
    state.reconnectCount = (Number(state.reconnectCount || 0) || 0) + 1;
    state.lastReconnectAt = new Date().toISOString();
    state.voiceDisconnectObservedAt = 0;
    runtime.clearReconnectTimer(state);
    runtime.attachConnectionHandlers(guildId, connection);
    noteRuntimeRecoverySuccess(runtime, guildId, `${runtime.config.name} rejoin-ready guild=${guildId}`);
    recordConnectionEvent(guildId, {
      botId: runtime.config.id || "",
      eventType: "reconnect",
      channelId: channel.id || "",
      details: "Voice reconnect ready",
    });
    if (channel.type === ChannelType.GuildStageVoice) {
      await runtime.ensureStageChannelReady(guild, channel, { createInstance: true, ensureSpeaker: true });
    }
    runtime.queueVoiceStateReconcile(guildId, "voice-rejoin", 1200);

    if (state.currentStationKey) {
      try {
        await runtime.restartCurrentStation(state, guildId);
        log("INFO", `[${runtime.config.name}] Reconnect successful: guild=${guildId}`);
      } catch (err) {
        log("ERROR", `[${runtime.config.name}] Station restart after reconnect failed: ${err?.message || err}`);
      }
    }
  } finally {
    state.reconnectInFlight = false;
  }
}

export function handleRuntimeNetworkRecovered(runtime, recoveryEvent = null) {
  for (const [guildId, state] of runtime.guildState.entries()) {
    if (!state.shouldReconnect || !state.currentStationKey || !state.lastChannelId) continue;
    if (!runtimeRecoveryScopeMatches(runtime, guildId, recoveryEvent)) continue;
    if (state.reconnectInFlight || state.voiceConnectInFlight) continue;

    if (!state.connection) {
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
      runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: "network-recovered" });
      continue;
    }

    if (state.player.state.status === AudioPlayerStatus.Idle && !state.streamRestartTimer) {
      runtime.scheduleStreamRestart(guildId, state, 750, "network-recovered");
    }
  }
}

export function scheduleRuntimeReconnect(runtime, guildId, options = {}) {
  const state = runtime.getState(guildId);
  if (!state.shouldReconnect || !state.lastChannelId) return;
  if (runtime.isScheduledEventStopDue(state.activeScheduledEventStopAtMs)) {
    runtime.stopInGuild(guildId);
    return;
  }
  if (options.resetAttempts) {
    state.reconnectAttempts = 0;
    state.reconnectCircuitTripCount = 0;
    state.reconnectCircuitOpenUntil = 0;
  }
  if (state.reconnectTimer || state.reconnectInFlight || state.voiceConnectInFlight) return;

  const attempt = state.reconnectAttempts + 1;
  const tierConfig = getTierConfig(guildId);
  const baseDelay = Math.max(400, tierConfig.reconnectMs || 5_000);
  const parsedMinDelayMs = Number.parseInt(String(options.minDelayMs || 0), 10);
  const minDelayMs = Number.isFinite(parsedMinDelayMs) ? Math.max(0, parsedMinDelayMs) : 0;
  const parsedJitterFactor = Number.parseFloat(String(options.jitterFactor ?? ""));
  const jitterFactor = Number.isFinite(parsedJitterFactor)
    ? Math.max(0, Math.min(0.95, parsedJitterFactor))
    : 0.2;
  const exp = Math.min(Math.max(0, attempt - 1), VOICE_RECONNECT_EXP_STEPS);
  let delay = Math.min(VOICE_RECONNECT_MAX_MS, baseDelay * Math.pow(1.8, exp));
  let logLevel = "INFO";
  let logMessage = null;
  let eventDetails = `attempt=${attempt} reason=${String(options.reason || "auto")}`;

  const networkCooldownMs = getRuntimeRecoveryDelayMs(runtime, guildId);
  if (networkCooldownMs > 0) {
    delay = Math.max(delay, networkCooldownMs);
  }
  if (minDelayMs > 0) {
    delay = Math.max(delay, minDelayMs);
  }

  const reason = String(options.reason || "auto");
  if (attempt > VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS) {
    const circuitTripCount = Number(state.reconnectCircuitTripCount || 0) + 1;
    if (circuitTripCount >= VOICE_RECONNECT_MAX_CIRCUIT_TRIPS) {
      state.reconnectAttempts = 0;
      state.reconnectCircuitTripCount = circuitTripCount;
      state.reconnectCircuitOpenUntil = 0;
      abortRuntimeReconnectTarget(
        runtime,
        guildId,
        state,
        `reconnect circuit exhausted after ${circuitTripCount} trips (reason=${reason})`,
        { logLevel: "ERROR" }
      );
      return;
    }
    const circuitMultiplier = Math.min(4, Math.pow(2, Math.max(0, circuitTripCount - 1)));
    state.reconnectAttempts = 0;
    state.reconnectCircuitTripCount = circuitTripCount;
    delay = Math.max(delay, VOICE_RECONNECT_CIRCUIT_BREAKER_MS * circuitMultiplier);
    state.reconnectCircuitOpenUntil = Date.now() + delay;
    logLevel = "WARN";
    logMessage =
      `[${runtime.config.name}] Reconnect-Circuit aktiv fuer guild=${guildId}: ` +
      `${attempt - 1} Fehlversuche erreicht. Pausiere weitere Retries fuer ${Math.round(delay)}ms ` +
      `(reason=${reason}, trip=${circuitTripCount}).`;
    eventDetails =
      `attempt>${VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS} reason=${reason} ` +
      `circuit=open trip=${circuitTripCount}`;
  } else {
    state.reconnectAttempts = attempt;
    delay = applyJitter(delay, jitterFactor);
    logMessage =
      `[${runtime.config.name}] Reconnecting guild=${guildId} in ${Math.round(delay)}ms ` +
      `(attempt ${attempt}, plan=${tierConfig.tier}, reason=${reason})`;
  }

  recordConnectionEvent(guildId, {
    botId: runtime.config.id || "",
    eventType: "retry",
    channelId: state.lastChannelId || "",
    details: eventDetails,
  });

  log(logLevel, logMessage);
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    if (!state.shouldReconnect) return;

    await runtime.tryReconnect(guildId);
    if (state.shouldReconnect && !state.connection && !state.reconnectInFlight && !state.voiceConnectInFlight) {
      runtime.scheduleReconnect(guildId, { reason: "retry" });
    }
  }, delay);

  runtime.persistState?.();
}

export async function restoreRuntimeGuildEntry(runtime, guildId, data, stations, { source = "restore" } = {}) {
  void stations;
  const existingState = runtime.guildState.get(guildId);
  if (
    existingState?.currentStationKey === data.stationKey
    && existingState?.lastChannelId === data.channelId
    && hasRecoverableRuntimeState(existingState)
  ) {
    clearRuntimeRestoreRetry(runtime, guildId);
    return { ok: true, skipped: true, reason: "already-active" };
  }

  const { guild, error: guildError } = await fetchRestoreGuild(runtime, guildId);
  if (!guild) {
    if (isPermanentRestoreResourceError(guildError, "guild")) {
      clearRuntimeRestoreRetry(runtime, guildId);
      log("INFO", `[${runtime.config.name}] Guild ${guildId} ist nicht mehr verfuegbar. Entferne gespeicherten Restore-State.`);
      clearBotGuild(runtime.config.id, guildId);
      return { ok: false, permanent: true, resource: "guild" };
    }
    log(
      "WARN",
      `[${runtime.config.name}] Guild ${guildId} fuer Restore derzeit nicht aufloesbar: ${guildError?.message || "unbekannter Fehler"}`
    );
    scheduleRuntimeRestoreRetry(runtime, guildId, data, stations, "guild-unresolved");
    return { ok: false, transient: true, resource: "guild" };
  }

  const allowedForRestore = await runtime.enforceGuildAccessForGuild(guild, source);
  if (!allowedForRestore) {
    clearRuntimeRestoreRetry(runtime, guildId);
    return { ok: false, blocked: true };
  }

  const { channel, error: channelError } = await fetchRestoreChannel(guild, data.channelId);
  if (!channel) {
    if (isPermanentRestoreResourceError(channelError, "channel")) {
      clearRuntimeRestoreRetry(runtime, guildId);
      log("INFO", `[${runtime.config.name}] Channel ${data.channelId} in ${guild.name} existiert nicht mehr. Entferne gespeicherten Restore-State.`);
      clearBotGuild(runtime.config.id, guildId);
      return { ok: false, permanent: true, resource: "channel" };
    }
    log(
      "WARN",
      `[${runtime.config.name}] Channel ${data.channelId} in ${guild.name} fuer Restore derzeit nicht aufloesbar: ${channelError?.message || "unbekannter Fehler"}`
    );
    scheduleRuntimeRestoreRetry(runtime, guildId, data, stations, "channel-unresolved");
    return { ok: false, transient: true, resource: "channel" };
  }

  if (!channel.isVoiceBased()) {
    clearRuntimeRestoreRetry(runtime, guildId);
    log("INFO", `[${runtime.config.name}] Channel ${data.channelId} in ${guild.name} ist kein Voice-/Stage-Channel mehr.`);
    clearBotGuild(runtime.config.id, guildId);
    return { ok: false, permanent: true, resource: "channel-type" };
  }

  const restoredStation = runtime.resolveStationForGuild(guildId, data.stationKey, runtime.resolveGuildLanguage(guildId));
  if (!restoredStation.ok) {
    clearRuntimeRestoreRetry(runtime, guildId);
    log("INFO", `[${runtime.config.name}] Station ${data.stationKey} nicht mehr vorhanden: ${restoredStation.message}`);
    clearBotGuild(runtime.config.id, guildId);
    return { ok: false, permanent: true, resource: "station" };
  }

  log("INFO", `[${runtime.config.name}] Reconnect: ${guild.name} / #${channel.name} / ${restoredStation.station.name}`);

  const state = runtime.getState(guildId);
  state.volume = data.volume ?? state.volume ?? 100;
  state.volumePreferenceSet = Number.isFinite(Number(state.volume));
  state.shouldReconnect = true;
  state.lastChannelId = data.channelId;
  state.currentStationKey = restoredStation.key;
  state.currentStationName = restoredStation.station.name || restoredStation.key;
  runtime.markScheduledEventPlayback(
    state,
    data.scheduledEventId || null,
    data.scheduledEventStopAtMs || 0
  );
  runtime.persistState?.();

  try {
    await runtime.ensureVoiceConnectionForChannel(guildId, channel.id, state, { source });
  } catch (err) {
    clearRuntimeRestoreRetry(runtime, guildId);
    log("ERROR", `[${runtime.config.name}] Voice-Verbindung zu ${guild.name} fehlgeschlagen: ${err?.message || err}`);
    noteRuntimeRecoveryFailure(runtime, guildId, `${runtime.config.name} restore-voice-timeout`, `guild=${guildId}`);
    runtime.scheduleReconnect(guildId, { reason: "restore-ready-timeout" });
    return { ok: false, reconnectScheduled: true };
  }

  await runtime.playStation(state, restoredStation.stations, restoredStation.key, guildId);
  clearRuntimeRestoreRetry(runtime, guildId);
  log("INFO", `[${runtime.config.name}] Wiederhergestellt: ${guild.name} -> ${restoredStation.station.name}`);

  await waitMs(2000);
  return { ok: true };
}

export async function restoreRuntimeState(runtime, stations) {
  void stations;
  const saved = getBotState(runtime.config.id);
  if (!saved || Object.keys(saved).length === 0) {
    log("INFO", `[${runtime.config.name}] Kein gespeicherter State gefunden (bot-id: ${runtime.config.id}).`);
    return;
  }

  const restorableEntries = Object.entries(saved).filter(([_, data]) => data?.stationKey && data?.channelId);
  if (restorableEntries.length === 0) {
    log("INFO", `[${runtime.config.name}] Nur gespeicherte Guild-Einstellungen gefunden (kein aktives Restore-Ziel).`);
    return;
  }

  log("INFO", `[${runtime.config.name}] Stelle ${restorableEntries.length} Verbindung(en) wieder her...`);

  for (const [guildId, data] of restorableEntries) {
    try {
      await restoreRuntimeGuildEntry(runtime, guildId, data, stations, { source: "restore" });
    } catch (err) {
      log("ERROR", `[${runtime.config.name}] Restore fehlgeschlagen fuer Guild ${guildId}: ${err?.message || err}`);
      const state = runtime.guildState.get(guildId);
      if (state?.shouldReconnect && state.lastChannelId && state.currentStationKey) {
        runtime.scheduleReconnect(guildId, { reason: "restore-error" });
      }
    }
  }
}
