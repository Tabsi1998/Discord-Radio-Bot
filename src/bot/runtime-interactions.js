import os from "node:os";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";

import { log } from "../lib/logging.js";
import {
  TIER_RANK,
  SONG_HISTORY_ENABLED,
  clampVolume,
  clipText,
} from "../lib/helpers.js";
import {
  resolveLanguageFromDiscordLocale,
  translateCustomStationErrorMessage,
} from "../lib/language.js";
import {
  EVENT_FALLBACK_TIME_ZONE,
  EVENT_TIME_ZONE_SUGGESTIONS,
  formatDateTime,
} from "../lib/event-time.js";
import {
  loadStations,
  resolveStation,
  getFallbackKey,
  filterStationsByTier,
  buildScopedStationsData,
} from "../stations-store.js";
import {
  getGuildStations,
  addGuildStation,
  removeGuildStation,
  countGuildStations,
  MAX_STATIONS_PER_GUILD,
  buildCustomStationReference,
  validateCustomStationUrl,
} from "../custom-stations.js";
import { getTier, requireFeature, getServerPlanConfig } from "../core/entitlements.js";
import { getSongHistory } from "../song-history-store.js";
import { recordCommandUsage } from "../listening-stats-store.js";
import { listScheduledEvents } from "../scheduled-events-store.js";
import { getDefaultLanguage } from "../i18n.js";
import { premiumStationEmbed, customStationEmbed } from "../ui/upgradeEmbeds.js";
import { buildInviteUrl } from "../bot-config.js";
import {
  getLicenseById,
  linkServerToLicense,
  unlinkServerFromLicense,
  getServerLicense,
} from "../premium-store.js";
import { PLANS, BRAND } from "../config/plans.js";
import {
  DASHBOARD_URL,
  WEBSITE_URL,
  SUPPORT_URL,
  INVITE_COMPONENT_ID_OPEN,
  withLanguageParam,
} from "./runtime-links.js";

function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

function getLicense(guildId) {
  return getServerLicense(guildId);
}

export async function handleRuntimeAutocomplete(runtime, interaction) {
  try {
    if (interaction.guildId) {
      const access = runtime.getGuildAccess(interaction.guildId);
      if (!access.allowed) {
        await interaction.respond([]);
        return;
      }
    }

    const commandPermission = runtime.checkCommandRolePermission(interaction, interaction.commandName);
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
        botId: runtime.config.id,
        includeDisabled: true,
      });
      const language = runtime.resolveInteractionLanguage(interaction);

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
    log("ERROR", `[${runtime.config.name}] Autocomplete error: ${err?.message || err}`);
    try {
      await interaction.respond([]);
    } catch {
      // interaction might have already been responded to
    }
  }
}



export async function handleRuntimeInteraction(runtime, interaction) {
  if (interaction.isAutocomplete()) {
    await runtime.handleAutocomplete(interaction);
    return;
  }

  if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
    const handled = await runtime.handleComponentInteraction(interaction);
    if (handled) return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (!interaction.guildId) {
    const isDe = resolveLanguageFromDiscordLocale(interaction?.locale, getDefaultLanguage()) === "de";
    await interaction.reply({
      content: isDe ? "Dieser Bot funktioniert nur auf Servern." : "This bot only works in servers.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const { t, language } = runtime.createInteractionTranslator(interaction);
  const unrestrictedCommands = new Set(["help", "setup", "premium", "license", "language"]);
  if (!unrestrictedCommands.has(interaction.commandName)) {
    const access = runtime.getGuildAccess(interaction.guildId);
    if (!access.allowed) {
      await runtime.replyAccessDenied(interaction, access);
      return;
    }
  }

  if (runtime.role === "commander" && runtime.workerManager?.refreshRemoteStates) {
    await runtime.workerManager.refreshRemoteStates().catch(() => null);
  }

  if (interaction.commandName === "help") {
    recordCommandUsage(interaction.guildId, interaction.commandName);
    const payload = runtime.buildHelpMessage(interaction);
    await runtime.respondInteraction(interaction, { ...payload, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "setup") {
    recordCommandUsage(interaction.guildId, interaction.commandName);
    const payload = runtime.buildSetupMessage(interaction);
    await runtime.respondInteraction(interaction, { ...payload, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "language") {
    recordCommandUsage(interaction.guildId, interaction.commandName);
    await runtime.handleLanguageCommand(interaction);
    return;
  }

  if (interaction.commandName === "perm") {
    recordCommandUsage(interaction.guildId, interaction.commandName);
    await runtime.handlePermissionCommand(interaction);
    return;
  }

  const commandPermission = runtime.checkCommandRolePermission(interaction, interaction.commandName);
  if (!commandPermission.ok) {
    await interaction.reply({ content: commandPermission.message, flags: MessageFlags.Ephemeral });
    return;
  }

  recordCommandUsage(interaction.guildId, interaction.commandName);

  if (interaction.commandName === "event") {
    await runtime.handleEventCommand(interaction);
    return;
  }

  if (interaction.commandName === "stats") {
    await interaction.reply({
      embeds: [runtime.buildListeningStatsEmbed(interaction.guildId, language)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ---- Commander-only commands ----
  if (interaction.commandName === "invite") {
    if (runtime.role !== "commander" || !runtime.workerManager) {
      await interaction.reply({ content: t("Dieser Befehl ist nur für den Commander-Bot.", "This command is only for the commander bot."), flags: MessageFlags.Ephemeral });
      return;
    }

    const guildId = String(interaction.guildId || "").trim();
    if (!guildId) {
      await interaction.reply({
        content: t(
          "Dieser Befehl funktioniert nur auf einem Discord-Server (nicht in DMs).",
          "This command only works inside a Discord server (not in DMs)."
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Accepts both current option name (`worker`) and legacy name (`bot`).
    const workerIndex = runtime.getIntegerOptionFlexible(interaction, ["worker", "bot"]);
    if (!Number.isInteger(workerIndex)) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const payload = await runtime.buildInviteMenuPayload(interaction);
      await interaction.editReply(payload);
      return;
    }

    const guildTier = getTier(guildId);
    const maxIndex = runtime.workerManager.getMaxWorkerIndex(guildTier);

    if (workerIndex < 1 || workerIndex > 16) {
      await interaction.reply({ content: t("Worker-Nummer muss zwischen 1 und 16 sein.", "Worker number must be between 1 and 16."), flags: MessageFlags.Ephemeral });
      return;
    }

    const resolvedWorker = runtime.workerManager.resolveWorker(workerIndex);
    if (!resolvedWorker?.worker) {
      await interaction.reply({ content: t(`Worker ${workerIndex} ist nicht konfiguriert.`, `Worker ${workerIndex} is not configured.`), flags: MessageFlags.Ephemeral });
      return;
    }
    const workerSlot = Number(resolvedWorker.workerSlot || 0);
    if (!workerSlot || workerSlot > maxIndex) {
      const requiredTier = runtime.formatTierLabel(runtime.getWorkerRequiredTierBySlot(workerSlot || workerIndex), language);
      await interaction.reply({
        content: t(
          `Worker ${workerIndex} erfordert mindestens **${requiredTier}**. Dein Plan erlaubt Worker 1-${maxIndex}.`,
          `Worker ${workerIndex} requires at least **${requiredTier}**. Your plan allows workers 1-${maxIndex}.`
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const worker = resolvedWorker.worker;

    const clientId = worker.getApplicationId() || worker.config.clientId;
    const inviteUrl = buildInviteUrl({
      ...worker.config,
      clientId,
    });
    const guild = interaction.guild || runtime.client.guilds.cache.get(guildId) || null;
    const alreadyInvited = await runtime.isWorkerAlreadyInvited(guild, worker);

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
        flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (interaction.commandName === "workers") {
    if (runtime.role !== "commander" || !runtime.workerManager) {
      await interaction.reply({ content: t("Dieser Befehl ist nur für den Commander-Bot.", "This command is only for the commander bot."), flags: MessageFlags.Ephemeral });
      return;
    }

    const guildId = String(interaction.guildId || "").trim();
    if (!guildId) {
      await interaction.reply({
        content: t(
          "Dieser Befehl funktioniert nur auf einem Discord-Server (nicht in DMs).",
          "This command only works inside a Discord server (not in DMs)."
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const view = String(interaction.options?.getString?.("view") || "private").trim().toLowerCase();
    if (view === "panel") {
      if (!runtime.hasGuildManagePermissions(interaction)) {
        await interaction.reply({
          content: t(
            "Du brauchst die Berechtigung `Server verwalten`, um ein öffentliches Worker-Panel zu posten.",
            "You need the `Manage Server` permission to post a public worker panel."
          ),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const channel = interaction.channel;
      if (!channel?.isTextBased?.()) {
        await interaction.reply({
          content: t(
            "In diesem Channel kann ich kein Panel posten. Nutze einen Text-Channel.",
            "I cannot post a panel in this channel. Use a text channel."
          ),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const payload = await runtime.buildWorkersStatusPayload(interaction, {
        hint: t(
          "Dieses Panel bleibt im Channel sichtbar und kann über die Buttons aktualisiert werden.",
          "This panel stays visible in the channel and can be refreshed with the buttons."
        ),
      });
      try {
        const panelMessage = await channel.send(payload);
        const createdLabel = t("Nachricht erstellt.", "Message created.");
        await interaction.reply({
          content: t(
            `Worker-Panel gepostet: ${panelMessage?.url || createdLabel}`,
            `Worker panel posted: ${panelMessage?.url || createdLabel}`
          ),
          flags: MessageFlags.Ephemeral,
        });
      } catch (err) {
        await interaction.reply({
          content: t(
            "Worker-Panel konnte nicht gepostet werden. Prüfe meine Schreibrechte in diesem Channel.",
            "Could not post the worker panel. Check my send-message permission in this channel."
          ),
          flags: MessageFlags.Ephemeral,
        });
        log("WARN", `[${runtime.config.name}] Workers panel post failed guild=${guildId} channel=${channel?.id || "-"}: ${err?.message || err}`);
      }
      return;
    }

    const payload = await runtime.buildWorkersStatusPayload(interaction);
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return;
  }

  const stations = loadStations();
  const state = runtime.getState(interaction.guildId);

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
    let content = `**${t("Verfügbare Stationen", "Available stations")}${tierLabel} (${Object.keys(available).length}):**\n${list}`;
    if (customList) content += `\n\n**${t("Custom Stationen", "Custom stations")} (${Object.keys(custom).length}):**\n${customList}`;
    await runtime.respondLongInteraction(interaction, content, { flags: MessageFlags.Ephemeral });
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
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const list = pageKeys.map(k => {
      const badge = available[k].tier !== "free" ? ` [${available[k].tier.toUpperCase()}]` : "";
      return `\`${k}\` - ${available[k].name}${badge}`;
    }).join("\n");
    await runtime.respondLongInteraction(
      interaction,
      `**${t("Stationen", "Stations")} (${t("Seite", "Page")} ${page}/${totalPages}):**\n${list}`,
      { flags: MessageFlags.Ephemeral }
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
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const playback = await runtime.resolveStreamingRuntimeForInteraction(interaction);
    if (!playback.runtime || !playback.state) {
      await interaction.reply({
        content: runtime.getStreamingRuntimeSelectionMessage(playback.reason, language),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const activeRuntime = playback.runtime;
    const activeState = playback.state;
    const playingGuilds = activeRuntime.getPlayingGuildCount();
    const current = runtime.getResolvedCurrentStation(interaction.guildId, activeState, language);
    if (!current?.station) {
      await interaction.reply({ content: t("Aktuelle Station wurde entfernt.", "Current station was removed."), flags: MessageFlags.Ephemeral });
      return;
    }

    const channelId = activeState.connection?.joinConfig?.channelId || activeState.lastChannelId || null;
    const meta = activeState.currentMeta || {};
    const embed = runtime.buildNowPlayingEmbed(interaction.guildId, current.station, {
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
      components: runtime.buildTrackLinkComponents(interaction.guildId, current.station, meta),
      flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (!SONG_HISTORY_ENABLED) {
      await interaction.reply({
        content: t(
          "Song-History ist aktuell deaktiviert (`SONG_HISTORY_ENABLED=0`).",
          "Song history is currently disabled (`SONG_HISTORY_ENABLED=0`)."
        ),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const playback = await runtime.resolveStreamingRuntimeForInteraction(interaction);
    const requestedLimit = interaction.options.getInteger("limit") || 10;
    const limit = Math.max(1, Math.min(20, requestedLimit));
    const history = getSongHistory(interaction.guildId, { limit });

    if (!history.length) {
      await interaction.reply({
        content: t(
          "Noch keine Song-History verfügbar. Starte zuerst eine Station mit `/play`.",
          "No song history yet. Start a station with `/play` first."
        ),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const payload = runtime.buildSongHistoryEmbed(history, interaction.guildId, playback.runtime, language);
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "pause") {
    const requestedBot = interaction.options.getInteger("bot");
    if (runtime.role === "commander" && runtime.workerManager) {
      const workers = requestedBot
        ? [runtime.workerManager.getWorkerByIndex(requestedBot)].filter(Boolean)
        : runtime.workerManager.getStreamingWorkers(interaction.guildId);
      if (workers.length === 0) {
        await interaction.reply({ content: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."), flags: MessageFlags.Ephemeral });
        return;
      }
      const failures = [];
      for (const w of workers) {
        const result = await w.pauseInGuild(interaction.guildId);
        if (!result?.ok) failures.push(`${w.config?.name || "Worker"}: ${result?.error || "pause_failed"}`);
      }
      if (failures.length === workers.length) {
        await interaction.reply({ content: failures.join("\n"), flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({ content: t("Pausiert.", "Paused."), flags: MessageFlags.Ephemeral });
      return;
    }
    if (!state.currentStationKey) {
      await interaction.reply({ content: t("Es laeuft nichts.", "Nothing is playing."), flags: MessageFlags.Ephemeral });
      return;
    }
    state.player.pause(true);
    await interaction.reply({ content: t("Pausiert.", "Paused."), flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "resume") {
    const requestedBot = interaction.options.getInteger("bot");
    if (runtime.role === "commander" && runtime.workerManager) {
      const workers = requestedBot
        ? [runtime.workerManager.getWorkerByIndex(requestedBot)].filter(Boolean)
        : runtime.workerManager.getStreamingWorkers(interaction.guildId);
      if (workers.length === 0) {
        await interaction.reply({ content: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."), flags: MessageFlags.Ephemeral });
        return;
      }
      const failures = [];
      for (const w of workers) {
        const result = await w.resumeInGuild(interaction.guildId);
        if (!result?.ok) failures.push(`${w.config?.name || "Worker"}: ${result?.error || "resume_failed"}`);
      }
      if (failures.length === workers.length) {
        await interaction.reply({ content: failures.join("\n"), flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.reply({ content: t("Weiter gehts.", "Resumed."), flags: MessageFlags.Ephemeral });
      return;
    }
    if (!state.currentStationKey) {
      await interaction.reply({ content: t("Es laeuft nichts.", "Nothing is playing."), flags: MessageFlags.Ephemeral });
      return;
    }
    state.player.unpause();
    await interaction.reply({ content: t("Weiter gehts.", "Resumed."), flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "stop") {
    const requestedBot = interaction.options.getInteger("bot");
    const stopAll = interaction.options.getBoolean("all");
    
    if (runtime.role === "commander" && runtime.workerManager) {
      const guildId = interaction.guildId;
      let workers = [];
      
      // Priorität 1: Explizit bot: Parameter
      if (requestedBot) {
        const worker = runtime.workerManager.getWorkerByIndex(requestedBot);
        if (worker) workers = [worker];
      }
      // Priorität 2: all: true Parameter
      else if (stopAll) {
        workers = runtime.workerManager.getStreamingWorkers(guildId);
      }
      // Priorität 3: User im Voice-Channel → stoppe nur Worker in diesem Channel
      else {
        const guild = interaction.guild || runtime.client.guilds.cache.get(guildId);
        const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
        const userChannelId = String(member?.voice?.channelId || "").trim();
        
        if (userChannelId) {
          // User ist in Channel → stoppe nur Worker in diesem Channel
          const allStreamingWorkers = runtime.workerManager.getStreamingWorkers(guildId);
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
            flags: MessageFlags.Ephemeral
          });
          return;
        }
      }
      
      if (workers.length === 0) {
        await interaction.reply({ content: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."), flags: MessageFlags.Ephemeral });
        return;
      }
      const failures = [];
      for (const w of workers) {
        const result = await w.stopInGuild(guildId);
        if (!result?.ok) failures.push(`${w.config?.name || "Worker"}: ${result?.error || "stop_failed"}`);
      }
      if (failures.length === workers.length) {
        await interaction.reply({ content: failures.join("\n"), flags: MessageFlags.Ephemeral });
        return;
      }
      const workerNames = workers.map(w => w.config?.name || "Worker").join(", ");
      await interaction.reply({
        content: t(
          `Gestoppt: ${workerNames}`,
          `Stopped: ${workerNames}`
        ),
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    
    // Worker/Legacy Mode: lokaler Stop
    state.shouldReconnect = false;
    runtime.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });

    await interaction.reply({ content: t("Gestoppt und Channel verlassen.", "Stopped and left the channel."), flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "setvolume") {
    const value = interaction.options.getInteger("value", true);
    if (value < 0 || value > 100) {
      await interaction.reply({ content: t("Wert muss zwischen 0 und 100 liegen.", "Value must be between 0 and 100."), flags: MessageFlags.Ephemeral });
      return;
    }
    if (runtime.role === "commander" && runtime.workerManager) {
      const requestedBot = runtime.getIntegerOptionFlexible(interaction, ["bot", "worker"]);
      const guildTier = getTier(interaction.guildId);
      let targetWorkers = [];

      if (Number.isInteger(requestedBot)) {
        const check = runtime.workerManager.canUseWorker(requestedBot, interaction.guildId, guildTier);
        if (!check.ok) {
          const reasons = {
            tier: t(`Worker ${requestedBot} erfordert ein hoeheres Abo (max: ${check.maxIndex}).`, `Worker ${requestedBot} requires a higher plan (max: ${check.maxIndex}).`),
            not_configured: t(`Worker ${requestedBot} ist nicht konfiguriert.`, `Worker ${requestedBot} is not configured.`),
            offline: t(`Worker ${requestedBot} ist offline.`, `Worker ${requestedBot} is offline.`),
            not_invited: t(`Worker ${requestedBot} ist nicht auf diesem Server eingeladen.`, `Worker ${requestedBot} is not invited on this server.`),
          };
          await interaction.reply({ content: reasons[check.reason] || t("Worker nicht verfügbar.", "Worker not available."), flags: MessageFlags.Ephemeral });
          return;
        }
        const info = check.worker.getGuildInfo(interaction.guildId);
        if (!info?.playing) {
          await interaction.reply({
            content: t(
              `Worker ${requestedBot} streamt aktuell nicht auf diesem Server.`,
              `Worker ${requestedBot} is not currently streaming on this server.`
            ),
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        targetWorkers = [check.worker];
      } else {
        const workers = runtime.workerManager.getStreamingWorkers(interaction.guildId);
        if (workers.length === 0) {
          await interaction.reply({ content: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."), flags: MessageFlags.Ephemeral });
          return;
        }

        const guild = interaction.guild || runtime.client.guilds.cache.get(interaction.guildId);
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
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
      }

      if (targetWorkers.length === 0) {
        await interaction.reply({ content: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."), flags: MessageFlags.Ephemeral });
        return;
      }
      const failures = [];
      for (const worker of targetWorkers) {
        const result = await worker.setVolumeInGuild(interaction.guildId, value);
        if (!result?.ok) failures.push(`${worker.config?.name || "Worker"}: ${result?.error || "setvolume_failed"}`);
      }
      if (failures.length === targetWorkers.length) {
        await interaction.reply({ content: failures.join("\n"), flags: MessageFlags.Ephemeral });
        return;
      }
      const targetNames = targetWorkers.map((worker) => worker.config?.name || "Worker").join(", ");
      await interaction.reply({
        content: t(
          `Lautstärke gesetzt: ${value} (${targetNames})`,
          `Volume set to: ${value} (${targetNames})`
        ),
        flags: MessageFlags.Ephemeral
      });
      return;
    }
    state.volume = value;
    const resource = state.player.state.resource;
    if (resource?.volume) {
      resource.volume.setVolume(clampVolume(value));
    }
    await interaction.reply({ content: t(`Lautstärke gesetzt: ${value}`, `Volume set to: ${value}`), flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "premium") {
    const gid = interaction.guildId;
    const tierConfig = getTierConfig(gid);
    const license = getLicense(gid);
    const tierColor = tierConfig.tier === "ultimate"
      ? BRAND.ultimateColor
      : (tierConfig.tier === "pro" ? BRAND.proColor : BRAND.color);
    const dashboardUrl = withLanguageParam(DASHBOARD_URL, language);
    const premiumUrl = withLanguageParam(BRAND.upgradeUrl || WEBSITE_URL, language);

    let licenseSummary = t("Keine aktive Lizenz.", "No active license.");
    if (license && !license.expired) {
      const expDate = new Date(license.expiresAt).toLocaleDateString(t("de-DE", "en-US"));
      licenseSummary = t(
        `Aktiv bis ${expDate} (${license.remainingDays} Tage uebrig)`,
        `Active until ${expDate} (${license.remainingDays} day${license.remainingDays === 1 ? "" : "s"} left)`
      );
    } else if (license && license.expired) {
      licenseSummary = t("Abgelaufen", "Expired");
    }

    const premiumEmbed = new EmbedBuilder()
      .setColor(tierColor)
      .setTitle(t("Premium-Status", "Premium status"))
      .setDescription(`${BRAND.name} | ${tierConfig.name}`)
      .addFields(
        {
          name: t("Server", "Server"),
          value: `${clipText(interaction.guild?.name || gid, 120)}\n\`${gid}\``,
          inline: false,
        },
        {
          name: t("Plan", "Plan"),
          value: [
            `**${tierConfig.name}**`,
            `Audio: ${tierConfig.bitrate} Opus`,
            `Reconnect: ${tierConfig.reconnectMs}ms`,
            `${t("Max Bots", "Max bots")}: ${tierConfig.maxBots}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: t("Lizenz", "License"),
          value: licenseSummary,
          inline: true,
        }
      );

    if (tierConfig.tier === "free") {
      premiumEmbed.addFields({
        name: t("Upgrade", "Upgrade"),
        value: t(
          `Upgrade auf ${BRAND.name} Pro oder Ultimate fuer bessere Audioqualitaet, mehr Worker und schnellere Reconnects.`,
          `Upgrade to ${BRAND.name} Pro or Ultimate for better audio quality, more workers, and faster reconnects.`
        ),
        inline: false,
      });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(t("Dashboard", "Dashboard"))
        .setURL(dashboardUrl),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(t("Premium", "Premium"))
        .setURL(premiumUrl),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(t("Support", "Support"))
        .setURL(SUPPORT_URL)
    );

    await interaction.reply({ embeds: [premiumEmbed], components: [row], flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "health") {
    const playback = await runtime.resolveStreamingRuntimeForInteraction(interaction);
    if (!playback.runtime || !playback.state) {
      await interaction.reply({ content: runtime.getStreamingRuntimeSelectionMessage(playback.reason, language), flags: MessageFlags.Ephemeral });
      return;
    }
    const activeRuntime = playback.runtime;
    const activeState = playback.state;
    const networkHoldMs = activeRuntime.getNetworkRecoveryDelayMs(interaction.guildId);
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

    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "diag") {
    const playback = await runtime.resolveStreamingRuntimeForInteraction(interaction);
    if (!playback.runtime || !playback.state) {
      await interaction.reply({ content: runtime.getStreamingRuntimeSelectionMessage(playback.reason, language), flags: MessageFlags.Ephemeral });
      return;
    }
    const activeRuntime = playback.runtime;
    const activeState = playback.state;
    const connected = activeState.connection ? t("ja", "yes") : t("nein", "no");
    const channelId = activeState.connection?.joinConfig?.channelId || activeState.lastChannelId || "-";
    const station = activeState.currentStationKey || "-";
    const diag = runtime.getStreamDiagnostics(interaction.guildId, activeState);
    const restartPending = activeState.streamRestartTimer ? t("ja", "yes") : t("nein", "no");
    const reconnectPending = activeState.reconnectTimer ? t("ja", "yes") : t("nein", "no");
    const networkHoldMs = activeRuntime.getNetworkRecoveryDelayMs(interaction.guildId);
    const resolvedChannel = /^\d{16,22}$/.test(String(channelId))
      ? `<#${channelId}>`
      : String(channelId || "-");

    const diagEmbed = new EmbedBuilder()
      .setColor(connected === t("ja", "yes") ? BRAND.proColor : BRAND.color)
      .setTitle(t("Stream-Diagnose", "Stream diagnostics"))
      .setDescription(`${activeRuntime.config.name} | ${interaction.guild?.name || interaction.guildId}`)
      .addFields(
        {
          name: t("Stream-Profil", "Stream profile"),
          value: [
            `Plan: ${diag.tier.toUpperCase()}`,
            `preset=${diag.preset}`,
            `transcode=${diag.transcodeEnabled ? "on" : "off"} (${diag.transcodeMode})`,
            `${t("Bitrate Ziel", "Target bitrate")}: ${diag.bitrateOverride || "-"} (${diag.requestedBitrateKbps}k)`,
            `${t("Profil", "Profile")}: ${diag.profile}`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "FFmpeg",
          value: `queue=${diag.queue} | probe=${diag.probeSize} | analyzeUs=${diag.analyzeUs}`,
          inline: false,
        },
        {
          name: t("Wiedergabe", "Playback"),
          value: [
            `${t("Verbunden", "Connected")}: ${connected}`,
            `Channel: ${resolvedChannel}`,
            `Station: ${station}`,
            `${t("Stream-Laufzeit", "Stream lifetime")}: ${diag.streamLifetimeSec}s`,
            `${t("Fehler (Reihe)", "Errors (streak)")}: ${activeState.streamErrorCount || 0}`,
            `${t("Restart geplant", "Restart pending")}: ${restartPending}`,
            `${t("Reconnect geplant", "Reconnect pending")}: ${reconnectPending}`,
            `${t("Netz-Cooldown", "Network cooldown")}: ${networkHoldMs > 0 ? `${Math.round(networkHoldMs)}ms` : "0ms"}`,
          ].join("\n"),
          inline: false,
        }
      );

    await interaction.reply({ embeds: [diagEmbed], flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "status") {
    const playback = await runtime.resolveStreamingRuntimeForInteraction(interaction);
    if (!playback.runtime || !playback.state) {
      await interaction.reply({ content: runtime.getStreamingRuntimeSelectionMessage(playback.reason, language), flags: MessageFlags.Ephemeral });
      return;
    }
    const activeRuntime = playback.runtime;
    const activeState = playback.state;
    const connected = activeState.connection ? t("ja", "yes") : t("nein", "no");
    const channelId = activeState.connection?.joinConfig?.channelId || activeState.lastChannelId || "-";
    const runtimeMetrics = typeof activeRuntime.getRuntimeMetrics === "function"
      ? activeRuntime.getRuntimeMetrics()
      : {};
    const uptimeSec = Number(runtimeMetrics?.uptimeSec || 0) || Math.floor((Date.now() - activeRuntime.startedAt) / 1000);
    const load = Array.isArray(runtimeMetrics?.loadAvg) && runtimeMetrics.loadAvg.length
      ? runtimeMetrics.loadAvg.map((value) => Number(value).toFixed(2)).join(", ")
      : os.loadavg().map((value) => value.toFixed(2)).join(", ");
    const mem = runtimeMetrics?.memoryRssMb
      ? `${runtimeMetrics.memoryRssMb}MB`
      : `${Math.round(process.memoryUsage().rss / (1024 * 1024))}MB`;
    const station = activeState.currentStationKey || "-";
    const resolvedChannel = /^\d{16,22}$/.test(String(channelId))
      ? `<#${channelId}>`
      : String(channelId || "-");

    const statusEmbed = new EmbedBuilder()
      .setColor(connected === t("ja", "yes") ? BRAND.proColor : BRAND.color)
      .setTitle(t("Bot-Status", "Bot status"))
      .setDescription(`${activeRuntime.config.name} | ${interaction.guild?.name || interaction.guildId}`)
      .addFields(
        {
          name: t("Runtime", "Runtime"),
          value: [
            `${t("Guilds (dieser Bot)", "Guilds (this bot)")}: ${activeRuntime.client.guilds.cache.size}`,
            `Uptime: ${uptimeSec}s`,
            `Load: ${load}`,
            `RAM: ${mem}`,
          ].join("\n"),
          inline: false,
        },
        {
          name: t("Wiedergabe", "Playback"),
          value: [
            `${t("Verbunden", "Connected")}: ${connected}`,
            `Channel: ${resolvedChannel}`,
            `Station: ${station}`,
            `${t("Reconnects", "Reconnects")}: ${activeState.reconnectCount || 0}`,
            `${t("Fehler (Reihe)", "Errors (streak)")}: ${activeState.streamErrorCount || 0}`,
          ].join("\n"),
          inline: false,
        }
      );

    await interaction.reply({ embeds: [statusEmbed], flags: MessageFlags.Ephemeral });
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
    const result = await addGuildStation(guildId, key, name, url);
    if (result.error) {
      await interaction.reply({ content: translateCustomStationErrorMessage(result.error, language), flags: MessageFlags.Ephemeral });
    } else {
      const count = countGuildStations(guildId);
      await interaction.reply({
        content: t(
          `Custom Station hinzugefügt: **${result.station.name}** (Key: \`${result.key}\`)\n${count}/${MAX_STATIONS_PER_GUILD} Slots belegt.`,
          `Custom station added: **${result.station.name}** (Key: \`${result.key}\`)\n${count}/${MAX_STATIONS_PER_GUILD} slots used.`
        ),
        flags: MessageFlags.Ephemeral,
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
      await interaction.reply({ content: t(`Station \`${key}\` entfernt.`, `Station \`${key}\` removed.`), flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: t(`Station \`${key}\` nicht gefunden.`, `Station \`${key}\` was not found.`), flags: MessageFlags.Ephemeral });
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
      await interaction.reply({ content: t("Keine Custom-Stationen. Nutze `/addstation`, um eine hinzuzufügen.", "No custom stations. Use `/addstation` to add one."), flags: MessageFlags.Ephemeral });
    } else {
      const list = keys.map((k) => {
        const station = custom[k] || {};
        const meta = [];
        if (station.folder) meta.push(`[${station.folder}]`);
        if (Array.isArray(station.tags) && station.tags.length > 0) {
          meta.push(station.tags.map((tag) => `#${tag}`).join(", "));
        }
        const suffix = meta.length > 0 ? ` - ${meta.join(" ")}` : "";
        return `\`${k}\` - ${station.name}${suffix}`;
      }).join("\n");
      await runtime.respondLongInteraction(
        interaction,
        `**${t("Custom Stationen", "Custom stations")} (${keys.length}/${MAX_STATIONS_PER_GUILD}):**\n${list}`,
        { flags: MessageFlags.Ephemeral }
      );
    }
    return;
  }

  // === /license Command ===
  if (interaction.commandName === "license") {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const requiresManagePermission = sub === "activate" || sub === "remove";
    if (requiresManagePermission && !runtime.hasGuildManagePermissions(interaction)) {
      await interaction.reply({
        content: t(
          "Du brauchst die Berechtigung `Server verwalten`, um Lizenz-Aktionen auszuführen.",
          "You need the `Manage Server` permission to execute license actions."
        ),
        flags: MessageFlags.Ephemeral
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
        await interaction.reply({ content: t("Lizenz-Key nicht gefunden. Bitte pruefe den Key und versuche es erneut.", "License key not found. Please verify it and try again."), flags: MessageFlags.Ephemeral });
        return;
      }
      if (lic.expired) {
        await interaction.reply({ content: t("Diese Lizenz ist abgelaufen. Bitte erneuere dein Abo.", "This license has expired. Please renew your subscription."), flags: MessageFlags.Ephemeral });
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
        await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
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
        flags: MessageFlags.Ephemeral,
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
          flags: MessageFlags.Ephemeral,
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
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "remove") {
      const lic = getServerLicense(guildId);
      if (!lic || !lic.id) {
        await interaction.reply({ content: t("Dieser Server hat keine aktive Lizenz.", "This server has no active license."), flags: MessageFlags.Ephemeral });
        return;
      }

      const result = unlinkServerFromLicense(guildId, lic.id);
      if (!result.ok) {
        await interaction.reply({ content: t("Fehler beim Entfernen: ", "Error while removing: ") + result.message, flags: MessageFlags.Ephemeral });
        return;
      }

      await interaction.reply({
        content: t(
          "Server wurde von der Lizenz entfernt. Der Server-Slot ist jetzt frei und kann für einen anderen Server genutzt werden.\nNutze `/license activate <key>`, um eine neue Lizenz zu aktivieren.",
          "Server was unlinked from the license. The seat is now free and can be used for another server.\nUse `/license activate <key>` to activate a new license."
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (interaction.commandName === "play") {
    const requested = interaction.options.getString("station");
    const requestedVoiceChannel = interaction.options.getChannel("voice");
    const requestedBotIndex = interaction.options.getInteger("bot");
    let requestedChannel = null;

    if (requestedVoiceChannel) {
      if (requestedVoiceChannel.guildId !== interaction.guildId) {
        await interaction.reply({
          content: t("Der gewaehlte Voice/Stage-Channel ist nicht in diesem Server.", "The selected voice/stage channel is not in this server."),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (
        !requestedVoiceChannel.isVoiceBased()
        || (requestedVoiceChannel.type !== ChannelType.GuildVoice && requestedVoiceChannel.type !== ChannelType.GuildStageVoice)
      ) {
        await interaction.reply({
          content: t("Bitte waehle einen Voice- oder Stage-Channel.", "Please choose a voice or stage channel."),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      requestedChannel = requestedVoiceChannel;
    }

    const guildId = interaction.guildId;
    const guildTier = getTier(guildId);
    const availableStations = buildScopedStationsData(stations, filterStationsByTier(stations.stations, guildTier));
    const requestedOfficialKey = resolveStation(stations, requested);

    // Check standard stations first, then custom stations (Ultimate only)
    let playStations = availableStations;
    let key = resolveStation(availableStations, requested);
    let isCustom = false;
    let customUrl = null;

    if (key) {
      // Check tier access
      const stationTier = playStations.stations[key]?.tier || "free";
      const tierRank = { free: 0, pro: 1, ultimate: 2 };
      if ((tierRank[stationTier] || 0) > (tierRank[guildTier] || 0)) {
        await interaction.reply(premiumStationEmbed(playStations.stations[key].name, stationTier, language));
        return;
      }
    } else {
      if (requestedOfficialKey && !String(requestedOfficialKey).startsWith("custom:")) {
        const stationTier = stations.stations[requestedOfficialKey]?.tier || "free";
        const tierRank = { free: 0, pro: 1, ultimate: 2 };
        if ((tierRank[stationTier] || 0) > (tierRank[guildTier] || 0)) {
          await interaction.reply(premiumStationEmbed(stations.stations[requestedOfficialKey].name, stationTier, language));
          return;
        }
      }

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
            flags: MessageFlags.Ephemeral
          });
          return;
        }
        playStations = buildScopedStationsData(stations, {
          ...availableStations.stations,
          [key]: { name: customStations[customKey].name, url: customUrlValidation.url, tier: "ultimate" },
        });
      } else if (customKey) {
        await interaction.reply(customStationEmbed(language));
        return;
      } else {
        await interaction.reply({ content: t("Unbekannte Station.", "Unknown station."), flags: MessageFlags.Ephemeral });
        return;
      }
    }

    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({ content: t("Guild konnte nicht ermittelt werden.", "Could not resolve guild."), flags: MessageFlags.Ephemeral });
      return;
    }

    // ---- Commander Mode: Delegate to Worker ----
    if (runtime.role === "commander" && runtime.workerManager) {
      // Resolve voice channel ID
      let channelId = requestedChannel?.id;
      if (!channelId) {
        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        channelId = member?.voice?.channelId;
      }
      if (!channelId) {
        await interaction.reply({
          content: t("Du musst in einem Voice-Channel sein oder einen angeben.", "You must be in a voice channel or specify one."),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral });

      let worker;
      let reusingExistingWorker = false;
      if (requestedBotIndex) {
        const check = runtime.workerManager.canUseWorker(requestedBotIndex, guildId, guildTier);
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
        const activeWorkerInChannel = runtime.workerManager.findStreamingWorkerByChannel(guildId, channelId);
        if (activeWorkerInChannel) {
          worker = activeWorkerInChannel;
          reusingExistingWorker = true;
        } else {
          const connectedWorkerInChannel = await runtime.workerManager.findConnectedWorkerByChannel(guildId, channelId, guildTier);
          if (connectedWorkerInChannel) {
            worker = connectedWorkerInChannel;
            reusingExistingWorker = true;
          }
        }

        if (!worker) {
          worker = runtime.workerManager.findFreeWorker(guildId, guildTier);
        }
      }

      if (!worker) {
        const invited = runtime.workerManager.getInvitedWorkers(guildId, guildTier);
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

      const selectedStation = playStations.stations[key];
      log("INFO", `[${runtime.config.name}] /play guild=${guildId} station=${key} -> delegating to ${worker.config.name}`);
      worker.clearScheduledEventPlaybackInGuild(guildId);
      const result = await worker.playInGuild(guildId, channelId, key, playStations, state.volume || 100);
      if (!result.ok) {
        await interaction.editReply(t(`Fehler: ${result.error}`, `Error: ${result.error}`));
        return;
      }
      const tierConfig = getTierConfig(guildId);
      const tierLabel = tierConfig.tier !== "free" ? ` [${tierConfig.name} ${tierConfig.bitrate}]` : "";
      await interaction.editReply(t(
        result.recovering
          ? `${result.workerName} bleibt verbunden. Quelle aktuell instabil, Retry aktiv: ${selectedStation?.name || key}${tierLabel}`
          : reusingExistingWorker
            ? `${result.workerName} wechselt auf: ${selectedStation?.name || key}${tierLabel}`
            : `${result.workerName} startet: ${selectedStation?.name || key}${tierLabel}`,
        result.recovering
          ? `${result.workerName} stays connected. Source is unstable, retry active: ${selectedStation?.name || key}${tierLabel}`
          : reusingExistingWorker
            ? `${result.workerName} switching to: ${selectedStation?.name || key}${tierLabel}`
            : `${result.workerName} starting: ${selectedStation?.name || key}${tierLabel}`
      ));
      return;
    }

    // ---- Worker/Legacy Mode: Play locally ----
    log("INFO", `[${runtime.config.name}] /play guild=${guildId} station=${key} custom=${isCustom} tier=${guildTier}`);

    const selectedStation = playStations.stations[key];
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    runtime.clearRestoreRetry(guildId);
    const { connection, error: connectError } = await runtime.connectToVoice(interaction, requestedChannel, { silent: true });
    if (!connection) {
      await interaction.editReply(connectError || t("Konnte keine Voice-Verbindung herstellen.", "Could not establish a voice connection."));
      return;
    }
    state.shouldReconnect = true;
    runtime.clearScheduledEventPlayback(state);

    try {
      await runtime.playStation(state, playStations, key, guildId);
      const tierConfig = getTierConfig(guildId);
      const tierLabel = tierConfig.tier !== "free" ? ` [${tierConfig.name} ${tierConfig.bitrate}]` : "";
      await interaction.editReply(t(`Starte: ${selectedStation?.name || key}${tierLabel}`, `Starting: ${selectedStation?.name || key}${tierLabel}`));
    } catch (err) {
      log("ERROR", `[${runtime.config.name}] Play error: ${err.message}`);
      state.lastStreamErrorAt = new Date().toISOString();

      const fallbackKey = getFallbackKey(playStations, key);
      if (fallbackKey && fallbackKey !== key && playStations.stations[fallbackKey]) {
        try {
          await runtime.playStation(state, playStations, fallbackKey, guildId);
          await interaction.editReply(
            t(
              `Fehler bei ${selectedStation?.name || key}. Fallback: ${playStations.stations[fallbackKey].name}`,
              `Error on ${selectedStation?.name || key}. Fallback: ${playStations.stations[fallbackKey].name}`
            )
          );
          return;
        } catch (fallbackErr) {
          log("ERROR", `[${runtime.config.name}] Fallback error: ${fallbackErr.message}`);
          state.lastStreamErrorAt = new Date().toISOString();
        }
      }

      const recovery = runtime.armPlaybackRecovery(
        guildId,
        state,
        playStations,
        key,
        err,
        { reason: "local-play-start-failed" }
      );
      if (recovery.scheduled) {
        await interaction.editReply(t(
          `Verbunden. Quelle aktuell instabil, Retry aktiv: ${selectedStation?.name || key}`,
          `Connected. Source is unstable, retry active: ${selectedStation?.name || key}`
        ));
        return;
      }

      state.shouldReconnect = false;
      runtime.invalidateVoiceStatus?.(state, { clearText: true });
      runtime.syncVoiceChannelStatus(guildId, "").catch(() => null);
      runtime.clearNowPlayingTimer(state);
      state.player.stop();
      runtime.clearCurrentProcess(state);
      if (state.connection) {
        state.connection.destroy();
        state.connection = null;
      }
      state.currentStationKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.nowPlayingSignature = null;
      runtime.updatePresence();
      await interaction.editReply(t(`Fehler beim Starten: ${err.message}`, `Error while starting: ${err.message}`));
    }
  }
}
