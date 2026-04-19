import { AudioPlayerStatus } from "@discordjs/voice";

function normalizeChannelId(value) {
  const normalized = String(value || "").trim();
  return normalized || "";
}

function getRuntimeGuild(runtime, guildId) {
  const normalizedGuildId = String(guildId || "").trim();
  if (!normalizedGuildId) return null;
  return runtime?.client?.guilds?.cache?.get?.(normalizedGuildId) || null;
}

export function getRuntimeObservedVoiceChannelId(runtime, guildId) {
  const guild = getRuntimeGuild(runtime, guildId);
  if (!guild) return "";

  const memberChannelId = normalizeChannelId(guild?.members?.me?.voice?.channelId);
  if (memberChannelId) return memberChannelId;

  const userId = normalizeChannelId(runtime?.client?.user?.id);
  if (!userId) return "";

  return normalizeChannelId(guild?.voiceStates?.cache?.get?.(userId)?.channelId);
}

export function getRuntimeConnectedChannelId(runtime, guildId, state = null, {
  includeObserved = true,
  includeLastKnown = false,
} = {}) {
  const connectionChannelId = normalizeChannelId(state?.connection?.joinConfig?.channelId);
  if (connectionChannelId) return connectionChannelId;

  if (includeObserved) {
    const observedChannelId = getRuntimeObservedVoiceChannelId(runtime, guildId);
    if (observedChannelId) return observedChannelId;
  }

  return includeLastKnown ? normalizeChannelId(state?.lastChannelId) : "";
}

export function isRuntimeVoiceConnected(runtime, guildId, state = null, options = {}) {
  if (state?.connection) return true;
  return Boolean(getRuntimeConnectedChannelId(runtime, guildId, state, options));
}

export function isRuntimePlayerActive(state = null) {
  if (state?.currentProcess) return true;
  const playerStatus = String(state?.player?.state?.status || "").trim().toLowerCase();
  return Boolean(playerStatus && playerStatus !== String(AudioPlayerStatus.Idle).toLowerCase());
}

export function isRuntimePlaybackActive(runtime, guildId, state = null) {
  if (!state?.currentStationKey) return false;
  if (state?.connection) return true;
  if (!isRuntimeVoiceConnected(runtime, guildId, state, { includeObserved: true })) return false;
  return isRuntimePlayerActive(state);
}
