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
const VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS = Math.max(
  5,
  toPositiveInt(process.env.VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS, 30)
);
const VOICE_RECONNECT_CIRCUIT_BREAKER_MS = Math.max(
  60_000,
  toPositiveInt(process.env.VOICE_RECONNECT_CIRCUIT_BREAKER_MS, 15 * 60_000)
);

function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
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
    if (state.lastChannelId !== newChannelId) {
      runtime.markNowPlayingTargetDirty(state, newChannelId);
    }
    state.lastChannelId = newChannelId;
    if (state.reconnectTimer) {
      runtime.clearReconnectTimer(state);
      state.reconnectAttempts = 0;
    }
    runtime.persistState();
    runtime.queueVoiceStateReconcile(guildId, "voice-state-update", 1500);
    return;
  }

  if (!oldChannelId) return;

  const shouldAutoReconnect = Boolean(state.shouldReconnect && state.currentStationKey && state.lastChannelId);
  runtime.resetVoiceSession(guildId, state, {
    preservePlaybackTarget: shouldAutoReconnect,
    clearLastChannel: !shouldAutoReconnect,
  });

  if (shouldAutoReconnect) {
    log(
      "INFO",
      `[${runtime.config.name}] Voice lost (Guild ${guildId}, Channel ${oldChannelId}). Scheduling auto-reconnect...`
    );
    runtime.scheduleReconnect(guildId, { reason: "voice-lost" });
    return;
  }

  log(
    "INFO",
    `[${runtime.config.name}] Voice left (Guild ${guildId}, Channel ${oldChannelId}). No reconnect.`
  );
  runtime.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
}

export function resetRuntimeVoiceSession(
  runtime,
  guildId,
  state,
  { preservePlaybackTarget = false, clearLastChannel = false } = {}
) {
  if (!state) return;
  runtime.clearQueuedVoiceReconcile(guildId);
  clearTransientVoiceIssues(state);

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
  const expectedChannelId = state.lastChannelId || state.connection?.joinConfig?.channelId || null;

  if (actualChannelId && state.lastChannelId !== actualChannelId) {
    runtime.markNowPlayingTargetDirty(state, actualChannelId);
    state.lastChannelId = actualChannelId;
    runtime.persistState();
  }

  if (!actualChannelId) {
    const shouldReconnect = Boolean(state.shouldReconnect && state.currentStationKey && state.lastChannelId);
    if (!state.connection && !state.currentProcess && !shouldReconnect) return;
    if (!state.connection && shouldReconnect && state.reconnectTimer) {
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
    runtime.markNowPlayingTargetDirty(state, actualChannelId);
    state.lastChannelId = actualChannelId;
    runtime.persistState();
    if (!issue.confirmed) {
      return;
    }
    clearTransientVoiceIssue(state, "voice-channel-mismatch");
    if (!state.currentProcess && state.player.state.status === AudioPlayerStatus.Idle && !state.reconnectTimer) {
      runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: "voice-channel-mismatch" });
      return;
    }
  } else {
    clearTransientVoiceIssue(state, "voice-channel-mismatch");
  }

  if (!state.connection && state.currentStationKey && state.lastChannelId) {
    if (state.reconnectTimer) return;
    runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: `voice-no-local-connection-${reason}` });
    return;
  }

  if (state.currentStationKey && state.player.state.status === AudioPlayerStatus.Idle && !state.streamRestartTimer && !state.reconnectTimer) {
    runtime.scheduleStreamRestart(guildId, state, 750, `voice-health-${reason}`);
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
    }
  };

  connection.on(VoiceConnectionStatus.Connecting, () => {
    try { connection.configureNetworking(); } catch {}
  });

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
    log("ERROR", `[${runtime.config.name}] VoiceConnection error: ${err?.message || err}`);
    recordConnectionEvent(guildId, {
      botId: runtime.config.id || "",
      eventType: "error",
      channelId: state.lastChannelId || "",
      details: String(err?.message || err).slice(0, 200),
    });
    markDisconnected();
    if (!state.shouldReconnect) return;
    runtime.scheduleReconnect(guildId, { reason: "voice-error" });
  });
}

export async function tryRuntimeReconnect(runtime, guildId) {
  const state = runtime.getState(guildId);
  if (!state.shouldReconnect || !state.lastChannelId) return;
  if (runtime.isScheduledEventStopDue(state.activeScheduledEventStopAtMs)) {
    runtime.stopInGuild(guildId);
    return;
  }

  const networkCooldownMs = networkRecoveryCoordinator.getRecoveryDelayMs();
  if (networkCooldownMs > 0) {
    log(
      "INFO",
      `[${runtime.config.name}] Reconnect fuer guild=${guildId} verschoben (Netz-Cooldown ${Math.round(networkCooldownMs)}ms)`
    );
    return;
  }

  const guild = runtime.client.guilds.cache.get(guildId) || await runtime.client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    const issue = noteTransientVoiceIssue(state, "reconnect-guild-missing", guildId);
    if (issue.count < VOICE_RECONNECT_RESOURCE_CONFIRMATIONS) {
      log(
        "WARN",
        `[${runtime.config.name}] Reconnect kann Guild noch nicht aufloesen guild=${guildId} (${issue.count}/${VOICE_RECONNECT_RESOURCE_CONFIRMATIONS}) - retry folgt.`
      );
      return;
    }
    clearTransientVoiceIssue(state, "reconnect-guild-missing");
    runtime.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
    return;
  }
  clearTransientVoiceIssue(state, "reconnect-guild-missing");

  const channel = guild.channels.cache.get(state.lastChannelId) || await guild.channels.fetch(state.lastChannelId).catch(() => null);
  if (!channel || !channel.isVoiceBased()) {
    const issue = noteTransientVoiceIssue(state, "reconnect-channel-missing", `${guildId}:${state.lastChannelId || "-"}`);
    if (issue.count < VOICE_RECONNECT_RESOURCE_CONFIRMATIONS) {
      log(
        "WARN",
        `[${runtime.config.name}] Reconnect abgebrochen: Voice-Channel fehlt guild=${guildId} channel=${state.lastChannelId || "-"} (${issue.count}/${VOICE_RECONNECT_RESOURCE_CONFIRMATIONS}) - retry folgt.`
      );
      return;
    }
    clearTransientVoiceIssue(state, "reconnect-channel-missing");
    runtime.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
    return;
  }
  clearTransientVoiceIssue(state, "reconnect-channel-missing");

  const me = await runtime.resolveBotMember(guild);
  const perms = me ? channel.permissionsFor(me) : null;
  if (!me || !perms?.has(PermissionFlagsBits.Connect) || (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak))) {
    const issue = noteTransientVoiceIssue(state, "reconnect-permissions-missing", `${guildId}:${channel.id}`);
    if (issue.count < VOICE_RECONNECT_RESOURCE_CONFIRMATIONS) {
      log(
        "WARN",
        `[${runtime.config.name}] Reconnect abgebrochen: Rechte fehlen guild=${guildId} channel=${channel.id} (${issue.count}/${VOICE_RECONNECT_RESOURCE_CONFIRMATIONS}) - retry folgt.`
      );
      return;
    }
    clearTransientVoiceIssue(state, "reconnect-permissions-missing");
    runtime.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
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
    if (
      newStatus === VoiceConnectionStatus.Connecting &&
      (oldStatus === VoiceConnectionStatus.Ready || oldStatus === VoiceConnectionStatus.Signalling)
    ) {
      try { connection.configureNetworking(); } catch {}
    }
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
    networkRecoveryCoordinator.noteFailure(`${runtime.config.name} reconnect-timeout`, `guild=${guildId}`);
    try { connection.destroy(); } catch {}
    return;
  }

  const joinedVoiceState = await runtime.confirmBotVoiceChannel(guildId, channel.id, { timeoutMs: 10_000, intervalMs: 700 });
  if (!joinedVoiceState) {
    if (state.connection === connection) {
      state.connection = null;
    }
    networkRecoveryCoordinator.noteFailure(`${runtime.config.name} reconnect-ghost`, `guild=${guildId}`);
    try { connection.destroy(); } catch {}
    return;
  }

  connection.subscribe(state.player);
  clearTransientVoiceIssues(state);
  state.reconnectAttempts = 0;
  state.lastReconnectAt = new Date().toISOString();
  runtime.clearReconnectTimer(state);
  runtime.attachConnectionHandlers(guildId, connection);
  networkRecoveryCoordinator.noteSuccess(`${runtime.config.name} rejoin-ready guild=${guildId}`);
  recordConnectionEvent(guildId, {
    botId: runtime.config.id || "",
    eventType: "connect",
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
}

export function handleRuntimeNetworkRecovered(runtime) {
  for (const [guildId, state] of runtime.guildState.entries()) {
    if (!state.shouldReconnect || !state.currentStationKey || !state.lastChannelId) continue;

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
  }
  if (state.reconnectTimer) return;

  const attempt = state.reconnectAttempts + 1;
  const tierConfig = getTierConfig(guildId);
  const baseDelay = Math.max(400, tierConfig.reconnectMs || 5_000);
  const exp = Math.min(Math.max(0, attempt - 1), VOICE_RECONNECT_EXP_STEPS);
  let delay = Math.min(VOICE_RECONNECT_MAX_MS, baseDelay * Math.pow(1.8, exp));
  let logLevel = "INFO";
  let logMessage = null;
  let eventDetails = `attempt=${attempt} reason=${String(options.reason || "auto")}`;

  const networkCooldownMs = networkRecoveryCoordinator.getRecoveryDelayMs();
  if (networkCooldownMs > 0) {
    delay = Math.max(delay, networkCooldownMs);
  }

  const reason = String(options.reason || "auto");
  if (attempt > VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS) {
    state.reconnectAttempts = 0;
    delay = Math.max(delay, VOICE_RECONNECT_CIRCUIT_BREAKER_MS);
    logLevel = "ERROR";
    logMessage =
      `[${runtime.config.name}] Reconnect-Circuit aktiv fuer guild=${guildId}: ` +
      `${attempt - 1} Fehlversuche erreicht. Pausiere weitere Retries fuer ${Math.round(delay)}ms (reason=${reason}).`;
    eventDetails = `attempt>${VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS} reason=${reason} circuit=open`;
  } else {
    state.reconnectAttempts = attempt;
    delay = applyJitter(delay, 0.2);
    logMessage =
      `[${runtime.config.name}] Reconnecting guild=${guildId} in ${Math.round(delay)}ms ` +
      `(attempt ${attempt}, plan=${tierConfig.tier}, reason=${reason})`;
  }

  recordConnectionEvent(guildId, {
    botId: runtime.config.id || "",
    eventType: "reconnect",
    channelId: state.lastChannelId || "",
    details: eventDetails,
  });

  log(logLevel, logMessage);
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    if (!state.shouldReconnect) return;

    await runtime.tryReconnect(guildId);
    if (state.shouldReconnect && !state.connection) {
      runtime.scheduleReconnect(guildId, { reason: "retry" });
    }
  }, delay);

  state.reconnectCount += 1;
  state.lastReconnectAt = new Date().toISOString();
}

export async function restoreRuntimeState(runtime, stations) {
  void stations;
  const saved = getBotState(runtime.config.id);
  if (!saved || Object.keys(saved).length === 0) {
    log("INFO", `[${runtime.config.name}] Kein gespeicherter State gefunden (bot-id: ${runtime.config.id}).`);
    return;
  }

  log("INFO", `[${runtime.config.name}] Stelle ${Object.keys(saved).length} Verbindung(en) wieder her...`);

  for (const [guildId, data] of Object.entries(saved)) {
    try {
      const guild = runtime.client.guilds.cache.get(guildId);
      if (!guild) {
        log("INFO", `[${runtime.config.name}] Guild ${guildId} nicht gefunden (${runtime.client.guilds.cache.size} Guilds im Cache), ueberspringe.`);
        clearBotGuild(runtime.config.id, guildId);
        continue;
      }

      const allowedForRestore = await runtime.enforceGuildAccessForGuild(guild, "restore");
      if (!allowedForRestore) {
        continue;
      }

      let channel = guild.channels.cache.get(data.channelId);
      if (!channel) {
        channel = await guild.channels.fetch(data.channelId).catch(() => null);
      }
      if (!channel || !channel.isVoiceBased()) {
        log("INFO", `[${runtime.config.name}] Channel ${data.channelId} in ${guild.name} nicht gefunden.`);
        clearBotGuild(runtime.config.id, guildId);
        continue;
      }

      const restoredStation = runtime.resolveStationForGuild(guildId, data.stationKey, runtime.resolveGuildLanguage(guildId));
      if (!restoredStation.ok) {
        log("INFO", `[${runtime.config.name}] Station ${data.stationKey} nicht mehr vorhanden: ${restoredStation.message}`);
        clearBotGuild(runtime.config.id, guildId);
        continue;
      }

      log("INFO", `[${runtime.config.name}] Reconnect: ${guild.name} / #${channel.name} / ${restoredStation.station.name}`);

      const state = runtime.getState(guildId);
      state.volume = data.volume ?? 100;
      state.shouldReconnect = true;
      state.lastChannelId = data.channelId;
      state.currentStationKey = restoredStation.key;
      state.currentStationName = restoredStation.station.name || restoredStation.key;
      runtime.markScheduledEventPlayback(
        state,
        data.scheduledEventId || null,
        data.scheduledEventStopAtMs || 0
      );

      try {
        await runtime.ensureVoiceConnectionForChannel(guildId, channel.id, state);
      } catch (err) {
        log("ERROR", `[${runtime.config.name}] Voice-Verbindung zu ${guild.name} fehlgeschlagen: ${err?.message || err}`);
        networkRecoveryCoordinator.noteFailure(`${runtime.config.name} restore-voice-timeout`, `guild=${guildId}`);
        runtime.scheduleReconnect(guildId, { reason: "restore-ready-timeout" });
        continue;
      }

      await runtime.playStation(state, restoredStation.stations, restoredStation.key, guildId);
      log("INFO", `[${runtime.config.name}] Wiederhergestellt: ${guild.name} -> ${restoredStation.station.name}`);

      await waitMs(2000);
    } catch (err) {
      log("ERROR", `[${runtime.config.name}] Restore fehlgeschlagen fuer Guild ${guildId}: ${err?.message || err}`);
      const state = runtime.guildState.get(guildId);
      if (state?.shouldReconnect && state.lastChannelId && state.currentStationKey) {
        runtime.scheduleReconnect(guildId, { reason: "restore-error" });
      }
    }
  }
}
