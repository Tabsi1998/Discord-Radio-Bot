// ============================================================
// OmniFM: BotRuntime Class
// ============================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  ActivityType,
  Routes,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventEntityType,
} from "discord.js";
import { REST } from "@discordjs/rest";
import {
  joinVoiceChannel,
  createAudioPlayer,
  NoSubscriberBehavior,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";

import { log } from "../lib/logging.js";
import {
  TIERS,
  TIER_RANK,
  clipText,
  clampVolume,
  waitMs,
  applyJitter,
  splitTextForDiscord,
  sanitizeUrlForLog,
  isLikelyNetworkFailureLine,
  STREAM_STABLE_RESET_MS,
  STREAM_RESTART_BASE_MS,
  STREAM_RESTART_MAX_MS,
  STREAM_PROCESS_FAILURE_WINDOW_MS,
  STREAM_ERROR_COOLDOWN_THRESHOLD,
  STREAM_ERROR_COOLDOWN_MS,
  VOICE_RECONNECT_MAX_MS,
  VOICE_RECONNECT_EXP_STEPS,
  NOW_PLAYING_ENABLED,
  NOW_PLAYING_POLL_MS,
  SONG_HISTORY_ENABLED,
  SONG_HISTORY_MAX_PER_GUILD,
  SONG_HISTORY_DEDUPE_WINDOW_MS,
  EVENT_SCHEDULER_ENABLED,
  EVENT_SCHEDULER_POLL_MS,
  EVENT_SCHEDULER_RETRY_MS,
  normalizeDuration,
  isValidEmailAddress,
  calculatePrice,
  calculateUpgradePrice,
  durationPricingInEuro,
  formatEuroCentsDe,
  sanitizeOfferCode,
  translateOfferReason,
  isProTrialEnabled,
  NOW_PLAYING_COVER_ENABLED,
} from "../lib/helpers.js";
import {
  resolveLanguageFromDiscordLocale,
  languagePick,
  translatePermissionStoreMessage,
  translateScheduledEventStoreMessage,
  translateCustomStationErrorMessage,
  getFeatureRequirementMessage,
} from "../lib/language.js";
import {
  REPEAT_MODES,
  EVENT_TIME_ZONE_SUGGESTIONS,
  EVENT_FALLBACK_TIME_ZONE,
  parseEventStartDateTime,
  formatDateTime,
  normalizeRepeatMode,
  getRepeatLabel,
  normalizeEventTimeZone,
  computeNextEventRunAtMs,
  renderEventAnnouncement,
  renderStageTopic,
} from "../lib/event-time.js";
import { networkRecoveryCoordinator } from "../core/network-recovery.js";
import {
  parseTrackFromStreamTitle,
  fetchCoverArtForTrack,
  fetchStreamSnapshot,
  fetchStreamInfo,
} from "../services/now-playing.js";
import { createResource } from "../services/stream.js";
import { loadStations, normalizeKey, resolveStation, getFallbackKey, filterStationsByTier } from "../stations-store.js";
import { saveBotState, getBotState, clearBotGuild } from "../bot-state.js";
import {
  addCustomStation,
  removeCustomStation,
  listCustomStations,
  getGuildStations,
  addGuildStation,
  removeGuildStation,
  countGuildStations,
  MAX_STATIONS_PER_GUILD,
  validateCustomStationUrl,
} from "../custom-stations.js";
import { getTier, checkFeatureAccess, getMaxBots, requireFeature, getServerPlanConfig } from "../core/entitlements.js";
import {
  getCommandPermission,
  setCommandPermission,
  removeCommandPermission,
  listCommandPermissions,
  resetCommandPermissions,
  getGuildCommandPermissionRules,
  getSupportedPermissionCommands,
  setCommandRolePermission,
  removeCommandRolePermission,
  evaluateCommandPermission,
} from "../command-permissions-store.js";
import {
  getPermissionCommandChoices,
  normalizePermissionCommandName,
  isPermissionManagedCommand,
} from "../config/command-permissions.js";
import {
  getGuildLanguage,
  setGuildLanguage,
  resetGuildLanguage,
} from "../guild-language-store.js";
import {
  addSongEntry,
  getHistory as getGuildSongHistory,
  appendSongHistory,
  getSongHistory,
} from "../song-history-store.js";
import {
  listAllEvents,
  addEvent,
  removeEvent,
  updateEventRunAtMs,
  getEvent,
  listScheduledEvents,
  createScheduledEvent,
  deleteScheduledEvent,
  patchScheduledEvent,
  getScheduledEvent,
  deleteScheduledEventsByFilter,
} from "../scheduled-events-store.js";
import { PLANS, BRAND } from "../config/plans.js";
import { normalizeLanguage, getDefaultLanguage } from "../i18n.js";
import { premiumStationEmbed, customStationEmbed } from "../ui/upgradeEmbeds.js";
import { syncGuildCommandsSafe } from "../discord/syncGuildCommandsSafe.js";
import { buildCommandBuilders } from "../commands.js";
import { buildInviteUrl } from "../bot-config.js";
import {
  getLicenseById,
  linkServerToLicense,
  unlinkServerFromLicense,
  getServerLicense,
} from "../premium-store.js";
import {
  previewCheckoutOffer,
} from "../coupon-store.js";

// Helper: wraps getServerPlanConfig + adds 'tier' alias for backward compatibility
function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

// Helper: wraps getServerLicense for backward compatibility
function getLicense(guildId) {
  return getServerLicense(guildId);
}


class BotRuntime {
  constructor(config, { role = "worker", workerManager = null } = {}) {
    this.config = config;
    this.role = role; // "commander" or "worker"
    this.workerManager = workerManager;
    this.voiceGroup = `bot-${this.config.clientId}`;
    this.rest = new REST({ version: "10" }).setToken(this.config.token);
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
    });
    this.guildState = new Map();
    this.startedAt = Date.now();
    this.readyAt = null;
    this.startError = null;
    this.eventSchedulerTimer = null;
    this.scheduledEventInFlight = new Set();
    this.unsubscribeNetworkRecovery = networkRecoveryCoordinator.onRecovered(() => {
      this.handleNetworkRecovered();
    });

    this.client.once("clientReady", () => {
      this.readyAt = Date.now();
      log("INFO", `[${this.config.name}] Eingeloggt als ${this.client.user.tag} (role=${this.role})`);
      const runtimeAppId = this.getApplicationId();
      if (runtimeAppId && runtimeAppId !== String(this.config.clientId || "")) {
        log(
          "INFO",
          `[${this.config.name}] CLIENT_ID mismatch erkannt (env=${this.config.clientId}, runtime=${runtimeAppId}). Command-Sync nutzt runtime-ID.`
        );
      }
      this.updatePresence();
      if (this.role === "commander") {
        this.enforcePremiumGuildScope("startup").catch((err) => {
          log("ERROR", `[${this.config.name}] Premium-Guild-Scope Pruefung fehlgeschlagen: ${err?.message || err}`);
        });
        this.refreshGuildCommandsOnReady().catch((err) => {
          log("ERROR", `[${this.config.name}] Guild-Command-Sync fehlgeschlagen: ${err?.message || err}`);
        });
        this.startEventScheduler();
      }
    });

    // Only commander handles interactions (slash commands)
    if (this.role === "commander") {
      this.client.on("interactionCreate", (interaction) => {
        this.handleInteraction(interaction).catch(async (err) => {
          log("ERROR", `[${this.config.name}] interaction error: ${err?.stack || err}`);
          try {
            if (!interaction.isRepliable || !interaction.isRepliable()) return;
            const { t } = this.createInteractionTranslator(interaction);
            const errorMessage = t(
              "Es ist ein Fehler aufgetreten. Bitte versuche es erneut.",
              "An error occurred. Please try again."
            );
            if (interaction.deferred || interaction.replied) {
              await interaction.editReply({ content: errorMessage });
            } else {
              await interaction.reply({ content: errorMessage, ephemeral: true });
            }
          } catch {
            // ignore secondary reply failures
          }
        });
      });
    }

    this.client.on("voiceStateUpdate", (oldState, newState) => {
      this.handleBotVoiceStateUpdate(oldState, newState);
    });

    if (this.role === "commander") {
      this.client.on("guildCreate", (guild) => {
        this.handleGuildJoin(guild).then((allowed) => {
          if (!allowed) return;
          this.syncGuildCommands("join", { guildId: guild?.id }).catch((err) => {
            log("ERROR", `[${this.config.name}] Guild-Command-Sync (join) fehlgeschlagen: ${err?.message || err}`);
          });
        }).catch((err) => {
          log("ERROR", `[${this.config.name}] guildCreate handling error: ${err?.message || err}`);
        });
      });
    }

    this.client.on("guildDelete", (guild) => {
      this.resetGuildRuntimeState(guild?.id);
    });
  }

  getState(guildId) {
    if (!this.guildState.has(guildId)) {
      const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play }
      });
      const state = {
        player,
        connection: null,
        currentStationKey: null,
        currentStationName: null,
        currentMeta: null,
        lastChannelId: null,
        volume: 100,
        currentProcess: null,
        streamStableTimer: null,
        lastStreamErrorAt: null,
        reconnectCount: 0,
        lastReconnectAt: null,
        reconnectAttempts: 0,
        reconnectTimer: null,
        streamRestartTimer: null,
        shouldReconnect: false,
        streamErrorCount: 0,
        lastStreamStartAt: null,
        lastProcessExitCode: null,
        lastProcessExitAt: 0,
        lastNetworkFailureAt: 0,
        nowPlayingRefreshTimer: null,
        nowPlayingMessageId: null,
        nowPlayingChannelId: null,
        nowPlayingSignature: null,
        nowPlayingLastErrorAt: 0,
      };

      player.on(AudioPlayerStatus.Idle, () => {
        this.handleStreamEnd(guildId, state, "idle");
      });

      player.on("error", (err) => {
        state.lastStreamErrorAt = new Date().toISOString();
        log("ERROR", `[${this.config.name}] AudioPlayer error: ${err?.message || err}`);
        this.handleStreamEnd(guildId, state, "error");
      });

      this.guildState.set(guildId, state);
    }

    return this.guildState.get(guildId);
  }

  getStreamDiagnostics(guildId, state) {
    const tierConfig = getTierConfig(guildId);
    const stations = loadStations();
    const preset = stations.qualityPreset || "custom";
    const bitrateOverride = tierConfig.bitrate;
    const transcodeEnabled = String(process.env.TRANSCODE || "0") === "1" || preset !== "custom" || !!bitrateOverride;
    const profile = buildTranscodeProfile({ bitrateOverride, qualityPreset: preset });
    const streamLifetimeSec = state.lastStreamStartAt ? Math.floor((Date.now() - state.lastStreamStartAt) / 1000) : 0;

    return {
      preset,
      tier: tierConfig.tier,
      bitrateOverride,
      transcodeEnabled,
      transcodeMode: String(process.env.TRANSCODE_MODE || "opus").toLowerCase(),
      requestedBitrateKbps: profile.requestedKbps,
      profile: profile.isUltra ? "ultra-stable" : "stable",
      queue: profile.threadQueueSize,
      probeSize: profile.probeSize,
      analyzeUs: profile.analyzeDuration,
      streamLifetimeSec,
    };
  }

  isPremiumOnlyBot() {
    const requiredTier = String(this.config.requiredTier || "free").toLowerCase();
    return requiredTier !== "free";
  }

  resetGuildRuntimeState(guildId) {
    if (!guildId) return;
    const state = this.guildState.get(guildId);
    if (state) {
      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      state.player.stop();
      this.clearCurrentProcess(state);
      if (state.connection) {
        try { state.connection.destroy(); } catch {}
      }
      this.guildState.delete(guildId);
    }
    deleteScheduledEventsByFilter({ guildId, botId: this.config.id });
    clearBotGuild(this.config.id, guildId);
  }

  async enforceGuildAccessForGuild(guild, source = "scope") {
    if (!this.isPremiumOnlyBot()) return true;
    if (!guild?.id) return false;

    const access = this.getGuildAccess(guild.id);
    if (access.allowed) return true;

    const reason = !access.tierAllowed ? "tier" : "maxBots";
    log(
      "INFO",
      `[${this.config.name}] Verlasse Guild ${guild.name} (${guild.id}) - Zugriff verweigert (${reason}, source=${source}, guildTier=${access.guildTier}, required=${access.requiredTier}, botIndex=${access.botIndex}, maxBots=${access.maxBots})`
    );
    this.resetGuildRuntimeState(guild.id);
    try {
      await guild.leave();
    } catch (err) {
      log("ERROR", `[${this.config.name}] Konnte Guild ${guild.id} nicht verlassen: ${err?.message || err}`);
    }
    return false;
  }

  async enforcePremiumGuildScope(source = "scope") {
    if (!this.isPremiumOnlyBot()) return;
    for (const guild of this.client.guilds.cache.values()) {
      // eslint-disable-next-line no-await-in-loop
      await this.enforceGuildAccessForGuild(guild, source);
    }
  }

  async handleGuildJoin(guild) {
    return this.enforceGuildAccessForGuild(guild, "join");
  }

  async refreshGuildCommandsOnReady() {
    if (this.isGuildCommandCleanupEnabled()) {
      log(
        "INFO",
        `[${this.config.name}] CLEAN_GUILD_COMMANDS_ON_BOOT=1 erkannt, Cleanup wird im Schutzmodus uebersprungen. Es erfolgt ein direkter Voll-Sync.`
      );
    }
    await this.syncGuildCommands("startup");
  }

  isGuildCommandSyncEnabled() {
    return String(process.env.SYNC_GUILD_COMMANDS_ON_BOOT ?? "1") !== "0";
  }

  buildGuildCommandPayload() {
    return buildCommandBuilders().map((builder) => builder.toJSON());
  }

  getApplicationId() {
    return String(this.client.user?.id || this.config.clientId || "").trim();
  }

  isGuildCommandCleanupEnabled() {
    if (!this.isGuildCommandSyncEnabled()) return false;
    return String(process.env.CLEAN_GUILD_COMMANDS_ON_BOOT ?? "0") !== "0";
  }

  async syncGuildCommands(source = "sync", options = {}) {
    if (!this.isGuildCommandSyncEnabled()) return;
    const payload = this.buildGuildCommandPayload();
    const targetGuildIds = Array.isArray(options?.guildIds)
      ? options.guildIds
      : options?.guildId
        ? [options.guildId]
        : null;
    await syncGuildCommandsSafe({
      client: this.client,
      rest: this.rest,
      routes: Routes,
      commands: payload,
      guildIds: targetGuildIds,
      botToken: this.config.token,
      botLabel: `${this.config.name}`,
      source,
      logFn: (level, message) => log(level, message),
    });
  }

  clearReconnectTimer(state) {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.streamRestartTimer) {
      clearTimeout(state.streamRestartTimer);
      state.streamRestartTimer = null;
    }
    this.clearStreamStabilityTimer(state);
  }

  clearStreamStabilityTimer(state) {
    if (state.streamStableTimer) {
      clearTimeout(state.streamStableTimer);
      state.streamStableTimer = null;
    }
  }

  clearNowPlayingTimer(state) {
    if (state.nowPlayingRefreshTimer) {
      clearInterval(state.nowPlayingRefreshTimer);
      state.nowPlayingRefreshTimer = null;
    }
  }

  logNowPlayingIssue(guildId, state, message) {
    const now = Date.now();
    const cooldownMs = 120_000;
    if (state.nowPlayingLastErrorAt && now - state.nowPlayingLastErrorAt < cooldownMs) return;
    state.nowPlayingLastErrorAt = now;
    log("INFO", `[${this.config.name}] NowPlaying guild=${guildId}: ${message}`);
  }

  async resolveNowPlayingChannel(guildId, state) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return null;

    const channelId = state.connection?.joinConfig?.channelId || state.lastChannelId || null;
    if (!channelId) return null;

    let channel = guild.channels.cache.get(channelId);
    if (!channel) {
      channel = await guild.channels.fetch(channelId).catch(() => null);
    }
    if (!channel || typeof channel.send !== "function") return null;

    const me = await this.resolveBotMember(guild);
    if (!me) return null;
    const perms = channel.permissionsFor?.(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel)) return null;
    if (!perms?.has(PermissionFlagsBits.SendMessages)) return null;

    return channel;
  }

  buildNowPlayingEmbed(guildId, station, meta) {
    const tierConfig = getTierConfig(guildId);
    const trackLabel = clipText(meta?.displayTitle || meta?.streamTitle || "", 180);
    const hasTrack = Boolean(trackLabel);
    const fields = [
      {
        name: "Sender",
        value: clipText(station?.name || meta?.name || "-", 120) || "-",
        inline: true,
      },
      {
        name: "Qualitaet",
        value: tierConfig.bitrate || "-",
        inline: true,
      },
    ];

    if (meta?.artist) {
      fields.push({ name: "Artist", value: clipText(meta.artist, 120), inline: true });
    }
    if (meta?.title) {
      fields.push({ name: "Titel", value: clipText(meta.title, 120), inline: true });
    }
    if (meta?.description) {
      fields.push({ name: "Stream-Info", value: clipText(meta.description, 240), inline: false });
    }

    const embed = {
      color: hasTrack ? 0xFFB800 : 0x5865F2,
      title: "Now Playing",
      description: hasTrack
        ? `**${trackLabel}**`
        : "Keine Live-Track-Metadaten vom Radiosender verfuegbar.",
      fields,
      footer: {
        text: `${this.config.name} | Auto-Update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`
      },
      timestamp: new Date().toISOString(),
    };

    if (meta?.artworkUrl) {
      embed.thumbnail = { url: meta.artworkUrl };
    }

    return embed;
  }

  recordSongHistory(guildId, state, station, meta) {
    if (!SONG_HISTORY_ENABLED) return;
    if (!meta) return;

    const displayTitle = clipText(meta.displayTitle || meta.streamTitle || "", 220);
    if (!displayTitle) return;

    try {
      appendSongHistory(guildId, {
        botId: this.config.id,
        stationKey: state.currentStationKey || null,
        stationName: station?.name || state.currentStationName || null,
        displayTitle,
        streamTitle: clipText(meta.streamTitle || "", 220) || null,
        artist: clipText(meta.artist || "", 120) || null,
        title: clipText(meta.title || "", 120) || null,
        artworkUrl: clipText(meta.artworkUrl || "", 600) || null,
        timestampMs: Date.now(),
      }, {
        maxPerGuild: SONG_HISTORY_MAX_PER_GUILD,
        dedupeWindowMs: SONG_HISTORY_DEDUPE_WINDOW_MS,
      });
    } catch (err) {
      this.logNowPlayingIssue(guildId, state, `SongHistory: ${clipText(err?.message || String(err), 180)}`);
    }
  }

  async upsertNowPlayingMessage(guildId, state, embed, channelOverride = null) {
    const channel = channelOverride || await this.resolveNowPlayingChannel(guildId, state);
    if (!channel) return false;

    if (state.nowPlayingChannelId && state.nowPlayingChannelId !== channel.id) {
      state.nowPlayingMessageId = null;
    }
    state.nowPlayingChannelId = channel.id;

    const payload = {
      embeds: [embed],
      allowedMentions: { parse: [] },
    };

    if (state.nowPlayingMessageId && channel.messages?.fetch) {
      const existing = await channel.messages.fetch(state.nowPlayingMessageId).catch(() => null);
      if (existing?.edit) {
        try {
          await existing.edit(payload);
          return true;
        } catch {
          state.nowPlayingMessageId = null;
        }
      }
    }

    try {
      const sent = await channel.send(payload);
      if (sent?.id) {
        state.nowPlayingMessageId = sent.id;
      }
      return true;
    } catch {
      return false;
    }
  }

  async updateNowPlayingEmbed(guildId, state, { force = false } = {}) {
    if (!NOW_PLAYING_ENABLED) return;
    if (!state.currentStationKey) return;
    if (!state.connection) return;
    const channel = await this.resolveNowPlayingChannel(guildId, state);
    if (!channel) return;

    const stationKey = state.currentStationKey;
    const stations = loadStations();
    const station = stations.stations[stationKey];
    if (!station?.url) return;

    try {
      const snapshot = await fetchStreamSnapshot(station.url, { includeCover: NOW_PLAYING_COVER_ENABLED });
      if (state.currentStationKey !== stationKey) return;

      const nextMeta = {
        name: snapshot.name || state.currentMeta?.name || station.name || stationKey,
        description: snapshot.description || state.currentMeta?.description || null,
        streamTitle: snapshot.streamTitle || null,
        artist: snapshot.artist || null,
        title: snapshot.title || null,
        displayTitle: snapshot.displayTitle || snapshot.streamTitle || null,
        artworkUrl: snapshot.artworkUrl || null,
        updatedAt: new Date().toISOString(),
      };
      state.currentMeta = nextMeta;
      this.recordSongHistory(guildId, state, station, nextMeta);

      const signature = [
        stationKey,
        nextMeta.displayTitle || "",
        nextMeta.artist || "",
        nextMeta.title || "",
        nextMeta.artworkUrl || "",
      ].join("|").toLowerCase();

      if (!force && signature === state.nowPlayingSignature) {
        return;
      }

      const embed = this.buildNowPlayingEmbed(guildId, station, nextMeta);
      const sent = await this.upsertNowPlayingMessage(guildId, state, embed, channel);
      if (sent) {
        state.nowPlayingSignature = signature;
      }
    } catch (err) {
      this.logNowPlayingIssue(guildId, state, clipText(err?.message || String(err), 200));
    }
  }

  startNowPlayingLoop(guildId, state) {
    this.clearNowPlayingTimer(state);
    state.nowPlayingSignature = null;
    if (!NOW_PLAYING_ENABLED || !state.currentStationKey) return;

    const update = () => {
      this.updateNowPlayingEmbed(guildId, state).catch((err) => {
        this.logNowPlayingIssue(guildId, state, clipText(err?.message || String(err), 200));
      });
    };

    update();
    state.nowPlayingRefreshTimer = setInterval(update, NOW_PLAYING_POLL_MS);
  }

  clearCurrentProcess(state) {
    if (state.currentProcess) {
      try {
        state.currentProcess.kill("SIGKILL");
      } catch {
        // process may already be dead
      }
      state.currentProcess = null;
    }
  }

  armStreamStabilityReset(guildId, state) {
    this.clearStreamStabilityTimer(state);
    state.streamStableTimer = setTimeout(() => {
      state.streamStableTimer = null;
      if (!state.currentStationKey) return;
      state.streamErrorCount = 0;
      state.lastProcessExitCode = null;
      state.lastProcessExitAt = 0;
      state.lastNetworkFailureAt = 0;
      networkRecoveryCoordinator.noteSuccess(`${this.config.name} stable-stream guild=${guildId}`);
    }, STREAM_STABLE_RESET_MS);
  }

  trackProcessLifecycle(guildId, state, process) {
    if (!process) return;
    let stderrBuffer = "";

    if (process.stderr?.on) {
      process.stderr.on("data", (chunk) => {
        stderrBuffer += chunk.toString();
        const lines = stderrBuffer.split("\n");
        stderrBuffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
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
        log("INFO", `[${this.config.name}] ffmpeg exited with code ${code} (guild=${guildId})`);
      }
    });
    process.on("error", (err) => {
      log("ERROR", `[${this.config.name}] ffmpeg process error: ${err?.message || err}`);
      state.lastStreamErrorAt = new Date().toISOString();
      if (state.currentProcess === process) {
        state.currentProcess = null;
      }
    });
  }

  scheduleStreamRestart(guildId, state, delayMs, reason = "restart") {
    if (state.streamRestartTimer) {
      clearTimeout(state.streamRestartTimer);
    }

    const delay = applyJitter(Math.max(250, Number(delayMs) || 0), 0.15);
    state.streamRestartTimer = setTimeout(() => {
      state.streamRestartTimer = null;
      this.restartCurrentStation(state, guildId).catch((err) => {
        log("ERROR", `[${this.config.name}] Stream restart failed (${reason}): ${err?.message || err}`);
      });
    }, delay);
  }

  handleStreamEnd(guildId, state, reason) {
    if (!state.shouldReconnect || !state.currentStationKey) return;
    // Don't restart stream if there's no voice connection (reconnect handler will deal with it)
    if (!state.connection) return;

    const now = Date.now();
    const streamLifetimeMs = state.lastStreamStartAt ? (now - state.lastStreamStartAt) : 0;
    const earlyIdle = reason === "idle" && streamLifetimeMs > 0 && streamLifetimeMs < 5000;
    const recentProcessFailure = (state.lastProcessExitCode ?? 0) !== 0
      && state.lastProcessExitAt > 0
      && (now - state.lastProcessExitAt) <= STREAM_PROCESS_FAILURE_WINDOW_MS;
    const recentNetworkFailure = state.lastNetworkFailureAt > 0
      && (now - state.lastNetworkFailureAt) <= Math.max(60_000, STREAM_RESTART_MAX_MS);
    const treatAsError = reason === "error" || earlyIdle || recentProcessFailure;

    if (treatAsError) {
      state.streamErrorCount = (state.streamErrorCount || 0) + 1;
    } else {
      state.streamErrorCount = 0;
    }

    const errorCount = state.streamErrorCount || 0;
    const tierConfig = getTierConfig(guildId);
    let delay = Math.max(1_000, tierConfig.reconnectMs);

    if (treatAsError) {
      const exp = Math.min(Math.max(errorCount - 1, 0), 8);
      delay = Math.min(STREAM_RESTART_MAX_MS, STREAM_RESTART_BASE_MS * Math.pow(2, exp));
    } else {
      delay = Math.max(delay, STREAM_RESTART_BASE_MS);
    }

    if (recentNetworkFailure) {
      const penalty = Math.min(STREAM_RESTART_MAX_MS, STREAM_RESTART_BASE_MS * Math.pow(2, Math.min(errorCount + 1, 8)));
      delay = Math.max(delay, penalty);
    }

    if (errorCount >= STREAM_ERROR_COOLDOWN_THRESHOLD) {
      delay = Math.max(delay, STREAM_ERROR_COOLDOWN_MS);
      log(
        "INFO",
        `[${this.config.name}] Viele Stream-Fehler (${errorCount}) guild=${guildId}, Cooldown ${STREAM_ERROR_COOLDOWN_MS}ms`
      );
    }

    const networkCooldownMs = networkRecoveryCoordinator.getRecoveryDelayMs(now);
    if (networkCooldownMs > 0) {
      delay = Math.max(delay, networkCooldownMs);
    }

    const reasonLabel = recentProcessFailure && reason === "idle"
      ? "idle-after-ffmpeg-exit"
      : earlyIdle
        ? "idle-early"
        : reason;
    log(
      "INFO",
      `[${this.config.name}] Stream ${reasonLabel} guild=${guildId} lifetimeMs=${streamLifetimeMs} errors=${errorCount}, restart in ${Math.round(delay)}ms`
    );

    this.scheduleStreamRestart(guildId, state, delay, reasonLabel);
  }

  async playStation(state, stations, key, guildId) {
    const station = stations.stations[key];
    if (!station) throw new Error("Station nicht gefunden.");

    this.clearCurrentProcess(state);

    // Premium: override bitrate based on tier
    let bitrateOverride = null;
    if (guildId) {
      const tierConfig = getTierConfig(guildId);
      bitrateOverride = tierConfig.bitrate;
    }

    const { resource, process } = await createResource(
      station.url,
      state.volume,
      stations.qualityPreset,
      this.config.name,
      bitrateOverride
    );

    state.currentProcess = process;
    this.trackProcessLifecycle(guildId, state, process);

    state.player.play(resource);
    state.currentStationKey = key;
    state.currentStationName = station.name || key;
    state.currentMeta = null;
    state.nowPlayingSignature = null;
    state.lastStreamStartAt = Date.now();
    state.lastProcessExitCode = null;
    state.lastProcessExitAt = 0;
    this.armStreamStabilityReset(guildId, state);
    this.updatePresence();
    this.persistState();
    this.startNowPlayingLoop(guildId, state);

    fetchStreamInfo(station.url)
      .then((meta) => {
        if (state.currentStationKey === key) {
          const prevMeta = state.currentMeta || {};
          state.currentMeta = {
            ...prevMeta,
            name: meta.name || prevMeta.name || station.name || key,
            description: meta.description || prevMeta.description || null,
            streamTitle: meta.streamTitle || prevMeta.streamTitle || null,
            artist: meta.artist || prevMeta.artist || null,
            title: meta.title || prevMeta.title || null,
            displayTitle: meta.displayTitle || prevMeta.displayTitle || meta.streamTitle || prevMeta.streamTitle || null,
            artworkUrl: prevMeta.artworkUrl || null,
            updatedAt: new Date().toISOString(),
          };
          this.recordSongHistory(guildId, state, station, state.currentMeta);
        }
      })
      .catch(() => {
        // ignore metadata lookup errors
      });
  }

  async restartCurrentStation(state, guildId) {
    if (!state.shouldReconnect || !state.currentStationKey) return;

    const stations = loadStations();
    const key = state.currentStationKey;
    if (!stations.stations[key]) {
      this.clearNowPlayingTimer(state);
      state.currentStationKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.nowPlayingSignature = null;
      this.updatePresence();
      return;
    }

    const networkCooldownMs = networkRecoveryCoordinator.getRecoveryDelayMs();
    if (networkCooldownMs > 0) {
      this.scheduleStreamRestart(guildId, state, Math.max(1_000, networkCooldownMs), "network-cooldown");
      return;
    }

    try {
      this.clearCurrentProcess(state);
      await this.playStation(state, stations, key, guildId);
      log("INFO", `[${this.config.name}] Stream restarted: ${key}`);
    } catch (err) {
      state.lastStreamErrorAt = new Date().toISOString();
      log("ERROR", `[${this.config.name}] Auto-restart error for ${key}: ${err.message}`);

      const fallbackKey = getFallbackKey(stations, key);
      if (fallbackKey && stations.stations[fallbackKey]) {
        try {
          await this.playStation(state, stations, fallbackKey, guildId);
          log("INFO", `[${this.config.name}] Fallback to ${fallbackKey} after restart failure`);
        } catch (fallbackErr) {
          log("ERROR", `[${this.config.name}] Fallback restart also failed: ${fallbackErr.message}`);
        }
      }
    }
  }

  async cleanupGuildCommands() {
    if (!this.isGuildCommandCleanupEnabled()) return;
    const applicationId = this.getApplicationId();
    if (!applicationId) {
      log("ERROR", `[${this.config.name}] Guild-Command-Cleanup uebersprungen: Application ID fehlt.`);
      return;
    }

    const guildIds = [...this.client.guilds.cache.keys()];
    if (!guildIds.length) return;

    let cleaned = 0;
    let failed = 0;
    log("INFO", `[${this.config.name}] Bereinige Guild-Commands in ${guildIds.length} Servern...`);

    for (const guildId of guildIds) {
      try {
        await this.rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] });
        cleaned += 1;
      } catch (err) {
        failed += 1;
        log(
          "ERROR",
          `[${this.config.name}] Guild-Command-Cleanup fehlgeschlagen (guild=${guildId}): ${err?.message || err}`
        );
      }
    }

    log(
      "INFO",
      `[${this.config.name}] Guild-Command-Cleanup fertig: ok=${cleaned}, failed=${failed}.`
    );
  }

  async resolveBotMember(guild) {
    if (guild.members.me) return guild.members.me;
    return guild.members.fetchMe().catch(() => null);
  }

  async listVoiceChannels(guild) {
    let channels = [...guild.channels.cache.values()];
    if (!channels.length) {
      await guild.channels.fetch().catch(() => null);
      channels = [...guild.channels.cache.values()];
    }

    return channels
      .filter(
        (channel) =>
          channel &&
          channel.isVoiceBased() &&
          (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)
      )
      .sort((a, b) => {
        const posDiff = (a.rawPosition || 0) - (b.rawPosition || 0);
        if (posDiff !== 0) return posDiff;
        return a.name.localeCompare(b.name, "de");
      });
  }

  async resolveVoiceChannelFromInput(guild, inputValue) {
    const raw = String(inputValue || "").trim();
    if (!raw) return null;

    const mention = raw.match(/^<#(\d+)>$/);
    const idInput = mention ? mention[1] : /^\d+$/.test(raw) ? raw : null;

    if (idInput) {
      const byId = guild.channels.cache.get(idInput) || (await guild.channels.fetch(idInput).catch(() => null));
      if (
        byId &&
        byId.isVoiceBased() &&
        (byId.type === ChannelType.GuildVoice || byId.type === ChannelType.GuildStageVoice)
      ) {
        return byId;
      }
    }

    const channels = await this.listVoiceChannels(guild);
    const query = raw.toLowerCase();
    const exact = channels.find((channel) => channel.name.toLowerCase() === query);
    if (exact) return exact;

    const startsWith = channels.find((channel) => channel.name.toLowerCase().startsWith(query));
    if (startsWith) return startsWith;

    return channels.find((channel) => channel.name.toLowerCase().includes(query)) || null;
  }

  buildPresenceActivity() {
    const activeStations = [];
    for (const state of this.guildState.values()) {
      if (!state.currentStationKey || !state.connection) continue;
      activeStations.push(clipText(state.currentStationName || state.currentStationKey, 96));
    }

    const publicUrl = String(process.env.PUBLIC_WEB_URL || "").trim();

    if (activeStations.length === 0) {
      return {
        type: ActivityType.Listening,
        name: publicUrl ? `${BRAND.name} | /play | ${publicUrl}` : `${BRAND.name} | /play`
      };
    }

    if (activeStations.length === 1) {
      return {
        type: ActivityType.Listening,
        name: activeStations[0]
      };
    }

    // Mehrere Guilds: Zwischen Station-Namen rotieren
    if (!this._presenceRotationIndex) this._presenceRotationIndex = 0;
    this._presenceRotationIndex = this._presenceRotationIndex % activeStations.length;
    const currentStation = activeStations[this._presenceRotationIndex];
    this._presenceRotationIndex++;
    return {
      type: ActivityType.Listening,
      name: `${currentStation} (+${activeStations.length - 1})`
    };
  }

  updatePresence() {
    if (!this.client.user) return;
    const activity = this.buildPresenceActivity();
    try {
      this.client.user.setPresence({
        status: "online",
        activities: [activity]
      });
    } catch (err) {
      log("ERROR", `[${this.config.name}] Presence update fehlgeschlagen: ${err?.message || err}`);
    }

    // Rotation starten/stoppen basierend auf Anzahl aktiver Guilds
    const activeCount = [...this.guildState.values()].filter(s => s.currentStationKey).length;
    if (activeCount > 1) {
      this.startPresenceRotation();
    } else {
      this.stopPresenceRotation();
    }
  }

  startPresenceRotation() {
    if (this._presenceInterval) return;
    this._presenceInterval = setInterval(() => this.updatePresence(), 30000);
  }

  stopPresenceRotation() {
    if (this._presenceInterval) {
      clearInterval(this._presenceInterval);
      this._presenceInterval = null;
    }
  }

  handleBotVoiceStateUpdate(oldState, newState) {
    if (!this.client.user) return;
    if (newState.id !== this.client.user.id) return;

    const guildId = newState.guild.id;
    const state = this.getState(guildId);
    const oldChannelId = oldState.channelId;
    const newChannelId = newState.channelId;

    // Bot hat Channel gewechselt oder ist einem beigetreten
    if (newChannelId) {
      state.lastChannelId = newChannelId;
      return;
    }

    // Bot hat Voice verlassen
    if (!oldChannelId) return;

    // Destroy connection FIRST (so handleStreamEnd triggered by player.stop sees connection=null and skips)
    if (state.connection) {
      try { state.connection.destroy(); } catch {}
      state.connection = null;
    }
    // Now safe to stop player - Idle event fires, handleStreamEnd checks connection (null) and returns
    state.player.stop();
    this.clearCurrentProcess(state);

    // Auto-reconnect: schedule if we should reconnect and had an active station
    if (state.shouldReconnect && state.currentStationKey && state.lastChannelId) {
      this.clearNowPlayingTimer(state);
      log("INFO",
        `[${this.config.name}] Voice lost (Guild ${guildId}, Channel ${oldChannelId}). Scheduling auto-reconnect...`
      );
      // scheduleReconnect has built-in dedup (checks reconnectTimer)
      this.scheduleReconnect(guildId, { reason: "voice-lost" });
      return;
    }

    // Intentional disconnect (/stop or shouldReconnect=false) - clean up fully
    log("INFO",
      `[${this.config.name}] Voice left (Guild ${guildId}, Channel ${oldChannelId}). No reconnect.`
    );
    this.clearReconnectTimer(state);
    this.clearNowPlayingTimer(state);
    state.currentStationKey = null;
    state.currentStationName = null;
    state.currentMeta = null;
    state.nowPlayingSignature = null;
    state.lastChannelId = null;
    state.reconnectAttempts = 0;
    state.streamErrorCount = 0;
    this.updatePresence();
    this.persistState();
  }

  attachConnectionHandlers(guildId, connection) {
    const state = this.getState(guildId);

    const markDisconnected = () => {
      if (state.connection === connection) {
        state.connection = null;
      }
    };

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (!state.shouldReconnect) {
        markDisconnected();
        return;
      }

      // Try to recover the existing connection first (e.g. after region move)
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
        // Connection is recovering on its own
        log("INFO", `[${this.config.name}] Voice connection recovering for guild=${guildId}`);
      } catch {
        // Recovery failed - destroy connection, voiceStateUpdate will handle reconnect
        log("INFO", `[${this.config.name}] Voice connection recovery failed for guild=${guildId}, destroying`);
        markDisconnected();
        try { connection.destroy(); } catch { /* ignore */ }
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      markDisconnected();
    });

    connection.on("error", (err) => {
      log("ERROR", `[${this.config.name}] VoiceConnection error: ${err?.message || err}`);
      markDisconnected();
      if (!state.shouldReconnect) return;
      this.scheduleReconnect(guildId, { reason: "voice-error" });
    });
  }

  hasGuildManagePermissions(interaction) {
    if (!interaction) return false;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || false;
  }

  isGuildOwner(interaction) {
    const ownerId = String(interaction?.guild?.ownerId || "").trim();
    const userId = String(interaction?.user?.id || "").trim();
    return Boolean(ownerId && userId && ownerId === userId);
  }

  hasPermissionAdminBypass(interaction) {
    return this.isGuildOwner(interaction) || this.hasGuildManagePermissions(interaction);
  }

  resolveGuildLanguage(guildId) {
    const guildKey = String(guildId || "").trim();
    const guildOverride = guildKey ? getGuildLanguage(guildKey) : null;
    if (guildOverride) return guildOverride;

    const guild = guildKey ? this.client.guilds.cache.get(guildKey) : null;
    return resolveLanguageFromDiscordLocale(guild?.preferredLocale, getDefaultLanguage());
  }

  resolveInteractionLanguage(interaction) {
    const guildId = String(interaction?.guildId || "").trim();
    const guildOverride = guildId ? getGuildLanguage(guildId) : null;
    if (guildOverride) return guildOverride;

    const raw = String(
      interaction?.guildLocale
      || interaction?.guild?.preferredLocale
      || interaction?.locale
      || ""
    ).trim();
    return resolveLanguageFromDiscordLocale(raw, getDefaultLanguage());
  }

  createInteractionTranslator(interaction) {
    const language = this.resolveInteractionLanguage(interaction);
    const isDe = language === "de";
    return {
      language,
      isDe,
      t: (de, en) => (isDe ? de : en),
    };
  }

  buildHelpMessage(interaction) {
    const language = this.resolveInteractionLanguage(interaction);
    const isDe = language === "de";
    const guildId = interaction?.guildId;
    const tierConfig = guildId ? getTierConfig(guildId) : PLANS.free;

    if (isDe) {
      const lines = [
        `**${BRAND.name} Hilfe**`,
        `Server: ${interaction.guild?.name || guildId || "-"}`,
        `Plan: ${tierConfig.name} | Audio: ${tierConfig.bitrate} | Max Bots: ${tierConfig.maxBots}`,
        "",
        "**Schnellstart**",
        "1) `/play [station] [voice]` startet Musik im Voice/Stage-Channel.",
        "2) `/stations` zeigt alle verfuegbaren Sender fuer deinen Plan.",
        "3) `/stop` beendet den Stream und verlaesst den Channel.",
        "",
        "**Basis-Commands**",
        "`/help` Hilfe anzeigen",
        "`/play [station] [voice]` Sender starten",
        "`/pause` `/resume` Pause/Fortsetzen",
        "`/stop` Stream stoppen",
        "`/setvolume <0-100>` Lautstaerke setzen",
        "`/stations` und `/list [page]` Sender anzeigen",
        "`/now` aktuelle Wiedergabe",
        "`/history [limit]` zuletzt erkannte Songs",
        "`/status`, `/health`, `/diag` Bot- und Stream-Status",
        "`/premium` Premium-Status",
        "`/language show|set|reset` Bot-Sprache (auto nach Server-Sprache oder fix)",
        "`/license activate|info|remove` Lizenz verwalten",
        "",
        "**Pro/Ultimate**",
        "`/perm allow|deny|remove|list|reset` Rollenrechte pro Command (Berechtigung: Server verwalten)",
        "`/event create|list|delete` Events planen (Voice/Stage + Zeitzone + flexible Wiederholung + optionale Text-Info + Server-Event)",
        "",
        "**Ultimate**",
        "`/addstation <key> <name> <url>` eigene Station hinzufuegen",
        "`/removestation <key>` eigene Station entfernen",
        "`/mystations` eigene Stationen anzeigen",
        "",
        "Support: https://discord.gg/UeRkfGS43R",
      ];
      return lines.join("\n");
    }

    const lines = [
      `**${BRAND.name} Help**`,
      `Server: ${interaction.guild?.name || guildId || "-"}`,
      `Plan: ${tierConfig.name} | Audio: ${tierConfig.bitrate} | Max bots: ${tierConfig.maxBots}`,
      "",
      "**Quick start**",
      "1) `/play [station] [voice]` starts radio in your voice/stage channel.",
      "2) `/stations` shows available stations for your plan.",
      "3) `/stop` ends playback and leaves the channel.",
      "",
      "**Core commands**",
      "`/help` show this help",
      "`/play [station] [voice]` start station",
      "`/pause` `/resume` pause/resume",
      "`/stop` stop stream",
      "`/setvolume <0-100>` set volume",
      "`/stations` and `/list [page]` browse stations",
      "`/now` current playback",
      "`/history [limit]` recently detected songs",
      "`/status`, `/health`, `/diag` bot/stream status",
      "`/premium` premium status",
      "`/language show|set|reset` bot language (auto from server locale or fixed)",
      "`/license activate|info|remove` license management",
      "",
      "**Pro/Ultimate**",
      "`/perm allow|deny|remove|list|reset` role permissions per command (requires: Manage Server)",
      "`/event create|list|delete` schedule events (voice/stage + time zone + flexible recurrence + optional text notice + server event)",
      "",
      "**Ultimate**",
      "`/addstation <key> <name> <url>` add custom station",
      "`/removestation <key>` remove custom station",
      "`/mystations` list custom stations",
      "",
      "Support: https://discord.gg/UeRkfGS43R",
    ];
    return lines.join("\n");
  }

  getInteractionRoleIds(interaction) {
    const ids = new Set();
    const rawRoles = interaction?.member?.roles;

    if (rawRoles?.cache && typeof rawRoles.cache.keys === "function") {
      for (const roleId of rawRoles.cache.keys()) {
        const id = String(roleId || "").trim();
        if (/^\d{17,22}$/.test(id)) ids.add(id);
      }
    } else if (Array.isArray(rawRoles)) {
      for (const roleId of rawRoles) {
        const id = String(roleId || "").trim();
        if (/^\d{17,22}$/.test(id)) ids.add(id);
      }
    } else if (Array.isArray(rawRoles?.value)) {
      for (const roleId of rawRoles.value) {
        const id = String(roleId || "").trim();
        if (/^\d{17,22}$/.test(id)) ids.add(id);
      }
    }

    if (interaction?.guildId) {
      ids.add(String(interaction.guildId));
    }
    return [...ids];
  }

  formatPermissionRoleMentions(roleIds) {
    const ids = Array.isArray(roleIds) ? roleIds.filter((id) => /^\d{17,22}$/.test(String(id || "").trim())) : [];
    if (!ids.length) return "-";
    return ids.map((id) => `<@&${id}>`).join(", ");
  }

  checkCommandRolePermission(interaction, commandName) {
    const guildId = interaction?.guildId;
    const command = normalizePermissionCommandName(commandName);
    if (!guildId || !isPermissionManagedCommand(command)) {
      return { ok: true, enforced: false };
    }

    const { t } = this.createInteractionTranslator(interaction);

    const feature = requireFeature(guildId, "commandPermissions");
    if (!feature.ok) {
      return { ok: true, enforced: false };
    }

    if (this.hasPermissionAdminBypass(interaction)) {
      return { ok: true, enforced: true, bypass: true };
    }

    const roleIds = this.getInteractionRoleIds(interaction);
    const decision = evaluateCommandPermission(guildId, command, roleIds);
    if (decision.allowed) {
      return { ok: true, enforced: decision.configured, decision };
    }

    if (decision.reason === "deny") {
      const blocked = this.formatPermissionRoleMentions(decision.matchedRoleIds || decision.denyRoleIds);
      return {
        ok: false,
        enforced: true,
        decision,
        message: t(
          `Du darfst \`/${command}\` nicht nutzen. Deine Rolle ist dafuer gesperrt (${blocked}).`,
          `You are not allowed to use \`/${command}\`. Your role is blocked for this command (${blocked}).`
        ),
      };
    }

    const requiredRoles = this.formatPermissionRoleMentions(decision.allowRoleIds);
    return {
      ok: false,
      enforced: true,
      decision,
      message: t(
        `Du darfst \`/${command}\` nicht nutzen. Erlaubte Rollen: ${requiredRoles}.`,
        `You are not allowed to use \`/${command}\`. Allowed roles: ${requiredRoles}.`
      ),
    };
  }

  async handlePermissionCommand(interaction) {
    const guildId = interaction.guildId;
    const { t, language } = this.createInteractionTranslator(interaction);

    if (!this.hasGuildManagePermissions(interaction)) {
      await interaction.reply({
        content: t(
          "Du brauchst die Berechtigung `Server verwalten` fuer `/perm`.",
          "You need the `Manage Server` permission for `/perm`."
        ),
        ephemeral: true,
      });
      return;
    }

    const feature = requireFeature(guildId, "commandPermissions");
    if (!feature.ok) {
      await interaction.reply({
        content: `${getFeatureRequirementMessage(feature, language)}\nUpgrade: ${BRAND.upgradeUrl || "https://discord.gg/UeRkfGS43R"}`,
        ephemeral: true,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const rawCommand = interaction.options.getString("command");
    const command = rawCommand ? normalizePermissionCommandName(rawCommand) : null;
    if (command && !isPermissionManagedCommand(command)) {
      await interaction.reply({
        content: t(
          `Unbekannter Command: \`${rawCommand}\``,
          `Unknown command: \`${rawCommand}\``
        ),
        ephemeral: true,
      });
      return;
    }

    if (sub === "allow" || sub === "deny") {
      const role = interaction.options.getRole("role", true);
      const result = setCommandRolePermission(guildId, command, role.id, sub);
      if (!result.ok) {
        const storeMessage = translatePermissionStoreMessage(result.message, language);
        await interaction.reply({ content: t(`Fehler: ${storeMessage}`, `Error: ${storeMessage}`), ephemeral: true });
        return;
      }
      await this.respondLongInteraction(
        interaction,
        `${t("Rolle", "Role")} ${role.toString()} ${t("ist jetzt fuer", "is now")} \`/${command}\` ${sub === "allow" ? t("erlaubt", "allowed") : t("gesperrt", "blocked")}.\n` +
          `Allow: ${this.formatPermissionRoleMentions(result.rule.allowRoleIds)}\n` +
          `Deny: ${this.formatPermissionRoleMentions(result.rule.denyRoleIds)}`,
        { ephemeral: true }
      );
      return;
    }

    if (sub === "remove") {
      const role = interaction.options.getRole("role", true);
      const result = removeCommandRolePermission(guildId, command, role.id);
      if (!result.ok) {
        const storeMessage = translatePermissionStoreMessage(result.message, language);
        await interaction.reply({ content: t(`Fehler: ${storeMessage}`, `Error: ${storeMessage}`), ephemeral: true });
        return;
      }
      await this.respondLongInteraction(
        interaction,
        `${t("Regel fuer", "Rule for")} ${role.toString()} ${t("bei", "on")} \`/${command}\` ${result.changed ? t("entfernt", "removed") : t("war nicht gesetzt", "was not set")}.\n` +
          `Allow: ${this.formatPermissionRoleMentions(result.rule.allowRoleIds)}\n` +
          `Deny: ${this.formatPermissionRoleMentions(result.rule.denyRoleIds)}`,
        { ephemeral: true }
      );
      return;
    }

    if (sub === "reset") {
      const result = resetCommandPermissions(guildId, command || null);
      if (!result.ok) {
        const storeMessage = translatePermissionStoreMessage(result.message, language);
        await interaction.reply({ content: t(`Fehler: ${storeMessage}`, `Error: ${storeMessage}`), ephemeral: true });
        return;
      }

      if (command) {
        await interaction.reply({
          content: result.changed
            ? t(`Regeln fuer \`/${command}\` wurden zurueckgesetzt.`, `Rules for \`/${command}\` were reset.`)
            : t(`Fuer \`/${command}\` waren keine Regeln gesetzt.`, `No rules were configured for \`/${command}\`.`),
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: result.changed
            ? t("Alle Command-Regeln fuer diesen Server wurden zurueckgesetzt.", "All command rules for this server were reset.")
            : t("Es waren keine Command-Regeln gesetzt.", "No command rules were configured."),
          ephemeral: true,
        });
      }
      return;
    }

    if (sub === "list") {
      const rulesByCommand = getGuildCommandPermissionRules(guildId);
      const commands = command ? [command] : getSupportedPermissionCommands();
      const lines = [];

      for (const name of commands) {
        const rule = rulesByCommand[name] || { allowRoleIds: [], denyRoleIds: [] };
        const allowCount = rule.allowRoleIds.length;
        const denyCount = rule.denyRoleIds.length;
        if (!command && allowCount === 0 && denyCount === 0) continue;
        lines.push(
          `\`/${name}\` -> Allow: ${this.formatPermissionRoleMentions(rule.allowRoleIds)} | Deny: ${this.formatPermissionRoleMentions(rule.denyRoleIds)}`
        );
      }

      if (!lines.length) {
        await interaction.reply({
          content: command
            ? t(`Fuer \`/${command}\` sind keine Rollenregeln gesetzt.`, `No role rules are configured for \`/${command}\`.`)
            : t("Keine Command-Rollenregeln gesetzt.", "No command role rules are configured."),
          ephemeral: true,
        });
        return;
      }

      const header = command
        ? t(`Regeln fuer \`/${command}\`:`, `Rules for \`/${command}\`:`)
        : t(`Aktive Command-Rollenregeln (${lines.length}):`, `Active command role rules (${lines.length}):`);
      await this.respondLongInteraction(interaction, `${header}\n${lines.join("\n")}`, { ephemeral: true });
      return;
    }

    await interaction.reply({ content: t("Unbekannte /perm Aktion.", "Unknown /perm action."), ephemeral: true });
  }

  resolveStationForGuild(guildId, rawStationKey, language = "de") {
    const t = (de, en) => languagePick(language, de, en);
    const key = normalizeKey(rawStationKey);
    if (!key) {
      return { ok: false, message: t("Stations-Key ist ungueltig.", "Station key is invalid.") };
    }

    const stations = loadStations();
    const guildTier = getTier(guildId);
    const available = filterStationsByTier(stations.stations, guildTier);
    if (available[key]) {
      stations.stations[key] = available[key];
      return { ok: true, key, station: available[key], stations };
    }

    if (guildTier === "ultimate") {
      const customStations = getGuildStations(guildId);
      const custom = customStations[key];
      if (custom) {
        const validation = validateCustomStationUrl(custom.url);
        if (!validation.ok) {
          const translated = translateCustomStationErrorMessage(validation.error, language);
          return { ok: false, message: t(`Custom-Station kann nicht genutzt werden: ${translated}`, `Custom station cannot be used: ${translated}`) };
        }
        const station = { name: custom.name, url: validation.url, tier: "ultimate" };
        stations.stations[key] = station;
        return { ok: true, key, station, stations };
      }
    }

    if (stations.stations[key]) {
      return { ok: false, message: t(`Station \`${key}\` ist in deinem Plan nicht verfuegbar.`, `Station \`${key}\` is not available in your plan.`) };
    }
    return { ok: false, message: t(`Station \`${key}\` wurde nicht gefunden.`, `Station \`${key}\` was not found.`) };
  }

  async resolveGuildVoiceChannel(guildId, channelId) {
    const guild = this.client.guilds.cache.get(guildId) || await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { guild: null, channel: null };

    const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) return { guild, channel: null };
    if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
      return { guild, channel: null };
    }

    return { guild, channel };
  }

  async ensureStageChannelReady(guild, channel, {
    topic = null,
    guildScheduledEventId = null,
    createInstance = true,
    ensureSpeaker = true,
  } = {}) {
    if (!guild || !channel || channel.type !== ChannelType.GuildStageVoice) return null;

    const me = await this.resolveBotMember(guild);
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
          `[${this.config.name}] Stage-Instance konnte nicht erstellt werden (guild=${guild.id}, channel=${channel.id}): ${err?.message || err}`
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
          `[${this.config.name}] Stage-Topic Update fehlgeschlagen (guild=${guild.id}, channel=${channel.id}): ${err?.message || err}`
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

  async deleteDiscordScheduledEventById(guildId, scheduledEventId) {
    const eventId = String(scheduledEventId || "").trim();
    if (!/^\d{17,22}$/.test(eventId)) return false;

    const guild = this.client.guilds.cache.get(guildId) || await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return false;

    const scheduled = await guild.scheduledEvents.fetch(eventId).catch(() => null);
    if (!scheduled) return false;

    await scheduled.delete().catch(() => null);
    return true;
  }

  async syncDiscordScheduledEvent(event, station, { runAtMs = null, forceCreate = false } = {}) {
    if (!event?.createDiscordEvent) return null;

    const { guild, channel } = await this.resolveGuildVoiceChannel(event.guildId, event.voiceChannelId);
    if (!guild || !channel) {
      throw new Error("Voice- oder Stage-Channel fuer Server-Event nicht gefunden.");
    }

    const requestedRunAtMs = Number.parseInt(String(runAtMs ?? event.runAtMs ?? 0), 10);
    const minDiscordStartMs = Date.now() + 60_000;
    const scheduledRunAtMs = Number.isFinite(requestedRunAtMs) && requestedRunAtMs > 0
      ? Math.max(requestedRunAtMs, minDiscordStartMs)
      : minDiscordStartMs;

    const stationName = clipText(station?.name || event.stationKey || "-", 100) || "-";
    const payload = {
      name: clipText(event.name || stationName || `${BRAND.name} Event`, 100),
      scheduledStartTime: new Date(scheduledRunAtMs),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: channel.type === ChannelType.GuildStageVoice
        ? GuildScheduledEventEntityType.StageInstance
        : GuildScheduledEventEntityType.Voice,
      channel,
      description: clipText(`OmniFM Auto-Event | Station: ${stationName}`, 1000),
      reason: `OmniFM scheduled event ${event.id}`,
    };

    const existingId = String(event.discordScheduledEventId || "").trim();
    let scheduledEvent = null;

    if (existingId && forceCreate) {
      await this.deleteDiscordScheduledEventById(guild.id, existingId);
    } else if (existingId) {
      const existingEvent = await guild.scheduledEvents.fetch(existingId).catch(() => null);
      if (existingEvent) {
        scheduledEvent = await existingEvent.edit(payload).catch(() => null);
      }
    }

    if (!scheduledEvent) {
      scheduledEvent = await guild.scheduledEvents.create(payload);
    }

    if (scheduledEvent?.id && scheduledEvent.id !== existingId) {
      patchScheduledEvent(event.id, { discordScheduledEventId: scheduledEvent.id });
    }

    return scheduledEvent || null;
  }

  async ensureVoiceConnectionForChannel(guildId, channelId, state) {
    const { guild, channel } = await this.resolveGuildVoiceChannel(guildId, channelId);
    if (!guild) throw new Error("Guild nicht gefunden.");
    if (!channel) throw new Error("Voice- oder Stage-Channel nicht gefunden.");

    const me = await this.resolveBotMember(guild);
    if (!me) throw new Error("Bot-Mitglied nicht aufloesbar.");

    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.Connect)) {
      throw new Error(`Keine Connect-Berechtigung fuer ${channel.toString()}.`);
    }
    if (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) {
      throw new Error(`Keine Speak-Berechtigung fuer ${channel.toString()}.`);
    }

    state.lastChannelId = channel.id;

    if (state.connection) {
      const currentChannelId = state.connection.joinConfig?.channelId;
      if (currentChannelId === channel.id) {
        state.shouldReconnect = true;
        if (channel.type === ChannelType.GuildStageVoice) {
          await this.ensureStageChannelReady(guild, channel, { createInstance: false, ensureSpeaker: true });
        }
        return { connection: state.connection, guild, channel };
      }

      const previousShouldReconnect = state.shouldReconnect;
      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      try { state.connection.destroy(); } catch {}
      state.connection = null;
      state.shouldReconnect = previousShouldReconnect;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      group: this.voiceGroup,
      selfDeaf: true
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      try { connection.destroy(); } catch {}
      throw new Error("Voice-Verbindung konnte nicht hergestellt werden.");
    }

    connection.subscribe(state.player);
    state.connection = connection;
    state.reconnectAttempts = 0;
    state.lastReconnectAt = new Date().toISOString();
    state.shouldReconnect = true;
    this.clearReconnectTimer(state);
    this.attachConnectionHandlers(guildId, connection);
    networkRecoveryCoordinator.noteSuccess(`${this.config.name} voice-ready guild=${guildId}`);

    if (channel.type === ChannelType.GuildStageVoice) {
      await this.ensureStageChannelReady(guild, channel, { createInstance: false, ensureSpeaker: true });
    }

    return { connection, guild, channel };
  }

  async postScheduledEventAnnouncement(event, station, language = "de") {
    if (!event?.textChannelId) return;

    const guild = this.client.guilds.cache.get(event.guildId);
    if (!guild) return;

    const channel = guild.channels.cache.get(event.textChannelId)
      || await guild.channels.fetch(event.textChannelId).catch(() => null);
    if (!channel || typeof channel.send !== "function") return;

    const me = await this.resolveBotMember(guild);
    if (!me) return;

    const perms = channel.permissionsFor?.(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) return;

    const rendered = renderEventAnnouncement(event.announceMessage, {
      event: event.name,
      station: station?.name || event.stationKey,
      voice: `<#${event.voiceChannelId}>`,
      time: formatDateTime(event.runAtMs, language, event.timeZone),
    }, language);
    if (!rendered) return;

    await channel.send({
      content: clipText(rendered, 1800),
      allowedMentions: { parse: [] },
    });
  }

  async executeScheduledEvent(event) {
    const now = Date.now();
    if (!this.client.guilds.cache.has(event.guildId)) {
      deleteScheduledEvent(event.id, { guildId: event.guildId, botId: this.config.id });
      return;
    }

    const feature = requireFeature(event.guildId, "scheduledEvents");
    if (!feature.ok) {
      patchScheduledEvent(event.id, { enabled: false, lastRunAtMs: now });
      log(
        "INFO",
        `[${this.config.name}] Event deaktiviert (Plan zu niedrig): guild=${event.guildId} id=${event.id}`
      );
      return;
    }

    const state = this.getState(event.guildId);
    const eventLanguage = this.resolveGuildLanguage(event.guildId);
    const stationResult = this.resolveStationForGuild(event.guildId, event.stationKey, eventLanguage);
    if (!stationResult.ok) {
      patchScheduledEvent(event.id, { runAtMs: now + EVENT_SCHEDULER_RETRY_MS, enabled: true });
      log(
        "ERROR",
        `[${this.config.name}] Event ${event.id} konnte nicht starten: ${stationResult.message}`
      );
      return;
    }

    try {
      const connectionInfo = await this.ensureVoiceConnectionForChannel(event.guildId, event.voiceChannelId, state);
      if (connectionInfo?.channel?.type === ChannelType.GuildStageVoice) {
        const stageTopic = renderStageTopic(event.stageTopic, {
          event: event.name,
          station: stationResult.station?.name || event.stationKey,
          time: formatDateTime(event.runAtMs, eventLanguage, event.timeZone),
        });
        await this.ensureStageChannelReady(connectionInfo.guild, connectionInfo.channel, {
          topic: stageTopic,
          guildScheduledEventId: event.discordScheduledEventId || null,
          createInstance: true,
          ensureSpeaker: true,
        });
      }

      await this.playStation(state, stationResult.stations, stationResult.key, event.guildId);
      await this.postScheduledEventAnnouncement(event, stationResult.station, eventLanguage);

      const nextRunAtMs = computeNextEventRunAtMs(event.runAtMs, event.repeat, now, event.timeZone);
      if (nextRunAtMs) {
        let nextDiscordScheduledEventId = event.discordScheduledEventId || null;
        if (event.createDiscordEvent) {
          try {
            const nextDiscordEvent = await this.syncDiscordScheduledEvent(event, stationResult.station, {
              runAtMs: nextRunAtMs,
              forceCreate: true,
            });
            nextDiscordScheduledEventId = nextDiscordEvent?.id || nextDiscordScheduledEventId;
          } catch (syncErr) {
            log(
              "WARN",
              `[${this.config.name}] Discord-Server-Event konnte nicht auf Folgetermin gesetzt werden (guild=${event.guildId}, id=${event.id}): ${syncErr?.message || syncErr}`
            );
          }
        }

        patchScheduledEvent(event.id, {
          runAtMs: nextRunAtMs,
          lastRunAtMs: now,
          enabled: true,
          discordScheduledEventId: nextDiscordScheduledEventId,
        });
      } else {
        if (event.discordScheduledEventId) {
          await this.deleteDiscordScheduledEventById(event.guildId, event.discordScheduledEventId);
        }
        deleteScheduledEvent(event.id, { guildId: event.guildId, botId: this.config.id });
      }

      log(
        "INFO",
        `[${this.config.name}] Event gestartet: guild=${event.guildId} id=${event.id} station=${stationResult.key}`
      );
    } catch (err) {
      patchScheduledEvent(event.id, { runAtMs: now + EVENT_SCHEDULER_RETRY_MS, enabled: true });
      log(
        "ERROR",
        `[${this.config.name}] Event ${event.id} Startfehler: ${err?.message || err}`
      );
    }
  }

  async tickScheduledEvents() {
    if (!EVENT_SCHEDULER_ENABLED) return;
    if (!this.client.isReady()) return;

    const now = Date.now();
    const events = listScheduledEvents({
      botId: this.config.id,
      includeDisabled: false,
    });

    for (const event of events) {
      if (event.runAtMs > now + 1000) continue;
      if (event.lastRunAtMs && event.lastRunAtMs >= event.runAtMs) continue;
      if (this.scheduledEventInFlight.has(event.id)) continue;

      this.scheduledEventInFlight.add(event.id);
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.executeScheduledEvent(event);
      } finally {
        this.scheduledEventInFlight.delete(event.id);
      }
    }
  }

  startEventScheduler() {
    if (!EVENT_SCHEDULER_ENABLED) return;
    if (this.eventSchedulerTimer) return;

    const run = () => {
      this.tickScheduledEvents().catch((err) => {
        log("ERROR", `[${this.config.name}] Event-Scheduler Fehler: ${err?.message || err}`);
      });
    };

    run();
    this.eventSchedulerTimer = setInterval(run, EVENT_SCHEDULER_POLL_MS);
  }

  stopEventScheduler() {
    if (this.eventSchedulerTimer) {
      clearInterval(this.eventSchedulerTimer);
      this.eventSchedulerTimer = null;
    }
    this.scheduledEventInFlight.clear();
  }

  async handleEventCommand(interaction) {
    const guildId = interaction.guildId;
    const { t, language } = this.createInteractionTranslator(interaction);
    if (!this.hasGuildManagePermissions(interaction)) {
      await interaction.reply({
        content: t(
          "Du brauchst die Berechtigung `Server verwalten` fuer `/event`.",
          "You need the `Manage Server` permission for `/event`."
        ),
        ephemeral: true,
      });
      return;
    }

    const feature = requireFeature(guildId, "scheduledEvents");
    if (!feature.ok) {
      await interaction.reply({
        content: `${getFeatureRequirementMessage(feature, language)}\nUpgrade: ${BRAND.upgradeUrl || "https://discord.gg/UeRkfGS43R"}`,
        ephemeral: true,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "create") {
      const name = clipText(interaction.options.getString("name", true).trim(), 120);
      if (!name) {
        await interaction.reply({ content: t("Eventname darf nicht leer sein.", "Event name cannot be empty."), ephemeral: true });
        return;
      }
      const stationRaw = interaction.options.getString("station", true);
      const voiceChannel = interaction.options.getChannel("voice", true);
      const startRaw = interaction.options.getString("start", true);
      const requestedTimeZone = interaction.options.getString("timezone") || "";
      const repeat = normalizeRepeatMode(interaction.options.getString("repeat") || "none");
      const textChannel = interaction.options.getChannel("text");
      const createDiscordEvent = interaction.options.getBoolean("serverevent") === true;
      const stageTopicTemplate = clipText(interaction.options.getString("stagetopic") || "", 120);
      const message = clipText(interaction.options.getString("message") || "", 1200);

      if (voiceChannel.guildId !== guildId) {
        await interaction.reply({ content: t("Der gewaehlte Voice/Stage-Channel ist nicht in diesem Server.", "The selected voice/stage channel is not in this server."), ephemeral: true });
        return;
      }
      if (stageTopicTemplate && voiceChannel.type !== ChannelType.GuildStageVoice) {
        await interaction.reply({
          content: t("`stagetopic` funktioniert nur mit Stage-Channels.", "`stagetopic` only works with stage channels."),
          ephemeral: true,
        });
        return;
      }

      const me = interaction.guild ? await this.resolveBotMember(interaction.guild) : null;
      if (!me) {
        await interaction.reply({ content: t("Bot-Mitglied im Server konnte nicht geladen werden.", "Could not load bot member in this server."), ephemeral: true });
        return;
      }
      const perms = voiceChannel.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.Connect)) {
        await interaction.reply({ content: t(`Ich habe keine Connect-Berechtigung fuer ${voiceChannel.toString()}.`, `I do not have Connect permission for ${voiceChannel.toString()}.`), ephemeral: true });
        return;
      }
      if (voiceChannel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) {
        await interaction.reply({ content: t(`Ich habe keine Speak-Berechtigung fuer ${voiceChannel.toString()}.`, `I do not have Speak permission for ${voiceChannel.toString()}.`), ephemeral: true });
        return;
      }

      const parsed = parseEventStartDateTime(startRaw, language, requestedTimeZone);
      if (!parsed.ok) {
        await interaction.reply({ content: parsed.message, ephemeral: true });
        return;
      }
      const minFutureMs = Date.now() + 30_000;
      if (parsed.runAtMs < minFutureMs) {
        await interaction.reply({
          content: t("Startzeit muss mindestens 30 Sekunden in der Zukunft liegen.", "Start time must be at least 30 seconds in the future."),
          ephemeral: true,
        });
        return;
      }
      if (createDiscordEvent && parsed.runAtMs < Date.now() + 60_000) {
        await interaction.reply({
          content: t(
            "Mit `serverevent` muss die Startzeit mindestens 60 Sekunden in der Zukunft liegen.",
            "With `serverevent`, start time must be at least 60 seconds in the future."
          ),
          ephemeral: true,
        });
        return;
      }

      const station = this.resolveStationForGuild(guildId, stationRaw, language);
      if (!station.ok) {
        await interaction.reply({ content: station.message, ephemeral: true });
        return;
      }

      const created = createScheduledEvent({
        guildId,
        botId: this.config.id,
        name,
        stationKey: station.key,
        voiceChannelId: voiceChannel.id,
        textChannelId: textChannel?.id || null,
        announceMessage: message || null,
        stageTopic: stageTopicTemplate || null,
        timeZone: parsed.timeZone,
        createDiscordEvent,
        discordScheduledEventId: null,
        repeat,
        runAtMs: parsed.runAtMs,
        createdByUserId: interaction.user?.id || null,
      });

      if (!created.ok) {
        const storeMessage = translateScheduledEventStoreMessage(created.message, language);
        await interaction.reply({ content: t(`Event konnte nicht gespeichert werden: ${storeMessage}`, `Could not save event: ${storeMessage}`), ephemeral: true });
        return;
      }

      let serverEventWarning = "";
      let serverEventId = null;
      if (createDiscordEvent) {
        try {
          const scheduledEvent = await this.syncDiscordScheduledEvent(created.event, station.station, {
            runAtMs: created.event.runAtMs,
            forceCreate: false,
          });
          serverEventId = scheduledEvent?.id || null;
        } catch (err) {
          serverEventWarning = `\n${t("Server-Event Hinweis", "Server event note")}: ${clipText(err?.message || err, 180)}`;
          log(
            "WARN",
            `[${this.config.name}] Event ${created.event.id}: Discord-Server-Event konnte nicht erstellt werden: ${err?.message || err}`
          );
        }
      }

      const channelLabel = voiceChannel.type === ChannelType.GuildStageVoice ? t("Stage", "Stage") : t("Voice", "Voice");
      const stageTopicPreview = voiceChannel.type === ChannelType.GuildStageVoice
        ? renderStageTopic(stageTopicTemplate, {
          event: created.event.name,
          station: station.station?.name || created.event.stationKey,
          time: formatDateTime(created.event.runAtMs, language, created.event.timeZone),
        })
        : null;
      const eventTimeZone = normalizeEventTimeZone(created.event.timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
      await interaction.reply({
        content:
          `${t("Event erstellt", "Event created")}: **${created.event.name}**\n` +
          `ID: \`${created.event.id}\`\n` +
          `${t("Station", "Station")}: \`${created.event.stationKey}\` (${station.station?.name || "-"})\n` +
          `${channelLabel}: <#${created.event.voiceChannelId}>\n` +
          `${t("Start", "Start")}: ${formatDateTime(created.event.runAtMs, language, eventTimeZone)} (${eventTimeZone})\n` +
          `${t("Wiederholung", "Repeat")}: ${getRepeatLabel(created.event.repeat, language, { runAtMs: created.event.runAtMs, timeZone: eventTimeZone })}\n` +
          `${t("Ankuendigung", "Announcement")}: ${created.event.textChannelId ? `<#${created.event.textChannelId}>` : t("aus", "off")}\n` +
          `${t("Server-Event", "Server event")}: ${createDiscordEvent ? (serverEventId ? `${t("aktiv", "active")} (\`${serverEventId}\`)` : t("aktiviert, Erstellung fehlgeschlagen", "enabled, creation failed")) : t("aus", "off")}\n` +
          `${t("Stage-Thema", "Stage topic")}: ${stageTopicPreview ? `\`${stageTopicPreview}\`` : t("auto/aus", "auto/off")}\n` +
          `${t("Zeitzone", "Time zone")}: \`${eventTimeZone}\`` +
          serverEventWarning,
        ephemeral: true,
      });
      return;
    }

    if (sub === "list") {
      const events = listScheduledEvents({
        guildId,
        botId: this.config.id,
        includeDisabled: false,
      });

      if (!events.length) {
        await interaction.reply({ content: t("Keine geplanten Events.", "No scheduled events."), ephemeral: true });
        return;
      }

      const lines = events.map((event) =>
        `\`${event.id}\` | **${clipText(event.name, 70)}** | \`${event.stationKey}\` | ` +
        `${t("Voice/Stage", "Voice/Stage")} <#${event.voiceChannelId}> | ${formatDateTime(event.runAtMs, language, event.timeZone)} (${normalizeEventTimeZone(event.timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE}) | ${getRepeatLabel(event.repeat, language, { runAtMs: event.runAtMs, timeZone: event.timeZone })}` +
        `${event.createDiscordEvent ? ` | ${t("Server-Event", "Server event")} ${event.discordScheduledEventId ? `\`${event.discordScheduledEventId}\`` : t("an", "on")}` : ""}` +
        `${event.stageTopic ? ` | ${t("Stage-Thema", "Stage topic")}` : ""}`
      );
      await this.respondLongInteraction(interaction, `**${t("Geplante Events", "Scheduled events")} (${events.length}):**\n${lines.join("\n")}`, { ephemeral: true });
      return;
    }

    if (sub === "delete") {
      const id = interaction.options.getString("id", true);
      const existing = getScheduledEvent(id);
      let removedDiscordEvent = false;
      if (existing && existing.guildId === guildId && existing.botId === this.config.id && existing.discordScheduledEventId) {
        removedDiscordEvent = await this.deleteDiscordScheduledEventById(guildId, existing.discordScheduledEventId);
      }
      const removed = deleteScheduledEvent(id, { guildId, botId: this.config.id });
      if (!removed.ok) {
        await interaction.reply({ content: translateScheduledEventStoreMessage(removed.message, language), ephemeral: true });
        return;
      }
      await interaction.reply({
        content: `${t("Event", "Event")} \`${id}\` ${t("entfernt", "removed")}.${removedDiscordEvent ? ` ${t("Discord-Server-Event ebenfalls entfernt.", "Discord server event was removed too.")}` : ""}`,
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content: t("Unbekannte /event Aktion.", "Unknown /event action."), ephemeral: true });
  }

  async handleLanguageCommand(interaction) {
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const { t, language } = this.createInteractionTranslator(interaction);
    const override = getGuildLanguage(guildId);
    const effectiveLanguage = this.resolveInteractionLanguage(interaction);
    const clientLanguage = resolveLanguageFromDiscordLocale(interaction.locale, language);
    const suggestOverride = !override && clientLanguage !== effectiveLanguage
      ? `\n${t(
        `Tipp: Mit \`/language set value:${clientLanguage}\` kannst du OmniFM fuer diesen Server fest auf \`${clientLanguage}\` stellen.`,
        `Tip: Use \`/language set value:${clientLanguage}\` to force OmniFM to \`${clientLanguage}\` for this server.`
      )}`
      : "";

    if (sub === "show") {
      await interaction.reply({
        content:
          `**${t("OmniFM Sprache", "OmniFM language")}**\n` +
          `${t("Aktiv", "Active")}: \`${effectiveLanguage}\`\n` +
          `${t("Quelle", "Source")}: ${override ? t("Manuell gesetzt", "Manually set") : t("Discord Server-Sprache", "Discord server locale")}\n` +
          `${t("Deine Discord-Client-Sprache", "Your Discord client language")}: \`${clientLanguage}\`` +
          suggestOverride,
        ephemeral: true,
      });
      return;
    }

    if (!this.hasGuildManagePermissions(interaction)) {
      await interaction.reply({
        content: t(
          "Du brauchst die Berechtigung `Server verwalten` fuer `/language set` und `/language reset`.",
          "You need the `Manage Server` permission for `/language set` and `/language reset`."
        ),
        ephemeral: true,
      });
      return;
    }

    if (sub === "set") {
      const value = normalizeLanguage(interaction.options.getString("value", true), getDefaultLanguage());
      setGuildLanguage(guildId, value);
      await interaction.reply({
        content: t(
          `Sprache fuer diesen Server wurde auf \`${value}\` gesetzt.`,
          `Language for this server was set to \`${value}\`.`
        ),
        ephemeral: true,
      });
      return;
    }

    if (sub === "reset") {
      const changed = resetGuildLanguage(guildId);
      const next = this.resolveInteractionLanguage(interaction);
      await interaction.reply({
        content: changed
          ? t(
            `Manuelle Sprache entfernt. OmniFM nutzt jetzt wieder die Discord-Server-Sprache (\`${next}\`).`,
            `Manual language override removed. OmniFM now uses the Discord server locale again (\`${next}\`).`
          )
          : t(
            `Es war keine manuelle Sprache gesetzt. Aktive Sprache bleibt \`${next}\`.`,
            `No manual language override was set. Active language remains \`${next}\`.`
          ),
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content: t("Unbekannte /language Aktion.", "Unknown /language action."), ephemeral: true });
  }

  async respondInteraction(interaction, payload) {
    if (interaction.deferred || interaction.replied) {
      const editPayload = { ...payload };
      delete editPayload.ephemeral;
      if (!editPayload.content && !editPayload.embeds) {
        const { t } = this.createInteractionTranslator(interaction);
        editPayload.content = t("Es ist ein Fehler aufgetreten.", "An error occurred.");
      }
      return interaction.editReply(editPayload);
    }
    return interaction.reply(payload);
  }

  async respondLongInteraction(interaction, content, { ephemeral = true } = {}) {
    const chunks = splitTextForDiscord(content, 1900);
    if (!chunks.length) {
      await this.respondInteraction(interaction, { content: "-", ephemeral });
      return;
    }

    await this.respondInteraction(interaction, { content: chunks[0], ephemeral });
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ content: chunks[i], ephemeral });
    }
  }

  async connectToVoice(interaction, targetChannel = null, { silent = false } = {}) {
    const { t } = this.createInteractionTranslator(interaction);
    const sendError = async (message) => {
      if (!silent) {
        await this.respondInteraction(interaction, { content: message, ephemeral: true });
      }
      return { connection: null, error: message };
    };

    const member = interaction.member;
    const channel = targetChannel || member?.voice?.channel;
    if (!channel) {
      return sendError(
        t(
          "Waehle einen Voice-Channel im Command oder trete selbst einem Voice-Channel bei.",
          "Select a voice channel in the command or join one yourself."
        )
      );
    }
    if (!channel.isVoiceBased()) {
      return sendError(t("Bitte waehle einen Voice- oder Stage-Channel.", "Please choose a voice or stage channel."));
    }
    if (channel.guildId !== interaction.guildId) {
      return sendError(t("Der ausgewaehlte Channel ist nicht in diesem Server.", "The selected channel is not in this server."));
    }

    const guild = interaction.guild;
    if (!guild) {
      return sendError(t("Guild konnte nicht ermittelt werden.", "Could not resolve guild."));
    }

    const me = await this.resolveBotMember(guild);
    if (!me) {
      return sendError(t("Bot-Mitglied im Server konnte nicht geladen werden.", "Could not load bot member in this server."));
    }

    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.Connect)) {
      return sendError(
        t(
          `Ich habe keine Berechtigung fuer ${channel.toString()} (Connect fehlt).`,
          `I don't have permission for ${channel.toString()} (Connect missing).`
        )
      );
    }
    if (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) {
      return sendError(
        t(
          `Ich habe keine Berechtigung fuer ${channel.toString()} (Speak fehlt).`,
          `I don't have permission for ${channel.toString()} (Speak missing).`
        )
      );
    }

    const guildId = interaction.guildId;
    const state = this.getState(guildId);
    state.lastChannelId = channel.id;

    if (state.connection) {
      const currentChannelId = state.connection.joinConfig?.channelId;
      if (currentChannelId === channel.id) {
        if (channel.type === ChannelType.GuildStageVoice) {
          await this.ensureStageChannelReady(guild, channel, { createInstance: true, ensureSpeaker: true });
        }
        return { connection: state.connection, error: null };
      }

      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      state.connection.destroy();
      state.connection = null;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      group: this.voiceGroup,
      selfDeaf: true
    });
    log("INFO", `[${this.config.name}] Join Voice: guild=${guild.id} channel=${channel.id} group=${this.voiceGroup}`);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      connection.destroy();
      return sendError(t("Konnte dem Voice-Channel nicht beitreten.", "Could not join the voice channel."));
    }

    connection.subscribe(state.player);
    state.connection = connection;
    state.reconnectAttempts = 0;
    state.lastReconnectAt = new Date().toISOString();
    this.clearReconnectTimer(state);
    networkRecoveryCoordinator.noteSuccess(`${this.config.name} voice-ready guild=${guildId}`);

    this.attachConnectionHandlers(guildId, connection);
    if (channel.type === ChannelType.GuildStageVoice) {
      await this.ensureStageChannelReady(guild, channel, { createInstance: true, ensureSpeaker: true });
    }
    return { connection, error: null };
  }

  async tryReconnect(guildId) {
    const state = this.getState(guildId);
    if (!state.shouldReconnect || !state.lastChannelId) return;

    const networkCooldownMs = networkRecoveryCoordinator.getRecoveryDelayMs();
    if (networkCooldownMs > 0) {
      log(
        "INFO",
        `[${this.config.name}] Reconnect fuer guild=${guildId} verschoben (Netz-Cooldown ${Math.round(networkCooldownMs)}ms)`
      );
      return;
    }

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return;

    const channel = await guild.channels.fetch(state.lastChannelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) return;

    if (state.connection) {
      try { state.connection.destroy(); } catch {}
      state.connection = null;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      group: this.voiceGroup,
      selfDeaf: true
    });
    log("INFO", `[${this.config.name}] Rejoin Voice: guild=${guild.id} channel=${channel.id} group=${this.voiceGroup}`);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      networkRecoveryCoordinator.noteFailure(`${this.config.name} reconnect-timeout`, `guild=${guildId}`);
      try { connection.destroy(); } catch {}
      return;
    }

    connection.subscribe(state.player);
    state.connection = connection;
    state.reconnectAttempts = 0;
    state.lastReconnectAt = new Date().toISOString();
    this.clearReconnectTimer(state);
    this.attachConnectionHandlers(guildId, connection);
    networkRecoveryCoordinator.noteSuccess(`${this.config.name} rejoin-ready guild=${guildId}`);
    if (channel.type === ChannelType.GuildStageVoice) {
      await this.ensureStageChannelReady(guild, channel, { createInstance: true, ensureSpeaker: true });
    }

    // Always restart station on reconnect (stream is stale after disconnect)
    if (state.currentStationKey) {
      try {
        await this.restartCurrentStation(state, guildId);
        log("INFO", `[${this.config.name}] Reconnect successful: guild=${guildId}`);
      } catch (err) {
        log("ERROR", `[${this.config.name}] Station restart after reconnect failed: ${err?.message || err}`);
      }
    }
  }

  handleNetworkRecovered() {
    for (const [guildId, state] of this.guildState.entries()) {
      if (!state.shouldReconnect || !state.currentStationKey || !state.lastChannelId) continue;

      if (!state.connection) {
        if (state.reconnectTimer) {
          clearTimeout(state.reconnectTimer);
          state.reconnectTimer = null;
        }
        this.scheduleReconnect(guildId, { resetAttempts: true, reason: "network-recovered" });
        continue;
      }

      if (state.player.state.status === AudioPlayerStatus.Idle && !state.streamRestartTimer) {
        this.scheduleStreamRestart(guildId, state, 750, "network-recovered");
      }
    }
  }

  scheduleReconnect(guildId, options = {}) {
    const state = this.getState(guildId);
    if (!state.shouldReconnect || !state.lastChannelId) return;
    if (options.resetAttempts) {
      state.reconnectAttempts = 0;
    }
    if (state.reconnectTimer) return;

    const attempt = state.reconnectAttempts + 1;
    state.reconnectAttempts = attempt;

    const tierConfig = getTierConfig(guildId);
    const baseDelay = Math.max(400, tierConfig.reconnectMs || 5_000);
    const exp = Math.min(attempt - 1, VOICE_RECONNECT_EXP_STEPS);
    let delay = Math.min(VOICE_RECONNECT_MAX_MS, baseDelay * Math.pow(1.8, exp));

    const networkCooldownMs = networkRecoveryCoordinator.getRecoveryDelayMs();
    if (networkCooldownMs > 0) {
      delay = Math.max(delay, networkCooldownMs);
    }

    delay = applyJitter(delay, 0.2);
    const reason = String(options.reason || "auto");

    log(
      "INFO",
      `[${this.config.name}] Reconnecting guild=${guildId} in ${Math.round(delay)}ms (attempt ${attempt}, plan=${tierConfig.tier}, reason=${reason})`
    );
    state.reconnectTimer = setTimeout(async () => {
      state.reconnectTimer = null;
      if (!state.shouldReconnect) return;

      await this.tryReconnect(guildId);
      if (state.shouldReconnect && !state.connection) {
        this.scheduleReconnect(guildId, { reason: "retry" });
      }
    }, delay);

    state.reconnectCount += 1;
    state.lastReconnectAt = new Date().toISOString();
  }

  getGuildAccess(guildId) {
    const tierConfig = getTierConfig(guildId);
    const guildTier = tierConfig.tier || "free";
    const requiredTier = this.config.requiredTier || "free";
    const tierAllowed = (TIER_RANK[guildTier] ?? 0) >= (TIER_RANK[requiredTier] ?? 0);
    const botIndex = Number(this.config.index || 1);
    const maxBots = Number(tierConfig.maxBots || 0);
    const withinBotLimit = botIndex <= maxBots;

    return {
      allowed: tierAllowed && withinBotLimit,
      guildTier,
      requiredTier,
      tierAllowed,
      botIndex,
      maxBots,
      withinBotLimit,
    };
  }

  async replyAccessDenied(interaction, access) {
    const { t } = this.createInteractionTranslator(interaction);
    if (!access.tierAllowed) {
      await interaction.reply({
        content:
          t(
            `Dieser Bot erfordert **${access.requiredTier.toUpperCase()}**.\n` +
              `Dein Server hat aktuell **${access.guildTier.toUpperCase()}**.\n` +
              `Upgrade: ${BRAND.upgradeUrl || "https://discord.gg/UeRkfGS43R"}`,
            `This bot requires **${access.requiredTier.toUpperCase()}**.\n` +
              `Your server currently has **${access.guildTier.toUpperCase()}**.\n` +
              `Upgrade: ${BRAND.upgradeUrl || "https://discord.gg/UeRkfGS43R"}`
          ),
        ephemeral: true
      });
      return;
    }

    await interaction.reply(
      botLimitEmbed(access.guildTier, access.maxBots, access.botIndex, this.resolveInteractionLanguage(interaction))
    );
  }

  async handleAutocomplete(interaction) {
    try {
      if (interaction.guildId) {
        const access = this.getGuildAccess(interaction.guildId);
        if (!access.allowed) {
          await interaction.respond([]);
          return;
        }
      }

      const commandPermission = this.checkCommandRolePermission(interaction, interaction.commandName);
      if (!commandPermission.ok) {
        await interaction.respond([]);
        return;
      }
      if (interaction.commandName === "event") {
        const feature = requireFeature(interaction.guildId, "scheduledEvents");
        if (!feature.ok) {
          await interaction.respond([]);
          return;
        }
      }

      const focused = interaction.options.getFocused(true);

      if (focused.name === "station") {
        const stations = loadStations();
        const guildId = interaction.guildId;
        const guildTier = getTier(guildId);
        const query = String(focused.value || "").toLowerCase().trim();

        // Standard-Stationen nach Tier gefiltert
        const available = filterStationsByTier(stations.stations, guildTier);
        const allStations = Object.entries(available)
          .map(([key, value]) => {
            const badge = value.tier && value.tier !== "free" ? ` [${value.tier.toUpperCase()}]` : "";
            return { key, name: value.name, display: `${value.name}${badge}` };
          });

        // Custom Stationen (Ultimate)
        if (guildTier === "ultimate") {
          const custom = getGuildStations(guildId);
          for (const [key, station] of Object.entries(custom)) {
            allStations.push({ key, name: station.name, display: `${station.name} [CUSTOM]` });
          }
        }

        const items = (query
          ? allStations.filter((item) =>
              item.key.toLowerCase().includes(query) ||
              item.name.toLowerCase().includes(query)
            )
          : allStations
        )
          .slice(0, 25)
          .map((item) => ({ name: clipText(`${item.display} (${item.key})`, 100), value: item.key }));

        await interaction.respond(items);
        return;
      }

      // Autocomplete fuer /removestation key
      if (focused.name === "key" && interaction.commandName === "removestation") {
        const guildId = interaction.guildId;
        const custom = getGuildStations(guildId);
        const query = String(focused.value || "").toLowerCase().trim();
        const items = Object.entries(custom)
          .filter(([k, v]) => !query || k.includes(query) || v.name.toLowerCase().includes(query))
          .slice(0, 25)
          .map(([k, v]) => ({ name: `${v.name} (${k})`, value: k }));
        await interaction.respond(items);
        return;
      }

      if (focused.name === "channel") {
        if (!interaction.guild) {
          await interaction.respond([]);
          return;
        }

        const query = String(focused.value || "").trim().toLowerCase();

        // Fetch channels fresh to ensure we have the latest list
        try {
          await interaction.guild.channels.fetch();
        } catch {
          // Fallback to cached channels
        }

        const channels = await this.listVoiceChannels(interaction.guild);
        const items = channels
          .filter((channel) => {
            if (!query) return true;
            if (channel.id.includes(query)) return true;
            return channel.name.toLowerCase().includes(query);
          })
          .slice(0, 25)
          .map((channel) => {
            const prefix = channel.type === ChannelType.GuildStageVoice ? "Stage" : "Voice";
            const count = Number(channel.members?.size || 0);
            return {
              name: clipText(`${prefix}: ${channel.name} (${count})`, 100),
              value: channel.id
            };
          });

        log("INFO", `[${this.config.name}] Autocomplete channel: query="${query}" results=${items.length}/${channels.length}`);
        await interaction.respond(items);
        return;
      }

      if (focused.name === "timezone" && interaction.commandName === "event") {
        const query = String(focused.value || "").trim().toLowerCase();
        const dedup = new Map();
        for (const entry of EVENT_TIME_ZONE_SUGGESTIONS) {
          if (!entry?.value) continue;
          dedup.set(entry.value, entry.label || entry.value);
        }
        dedup.set(EVENT_FALLBACK_TIME_ZONE, EVENT_FALLBACK_TIME_ZONE);

        const items = [...dedup.entries()]
          .filter(([value, label]) => {
            if (!query) return true;
            return value.toLowerCase().includes(query) || String(label || "").toLowerCase().includes(query);
          })
          .slice(0, 25)
          .map(([value, label]) => ({
            name: clipText(String(label || value), 100),
            value,
          }));

        await interaction.respond(items);
        return;
      }

      if (focused.name === "id" && interaction.commandName === "event") {
        const guildId = interaction.guildId;
        const query = String(focused.value || "").toLowerCase().trim();
        const events = listScheduledEvents({
          guildId,
          botId: this.config.id,
          includeDisabled: false,
        });
        const language = this.resolveInteractionLanguage(interaction);

        const items = events
          .filter((event) =>
            !query
            || event.id.includes(query)
            || String(event.name || "").toLowerCase().includes(query)
            || String(event.stationKey || "").toLowerCase().includes(query)
          )
          .slice(0, 25)
          .map((event) => ({
            name: clipText(`${event.name} | ${formatDateTime(event.runAtMs, language, event.timeZone)} | ${event.id}`, 100),
            value: event.id,
          }));

        await interaction.respond(items);
        return;
      }

      // Unknown option
      await interaction.respond([]);
    } catch (err) {
      log("ERROR", `[${this.config.name}] Autocomplete error: ${err?.message || err}`);
      try {
        await interaction.respond([]);
      } catch {
        // interaction might have already been responded to
      }
    }
  }

  async handleInteraction(interaction) {
    if (interaction.isAutocomplete()) {
      await this.handleAutocomplete(interaction);
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (!interaction.guildId) {
      const isDe = resolveLanguageFromDiscordLocale(interaction?.locale, getDefaultLanguage()) === "de";
      await interaction.reply({
        content: isDe ? "Dieser Bot funktioniert nur auf Servern." : "This bot only works in servers.",
        ephemeral: true,
      });
      return;
    }

    const { t, language } = this.createInteractionTranslator(interaction);
    const unrestrictedCommands = new Set(["help", "premium", "license", "language"]);
    if (!unrestrictedCommands.has(interaction.commandName)) {
      const access = this.getGuildAccess(interaction.guildId);
      if (!access.allowed) {
        await this.replyAccessDenied(interaction, access);
        return;
      }
    }

    if (interaction.commandName === "help") {
      await this.respondLongInteraction(interaction, this.buildHelpMessage(interaction), { ephemeral: true });
      return;
    }

    if (interaction.commandName === "language") {
      await this.handleLanguageCommand(interaction);
      return;
    }

    if (interaction.commandName === "perm") {
      await this.handlePermissionCommand(interaction);
      return;
    }

    const commandPermission = this.checkCommandRolePermission(interaction, interaction.commandName);
    if (!commandPermission.ok) {
      await interaction.reply({ content: commandPermission.message, ephemeral: true });
      return;
    }

    if (interaction.commandName === "event") {
      await this.handleEventCommand(interaction);
      return;
    }

    // ---- Commander-only commands ----
    if (interaction.commandName === "invite") {
      if (this.role !== "commander" || !this.workerManager) {
        await interaction.reply({ content: t("Dieser Befehl ist nur fuer den Commander-Bot.", "This command is only for the commander bot."), ephemeral: true });
        return;
      }
      const workerIndex = interaction.options.getInteger("worker", true);
      const guildTier = getTier(interaction.guildId);
      const maxIndex = this.workerManager.getMaxWorkerIndex(guildTier);

      if (workerIndex < 1 || workerIndex > 16) {
        await interaction.reply({ content: t("Worker-Nummer muss zwischen 1 und 16 sein.", "Worker number must be between 1 and 16."), ephemeral: true });
        return;
      }
      if (workerIndex > maxIndex) {
        const tierNames = { 2: "Free", 8: "Pro", 16: "Ultimate" };
        const neededTier = workerIndex <= 2 ? "Free" : workerIndex <= 8 ? "Pro" : "Ultimate";
        await interaction.reply({
          content: t(
            `Worker ${workerIndex} erfordert mindestens **${neededTier}**. Dein Plan erlaubt Worker 1-${maxIndex}.`,
            `Worker ${workerIndex} requires at least **${neededTier}**. Your plan allows workers 1-${maxIndex}.`
          ),
          ephemeral: true,
        });
        return;
      }

      const worker = this.workerManager.getWorkerByIndex(workerIndex);
      if (!worker) {
        await interaction.reply({ content: t(`Worker ${workerIndex} ist nicht konfiguriert.`, `Worker ${workerIndex} is not configured.`), ephemeral: true });
        return;
      }

      const clientId = worker.getApplicationId() || worker.config.clientId;
      const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=36700160&integration_type=0&scope=bot`;
      const alreadyInvited = worker.client?.isReady() && worker.client.guilds.cache.has(interaction.guildId);

      if (alreadyInvited) {
        await interaction.reply({
          content: t(
            `**${worker.config.name}** ist bereits auf diesem Server!`,
            `**${worker.config.name}** is already on this server!`
          ),
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: t(
            `Lade **${worker.config.name}** ein:\n${inviteUrl}`,
            `Invite **${worker.config.name}**:\n${inviteUrl}`
          ),
          ephemeral: true,
        });
      }
      return;
    }

    if (interaction.commandName === "workers") {
      if (this.role !== "commander" || !this.workerManager) {
        await interaction.reply({ content: t("Dieser Befehl ist nur fuer den Commander-Bot.", "This command is only for the commander bot."), ephemeral: true });
        return;
      }

      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);
      const maxIndex = this.workerManager.getMaxWorkerIndex(guildTier);
      const statuses = this.workerManager.getAllStatuses();
      const lines = [`**Worker-Status** (${guildTier.toUpperCase()}, max ${maxIndex} Worker):\n`];

      for (const ws of statuses) {
        const inGuild = ws.online && this.workerManager.getWorkerByIndex(ws.index)?.client?.guilds.cache.has(guildId);
        const streaming = ws.streams.find(s => s.guildId === guildId);
        const tierLocked = ws.index > maxIndex;

        let statusEmoji = "";
        let statusText = "";
        if (tierLocked) {
          statusEmoji = "---";
          statusText = t("(Upgrade erforderlich)", "(Upgrade required)");
        } else if (!ws.online) {
          statusEmoji = "---";
          statusText = t("Offline", "Offline");
        } else if (!inGuild) {
          statusEmoji = "---";
          statusText = t("Nicht eingeladen", "Not invited");
        } else if (streaming) {
          statusEmoji = ">>>";
          statusText = `${t("Spielt", "Playing")}: ${streaming.stationName || streaming.stationKey || "-"}`;
        } else {
          statusEmoji = "...";
          statusText = t("Bereit", "Ready");
        }

        lines.push(`\`${statusEmoji}\` **${ws.name}** - ${statusText} (${ws.totalGuilds} Server, ${ws.activeStreams} aktiv)`);
      }

      await this.respondLongInteraction(interaction, lines.join("\n"), { ephemeral: true });
      return;
    }

    const stations = loadStations();
    const state = this.getState(interaction.guildId);

    if (interaction.commandName === "stations") {
      const guildTier = getTier(interaction.guildId);
      const available = filterStationsByTier(stations.stations, guildTier);
      const tierLabel = guildTier !== "free" ? ` [${guildTier.toUpperCase()}]` : "";
      const list = Object.entries(available).map(([k, v]) => {
        const badge = v.tier && v.tier !== "free" ? ` [${v.tier.toUpperCase()}]` : "";
        return `\`${k}\` - ${v.name}${badge}`;
      }).join("\n");
      const custom = guildTier === "ultimate" ? getGuildStations(interaction.guildId) : {};
      const customList = Object.entries(custom).map(([k, v]) => `\`${k}\` - ${v.name} [CUSTOM]`).join("\n");
      let content = `**${t("Verfuegbare Stationen", "Available stations")}${tierLabel} (${Object.keys(available).length}):**\n${list}`;
      if (customList) content += `\n\n**${t("Custom Stationen", "Custom stations")} (${Object.keys(custom).length}):**\n${customList}`;
      await this.respondLongInteraction(interaction, content, { ephemeral: true });
      return;
    }

    if (interaction.commandName === "list") {
      const guildTier = getTier(interaction.guildId);
      const available = filterStationsByTier(stations.stations, guildTier);
      const keys = Object.keys(available);
      const page = Math.max(1, interaction.options.getInteger("page") || 1);
      const perPage = 10;
      const start = (page - 1) * perPage;
      const end = start + perPage;
      const pageKeys = keys.slice(start, end);
      const totalPages = Math.ceil(keys.length / perPage);
      if (pageKeys.length === 0) {
        await interaction.reply({
          content: t(
            `Seite ${page} hat keine Eintraege (${totalPages} Seiten).`,
            `Page ${page} has no entries (${totalPages} pages).`
          ),
          ephemeral: true,
        });
        return;
      }
      const list = pageKeys.map(k => {
        const badge = available[k].tier !== "free" ? ` [${available[k].tier.toUpperCase()}]` : "";
        return `\`${k}\` - ${available[k].name}${badge}`;
      }).join("\n");
      await this.respondLongInteraction(
        interaction,
        `**${t("Stationen", "Stations")} (${t("Seite", "Page")} ${page}/${totalPages}):**\n${list}`,
        { ephemeral: true }
      );
      return;
    }

    if (interaction.commandName === "now") {
      const playingGuilds = this.getPlayingGuildCount();
      if (!state.currentStationKey) {
        await interaction.reply({
          content: t(
            `Hier laeuft gerade nichts.\nDieser Bot streamt aktuell auf ${playingGuilds} Server${playingGuilds === 1 ? "" : "n"}.`,
            `Nothing is playing here right now.\nThis bot is currently streaming in ${playingGuilds} server${playingGuilds === 1 ? "" : "s"}.`
          ),
          ephemeral: true
        });
        return;
      }

      const current = stations.stations[state.currentStationKey];
      if (!current) {
        await interaction.reply({ content: t("Aktuelle Station wurde entfernt.", "Current station was removed."), ephemeral: true });
        return;
      }

      const channelId = state.connection?.joinConfig?.channelId || state.lastChannelId || null;
      const lines = [
        `${t("Jetzt auf diesem Server", "Now playing in this server")}: ${current.name}`,
        `${t("Channel", "Channel")}: ${channelId ? `<#${channelId}>` : t("unbekannt", "unknown")}`,
        `${t("Aktiv auf", "Active in")} ${playingGuilds} ${t(`Server${playingGuilds === 1 ? "" : "n"}.`, `server${playingGuilds === 1 ? "" : "s"}.`)}`,
      ];

      const meta = state.currentMeta;
      if (meta?.displayTitle || meta?.streamTitle) {
        lines.push(`${t("Jetzt laeuft", "Now Playing")}: ${clipText(meta.displayTitle || meta.streamTitle, 160)}`);
      }
      if (meta?.artist && meta?.title) {
        lines.push(`${t("Titel", "Track")}: ${clipText(meta.artist, 90)} - ${clipText(meta.title, 90)}`);
      }
      if (meta?.artworkUrl) {
        lines.push(`${t("Cover", "Cover")}: ${meta.artworkUrl}`);
      }
      if (meta && (meta.name || meta.description)) {
        const metaName = clipText(meta.name || "-", 120);
        const metaDesc = clipText(meta.description || "", 240);
        lines.push(`${t("Meta", "Meta")}: ${metaName}${metaDesc ? ` | ${metaDesc}` : ""}`);
      }

      await this.respondLongInteraction(interaction, lines.join("\n"), { ephemeral: true });
      return;
    }

    if (interaction.commandName === "history") {
      if (!SONG_HISTORY_ENABLED) {
        await interaction.reply({
          content: t(
            "Song-History ist aktuell deaktiviert (`SONG_HISTORY_ENABLED=0`).",
            "Song history is currently disabled (`SONG_HISTORY_ENABLED=0`)."
          ),
          ephemeral: true
        });
        return;
      }

      const requestedLimit = interaction.options.getInteger("limit") || 10;
      const limit = Math.max(1, Math.min(20, requestedLimit));
      const history = getSongHistory(interaction.guildId, { limit });

      if (!history.length) {
        await interaction.reply({
          content: t(
            "Noch keine Song-History verfuegbar. Starte zuerst eine Station mit `/play`.",
            "No song history yet. Start a station with `/play` first."
          ),
          ephemeral: true
        });
        return;
      }

      const lines = history.map((entry, index) => {
        const unix = Number.isFinite(entry.timestampMs) ? Math.floor(entry.timestampMs / 1000) : null;
        const when = unix ? `<t:${unix}:R>` : "-";
        const title = clipText(entry.displayTitle || entry.streamTitle || "-", 150);
        const station = entry.stationName ? clipText(entry.stationName, 80) : null;
        const stationSuffix = station ? ` | ${station}` : "";
        return `${index + 1}. ${when} - **${title}**${stationSuffix}`;
      });

      await this.respondLongInteraction(
        interaction,
        `**${t("Song-History", "Song history")} (${t("letzte", "latest")} ${history.length}):**\n${lines.join("\n")}`,
        { ephemeral: true }
      );
      return;
    }

    if (interaction.commandName === "pause") {
      const requestedBot = interaction.options.getInteger("bot");
      if (this.role === "commander" && this.workerManager) {
        const workers = requestedBot
          ? [this.workerManager.getWorkerByIndex(requestedBot)].filter(Boolean)
          : this.workerManager.getStreamingWorkers(interaction.guildId);
        if (workers.length === 0) {
          await interaction.reply({ content: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."), ephemeral: true });
          return;
        }
        for (const w of workers) w.pauseInGuild(interaction.guildId);
        await interaction.reply({ content: t("Pausiert.", "Paused."), ephemeral: true });
        return;
      }
      if (!state.currentStationKey) {
        await interaction.reply({ content: t("Es laeuft nichts.", "Nothing is playing."), ephemeral: true });
        return;
      }
      state.player.pause(true);
      await interaction.reply({ content: t("Pausiert.", "Paused."), ephemeral: true });
      return;
    }

    if (interaction.commandName === "resume") {
      const requestedBot = interaction.options.getInteger("bot");
      if (this.role === "commander" && this.workerManager) {
        const workers = requestedBot
          ? [this.workerManager.getWorkerByIndex(requestedBot)].filter(Boolean)
          : this.workerManager.getStreamingWorkers(interaction.guildId);
        if (workers.length === 0) {
          await interaction.reply({ content: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."), ephemeral: true });
          return;
        }
        for (const w of workers) w.resumeInGuild(interaction.guildId);
        await interaction.reply({ content: t("Weiter gehts.", "Resumed."), ephemeral: true });
        return;
      }
      if (!state.currentStationKey) {
        await interaction.reply({ content: t("Es laeuft nichts.", "Nothing is playing."), ephemeral: true });
        return;
      }
      state.player.unpause();
      await interaction.reply({ content: t("Weiter gehts.", "Resumed."), ephemeral: true });
      return;
    }

    if (interaction.commandName === "stop") {
      const requestedBot = interaction.options.getInteger("bot");
      if (this.role === "commander" && this.workerManager) {
        const workers = requestedBot
          ? [this.workerManager.getWorkerByIndex(requestedBot)].filter(Boolean)
          : this.workerManager.getStreamingWorkers(interaction.guildId);
        if (workers.length === 0) {
          await interaction.reply({ content: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."), ephemeral: true });
          return;
        }
        for (const w of workers) w.stopInGuild(interaction.guildId);
        await interaction.reply({ content: t("Gestoppt und Channel verlassen.", "Stopped and left the channel."), ephemeral: true });
        return;
      }
      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      state.player.stop();
      this.clearCurrentProcess(state);

      if (state.connection) {
        state.connection.destroy();
        state.connection = null;
      }

      state.currentStationKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.nowPlayingSignature = null;
      state.reconnectAttempts = 0;
      state.streamErrorCount = 0;
      this.updatePresence();

      await interaction.reply({ content: t("Gestoppt und Channel verlassen.", "Stopped and left the channel."), ephemeral: true });
      return;
    }

    if (interaction.commandName === "setvolume") {
      const value = interaction.options.getInteger("value", true);
      if (value < 0 || value > 100) {
        await interaction.reply({ content: t("Wert muss zwischen 0 und 100 liegen.", "Value must be between 0 and 100."), ephemeral: true });
        return;
      }
      if (this.role === "commander" && this.workerManager) {
        const workers = this.workerManager.getStreamingWorkers(interaction.guildId);
        if (workers.length === 0) {
          await interaction.reply({ content: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."), ephemeral: true });
          return;
        }
        for (const w of workers) w.setVolumeInGuild(interaction.guildId, value);
        await interaction.reply({ content: t(`Lautstaerke gesetzt: ${value}`, `Volume set to: ${value}`), ephemeral: true });
        return;
      }
      state.volume = value;
      const resource = state.player.state.resource;
      if (resource?.volume) {
        resource.volume.setVolume(clampVolume(value));
      }
      await interaction.reply({ content: t(`Lautstaerke gesetzt: ${value}`, `Volume set to: ${value}`), ephemeral: true });
      return;
    }

    if (interaction.commandName === "premium") {
      const gid = interaction.guildId;
      const tierConfig = getTierConfig(gid);
      const license = getLicense(gid);

      const tierEmoji = { free: "", pro: " [PRO]", ultimate: " [ULTIMATE]" };
      const lines = [
        `**${BRAND.name}** ${t("Premium Status", "Premium status")}${tierEmoji[tierConfig.tier] || ""}`,
        `Server: ${interaction.guild?.name || gid}`,
        `${t("Server-ID", "Server ID")}: ${gid}`,
        `Plan: ${tierConfig.name}`,
        `Audio: ${tierConfig.bitrate} Opus`,
        `Reconnect: ${tierConfig.reconnectMs}ms`,
        `${t("Max Bots", "Max bots")}: ${tierConfig.maxBots}`,
      ];
      if (license && !license.expired) {
        const expDate = new Date(license.expiresAt).toLocaleDateString(t("de-DE", "en-US"));
        lines.push(
          t(
            `Laeuft ab: ${expDate} (${license.remainingDays} Tage uebrig)`,
            `Expires: ${expDate} (${license.remainingDays} day${license.remainingDays === 1 ? "" : "s"} left)`
          )
        );
      } else if (license && license.expired) {
        lines.push(t("Status: ABGELAUFEN", "Status: EXPIRED"));
      }
      if (tierConfig.tier === "free") {
        lines.push("", t(`Upgrade auf ${BRAND.name} Pro/Ultimate fuer hoehere Qualitaet!`, `Upgrade to ${BRAND.name} Pro/Ultimate for higher quality!`));
        lines.push(t("Infos & Support: https://discord.gg/UeRkfGS43R", "Info & support: https://discord.gg/UeRkfGS43R"));
      } else {
        lines.push("", "Support: https://discord.gg/UeRkfGS43R");
      }
      await interaction.reply({ content: lines.join("\n"), ephemeral: true });
      return;
    }

    if (interaction.commandName === "health") {
      const networkHoldMs = networkRecoveryCoordinator.getRecoveryDelayMs();
      const content = [
        `Bot: ${this.config.name}`,
        `Ready: ${this.client.isReady() ? t("ja", "yes") : t("nein", "no")}`,
        `${t("Letzter Stream-Fehler", "Last stream error")}: ${state.lastStreamErrorAt || "-"}`,
        `${t("Stream-Fehler (Reihe)", "Stream errors (streak)")}: ${state.streamErrorCount || 0}`,
        `${t("Letzter ffmpeg Exit-Code", "Last ffmpeg exit code")}: ${state.lastProcessExitCode ?? "-"}`,
        `Reconnects: ${state.reconnectCount}`,
        `${t("Letzter Reconnect", "Last reconnect")}: ${state.lastReconnectAt || "-"}`,
        `${t("Auto-Reconnect aktiv", "Auto reconnect enabled")}: ${state.shouldReconnect ? t("ja", "yes") : t("nein", "no")}`,
        `${t("Netz-Cooldown", "Network cooldown")}: ${networkHoldMs > 0 ? `${t("ja", "yes")} (${Math.round(networkHoldMs)}ms)` : t("nein", "no")}`
      ].join("\n");

      await interaction.reply({ content, ephemeral: true });
      return;
    }

    if (interaction.commandName === "diag") {
      const connected = state.connection ? t("ja", "yes") : t("nein", "no");
      const channelId = state.connection?.joinConfig?.channelId || state.lastChannelId || "-";
      const station = state.currentStationKey || "-";
      const diag = this.getStreamDiagnostics(interaction.guildId, state);
      const restartPending = state.streamRestartTimer ? t("ja", "yes") : t("nein", "no");
      const reconnectPending = state.reconnectTimer ? t("ja", "yes") : t("nein", "no");
      const networkHoldMs = networkRecoveryCoordinator.getRecoveryDelayMs();

      const content = [
        `Bot: ${this.config.name}`,
        `Server: ${interaction.guild?.name || interaction.guildId}`,
        `Plan: ${diag.tier.toUpperCase()} | preset=${diag.preset} | transcode=${diag.transcodeEnabled ? "on" : "off"} (${diag.transcodeMode})`,
        `Bitrate Ziel: ${diag.bitrateOverride || "-"} (${diag.requestedBitrateKbps}k) | Profil: ${diag.profile}`,
        `FFmpeg Buffer: queue=${diag.queue} probe=${diag.probeSize} analyzeUs=${diag.analyzeUs}`,
        `Verbunden: ${connected} | Channel: ${channelId} | Station: ${station}`,
        `Stream-Laufzeit: ${diag.streamLifetimeSec}s | Errors in Reihe: ${state.streamErrorCount || 0}`,
        `Restart geplant: ${restartPending} | Reconnect geplant: ${reconnectPending}`,
        `Netz-Cooldown: ${networkHoldMs > 0 ? `${Math.round(networkHoldMs)}ms` : "0ms"}`,
      ].join("\n");

      await interaction.reply({ content, ephemeral: true });
      return;
    }

    if (interaction.commandName === "status") {
      const connected = state.connection ? t("ja", "yes") : t("nein", "no");
      const channelId = state.connection?.joinConfig?.channelId || state.lastChannelId || "-";
      const uptimeSec = Math.floor((Date.now() - this.startedAt) / 1000);
      const load = os.loadavg().map((v) => v.toFixed(2)).join(", ");
      const mem = `${Math.round(process.memoryUsage().rss / (1024 * 1024))}MB`;
      const station = state.currentStationKey || "-";

      const content = [
        `Bot: ${this.config.name}`,
        `${t("Guilds (dieser Bot)", "Guilds (this bot)")}: ${this.client.guilds.cache.size}`,
        `${t("Verbunden", "Connected")}: ${connected}`,
        `Channel: ${channelId}`,
        `Station: ${station}`,
        `Uptime: ${uptimeSec}s`,
        `Load: ${load}`,
        `RAM: ${mem}`
      ].join("\n");

      await interaction.reply({ content, ephemeral: true });
      return;
    }

    if (interaction.commandName === "addstation") {
      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);
      if (guildTier !== "ultimate") {
        await interaction.reply(customStationEmbed(language));
        return;
      }
      const key = interaction.options.getString("key");
      const name = interaction.options.getString("name");
      const url = interaction.options.getString("url");
      const result = addGuildStation(guildId, key, name, url);
      if (result.error) {
        await interaction.reply({ content: translateCustomStationErrorMessage(result.error, language), ephemeral: true });
      } else {
        const count = countGuildStations(guildId);
        await interaction.reply({
          content: t(
            `Custom Station hinzugefuegt: **${result.station.name}** (Key: \`${result.key}\`)\n${count}/${MAX_STATIONS_PER_GUILD} Slots belegt.`,
            `Custom station added: **${result.station.name}** (Key: \`${result.key}\`)\n${count}/${MAX_STATIONS_PER_GUILD} slots used.`
          ),
          ephemeral: true,
        });
      }
      return;
    }

    if (interaction.commandName === "removestation") {
      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);
      if (guildTier !== "ultimate") {
        await interaction.reply(customStationEmbed(language));
        return;
      }
      const key = interaction.options.getString("key");
      if (removeGuildStation(guildId, key)) {
        await interaction.reply({ content: t(`Station \`${key}\` entfernt.`, `Station \`${key}\` removed.`), ephemeral: true });
      } else {
        await interaction.reply({ content: t(`Station \`${key}\` nicht gefunden.`, `Station \`${key}\` was not found.`), ephemeral: true });
      }
      return;
    }

    if (interaction.commandName === "mystations") {
      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);
      if (guildTier !== "ultimate") {
        await interaction.reply(customStationEmbed(language));
        return;
      }
      const custom = getGuildStations(guildId);
      const keys = Object.keys(custom);
      if (keys.length === 0) {
        await interaction.reply({ content: t("Keine Custom Stationen. Nutze `/addstation` um eine hinzuzufuegen.", "No custom stations. Use `/addstation` to add one."), ephemeral: true });
      } else {
        const list = keys.map(k => `\`${k}\` - ${custom[k].name}`).join("\n");
        await this.respondLongInteraction(
          interaction,
          `**${t("Custom Stationen", "Custom stations")} (${keys.length}/${MAX_STATIONS_PER_GUILD}):**\n${list}`,
          { ephemeral: true }
        );
      }
      return;
    }

    // === /license Command ===
    if (interaction.commandName === "license") {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guildId;
      const requiresManagePermission = sub === "activate" || sub === "remove";
      if (requiresManagePermission && !this.hasGuildManagePermissions(interaction)) {
        await interaction.reply({
          content: t(
            "Du brauchst die Berechtigung `Server verwalten` um Lizenz-Aktionen auszufuehren.",
            "You need the `Manage Server` permission to execute license actions."
          ),
          ephemeral: true
        });
        return;
      }

      if (sub === "activate") {
        const rawKey = interaction.options.getString("key").trim();
        const keyCandidates = [...new Set([rawKey, rawKey.toLowerCase(), rawKey.toUpperCase()])];
        let lic = null;
        let resolvedKey = null;
        for (const candidate of keyCandidates) {
          lic = getLicenseById(candidate);
          if (lic) {
            resolvedKey = lic.id || candidate;
            break;
          }
        }

        if (!lic) {
          await interaction.reply({ content: t("Lizenz-Key nicht gefunden. Bitte pruefe den Key und versuche es erneut.", "License key not found. Please verify it and try again."), ephemeral: true });
          return;
        }
        if (lic.expired) {
          await interaction.reply({ content: t("Diese Lizenz ist abgelaufen. Bitte erneuere dein Abo.", "This license has expired. Please renew your subscription."), ephemeral: true });
          return;
        }

        const result = linkServerToLicense(guildId, resolvedKey);
        if (!result.ok) {
          const msg = result.message.includes("already linked")
            ? t("Dieser Server ist bereits mit dieser Lizenz verknuepft.", "This server is already linked to this license.")
            : result.message.includes("seat")
              ? t(
                `Alle ${lic.seats} Server-Slots sind belegt. Entferne zuerst einen Server mit \`/license remove\` oder upgrade auf mehr Seats.`,
                `All ${lic.seats} server seats are used. Remove a server with \`/license remove\` or upgrade to more seats first.`
              )
              : result.message;
          await interaction.reply({ content: msg, ephemeral: true });
          return;
        }

        const refreshedLicense = getLicenseById(resolvedKey) || lic;
        const planName = PLANS[refreshedLicense.plan]?.name || refreshedLicense.plan;
        const expDate = refreshedLicense.expiresAt
          ? new Date(refreshedLicense.expiresAt).toLocaleDateString(t("de-DE", "en-US"))
          : t("Unbegrenzt", "Unlimited");
        const usedSeats = refreshedLicense.linkedServerIds?.length || 0;
        await interaction.reply({
          embeds: [{
            color: refreshedLicense.plan === "ultimate" ? 0xBD00FF : 0xFFB800,
            title: t("Lizenz aktiviert!", "License activated!"),
            description: t(
              `Dieser Server wurde erfolgreich mit deiner **${planName}**-Lizenz verknuepft.`,
              `This server was linked successfully with your **${planName}** license.`
            ),
            fields: [
              { name: t("Lizenz-Key", "License key"), value: `\`${resolvedKey}\``, inline: true },
              { name: t("Plan", "Plan"), value: planName, inline: true },
              { name: t("Server-Slots", "Server seats"), value: `${usedSeats}/${refreshedLicense.seats}`, inline: true },
              { name: t("Gueltig bis", "Valid until"), value: expDate, inline: true },
            ],
            footer: { text: t("OmniFM Premium", "OmniFM Premium") },
          }],
          ephemeral: true,
        });
        return;
      }

      if (sub === "info") {
        const lic = getServerLicense(guildId);
        if (!lic) {
          await interaction.reply({
            content: t(
              "Dieser Server hat keine aktive Lizenz.\nNutze `/license activate <key>` um einen Lizenz-Key zu aktivieren.",
              "This server has no active license.\nUse `/license activate <key>` to activate one."
            ),
            ephemeral: true,
          });
          return;
        }

        const planName = PLANS[lic.plan]?.name || lic.plan;
        const expDate = lic.expiresAt ? new Date(lic.expiresAt).toLocaleDateString(t("de-DE", "en-US")) : t("Unbegrenzt", "Unlimited");
        const linked = lic.linkedServerIds || [];
        const tierConfig = PLANS[lic.plan] || PLANS.free;
        await interaction.reply({
          embeds: [{
            color: lic.plan === "ultimate" ? 0xBD00FF : 0xFFB800,
            title: `OmniFM ${planName}`,
            fields: [
              { name: t("Lizenz-Key", "License key"), value: `\`${lic.id || "-"}\``, inline: true },
              { name: t("Plan", "Plan"), value: planName, inline: true },
              { name: t("Server-Slots", "Server seats"), value: `${linked.length}/${lic.seats}`, inline: true },
              { name: t("Gueltig bis", "Valid until"), value: expDate, inline: true },
              { name: t("Verbleibend", "Remaining"), value: t(`${lic.remainingDays} Tage`, `${lic.remainingDays} days`), inline: true },
              { name: t("Audio", "Audio"), value: tierConfig.bitrate, inline: true },
              { name: t("Max Bots", "Max bots"), value: `${tierConfig.maxBots}`, inline: true },
              { name: t("Reconnect", "Reconnect"), value: `${tierConfig.reconnectMs}ms`, inline: true },
            ],
            footer: { text: lic.expired ? t("ABGELAUFEN", "EXPIRED") : "OmniFM Premium" },
          }],
          ephemeral: true,
        });
        return;
      }

      if (sub === "remove") {
        const lic = getServerLicense(guildId);
        if (!lic || !lic.id) {
          await interaction.reply({ content: t("Dieser Server hat keine aktive Lizenz.", "This server has no active license."), ephemeral: true });
          return;
        }

        const result = unlinkServerFromLicense(guildId, lic.id);
        if (!result.ok) {
          await interaction.reply({ content: t("Fehler beim Entfernen: ", "Error while removing: ") + result.message, ephemeral: true });
          return;
        }

        await interaction.reply({
          content: t(
            "Server wurde von der Lizenz entfernt. Der Server-Slot ist jetzt frei und kann fuer einen anderen Server genutzt werden.\nNutze `/license activate <key>` um eine neue Lizenz zu aktivieren.",
            "Server was unlinked from the license. The seat is now free and can be used for another server.\nUse `/license activate <key>` to activate a new license."
          ),
          ephemeral: true,
        });
        return;
      }
    }

    if (interaction.commandName === "play") {
      const requested = interaction.options.getString("station");
      const requestedVoiceChannel = interaction.options.getChannel("voice");
      const requestedChannelInput = interaction.options.getString("channel");
      const requestedBotIndex = interaction.options.getInteger("bot");
      let requestedChannel = null;

      if (requestedVoiceChannel) {
        if (requestedVoiceChannel.guildId !== interaction.guildId) {
          await interaction.reply({
            content: t("Der gewaehlte Voice/Stage-Channel ist nicht in diesem Server.", "The selected voice/stage channel is not in this server."),
            ephemeral: true,
          });
          return;
        }
        if (
          !requestedVoiceChannel.isVoiceBased()
          || (requestedVoiceChannel.type !== ChannelType.GuildVoice && requestedVoiceChannel.type !== ChannelType.GuildStageVoice)
        ) {
          await interaction.reply({
            content: t("Bitte waehle einen Voice- oder Stage-Channel.", "Please choose a voice or stage channel."),
            ephemeral: true,
          });
          return;
        }
        requestedChannel = requestedVoiceChannel;
      }

      if (!requestedChannel && requestedChannelInput) {
        requestedChannel = await this.resolveVoiceChannelFromInput(interaction.guild, requestedChannelInput);
      }

      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);

      // Check standard stations first, then custom stations (Ultimate only)
      let key = resolveStation(stations, requested);
      let isCustom = false;
      let customUrl = null;

      if (key) {
        // Check tier access
        const stationTier = stations.stations[key]?.tier || "free";
        const tierRank = { free: 0, pro: 1, ultimate: 2 };
        if ((tierRank[stationTier] || 0) > (tierRank[guildTier] || 0)) {
          await interaction.reply(premiumStationEmbed(stations.stations[key].name, stationTier, language));
          return;
        }
      } else {
        // Check custom stations (Ultimate feature)
        const customStations = getGuildStations(guildId);
        const customKey = Object.keys(customStations).find(k => k === requested || customStations[k].name.toLowerCase() === (requested || "").toLowerCase());
        if (customKey && guildTier === "ultimate") {
          key = `custom:${customKey}`;
          isCustom = true;
          customUrl = customStations[customKey].url;
          const customUrlValidation = validateCustomStationUrl(customUrl);
          if (!customUrlValidation.ok) {
            const translated = translateCustomStationErrorMessage(customUrlValidation.error, language);
            await interaction.reply({
              content: t(
                `Custom-Station kann nicht genutzt werden: ${translated}`,
                `Custom station cannot be used: ${translated}`
              ),
              ephemeral: true
            });
            return;
          }
          stations.stations[key] = { name: customStations[customKey].name, url: customUrlValidation.url, tier: "ultimate" };
        } else if (customKey) {
          await interaction.reply(customStationEmbed(language));
          return;
        } else {
          await interaction.reply({ content: t("Unbekannte Station.", "Unknown station."), ephemeral: true });
          return;
        }
      }

      const guild = interaction.guild;
      if (!guild) {
        await interaction.reply({ content: t("Guild konnte nicht ermittelt werden.", "Could not resolve guild."), ephemeral: true });
        return;
      }

      if (!requestedChannel && requestedChannelInput) {
        await interaction.reply({
          content: t("Voice-Channel nicht gefunden.", "Voice channel not found."),
          ephemeral: true
        });
        return;
      }

      // ---- Commander Mode: Delegate to Worker ----
      if (this.role === "commander" && this.workerManager) {
        // Resolve voice channel ID
        let channelId = requestedChannel?.id;
        if (!channelId) {
          const member = await guild.members.fetch(interaction.user.id).catch(() => null);
          channelId = member?.voice?.channelId;
        }
        if (!channelId) {
          await interaction.reply({
            content: t("Du musst in einem Voice-Channel sein oder einen angeben.", "You must be in a voice channel or specify one."),
            ephemeral: true,
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });

        let worker;
        if (requestedBotIndex) {
          const check = this.workerManager.canUseWorker(requestedBotIndex, guildId, guildTier);
          if (!check.ok) {
            const reasons = {
              tier: t(`Worker ${requestedBotIndex} erfordert ein hoeheres Abo (max: ${check.maxIndex}).`, `Worker ${requestedBotIndex} requires a higher plan (max: ${check.maxIndex}).`),
              not_configured: t(`Worker ${requestedBotIndex} ist nicht konfiguriert.`, `Worker ${requestedBotIndex} is not configured.`),
              offline: t(`Worker ${requestedBotIndex} ist offline.`, `Worker ${requestedBotIndex} is offline.`),
              not_invited: t(`Worker ${requestedBotIndex} ist nicht auf diesem Server. Nutze \`/invite worker:${requestedBotIndex}\` zum Einladen.`, `Worker ${requestedBotIndex} is not on this server. Use \`/invite worker:${requestedBotIndex}\` to invite.`),
            };
            await interaction.editReply(reasons[check.reason] || t("Worker nicht verfuegbar.", "Worker not available."));
            return;
          }
          worker = check.worker;
        } else {
          worker = this.workerManager.findFreeWorker(guildId, guildTier);
        }

        if (!worker) {
          const invited = this.workerManager.getInvitedWorkers(guildId);
          if (invited.length === 0) {
            await interaction.editReply(t(
              "Kein Worker-Bot ist auf diesem Server. Nutze `/invite worker:1` zum Einladen.",
              "No worker bot is on this server. Use `/invite worker:1` to invite one."
            ));
          } else {
            await interaction.editReply(t(
              "Alle Worker-Bots auf diesem Server sind belegt. Lade mehr Worker ein oder stoppe einen laufenden Stream.",
              "All worker bots on this server are busy. Invite more workers or stop a running stream."
            ));
          }
          return;
        }

        const selectedStation = stations.stations[key];
        log("INFO", `[${this.config.name}] /play guild=${guildId} station=${key} -> delegating to ${worker.config.name}`);
        const result = await worker.playInGuild(guildId, channelId, key, stations, state.volume || 100);
        if (!result.ok) {
          await interaction.editReply(t(`Fehler: ${result.error}`, `Error: ${result.error}`));
          return;
        }
        const tierConfig = getTierConfig(guildId);
        const tierLabel = tierConfig.tier !== "free" ? ` [${tierConfig.name} ${tierConfig.bitrate}]` : "";
        await interaction.editReply(t(
          `${result.workerName} startet: ${selectedStation?.name || key}${tierLabel}`,
          `${result.workerName} starting: ${selectedStation?.name || key}${tierLabel}`
        ));
        return;
      }

      // ---- Worker/Legacy Mode: Play locally ----
      log("INFO", `[${this.config.name}] /play guild=${guildId} station=${key} custom=${isCustom} tier=${guildTier}`);

      const selectedStation = stations.stations[key];
      await interaction.deferReply({ ephemeral: true });
      const { connection, error: connectError } = await this.connectToVoice(interaction, requestedChannel, { silent: true });
      if (!connection) {
        await interaction.editReply(connectError || t("Konnte keine Voice-Verbindung herstellen.", "Could not establish a voice connection."));
        return;
      }
      state.shouldReconnect = true;

      try {
        await this.playStation(state, stations, key, guildId);
        const tierConfig = getTierConfig(guildId);
        const tierLabel = tierConfig.tier !== "free" ? ` [${tierConfig.name} ${tierConfig.bitrate}]` : "";
        await interaction.editReply(t(`Starte: ${selectedStation?.name || key}${tierLabel}`, `Starting: ${selectedStation?.name || key}${tierLabel}`));
      } catch (err) {
        log("ERROR", `[${this.config.name}] Play error: ${err.message}`);
        state.lastStreamErrorAt = new Date().toISOString();

        const fallbackKey = getFallbackKey(stations, key);
        if (fallbackKey && fallbackKey !== key && stations.stations[fallbackKey]) {
          try {
            await this.playStation(state, stations, fallbackKey, guildId);
            await interaction.editReply(
              t(
                `Fehler bei ${selectedStation?.name || key}. Fallback: ${stations.stations[fallbackKey].name}`,
                `Error on ${selectedStation?.name || key}. Fallback: ${stations.stations[fallbackKey].name}`
              )
            );
            return;
          } catch (fallbackErr) {
            log("ERROR", `[${this.config.name}] Fallback error: ${fallbackErr.message}`);
            state.lastStreamErrorAt = new Date().toISOString();
          }
        }

        state.shouldReconnect = false;
        this.clearNowPlayingTimer(state);
        state.player.stop();
        this.clearCurrentProcess(state);
        if (state.connection) {
          state.connection.destroy();
          state.connection = null;
        }
        state.currentStationKey = null;
        state.currentStationName = null;
        state.currentMeta = null;
        state.nowPlayingSignature = null;
        this.updatePresence();
        await interaction.editReply(t(`Fehler beim Starten: ${err.message}`, `Error while starting: ${err.message}`));
      }
    }
  }

  // ---- Programmatic Worker Control Methods (called by Commander) ----

  /**
   * Programmatic play - used by Commander to tell a Worker to stream.
   * Returns { ok, error? }
   */
  async playInGuild(guildId, channelId, stationKey, stationsData, volume = 100) {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) return { ok: false, error: "Worker ist nicht auf diesem Server." };

      const channel = guild.channels.cache.get(channelId);
      if (!channel) return { ok: false, error: "Voice-Channel nicht gefunden." };

      const state = this.getState(guildId);
      state.volume = volume;
      state.shouldReconnect = true;
      state.lastChannelId = channelId;

      // Connect to voice
      const connection = joinVoiceChannel({
        channelId,
        guildId,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false,
        group: this.voiceGroup,
      });
      state.connection = connection;
      connection.subscribe(state.player);
      this.attachConnectionHandlers(guildId, connection);

      // Stage channel handling
      if (channel.type === ChannelType.GuildStageVoice) {
        await this.ensureStageChannelReady(guild, channel);
      }

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
      } catch {
        return { ok: false, error: "Voice-Verbindung konnte nicht hergestellt werden." };
      }

      // Play the station
      await this.playStation(state, stationsData, stationKey, guildId);
      this.updatePresence();

      return { ok: true, workerName: this.config.name };
    } catch (err) {
      log("ERROR", `[${this.config.name}] playInGuild error: ${err?.message || err}`);
      return { ok: false, error: err?.message || String(err) };
    }
  }

  /**
   * Programmatic stop - used by Commander to stop a Worker in a guild.
   */
  stopInGuild(guildId) {
    const state = this.guildState.get(guildId);
    if (!state) return { ok: false, error: "Kein State fuer diesen Server." };

    state.shouldReconnect = false;
    this.clearReconnectTimer(state);
    this.clearNowPlayingTimer(state);
    state.player.stop();
    this.clearCurrentProcess(state);

    if (state.connection) {
      state.connection.destroy();
      state.connection = null;
    }

    state.currentStationKey = null;
    state.currentStationName = null;
    state.currentMeta = null;
    state.nowPlayingSignature = null;
    state.reconnectAttempts = 0;
    state.streamErrorCount = 0;
    this.updatePresence();

    return { ok: true };
  }

  /**
   * Programmatic pause.
   */
  pauseInGuild(guildId) {
    const state = this.guildState.get(guildId);
    if (!state?.currentStationKey) return { ok: false, error: "Es laeuft nichts." };
    state.player.pause(true);
    return { ok: true };
  }

  /**
   * Programmatic resume.
   */
  resumeInGuild(guildId) {
    const state = this.guildState.get(guildId);
    if (!state?.currentStationKey) return { ok: false, error: "Es laeuft nichts." };
    state.player.unpause();
    return { ok: true };
  }

  /**
   * Programmatic volume set.
   */
  setVolumeInGuild(guildId, value) {
    const state = this.guildState.get(guildId);
    if (!state) return { ok: false, error: "Kein State." };
    state.volume = value;
    const resource = state.player.state.resource;
    if (resource?.volume) {
      resource.volume.setVolume(clampVolume(value));
    }
    return { ok: true };
  }

  /**
   * Get the current guild state info (for Commander queries).
   */
  getGuildInfo(guildId) {
    const state = this.guildState.get(guildId);
    if (!state) return null;
    return {
      playing: Boolean(state.currentStationKey),
      stationKey: state.currentStationKey,
      stationName: state.currentStationName,
      meta: state.currentMeta,
      volume: state.volume,
      channelId: state.lastChannelId,
      reconnectAttempts: state.reconnectAttempts || 0,
      shouldReconnect: state.shouldReconnect,
      streamErrorCount: state.streamErrorCount || 0,
    };
  }

  async start() {
    try {
      await this.client.login(this.config.token);
      return true;
    } catch (err) {
      this.startError = err;
      log("ERROR", `[${this.config.name}] Login fehlgeschlagen: ${err?.message || err}`);
      return false;
    }
  }

  collectStats() {
    const servers = this.client.guilds.cache.size;
    const users = this.client.guilds.cache.reduce((sum, guild) => sum + (Number(guild.memberCount) || 0), 0);

    let connections = 0;
    let listeners = 0;
    for (const state of this.guildState.values()) {
      if (state.connection) connections += 1;
      if (state.connection && state.currentStationKey) listeners += 1;
    }

    return { servers, users, connections, listeners };
  }

  getPlayingGuildCount() {
    let count = 0;
    for (const state of this.guildState.values()) {
      if (state.currentStationKey && state.connection) count += 1;
    }
    return count;
  }

  getPublicStatus() {
    const stats = this.collectStats();
    const resolvedClientId = this.getApplicationId() || this.config.clientId;
    // Per-guild details: was spielt wo
    const guildDetails = [];
    for (const [guildId, state] of this.guildState.entries()) {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) continue;
      guildDetails.push({
        guildId,
        guildName: guild.name,
        stationKey: state.currentStationKey || null,
        stationName: state.currentStationName || null,
        channelId: state.lastChannelId || null,
        channelName: state.lastChannelId ? guild.channels.cache.get(state.lastChannelId)?.name || null : null,
        volume: state.volume,
        playing: Boolean(state.connection && state.currentStationKey),
        meta: state.currentMeta || null,
      });
    }
    const isPremiumBot = this.config.requiredTier && this.config.requiredTier !== "free";
    return {
      id: this.config.id,
      name: this.config.name,
      clientId: isPremiumBot ? null : resolvedClientId,
      inviteUrl: isPremiumBot ? null : buildInviteUrl({ ...this.config, clientId: resolvedClientId }),
      requiredTier: this.config.requiredTier || "free",
      ready: this.client.isReady(),
      userTag: this.client.user?.tag || null,
      avatarUrl: this.client.user?.displayAvatarURL({ extension: "png", size: 256 }) || null,
      guilds: stats.servers,
      servers: stats.servers,
      users: stats.users,
      connections: stats.connections,
      listeners: stats.listeners,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      error: this.startError ? String(this.startError.message || this.startError) : null,
      guildDetails,
    };
  }

  // === State Persistence: Speichert aktuellen Zustand fuer Auto-Reconnect nach Restart ===
  persistState() {
    const activeCount = [...this.guildState.entries()].filter(
      ([_, s]) => s.currentStationKey && s.lastChannelId && s.connection
    ).length;
    saveBotState(this.config.id, this.guildState);
    if (activeCount > 0) {
      log("INFO", `[${this.config.name}] State gespeichert (${activeCount} aktive Verbindung(en)).`);
    }
  }

  async restoreState(stations) {
    const saved = getBotState(this.config.id);
    if (!saved || Object.keys(saved).length === 0) {
      log("INFO", `[${this.config.name}] Kein gespeicherter State gefunden (bot-id: ${this.config.id}).`);
      return;
    }

    log("INFO", `[${this.config.name}] Stelle ${Object.keys(saved).length} Verbindung(en) wieder her...`);

    for (const [guildId, data] of Object.entries(saved)) {
      try {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) {
          log("INFO", `[${this.config.name}] Guild ${guildId} nicht gefunden (${this.client.guilds.cache.size} Guilds im Cache), ueberspringe.`);
          clearBotGuild(this.config.id, guildId);
          continue;
        }

        const allowedForRestore = await this.enforceGuildAccessForGuild(guild, "restore");
        if (!allowedForRestore) {
          continue;
        }

        // Fetch channel from API if not in cache
        let channel = guild.channels.cache.get(data.channelId);
        if (!channel) {
          channel = await guild.channels.fetch(data.channelId).catch(() => null);
        }
        if (!channel || !channel.isVoiceBased()) {
          log("INFO", `[${this.config.name}] Channel ${data.channelId} in ${guild.name} nicht gefunden.`);
          clearBotGuild(this.config.id, guildId);
          continue;
        }

        const stationKey = resolveStation(stations, data.stationKey);
        if (!stationKey) {
          log("INFO", `[${this.config.name}] Station ${data.stationKey} nicht mehr vorhanden.`);
          clearBotGuild(this.config.id, guildId);
          continue;
        }

        log("INFO", `[${this.config.name}] Reconnect: ${guild.name} / #${channel.name} / ${stations.stations[stationKey].name}`);

        const state = this.getState(guildId);
        state.volume = data.volume ?? 100;
        state.shouldReconnect = true;
        state.lastChannelId = data.channelId;
        state.currentStationKey = stationKey;
        state.currentStationName = stations.stations[stationKey].name || stationKey;

        const connection = joinVoiceChannel({
          channelId: channel.id,
          guildId,
          adapterCreator: guild.voiceAdapterCreator,
          selfDeaf: true,
          selfMute: false,
          group: this.voiceGroup,
        });

        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
        } catch {
          log("ERROR", `[${this.config.name}] Voice-Verbindung zu ${guild.name} fehlgeschlagen (Timeout).`);
          networkRecoveryCoordinator.noteFailure(`${this.config.name} restore-voice-timeout`, `guild=${guildId}`);
          try { connection.destroy(); } catch {}
          this.scheduleReconnect(guildId, { reason: "restore-ready-timeout" });
          continue;
        }

        state.connection = connection;
        connection.subscribe(state.player);
        this.attachConnectionHandlers(guildId, connection);
        networkRecoveryCoordinator.noteSuccess(`${this.config.name} restore-ready guild=${guildId}`);

        await this.playStation(state, stations, stationKey, guildId);
        log("INFO", `[${this.config.name}] Wiederhergestellt: ${guild.name} -> ${stations.stations[stationKey].name}`);

        // Kurze Pause zwischen Reconnects um Rate-Limits zu vermeiden
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        log("ERROR", `[${this.config.name}] Restore fehlgeschlagen fuer Guild ${guildId}: ${err?.message || err}`);
        const state = this.guildState.get(guildId);
        if (state?.shouldReconnect && state.lastChannelId && state.currentStationKey) {
          this.scheduleReconnect(guildId, { reason: "restore-error" });
        }
      }
    }
  }

  async stop() {
    if (typeof this.unsubscribeNetworkRecovery === "function") {
      this.unsubscribeNetworkRecovery();
      this.unsubscribeNetworkRecovery = null;
    }
    this.stopEventScheduler();

    for (const state of this.guildState.values()) {
      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      state.player.stop();
      this.clearCurrentProcess(state);
      if (state.connection) {
        try { state.connection.destroy(); } catch { /* ignore */ }
        state.connection = null;
      }
      state.currentStationKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.nowPlayingSignature = null;
      state.streamErrorCount = 0;
    }

    try {
      this.client.destroy();
    } catch {
      // ignore
    }
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};


export { BotRuntime };
