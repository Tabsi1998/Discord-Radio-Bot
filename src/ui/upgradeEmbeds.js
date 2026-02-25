// ============================================================
// OmniFM - Upgrade Embeds (Reusable Discord Embeds, DE/EN)
// ============================================================

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { BRAND, PLANS } from "../config/plans.js";
import { normalizeLanguage } from "../i18n.js";

function pick(language, de, en) {
  return normalizeLanguage(language, "de") === "de" ? de : en;
}

function upgradeButton(language = "de", label = null) {
  const url = BRAND.upgradeUrl || "https://omnifm.bot";
  const resolvedLabel = label || pick(language, "Upgrade", "Upgrade");
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel(resolvedLabel)
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

export function premiumStationEmbed(stationName, requiredPlan, language = "de") {
  const planConfig = PLANS[requiredPlan] || PLANS.pro;
  return {
    embeds: [
      baseEmbed()
        .setTitle(pick(language, "Premium Station", "Premium station"))
        .setDescription(
          pick(
            language,
            `**${stationName || "Diese Station"}** ist ab ${BRAND.name} **${planConfig.name}** verfuegbar.\n\n`
              + "Upgrade fuer:\n"
              + "> 100+ Premium Stationen\n"
              + "> HQ Audio-Qualitaet\n"
              + "> Priority Reconnect",
            `**${stationName || "This station"}** is available from ${BRAND.name} **${planConfig.name}**.\n\n`
              + "Upgrade for:\n"
              + "> 100+ premium stations\n"
              + "> HQ audio quality\n"
              + "> Priority reconnect"
          )
        )
        .setColor(BRAND.proColor)
    ],
    components: [upgradeButton(language, pick(language, `Upgrade auf ${planConfig.name}`, `Upgrade to ${planConfig.name}`))],
    ephemeral: true,
  };
}

export function hqAudioEmbed(currentPlan, language = "de") {
  return {
    embeds: [
      baseEmbed()
        .setTitle("HQ Audio")
        .setDescription(
          pick(
            language,
            `HQ Audio ist in folgenden ${BRAND.name} Plaenen verfuegbar:\n\n`
              + "> **Pro** - 128k Opus\n"
              + "> **Ultimate** - 320k Opus\n\n"
              + `Dein aktueller Plan: **${PLANS[currentPlan]?.name || "Free"}** (${PLANS[currentPlan]?.bitrate || "64k"})`,
            `HQ audio is available in these ${BRAND.name} plans:\n\n`
              + "> **Pro** - 128k Opus\n"
              + "> **Ultimate** - 320k Opus\n\n"
              + `Your current plan: **${PLANS[currentPlan]?.name || "Free"}** (${PLANS[currentPlan]?.bitrate || "64k"})`
          )
        )
        .setColor(BRAND.proColor)
    ],
    components: [upgradeButton(language)],
    ephemeral: true,
  };
}

export function customStationEmbed(language = "de") {
  return {
    embeds: [
      baseEmbed()
        .setTitle(pick(language, "Custom Stationen", "Custom stations"))
        .setDescription(
          pick(
            language,
            `Eigene Station-URLs sind ein **${BRAND.name} Ultimate** Feature.\n\n`
              + "> Eigene Stream-URLs hinzufuegen\n"
              + "> Bis zu 50 Custom Stationen pro Server\n"
              + "> Volle Kontrolle ueber deine Playlist",
            `Custom station URLs are a **${BRAND.name} Ultimate** feature.\n\n`
              + "> Add your own stream URLs\n"
              + "> Up to 50 custom stations per server\n"
              + "> Full control over your playlist"
          )
        )
        .setColor(BRAND.ultimateColor)
    ],
    components: [upgradeButton(language, pick(language, "Upgrade auf Ultimate", "Upgrade to Ultimate"))],
    ephemeral: true,
  };
}

export function botLimitEmbed(currentPlan, maxBots, requestedIndex, language = "de") {
  return {
    embeds: [
      baseEmbed()
        .setTitle(pick(language, "Bot-Limit erreicht", "Bot limit reached"))
        .setDescription(
          pick(
            language,
            `Dein **${PLANS[currentPlan]?.name || "Free"}** Plan erlaubt maximal **${maxBots}** Bots.\n`
              + `Du hast Bot #${requestedIndex} angefragt.\n\n`
              + "> **Pro** - bis zu 8 Bots\n"
              + "> **Ultimate** - bis zu 16 Bots",
            `Your **${PLANS[currentPlan]?.name || "Free"}** plan allows up to **${maxBots}** bots.\n`
              + `You requested bot #${requestedIndex}.\n\n`
              + "> **Pro** - up to 8 bots\n"
              + "> **Ultimate** - up to 16 bots"
          )
        )
        .setColor(BRAND.proColor)
    ],
    components: [upgradeButton(language)],
    ephemeral: true,
  };
}

export function reconnectPriorityEmbed(currentPlan, language = "de") {
  return {
    embeds: [
      baseEmbed()
        .setTitle(pick(language, "Reconnect Prioritaet", "Reconnect priority"))
        .setDescription(
          pick(
            language,
            `Schnellere Reconnects mit ${BRAND.name} Upgrades:\n\n`
              + "> **Pro** - Priority Reconnect (1,5s)\n"
              + "> **Ultimate** - Instant Reconnect (0,4s)\n\n"
              + `Dein aktueller Plan: **${PLANS[currentPlan]?.name || "Free"}** (5s)`,
            `Faster reconnects with ${BRAND.name} upgrades:\n\n`
              + "> **Pro** - Priority reconnect (1.5s)\n"
              + "> **Ultimate** - Instant reconnect (0.4s)\n\n"
              + `Your current plan: **${PLANS[currentPlan]?.name || "Free"}** (5s)`
          )
        )
        .setColor(BRAND.proColor)
    ],
    components: [upgradeButton(language)],
    ephemeral: true,
  };
}

export function seatLimitEmbed(seats, language = "de") {
  return {
    embeds: [
      baseEmbed()
        .setTitle(pick(language, "Seat-Limit erreicht", "Seat limit reached"))
        .setDescription(
          pick(
            language,
            `Diese Lizenz deckt **${seats}** Server ab und alle Plaetze sind belegt.\n\n`
              + "> Trenne zuerst einen bestehenden Server, oder\n"
              + "> Upgrade auf ein groesseres Bundle",
            `This license covers **${seats}** servers and all seats are used.\n\n`
              + "> Unlink an existing server first, or\n"
              + "> upgrade to a larger bundle"
          )
        )
        .setColor(BRAND.proColor)
    ],
    components: [upgradeButton(language, pick(language, "Lizenz verwalten", "Manage license"))],
    ephemeral: true,
  };
}

export function genericUpgradeEmbed(title, description, language = "de") {
  return {
    embeds: [
      baseEmbed()
        .setTitle(title)
        .setDescription(description)
    ],
    components: [upgradeButton(language)],
    ephemeral: true,
  };
}
