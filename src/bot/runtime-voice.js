import { ChannelType, PermissionFlagsBits } from "discord.js";
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";

import { log } from "../lib/logging.js";
import { clipText } from "../lib/helpers.js";
import { networkRecoveryCoordinator } from "../core/network-recovery.js";
import { BRAND } from "../config/plans.js";
import { recordConnectionEvent } from "../listening-stats-store.js";

export async function resolveRuntimeGuildVoiceChannel(runtime, guildId, channelId) {
  const guild = runtime.client.guilds.cache.get(guildId) || await runtime.client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { guild: null, channel: null };

  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isVoiceBased()) return { guild, channel: null };
  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    return { guild, channel: null };
  }

  return { guild, channel };
}

export async function ensureRuntimeStageChannelReady(
  runtime,
  guild,
  channel,
  {
    topic = null,
    guildScheduledEventId = null,
    createInstance = true,
    ensureSpeaker = true,
  } = {}
) {
  if (!guild || !channel || channel.type !== ChannelType.GuildStageVoice) return null;

  const me = await runtime.resolveBotMember(guild);
  if (!me) return null;

  const desiredTopic = clipText(
    String(topic || "").trim() || channel.topic || `${BRAND.name} Live`,
    120
  );

  let stageInstance = channel.stageInstance || await guild.stageInstances.fetch(channel.id).catch(() => null);

  if (!stageInstance && createInstance && desiredTopic) {
    const createOptions = {
      topic: desiredTopic,
      sendStartNotification: false,
    };
    if (/^\d{17,22}$/.test(String(guildScheduledEventId || ""))) {
      createOptions.guildScheduledEvent = String(guildScheduledEventId);
    }
    stageInstance = await channel.createStageInstance(createOptions).catch((err) => {
      log(
        "WARN",
        `[${runtime.config.name}] Stage-Instance konnte nicht erstellt werden (guild=${guild.id}, channel=${channel.id}): ${err?.message || err}`
      );
      return null;
    });
    if (!stageInstance) {
      stageInstance = channel.stageInstance || await guild.stageInstances.fetch(channel.id).catch(() => null);
    }
  }

  if (stageInstance && desiredTopic && stageInstance.topic !== desiredTopic) {
    stageInstance = await stageInstance.setTopic(desiredTopic).catch((err) => {
      log(
        "WARN",
        `[${runtime.config.name}] Stage-Topic Update fehlgeschlagen (guild=${guild.id}, channel=${channel.id}): ${err?.message || err}`
      );
      return stageInstance;
    });
  }

  if (ensureSpeaker && me.voice?.channelId === channel.id) {
    const perms = channel.permissionsFor(me);
    if (perms?.has(PermissionFlagsBits.MuteMembers)) {
      await me.voice.setSuppressed(false).catch(() => null);
    } else {
      await me.voice.setRequestToSpeak(true).catch(() => null);
    }
  }

  return stageInstance;
}

export async function ensureRuntimeVoiceConnectionForChannel(runtime, guildId, channelId, state) {
  const { guild, channel } = await runtime.resolveGuildVoiceChannel(guildId, channelId);
  if (!guild) throw new Error("Guild nicht gefunden.");
  if (!channel) throw new Error("Voice- oder Stage-Channel nicht gefunden.");

  const me = await runtime.resolveBotMember(guild);
  if (!me) throw new Error("Bot-Mitglied nicht aufloesbar.");

  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.Connect)) {
    throw new Error(`Keine Connect-Berechtigung fuer ${channel.toString()}.`);
  }
  if (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) {
    throw new Error(`Keine Speak-Berechtigung fuer ${channel.toString()}.`);
  }

  const previousChannelId = String(state.connection?.joinConfig?.channelId || state.lastChannelId || "").trim();
  state.lastChannelId = channel.id;
  if (previousChannelId && previousChannelId !== channel.id) {
    runtime.markNowPlayingTargetDirty(state, channel.id);
  }

  if (state.connection) {
    const currentChannelId = state.connection.joinConfig?.channelId;
    if (currentChannelId === channel.id) {
      state.shouldReconnect = true;
      if (channel.type === ChannelType.GuildStageVoice) {
        await runtime.ensureStageChannelReady(guild, channel, { createInstance: false, ensureSpeaker: true });
      }
      runtime.queueVoiceStateReconcile(guildId, "voice-existing", 900);
      return { connection: state.connection, guild, channel };
    }

    const previousShouldReconnect = state.shouldReconnect;
    state.shouldReconnect = false;
    runtime.clearReconnectTimer(state);
    runtime.clearNowPlayingTimer(state);
    try { state.connection.destroy(); } catch {}
    state.connection = null;
    state.shouldReconnect = previousShouldReconnect;
  }

  const originalAdapter = guild.voiceAdapterCreator;
  const botName = runtime.config.name;
  const wrappedAdapter = (methods) => {
    const adapter = originalAdapter(methods);
    const originalSendPayload = adapter.sendPayload.bind(adapter);
    adapter.sendPayload = (data) => {
      const result = originalSendPayload(data);
      if (!result) {
        log("WARN", `[${botName}] Voice sendPayload returned false for guild=${guildId} (shard not ready?)`);
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
    log("INFO", `[${botName}] VoiceState: ${oldStatus} -> ${newStatus} guild=${guildId}`);
    if (
      newStatus === VoiceConnectionStatus.Connecting &&
      (oldStatus === VoiceConnectionStatus.Ready || oldStatus === VoiceConnectionStatus.Signalling)
    ) {
      try { connection.configureNetworking(); } catch {}
    }
  });
  connection.on("debug", (msg) => {
    if (msg.includes("error") || msg.includes("Error") || msg.includes("timeout") || msg.includes("close") || msg.includes("destroy")) {
      log("DEBUG", `[${botName}] VoiceDebug guild=${guildId}: ${msg}`);
    }
  });

  state.connection = connection;

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  } catch {
    log("WARN", `[${runtime.config.name}] Voice-Timeout: guild=${guildId} channel=${channel.id} (${channel.name || "-"}) state=${connection.state?.status || "unknown"}`);
    if (state.connection === connection) {
      state.connection = null;
    }
    try { connection.destroy(); } catch {}
    networkRecoveryCoordinator.noteFailure(`${runtime.config.name} voice-connect-timeout`, `guild=${guildId} channel=${channel.id}`);
    throw new Error("Voice-Verbindung konnte nicht hergestellt werden.");
  }

  const joinedVoiceState = await runtime.confirmBotVoiceChannel(guildId, channel.id, { timeoutMs: 10_000, intervalMs: 700 });
  if (!joinedVoiceState) {
    log("WARN", `[${runtime.config.name}] Voice-Confirm fehlgeschlagen: guild=${guildId} channel=${channel.id} (${channel.name || "-"})`);
    if (state.connection === connection) {
      state.connection = null;
    }
    try { connection.destroy(); } catch {}
    throw new Error("Voice-Verbindung ist nicht stabil genug.");
  }

  connection.subscribe(state.player);
  state.reconnectAttempts = 0;
  state.lastReconnectAt = new Date().toISOString();
  state.shouldReconnect = true;
  runtime.clearReconnectTimer(state);
  runtime.attachConnectionHandlers(guildId, connection);
  networkRecoveryCoordinator.noteSuccess(`${runtime.config.name} voice-ready guild=${guildId}`);
  recordConnectionEvent(guildId, {
    botId: runtime.config.id || "",
    eventType: "connect",
    channelId: channel.id || "",
    details: "Voice connection ready (restore)",
  });

  if (channel.type === ChannelType.GuildStageVoice) {
    await runtime.ensureStageChannelReady(guild, channel, { createInstance: false, ensureSpeaker: true });
  }

  runtime.queueVoiceStateReconcile(guildId, "voice-ensure", 1200);

  return { connection, guild, channel };
}
