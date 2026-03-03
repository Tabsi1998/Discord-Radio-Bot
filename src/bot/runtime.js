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
  StringSelectMenuBuilder,
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
import { NowPlayingQueue } from "../lib/now-playing-queue.js";
import { buildNowPlayingSignature, getNowPlayingCandidateIds } from "../lib/now-playing-target.js";
import {
  TIERS,
  TIER_RANK,
  clipText,
  clampVolume,
  waitMs,
  applyJitter,
  isWithinWorkerPlanLimit,
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
  buildEventDateTimeFromParts,
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
  fetchStreamSnapshot,
  fetchStreamInfo,
  setNowPlayingQueue,
  normalizeTrackSearchText,
} from "../services/now-playing.js";
import { createResource } from "../services/stream.js";
import { isYouTubeUrl } from "../services/youtube-live.js";
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
  buildCustomStationReference,
  parseCustomStationReference,
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
  recordCommandUsage,
  recordStationStart,
  recordListenerSample,
  buildGuildListeningAnalytics,
  getGuildListeningStats,
  getTopGuildsByActivity,
} from "../listening-stats-store.js";
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
import { premiumStationEmbed, customStationEmbed, botLimitEmbed } from "../ui/upgradeEmbeds.js";
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

function toPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue ?? fallbackValue), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function resolveWebsiteUrl() {
  const explicit = String(process.env.PUBLIC_WEB_URL || "").trim();
  if (explicit) return explicit;
  const domain = String(process.env.WEB_DOMAIN || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (domain && !/[\s/\\]/.test(domain)) return `https://${domain}`;
  return "https://omnifm.xyz";
}

const WEBSITE_URL = resolveWebsiteUrl();
const SUPPORT_URL = "https://discord.gg/UeRkfGS43R";
const INVITE_COMPONENT_PREFIX = "omnifm:invite:";
const INVITE_COMPONENT_ID_OPEN = `${INVITE_COMPONENT_PREFIX}open`;
const INVITE_COMPONENT_ID_REFRESH = `${INVITE_COMPONENT_PREFIX}refresh`;
const INVITE_COMPONENT_ID_SELECT = `${INVITE_COMPONENT_PREFIX}select`;
const INVITE_COMPONENT_ID_CLOSE = `${INVITE_COMPONENT_PREFIX}close`;
const WORKERS_COMPONENT_PREFIX = "omnifm:workers:";
const WORKERS_COMPONENT_ID_REFRESH = `${WORKERS_COMPONENT_PREFIX}refresh`;


const VOICE_CHANNEL_STATUS_ENABLED = String(process.env.VOICE_CHANNEL_STATUS_ENABLED ?? "1") !== "0";
const VOICE_CHANNEL_STATUS_TEMPLATE =
  String(process.env.VOICE_CHANNEL_STATUS_TEMPLATE || "\uD83D\uDD0A | 24/7 {station}").trim()
  || "\uD83D\uDD0A | 24/7 {station}";
const VOICE_CHANNEL_STATUS_MAX_LENGTH = Math.max(1, Math.min(100, toPositiveInt(process.env.VOICE_CHANNEL_STATUS_MAX_LENGTH, 80)));
const ONBOARDING_MESSAGE_ENABLED = String(process.env.ONBOARDING_MESSAGE_ENABLED ?? "1") !== "0";
const VOICE_STATE_RECONCILE_ENABLED = String(process.env.VOICE_STATE_RECONCILE_ENABLED ?? "1") !== "0";
const VOICE_STATE_RECONCILE_MS = Math.max(15_000, toPositiveInt(process.env.VOICE_STATE_RECONCILE_MS, 30_000));


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
    this.nowPlayingQueue = new NowPlayingQueue(5);
    setNowPlayingQueue(this.nowPlayingQueue);
    this.startedAt = Date.now();
    this.readyAt = null;
    this.startError = null;
    this.eventSchedulerTimer = null;
    this.voiceHealthTimer = null;
    this.pendingVoiceReconcileTimers = new Map();
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
      } else {
        this.clearGuildCommandsForWorker().catch((err) => {
          log("ERROR", `[${this.config.name}] Worker-Command-Cleanup fehlgeschlagen: ${err?.message || err}`);
        });
      }
      this.startVoiceStateReconciler();
    });

    // Only commander handles interactions (slash commands)
    if (this.role === "commander") {
      this.client.on("interactionCreate", (interaction) => {
        this.handleInteraction(interaction).catch(async (err) => {
          const commandName = interaction?.isChatInputCommand?.() ? `/${interaction.commandName}` : interaction?.type || "unknown";
          const guildId = String(interaction?.guildId || "-");
          const userId = String(interaction?.user?.id || interaction?.member?.user?.id || "-");
          log(
            "ERROR",
            `[${this.config.name}] interaction error command=${commandName} guild=${guildId} user=${userId}: ${err?.stack || err}`
          );
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
          this.sendGuildOnboardingMessage(guild).catch((err) => {
            log("WARN", `[${this.config.name}] Onboarding-Nachricht fehlgeschlagen: ${err?.message || err}`);
          });
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
        currentFallbackKey: null,
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
        connectingVoice: false,
        connectingVoiceChannelId: null,
        connectingVoiceStartedAt: 0,
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
        lastListenerStatsSampleAt: 0,
        nowPlayingLastErrorAt: 0,
        voiceStatusText: "",
        lastVoiceStatusErrorAt: 0,
        activeScheduledEventId: null,
        activeScheduledEventStopAtMs: 0,
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
    this.clearQueuedVoiceReconcile(guildId);
    const state = this.guildState.get(guildId);
    this.syncVoiceChannelStatus(guildId, "").catch(() => null);
    if (state) {
      this.finishVoiceConnectionAttempt(state);
      this.flushListeningStatsSample(guildId, state);
      this.queueDeleteNowPlayingMessage(guildId, state);
      state.shouldReconnect = false;
      state.currentFallbackKey = null;
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      state.player.stop();
      this.clearCurrentProcess(state);
      if (state.connection) {
        try { state.connection.destroy(); } catch {}
      }
      state.lastListenerStatsSampleAt = 0;
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
      `[${this.config.name}] Verlasse Guild ${guild.name} (${guild.id}) - Zugriff verweigert (${reason}, source=${source}, guildTier=${access.guildTier}, required=${access.requiredTier}, botIndex=${access.botIndex}, workerSlot=${access.workerSlot || "-"}, maxBots=${access.maxBots})`
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

  canSendOnboardingToChannel(channel, me) {
    if (!channel) return false;
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) return false;
    if (!me) return false;
    const perms = channel.permissionsFor(me);
    return Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages));
  }

  async resolveOnboardingChannel(guild) {
    if (!guild) return null;
    const me = await this.resolveBotMember(guild);
    if (!me) return null;
    const systemChannel = guild.systemChannel || null;
    if (this.canSendOnboardingToChannel(systemChannel, me)) {
      return systemChannel;
    }

    if (!guild.channels?.cache?.size) {
      await guild.channels.fetch().catch(() => null);
    }

    const textChannels = [...guild.channels.cache.values()].filter((channel) => {
      return this.canSendOnboardingToChannel(channel, me);
    });
    if (!textChannels.length) return null;

    const scoreChannel = (channel) => {
      const name = String(channel.name || "").toLowerCase();
      let score = 0;
      if (name.includes("system")) score += 400;
      if (name.includes("mod") || name.includes("moderator")) score += 320;
      if (name.includes("admin") || name.includes("staff")) score += 300;
      if (name.includes("setup") || name.includes("config")) score += 280;
      if (name.includes("bot") || name.includes("command") || name.includes("kommando")) score += 220;
      if (name.includes("general") || name.includes("allgemein")) score += 150;
      score -= Number(channel.rawPosition || 0);
      return score;
    };

    textChannels.sort((a, b) => scoreChannel(b) - scoreChannel(a));
    return textChannels[0] || null;
  }

  buildOnboardingMessagePayload(guild) {
    const language = this.resolveGuildLanguage(guild?.id);
    const isDe = language === "de";

    const embed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setTitle(isDe ? `${BRAND.name}: Erste Schritte` : `${BRAND.name}: First steps`)
      .setDescription(
        isDe
          ? `Danke fuer den Invite auf **${guild?.name || "deinen Server"}**.\nDer Commander nimmt Befehle entgegen, Worker streamen die Musik.`
          : `Thanks for inviting me to **${guild?.name || "your server"}**.\nThe commander handles commands, workers stream the audio.`
      )
      .addFields(
        {
          name: isDe ? "1) Worker checken" : "1) Check workers",
          value: isDe
            ? "`/workers` zeigt verfügbare und bereits eingeladene Worker."
            : "`/workers` shows available and already invited workers.",
        },
        {
          name: isDe ? "2) Worker einladen" : "2) Invite worker",
          value: isDe
            ? "`/invite` oeffnet ein Menue fuer freie Worker-Slots."
            : "`/invite` opens a menu for free worker slots.",
        },
        {
          name: isDe ? "3) Stream starten" : "3) Start stream",
          value: isDe
            ? "`/play [station] [voice]` startet Radio im Voice/Stage-Channel."
            : "`/play [station] [voice]` starts radio in your voice/stage channel.",
        },
        {
          name: isDe ? "4) Hilfe & Setup" : "4) Help & setup",
          value: isDe
            ? "`/help` fuer komplette Befehlsliste und Tipps."
            : "`/help` for the full command list and tips.",
        }
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(isDe ? "Website" : "Website")
        .setURL(WEBSITE_URL),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(isDe ? "Support" : "Support")
        .setURL(SUPPORT_URL)
    );

    return { embeds: [embed], components: [row] };
  }

  async sendGuildOnboardingMessage(guild) {
    if (!ONBOARDING_MESSAGE_ENABLED) return;
    if (!guild?.id) return;

    const channel = await this.resolveOnboardingChannel(guild);
    if (!channel) return;
    const payload = this.buildOnboardingMessagePayload(guild);
    await channel.send(payload);
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

  isWorkerGuildCommandCleanupEnabled() {
    return String(process.env.CLEAN_WORKER_GUILD_COMMANDS_ON_BOOT ?? "1") !== "0";
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

  async clearGuildCommandsForWorker() {
    if (this.role !== "worker") return;
    if (!this.isWorkerGuildCommandCleanupEnabled()) return;
    const guildIds = [...this.client.guilds.cache.keys()];
    if (!guildIds.length) return;
    const applicationId = this.getApplicationId();
    if (!applicationId) return;
    for (const guildId of guildIds) {
      // eslint-disable-next-line no-await-in-loop
      await this.rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] }).catch((err) => {
        log("WARN", `[${this.config.name}] Worker-Command-Cleanup fehlgeschlagen fuer Guild ${guildId}: ${err?.message || err}`);
      });
    }
    log("INFO", `[${this.config.name}] Worker-Guild-Commands bereinigt (Guilds: ${guildIds.length}).`);
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

  beginVoiceConnectionAttempt(state, channelId = null) {
    if (!state) return;
    state.connectingVoice = true;
    state.connectingVoiceChannelId = String(channelId || "").trim() || null;
    state.connectingVoiceStartedAt = Date.now();
  }

  finishVoiceConnectionAttempt(state) {
    if (!state) return;
    state.connectingVoice = false;
    state.connectingVoiceChannelId = null;
    state.connectingVoiceStartedAt = 0;
  }

  isVoiceConnectionAttemptActive(state, { maxAgeMs = 35_000 } = {}) {
    if (!state?.connectingVoice) return false;
    const startedAt = Number.parseInt(String(state.connectingVoiceStartedAt || 0), 10);
    if (!startedAt || (Date.now() - startedAt) <= maxAgeMs) {
      return true;
    }
    this.finishVoiceConnectionAttempt(state);
    return false;
  }

  logNowPlayingIssue(guildId, state, message) {
    const now = Date.now();
    const cooldownMs = 120_000;
    if (state.nowPlayingLastErrorAt && now - state.nowPlayingLastErrorAt < cooldownMs) return;
    state.nowPlayingLastErrorAt = now;
    log("INFO", `[${this.config.name}] NowPlaying guild=${guildId}: ${message}`);
  }

  markNowPlayingTargetDirty(guildId, state, preferredChannelId = null) {
    const normalizedPreferredChannelId = String(preferredChannelId || "").trim();
    const currentTargetChannelId = String(state?.nowPlayingChannelId || "").trim();
    if (normalizedPreferredChannelId && currentTargetChannelId === normalizedPreferredChannelId) {
      return false;
    }

    const hasTrackedNowPlayingMessage = Boolean(
      String(state?.nowPlayingChannelId || "").trim() && String(state?.nowPlayingMessageId || "").trim()
    );
    if (hasTrackedNowPlayingMessage) {
      this.queueDeleteNowPlayingMessage(guildId, state);
    }

    state.nowPlayingMessageId = null;
    state.nowPlayingSignature = null;
    if (!normalizedPreferredChannelId || currentTargetChannelId !== normalizedPreferredChannelId) {
      state.nowPlayingChannelId = null;
    }
    return true;
  }

  canSendNowPlayingToChannel(channel, me) {
    if (!channel || typeof channel.send !== "function") return false;
    if (!me) return false;
    if (channel.isThread?.() && channel.archived) return false;
    const perms = channel.permissionsFor?.(me);
    return Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages));
  }

  async fetchGuildChannelById(guild, channelId) {
    const normalizedChannelId = String(channelId || "").trim();
    if (!normalizedChannelId) return null;
    return guild.channels.cache.get(normalizedChannelId)
      || await guild.channels.fetch(normalizedChannelId).catch(() => null);
  }

  scoreNowPlayingFallbackChannel(channel) {
    const name = String(channel?.name || "").toLowerCase();
    let score = 0;
    if (name.includes("now-playing") || name.includes("nowplaying")) score += 500;
    if (name.includes("music") || name.includes("radio") || name.includes("musik")) score += 420;
    if (name.includes("bot") || name.includes("command") || name.includes("kommando")) score += 260;
    if (name.includes("general") || name.includes("allgemein")) score += 180;
    if (channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement) score += 120;
    score -= Number(channel?.rawPosition || 0);
    return score;
  }

  normalizeNowPlayingValue(value, station, meta = null, maxLength = 240) {
    const normalized = clipText(String(value || "").trim(), maxLength);
    if (!normalized) return null;

    const lower = normalized.toLowerCase();
    const blockedValues = new Set(["-", "--", "n/a", "na", "none", "null", "undefined", "unknown"]);
    if (blockedValues.has(lower)) return null;

    const knownStationTexts = [
      station?.name,
      meta?.name,
      meta?.description,
    ]
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean);

    if (knownStationTexts.includes(lower)) return null;
    return normalized;
  }

  isFreshNowPlayingTrack(meta) {
    const detectedAtMs = Number.parseInt(String(meta?.trackDetectedAtMs || 0), 10);
    if (!Number.isFinite(detectedAtMs) || detectedAtMs <= 0) return false;
    return (Date.now() - detectedAtMs) <= (NOW_PLAYING_POLL_MS * 4);
  }

  buildTrackSearchQuery(station, meta) {
    const artist = normalizeTrackSearchText(this.normalizeNowPlayingValue(meta?.artist, station, meta, 100));
    const title = normalizeTrackSearchText(this.normalizeNowPlayingValue(meta?.title, station, meta, 120));
    const displayTitle = normalizeTrackSearchText(this.normalizeNowPlayingValue(meta?.displayTitle || meta?.streamTitle, station, meta, 180));
    const query = artist && title ? `${artist} ${title}` : displayTitle;
    return clipText(query || "", 180) || null;
  }

  buildTrackLinkComponentsLegacy(guildId, station, meta) {
    const query = this.buildTrackSearchQuery(station, meta);
    if (!query) return [];

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("▶ YouTube")
        .setEmoji("\u25b6")
        .setEmoji("\u25b6")
        .setURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`)
        .setEmoji("\u25b6"),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("♫ Spotify")
        .setURL(`https://open.spotify.com/search/${encodeURIComponent(query)}`)
    );

    return [row];
  }

  buildTrackLinkComponents(guildId, station, meta) {
    const query = this.buildTrackSearchQuery(station, meta);
    if (!query) return [];
    const language = this.resolveGuildLanguage(guildId);
    const isDe = language === "de";

    const buttons = [
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(isDe ? "YouTube-Suche" : "YouTube search")
        .setURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`)
        .setEmoji("\u{1f4fa}"),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(isDe ? "Spotify-Suche" : "Spotify search")
        .setURL(`https://open.spotify.com/search/${encodeURIComponent(query)}`)
        .setEmoji("\u{1f3b5}"),
    ];

    const musicBrainzUrl = meta?.musicBrainzReleaseId
      ? `https://musicbrainz.org/release/${encodeURIComponent(meta.musicBrainzReleaseId)}`
      : (meta?.musicBrainzRecordingId
        ? `https://musicbrainz.org/recording/${encodeURIComponent(meta.musicBrainzRecordingId)}`
        : null);

    if (musicBrainzUrl) {
      buttons.push(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("MusicBrainz")
          .setURL(musicBrainzUrl)
          .setEmoji("\u{1f9e0}")
      );
    }

    const row = new ActionRowBuilder().addComponents(...buttons);
    return [row];
  }

  buildNowPlayingSourceSummary(language, meta, hasTrack) {
    const isDe = language === "de";
    const metadataSource = String(meta?.metadataSource || "").trim().toLowerCase();
    const metadataStatus = String(meta?.metadataStatus || (hasTrack ? "ok" : "empty")).trim().toLowerCase();
    const recognitionConfidence = Number.parseFloat(String(meta?.recognitionConfidence ?? ""));

    let sourceLabel = isDe ? "Unbekannt" : "Unknown";
    let sourceDetail = sourceLabel;
    let sourceNote = null;

    if (metadataSource === "icy") {
      sourceLabel = isDe ? "Sender-Metadaten" : "Station metadata";
      sourceDetail = sourceLabel;
    } else if (metadataSource === "recognition") {
      sourceLabel = isDe ? "Audio-Fingerprint" : "Audio fingerprint";
      sourceDetail = [
        meta?.recognitionProvider || "AcoustID",
        Number.isFinite(recognitionConfidence) ? `${Math.round(recognitionConfidence * 100)}%` : "",
      ].filter(Boolean).join(" | ") || sourceLabel;
      sourceNote = isDe
        ? "Per Audio-Fingerprint erkannt."
        : "Matched via audio fingerprint.";
    } else if (metadataSource === "icy+recognition") {
      sourceLabel = isDe ? "Metadaten + Fingerprint" : "Metadata + fingerprint";
      sourceDetail = [
        isDe ? "Sender-Metadaten ergänzt" : "Station metadata enriched",
        meta?.recognitionProvider || "AcoustID",
        Number.isFinite(recognitionConfidence) ? `${Math.round(recognitionConfidence * 100)}%` : "",
      ].filter(Boolean).join(" | ");
      sourceNote = isDe
        ? "Senderdaten wurden per Audio-Fingerprint ergänzt."
        : "Station data was enriched via audio fingerprint.";
    } else if (metadataSource === "stream") {
      sourceLabel = isDe ? "Stream-Info" : "Stream info";
      sourceDetail = sourceLabel;
    }

    let metadataHint = null;
    if (!hasTrack) {
      metadataHint = metadataStatus === "unsupported"
        ? (isDe
          ? "Dieser Stream sendet aktuell keine lesbaren Songdaten."
          : "This stream is not sending readable track data right now.")
        : (isDe
          ? "Dieser Sender liefert aktuell keine verwertbaren Songdaten."
          : "This station is not providing usable track data right now.");
    }

    return { metadataSource, sourceLabel, sourceDetail, sourceNote, metadataHint };
  }

  getVoiceListenerCount(guildId, channelId) {
    const guild = this.client.guilds.cache.get(guildId);
    const normalizedChannelId = String(channelId || "").trim();
    if (!guild || !normalizedChannelId) return 0;
    const channel = guild.channels?.cache?.get(normalizedChannelId);
    if (!channel?.isVoiceBased?.() || !channel.members) return 0;
    let listeners = 0;
    for (const member of channel.members.values()) {
      if (!member?.user?.bot) listeners += 1;
    }
    return listeners;
  }

  getCurrentListenerCount(guildId, state) {
    const channelId = String(state?.connection?.joinConfig?.channelId || state?.lastChannelId || "").trim();
    return this.getVoiceListenerCount(guildId, channelId);
  }

  getVoiceChannelDisplayName(guildId, channelId) {
    const guild = this.client.guilds.cache.get(guildId);
    const normalizedChannelId = String(channelId || "").trim();
    if (!guild || !normalizedChannelId) return normalizedChannelId || "Voice";
    return guild.channels?.cache?.get(normalizedChannelId)?.name || normalizedChannelId;
  }

  getListeningStatsWindowDays(guildTier) {
    if (guildTier === "ultimate") return 365;
    if (guildTier === "pro") return 180;
    return 30;
  }

  formatStatsDuration(seconds, language = "de") {
    const safeSeconds = Math.max(0, Number(seconds || 0) || 0);
    const hours = safeSeconds / 3600;
    if (hours >= 100) return `${hours.toFixed(0)} h`;
    if (hours >= 1) return `${hours.toFixed(1)} h`;
    return `${Math.round(safeSeconds / 60)} ${language === "de" ? "Min." : "min"}`;
  }

  flushListeningStatsSample(guildId, state, nowMs = Date.now()) {
    if (!guildId || !state) return false;
    const now = Number(nowMs) || Date.now();
    const lastSampleAt = Number.parseInt(String(state.lastListenerStatsSampleAt || 0), 10) || 0;
    if (!state.currentStationKey) {
      state.lastListenerStatsSampleAt = now;
      return false;
    }
    if (!lastSampleAt) {
      state.lastListenerStatsSampleAt = now;
      return false;
    }

    const sampleDurationMs = Math.max(0, now - lastSampleAt);
    state.lastListenerStatsSampleAt = now;
    if (sampleDurationMs <= 0) return false;

    const channelId = String(state.connection?.joinConfig?.channelId || state.lastChannelId || "").trim();
    recordListenerSample(guildId, {
      listenerCount: this.getCurrentListenerCount(guildId, state),
      stationKey: state.currentStationKey || "",
      stationName: state.currentStationName || state.currentStationKey || "",
      channelId,
      channelName: this.getVoiceChannelDisplayName(guildId, channelId),
      sampleDurationMs,
      timestampMs: now,
    });
    return true;
  }

  getLiveGuildPlaybackSnapshot(guildId) {
    const normalizedGuildId = String(guildId || "").trim();
    if (!normalizedGuildId) return [];

    if (this.role === "commander" && this.workerManager) {
      return this.workerManager.getStreamingWorkers(normalizedGuildId).map((runtime) => {
        const state = runtime.getState(normalizedGuildId);
        const info = runtime.getGuildInfo(normalizedGuildId) || {};
        return {
          runtime,
          state,
          stationKey: info.stationKey || state?.currentStationKey || null,
          stationName: info.stationName || state?.currentStationName || null,
          channelId: info.channelId || state?.lastChannelId || null,
          listenerCount: runtime.getCurrentListenerCount(normalizedGuildId, state),
        };
      });
    }

    const state = this.getState(normalizedGuildId);
    if (!state?.currentStationKey) return [];
    const info = this.getGuildInfo(normalizedGuildId) || {};
    return [{
      runtime: this,
      state,
      stationKey: info.stationKey || state.currentStationKey || null,
      stationName: info.stationName || state.currentStationName || null,
      channelId: info.channelId || state.lastChannelId || null,
      listenerCount: this.getCurrentListenerCount(normalizedGuildId, state),
    }];
  }

  formatStatsHourBucket(hour, language = "de") {
    const normalizedHour = Number.parseInt(String(hour || 0), 10);
    const safeHour = Number.isFinite(normalizedHour) ? Math.max(0, Math.min(23, normalizedHour)) : 0;
    const nextHour = (safeHour + 1) % 24;
    if (language === "de") {
      return `${String(safeHour).padStart(2, "0")}:00-${String(nextHour).padStart(2, "0")}:00`;
    }
    return `${String(safeHour).padStart(2, "0")}:00-${String(nextHour).padStart(2, "0")}:00`;
  }

  buildListeningStatsEmbed(guildId, language = "de") {
    const t = (de, en) => languagePick(language, de, en);
    const guild = this.client.guilds.cache.get(guildId) || null;
    const stats = getGuildListeningStats(guildId);
    const liveStreams = this.getLiveGuildPlaybackSnapshot(guildId);
    const totalLiveListeners = liveStreams.reduce((sum, item) => sum + (Number(item.listenerCount) || 0), 0);
    const topStationEntry = Object.entries(stats?.stationStarts || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
    const topHourEntry = Object.entries(stats?.hours || {})
      .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0] || null;
    const topChannels = Object.entries(stats?.voiceChannels || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([channelId, count]) => {
        const name = guild?.channels?.cache?.get(channelId)?.name || channelId;
        return `#${name}: ${count}`;
      });
    const topGuild = getTopGuildsByActivity(1)[0] || null;
    const topGuildName = topGuild
      ? (this.client.guilds.cache.get(topGuild.guildId)?.name || topGuild.guildId)
      : null;
    const liveStationsText = liveStreams.length
      ? liveStreams.map((item) => {
        const stationName = clipText(item.stationName || item.stationKey || "-", 80);
        const voiceLabel = item.channelId ? `<#${item.channelId}>` : t("unbekannt", "unknown");
        return `**${stationName}** - ${voiceLabel} - ${item.listenerCount} ${t("Zuhörer", "listeners")}`;
      }).join("\n")
      : t("Aktuell laeuft auf diesem Server kein Stream.", "No stream is currently running on this server.");

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(t("📊 Listening-Stats", "📊 Listening stats"))
      .setDescription(
        t(
          `Server: **${guild?.name || guildId}**\nLive-Zuhörer jetzt: **${totalLiveListeners}**`,
          `Server: **${guild?.name || guildId}**\nLive listeners now: **${totalLiveListeners}**`
        )
      )
      .addFields(
        {
          name: t("🎧 Live gerade", "🎧 Live now"),
          value: clipText(liveStationsText, 900),
          inline: false,
        },
        {
          name: t("📻 Meist gespielte Station", "📻 Most played station"),
          value: topStationEntry
            ? `${clipText(topStationEntry[0], 100)} (${topStationEntry[1]})`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        },
        {
          name: t("⏰ Peak-Zeit", "⏰ Peak time"),
          value: topHourEntry && Number(topHourEntry[1]) > 0
            ? `${this.formatStatsHourBucket(topHourEntry[0], language)} (${topHourEntry[1]})`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        },
        {
          name: t("🔥 Peak-Zuhörer", "🔥 Peak listeners"),
          value: String(Number(stats?.peakListeners || 0)),
          inline: true,
        },
        {
          name: t("🗣 Aktivste Voice-Channels", "🗣 Most active voice channels"),
          value: topChannels.length ? clipText(topChannels.join("\n"), 900) : t("Noch keine Daten", "No data yet"),
          inline: false,
        },
        {
          name: t("📈 Server gesamt", "Server totals"),
          value: t(
            `Starts: **${Number(stats?.totalStarts || 0)}**\nLetzter Start: ${stats?.lastStartedAt ? this.formatDiscordTimestamp(stats.lastStartedAt, "R") : "-"}`,
            `Starts: **${Number(stats?.totalStarts || 0)}**\nLast start: ${stats?.lastStartedAt ? this.formatDiscordTimestamp(stats.lastStartedAt, "R") : "-"}`
          ),
          inline: true,
        },
        {
          name: t("🌍 Top-Server global", "Top server global"),
          value: topGuild
            ? `${clipText(topGuildName, 80)} (${topGuild.totalStarts} ${t("Starts", "starts")})`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        }
      )
      .setFooter({
        text: t("OmniFM Analytics | /stats", "OmniFM analytics | /stats"),
      })
      .setTimestamp(new Date());

    return embed;
  }

  buildListeningStatsPayload(guildId, language = "de") {
    const t = (de, en) => languagePick(language, de, en);
    const guild = this.client.guilds.cache.get(guildId) || null;
    const guildTier = getTier(guildId);
    const windowDays = this.getListeningStatsWindowDays(guildTier);
    const analytics = buildGuildListeningAnalytics(guildId, {
      windowDays,
      stationLimit: guildTier === "ultimate" ? 12 : guildTier === "pro" ? 8 : 5,
      channelLimit: guildTier === "ultimate" ? 8 : 5,
      dailyLimit: guildTier === "ultimate" ? 10 : 6,
    });
    const liveStreams = this.getLiveGuildPlaybackSnapshot(guildId);
    const totalLiveListeners = liveStreams.reduce((sum, item) => sum + (Number(item.listenerCount) || 0), 0);
    const lifetime = analytics.lifetime;
    const windowSummary = analytics.window;
    const topStation = analytics.topStation;
    const topHour = analytics.topHour;
    const topChannels = analytics.channels
      .slice(0, guildTier === "ultimate" ? 5 : 3)
      .map((row) => `#${clipText(this.getVoiceChannelDisplayName(guildId, row.channelId) || row.name || row.channelId, 50)}: ${this.formatStatsDuration(row.listenerSeconds, language)}`);
    const topGuild = getTopGuildsByActivity(1)[0] || null;
    const topGuildName = topGuild
      ? (this.client.guilds.cache.get(topGuild.guildId)?.name || topGuild.guildId)
      : null;
    const liveStationsText = liveStreams.length
      ? liveStreams.map((item) => {
        const stationName = clipText(item.stationName || item.stationKey || "-", 80);
        const voiceLabel = item.channelId ? `<#${item.channelId}>` : t("unbekannt", "unknown");
        return `**${stationName}** - ${voiceLabel} - ${item.listenerCount} ${t("Zuhoerer", "listeners")}`;
      }).join("\n")
      : t("Aktuell laeuft auf diesem Server kein Stream.", "No stream is currently running on this server.");

    const summaryEmbed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(t("Listening-Stats", "Listening stats"))
      .setDescription(
        t(
          `Server: **${guild?.name || guildId}**\nLive-Zuhoerer jetzt: **${totalLiveListeners}**\nAnalysefenster: **${windowDays} Tage**`,
          `Server: **${guild?.name || guildId}**\nLive listeners now: **${totalLiveListeners}**\nAnalytics window: **${windowDays} days**`
        )
      )
      .addFields(
        {
          name: t("Live gerade", "Live now"),
          value: clipText(liveStationsText, 900),
          inline: false,
        },
        {
          name: t("Top Station nach Hoerstunden", "Top station by listener hours"),
          value: topStation
            ? `${clipText(topStation.name, 100)} (${this.formatStatsDuration(topStation.listenerSeconds, language)})`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        },
        {
          name: t("Peak-Zeit", "Peak time"),
          value: topHour && (Number(topHour.listenerSeconds || 0) > 0 || Number(topHour.starts || 0) > 0)
            ? Number(topHour.listenerSeconds || 0) > 0
              ? `${this.formatStatsHourBucket(topHour.hour, language)} (${this.formatStatsDuration(topHour.listenerSeconds, language)})`
              : `${this.formatStatsHourBucket(topHour.hour, language)} (${topHour.starts} ${t("Starts", "starts")})`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        },
        {
          name: t("Peak-Zuhoerer", "Peak listeners"),
          value: String(Number(lifetime?.peakListeners || 0)),
          inline: true,
        },
        {
          name: t("Aktivste Voice-Channels", "Most active voice channels"),
          value: topChannels.length ? clipText(topChannels.join("\n"), 900) : t("Noch keine Daten", "No data yet"),
          inline: false,
        },
        {
          name: t("Hoerzeit im Fenster", "Listening time in window"),
          value: t(
            `Zuhoerstunden: **${this.formatStatsDuration(windowSummary.totalListenerSeconds, language)}**\nVoice aktiv: **${this.formatStatsDuration(windowSummary.totalActiveSeconds, language)}**`,
            `Listener hours: **${this.formatStatsDuration(windowSummary.totalListenerSeconds, language)}**\nVoice active: **${this.formatStatsDuration(windowSummary.totalActiveSeconds, language)}**`
          ),
          inline: true,
        },
        {
          name: t("Server gesamt", "Server totals"),
          value: t(
            `Starts: **${Number(lifetime?.totalStarts || 0)}**\nStationen jemals: **${Number(lifetime?.stationCount || 0)}**\nLetzter Start: ${lifetime?.lastStartedAt ? this.formatDiscordTimestamp(lifetime.lastStartedAt, "R") : "-"}`,
            `Starts: **${Number(lifetime?.totalStarts || 0)}**\nStations ever played: **${Number(lifetime?.stationCount || 0)}**\nLast start: ${lifetime?.lastStartedAt ? this.formatDiscordTimestamp(lifetime.lastStartedAt, "R") : "-"}`
          ),
          inline: true,
        },
        {
          name: t("Top-Server global", "Top server global"),
          value: topGuild
            ? `${clipText(topGuildName, 80)} (${this.formatStatsDuration(topGuild.totalListenerSeconds || 0, language)})`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        }
      )
      .setFooter({
        text: t("OmniFM Analytics | /stats", "OmniFM analytics | /stats"),
      })
      .setTimestamp(new Date());

    const embeds = [summaryEmbed];

    if (guildTier !== "free") {
      const stationLines = analytics.stations.length
        ? analytics.stations.map((row, index) => (
          `${index + 1}. **${clipText(row.name, 70)}** - ${this.formatStatsDuration(row.listenerSeconds, language)} | ${row.starts} ${t("Starts", "starts")} | Peak ${row.peakListeners || 0}`
          + (row.lastStartedAt ? ` | ${this.formatDiscordTimestamp(row.lastStartedAt, "R")}` : "")
        )).join("\n")
        : t("Noch keine Stations-Historie vorhanden.", "No station history yet.");

      const dayLines = analytics.daily.length
        ? analytics.daily.map((row) => (
          `${row.day}: ${this.formatStatsDuration(row.listenerSeconds, language)} | ${row.starts} ${t("Starts", "starts")} | Peak ${row.peakListeners || 0}`
        )).join("\n")
        : t("Noch keine Tagesdaten vorhanden.", "No daily data yet.");

      embeds.push(
        new EmbedBuilder()
          .setColor(guildTier === "ultimate" ? 0xBD00FF : 0xFFB800)
          .setTitle(guildTier === "ultimate"
            ? t("Ultimate Analyse", "Ultimate analytics")
            : t("Pro Analyse", "Pro analytics"))
          .addFields(
            {
              name: guildTier === "ultimate"
                ? t("Stationen jemals gespielt", "Stations ever played")
                : t("Top Stationen", "Top stations"),
              value: clipText(stationLines, 1000),
              inline: false,
            },
            {
              name: t("Letzte Tage", "Recent days"),
              value: clipText(dayLines, 1000),
              inline: false,
            }
          )
          .setFooter({
            text: guildTier === "ultimate"
              ? t("Ultimate: Lifetime + 365 Tage Verlauf", "Ultimate: lifetime + 365 day trend")
              : t("Pro: Fokus auf 180 Tage Verlauf", "Pro: focused 180 day trend"),
          })
          .setTimestamp(new Date())
      );
    } else {
      summaryEmbed.addFields({
        name: t("Mehr Analytics", "More analytics"),
        value: t(
          "Pro schaltet 180-Tage-Analysen frei. Ultimate zeigt die komplette Sender-Historie, Hoerstunden und Langzeit-Trends.",
          "Pro unlocks 180-day analytics. Ultimate shows the full station archive, listener hours, and long-term trends."
        ),
        inline: false,
      });
    }

    return { embeds };
  }

  buildSongHistoryEmbed(history, guildId, playbackRuntime, language = "de") {
    const t = (de, en) => languagePick(language, de, en);
    const lines = history.map((entry, index) => {
      const unix = Number.isFinite(entry.timestampMs) ? Math.floor(entry.timestampMs / 1000) : null;
      const when = unix ? `<t:${unix}:R>` : "-";
      const title = clipText(entry.displayTitle || entry.streamTitle || "-", 150);
      const station = entry.stationName ? clipText(entry.stationName, 80) : null;
      return `${index + 1}. ${when} - **${title}**${station ? `\n${t("Station", "Station")}: ${station}` : ""}`;
    });

    const latest = history[0] || null;
    const embed = new EmbedBuilder()
      .setColor(0x3BA55D)
      .setTitle(t("🕘 Song-History", "🕘 Song history"))
      .setDescription(clipText(lines.join("\n\n"), 3800))
      .setFooter({
        text: playbackRuntime
          ? `${playbackRuntime.config?.name || BRAND.name} | ${t("letzte", "latest")} ${history.length}`
          : `${BRAND.name} | ${t("letzte", "latest")} ${history.length}`,
      })
      .setTimestamp(new Date());

    if (latest?.artworkUrl) {
      embed.setThumbnail(latest.artworkUrl);
    }

    return {
      embeds: [embed],
      components: latest
        ? this.buildTrackLinkComponents(guildId, { name: latest.stationName || latest.stationKey || "-" }, latest)
        : [],
    };
  }

  async resolveNowPlayingChannel(guildId, state) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return null;

    const me = await this.resolveBotMember(guild);
    if (!me) return null;

    const uniqueCandidateIds = getNowPlayingCandidateIds(state, guild);

    for (const candidateId of uniqueCandidateIds) {
      const channel = await this.fetchGuildChannelById(guild, candidateId);
      if (this.canSendNowPlayingToChannel(channel, me)) {
        return channel;
      }
    }

    if (!guild.channels?.cache?.size) {
      await guild.channels.fetch().catch(() => null);
    }

    const fallbackChannels = [...guild.channels.cache.values()].filter((channel) => {
      if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
        return false;
      }
      return this.canSendNowPlayingToChannel(channel, me);
    });

    fallbackChannels.sort((a, b) => this.scoreNowPlayingFallbackChannel(b) - this.scoreNowPlayingFallbackChannel(a));
    return fallbackChannels[0] || null;
  }

  buildNowPlayingEmbedLegacy(guildId, station, meta, context = {}) {
    const language = this.resolveGuildLanguage(guildId);
    const isDe = language === "de";
    const tierConfig = getTierConfig(guildId);
    const stationName = clipText(station?.name || meta?.name || "-", 120) || "-";
    const artist = clipText(this.normalizeNowPlayingValue(meta?.artist, station, meta, 120), 120);
    const title = clipText(this.normalizeNowPlayingValue(meta?.title, station, meta, 140), 140);
    const trackLabel = clipText(
      this.normalizeNowPlayingValue(meta?.displayTitle || meta?.streamTitle, station, meta, 180)
      || ([artist, title].filter(Boolean).join(" - ")),
      140
    );
    const headline = clipText(title || trackLabel || "", 110) || trackLabel;
    const streamInfo = this.normalizeNowPlayingValue(meta?.description, station, meta, 240);
    const hasTrack = Boolean(trackLabel);
    const listenerCount = Math.max(0, Number.parseInt(String(context?.listenerCount || 0), 10) || 0);
    const voiceChannelId = String(context?.channelId || "").trim();
    const workerName = clipText(String(context?.workerName || this.config.name || BRAND.name), 60) || BRAND.name;
    const metadataStatus = String(meta?.metadataStatus || (hasTrack ? "ok" : "empty")).trim().toLowerCase();
    const metadataHint = hasTrack
      ? null
      : (metadataStatus === "unsupported"
        ? (isDe
          ? "Dieser Stream sendet aktuell keine auslesbaren Song-Metadaten."
          : "This stream is not sending readable track metadata right now.")
        : (isDe
          ? "Dieser Sender liefert aktuell keine verwertbaren Song-Metadaten."
          : "This station is not providing usable track metadata right now."));
    const embed = new EmbedBuilder()
      .setColor(hasTrack ? 0x1DB954 : 0xF1C40F)
      .setTitle(isDe ? "🎵 Jetzt live" : "🎵 Live now")
      .setDescription(
        hasTrack
          ? `**${headline}**`
          : `⚠️ ${metadataHint}`
      )
      .addFields(
        {
          name: isDe ? "📻 Sender" : "📻 Station",
          value: stationName,
          inline: true,
        },
        {
          name: isDe ? "🔊 Qualität" : "🔊 Quality",
          value: tierConfig.bitrate || "-",
          inline: true,
        },
        {
          name: isDe ? "👥 Zuhörer" : "👥 Listeners",
          value: String(listenerCount),
          inline: true,
        },
        {
          name: isDe ? "🎙 Voice" : "🎙 Voice",
          value: voiceChannelId ? `<#${voiceChannelId}>` : (isDe ? "unbekannt" : "unknown"),
          inline: true,
        }
      )
      .setAuthor({
        name: `${workerName} • ${BRAND.name}`,
      })
      .setFooter({
        text: isDe
          ? `↻ Auto-Update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`
          : `↻ Auto update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`,
      })
      .setTimestamp(new Date(meta?.updatedAt || Date.now()));

    if (artist) {
      embed.addFields({ name: isDe ? "🎤 Künstler" : "🎤 Artist", value: artist, inline: true });
    }
    if (title) {
      embed.addFields({ name: isDe ? "📝 Titel" : "📝 Title", value: title, inline: true });
    }
    if (streamInfo) {
      embed.addFields({ name: isDe ? "ℹ Stream-Info" : "ℹ Stream info", value: streamInfo, inline: false });
    }
    if (!hasTrack) {
      embed.addFields({
        name: isDe ? "🧭 Hinweis" : "🧭 Note",
        value: isDe
          ? "Der Stream laeuft normal weiter. Sobald der Radiosender wieder Metadaten liefert, aktualisiert OmniFM die Einbettung automatisch."
          : "The stream continues normally. As soon as the station sends metadata again, OmniFM updates the embed automatically.",
        inline: false,
      });
    }
    if (meta?.artworkUrl) {
      embed.setThumbnail(meta.artworkUrl);
    }

    const sourceSummary = this.buildNowPlayingSourceSummary(language, meta, hasTrack);
    const visibleListenerCount = listenerCount >= 2 ? String(listenerCount) : null;
    const descriptionLines = [];
    if (hasTrack) {
      descriptionLines.push(`**${headline}**`);
      if (sourceSummary.sourceNote) {
        descriptionLines.push(`_${sourceSummary.sourceNote}_`);
      }
    } else {
      descriptionLines.push(`\u26a0\ufe0f ${sourceSummary.metadataHint}`);
    }

    const summaryLines = [
      `**${isDe ? "\u{1f4fb} Sender" : "\u{1f4fb} Station"}**: ${stationName}`,
      `**${isDe ? "\u{1f50a} Qualit\u00e4t" : "\u{1f50a} Quality"}**: ${tierConfig.bitrate || "-"}`,
      `**${isDe ? "\u{1f9e0} Quelle" : "\u{1f9e0} Source"}**: ${sourceSummary.sourceDetail || sourceSummary.sourceLabel}`,
    ];
    const stableFields = [
      {
        name: isDe ? "\u{1f4ca} Stream" : "\u{1f4ca} Stream",
        value: summaryLines.join("\n"),
        inline: false,
      },
    ];

    const trackLines = [];
    if (artist) {
      trackLines.push(`**${isDe ? "\u{1f3a4} K\u00fcnstler" : "\u{1f3a4} Artist"}**: ${artist}`);
    }
    if (title) {
      trackLines.push(`**${isDe ? "\u{1f4dd} Titel" : "\u{1f4dd} Title"}**: ${title}`);
    }
    if (album) {
      trackLines.push(`**\u{1f4bf} Album**: ${album}`);
    }
    if (trackLines.length) {
      stableFields.push({
        name: hasTrack ? (isDe ? "\u{1f3b6} Track-Infos" : "\u{1f3b6} Track details") : (isDe ? "\u{1f3b6} Erkannt" : "\u{1f3b6} Recognized"),
        value: trackLines.join("\n"),
        inline: false,
      });
    }

    const voiceLines = [];
    if (voiceChannelId) {
      voiceLines.push(`**${isDe ? "\u{1f39b} L\u00e4uft in" : "\u{1f39b} Running in"}**: <#${voiceChannelId}>`);
    }
    if (visibleListenerCount) {
      voiceLines.push(`**${isDe ? "\u{1f465} H\u00f6ren gerade" : "\u{1f465} Listening now"}**: ${visibleListenerCount}`);
    }
    if (voiceLines.length) {
      stableFields.push({
        name: isDe ? "\u{1f50a} Wiedergabe" : "\u{1f50a} Playback",
        value: voiceLines.join("\n"),
        inline: false,
      });
    }

    if (streamInfo) {
      stableFields.push({
        name: isDe ? "\u2139\ufe0f Stream-Info" : "\u2139\ufe0f Stream info",
        value: streamInfo,
        inline: false,
      });
    }
    if (!hasTrack) {
      stableFields.push({
        name: isDe ? "\u{1f9ed} Hinweis" : "\u{1f9ed} Note",
        value: isDe
          ? "Der Stream l\u00e4uft normal weiter. OmniFM versucht weiterhin zuerst Sender-Metadaten und danach den Fingerprint-Fallback."
          : "The stream continues normally. OmniFM keeps trying station metadata first and then the fingerprint fallback.",
        inline: false,
      });
    }

    const stableFooterParts = [
      workerName,
      isDe ? `Auto-Update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s` : `Auto update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`,
    ];
    if (sourceSummary.metadataSource.includes("recognition")) {
      stableFooterParts.push(isDe ? "Fingerprint-Fallback" : "Fingerprint fallback");
    }

    embed
      .setColor(!hasTrack ? 0xF1C40F : (sourceSummary.metadataSource.includes("recognition") ? 0x5865F2 : 0x1DB954))
      .setTitle(isDe ? "\u{1f3b5} Jetzt live" : "\u{1f3b5} Live now")
      .setDescription(descriptionLines.join("\n"))
      .setAuthor({
        name: workerName,
        iconURL: this.client.user?.displayAvatarURL?.({ extension: "png", size: 128 }) || undefined,
      })
      .setFooter({
        text: stableFooterParts.join(" | "),
      });

    const existingFieldCount = Array.isArray(embed.data?.fields) ? embed.data.fields.length : 0;
    if (existingFieldCount > 0) {
      embed.spliceFields(0, existingFieldCount, ...stableFields);
    } else if (stableFields.length > 0) {
      embed.addFields(...stableFields);
    }

    return embed;
  }

  buildNowPlayingEmbed(guildId, station, meta, context = {}) {
    const language = this.resolveGuildLanguage(guildId);
    const isDe = language === "de";
    const tierConfig = getTierConfig(guildId);
    const stationName = clipText(station?.name || meta?.name || "-", 120) || "-";
    const artist = clipText(this.normalizeNowPlayingValue(meta?.artist, station, meta, 120), 120);
    const title = clipText(this.normalizeNowPlayingValue(meta?.title, station, meta, 140), 140);
    const album = clipText(this.normalizeNowPlayingValue(meta?.album, station, meta, 140), 140);
    const trackLabel = clipText(
      this.normalizeNowPlayingValue(meta?.displayTitle || meta?.streamTitle, station, meta, 180)
      || ([artist, title].filter(Boolean).join(" - ")),
      140
    );
    const headline = clipText(title || trackLabel || "", 110) || trackLabel;
    const streamInfo = this.normalizeNowPlayingValue(meta?.description, station, meta, 240);
    const hasTrack = Boolean(trackLabel);
    const listenerCount = Math.max(0, Number.parseInt(String(context?.listenerCount || 0), 10) || 0);
    const voiceChannelId = String(context?.channelId || "").trim();
    const workerName = clipText(String(context?.workerName || this.config.name || BRAND.name), 60) || BRAND.name;
    const metadataSource = String(meta?.metadataSource || "").trim().toLowerCase();
    const metadataStatus = String(meta?.metadataStatus || (hasTrack ? "ok" : "empty")).trim().toLowerCase();
    const recognitionConfidence = Number.parseFloat(String(meta?.recognitionConfidence ?? ""));
    const sourceLabel = metadataSource.includes("recognition")
      ? (isDe ? "Audio-Fingerprint" : "Audio fingerprint")
      : (metadataSource === "icy"
        ? (isDe ? "Sender-Metadaten" : "Station metadata")
        : (metadataSource === "stream"
          ? (isDe ? "Stream-Info" : "Stream info")
          : (isDe ? "Unbekannt" : "Unknown")));
    const sourceDetail = metadataSource.includes("recognition")
      ? [
          meta?.recognitionProvider || "AcoustID",
          Number.isFinite(recognitionConfidence) ? `${Math.round(recognitionConfidence * 100)}%` : "",
        ].filter(Boolean).join(" | ")
      : sourceLabel;
    const metadataHint = hasTrack
      ? null
      : (metadataStatus === "unsupported"
        ? (isDe
          ? "Dieser Stream sendet aktuell keine auslesbaren Songdaten."
          : "This stream is not sending readable track metadata right now.")
        : (isDe
          ? "Dieser Sender liefert aktuell keine verwertbaren Songdaten."
          : "This station is not providing usable track metadata right now."));
    const footerParts = [
      isDe
        ? `↻ Auto-Update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`
        : `↻ Auto update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`,
    ];
    if (metadataSource.includes("recognition")) {
      footerParts.push(isDe ? "Fingerprint aktiv" : "Fingerprint active");
    }

    const embed = new EmbedBuilder()
      .setColor(hasTrack ? 0x1DB954 : 0xF1C40F)
      .setTitle(isDe ? "🎵 Jetzt live" : "🎵 Live now")
      .setDescription(
        hasTrack
          ? `**${headline}**`
          : `⚠️ ${metadataHint}`
      )
      .addFields(
        {
          name: isDe ? "📻 Sender" : "📻 Station",
          value: stationName,
          inline: true,
        },
        {
          name: isDe ? "🔊 Qualität" : "🔊 Quality",
          value: tierConfig.bitrate || "-",
          inline: true,
        },
        {
          name: isDe ? "👥 Zuhörer" : "👥 Listeners",
          value: String(listenerCount),
          inline: true,
        },
        {
          name: "🎙 Voice",
          value: voiceChannelId ? `<#${voiceChannelId}>` : (isDe ? "unbekannt" : "unknown"),
          inline: true,
        },
        {
          name: isDe ? "🧠 Quelle" : "🧠 Source",
          value: sourceDetail || sourceLabel,
          inline: true,
        }
      )
      .setAuthor({
        name: `${workerName} • ${BRAND.name}`,
      })
      .setFooter({
        text: footerParts.join(" | "),
      })
      .setTimestamp(new Date(meta?.updatedAt || Date.now()));

    if (artist) {
      embed.addFields({ name: isDe ? "🎤 Artist" : "🎤 Artist", value: artist, inline: true });
    }
    if (title) {
      embed.addFields({ name: isDe ? "📝 Titel" : "📝 Title", value: title, inline: true });
    }
    if (album) {
      embed.addFields({ name: isDe ? "💿 Album" : "💿 Album", value: album, inline: true });
    }
    if (streamInfo) {
      embed.addFields({ name: isDe ? "ℹ Stream-Info" : "ℹ Stream info", value: streamInfo, inline: false });
    }
    if (!hasTrack) {
      embed.addFields({
        name: isDe ? "🧭 Hinweis" : "🧭 Note",
        value: isDe
          ? "Der Stream läuft normal weiter. Sobald der Radiosender wieder Metadaten liefert oder die Audio-Erkennung greift, aktualisiert OmniFM die Einbettung automatisch."
          : "The stream continues normally. As soon as the station sends metadata again or audio recognition succeeds, OmniFM updates the embed automatically.",
        inline: false,
      });
    }
    if (meta?.artworkUrl) {
      embed.setThumbnail(meta.artworkUrl);
    }

    const sourceSummary = this.buildNowPlayingSourceSummary(language, meta, hasTrack);
    const visibleListenerCount = listenerCount >= 2 ? String(listenerCount) : null;
    const descriptionLines = [];
    if (hasTrack) {
      descriptionLines.push(`**${headline}**`);
      if (sourceSummary.sourceNote) {
        descriptionLines.push(`_${sourceSummary.sourceNote}_`);
      }
    } else {
      descriptionLines.push(`\u26a0\ufe0f ${sourceSummary.metadataHint}`);
    }

    const stableFields = [
      {
        name: isDe ? "\u{1f4fb} Sender" : "\u{1f4fb} Station",
        value: stationName,
        inline: true,
      },
      {
        name: isDe ? "\u{1f50a} Qualit\u00e4t" : "\u{1f50a} Quality",
        value: tierConfig.bitrate || "-",
        inline: true,
      },
      {
        name: isDe ? "\u{1f9e0} Quelle" : "\u{1f9e0} Source",
        value: sourceSummary.sourceDetail || sourceSummary.sourceLabel,
        inline: true,
      },
    ];

    if (voiceChannelId) {
      stableFields.push({
        name: isDe ? "\u{1f39b} L\u00e4uft in" : "\u{1f39b} Running in",
        value: `<#${voiceChannelId}>`,
        inline: true,
      });
    }
    if (visibleListenerCount) {
      stableFields.push({
        name: isDe ? "\u{1f465} H\u00f6ren gerade" : "\u{1f465} Listening now",
        value: visibleListenerCount,
        inline: true,
      });
    }
    if (artist) {
      stableFields.push({
        name: isDe ? "\u{1f3a4} K\u00fcnstler" : "\u{1f3a4} Artist",
        value: artist,
        inline: true,
      });
    }
    if (title) {
      stableFields.push({
        name: isDe ? "\u{1f4dd} Titel" : "\u{1f4dd} Title",
        value: title,
        inline: true,
      });
    }
    if (album) {
      stableFields.push({
        name: "\u{1f4bf} Album",
        value: album,
        inline: true,
      });
    }
    if (streamInfo) {
      stableFields.push({
        name: isDe ? "\u2139\ufe0f Stream-Info" : "\u2139\ufe0f Stream info",
        value: streamInfo,
        inline: false,
      });
    }
    if (!hasTrack) {
      stableFields.push({
        name: isDe ? "\u{1f9ed} Hinweis" : "\u{1f9ed} Note",
        value: isDe
          ? "Der Stream l\u00e4uft normal weiter. OmniFM versucht weiterhin zuerst Sender-Metadaten und danach den Fingerprint-Fallback."
          : "The stream continues normally. OmniFM keeps trying station metadata first and then the fingerprint fallback.",
        inline: false,
      });
    }

    const stableFooterParts = [
      workerName,
      isDe ? `Auto-Update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s` : `Auto update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`,
    ];
    if (sourceSummary.metadataSource.includes("recognition")) {
      stableFooterParts.push(isDe ? "Fingerprint-Fallback" : "Fingerprint fallback");
    }

    embed
      .setColor(!hasTrack ? 0xF1C40F : (sourceSummary.metadataSource.includes("recognition") ? 0x5865F2 : 0x1DB954))
      .setTitle(isDe ? "\u{1f3b5} Jetzt live" : "\u{1f3b5} Live now")
      .setDescription(descriptionLines.join("\n"))
      .setAuthor({
        name: workerName,
        iconURL: this.client.user?.displayAvatarURL?.({ extension: "png", size: 128 }) || undefined,
      })
      .setFooter({
        text: stableFooterParts.join(" | "),
      });

    const existingFieldCount = Array.isArray(embed.data?.fields) ? embed.data.fields.length : 0;
    if (existingFieldCount > 0) {
      embed.spliceFields(0, existingFieldCount, ...stableFields);
    } else if (stableFields.length > 0) {
      embed.addFields(...stableFields);
    }

    return embed;
  }

  buildNowPlayingMessagePayload(guildId, station, meta, context = {}) {
    return {
      embeds: [this.buildNowPlayingEmbed(guildId, station, meta, context)],
      components: this.buildTrackLinkComponents(guildId, station, meta),
      allowedMentions: { parse: [] },
    };
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

  async upsertNowPlayingMessage(guildId, state, payload, channelOverride = null) {
    const channel = channelOverride || await this.resolveNowPlayingChannel(guildId, state);
    if (!channel) return false;

    if (state.nowPlayingChannelId && state.nowPlayingChannelId !== channel.id) {
      this.markNowPlayingTargetDirty(guildId, state, channel.id);
    }
    state.nowPlayingChannelId = channel.id;

    const messagePayload = {
      embeds: [],
      allowedMentions: { parse: [] },
      components: [],
    };
    if (Array.isArray(payload?.embeds)) {
      messagePayload.embeds = payload.embeds;
    }
    if (Array.isArray(payload?.components)) {
      messagePayload.components = payload.components;
    }

    if (state.nowPlayingMessageId && channel.messages?.fetch) {
      const existing = await channel.messages.fetch(state.nowPlayingMessageId).catch(() => null);
      if (existing?.edit) {
        try {
          await existing.edit(messagePayload);
          return true;
        } catch (err) {
          this.logNowPlayingIssue(
            guildId,
            state,
            `Edit fehlgeschlagen in #${channel.name || channel.id}: ${clipText(err?.message || String(err), 160)}`
          );
          state.nowPlayingMessageId = null;
        }
      }
    }

    try {
      const sent = await channel.send(messagePayload);
      if (sent?.id) {
        state.nowPlayingMessageId = sent.id;
      }
      return true;
    } catch (err) {
      this.logNowPlayingIssue(
        guildId,
        state,
        `Senden fehlgeschlagen in #${channel.name || channel.id}: ${clipText(err?.message || String(err), 160)}`
      );
      return false;
    }
  }

  async deleteNowPlayingMessage(guildId, state) {
    if (!state) return false;

    const channelId = String(state.nowPlayingChannelId || "").trim();
    const messageId = String(state.nowPlayingMessageId || "").trim();
    state.nowPlayingMessageId = null;
    state.nowPlayingChannelId = null;
    state.nowPlayingSignature = null;

    if (!channelId || !messageId) return false;

    const guild = this.client.guilds.cache.get(guildId);
    let channel = guild?.channels?.cache?.get(channelId) || null;
    if (!channel && guild?.channels?.fetch) {
      channel = await guild.channels.fetch(channelId).catch(() => null);
    }
    if (!channel?.messages?.fetch) return false;

    const existing = await channel.messages.fetch(messageId).catch(() => null);
    if (!existing?.delete) return false;

    try {
      await existing.delete();
      return true;
    } catch (err) {
      const code = Number(err?.code || err?.rawError?.code || 0);
      if (code === 10008 || code === 10003) {
        return false;
      }
      this.logNowPlayingIssue(
        guildId,
        state,
        `Loeschen fehlgeschlagen in #${channel.name || channel.id}: ${clipText(err?.message || String(err), 160)}`
      );
      return false;
    }
  }

  queueDeleteNowPlayingMessage(guildId, state) {
    this.deleteNowPlayingMessage(guildId, state).catch((err) => {
      this.logNowPlayingIssue(
        guildId,
        state,
        `Cleanup fehlgeschlagen: ${clipText(err?.message || String(err), 160)}`
      );
    });
  }

  async updateNowPlayingEmbed(guildId, state, { force = false } = {}) {
    if (!NOW_PLAYING_ENABLED) return;
    if (!state.currentStationKey) return;
    if (!state.connection) return;
    const channel = await this.resolveNowPlayingChannel(guildId, state);
    if (!channel) {
      if (String(state.nowPlayingChannelId || "").trim() && String(state.nowPlayingMessageId || "").trim()) {
        this.queueDeleteNowPlayingMessage(guildId, state);
      }
      state.nowPlayingSignature = null;
      this.logNowPlayingIssue(guildId, state, "Kein geeigneter Kanal fuer die Live-Einbettung gefunden.");
      return;
    }

    const stationKey = state.currentStationKey;
    const resolvedStation = this.getResolvedCurrentStation(guildId, state);
    const station = resolvedStation?.station || null;
    if (!station?.url) return;

    try {
      const snapshot = await fetchStreamSnapshot(station.url, { includeCover: NOW_PLAYING_COVER_ENABLED });
      if (state.currentStationKey !== stationKey) return;

      const previousMeta = state.currentMeta || {};
      const artist = this.normalizeNowPlayingValue(snapshot.artist, station, snapshot, 120);
      const title = this.normalizeNowPlayingValue(snapshot.title, station, snapshot, 120);
      const streamTitle = this.normalizeNowPlayingValue(snapshot.streamTitle, station, snapshot, 180);
      const displayTitle = this.normalizeNowPlayingValue(snapshot.displayTitle || snapshot.streamTitle, station, snapshot, 180)
        || ([artist, title].filter(Boolean).join(" - ") || null);
      const hasFreshTrack = Boolean(displayTitle || artist || title);
      const keepPreviousTrack = !hasFreshTrack && this.isFreshNowPlayingTrack(previousMeta);
      const sameTrackAsPrevious = Boolean(
        displayTitle
        && String(previousMeta.displayTitle || "").trim()
        && displayTitle.toLowerCase() === String(previousMeta.displayTitle || "").trim().toLowerCase()
      );

      const nextMeta = {
        name: this.normalizeNowPlayingValue(snapshot.name, station, snapshot, 120) || previousMeta?.name || station.name || stationKey,
        description: this.normalizeNowPlayingValue(snapshot.description, station, snapshot, 240) || previousMeta?.description || null,
        streamTitle: streamTitle || (keepPreviousTrack ? previousMeta.streamTitle || null : null),
        artist: artist || (keepPreviousTrack ? previousMeta.artist || null : null),
        title: title || (keepPreviousTrack ? previousMeta.title || null : null),
        displayTitle: displayTitle || (keepPreviousTrack ? previousMeta.displayTitle || null : null),
        artworkUrl: snapshot.artworkUrl || ((keepPreviousTrack || sameTrackAsPrevious) ? previousMeta.artworkUrl || null : null),
        album: this.normalizeNowPlayingValue(snapshot.album, station, snapshot, 120) || (keepPreviousTrack ? previousMeta.album || null : null),
        metadataSource: snapshot.metadataSource || previousMeta.metadataSource || null,
        metadataStatus: hasFreshTrack
          ? (snapshot.metadataStatus || "ok")
          : (keepPreviousTrack ? previousMeta.metadataStatus || "ok" : (snapshot.metadataStatus || "empty")),
        recognitionProvider: snapshot.recognitionProvider || (keepPreviousTrack ? previousMeta.recognitionProvider || null : null),
        recognitionConfidence: Number.isFinite(Number(snapshot.recognitionConfidence))
          ? Number(snapshot.recognitionConfidence)
          : (keepPreviousTrack && Number.isFinite(Number(previousMeta.recognitionConfidence))
            ? Number(previousMeta.recognitionConfidence)
            : null),
        musicBrainzRecordingId: snapshot.musicBrainzRecordingId || (keepPreviousTrack ? previousMeta.musicBrainzRecordingId || null : null),
        musicBrainzReleaseId: snapshot.musicBrainzReleaseId || (keepPreviousTrack ? previousMeta.musicBrainzReleaseId || null : null),
        updatedAt: new Date().toISOString(),
        trackDetectedAtMs: hasFreshTrack
          ? Date.now()
          : (keepPreviousTrack ? Number.parseInt(String(previousMeta.trackDetectedAtMs || 0), 10) || 0 : 0),
      };
      state.currentMeta = nextMeta;
      this.recordSongHistory(guildId, state, station, nextMeta);

      const signature = buildNowPlayingSignature(stationKey, nextMeta, state, channel.id);

      if (!force && signature === state.nowPlayingSignature) {
        return;
      }

      const payload = this.buildNowPlayingMessagePayload(guildId, station, nextMeta, {
        channelId: state.connection?.joinConfig?.channelId || state.lastChannelId || null,
        listenerCount: this.getCurrentListenerCount(guildId, state),
        workerName: this.config.name,
      });
      const sent = await this.upsertNowPlayingMessage(guildId, state, payload, channel);
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
    if (!state.currentStationKey) return;

    const taskId = `guild-${guildId}-nowplaying`;
    const update = async () => {
      this.flushListeningStatsSample(guildId, state);
      if (!NOW_PLAYING_ENABLED) return;
      try {
        await this.updateNowPlayingEmbed(guildId, state);
      } catch (err) {
        this.logNowPlayingIssue(guildId, state, clipText(err?.message || String(err), 200));
      }
    };

    // Enqueue first update immediately
    this.nowPlayingQueue.enqueue(taskId, update);

    // Schedule recurring updates with jitter to spread load
    const scheduleNextUpdate = () => {
      if (!state.currentStationKey) return; // Stop if station changed

      const jitterMs = applyJitter(NOW_PLAYING_POLL_MS, 0.2); // ±20% jitter
      state.nowPlayingRefreshTimer = setTimeout(() => {
        this.nowPlayingQueue.enqueue(taskId, update);
        scheduleNextUpdate(); // Reschedule next
      }, jitterMs);
    };

    scheduleNextUpdate();
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
    if (this.isScheduledEventStopDue(state.activeScheduledEventStopAtMs, now)) {
      log(
        "INFO",
        `[${this.config.name}] Geplantes Event-Ende erreicht, Stream wird gestoppt (guild=${guildId}, event=${state.activeScheduledEventId || "-"})`
      );
      this.stopInGuild(guildId);
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

    if (guildId && state.currentStationKey) {
      this.flushListeningStatsSample(guildId, state);
    }
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
    state.lastListenerStatsSampleAt = state.lastStreamStartAt;
    state.lastProcessExitCode = null;
    state.lastProcessExitAt = 0;
    this.armStreamStabilityReset(guildId, state);
    this.updatePresence();
    this.persistState();
    this.startNowPlayingLoop(guildId, state);
    this.syncVoiceChannelStatus(guildId, state.currentStationName || station.name || key).catch(() => null);
    recordStationStart(guildId, {
      stationKey: key,
      stationName: state.currentStationName || station.name || key,
      channelId: state.connection?.joinConfig?.channelId || state.lastChannelId || "",
      channelName: this.getVoiceChannelDisplayName(guildId, state.connection?.joinConfig?.channelId || state.lastChannelId || ""),
      listenerCount: this.getCurrentListenerCount(guildId, state),
      timestampMs: state.lastStreamStartAt,
    });

    fetchStreamInfo(station.url)
      .then((meta) => {
        if (state.currentStationKey === key) {
          const prevMeta = state.currentMeta || {};
          const artist = this.normalizeNowPlayingValue(meta.artist, station, meta, 120);
          const title = this.normalizeNowPlayingValue(meta.title, station, meta, 120);
          const streamTitle = this.normalizeNowPlayingValue(meta.streamTitle, station, meta, 180);
          const displayTitle = this.normalizeNowPlayingValue(meta.displayTitle || meta.streamTitle, station, meta, 180)
            || ([artist, title].filter(Boolean).join(" - ") || null);
          const hasTrack = Boolean(displayTitle || artist || title);
          state.currentMeta = {
            ...prevMeta,
            name: this.normalizeNowPlayingValue(meta.name, station, meta, 120) || prevMeta.name || station.name || key,
            description: this.normalizeNowPlayingValue(meta.description, station, meta, 240) || prevMeta.description || null,
            streamTitle: streamTitle || prevMeta.streamTitle || null,
            artist: artist || prevMeta.artist || null,
            title: title || prevMeta.title || null,
            displayTitle: displayTitle || prevMeta.displayTitle || null,
            album: this.normalizeNowPlayingValue(meta.album, station, meta, 120) || prevMeta.album || null,
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
          this.recordSongHistory(guildId, state, station, state.currentMeta);
        }
      })
      .catch(() => {
        // ignore metadata lookup errors
      });
  }

  async restartCurrentStation(state, guildId) {
    if (!state.shouldReconnect || !state.currentStationKey) return;
    if (this.isScheduledEventStopDue(state.activeScheduledEventStopAtMs)) {
      this.stopInGuild(guildId);
      return;
    }

    const resolvedStation = this.getResolvedCurrentStation(guildId, state);
    const key = state.currentStationKey;
    if (!resolvedStation?.stations || !resolvedStation?.station) {
      this.clearNowPlayingTimer(state);
      this.queueDeleteNowPlayingMessage(guildId, state);
      state.currentStationKey = null;
      state.currentFallbackKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.nowPlayingSignature = null;
      state.lastListenerStatsSampleAt = 0;
      this.clearScheduledEventPlayback(state);
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
      state.currentStationKey = resolvedStation.key;
      state.currentStationName = resolvedStation.station.name || resolvedStation.key;
      await this.playStation(state, resolvedStation.stations, resolvedStation.key, guildId);
      log("INFO", `[${this.config.name}] Stream restarted: ${resolvedStation.key}`);
    } catch (err) {
      state.lastStreamErrorAt = new Date().toISOString();
      log("ERROR", `[${this.config.name}] Auto-restart error for ${key}: ${err.message}`);

      const fallback = this.resolvePlaybackFallback(guildId, resolvedStation.key, state.currentFallbackKey);
      if (fallback?.ok) {
        try {
          await this.playStation(state, fallback.stations, fallback.key, guildId);
          state.currentFallbackKey = fallback.key;
          log("INFO", `[${this.config.name}] Fallback to ${fallback.key} after restart failure (${fallback.source})`);
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

  renderVoiceStatusText(stationName) {
    const station = clipText(String(stationName || "").trim(), 60) || "Radio";
    const botName = clipText(String(this.config?.name || BRAND.name || "OmniFM"), 24);
    const raw = VOICE_CHANNEL_STATUS_TEMPLATE
      .replace(/\{station\}/gi, station)
      .replace(/\{bot\}/gi, botName)
      .trim();
    if (!raw) return "";
    return clipText(raw, VOICE_CHANNEL_STATUS_MAX_LENGTH);
  }

  async syncVoiceChannelStatus(guildId, stationName = "") {
    if (!VOICE_CHANNEL_STATUS_ENABLED) return;
    const state = this.guildState.get(guildId);
    if (!state) return;

    const channelId = String(state.connection?.joinConfig?.channelId || state.lastChannelId || "").trim();
    if (!/^\d{17,22}$/.test(channelId)) return;
    const guild = this.client.guilds.cache.get(guildId) || null;
    const channel = (guild?.channels?.cache?.get(channelId))
      || await guild?.channels?.fetch?.(channelId).catch(() => null)
      || null;
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      state.voiceStatusText = "";
      return;
    }
    const desired = stationName ? this.renderVoiceStatusText(stationName) : "";
    if (desired === String(state.voiceStatusText || "")) return;

    try {
      const route = `/channels/${channelId}/voice-status`;
      if (desired) {
        await this.rest.put(route, { body: { status: desired } });
      } else {
        try {
          await this.rest.delete(route);
        } catch {
          await this.rest.put(route, { body: { status: "" } });
        }
      }
      state.voiceStatusText = desired;
      state.lastVoiceStatusErrorAt = 0;
    } catch (err) {
      const now = Date.now();
      if (!state.lastVoiceStatusErrorAt || now - state.lastVoiceStatusErrorAt > 60_000) {
        log("WARN", `[${this.config.name}] Voice-Status konnte nicht gesetzt werden (guild=${guildId}): ${err?.message || err}`);
      }
      state.lastVoiceStatusErrorAt = now;
    }
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
      if (state.lastChannelId !== newChannelId) {
        this.markNowPlayingTargetDirty(guildId, state, newChannelId);
      }
      state.lastChannelId = newChannelId;
      if (state.reconnectTimer) {
        this.clearReconnectTimer(state);
        state.reconnectAttempts = 0;
      }
      this.persistState();
      this.queueVoiceStateReconcile(guildId, "voice-state-update", 1500);
      return;
    }

    // Bot hat Voice verlassen
    if (!oldChannelId) return;

    const shouldAutoReconnect = Boolean(state.shouldReconnect && state.currentStationKey && state.lastChannelId);
    const preserveReconnectTimer = Boolean(shouldAutoReconnect && state.reconnectTimer);
    this.resetVoiceSession(guildId, state, {
      preservePlaybackTarget: shouldAutoReconnect,
      clearLastChannel: !shouldAutoReconnect,
      preserveReconnectTimer,
    });

    // Auto-reconnect: schedule if we should reconnect and had an active station
    if (shouldAutoReconnect) {
      if (state.reconnectTimer) {
        log(
          "INFO",
          `[${this.config.name}] Voice lost (Guild ${guildId}, Channel ${oldChannelId}). Reconnect bereits geplant.`
        );
        return;
      }
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
    this.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
  }

  resetVoiceSession(
    guildId,
    state,
    { preservePlaybackTarget = false, clearLastChannel = false, preserveReconnectTimer = false } = {},
  ) {
    if (!state) return;
    this.clearQueuedVoiceReconcile(guildId);
    this.finishVoiceConnectionAttempt(state);
    this.flushListeningStatsSample(guildId, state);

    if (state.connection) {
      try { state.connection.destroy(); } catch {}
      state.connection = null;
    }

    state.player.stop();
    this.clearCurrentProcess(state);
    if (preserveReconnectTimer) {
      if (state.streamRestartTimer) {
        clearTimeout(state.streamRestartTimer);
        state.streamRestartTimer = null;
      }
      this.clearStreamStabilityTimer(state);
    } else {
      this.clearReconnectTimer(state);
    }
    this.clearNowPlayingTimer(state);
    this.syncVoiceChannelStatus(guildId, "").catch(() => null);
    if (String(state.nowPlayingChannelId || "").trim() && String(state.nowPlayingMessageId || "").trim()) {
      this.queueDeleteNowPlayingMessage(guildId, state);
    }
    state.nowPlayingSignature = null;

    if (!preservePlaybackTarget) {
      state.currentStationKey = null;
      state.currentFallbackKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.nowPlayingMessageId = null;
      state.nowPlayingChannelId = null;
      this.clearScheduledEventPlayback(state);
    }

    if (clearLastChannel) {
      state.lastChannelId = null;
    }

    if (!preservePlaybackTarget) {
      state.reconnectAttempts = 0;
      state.streamErrorCount = 0;
      state.lastListenerStatsSampleAt = 0;
    }

    this.updatePresence();
    this.persistState();
  }

  clearQueuedVoiceReconcile(guildId) {
    const key = String(guildId || "").trim();
    const timer = this.pendingVoiceReconcileTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.pendingVoiceReconcileTimers.delete(key);
    }
  }

  queueVoiceStateReconcile(guildId, reason = "queued", delayMs = 1200) {
    const key = String(guildId || "").trim();
    if (!key) return;
    this.clearQueuedVoiceReconcile(key);
    const timer = setTimeout(() => {
      this.pendingVoiceReconcileTimers.delete(key);
      this.reconcileGuildVoiceState(key, { reason }).catch((err) => {
        log("WARN", `[${this.config.name}] Voice-State-Reconcile (${reason}) fehlgeschlagen guild=${key}: ${err?.message || err}`);
      });
    }, Math.max(0, delayMs));
    if (typeof timer?.unref === "function") {
      timer.unref();
    }
    this.pendingVoiceReconcileTimers.set(key, timer);
  }

  async confirmBotVoiceChannel(guildId, expectedChannelId, { timeoutMs = 10_000, intervalMs = 800 } = {}) {
    const normalizedGuildId = String(guildId || "").trim();
    const normalizedChannelId = String(expectedChannelId || "").trim();
    if (!normalizedGuildId || !normalizedChannelId) return false;

    const startedAt = Date.now();
    while ((Date.now() - startedAt) <= Math.max(intervalMs, timeoutMs)) {
      const { channelId } = await this.fetchBotVoiceState(normalizedGuildId);
      if (String(channelId || "").trim() === normalizedChannelId) {
        return true;
      }
      await waitMs(intervalMs);
    }
    return false;
  }

  async fetchBotVoiceState(guildId) {
    const guild = this.client.guilds.cache.get(guildId) || await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return { guild: null, voiceState: null, channelId: null };

    try {
      const voiceState = await guild.voiceStates.fetch("@me", { force: true, cache: true });
      return { guild, voiceState, channelId: voiceState?.channelId || null };
    } catch {
      return { guild, voiceState: null, channelId: null };
    }
  }

  async reconcileGuildVoiceState(guildId, { reason = "periodic" } = {}) {
    if (!this.client.isReady()) return;
    const state = this.guildState.get(guildId);
    if (!state) return;
    if (!state.connection && !state.currentStationKey && !state.lastChannelId) return;
    const connectAttemptActive = this.isVoiceConnectionAttemptActive(state);

    const { channelId: actualChannelId } = await this.fetchBotVoiceState(guildId);
    const expectedChannelId = state.connection?.joinConfig?.channelId || state.lastChannelId || null;

    if (actualChannelId && state.lastChannelId !== actualChannelId) {
      this.markNowPlayingTargetDirty(guildId, state, actualChannelId);
      state.lastChannelId = actualChannelId;
      this.persistState();
    }

    if (connectAttemptActive) {
      const pendingChannelId = String(state.connectingVoiceChannelId || expectedChannelId || "").trim();
      if (!actualChannelId) {
        return;
      }
      if (!pendingChannelId || actualChannelId === pendingChannelId) {
        return;
      }
    }

    if (!actualChannelId) {
      const shouldReconnect = Boolean(state.shouldReconnect && state.currentStationKey && state.lastChannelId);
      if (!state.connection && !state.currentProcess && !shouldReconnect) return;
      if (!state.connection && shouldReconnect && state.reconnectTimer) {
        return;
      }

      log(
        "WARN",
        `[${this.config.name}] Voice-State abweichend erkannt (guild=${guildId}, expected=${expectedChannelId || "-"}, reason=${reason}).`
      );
      this.resetVoiceSession(guildId, state, {
        preservePlaybackTarget: shouldReconnect,
        clearLastChannel: !shouldReconnect,
      });
      if (shouldReconnect) {
        this.scheduleReconnect(guildId, { resetAttempts: true, reason: `voice-state-${reason}` });
      }
      return;
    }

    if (expectedChannelId && actualChannelId !== expectedChannelId) {
      log(
        "INFO",
        `[${this.config.name}] Voice-Channel-Mismatch korrigiert (guild=${guildId}, expected=${expectedChannelId}, actual=${actualChannelId}, reason=${reason}).`
      );
      this.markNowPlayingTargetDirty(guildId, state, actualChannelId);
      state.lastChannelId = actualChannelId;
      if (state.connection?.joinConfig?.channelId && state.connection.joinConfig.channelId !== actualChannelId) {
        this.resetVoiceSession(guildId, state, { preservePlaybackTarget: true, clearLastChannel: false });
        this.scheduleReconnect(guildId, { resetAttempts: true, reason: "voice-channel-mismatch" });
        return;
      }
      this.persistState();
    }

    if (!state.connection && state.currentStationKey && state.lastChannelId) {
      if (state.reconnectTimer) return;
      this.scheduleReconnect(guildId, { resetAttempts: true, reason: `voice-no-local-connection-${reason}` });
      return;
    }

    if (state.currentStationKey && state.player.state.status === AudioPlayerStatus.Idle && !state.streamRestartTimer && !state.reconnectTimer) {
      this.scheduleStreamRestart(guildId, state, 750, `voice-health-${reason}`);
    }
  }

  async tickVoiceStateHealth() {
    if (!VOICE_STATE_RECONCILE_ENABLED) return;
    if (!this.client.isReady()) return;

    for (const guildId of this.guildState.keys()) {
      // eslint-disable-next-line no-await-in-loop
      await this.reconcileGuildVoiceState(guildId, { reason: "timer" });
    }
  }

  startVoiceStateReconciler() {
    if (!VOICE_STATE_RECONCILE_ENABLED) return;
    if (this.voiceHealthTimer) return;

    const run = () => {
      this.tickVoiceStateHealth().catch((err) => {
        log("ERROR", `[${this.config.name}] Voice-State-Reconcile Fehler: ${err?.message || err}`);
      });
    };

    run();
    this.voiceHealthTimer = setInterval(run, VOICE_STATE_RECONCILE_MS);
  }

  stopVoiceStateReconciler() {
    if (this.voiceHealthTimer) {
      clearInterval(this.voiceHealthTimer);
      this.voiceHealthTimer = null;
    }
    for (const guildId of this.pendingVoiceReconcileTimers.keys()) {
      this.clearQueuedVoiceReconcile(guildId);
    }
  }

  attachConnectionHandlers(guildId, connection) {
    const state = this.getState(guildId);
    const isCurrentConnection = () => state.connection === connection;

    const markDisconnected = () => {
      if (isCurrentConnection()) {
        state.connection = null;
      }
    };

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      if (!isCurrentConnection()) return;
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
        if (!isCurrentConnection()) return;
        // Connection is recovering on its own
        log("INFO", `[${this.config.name}] Voice connection recovering for guild=${guildId}`);
      } catch {
        if (!isCurrentConnection()) return;
        // Recovery failed - destroy connection, voiceStateUpdate will handle reconnect
        log("INFO", `[${this.config.name}] Voice connection recovery failed for guild=${guildId}, destroying`);
        markDisconnected();
        try { connection.destroy(); } catch { /* ignore */ }
        this.scheduleReconnect(guildId, { reason: "voice-disconnected" });
      }
    });

    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (!isCurrentConnection()) return;
      markDisconnected();
      if (state.shouldReconnect && state.currentStationKey && state.lastChannelId) {
        this.scheduleReconnect(guildId, { reason: "voice-destroyed" });
      }
    });

    connection.on("error", (err) => {
      if (!isCurrentConnection()) return;
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

    const localeCandidates = [
      interaction?.locale,
      interaction?.guildLocale,
      interaction?.guild?.preferredLocale,
    ];
    const hasGerman = localeCandidates.some((locale) => {
      return resolveLanguageFromDiscordLocale(locale, "en") === "de";
    });
    return hasGerman ? "de" : "en";
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

  getStreamingRuntimeSelectionMessage(reason, language = "de") {
    const isDe = String(language || "de").toLowerCase() === "de";
    const messages = {
      none: isDe
        ? "Auf diesem Server streamt gerade kein Worker. Starte zuerst `/play`."
        : "No worker is currently streaming on this server. Start `/play` first.",
      multiple: isDe
        ? "Mehrere Worker streamen aktuell. Tritt dem Ziel-Voice-Channel bei, damit ich den richtigen Stream waehle."
        : "Multiple workers are currently streaming. Join the target voice channel so I can select the correct stream.",
      multiple_in_channel: isDe
        ? "In deinem Voice-Channel sind mehrere Worker aktiv. Stoppe einen davon oder waehle einen eindeutigen Ziel-Channel."
        : "Multiple workers are active in your voice channel. Stop one of them or choose a unique target channel.",
    };
    return messages[reason] || messages.none;
  }

  async resolveStreamingRuntimeForInteraction(interaction) {
    const guildId = String(interaction?.guildId || "").trim();
    if (!guildId) {
      return { runtime: null, state: null, reason: "none" };
    }

    if (this.role !== "commander" || !this.workerManager) {
      return { runtime: this, state: this.getState(guildId), reason: null };
    }

    const workers = this.workerManager.getStreamingWorkers(guildId);
    if (!workers.length) {
      return { runtime: null, state: null, reason: "none" };
    }

    const guild = interaction.guild
      || this.client.guilds.cache.get(guildId)
      || await this.client.guilds.fetch(guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
    const userChannelId = String(member?.voice?.channelId || "").trim();

    if (userChannelId) {
      const matchingWorkers = workers.filter((worker) => {
        const info = worker.getGuildInfo(guildId);
        return String(info?.channelId || "").trim() === userChannelId;
      });
      if (matchingWorkers.length === 1) {
        const runtime = matchingWorkers[0];
        return { runtime, state: runtime.getState(guildId), reason: null };
      }
      if (matchingWorkers.length > 1) {
        return { runtime: null, state: null, reason: "multiple_in_channel" };
      }
    }

    if (workers.length === 1) {
      const runtime = workers[0];
      return { runtime, state: runtime.getState(guildId), reason: null };
    }

    return { runtime: null, state: null, reason: "multiple" };
  }

  getIntegerOptionFlexible(interaction, optionNames = []) {
    const resolver = interaction?.options;
    if (!resolver || !Array.isArray(optionNames) || optionNames.length === 0) return null;

    const parseValue = (value) => {
      if (Number.isInteger(value)) return value;
      const parsed = Number.parseInt(String(value ?? "").trim(), 10);
      return Number.isInteger(parsed) ? parsed : null;
    };

    for (const rawName of optionNames) {
      const name = String(rawName || "").trim();
      if (!name) continue;

      try {
        const direct = resolver.getInteger(name, false);
        const parsedDirect = parseValue(direct);
        if (parsedDirect !== null) return parsedDirect;
      } catch {
        // ignore option type mismatch
      }

      try {
        const asString = resolver.getString(name, false);
        const parsedString = parseValue(asString);
        if (parsedString !== null) return parsedString;
      } catch {
        // ignore option type mismatch
      }

      try {
        const raw = resolver.get(name, false);
        const parsedRaw = parseValue(raw?.value);
        if (parsedRaw !== null) return parsedRaw;
      } catch {
        // ignore missing option
      }
    }

    const rawData = Array.isArray(resolver.data) ? resolver.data : [];
    for (const rawName of optionNames) {
      const name = String(rawName || "").trim();
      if (!name) continue;
      const option = rawData.find((entry) => String(entry?.name || "").trim() === name);
      const parsed = parseValue(option?.value);
      if (parsed !== null) return parsed;
    }

    return null;
  }

  getWorkerRequiredTierBySlot(slot) {
    const idx = Number.parseInt(String(slot || ""), 10);
    if (!Number.isFinite(idx) || idx <= 2) return "free";
    if (idx <= 8) return "pro";
    return "ultimate";
  }

  formatTierLabel(tier, language) {
    const normalized = String(tier || "free").toLowerCase();
    if (normalized === "ultimate") return "Ultimate";
    if (normalized === "pro") return "Pro";
    return language === "de" ? "Free" : "Free";
  }

  async isWorkerAlreadyInvited(guild, worker) {
    if (!guild || !worker) return false;
    const clientId = String(worker.getApplicationId?.() || worker.config?.clientId || "").trim();
    if (!/^\d{17,22}$/.test(clientId)) return false;

    if (worker.client?.isReady?.() && worker.client.guilds.cache.has(guild.id)) {
      return true;
    }
    if (guild.members?.cache?.has(clientId)) {
      return true;
    }
    const member = await guild.members.fetch(clientId).catch(() => null);
    return Boolean(member);
  }

  async collectInviteWorkerState(guild) {
    const guildId = String(guild?.id || "").trim();
    const guildTier = getTier(guildId);
    const maxIndex = this.workerManager.getMaxWorkerIndex(guildTier);
    const workers = [];
    const statuses = this.workerManager.getAllStatuses();

    for (const status of statuses) {
      const slot = Number(status?.index || 0);
      if (!slot) continue;
      const worker = this.workerManager.getWorkerByIndex(slot);
      const requiredTier = this.getWorkerRequiredTierBySlot(slot);
      const tierLocked = slot > maxIndex;
      const resolvedClientId = String(worker?.getApplicationId?.() || worker?.config?.clientId || status?.clientId || "").trim();
      const inviteUrl = resolvedClientId && worker
        ? buildInviteUrl({ ...worker.config, clientId: resolvedClientId })
        : null;
      const alreadyInvited = worker ? await this.isWorkerAlreadyInvited(guild, worker) : false;

      workers.push({
        slot,
        botIndex: Number(status?.botIndex || worker?.config?.index || 0) || null,
        name: worker?.config?.name || status?.name || `Worker ${slot}`,
        requiredTier,
        tierLocked,
        online: Boolean(status?.online),
        inviteUrl,
        alreadyInvited,
        selectable: !tierLocked && !alreadyInvited && Boolean(inviteUrl),
      });
    }

    workers.sort((a, b) => a.slot - b.slot);
    const selectableWorkers = workers.filter((worker) => worker.selectable);
    const invitedWorkers = workers.filter((worker) => worker.alreadyInvited && !worker.tierLocked);
    const lockedWorkers = workers.filter((worker) => worker.tierLocked);
    return {
      guildTier,
      maxIndex,
      workers,
      selectableWorkers,
      invitedWorkers,
      lockedWorkers,
    };
  }

  formatWorkerBadge(worker) {
    const botIndexLabel = worker.botIndex ? `, BOT_${worker.botIndex}` : "";
    return `#${worker.slot}${botIndexLabel}`;
  }

  formatWorkerList(items = [], maxLines = 8, moreLabel = "weitere") {
    if (!Array.isArray(items) || !items.length) return "-";
    const lines = items.slice(0, maxLines).map((item) => {
      return `\`${this.formatWorkerBadge(item)}\` ${item.name}`;
    });
    if (items.length > maxLines) {
      lines.push(`+${items.length - maxLines} ${moreLabel}`);
    }
    return lines.join("\n");
  }

  async buildInviteMenuPayload(interaction, { selectedWorkerSlot = null, hint = "" } = {}) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const guild = interaction.guild || this.client.guilds.cache.get(interaction.guildId) || null;
    if (!guild) {
      return {
        content: t("Server konnte nicht gefunden werden.", "Could not resolve server."),
        embeds: [],
        components: [],
      };
    }

    const inviteState = await this.collectInviteWorkerState(guild);
    const moreLabel = t("weitere", "more");
    const selectedWorker = inviteState.selectableWorkers.find((worker) => worker.slot === Number(selectedWorkerSlot))
      || inviteState.selectableWorkers[0]
      || null;

    const embed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setTitle(t("Worker-Bots einladen", "Invite worker bots"))
      .setDescription(
        t(
          `Plan: **${this.formatTierLabel(inviteState.guildTier, language)}** | Verfuegbare Worker: **1-${inviteState.maxIndex}**\nWaehle einen Worker unten aus und nutze den Invite-Button.`,
          `Plan: **${this.formatTierLabel(inviteState.guildTier, language)}** | Available workers: **1-${inviteState.maxIndex}**\nSelect a worker below and use the invite button.`
        )
      )
      .addFields(
        {
          name: t("Bereits eingeladen", "Already invited"),
          value: this.formatWorkerList(inviteState.invitedWorkers, 8, moreLabel),
          inline: true,
        },
        {
          name: t("Jetzt auswaehlbar", "Selectable now"),
          value: this.formatWorkerList(inviteState.selectableWorkers, 8, moreLabel),
          inline: true,
        },
        {
          name: t("Gesperrt durch Plan", "Locked by plan"),
          value: this.formatWorkerList(inviteState.lockedWorkers, 8, moreLabel),
          inline: false,
        }
      );

    if (selectedWorker) {
      embed.setFooter({
        text: t(
          `Ausgewaehlt: ${selectedWorker.name} (${this.formatWorkerBadge(selectedWorker)})`,
          `Selected: ${selectedWorker.name} (${this.formatWorkerBadge(selectedWorker)})`
        ),
      });
    } else {
      embed.setFooter({
        text: t(
          "Kein Worker auswaehlbar. Entweder schon eingeladen oder Plan-Limit erreicht.",
          "No worker is selectable. Workers are already invited or plan-limited."
        ),
      });
    }

    if (hint) {
      embed.addFields({
        name: t("Hinweis", "Note"),
        value: clipText(String(hint), 900),
        inline: false,
      });
    }

    const rows = [];
    const selectOptions = inviteState.selectableWorkers.slice(0, 25).map((worker) => ({
      label: clipText(`${worker.name}`, 90),
      description: clipText(`${this.formatWorkerBadge(worker)} - ${this.formatTierLabel(worker.requiredTier, language)}`, 90),
      value: String(worker.slot),
      default: selectedWorker ? worker.slot === selectedWorker.slot : false,
    }));

    if (selectOptions.length > 0) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(INVITE_COMPONENT_ID_SELECT)
        .setPlaceholder(t("Worker-Bot auswaehlen", "Select worker bot"))
        .addOptions(selectOptions);
      rows.push(new ActionRowBuilder().addComponents(selectMenu));
    }

    const buttons = new ActionRowBuilder();
    if (selectedWorker?.inviteUrl) {
      buttons.addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(
            t(
              `Invite ${selectedWorker.name}`,
              `Invite ${selectedWorker.name}`
            )
          )
          .setURL(selectedWorker.inviteUrl)
      );
    } else {
      buttons.addComponents(
        new ButtonBuilder()
          .setCustomId(`${INVITE_COMPONENT_PREFIX}noop`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel(t("Kein Invite verfügbar", "No invite available"))
          .setDisabled(true)
      );
    }

    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(INVITE_COMPONENT_ID_REFRESH)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("Aktualisieren", "Refresh")),
      new ButtonBuilder()
        .setCustomId(INVITE_COMPONENT_ID_CLOSE)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("Schliessen", "Close"))
    );
    rows.push(buttons);

    return {
      embeds: [embed],
      components: rows,
    };
  }

  async handleInviteComponentInteraction(interaction) {
    const { t } = this.createInteractionTranslator(interaction);
    if (this.role !== "commander" || !this.workerManager) {
      if (interaction.isRepliable?.()) {
        await interaction.reply({ content: t("Nur der Commander kann dieses Menue bedienen.", "Only the commander can use this menu."), ephemeral: true });
      }
      return true;
    }

    if (!interaction.guildId) {
      await interaction.reply({
        content: t("Dieses Menue funktioniert nur auf Servern.", "This menu only works in servers."),
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId === INVITE_COMPONENT_ID_CLOSE) {
      await interaction.update({
        content: t("Invite-Menue geschlossen.", "Invite menu closed."),
        embeds: [],
        components: [],
      });
      return true;
    }

    if (interaction.customId === INVITE_COMPONENT_ID_REFRESH || interaction.customId === INVITE_COMPONENT_ID_OPEN) {
      const payload = await this.buildInviteMenuPayload(interaction);
      await interaction.update(payload);
      return true;
    }

    if (interaction.customId === INVITE_COMPONENT_ID_SELECT && interaction.isStringSelectMenu()) {
      const selectedSlot = Number.parseInt(String(interaction.values?.[0] || ""), 10);
      const payload = await this.buildInviteMenuPayload(interaction, {
        selectedWorkerSlot: Number.isFinite(selectedSlot) ? selectedSlot : null,
      });
      await interaction.update(payload);
      return true;
    }

    if (interaction.customId.startsWith(INVITE_COMPONENT_PREFIX)) {
      await interaction.reply({
        content: t("Diese Aktion ist nicht mehr gueltig. Bitte aktualisiere das Menue.", "This action is no longer valid. Please refresh the menu."),
        ephemeral: true,
      });
      return true;
    }

    return false;
  }

  async buildWorkersStatusPayload(interaction, { hint = "" } = {}) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const guildId = String(interaction?.guildId || "").trim();
    if (!guildId) {
      return {
        content: t(
          "Dieser Befehl funktioniert nur auf einem Discord-Server (nicht in DMs).",
          "This command only works inside a Discord server (not in DMs)."
        ),
        embeds: [],
        components: [],
      };
    }

    const guildTier = getTier(guildId);
    const maxIndex = this.workerManager.getMaxWorkerIndex(guildTier);
    const statuses = this.workerManager.getAllStatuses();
    const lines = [];

    for (const ws of statuses) {
      const runtime = this.workerManager.getWorkerByIndex(ws.index);
      const inGuild = ws.online && runtime?.client?.guilds?.cache?.has(guildId);
      const streaming = Array.isArray(ws.streams)
        ? ws.streams.find((stream) => stream.guildId === guildId)
        : null;
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

      const botIndexText = ws.botIndex ? `, BOT_${ws.botIndex}` : "";
      lines.push(
        `\`${statusEmoji}\` **${ws.name}** - ${statusText} (${ws.totalGuilds} Server, ${ws.activeStreams} aktiv, ${t("Slot", "Slot")} ${ws.index}${botIndexText})`
      );
    }

    const summaryEmbed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setTitle(t("Worker-Status", "Worker status"))
      .setDescription(
        t(
          `Plan: **${this.formatTierLabel(guildTier, language)}** | Freigeschaltet: **1-${maxIndex}**`,
          `Plan: **${this.formatTierLabel(guildTier, language)}** | Unlocked: **1-${maxIndex}**`
        )
      )
      .addFields({
        name: t("Uebersicht", "Overview"),
        value: lines.join("\n").slice(0, 1024) || "-",
        inline: false,
      });

    if (hint) {
      summaryEmbed.addFields({
        name: t("Hinweis", "Note"),
        value: clipText(String(hint), 900),
        inline: false,
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(INVITE_COMPONENT_ID_OPEN)
        .setStyle(ButtonStyle.Primary)
        .setLabel(t("Worker einladen", "Invite worker")),
      new ButtonBuilder()
        .setCustomId(WORKERS_COMPONENT_ID_REFRESH)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("Aktualisieren", "Refresh"))
    );

    return {
      embeds: [summaryEmbed],
      components: [row],
    };
  }

  async handleWorkersComponentInteraction(interaction) {
    const { t } = this.createInteractionTranslator(interaction);
    if (this.role !== "commander" || !this.workerManager) {
      if (interaction.isRepliable?.()) {
        await interaction.reply({
          content: t("Nur der Commander kann dieses Menue bedienen.", "Only the commander can use this menu."),
          ephemeral: true,
        });
      }
      return true;
    }

    if (!interaction.guildId) {
      await interaction.reply({
        content: t("Dieses Menue funktioniert nur auf Servern.", "This menu only works in servers."),
        ephemeral: true,
      });
      return true;
    }

    if (interaction.customId === WORKERS_COMPONENT_ID_REFRESH) {
      const payload = await this.buildWorkersStatusPayload(interaction);
      await interaction.update(payload);
      return true;
    }

    if (interaction.customId.startsWith(WORKERS_COMPONENT_PREFIX)) {
      await interaction.reply({
        content: t("Diese Aktion ist nicht mehr gueltig. Bitte aktualisiere die Ansicht.", "This action is no longer valid. Please refresh the view."),
        ephemeral: true,
      });
      return true;
    }

    return false;
  }

  async handleComponentInteraction(interaction) {
    if (!interaction || (!interaction.isButton?.() && !interaction.isStringSelectMenu?.())) return false;
    const customId = String(interaction.customId || "");
    try {
      if (customId.startsWith(INVITE_COMPONENT_PREFIX)) {
        return this.handleInviteComponentInteraction(interaction);
      }
      if (customId.startsWith(WORKERS_COMPONENT_PREFIX)) {
        return this.handleWorkersComponentInteraction(interaction);
      }
      return false;
    } catch (err) {
      const { t } = this.createInteractionTranslator(interaction);
      log(
        "ERROR",
        `[${this.config.name}] Component interaction error (customId=${customId || "-"}) guild=${interaction?.guildId || "-"}: ${err?.stack || err}`
      );
      const payload = {
        content: t(
          "Aktion fehlgeschlagen. Bitte aktualisiere die Ansicht und versuche es erneut.",
          "Action failed. Please refresh the view and try again."
        ),
        ephemeral: true,
      };
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch {
        // ignore secondary reply failures
      }
      return true;
    }
  }

  buildHelpMessage(interaction) {
    const language = this.resolveInteractionLanguage(interaction);
    const isDe = language === "de";
    const guildId = interaction?.guildId;
    const tierConfig = guildId ? getTierConfig(guildId) : PLANS.free;

    const headerEmbed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setTitle(isDe ? `🧭 ${BRAND.name} Hilfe` : `🧭 ${BRAND.name} Help`)
      .setDescription(
        isDe
          ? `Server: **${interaction.guild?.name || guildId || "-"}**\nPlan: **${tierConfig.name}** | Audio: **${tierConfig.bitrate}** | Worker-Slots: **${tierConfig.maxBots}**`
          : `Server: **${interaction.guild?.name || guildId || "-"}**\nPlan: **${tierConfig.name}** | Audio: **${tierConfig.bitrate}** | Worker slots: **${tierConfig.maxBots}**`
      )
      .addFields(
        {
          name: isDe ? "Schnellstart" : "Quick start",
          value: isDe
            ? "1. `/workers` oder `/invite` prüfen, welche Worker bereit sind.\n2. `/play station:<sender> voice:<kanal>` startet den Stream.\n3. `/now`, `/history` und `/stats` zeigen Live-Daten."
            : "1. Use `/workers` or `/invite` to check which workers are available.\n2. `/play station:<station> voice:<channel>` starts the stream.\n3. `/now`, `/history`, and `/stats` show live data.",
          inline: false,
        },
        {
          name: isDe ? "Sprache" : "Language",
          value: isDe
            ? "OmniFM erkennt Server- und Discord-Sprache automatisch. Mit `/language set value:de|en` kannst du sie fest setzen."
            : "OmniFM auto-detects the server/Discord language. Use `/language set value:de|en` to force it.",
          inline: false,
        }
      );

    const playbackEmbed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setTitle(isDe ? "🎧 Wiedergabe & Live" : "🎧 Playback & Live")
      .addFields(
        {
          name: "/play /pause /resume /stop",
          value: isDe
            ? "Startet, pausiert oder beendet Streams im Voice- oder Stage-Channel."
            : "Start, pause, or stop streams in voice or stage channels.",
          inline: false,
        },
        {
          name: "/stations /list /now /history /stats",
          value: isDe
            ? "Zeigt verfügbare Sender, aktuelle Songs, History und Server-Statistiken."
            : "Shows available stations, current songs, history, and server statistics.",
          inline: false,
        },
        {
          name: "/setvolume /status /health /diag",
          value: isDe
            ? "Audio, Worker-Zustand und technische Checks für Admins."
            : "Audio, worker status, and technical checks for admins.",
          inline: false,
        }
      );

    const automationEmbed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setTitle(isDe ? "🗓 Events & Automationen" : "🗓 Events & Automation")
      .addFields(
        {
          name: "/event create|edit|list|delete",
          value: isDe
            ? "Flexible Event-Planung mit Voice-/Stage-Channel, Wiederholung, Server-Event und Ankündigung."
            : "Flexible event scheduling with voice/stage channel, recurrence, server event, and announcement.",
          inline: false,
        },
        {
          name: isDe ? "Datumsformate" : "Date formats",
          value: isDe
            ? "`DD.MM.YYYY HH:MM`, `YYYY-MM-DD HH:MM`, `20:00`, `heute`, `morgen` oder getrennt über `startdate` + `starttime`."
            : "`DD.MM.YYYY HH:MM`, `YYYY-MM-DD HH:MM`, `20:00`, `today`, `tomorrow`, or split across `startdate` + `starttime`.",
          inline: false,
        },
        {
          name: isDe ? "Wichtig" : "Important",
          value: isDe
            ? "Ohne `serverevent` darf ein Event sofort starten. Mit `serverevent` muss der Start mindestens 60 Sekunden in der Zukunft liegen."
            : "Without `serverevent`, an event may start immediately. With `serverevent`, start time must be at least 60 seconds in the future.",
          inline: false,
        }
      );

    const adminEmbed = new EmbedBuilder()
      .setColor(tierConfig.tier === "ultimate" ? BRAND.ultimateColor : BRAND.proColor)
      .setTitle(isDe ? "🛠 Admin & Premium" : "🛠 Admin & Premium")
      .addFields(
        {
          name: "/invite /workers /perm",
          value: isDe
            ? "Worker einladen, aktive Worker ansehen und Rollenrechte für Commands regeln."
            : "Invite workers, inspect active workers, and manage role permissions for commands.",
          inline: false,
        },
        {
          name: "/premium /license",
          value: isDe
            ? "Lizenzstatus, Upgrades und Seat-Verwaltung für deinen Server."
            : "License status, upgrades, and seat management for your server.",
          inline: false,
        },
        {
          name: "/addstation /removestation /mystations",
          value: isDe
            ? "Ultimate-only für eigene Sender und private Streams."
            : "Ultimate-only for custom stations and private streams.",
          inline: false,
        }
      )
      .setFooter({
        text: isDe
          ? "Commander nimmt Befehle entgegen, Worker halten die Voice-/Stage-Streams."
          : "The commander handles commands, workers keep the voice/stage streams running.",
      });

    const linkRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(isDe ? "Website" : "Website")
        .setURL(WEBSITE_URL),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(isDe ? "Support" : "Support")
        .setURL(SUPPORT_URL),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(isDe ? "Premium" : "Premium")
        .setURL(BRAND.upgradeUrl || WEBSITE_URL)
    );

    return {
      embeds: [headerEmbed, playbackEmbed, automationEmbed, adminEmbed],
      components: [linkRow],
    };
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

  normalizeStationReference(rawStationKey) {
    const customRef = parseCustomStationReference(rawStationKey);
    if (customRef.isCustom) {
      return {
        key: customRef.reference || "",
        lookupKey: customRef.key || "",
        isCustom: true,
      };
    }

    const normalized = normalizeKey(rawStationKey);
    return {
      key: normalized,
      lookupKey: normalized,
      isCustom: false,
    };
  }

  resolveStationForGuild(guildId, rawStationKey, language = "de") {
    const t = (de, en) => languagePick(language, de, en);
    const stationRef = this.normalizeStationReference(rawStationKey);
    if (!stationRef.key || !stationRef.lookupKey) {
      return { ok: false, message: t("Stations-Key ist ungueltig.", "Station key is invalid.") };
    }

    const stations = loadStations();
    const guildTier = getTier(guildId);
    const available = filterStationsByTier(stations.stations, guildTier);
    if (!stationRef.isCustom && available[stationRef.key]) {
      stations.stations[stationRef.key] = available[stationRef.key];
      return { ok: true, key: stationRef.key, station: available[stationRef.key], stations, isCustom: false };
    }

    if (guildTier === "ultimate") {
      const customStations = getGuildStations(guildId);
      const custom = customStations[stationRef.lookupKey];
      if (custom) {
        const validation = validateCustomStationUrl(custom.url);
        if (!validation.ok) {
          const translated = translateCustomStationErrorMessage(validation.error, language);
          return { ok: false, message: t(`Custom-Station kann nicht genutzt werden: ${translated}`, `Custom station cannot be used: ${translated}`) };
        }
        const station = { name: custom.name, url: validation.url, tier: "ultimate" };
        const resolvedKey = buildCustomStationReference(stationRef.lookupKey) || stationRef.key;
        stations.stations[resolvedKey] = station;
        return { ok: true, key: resolvedKey, station, stations, isCustom: true };
      }
    }

    if (!stationRef.isCustom && stations.stations[stationRef.key]) {
      return {
        ok: false,
        message: t(
          `Station \`${stationRef.key}\` ist in deinem Plan nicht verfügbar.`,
          `Station \`${stationRef.key}\` is not available in your plan.`
        )
      };
    }
    return {
      ok: false,
      message: t(
        `Station \`${stationRef.key}\` wurde nicht gefunden.`,
        `Station \`${stationRef.key}\` was not found.`
      )
    };
  }

  getResolvedCurrentStation(guildId, state, language = null) {
    if (!state?.currentStationKey) return null;
    const resolved = this.resolveStationForGuild(guildId, state.currentStationKey, language || this.resolveGuildLanguage(guildId));
    return resolved.ok ? resolved : null;
  }

  resolvePlaybackFallback(guildId, currentKey, explicitFallbackKey = "", language = null) {
    const fallbackLanguage = language || this.resolveGuildLanguage(guildId);
    const explicitKey = String(explicitFallbackKey || "").trim();
    if (explicitKey && explicitKey !== currentKey) {
      const explicit = this.resolveStationForGuild(guildId, explicitKey, fallbackLanguage);
      if (explicit.ok && explicit.key !== currentKey) {
        return { ...explicit, source: "explicit" };
      }
    }

    const current = this.resolveStationForGuild(guildId, currentKey, fallbackLanguage);
    if (!current.ok || current.isCustom || isYouTubeUrl(current.station?.url || "")) {
      return null;
    }

    const fallbackKey = getFallbackKey(current.stations, current.key);
    if (!fallbackKey || fallbackKey === current.key || !current.stations.stations[fallbackKey]) {
      return null;
    }

    return {
      ok: true,
      key: fallbackKey,
      station: current.stations.stations[fallbackKey],
      stations: current.stations,
      isCustom: false,
      source: "automatic",
    };
  }

  clearScheduledEventPlayback(state) {
    if (!state) return;
    state.activeScheduledEventId = null;
    state.activeScheduledEventStopAtMs = 0;
  }

  markScheduledEventPlayback(state, eventId, stopAtMs = 0) {
    if (!state) return;
    const normalizedId = String(eventId || "").trim();
    state.activeScheduledEventId = normalizedId || null;
    const normalizedStopAtMs = Number.parseInt(String(stopAtMs || 0), 10);
    state.activeScheduledEventStopAtMs = Number.isFinite(normalizedStopAtMs) && normalizedStopAtMs > 0
      ? normalizedStopAtMs
      : 0;
  }

  setScheduledEventPlaybackInGuild(guildId, eventId, stopAtMs = 0) {
    const state = this.getState(guildId);
    this.markScheduledEventPlayback(state, eventId, stopAtMs);
    this.persistState();
    return { ok: true };
  }

  clearScheduledEventPlaybackInGuild(guildId) {
    const state = this.guildState.get(guildId);
    if (!state) return { ok: false, error: "Kein State fuer diesen Server." };
    this.clearScheduledEventPlayback(state);
    this.persistState();
    return { ok: true };
  }

  getScheduledEventEndAtMs(event, runAtMs = null) {
    const durationMs = Number.parseInt(String(event?.durationMs || 0), 10);
    if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
    const baseRunAtMs = Number.parseInt(String(runAtMs ?? event?.runAtMs ?? 0), 10);
    if (!Number.isFinite(baseRunAtMs) || baseRunAtMs <= 0) return 0;
    return baseRunAtMs + durationMs;
  }

  formatDiscordTimestamp(ms, style = "F") {
    const value = Number.parseInt(String(ms || 0), 10);
    if (!Number.isFinite(value) || value <= 0) return "-";
    return `<t:${Math.floor(value / 1000)}:${style}>`;
  }

  normalizeClearableText(rawValue, maxLen) {
    if (rawValue === undefined || rawValue === null) return undefined;
    const trimmed = clipText(String(rawValue || "").trim(), maxLen);
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    if (["-", "clear", "none", "off"].includes(lower)) return null;
    return trimmed;
  }

  isScheduledEventStopDue(stopAtMs, now = Date.now()) {
    const normalizedStopAtMs = Number.parseInt(String(stopAtMs || 0), 10);
    return Number.isFinite(normalizedStopAtMs) && normalizedStopAtMs > 0 && now >= normalizedStopAtMs;
  }

  buildScheduledEventServerDescription(event, stationName) {
    const baseDescription = clipText(String(event?.description || "").trim(), 850);
    const details = `OmniFM Auto-Event | Station: ${clipText(stationName || event?.stationKey || "-", 120)}`;
    return clipText(baseDescription ? `${baseDescription}\n\n${details}` : details, 1000);
  }

  validateDiscordScheduledEventPermissions(guild, channel, language = "de") {
    if (!guild || !channel) {
      return languagePick(language, "Guild oder Channel fehlt.", "Guild or channel is missing.");
    }

    const me = guild.members.me;
    if (!me) {
      return languagePick(language, "Bot-Mitglied konnte nicht geladen werden.", "Could not resolve the bot member.");
    }

    const guildPerms = me.permissions;
    const channelPerms = channel.permissionsFor(me);
    const missing = [];

    if (!guildPerms?.has(PermissionFlagsBits.CreateEvents)) {
      missing.push("Create Events");
    }
    if (!channelPerms?.has(PermissionFlagsBits.ViewChannel)) {
      missing.push("View Channel");
    }
    if (!channelPerms?.has(PermissionFlagsBits.Connect)) {
      missing.push("Connect");
    }

    if (channel.type === ChannelType.GuildStageVoice) {
      if (!guildPerms?.has(PermissionFlagsBits.ManageChannels)) {
        missing.push("Manage Channels");
      }
      if (!guildPerms?.has(PermissionFlagsBits.MuteMembers)) {
        missing.push("Mute Members");
      }
      if (!guildPerms?.has(PermissionFlagsBits.MoveMembers)) {
        missing.push("Move Members");
      }
    }

    if (!missing.length) return null;
    return languagePick(
      language,
      `Discord-Server-Event nicht moeglich. Fehlende Rechte: ${missing.join(", ")}.`,
      `Discord server event is not possible. Missing permissions: ${missing.join(", ")}.`
    );
  }

  buildScheduledEventSummary(event, stationName, language = "de", { includeId = true } = {}) {
    const now = Date.now();
    const timeZone = normalizeEventTimeZone(event?.timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
    const effectiveEndAtMs = Number.parseInt(String(event?.activeUntilMs || 0), 10) > 0
      ? Number.parseInt(String(event.activeUntilMs), 10)
      : this.getScheduledEventEndAtMs(event, event?.runAtMs);
    const isActive = effectiveEndAtMs > now && Number(event?.lastStopAtMs || 0) < effectiveEndAtMs;
    const status = !event?.enabled
      ? languagePick(language, "pausiert", "paused")
      : isActive
        ? `${languagePick(language, "aktiv bis", "active until")} ${this.formatDiscordTimestamp(effectiveEndAtMs, "F")}`
        : languagePick(language, "geplant", "scheduled");
    const stationLine = stationName && stationName !== event?.stationKey
      ? `\`${event?.stationKey || "-"}\` (${stationName})`
      : `\`${event?.stationKey || "-"}\``;
    const lines = [];

    if (includeId) {
      lines.push(`\`${event?.id || "-"}\` • **${clipText(event?.name || "-", 80)}**`);
    } else {
      lines.push(`**${clipText(event?.name || "-", 80)}**`);
    }

    lines.push(`${languagePick(language, "Status", "Status")}: ${status}`);
    lines.push(`${languagePick(language, "Station", "Station")}: ${stationLine}`);
    lines.push(`${languagePick(language, "Voice/Stage", "Voice/Stage")}: <#${event?.voiceChannelId || "-"}>`);
    lines.push(`${languagePick(language, "Start", "Start")}: ${this.formatDiscordTimestamp(event?.runAtMs, "F")} (${formatDateTime(event?.runAtMs, language, timeZone)})`);
    lines.push(
      `${languagePick(language, "Ende", "End")}: ${
        effectiveEndAtMs > 0
          ? `${this.formatDiscordTimestamp(effectiveEndAtMs, "F")} (${formatDateTime(effectiveEndAtMs, language, timeZone)})`
          : languagePick(language, "offen", "open")
      }`
    );
    lines.push(`${languagePick(language, "Wiederholung", "Repeat")}: ${getRepeatLabel(event?.repeat, language, { runAtMs: event?.runAtMs, timeZone })}`);
    lines.push(`${languagePick(language, "Zeitzone", "Time zone")}: \`${timeZone}\``);
    lines.push(`${languagePick(language, "Ankuendigung", "Announcement")}: ${event?.textChannelId ? `<#${event.textChannelId}>` : languagePick(language, "aus", "off")}`);
    lines.push(`${languagePick(language, "Server-Event", "Server event")}: ${event?.createDiscordEvent ? (event?.discordScheduledEventId ? `on (\`${event.discordScheduledEventId}\`)` : "on") : "off"}`);
    if (event?.stageTopic) {
      lines.push(`${languagePick(language, "Stage-Thema", "Stage topic")}: \`${event.stageTopic}\``);
    }
    if (event?.description) {
      lines.push(`${languagePick(language, "Beschreibung", "Description")}: ${clipText(event.description, 180)}`);
    }

    return lines.join("\n");
  }

  buildScheduledEventEmbed(event, stationName, language = "de", { includeId = true, titlePrefix = "" } = {}) {
    const timeZone = normalizeEventTimeZone(event?.timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
    const effectiveEndAtMs = Number.parseInt(String(event?.activeUntilMs || 0), 10) > 0
      ? Number.parseInt(String(event.activeUntilMs), 10)
      : this.getScheduledEventEndAtMs(event, event?.runAtMs);
    const now = Date.now();
    const isActive = effectiveEndAtMs > now && Number(event?.lastStopAtMs || 0) < effectiveEndAtMs;
    const statusLabel = !event?.enabled
      ? languagePick(language, "Pausiert", "Paused")
      : isActive
        ? languagePick(language, "Aktiv", "Active")
        : languagePick(language, "Geplant", "Scheduled");
    const stationLabel = stationName && stationName !== event?.stationKey
      ? `${stationName} (\`${event?.stationKey || "-"}\`)`
      : `\`${event?.stationKey || "-"}\``;
    const embed = new EmbedBuilder()
      .setColor(!event?.enabled ? 0x80848e : (isActive ? 0x1DB954 : BRAND.color))
      .setTitle(`${titlePrefix}${clipText(event?.name || "-", 120)}`)
      .setDescription(includeId ? `${languagePick(language, "Event-ID", "Event ID")}: \`${event?.id || "-"}\`` : null)
      .addFields(
        { name: languagePick(language, "Status", "Status"), value: statusLabel, inline: true },
        { name: languagePick(language, "Station", "Station"), value: stationLabel, inline: true },
        { name: languagePick(language, "Voice", "Voice"), value: `<#${event?.voiceChannelId || "-"}>`, inline: true },
        {
          name: languagePick(language, "Start", "Start"),
          value: `${this.formatDiscordTimestamp(event?.runAtMs, "F")}\n${formatDateTime(event?.runAtMs, language, timeZone)}`,
          inline: true,
        },
        {
          name: languagePick(language, "Ende", "End"),
          value: effectiveEndAtMs > 0
            ? `${this.formatDiscordTimestamp(effectiveEndAtMs, "F")}\n${formatDateTime(effectiveEndAtMs, language, timeZone)}`
            : languagePick(language, "Offen", "Open"),
          inline: true,
        },
        {
          name: languagePick(language, "Wiederholung", "Repeat"),
          value: getRepeatLabel(event?.repeat, language, { runAtMs: event?.runAtMs, timeZone }),
          inline: true,
        },
        { name: languagePick(language, "Zeitzone", "Time zone"), value: `\`${timeZone}\``, inline: true },
        {
          name: languagePick(language, "Ankuendigung", "Announcement"),
          value: event?.textChannelId ? `<#${event.textChannelId}>` : languagePick(language, "Aus", "Off"),
          inline: true,
        },
        {
          name: languagePick(language, "Server-Event", "Server event"),
          value: event?.createDiscordEvent
            ? (event?.discordScheduledEventId ? `On (\`${event.discordScheduledEventId}\`)` : "On")
            : "Off",
          inline: true,
        }
      )
      .setFooter({
        text: languagePick(language, "OmniFM Event Scheduler", "OmniFM Event Scheduler"),
      })
      .setTimestamp(new Date());

    if (event?.stageTopic) {
      embed.addFields({
        name: languagePick(language, "Stage-Thema", "Stage topic"),
        value: clipText(event.stageTopic, 120),
        inline: false,
      });
    }
    if (event?.description) {
      embed.addFields({
        name: languagePick(language, "Beschreibung", "Description"),
        value: clipText(event.description, 400),
        inline: false,
      });
    }
    if (event?.announceMessage) {
      embed.addFields({
        name: languagePick(language, "Nachricht", "Message"),
        value: clipText(event.announceMessage, 900),
        inline: false,
      });
    }

    return embed;
  }

  buildScheduledEventsListEmbed(events, guildId, language = "de") {
    const embed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setTitle(languagePick(language, "Geplante Events", "Scheduled events"))
      .setDescription(`${events.length} ${languagePick(language, "Eintrag(e) auf diesem Server", "item(s) on this server")}`)
      .setFooter({ text: `${this.config.name} | /event list` })
      .setTimestamp(new Date());

    const guild = this.client.guilds.cache.get(guildId) || null;
    const fields = events.slice(0, 8).map((event) => {
      const station = this.resolveStationForGuild(guildId, event.stationKey, language);
      const voiceChannelName = guild?.channels?.cache?.get(event.voiceChannelId)?.name || event.voiceChannelId;
      const status = !event.enabled
        ? languagePick(language, "Pausiert", "Paused")
        : languagePick(language, "Geplant", "Scheduled");
      return {
        name: clipText(`${event.name} (${event.id})`, 256),
        value: [
          `${languagePick(language, "Status", "Status")}: ${status}`,
          `${languagePick(language, "Station", "Station")}: ${station.ok ? (station.station?.name || event.stationKey) : event.stationKey}`,
          `${languagePick(language, "Start", "Start")}: ${this.formatDiscordTimestamp(event.runAtMs, "F")}`,
          `${languagePick(language, "Voice", "Voice")}: ${voiceChannelName ? `#${voiceChannelName}` : `<#${event.voiceChannelId}>`}`,
        ].join("\n"),
        inline: false,
      };
    });

    embed.addFields(fields);
    if (events.length > fields.length) {
      embed.addFields({
        name: languagePick(language, "Weitere Events", "More events"),
        value: languagePick(
          language,
          `${events.length - fields.length} weitere Events sind vorhanden. Nutze \`/event edit\` oder \`/event delete\` mit der Event-ID.`,
          `${events.length - fields.length} more events exist. Use \`/event edit\` or \`/event delete\` with the event ID.`
        ),
        inline: false,
      });
    }
    return embed;
  }

  parseEventWindowInput({
    startRaw = undefined,
    startDateRaw = undefined,
    startTimeRaw = undefined,
    endRaw = undefined,
    endDateRaw = undefined,
    endTimeRaw = undefined,
    baseRunAtMs = 0,
    baseDurationMs = 0,
    requestedTimeZone = "",
    allowImmediate = false,
  } = {}, language = "de") {
    const now = Date.now();
    let runAtMs = Number.parseInt(String(baseRunAtMs || 0), 10);
    let timeZone = normalizeEventTimeZone(requestedTimeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;

    const hasStartInput = [startRaw, startDateRaw, startTimeRaw].some((value) => String(value || "").trim());
    if (hasStartInput) {
      const parsedStart = buildEventDateTimeFromParts({
        rawDateTime: startRaw,
        rawDate: startDateRaw,
        rawTime: startTimeRaw,
        language,
        preferredTimeZone: timeZone,
        fallbackRunAtMs: runAtMs || now,
        nowMs: now,
      });
      if (!parsedStart.ok) return parsedStart;
      runAtMs = parsedStart.runAtMs;
      timeZone = parsedStart.timeZone || timeZone;
    }

    if (!Number.isFinite(runAtMs) || runAtMs <= 0) {
      return { ok: false, message: languagePick(language, "Startzeit fehlt oder ist ungueltig.", "Start time is missing or invalid.") };
    }

    let durationMs = Math.max(0, Number.parseInt(String(baseDurationMs || 0), 10) || 0);
    let endAtMs = durationMs > 0 ? runAtMs + durationMs : 0;

    const hasEndInput = [endRaw, endDateRaw, endTimeRaw].some((value) => value !== undefined && value !== null && String(value || "").trim());
    if (hasEndInput) {
      const rawEndText = String(endRaw || "").trim().toLowerCase();
      if (["-", "clear", "none", "off"].includes(rawEndText)) {
        durationMs = 0;
        endAtMs = 0;
      } else {
        const parsedEnd = buildEventDateTimeFromParts({
          rawDateTime: endRaw,
          rawDate: endDateRaw,
          rawTime: endTimeRaw,
          language,
          preferredTimeZone: timeZone,
          fallbackRunAtMs: runAtMs,
          nowMs: now,
        });
        if (!parsedEnd.ok) return parsedEnd;
        if (parsedEnd.runAtMs <= runAtMs) {
          return {
            ok: false,
            message: languagePick(language, "Endzeit muss nach der Startzeit liegen.", "End time must be after the start time."),
          };
        }
        durationMs = parsedEnd.runAtMs - runAtMs;
        endAtMs = parsedEnd.runAtMs;
      }
    } else if (hasStartInput && durationMs > 0) {
      endAtMs = runAtMs + durationMs;
    }

    if (allowImmediate && runAtMs <= (now + 60_000) && runAtMs >= (now - 60_000)) {
      runAtMs = now;
      if (durationMs > 0) {
        endAtMs = runAtMs + durationMs;
      }
    }

    return { ok: true, runAtMs, timeZone, durationMs, endAtMs };
  }

  queueImmediateScheduledEventTick(delayMs = 250) {
    const timer = setTimeout(() => {
      this.tickScheduledEvents().catch((err) => {
        log("ERROR", `[${this.config.name}] Sofortiger Event-Start fehlgeschlagen: ${err?.message || err}`);
      });
    }, Math.max(0, delayMs));
    if (typeof timer?.unref === "function") {
      timer.unref();
    }
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
    const scheduledEndAtMs = this.getScheduledEventEndAtMs(event, scheduledRunAtMs);
    const payload = {
      name: clipText(event.name || stationName || `${BRAND.name} Event`, 100),
      scheduledStartTime: new Date(scheduledRunAtMs),
      privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
      entityType: channel.type === ChannelType.GuildStageVoice
        ? GuildScheduledEventEntityType.StageInstance
        : GuildScheduledEventEntityType.Voice,
      channel,
      description: this.buildScheduledEventServerDescription(event, stationName),
      reason: `OmniFM scheduled event ${event.id}`,
    };
    if (scheduledEndAtMs > scheduledRunAtMs) {
      payload.scheduledEndTime = new Date(scheduledEndAtMs);
    }

    const existingId = String(event.discordScheduledEventId || "").trim();
    let scheduledEvent = null;

    if (!forceCreate && existingId) {
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

  async ensureVoiceConnectionForChannel(
    guildId,
    channelId,
    state,
    { readyTimeoutMs = 20_000, confirmTimeoutMs = 8_000, confirmIntervalMs = 700 } = {},
  ) {
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

    const previousChannelId = String(state.connection?.joinConfig?.channelId || state.lastChannelId || "").trim();
    state.lastChannelId = channel.id;
    if (previousChannelId && previousChannelId !== channel.id) {
      this.markNowPlayingTargetDirty(guildId, state, channel.id);
    }

    if (state.connection) {
      const currentChannelId = state.connection.joinConfig?.channelId;
      if (currentChannelId === channel.id) {
        this.finishVoiceConnectionAttempt(state);
        state.shouldReconnect = true;
        if (channel.type === ChannelType.GuildStageVoice) {
          await this.ensureStageChannelReady(guild, channel, { createInstance: false, ensureSpeaker: true });
        }
        this.queueVoiceStateReconcile(guildId, "voice-existing", 900);
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
    this.beginVoiceConnectionAttempt(state, channel.id);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, readyTimeoutMs);
    } catch {
      this.finishVoiceConnectionAttempt(state);
      try { connection.destroy(); } catch {}
      throw new Error("Voice-Verbindung konnte nicht hergestellt werden.");
    }

    const joinedVoiceState = await this.confirmBotVoiceChannel(guildId, channel.id, {
      timeoutMs: confirmTimeoutMs,
      intervalMs: confirmIntervalMs,
    });
    if (!joinedVoiceState) {
      this.finishVoiceConnectionAttempt(state);
      try { connection.destroy(); } catch {}
      throw new Error("Voice-Verbindung ist nicht stabil genug.");
    }

    connection.subscribe(state.player);
    state.connection = connection;
    this.finishVoiceConnectionAttempt(state);
    state.reconnectAttempts = 0;
    state.lastReconnectAt = new Date().toISOString();
    state.shouldReconnect = true;
    this.clearReconnectTimer(state);
    this.attachConnectionHandlers(guildId, connection);
    networkRecoveryCoordinator.noteSuccess(`${this.config.name} voice-ready guild=${guildId}`);

    if (channel.type === ChannelType.GuildStageVoice) {
      await this.ensureStageChannelReady(guild, channel, { createInstance: false, ensureSpeaker: true });
    }

    this.queueVoiceStateReconcile(guildId, "voice-ensure", 1200);

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

    const endAtMs = Number.parseInt(String(event?.activeUntilMs || 0), 10) > 0
      ? Number.parseInt(String(event.activeUntilMs), 10)
      : this.getScheduledEventEndAtMs(event, event?.runAtMs);
    const rendered = renderEventAnnouncement(event.announceMessage, {
      event: event.name,
      station: station?.name || event.stationKey,
      voice: `<#${event.voiceChannelId}>`,
      time: formatDateTime(event.runAtMs, language, event.timeZone),
      end: endAtMs > 0 ? formatDateTime(endAtMs, language, event.timeZone) : "-",
      timeZone: normalizeEventTimeZone(event.timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE,
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
      const scheduledStopAtMs = this.getScheduledEventEndAtMs(event, event.runAtMs);
      const activeOccurrenceEvent = scheduledStopAtMs > 0
        ? { ...event, activeUntilMs: scheduledStopAtMs }
        : event;
      const eventEndLabel = scheduledStopAtMs > 0
        ? formatDateTime(scheduledStopAtMs, eventLanguage, event.timeZone)
        : "-";
      const eventTimeZone = normalizeEventTimeZone(event.timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
      let startedBy = this.config.name;
      if (this.role === "commander" && this.workerManager) {
        const guildTier = getTier(event.guildId);
        const worker = this.workerManager.findFreeWorker(event.guildId, guildTier);
        if (!worker) {
          patchScheduledEvent(event.id, { runAtMs: now + EVENT_SCHEDULER_RETRY_MS, enabled: true });
          log(
            "WARN",
            `[${this.config.name}] Event ${event.id} wartet auf freien Worker (guild=${event.guildId}, tier=${guildTier}).`
          );
          return;
        }

        const stageTopic = renderStageTopic(event.stageTopic, {
          event: event.name,
          station: stationResult.station?.name || event.stationKey,
          time: formatDateTime(event.runAtMs, eventLanguage, event.timeZone),
          end: eventEndLabel,
          timeZone: eventTimeZone,
        });
        const delegatedResult = await worker.playInGuild(
          event.guildId,
          event.voiceChannelId,
          stationResult.key,
          stationResult.stations,
          worker.getState(event.guildId).volume || 100,
          {
            stageTopic,
            guildScheduledEventId: event.discordScheduledEventId || null,
            createStageInstance: true,
            scheduledEventId: event.id,
            scheduledEventStopAtMs,
          }
        );
        if (!delegatedResult.ok) {
          throw new Error(delegatedResult.error || "Worker konnte Event nicht starten.");
        }
        startedBy = delegatedResult.workerName || worker.config.name;
      } else {
        const connectionInfo = await this.ensureVoiceConnectionForChannel(event.guildId, event.voiceChannelId, state);
        if (connectionInfo?.channel?.type === ChannelType.GuildStageVoice) {
          const stageTopic = renderStageTopic(event.stageTopic, {
            event: event.name,
            station: stationResult.station?.name || event.stationKey,
            time: formatDateTime(event.runAtMs, eventLanguage, event.timeZone),
            end: eventEndLabel,
            timeZone: eventTimeZone,
          });
          await this.ensureStageChannelReady(connectionInfo.guild, connectionInfo.channel, {
            topic: stageTopic,
            guildScheduledEventId: event.discordScheduledEventId || null,
            createInstance: true,
            ensureSpeaker: true,
          });
        }

        await this.playStation(state, stationResult.stations, stationResult.key, event.guildId);
        this.markScheduledEventPlayback(state, event.id, scheduledStopAtMs);
        this.persistState();
      }

      await this.postScheduledEventAnnouncement(activeOccurrenceEvent, stationResult.station, eventLanguage);

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
          activeUntilMs: scheduledStopAtMs > 0 ? scheduledStopAtMs : 0,
          deleteAfterStop: false,
          discordScheduledEventId: nextDiscordScheduledEventId,
        });
      } else if (scheduledStopAtMs > 0) {
        patchScheduledEvent(event.id, {
          lastRunAtMs: now,
          activeUntilMs: scheduledStopAtMs,
          enabled: true,
          deleteAfterStop: true,
        });
      } else {
        deleteScheduledEvent(event.id, { guildId: event.guildId, botId: this.config.id });
      }

      log(
        "INFO",
        `[${this.config.name}] Event gestartet: guild=${event.guildId} id=${event.id} station=${stationResult.key} via=${startedBy}`
      );
    } catch (err) {
      patchScheduledEvent(event.id, { runAtMs: now + EVENT_SCHEDULER_RETRY_MS, enabled: true });
      log(
        "ERROR",
        `[${this.config.name}] Event ${event.id} Startfehler: ${err?.message || err}`
      );
    }
  }

  async executeScheduledEventStop(event) {
    const stopAtMs = Number.parseInt(String(event?.activeUntilMs || 0), 10);
    if (!Number.isFinite(stopAtMs) || stopAtMs <= 0) return;

    let stoppedBy = null;
    let stopped = false;

    const localState = this.guildState.get(event.guildId);
    if (localState?.activeScheduledEventId === event.id) {
      const result = this.stopInGuild(event.guildId);
      stopped = Boolean(result?.ok);
      stoppedBy = this.config.name;
    }

    if (!stopped && this.workerManager) {
      const worker = this.workerManager.findWorkerByScheduledEvent(event.guildId, event.id);
      if (worker) {
        const result = worker.stopInGuild(event.guildId);
        stopped = Boolean(result?.ok);
        stoppedBy = worker.config?.name || "Worker";
      }
    }

    if (event.deleteAfterStop) {
      deleteScheduledEvent(event.id, { guildId: event.guildId, botId: this.config.id });
    } else {
      patchScheduledEvent(event.id, {
        activeUntilMs: 0,
        lastStopAtMs: Date.now(),
        deleteAfterStop: false,
      });
    }

    log(
      "INFO",
      `[${this.config.name}] Event beendet: guild=${event.guildId} id=${event.id} stopped=${stopped ? "yes" : "no"} via=${stoppedBy || "state-cleanup"}`
    );
  }

  async tickScheduledEvents() {
    if (!EVENT_SCHEDULER_ENABLED) return;
    if (!this.client.isReady()) return;

    const now = Date.now();
    const scheduled = listScheduledEvents({
      botId: this.config.id,
      includeDisabled: true,
    });
    const events = Array.isArray(scheduled) ? scheduled : [];

    for (const event of events) {
      const stopAtMs = Number.parseInt(String(event?.activeUntilMs || 0), 10);
      const alreadyStoppedAt = Number.parseInt(String(event?.lastStopAtMs || 0), 10);
      if (!Number.isFinite(stopAtMs) || stopAtMs <= 0) continue;
      if (alreadyStoppedAt >= stopAtMs) continue;
      if (stopAtMs > now + 1000) continue;
      if (this.scheduledEventInFlight.has(`${event.id}:stop`)) continue;

      this.scheduledEventInFlight.add(`${event.id}:stop`);
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.executeScheduledEventStop(event);
      } finally {
        this.scheduledEventInFlight.delete(`${event.id}:stop`);
      }
    }

    for (const event of events) {
      if (!event.enabled) continue;
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
    const guild = interaction.guild || this.client.guilds.cache.get(guildId) || await this.client.guilds.fetch(guildId).catch(() => null);
    const me = guild ? await this.resolveBotMember(guild) : null;

    if (!guild || !me) {
      await interaction.reply({
        content: t("Bot-Mitglied im Server konnte nicht geladen werden.", "Could not load the bot member in this server."),
        ephemeral: true,
      });
      return;
    }

    const validateTextChannel = (channel) => {
      if (!channel) return null;
      if (channel.guildId !== guildId) {
        return t("Der gewaehlte Text-Channel ist nicht in diesem Server.", "The selected text channel is not in this server.");
      }
      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
        return t(`Ich kann in ${channel.toString()} nicht schreiben.`, `I cannot send messages in ${channel.toString()}.`);
      }
      return null;
    };

    const validateVoiceChannel = (channel, { stageTopic = null, createDiscordEvent = false } = {}) => {
      if (!channel) {
        return t("Voice- oder Stage-Channel fehlt.", "Voice or stage channel is missing.");
      }
      if (channel.guildId !== guildId) {
        return t("Der gewaehlte Voice/Stage-Channel ist nicht in diesem Server.", "The selected voice/stage channel is not in this server.");
      }
      if (!channel.isVoiceBased() || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
        return t("Bitte waehle einen Voice- oder Stage-Channel.", "Please choose a voice or stage channel.");
      }
      if (stageTopic && channel.type !== ChannelType.GuildStageVoice) {
        return t("`stagetopic` funktioniert nur mit Stage-Channels.", "`stagetopic` only works with stage channels.");
      }
      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.Connect)) {
        return t(`Ich habe keine Connect-Berechtigung fuer ${channel.toString()}.`, `I do not have Connect permission for ${channel.toString()}.`);
      }
      if (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) {
        return t(`Ich habe keine Speak-Berechtigung fuer ${channel.toString()}.`, `I do not have Speak permission for ${channel.toString()}.`);
      }
      if (createDiscordEvent) {
        return this.validateDiscordScheduledEventPermissions(guild, channel, language);
      }
      return null;
    };

    const parseWindow = (input) => this.parseEventWindowInput(input, language);

    if (sub === "create") {
      const name = clipText(interaction.options.getString("name", true).trim(), 120);
      const stationRaw = interaction.options.getString("station", true);
      const voiceChannel = interaction.options.getChannel("voice", true);
      const textChannel = interaction.options.getChannel("text");
      const startRaw = interaction.options.getString("start");
      const startDateRaw = interaction.options.getString("startdate");
      const startTimeRaw = interaction.options.getString("starttime");
      const endRaw = interaction.options.getString("end");
      const endDateRaw = interaction.options.getString("enddate");
      const endTimeRaw = interaction.options.getString("endtime");
      const requestedTimeZone = interaction.options.getString("timezone") || "";
      const repeat = normalizeRepeatMode(interaction.options.getString("repeat") || "none");
      const createDiscordEvent = interaction.options.getBoolean("serverevent") === true;
      const stageTopicTemplate = this.normalizeClearableText(interaction.options.getString("stagetopic"), 120);
      const message = this.normalizeClearableText(interaction.options.getString("message"), 1200);
      const description = this.normalizeClearableText(interaction.options.getString("description"), 800);

      if (!name) {
        await interaction.reply({ content: t("Eventname darf nicht leer sein.", "Event name cannot be empty."), ephemeral: true });
        return;
      }

      const voiceError = validateVoiceChannel(voiceChannel, {
        stageTopic: stageTopicTemplate,
        createDiscordEvent,
      });
      if (voiceError) {
        await interaction.reply({ content: voiceError, ephemeral: true });
        return;
      }

      const textError = validateTextChannel(textChannel);
      if (textError) {
        await interaction.reply({ content: textError, ephemeral: true });
        return;
      }

      if (![startRaw, startDateRaw, startTimeRaw].some((value) => String(value || "").trim())) {
        await interaction.reply({
          content: t(
            "Bitte gib eine Startzeit an. Nutze entweder `start` oder die Kombination aus `startdate` + `starttime`.",
            "Please provide a start time. Use either `start` or the `startdate` + `starttime` combination."
          ),
          ephemeral: true,
        });
        return;
      }

      const parsedWindow = parseWindow({
        startRaw,
        startDateRaw,
        startTimeRaw,
        endRaw,
        endDateRaw,
        endTimeRaw,
        requestedTimeZone,
        allowImmediate: !createDiscordEvent,
      });
      if (!parsedWindow.ok) {
        await interaction.reply({ content: parsedWindow.message, ephemeral: true });
        return;
      }
      if (createDiscordEvent && parsedWindow.runAtMs < Date.now() + 60_000) {
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

      if (this.role === "commander" && this.workerManager) {
        const guildTier = getTier(guildId);
        const invitedWorkers = this.workerManager.getInvitedWorkers(guildId, guildTier);
        if (invitedWorkers.length === 0) {
          await interaction.reply({
            content: t(
              "Kein geeigneter Worker-Bot ist auf diesem Server eingeladen. Bitte zuerst einen Worker mit `/invite worker:1` einladen.",
              "No eligible worker bot is invited on this server. Please invite one first with `/invite worker:1`."
            ),
            ephemeral: true,
          });
          return;
        }
      }

      const created = createScheduledEvent({
        guildId,
        botId: this.config.id,
        name,
        stationKey: station.key,
        voiceChannelId: voiceChannel.id,
        textChannelId: textChannel?.id || null,
        announceMessage: message || null,
        description: description || null,
        stageTopic: stageTopicTemplate || null,
        timeZone: parsedWindow.timeZone,
        createDiscordEvent,
        discordScheduledEventId: null,
        repeat,
        runAtMs: parsedWindow.runAtMs,
        durationMs: parsedWindow.durationMs,
        activeUntilMs: 0,
        deleteAfterStop: false,
        createdByUserId: interaction.user?.id || null,
      });

      if (!created.ok) {
        const storeMessage = translateScheduledEventStoreMessage(created.message, language);
        await interaction.reply({ content: t(`Event konnte nicht gespeichert werden: ${storeMessage}`, `Could not save event: ${storeMessage}`), ephemeral: true });
        return;
      }

      let replyEvent = created.event;
      let serverEventNote = "";
      if (createDiscordEvent) {
        try {
          const scheduledEvent = await this.syncDiscordScheduledEvent(created.event, station.station, {
            runAtMs: created.event.runAtMs,
          });
          if (scheduledEvent?.id) {
            const patched = patchScheduledEvent(created.event.id, { discordScheduledEventId: scheduledEvent.id });
            replyEvent = patched?.event || { ...created.event, discordScheduledEventId: scheduledEvent.id };
          }
        } catch (err) {
          serverEventNote = `${t("Server-Event Hinweis", "Server event note")}: ${clipText(err?.message || err, 180)}`;
          log("WARN", `[${this.config.name}] Event ${created.event.id}: Discord-Server-Event konnte nicht erstellt werden: ${err?.message || err}`);
        }
      }

      const embed = this.buildScheduledEventEmbed(replyEvent, station.station?.name || null, language, {
        titlePrefix: `${t("Event erstellt", "Event created")}: `,
      });
      if (serverEventNote) {
        embed.addFields({
          name: t("Hinweis", "Note"),
          value: clipText(serverEventNote, 800),
          inline: false,
        });
      }
      await interaction.reply({ embeds: [embed], ephemeral: true });
      if (replyEvent.runAtMs <= Date.now() + 5_000) {
        this.queueImmediateScheduledEventTick(250);
      }
      return;
    }

    if (sub === "edit") {
      const id = interaction.options.getString("id", true);
      const existing = getScheduledEvent(id);
      if (!existing || existing.guildId !== guildId || existing.botId !== this.config.id) {
        await interaction.reply({ content: t("Event nicht gefunden.", "Event not found."), ephemeral: true });
        return;
      }

      const nameRaw = interaction.options.getString("name");
      const stationRaw = interaction.options.getString("station");
      const voiceChannelOption = interaction.options.getChannel("voice");
      const startRaw = interaction.options.getString("start");
      const startDateRaw = interaction.options.getString("startdate");
      const startTimeRaw = interaction.options.getString("starttime");
      const endRaw = interaction.options.getString("end");
      const endDateRaw = interaction.options.getString("enddate");
      const endTimeRaw = interaction.options.getString("endtime");
      const timeZoneRaw = interaction.options.getString("timezone");
      const repeatRaw = interaction.options.getString("repeat");
      const textChannelOption = interaction.options.getChannel("text");
      const clearText = interaction.options.getBoolean("cleartext") === true;
      const serverEventRaw = interaction.options.getBoolean("serverevent");
      const stageTopicRaw = interaction.options.getString("stagetopic");
      const messageRaw = interaction.options.getString("message");
      const descriptionRaw = interaction.options.getString("description");
      const enabledRaw = interaction.options.getBoolean("enabled");

      const existingVoiceChannel = await guild.channels.fetch(existing.voiceChannelId).catch(() => null);
      const nextVoiceChannel = voiceChannelOption || existingVoiceChannel;
      const nextStageTopic = stageTopicRaw !== null
        ? this.normalizeClearableText(stageTopicRaw, 120)
        : existing.stageTopic;
      const nextCreateDiscordEvent = serverEventRaw !== null ? serverEventRaw === true : existing.createDiscordEvent;
      const nextTextChannel = textChannelOption
        ? textChannelOption
        : clearText
          ? null
          : (existing.textChannelId ? await guild.channels.fetch(existing.textChannelId).catch(() => null) : null);
      const nextName = nameRaw !== null ? clipText(nameRaw.trim(), 120) : existing.name;
      const nextMessage = messageRaw !== null
        ? this.normalizeClearableText(messageRaw, 1200)
        : existing.announceMessage;
      const nextDescription = descriptionRaw !== null
        ? this.normalizeClearableText(descriptionRaw, 800)
        : existing.description;

      if (!nextName) {
        await interaction.reply({ content: t("Eventname darf nicht leer sein.", "Event name cannot be empty."), ephemeral: true });
        return;
      }

      const voiceError = validateVoiceChannel(nextVoiceChannel, {
        stageTopic: nextStageTopic,
        createDiscordEvent: nextCreateDiscordEvent,
      });
      if (voiceError) {
        await interaction.reply({ content: voiceError, ephemeral: true });
        return;
      }

      const textError = validateTextChannel(nextTextChannel);
      if (textError) {
        await interaction.reply({ content: textError, ephemeral: true });
        return;
      }

      const currentDurationMs = Math.max(0, Number.parseInt(String(existing.durationMs || 0), 10) || 0);
      const hasStartChange = [startRaw, startDateRaw, startTimeRaw].some((value) => String(value || "").trim());
      const parsedWindow = parseWindow({
        startRaw,
        startDateRaw,
        startTimeRaw,
        endRaw,
        endDateRaw,
        endTimeRaw,
        baseRunAtMs: existing.runAtMs,
        baseDurationMs: currentDurationMs,
        requestedTimeZone: timeZoneRaw || existing.timeZone || "",
        allowImmediate: !nextCreateDiscordEvent,
      });
      if (!parsedWindow.ok) {
        await interaction.reply({ content: parsedWindow.message, ephemeral: true });
        return;
      }
      if (nextCreateDiscordEvent && (hasStartChange || serverEventRaw === true) && parsedWindow.runAtMs < Date.now() + 60_000) {
        await interaction.reply({
          content: t(
            "Mit `serverevent` muss die Startzeit mindestens 60 Sekunden in der Zukunft liegen.",
            "With `serverevent`, start time must be at least 60 seconds in the future."
          ),
          ephemeral: true,
        });
        return;
      }

      let resolvedStation = this.resolveStationForGuild(guildId, existing.stationKey, language);
      if (stationRaw) {
        resolvedStation = this.resolveStationForGuild(guildId, stationRaw, language);
        if (!resolvedStation.ok) {
          await interaction.reply({ content: resolvedStation.message, ephemeral: true });
          return;
        }
      } else if (!resolvedStation.ok) {
        resolvedStation = { ok: true, key: existing.stationKey, station: null };
      }

      const eventIsActive = Number.parseInt(String(existing.activeUntilMs || 0), 10) > Date.now()
        && Number.parseInt(String(existing.lastStopAtMs || 0), 10) < Number.parseInt(String(existing.activeUntilMs || 0), 10);

      const patchPayload = {
        name: nextName,
        stationKey: resolvedStation.key,
        voiceChannelId: nextVoiceChannel.id,
        textChannelId: nextTextChannel?.id || null,
        announceMessage: nextMessage || null,
        description: nextDescription || null,
        stageTopic: nextStageTopic || null,
        timeZone: parsedWindow.timeZone,
        createDiscordEvent: nextCreateDiscordEvent,
        repeat: repeatRaw ? normalizeRepeatMode(repeatRaw) : existing.repeat,
        runAtMs: parsedWindow.runAtMs,
        durationMs: parsedWindow.durationMs,
        activeUntilMs: eventIsActive ? parsedWindow.endAtMs : 0,
        enabled: enabledRaw === null ? existing.enabled : enabledRaw === true,
      };

      const updated = patchScheduledEvent(existing.id, patchPayload);
      if (!updated.ok) {
        await interaction.reply({
          content: translateScheduledEventStoreMessage(updated.message, language),
          ephemeral: true,
        });
        return;
      }

      let replyEvent = updated.event;
      let serverEventNote = "";
      if (!nextCreateDiscordEvent && existing.discordScheduledEventId) {
        await this.deleteDiscordScheduledEventById(guildId, existing.discordScheduledEventId).catch(() => null);
        const cleared = patchScheduledEvent(existing.id, { discordScheduledEventId: null });
        replyEvent = cleared?.event || { ...replyEvent, discordScheduledEventId: null };
      } else if (nextCreateDiscordEvent) {
        try {
          const scheduledEvent = await this.syncDiscordScheduledEvent(replyEvent, resolvedStation.station || { name: replyEvent.stationKey }, {
            runAtMs: replyEvent.runAtMs,
          });
          if (scheduledEvent?.id) {
            const synced = patchScheduledEvent(existing.id, { discordScheduledEventId: scheduledEvent.id });
            replyEvent = synced?.event || { ...replyEvent, discordScheduledEventId: scheduledEvent.id };
          }
        } catch (err) {
          serverEventNote = `${t("Server-Event Hinweis", "Server event note")}: ${clipText(err?.message || err, 180)}`;
          log("WARN", `[${this.config.name}] Event ${existing.id}: Discord-Server-Event Sync fehlgeschlagen: ${err?.message || err}`);
        }
      }

      const embed = this.buildScheduledEventEmbed(replyEvent, resolvedStation.station?.name || null, language, {
        titlePrefix: `${t("Event aktualisiert", "Event updated")}: `,
      });
      if (serverEventNote) {
        embed.addFields({
          name: t("Hinweis", "Note"),
          value: clipText(serverEventNote, 800),
          inline: false,
        });
      }
      await interaction.reply({ embeds: [embed], ephemeral: true });
      if (replyEvent.enabled && replyEvent.runAtMs <= Date.now() + 5_000) {
        this.queueImmediateScheduledEventTick(250);
      }
      return;
    }

    if (sub === "list") {
      const events = listScheduledEvents({
        guildId,
        botId: this.config.id,
        includeDisabled: true,
      });

      if (!events.length) {
        await interaction.reply({ content: t("Keine geplanten Events.", "No scheduled events."), ephemeral: true });
        return;
      }

      await interaction.reply({
        embeds: [this.buildScheduledEventsListEmbed(events, guildId, language)],
        ephemeral: true,
      });
      return;
    }

    if (sub === "delete") {
      const id = interaction.options.getString("id", true);
      const existing = getScheduledEvent(id);
      if (!existing || existing.guildId !== guildId || existing.botId !== this.config.id) {
        await interaction.reply({ content: t("Event nicht gefunden.", "Event not found."), ephemeral: true });
        return;
      }

      if (Number.parseInt(String(existing.activeUntilMs || 0), 10) > Date.now()
        && Number.parseInt(String(existing.lastStopAtMs || 0), 10) < Number.parseInt(String(existing.activeUntilMs || 0), 10)
      ) {
        await this.executeScheduledEventStop({ ...existing, deleteAfterStop: false });
      }

      let removedDiscordEvent = false;
      if (existing.discordScheduledEventId) {
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
        `Tipp: Mit \`/language set value:${clientLanguage}\` kannst du OmniFM für diesen Server fest auf \`${clientLanguage}\` stellen.`,
        `Tip: Use \`/language set value:${clientLanguage}\` to force OmniFM to \`${clientLanguage}\` for this server.`
      )}`
      : "";

    if (sub === "show") {
      await interaction.reply({
        content:
          `**${t("OmniFM Sprache", "OmniFM language")}**\n` +
          `${t("Aktiv", "Active")}: \`${effectiveLanguage}\`\n` +
          `${t("Quelle", "Source")}: ${override ? t("Manuell gesetzt", "Manually set") : t("Discord-Server oder Client-Sprache", "Discord server or client locale")}\n` +
          `${t("Deine Discord-Client-Sprache", "Your Discord client language")}: \`${clientLanguage}\`` +
          suggestOverride,
        ephemeral: true,
      });
      return;
    }

    if (!this.hasGuildManagePermissions(interaction)) {
      await interaction.reply({
        content: t(
          "Du brauchst die Berechtigung `Server verwalten` für `/language set` und `/language reset`.",
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
          `Sprache für diesen Server wurde auf \`${value}\` gesetzt.`,
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
            `Manuelle Sprache entfernt. OmniFM nutzt jetzt wieder Discord-Server oder Client-Sprache (\`${next}\`).`,
            `Manual language override removed. OmniFM now uses the Discord server or client locale again (\`${next}\`).`
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
        this.finishVoiceConnectionAttempt(state);
        if (channel.type === ChannelType.GuildStageVoice) {
          await this.ensureStageChannelReady(guild, channel, { createInstance: true, ensureSpeaker: true });
        }
        this.queueVoiceStateReconcile(guildId, "voice-existing", 900);
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
    this.beginVoiceConnectionAttempt(state, channel.id);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      this.finishVoiceConnectionAttempt(state);
      connection.destroy();
      return sendError(t("Konnte dem Voice-Channel nicht beitreten.", "Could not join the voice channel."));
    }

    const joinedVoiceState = await this.confirmBotVoiceChannel(guildId, channel.id, { timeoutMs: 8_000, intervalMs: 700 });
    if (!joinedVoiceState) {
      this.finishVoiceConnectionAttempt(state);
      try { connection.destroy(); } catch {}
      return sendError(t("Voice-Verbindung war instabil. Bitte erneut versuchen.", "Voice connection was unstable. Please try again."));
    }

    connection.subscribe(state.player);
    state.connection = connection;
    this.finishVoiceConnectionAttempt(state);
    state.reconnectAttempts = 0;
    state.lastReconnectAt = new Date().toISOString();
    this.clearReconnectTimer(state);
    networkRecoveryCoordinator.noteSuccess(`${this.config.name} voice-ready guild=${guildId}`);

    this.attachConnectionHandlers(guildId, connection);
    if (channel.type === ChannelType.GuildStageVoice) {
      await this.ensureStageChannelReady(guild, channel, { createInstance: true, ensureSpeaker: true });
    }
    this.queueVoiceStateReconcile(guildId, "voice-joined", 1200);
    return { connection, error: null };
  }

  async tryReconnect(guildId) {
    const state = this.getState(guildId);
    if (!state.shouldReconnect || !state.lastChannelId) return;
    if (this.isScheduledEventStopDue(state.activeScheduledEventStopAtMs)) {
      this.stopInGuild(guildId);
      return;
    }

    const networkCooldownMs = networkRecoveryCoordinator.getRecoveryDelayMs();
    if (networkCooldownMs > 0) {
      log(
        "INFO",
        `[${this.config.name}] Reconnect fuer guild=${guildId} verschoben (Netz-Cooldown ${Math.round(networkCooldownMs)}ms)`
      );
      return;
    }

    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      this.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
      return;
    }

    const channel = await guild.channels.fetch(state.lastChannelId).catch(() => null);
    if (!channel || !channel.isVoiceBased()) {
      log("WARN", `[${this.config.name}] Reconnect abgebrochen: Voice-Channel fehlt guild=${guildId} channel=${state.lastChannelId || "-"}`);
      this.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
      return;
    }

    const me = await this.resolveBotMember(guild);
    const perms = me ? channel.permissionsFor(me) : null;
    if (!me || !perms?.has(PermissionFlagsBits.Connect) || (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak))) {
      log("WARN", `[${this.config.name}] Reconnect abgebrochen: Rechte fehlen guild=${guildId} channel=${channel.id}`);
      this.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
      return;
    }

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
    this.beginVoiceConnectionAttempt(state, channel.id);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      this.finishVoiceConnectionAttempt(state);
      networkRecoveryCoordinator.noteFailure(`${this.config.name} reconnect-timeout`, `guild=${guildId}`);
      try { connection.destroy(); } catch {}
      return;
    }

    const joinedVoiceState = await this.confirmBotVoiceChannel(guildId, channel.id, { timeoutMs: 8_000, intervalMs: 700 });
    if (!joinedVoiceState) {
      this.finishVoiceConnectionAttempt(state);
      networkRecoveryCoordinator.noteFailure(`${this.config.name} reconnect-ghost`, `guild=${guildId}`);
      try { connection.destroy(); } catch {}
      return;
    }

    connection.subscribe(state.player);
    state.connection = connection;
    this.finishVoiceConnectionAttempt(state);
    state.reconnectAttempts = 0;
    state.lastReconnectAt = new Date().toISOString();
    this.clearReconnectTimer(state);
    this.attachConnectionHandlers(guildId, connection);
    networkRecoveryCoordinator.noteSuccess(`${this.config.name} rejoin-ready guild=${guildId}`);
    if (channel.type === ChannelType.GuildStageVoice) {
      await this.ensureStageChannelReady(guild, channel, { createInstance: true, ensureSpeaker: true });
    }
    this.queueVoiceStateReconcile(guildId, "voice-rejoin", 1200);

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
    if (this.isVoiceConnectionAttemptActive(state)) return;
    if (this.isScheduledEventStopDue(state.activeScheduledEventStopAtMs)) {
      this.stopInGuild(guildId);
      return;
    }
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
      const boundedNetworkCooldownMs = Math.min(networkCooldownMs, Math.max(baseDelay * 6, 30_000));
      delay = Math.max(delay, boundedNetworkCooldownMs);
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
    const workerSlot = this.role === "worker"
      ? Number(this.workerSlot || 0)
      : null;
    const withinBotLimit = isWithinWorkerPlanLimit({
      role: this.role,
      workerSlot,
      botIndex,
      maxBots,
    });

    return {
      allowed: tierAllowed && withinBotLimit,
      guildTier,
      requiredTier,
      tierAllowed,
      botIndex,
      workerSlot,
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
      botLimitEmbed(
        access.guildTier,
        access.maxBots,
        access.workerSlot || access.botIndex,
        this.resolveInteractionLanguage(interaction)
      )
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

      if (focused.name === "station" || focused.name === "fallback") {
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
          includeDisabled: true,
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

    if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
      const handled = await this.handleComponentInteraction(interaction);
      if (handled) return;
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
      recordCommandUsage(interaction.guildId, interaction.commandName);
      const payload = this.buildHelpMessage(interaction);
      await this.respondInteraction(interaction, { ...payload, ephemeral: true });
      return;
    }

    if (interaction.commandName === "language") {
      recordCommandUsage(interaction.guildId, interaction.commandName);
      await this.handleLanguageCommand(interaction);
      return;
    }

    if (interaction.commandName === "perm") {
      recordCommandUsage(interaction.guildId, interaction.commandName);
      await this.handlePermissionCommand(interaction);
      return;
    }

    const commandPermission = this.checkCommandRolePermission(interaction, interaction.commandName);
    if (!commandPermission.ok) {
      await interaction.reply({ content: commandPermission.message, ephemeral: true });
      return;
    }

    recordCommandUsage(interaction.guildId, interaction.commandName);

    if (interaction.commandName === "event") {
      await this.handleEventCommand(interaction);
      return;
    }

    if (interaction.commandName === "stats") {
      await interaction.reply({
        ...this.buildListeningStatsPayload(interaction.guildId, language),
        ephemeral: true,
      });
      return;
    }

    // ---- Commander-only commands ----
    if (interaction.commandName === "invite") {
      if (this.role !== "commander" || !this.workerManager) {
        await interaction.reply({ content: t("Dieser Befehl ist nur fuer den Commander-Bot.", "This command is only for the commander bot."), ephemeral: true });
        return;
      }

      const guildId = String(interaction.guildId || "").trim();
      if (!guildId) {
        await interaction.reply({
          content: t(
            "Dieser Befehl funktioniert nur auf einem Discord-Server (nicht in DMs).",
            "This command only works inside a Discord server (not in DMs)."
          ),
          ephemeral: true,
        });
        return;
      }

      // Accepts both current option name (`worker`) and legacy name (`bot`).
      const workerIndex = this.getIntegerOptionFlexible(interaction, ["worker", "bot"]);
      if (!Number.isInteger(workerIndex)) {
        const payload = await this.buildInviteMenuPayload(interaction);
        await interaction.reply({ ...payload, ephemeral: true });
        return;
      }

      const guildTier = getTier(guildId);
      const maxIndex = this.workerManager.getMaxWorkerIndex(guildTier);

      if (workerIndex < 1 || workerIndex > 16) {
        await interaction.reply({ content: t("Worker-Nummer muss zwischen 1 und 16 sein.", "Worker number must be between 1 and 16."), ephemeral: true });
        return;
      }

      const resolvedWorker = this.workerManager.resolveWorker(workerIndex);
      if (!resolvedWorker?.worker) {
        await interaction.reply({ content: t(`Worker ${workerIndex} ist nicht konfiguriert.`, `Worker ${workerIndex} is not configured.`), ephemeral: true });
        return;
      }
      const workerSlot = Number(resolvedWorker.workerSlot || 0);
      if (!workerSlot || workerSlot > maxIndex) {
        const requiredTier = this.formatTierLabel(this.getWorkerRequiredTierBySlot(workerSlot || workerIndex), language);
        await interaction.reply({
          content: t(
            `Worker ${workerIndex} erfordert mindestens **${requiredTier}**. Dein Plan erlaubt Worker 1-${maxIndex}.`,
            `Worker ${workerIndex} requires at least **${requiredTier}**. Your plan allows workers 1-${maxIndex}.`
          ),
          ephemeral: true,
        });
        return;
      }

      const worker = resolvedWorker.worker;

      const clientId = worker.getApplicationId() || worker.config.clientId;
      const inviteUrl = buildInviteUrl({
        ...worker.config,
        clientId,
      });
      const guild = interaction.guild || this.client.guilds.cache.get(guildId) || null;
      const alreadyInvited = await this.isWorkerAlreadyInvited(guild, worker);

      if (alreadyInvited) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(INVITE_COMPONENT_ID_OPEN)
            .setStyle(ButtonStyle.Secondary)
            .setLabel(t("Anderen Worker waehlen", "Select another worker"))
        );
        await interaction.reply({
          content: t(
            `**${worker.config.name}** ist bereits auf diesem Server!`,
            `**${worker.config.name}** is already on this server!`
          ),
          components: [row],
          ephemeral: true,
        });
      } else {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setStyle(ButtonStyle.Link)
            .setLabel(t(`Invite ${worker.config.name}`, `Invite ${worker.config.name}`))
            .setURL(inviteUrl),
          new ButtonBuilder()
            .setCustomId(INVITE_COMPONENT_ID_OPEN)
            .setStyle(ButtonStyle.Secondary)
            .setLabel(t("Menue", "Menu"))
        );
        await interaction.reply({
          content: t(
            `Worker **${worker.config.name}** bereit zum Einladen.`,
            `Worker **${worker.config.name}** ready to invite.`
          ),
          components: [row],
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

      const guildId = String(interaction.guildId || "").trim();
      if (!guildId) {
        await interaction.reply({
          content: t(
            "Dieser Befehl funktioniert nur auf einem Discord-Server (nicht in DMs).",
            "This command only works inside a Discord server (not in DMs)."
          ),
          ephemeral: true,
        });
        return;
      }
      const payload = await this.buildWorkersStatusPayload(interaction);
      await interaction.reply({ ...payload, ephemeral: true });
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
      const guildTier = getTier(interaction.guildId);
      if ((TIER_RANK[guildTier] ?? 0) < (TIER_RANK.pro ?? 1)) {
        await interaction.reply({
          content: t(
            "`/now` ist ab **Pro** verfügbar. Upgrade: https://omnifm.xyz#premium",
            "`/now` is available with **Pro** and above. Upgrade: https://omnifm.xyz#premium"
          ),
          ephemeral: true,
        });
        return;
      }

      const playback = await this.resolveStreamingRuntimeForInteraction(interaction);
      if (!playback.runtime || !playback.state) {
        await interaction.reply({
          content: this.getStreamingRuntimeSelectionMessage(playback.reason, language),
          ephemeral: true
        });
        return;
      }

      const activeRuntime = playback.runtime;
      const activeState = playback.state;
      const playingGuilds = activeRuntime.getPlayingGuildCount();
      const current = activeRuntime.getResolvedCurrentStation(interaction.guildId, activeState, language);
      if (!current?.station) {
        await interaction.reply({ content: t("Aktuelle Station wurde entfernt.", "Current station was removed."), ephemeral: true });
        return;
      }

      const channelId = activeState.connection?.joinConfig?.channelId || activeState.lastChannelId || null;
      const meta = activeState.currentMeta || {};
      const embed = activeRuntime.buildNowPlayingEmbed(interaction.guildId, current.station, {
        ...meta,
        name: meta.name || current.station.name || null,
      }, {
        channelId,
        listenerCount: activeRuntime.getCurrentListenerCount(interaction.guildId, activeState),
        workerName: activeRuntime.config?.name || BRAND.name,
      });
      embed.addFields(
        {
          name: t("Aktiv auf", "Active on"),
          value: `${playingGuilds} ${t(`Server${playingGuilds === 1 ? "" : "n"}`, `server${playingGuilds === 1 ? "" : "s"}`)}`,
          inline: true,
        }
      );

      await interaction.reply({
        embeds: [embed],
        components: activeRuntime.buildTrackLinkComponents(interaction.guildId, current.station, meta),
        ephemeral: true,
      });
      return;
    }

    if (interaction.commandName === "history") {
      const guildTier = getTier(interaction.guildId);
      if ((TIER_RANK[guildTier] ?? 0) < (TIER_RANK.pro ?? 1)) {
        await interaction.reply({
          content: t(
            "Song-History ist ab **Pro** verf\u00FCgbar. Upgrade: https://omnifm.xyz#premium",
            "Song history is available with **Pro** and above. Upgrade: https://omnifm.xyz#premium"
          ),
          ephemeral: true
        });
        return;
      }

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

      const playback = await this.resolveStreamingRuntimeForInteraction(interaction);
      const requestedLimit = interaction.options.getInteger("limit") || 10;
      const limit = Math.max(1, Math.min(20, requestedLimit));
      const history = getSongHistory(interaction.guildId, { limit });

      if (!history.length) {
        await interaction.reply({
          content: t(
            "Noch keine Song-History verfügbar. Starte zuerst eine Station mit `/play`.",
            "No song history yet. Start a station with `/play` first."
          ),
          ephemeral: true
        });
        return;
      }

      const payload = this.buildSongHistoryEmbed(history, interaction.guildId, playback.runtime, language);
      await interaction.reply({ ...payload, ephemeral: true });
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
      const stopAll = interaction.options.getBoolean("all");
      
      if (this.role === "commander" && this.workerManager) {
        const guildId = interaction.guildId;
        let workers = [];
        
        // Priorität 1: Explizit bot: Parameter
        if (requestedBot) {
          const worker = this.workerManager.getWorkerByIndex(requestedBot);
          if (worker) workers = [worker];
        }
        // Priorität 2: all: true Parameter
        else if (stopAll) {
          workers = this.workerManager.getStreamingWorkers(guildId);
        }
        // Priorität 3: User im Voice-Channel → stoppe nur Worker in diesem Channel
        else {
          const guild = interaction.guild || this.client.guilds.cache.get(guildId);
          const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
          const userChannelId = String(member?.voice?.channelId || "").trim();
          
          if (userChannelId) {
            // User ist in Channel → stoppe nur Worker in diesem Channel
            const allStreamingWorkers = this.workerManager.getStreamingWorkers(guildId);
            const matchingWorkers = allStreamingWorkers.filter((worker) => {
              const info = worker.getGuildInfo(guildId);
              return String(info?.channelId || "").trim() === userChannelId;
            });
            workers = matchingWorkers.length > 0 ? matchingWorkers : allStreamingWorkers.slice(0, 1);
          } else {
            // User nicht im Channel → Error
            await interaction.reply({
              content: t(
                "Du musst in einem Voice-Channel sein oder `/stop bot:<nummer>` / `/stop all:true` nutzen.",
                "You must be in a voice channel or use `/stop bot:<number>` / `/stop all:true`."
              ),
              ephemeral: true
            });
            return;
          }
        }
        
        if (workers.length === 0) {
          await interaction.reply({ content: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."), ephemeral: true });
          return;
        }
        
        for (const w of workers) w.stopInGuild(guildId);
        const workerNames = workers.map(w => w.config?.name || "Worker").join(", ");
        await interaction.reply({
          content: t(
            `Gestoppt: ${workerNames}`,
            `Stopped: ${workerNames}`
          ),
          ephemeral: true
        });
        return;
      }
      
      // Worker/Legacy Mode: lokaler Stop
      this.syncVoiceChannelStatus(interaction.guildId, "").catch(() => null);
      state.shouldReconnect = false;
      this.finishVoiceConnectionAttempt(state);
      this.clearScheduledEventPlayback(state);
      this.flushListeningStatsSample(interaction.guildId, state);
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      this.queueDeleteNowPlayingMessage(interaction.guildId, state);
      state.player.stop();
      this.clearCurrentProcess(state);

      if (state.connection) {
        state.connection.destroy();
        state.connection = null;
      }

      state.currentStationKey = null;
      state.currentFallbackKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.nowPlayingSignature = null;
      state.lastListenerStatsSampleAt = 0;
      state.reconnectAttempts = 0;
      state.streamErrorCount = 0;
      this.updatePresence();
      this.persistState();

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
        const requestedBot = this.getIntegerOptionFlexible(interaction, ["bot", "worker"]);
        const guildTier = getTier(interaction.guildId);
        let targetWorkers = [];

        if (Number.isInteger(requestedBot)) {
          const check = this.workerManager.canUseWorker(requestedBot, interaction.guildId, guildTier);
          if (!check.ok) {
            const reasons = {
              tier: t(`Worker ${requestedBot} erfordert ein hoeheres Abo (max: ${check.maxIndex}).`, `Worker ${requestedBot} requires a higher plan (max: ${check.maxIndex}).`),
              not_configured: t(`Worker ${requestedBot} ist nicht konfiguriert.`, `Worker ${requestedBot} is not configured.`),
              offline: t(`Worker ${requestedBot} ist offline.`, `Worker ${requestedBot} is offline.`),
              not_invited: t(`Worker ${requestedBot} ist nicht auf diesem Server eingeladen.`, `Worker ${requestedBot} is not invited on this server.`),
            };
            await interaction.reply({ content: reasons[check.reason] || t("Worker nicht verfügbar.", "Worker not available."), ephemeral: true });
            return;
          }
          const info = check.worker.getGuildInfo(interaction.guildId);
          if (!info?.playing) {
            await interaction.reply({
              content: t(
                `Worker ${requestedBot} streamt aktuell nicht auf diesem Server.`,
                `Worker ${requestedBot} is not currently streaming on this server.`
              ),
              ephemeral: true,
            });
            return;
          }
          targetWorkers = [check.worker];
        } else {
          const workers = this.workerManager.getStreamingWorkers(interaction.guildId);
          if (workers.length === 0) {
            await interaction.reply({ content: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."), ephemeral: true });
            return;
          }

          const guild = interaction.guild || this.client.guilds.cache.get(interaction.guildId);
          const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
          const userChannelId = String(member?.voice?.channelId || "").trim();
          if (userChannelId) {
            const matchingByChannel = workers.filter((worker) => {
              const info = worker.getGuildInfo(interaction.guildId);
              return String(info?.channelId || "").trim() === userChannelId;
            });
            if (matchingByChannel.length === 1) {
              targetWorkers = matchingByChannel;
            }
          }

          if (targetWorkers.length === 0 && workers.length === 1) {
            targetWorkers = workers;
          }
          if (targetWorkers.length === 0 && workers.length > 1) {
            await interaction.reply({
              content: t(
                "Mehrere Worker streamen aktuell. Nutze `/setvolume <value> bot:<nummer>` oder tritt dem Ziel-Voice-Channel bei.",
                "Multiple workers are currently streaming. Use `/setvolume <value> bot:<number>` or join the target voice channel."
              ),
              ephemeral: true,
            });
            return;
          }
        }

        if (targetWorkers.length === 0) {
          await interaction.reply({ content: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."), ephemeral: true });
          return;
        }
        for (const worker of targetWorkers) {
          worker.setVolumeInGuild(interaction.guildId, value);
        }
        const targetNames = targetWorkers.map((worker) => worker.config?.name || "Worker").join(", ");
        await interaction.reply({
          content: t(
            `Lautstärke gesetzt: ${value} (${targetNames})`,
            `Volume set to: ${value} (${targetNames})`
          ),
          ephemeral: true
        });
        return;
      }
      state.volume = value;
      const resource = state.player.state.resource;
      if (resource?.volume) {
        resource.volume.setVolume(clampVolume(value));
      }
      await interaction.reply({ content: t(`Lautstärke gesetzt: ${value}`, `Volume set to: ${value}`), ephemeral: true });
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
        lines.push("", t(`Upgrade auf ${BRAND.name} Pro/Ultimate für höhere Qualität!`, `Upgrade to ${BRAND.name} Pro/Ultimate for higher quality!`));
        lines.push(t("Infos & Support: https://discord.gg/UeRkfGS43R", "Info & support: https://discord.gg/UeRkfGS43R"));
      } else {
        lines.push("", "Support: https://discord.gg/UeRkfGS43R");
      }
      await interaction.reply({ content: lines.join("\n"), ephemeral: true });
      return;
    }

    if (interaction.commandName === "health") {
      const playback = await this.resolveStreamingRuntimeForInteraction(interaction);
      if (!playback.runtime || !playback.state) {
        await interaction.reply({ content: this.getStreamingRuntimeSelectionMessage(playback.reason, language), ephemeral: true });
        return;
      }
      const activeRuntime = playback.runtime;
      const activeState = playback.state;
      const networkHoldMs = networkRecoveryCoordinator.getRecoveryDelayMs();
      const content = [
        `Bot: ${activeRuntime.config.name}`,
        `Ready: ${activeRuntime.client.isReady() ? t("ja", "yes") : t("nein", "no")}`,
        `${t("Letzter Stream-Fehler", "Last stream error")}: ${activeState.lastStreamErrorAt || "-"}`,
        `${t("Stream-Fehler (Reihe)", "Stream errors (streak)")}: ${activeState.streamErrorCount || 0}`,
        `${t("Letzter ffmpeg Exit-Code", "Last ffmpeg exit code")}: ${activeState.lastProcessExitCode ?? "-"}`,
        `Reconnects: ${activeState.reconnectCount}`,
        `${t("Letzter Reconnect", "Last reconnect")}: ${activeState.lastReconnectAt || "-"}`,
        `${t("Auto-Reconnect aktiv", "Auto reconnect enabled")}: ${activeState.shouldReconnect ? t("ja", "yes") : t("nein", "no")}`,
        `${t("Netz-Cooldown", "Network cooldown")}: ${networkHoldMs > 0 ? `${t("ja", "yes")} (${Math.round(networkHoldMs)}ms)` : t("nein", "no")}`
      ].join("\n");

      await interaction.reply({ content, ephemeral: true });
      return;
    }

    if (interaction.commandName === "diag") {
      const playback = await this.resolveStreamingRuntimeForInteraction(interaction);
      if (!playback.runtime || !playback.state) {
        await interaction.reply({ content: this.getStreamingRuntimeSelectionMessage(playback.reason, language), ephemeral: true });
        return;
      }
      const activeRuntime = playback.runtime;
      const activeState = playback.state;
      const connected = activeState.connection ? t("ja", "yes") : t("nein", "no");
      const channelId = activeState.connection?.joinConfig?.channelId || activeState.lastChannelId || "-";
      const station = activeState.currentStationKey || "-";
      const diag = activeRuntime.getStreamDiagnostics(interaction.guildId, activeState);
      const restartPending = activeState.streamRestartTimer ? t("ja", "yes") : t("nein", "no");
      const reconnectPending = activeState.reconnectTimer ? t("ja", "yes") : t("nein", "no");
      const networkHoldMs = networkRecoveryCoordinator.getRecoveryDelayMs();

      const content = [
        `Bot: ${activeRuntime.config.name}`,
        `Server: ${interaction.guild?.name || interaction.guildId}`,
        `Plan: ${diag.tier.toUpperCase()} | preset=${diag.preset} | transcode=${diag.transcodeEnabled ? "on" : "off"} (${diag.transcodeMode})`,
        `Bitrate Ziel: ${diag.bitrateOverride || "-"} (${diag.requestedBitrateKbps}k) | Profil: ${diag.profile}`,
        `FFmpeg Buffer: queue=${diag.queue} probe=${diag.probeSize} analyzeUs=${diag.analyzeUs}`,
        `Verbunden: ${connected} | Channel: ${channelId} | Station: ${station}`,
        `Stream-Laufzeit: ${diag.streamLifetimeSec}s | Errors in Reihe: ${activeState.streamErrorCount || 0}`,
        `Restart geplant: ${restartPending} | Reconnect geplant: ${reconnectPending}`,
        `Netz-Cooldown: ${networkHoldMs > 0 ? `${Math.round(networkHoldMs)}ms` : "0ms"}`,
      ].join("\n");

      await interaction.reply({ content, ephemeral: true });
      return;
    }

    if (interaction.commandName === "status") {
      const playback = await this.resolveStreamingRuntimeForInteraction(interaction);
      if (!playback.runtime || !playback.state) {
        await interaction.reply({ content: this.getStreamingRuntimeSelectionMessage(playback.reason, language), ephemeral: true });
        return;
      }
      const activeRuntime = playback.runtime;
      const activeState = playback.state;
      const connected = activeState.connection ? t("ja", "yes") : t("nein", "no");
      const channelId = activeState.connection?.joinConfig?.channelId || activeState.lastChannelId || "-";
      const uptimeSec = Math.floor((Date.now() - activeRuntime.startedAt) / 1000);
      const load = os.loadavg().map((v) => v.toFixed(2)).join(", ");
      const mem = `${Math.round(process.memoryUsage().rss / (1024 * 1024))}MB`;
      const station = activeState.currentStationKey || "-";

      const content = [
        `Bot: ${activeRuntime.config.name}`,
        `${t("Guilds (dieser Bot)", "Guilds (this bot)")}: ${activeRuntime.client.guilds.cache.size}`,
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
      const requestedFallback = interaction.options.getString("fallback");
      const requestedVoiceChannel = interaction.options.getChannel("voice");
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

      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);
      const fallbackRequested = String(requestedFallback || "").trim();
      if (fallbackRequested && guildTier !== "ultimate") {
        await interaction.reply({
          content: t(
            "Die `/play fallback` Option ist nur im Ultimate-Plan verfuegbar.",
            "The `/play fallback` option is only available on the Ultimate plan."
          ),
          ephemeral: true,
        });
        return;
      }

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
          key = buildCustomStationReference(customKey);
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

      let explicitFallback = null;
      if (fallbackRequested) {
        explicitFallback = this.resolveStationForGuild(guildId, fallbackRequested, language);
        if (!explicitFallback.ok) {
          await interaction.reply({ content: explicitFallback.message, ephemeral: true });
          return;
        }
        if (explicitFallback.key === key) {
          await interaction.reply({
            content: t(
              "Fallback und Hauptstation muessen unterschiedlich sein.",
              "Fallback and primary station must be different."
            ),
            ephemeral: true,
          });
          return;
        }
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
        let reusingExistingWorker = false;
        if (requestedBotIndex) {
          const check = this.workerManager.canUseWorker(requestedBotIndex, guildId, guildTier);
          if (!check.ok) {
            const reasons = {
              tier: t(`Worker ${requestedBotIndex} erfordert ein hoeheres Abo (max: ${check.maxIndex}).`, `Worker ${requestedBotIndex} requires a higher plan (max: ${check.maxIndex}).`),
              not_configured: t(`Worker ${requestedBotIndex} ist nicht konfiguriert.`, `Worker ${requestedBotIndex} is not configured.`),
              offline: t(`Worker ${requestedBotIndex} ist offline.`, `Worker ${requestedBotIndex} is offline.`),
              not_invited: t(`Worker ${requestedBotIndex} ist nicht auf diesem Server. Nutze \`/invite worker:${requestedBotIndex}\` zum Einladen.`, `Worker ${requestedBotIndex} is not on this server. Use \`/invite worker:${requestedBotIndex}\` to invite.`),
            };
            await interaction.editReply(reasons[check.reason] || t("Worker nicht verfügbar.", "Worker not available."));
            return;
          }
          worker = check.worker;
        } else {
          const activeWorkerInChannel = this.workerManager.findStreamingWorkerByChannel(guildId, channelId);
          if (activeWorkerInChannel) {
            worker = activeWorkerInChannel;
            reusingExistingWorker = true;
          } else {
            const connectedWorkerInChannel = await this.workerManager.findConnectedWorkerByChannel(guildId, channelId, guildTier);
            if (connectedWorkerInChannel) {
              worker = connectedWorkerInChannel;
              reusingExistingWorker = true;
            }
          }

          if (!worker) {
            worker = this.workerManager.findFreeWorker(guildId, guildTier);
          }
        }

        if (!worker) {
          const invited = this.workerManager.getInvitedWorkers(guildId, guildTier);
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
        worker.clearScheduledEventPlaybackInGuild(guildId);
        const workerState = worker.getState(guildId);
        workerState.currentFallbackKey = explicitFallback?.key || null;
        const result = await worker.playInGuild(guildId, channelId, key, stations, state.volume || 100, {
          fallbackKey: explicitFallback?.key || null,
        });
        if (!result.ok) {
          await interaction.editReply(t(`Fehler: ${result.error}`, `Error: ${result.error}`));
          return;
        }
        const tierConfig = getTierConfig(guildId);
        const tierLabel = tierConfig.tier !== "free" ? ` [${tierConfig.name} ${tierConfig.bitrate}]` : "";
        await interaction.editReply(t(
          reusingExistingWorker
            ? `${result.workerName} wechselt auf: ${selectedStation?.name || key}${tierLabel}`
            : `${result.workerName} startet: ${selectedStation?.name || key}${tierLabel}`,
          reusingExistingWorker
            ? `${result.workerName} switching to: ${selectedStation?.name || key}${tierLabel}`
            : `${result.workerName} starting: ${selectedStation?.name || key}${tierLabel}`
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
      this.clearScheduledEventPlayback(state);
      state.currentFallbackKey = explicitFallback?.key || null;

      try {
        await this.playStation(state, stations, key, guildId);
        const tierConfig = getTierConfig(guildId);
        const tierLabel = tierConfig.tier !== "free" ? ` [${tierConfig.name} ${tierConfig.bitrate}]` : "";
        await interaction.editReply(t(`Starte: ${selectedStation?.name || key}${tierLabel}`, `Starting: ${selectedStation?.name || key}${tierLabel}`));
      } catch (err) {
        log("ERROR", `[${this.config.name}] Play error: ${err.message}`);
        state.lastStreamErrorAt = new Date().toISOString();

        const fallback = this.resolvePlaybackFallback(guildId, key, explicitFallback?.key || state.currentFallbackKey, language);
        if (fallback?.ok) {
          try {
            await this.playStation(state, fallback.stations, fallback.key, guildId);
            state.currentFallbackKey = fallback.key;
            await interaction.editReply(
              t(
                `Fehler bei ${selectedStation?.name || key}. Fallback: ${fallback.station?.name || fallback.key}`,
                `Error on ${selectedStation?.name || key}. Fallback: ${fallback.station?.name || fallback.key}`
              )
            );
            return;
          } catch (fallbackErr) {
            log("ERROR", `[${this.config.name}] Fallback error: ${fallbackErr.message}`);
            state.lastStreamErrorAt = new Date().toISOString();
          }
        }

        state.shouldReconnect = false;
        state.currentFallbackKey = null;
        this.syncVoiceChannelStatus(guildId, "").catch(() => null);
        this.clearNowPlayingTimer(state);
        this.queueDeleteNowPlayingMessage(guildId, state);
        state.player.stop();
        this.clearCurrentProcess(state);
        if (state.connection) {
          state.connection.destroy();
          state.connection = null;
        }
        state.currentStationKey = null;
        state.currentFallbackKey = null;
        state.currentStationName = null;
        state.currentMeta = null;
        state.nowPlayingSignature = null;
        state.lastListenerStatsSampleAt = 0;
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
  async playInGuild(guildId, channelId, stationKey, stationsData, volume = 100, options = {}) {
    try {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) return { ok: false, error: "Worker ist nicht auf diesem Server." };

      const state = this.getState(guildId);
      state.volume = volume;
      state.shouldReconnect = true;
      state.lastChannelId = channelId;
      state.currentFallbackKey = options?.fallbackKey || null;
      if (options?.scheduledEventId) {
        this.markScheduledEventPlayback(state, options.scheduledEventId, options?.scheduledEventStopAtMs || 0);
      } else {
        this.clearScheduledEventPlayback(state);
      }

      const connectionInfo = await this.ensureVoiceConnectionForChannel(guildId, channelId, state);
      const { channel } = connectionInfo;

      // Stage channel handling
      if (channel.type === ChannelType.GuildStageVoice) {
        await this.ensureStageChannelReady(guild, channel, {
          topic: options?.stageTopic || null,
          guildScheduledEventId: options?.guildScheduledEventId || null,
          createInstance: options?.createStageInstance !== false,
          ensureSpeaker: true,
        });
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

    this.syncVoiceChannelStatus(guildId, "").catch(() => null);
    state.shouldReconnect = false;
    this.finishVoiceConnectionAttempt(state);
    state.currentFallbackKey = null;
    this.clearScheduledEventPlayback(state);
    this.flushListeningStatsSample(guildId, state);
    this.clearReconnectTimer(state);
    this.clearNowPlayingTimer(state);
    this.queueDeleteNowPlayingMessage(guildId, state);
    state.player.stop();
    this.clearCurrentProcess(state);

    if (state.connection) {
      state.connection.destroy();
      state.connection = null;
    }

    state.currentStationKey = null;
    state.currentFallbackKey = null;
    state.currentStationName = null;
    state.currentMeta = null;
    state.nowPlayingSignature = null;
    state.lastListenerStatsSampleAt = 0;
    state.reconnectAttempts = 0;
    state.streamErrorCount = 0;
    this.updatePresence();
    this.persistState();

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
      listenerCount: this.getCurrentListenerCount(guildId, state),
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
    for (const [guildId, state] of this.guildState.entries()) {
      if (state.connection) connections += 1;
      if (state.connection && state.currentStationKey) {
        listeners += this.getCurrentListenerCount(guildId, state);
      }
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
        listenerCount: this.getCurrentListenerCount(guildId, state),
        volume: state.volume,
        playing: Boolean(state.connection && state.currentStationKey),
        meta: state.currentMeta || null,
      });
    }
    const isPremiumBot = this.config.requiredTier && this.config.requiredTier !== "free";
    const accentColor = this.config.requiredTier === "ultimate"
      ? "#BD00FF"
      : this.config.requiredTier === "pro"
        ? "#FFB800"
        : "#00F0FF";
    return {
      id: this.config.id,
      botId: this.config.id,
      index: Number(this.config.index || 0) || null,
      name: this.config.name,
      role: this.role,
      color: accentColor,
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

        const restoredStation = this.resolveStationForGuild(guildId, data.stationKey, this.resolveGuildLanguage(guildId));
        if (!restoredStation.ok) {
          log("INFO", `[${this.config.name}] Station ${data.stationKey} nicht mehr vorhanden: ${restoredStation.message}`);
          clearBotGuild(this.config.id, guildId);
          continue;
        }

        log("INFO", `[${this.config.name}] Reconnect: ${guild.name} / #${channel.name} / ${restoredStation.station.name}`);

        const state = this.getState(guildId);
        state.volume = data.volume ?? 100;
        state.shouldReconnect = true;
        state.lastChannelId = data.channelId;
        state.currentStationKey = restoredStation.key;
        state.currentFallbackKey = data.fallbackKey || null;
        state.currentStationName = restoredStation.station.name || restoredStation.key;
        state.nowPlayingMessageId = data.nowPlayingMessageId || null;
        state.nowPlayingChannelId = data.nowPlayingChannelId || null;
        if (state.nowPlayingMessageId && state.nowPlayingChannelId) {
          this.queueDeleteNowPlayingMessage(guildId, state);
        }
        this.markScheduledEventPlayback(
          state,
          data.scheduledEventId || null,
          data.scheduledEventStopAtMs || 0
        );

        try {
          await this.ensureVoiceConnectionForChannel(guildId, channel.id, state, {
            readyTimeoutMs: 30_000,
            confirmTimeoutMs: 12_000,
            confirmIntervalMs: 900,
          });
        } catch (err) {
          log("ERROR", `[${this.config.name}] Voice-Verbindung zu ${guild.name} fehlgeschlagen: ${err?.message || err}`);
          networkRecoveryCoordinator.noteFailure(`${this.config.name} restore-voice-timeout`, `guild=${guildId}`);
          this.scheduleReconnect(guildId, { reason: "restore-ready-timeout" });
          continue;
        }

        await this.playStation(state, restoredStation.stations, restoredStation.key, guildId);
        log("INFO", `[${this.config.name}] Wiederhergestellt: ${guild.name} -> ${restoredStation.station.name}`);

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
    this.stopVoiceStateReconciler();

    for (const [guildId, state] of this.guildState.entries()) {
      this.syncVoiceChannelStatus(guildId, "").catch(() => null);
      state.shouldReconnect = false;
      this.finishVoiceConnectionAttempt(state);
      state.currentFallbackKey = null;
      this.flushListeningStatsSample(guildId, state);
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      await this.deleteNowPlayingMessage(guildId, state).catch(() => null);
      state.player.stop();
      this.clearCurrentProcess(state);
      if (state.connection) {
        try { state.connection.destroy(); } catch { /* ignore */ }
        state.connection = null;
      }
      state.currentStationKey = null;
      state.currentFallbackKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.nowPlayingSignature = null;
      state.lastListenerStatsSampleAt = 0;
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
