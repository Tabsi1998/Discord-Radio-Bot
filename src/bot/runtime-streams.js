import { log } from "../lib/logging.js";
import {
  clipText,
  applyJitter,
  isLikelyNetworkFailureLine,
  STREAM_STABLE_RESET_MS,
  STREAM_RESTART_BASE_MS,
  STREAM_RESTART_MAX_MS,
  STREAM_PROCESS_FAILURE_WINDOW_MS,
  STREAM_ERROR_COOLDOWN_THRESHOLD,
  STREAM_ERROR_COOLDOWN_MS,
} from "../lib/helpers.js";
import { networkRecoveryCoordinator } from "../core/network-recovery.js";
import { createResource } from "../services/stream.js";
import { fetchStreamInfo } from "../services/now-playing.js";
import { getServerPlanConfig } from "../core/entitlements.js";
import { getFallbackKey } from "../stations-store.js";
import { normalizeFailoverChain, buildFailoverCandidateChain } from "../lib/failover-chain.js";
import { recordStationStart } from "../listening-stats-store.js";

function toPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue ?? fallbackValue), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

const IDLE_RESTART_WINDOW_MS = toPositiveInt(process.env.STREAM_IDLE_RESTART_WINDOW_MS, 15 * 60_000);
const IDLE_RESTART_EXP_STEPS = toPositiveInt(process.env.STREAM_IDLE_RESTART_EXP_STEPS, 6);

function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

function classifyFfmpegExitDetail(line) {
  const text = String(line || "").trim().toLowerCase();
  if (!text) return null;
  if (text.includes("broken pipe") || text.includes("error writing trailer of pipe:1") || text.includes("error closing file pipe:1")) {
    return "broken-pipe";
  }
  if (text.includes("http error")) return "http-error";
  if (text.includes("timed out") || text.includes("timeout")) return "timeout";
  if (text.includes("connection reset") || text.includes("connection refused")) return "connection-reset";
  if (text.includes("invalid data found when processing input")) return "invalid-input";
  if (isLikelyNetworkFailureLine(text)) return "network-failure";
  return null;
}

function resolveStreamRestartReason({
  reason,
  earlyIdle = false,
  recentProcessFailure = false,
  recentNetworkFailure = false,
  lastProcessExitDetail = null,
  idleRestartStreak = 0,
} = {}) {
  if (reason === "error") return "audio-player-error";
  if (earlyIdle) return "idle-early";
  if (recentNetworkFailure) return "idle-after-network-failure";
  if (recentProcessFailure && lastProcessExitDetail === "broken-pipe") return "idle-after-broken-pipe";
  if (recentProcessFailure && lastProcessExitDetail) return `idle-after-${lastProcessExitDetail}`;
  if (recentProcessFailure) return "idle-after-ffmpeg-exit";
  if (reason === "idle" && idleRestartStreak > 1) return "provider-eof-repeat";
  if (reason === "idle") return "provider-eof";
  return String(reason || "restart");
}

export function clearRuntimeCurrentProcess(runtime, state) {
  if (state.currentProcess) {
    try {
      state.currentProcess.kill("SIGKILL");
    } catch {
      // process may already be dead
    }
    state.currentProcess = null;
  }
}

export function armRuntimeStreamStabilityReset(runtime, guildId, state) {
  runtime.clearStreamStabilityTimer(state);
  state.streamStableTimer = setTimeout(() => {
    state.streamStableTimer = null;
    if (!state.currentStationKey) return;
    state.streamErrorCount = 0;
    state.idleRestartStreak = 0;
    state.lastIdleRestartAt = 0;
    state.lastProcessExitCode = null;
    state.lastProcessExitDetail = null;
    state.lastProcessExitAt = 0;
    state.lastNetworkFailureAt = 0;
    networkRecoveryCoordinator.noteSuccess(`${runtime.config.name} stable-stream guild=${guildId}`);
  }, STREAM_STABLE_RESET_MS);
}

export function trackRuntimeProcessLifecycle(runtime, guildId, state, process) {
  if (!process) return;
  let stderrBuffer = "";

  if (process.stderr?.on) {
    process.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        const exitDetail = classifyFfmpegExitDetail(trimmed);
        if (exitDetail) {
          state.lastProcessExitDetail = exitDetail;
        }
        if (!isLikelyNetworkFailureLine(trimmed)) continue;
        state.lastNetworkFailureAt = Date.now();
      }
    });
  }

  process.on("close", (code) => {
    if (state.currentProcess === process) {
      state.currentProcess = null;
    }
    state.lastProcessExitAt = Date.now();
    state.lastProcessExitCode = Number.isFinite(code) ? Number(code) : null;
    if (code && code !== 0) {
      state.lastStreamErrorAt = new Date().toISOString();
      const detail = state.lastProcessExitDetail ? ` detail=${state.lastProcessExitDetail}` : "";
      log("INFO", `[${runtime.config.name}] ffmpeg exited with code ${code} (guild=${guildId}${detail})`);
    }
  });
  process.on("error", (err) => {
    log("ERROR", `[${runtime.config.name}] ffmpeg process error: ${err?.message || err}`);
    state.lastStreamErrorAt = new Date().toISOString();
    if (state.currentProcess === process) {
      state.currentProcess = null;
    }
  });
}

export function scheduleRuntimeStreamRestart(runtime, guildId, state, delayMs, reason = "restart") {
  if (state.streamRestartTimer) {
    clearTimeout(state.streamRestartTimer);
  }

  const delay = applyJitter(Math.max(250, Number(delayMs) || 0), 0.15);
  state.streamRestartTimer = setTimeout(() => {
    state.streamRestartTimer = null;
    runtime.restartCurrentStation(state, guildId).catch((err) => {
      log("ERROR", `[${runtime.config.name}] Stream restart failed (${reason}): ${err?.message || err}`);
    });
  }, delay);
}

export function handleRuntimeStreamEnd(runtime, guildId, state, reason) {
  if (!state.shouldReconnect || !state.currentStationKey) return;
  if (!state.connection) return;

  const now = Date.now();
  if (runtime.isScheduledEventStopDue(state.activeScheduledEventStopAtMs, now)) {
    log(
      "INFO",
      `[${runtime.config.name}] Geplantes Event-Ende erreicht, Stream wird gestoppt (guild=${guildId}, event=${state.activeScheduledEventId || "-"})`
    );
    runtime.stopInGuild(guildId);
    return;
  }
  const streamLifetimeMs = state.lastStreamStartAt ? (now - state.lastStreamStartAt) : 0;
  const earlyIdle = reason === "idle" && streamLifetimeMs > 0 && streamLifetimeMs < 5000;
  const recentProcessFailure = (state.lastProcessExitCode ?? 0) !== 0
    && state.lastProcessExitAt > 0
    && (now - state.lastProcessExitAt) <= STREAM_PROCESS_FAILURE_WINDOW_MS;
  const recentNetworkFailure = state.lastNetworkFailureAt > 0
    && (now - state.lastNetworkFailureAt) <= Math.max(60_000, STREAM_RESTART_MAX_MS);
  const treatAsError = reason === "error" || earlyIdle || recentProcessFailure;

  if (reason === "idle" && !earlyIdle) {
    const withinIdleWindow = state.lastIdleRestartAt > 0
      && (now - state.lastIdleRestartAt) <= IDLE_RESTART_WINDOW_MS;
    state.idleRestartStreak = withinIdleWindow ? (state.idleRestartStreak || 0) + 1 : 1;
    state.lastIdleRestartAt = now;
  } else {
    state.idleRestartStreak = 0;
    state.lastIdleRestartAt = 0;
  }

  if (treatAsError) {
    state.streamErrorCount = (state.streamErrorCount || 0) + 1;
  } else {
    state.streamErrorCount = 0;
  }

  const errorCount = state.streamErrorCount || 0;
  const idleRestartStreak = state.idleRestartStreak || 0;
  const tierConfig = getTierConfig(guildId);
  let delay = Math.max(1_000, tierConfig.reconnectMs);

  if (treatAsError) {
    const exp = Math.min(Math.max(errorCount - 1, 0), 8);
    delay = Math.min(STREAM_RESTART_MAX_MS, STREAM_RESTART_BASE_MS * Math.pow(2, exp));
  } else {
    delay = Math.max(delay, STREAM_RESTART_BASE_MS);
  }

  if (!treatAsError && reason === "idle" && idleRestartStreak > 1) {
    const idleExp = Math.min(idleRestartStreak - 1, IDLE_RESTART_EXP_STEPS);
    const idlePenalty = Math.min(
      STREAM_RESTART_MAX_MS,
      Math.max(delay, STREAM_RESTART_BASE_MS) * Math.pow(1.8, idleExp)
    );
    delay = Math.max(delay, idlePenalty);
  }

  if (recentNetworkFailure) {
    const penalty = Math.min(STREAM_RESTART_MAX_MS, STREAM_RESTART_BASE_MS * Math.pow(2, Math.min(errorCount + 1, 8)));
    delay = Math.max(delay, penalty);
  }

  if (errorCount >= STREAM_ERROR_COOLDOWN_THRESHOLD) {
    delay = Math.max(delay, STREAM_ERROR_COOLDOWN_MS);
    log(
      "INFO",
      `[${runtime.config.name}] Viele Stream-Fehler (${errorCount}) guild=${guildId}, Cooldown ${STREAM_ERROR_COOLDOWN_MS}ms`
    );
  }

  const networkCooldownMs = networkRecoveryCoordinator.getRecoveryDelayMs(now);
  if (networkCooldownMs > 0) {
    delay = Math.max(delay, networkCooldownMs);
  }

  const reasonLabel = resolveStreamRestartReason({
    reason,
    earlyIdle,
    recentProcessFailure,
    recentNetworkFailure,
    lastProcessExitDetail: state.lastProcessExitDetail,
    idleRestartStreak,
  });
  state.lastStreamEndReason = reasonLabel;
  log(
    "INFO",
    `[${runtime.config.name}] Stream ${reasonLabel} guild=${guildId} lifetimeMs=${streamLifetimeMs} idleStreak=${idleRestartStreak} errors=${errorCount} ffmpegExit=${state.lastProcessExitCode ?? "-"} ffmpegDetail=${state.lastProcessExitDetail || "-"}, restart in ${Math.round(delay)}ms`
  );

  runtime.scheduleStreamRestart(guildId, state, delay, reasonLabel);
}

export async function playRuntimeStation(runtime, state, stations, key, guildId) {
  const station = stations.stations[key];
  if (!station) throw new Error("Station nicht gefunden.");

  runtime.clearCurrentProcess(state);

  let bitrateOverride = null;
  if (guildId) {
    const tierConfig = getTierConfig(guildId);
    bitrateOverride = tierConfig.bitrate;
  }

  const { resource, process } = await createResource(
    station.url,
    state.volume,
    stations.qualityPreset,
    runtime.config.name,
    bitrateOverride
  );

  state.currentProcess = process;
  runtime.trackProcessLifecycle(guildId, state, process);

  state.player.play(resource);
  state.currentStationKey = key;
  state.currentStationName = station.name || key;
  state.currentMeta = null;
  state.nowPlayingSignature = null;
  state.lastStreamEndReason = null;
  state.lastStreamStartAt = Date.now();
  state.lastProcessExitDetail = null;
  state.lastProcessExitCode = null;
  state.lastProcessExitAt = 0;
  runtime.armStreamStabilityReset(guildId, state);
  runtime.updatePresence();
  runtime.persistState();
  runtime.startNowPlayingLoop(guildId, state);
  runtime.syncVoiceChannelStatus(guildId, state.currentStationName || station.name || key).catch(() => null);
  recordStationStart(guildId, {
    stationKey: key,
    stationName: state.currentStationName || station.name || key,
    channelId: state.connection?.joinConfig?.channelId || state.lastChannelId || "",
    listenerCount: runtime.getCurrentListenerCount(guildId, state),
    timestampMs: state.lastStreamStartAt,
    botId: runtime.config.id || "",
  });

  fetchStreamInfo(station.url)
    .then((meta) => {
      if (state.currentStationKey === key) {
        const prevMeta = state.currentMeta || {};
        const artist = runtime.normalizeNowPlayingValue(meta.artist, station, meta, 120);
        const title = runtime.normalizeNowPlayingValue(meta.title, station, meta, 120);
        const streamTitle = runtime.normalizeNowPlayingValue(meta.streamTitle, station, meta, 180);
        const displayTitle = runtime.normalizeNowPlayingValue(meta.displayTitle || meta.streamTitle, station, meta, 180)
          || ([artist, title].filter(Boolean).join(" - ") || null);
        const hasTrack = Boolean(displayTitle || artist || title);
        state.currentMeta = {
          ...prevMeta,
          name: runtime.normalizeNowPlayingValue(meta.name, station, meta, 120) || prevMeta.name || station.name || key,
          description: runtime.normalizeNowPlayingValue(meta.description, station, meta, 240) || prevMeta.description || null,
          streamTitle: streamTitle || prevMeta.streamTitle || null,
          artist: artist || prevMeta.artist || null,
          title: title || prevMeta.title || null,
          displayTitle: displayTitle || prevMeta.displayTitle || null,
          album: runtime.normalizeNowPlayingValue(meta.album, station, meta, 120) || prevMeta.album || null,
          artworkUrl: meta.artworkUrl || prevMeta.artworkUrl || null,
          metadataSource: meta.metadataSource || prevMeta.metadataSource || null,
          metadataStatus: hasTrack ? (meta.metadataStatus || "ok") : (meta.metadataStatus || prevMeta.metadataStatus || "empty"),
          recognitionProvider: meta.recognitionProvider || prevMeta.recognitionProvider || null,
          recognitionConfidence: Number.isFinite(Number(meta.recognitionConfidence))
            ? Number(meta.recognitionConfidence)
            : (Number.isFinite(Number(prevMeta.recognitionConfidence)) ? Number(prevMeta.recognitionConfidence) : null),
          musicBrainzRecordingId: meta.musicBrainzRecordingId || prevMeta.musicBrainzRecordingId || null,
          musicBrainzReleaseId: meta.musicBrainzReleaseId || prevMeta.musicBrainzReleaseId || null,
          updatedAt: new Date().toISOString(),
          trackDetectedAtMs: hasTrack ? Date.now() : (Number.parseInt(String(prevMeta.trackDetectedAtMs || 0), 10) || 0),
        };
        runtime.recordSongHistory(guildId, state, station, state.currentMeta);
      }
    })
    .catch(() => {
      // ignore metadata lookup errors
    });
}

export async function restartRuntimeCurrentStation(runtime, state, guildId) {
  if (!state.shouldReconnect || !state.currentStationKey) return;
  if (runtime.isScheduledEventStopDue(state.activeScheduledEventStopAtMs)) {
    runtime.stopInGuild(guildId);
    return;
  }

  const resolvedStation = runtime.getResolvedCurrentStation(guildId, state);
  const key = state.currentStationKey;
  if (!resolvedStation?.stations || !resolvedStation?.station) {
    runtime.clearNowPlayingTimer(state);
    state.currentStationKey = null;
    state.currentStationName = null;
    state.currentMeta = null;
    state.nowPlayingSignature = null;
    runtime.clearScheduledEventPlayback(state);
    runtime.updatePresence();
    return;
  }

  const networkCooldownMs = networkRecoveryCoordinator.getRecoveryDelayMs();
  if (networkCooldownMs > 0) {
    runtime.scheduleStreamRestart(guildId, state, Math.max(1_000, networkCooldownMs), "network-cooldown");
    return;
  }

  try {
    runtime.clearCurrentProcess(state);
    state.currentStationKey = resolvedStation.key;
    state.currentStationName = resolvedStation.station.name || resolvedStation.key;
    await runtime.playStation(state, resolvedStation.stations, resolvedStation.key, guildId);
    log("INFO", `[${runtime.config.name}] Stream restarted: ${resolvedStation.key}`);
  } catch (err) {
    state.lastStreamErrorAt = new Date().toISOString();
    log("ERROR", `[${runtime.config.name}] Auto-restart error for ${key}: ${err.message}`);

    const isCustomStation = runtime.normalizeStationReference(key).isCustom;
    const automaticFallbackKey = !isCustomStation ? getFallbackKey(resolvedStation.stations, resolvedStation.key) : null;
    let configuredFailoverChain = [];
    let legacyFallbackStation = "";
    try {
      const { getDb: getDatabase, isConnected: isDbConn } = await import("../lib/db.js");
      if (isDbConn() && getDatabase()) {
        const settings = await getDatabase().collection("guild_settings").findOne(
          { guildId },
          { projection: { failoverChain: 1, fallbackStation: 1 } }
        );
        configuredFailoverChain = normalizeFailoverChain(settings?.failoverChain || []);
        legacyFallbackStation = String(settings?.fallbackStation || "").trim().toLowerCase();
      }
    } catch {}

    const fallbackCandidates = buildFailoverCandidateChain({
      currentStationKey: resolvedStation.key,
      configuredChain: configuredFailoverChain,
      fallbackStation: legacyFallbackStation,
      automaticFallbackKey,
    });

    for (const fallbackCandidate of fallbackCandidates) {
      const fallbackStation = runtime.resolveStationForGuild(guildId, fallbackCandidate);
      if (!fallbackStation?.ok || !fallbackStation?.stations || !fallbackStation?.station) {
        log("WARN", `[${runtime.config.name}] Skip unavailable failover candidate ${fallbackCandidate}`);
        continue;
      }

      try {
        await runtime.playStation(state, fallbackStation.stations, fallbackStation.key, guildId);
        log("INFO", `[${runtime.config.name}] Failover to ${fallbackStation.key} after restart failure`);
        return;
      } catch (fallbackErr) {
        log("ERROR", `[${runtime.config.name}] Failover candidate ${fallbackCandidate} failed: ${fallbackErr.message}`);
      }
    }

    if (fallbackCandidates.length > 0) {
      log("ERROR", `[${runtime.config.name}] Exhausted failover chain after restart failure`);
    }
  }
}
