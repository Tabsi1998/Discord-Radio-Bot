// ============================================================
// OmniFM - Upgrade Embeds (Reusable Discord Embeds, Deutsch)
// ============================================================

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { BRAND, PLANS } from "../config/plans.js";

function upgradeButton(label = "Upgrade") {
  const url = BRAND.upgradeUrl || "https://omnifm.bot";
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(label)
      .setStyle(ButtonStyle.Link)
      .setURL(url)
  );
}

function baseEmbed() {
  return new EmbedBuilder()
    .setColor(BRAND.color)
    .setFooter({ text: BRAND.footer });
}

// --- Specific upgrade embeds ---

export function premiumStationEmbed(stationName, requiredPlan) {
  const planConfig = PLANS[requiredPlan] || PLANS.pro;
  return {
    embeds: [
      baseEmbed()
        .setTitle("Premium Station")
        .setDescription(
          `**${stationName || "Diese Station"}** ist ab ${BRAND.name} **${planConfig.name}** verfuegbar.\n\n` +
          `Upgrade fuer:\n` +
          `> 100+ Premium Stationen\n` +
          `> HQ Audio-Qualitaet\n` +
          `> Priority Reconnect`
        )
        .setColor(BRAND.proColor)
    ],
    components: [upgradeButton(`Upgrade auf ${planConfig.name}`)],
    ephemeral: true,
  };
}

export function hqAudioEmbed(currentPlan) {
  return {
    embeds: [
      baseEmbed()
        .setTitle("HQ Audio")
        .setDescription(
          `HQ Audio ist in folgenden ${BRAND.name} Plaenen verfuegbar:\n\n` +
          `> **Pro** — 128k Opus\n` +
          `> **Ultimate** — 320k Opus\n\n` +
          `Dein aktueller Plan: **${PLANS[currentPlan]?.name || "Free"}** (${PLANS[currentPlan]?.bitrate || "64k"})`
        )
        .setColor(BRAND.proColor)
    ],
    components: [upgradeButton("Upgrade")],
    ephemeral: true,
  };
}

export function customStationEmbed() {
  return {
    embeds: [
      baseEmbed()
        .setTitle("Custom Stationen")
        .setDescription(
          `Eigene Station-URLs sind ein **${BRAND.name} Ultimate** Feature.\n\n` +
          `> Eigene Stream-URLs hinzufuegen\n` +
          `> Bis zu 50 Custom Stationen pro Server\n` +
          `> Volle Kontrolle ueber deine Playlist`
        )
        .setColor(BRAND.ultimateColor)
    ],
    components: [upgradeButton("Upgrade auf Ultimate")],
    ephemeral: true,
  };
}

export function botLimitEmbed(currentPlan, maxBots, requestedIndex) {
  return {
    embeds: [
      baseEmbed()
        .setTitle("Bot-Limit erreicht")
        .setDescription(
          `Dein **${PLANS[currentPlan]?.name || "Free"}** Plan erlaubt maximal **${maxBots}** Bots.\n` +
          `Du hast Bot #${requestedIndex} angefragt.\n\n` +
          `> **Pro** — bis zu 8 Bots\n` +
          `> **Ultimate** — bis zu 16 Bots`
        )
        .setColor(BRAND.proColor)
    ],
    components: [upgradeButton("Upgrade")],
    ephemeral: true,
  };
}

export function reconnectPriorityEmbed(currentPlan) {
  return {
    embeds: [
      baseEmbed()
        .setTitle("Reconnect Prioritaet")
        .setDescription(
          `Schnellere Reconnects mit ${BRAND.name} Upgrades:\n\n` +
          `> **Pro** — Priority Reconnect (1,5s)\n` +
          `> **Ultimate** — Instant Reconnect (0,4s)\n\n` +
          `Dein aktueller Plan: **${PLANS[currentPlan]?.name || "Free"}** (5s)`
        )
        .setColor(BRAND.proColor)
    ],
    components: [upgradeButton("Upgrade")],
    ephemeral: true,
  };
}

export function seatLimitEmbed(seats) {
  return {
    embeds: [
      baseEmbed()
        .setTitle("Seat-Limit erreicht")
        .setDescription(
          `Diese Lizenz deckt **${seats}** Server ab und alle Plaetze sind belegt.\n\n` +
          `> Trenne zuerst einen bestehenden Server, oder\n` +
          `> Upgrade auf ein groesseres Bundle`
        )
        .setColor(BRAND.proColor)
    ],
    components: [upgradeButton("Lizenz verwalten")],
    ephemeral: true,
  };
}

export function genericUpgradeEmbed(title, description) {
  return {
    embeds: [
      baseEmbed()
        .setTitle(title)
        .setDescription(description)
    ],
    components: [upgradeButton("Upgrade")],
    ephemeral: true,
  };
}
