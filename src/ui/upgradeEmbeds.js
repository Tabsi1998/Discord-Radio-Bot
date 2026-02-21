// ============================================================
// OmniFM - Upgrade Embeds (Reusable Discord Embeds)
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
          `**${stationName || "This station"}** is available in ${BRAND.name} **${planConfig.name}** and above.\n\n` +
          `Upgrade to unlock:\n` +
          `> 100+ premium stations\n` +
          `> HQ audio quality\n` +
          `> Priority reconnect`
        )
        .setColor(BRAND.proColor)
    ],
    components: [upgradeButton(`Upgrade to ${planConfig.name}`)],
    ephemeral: true,
  };
}

export function hqAudioEmbed(currentPlan) {
  return {
    embeds: [
      baseEmbed()
        .setTitle("HQ Audio")
        .setDescription(
          `HQ audio is available in ${BRAND.name} plans:\n\n` +
          `> **Pro** — 128k Opus\n` +
          `> **Ultimate** — 320k Opus\n\n` +
          `Your current plan: **${PLANS[currentPlan]?.name || "Free"}** (${PLANS[currentPlan]?.bitrate || "64k"})`
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
        .setTitle("Custom Stations")
        .setDescription(
          `Custom station URLs are an **${BRAND.name} Ultimate** exclusive.\n\n` +
          `> Add your own stream URLs\n` +
          `> Up to 50 custom stations per server\n` +
          `> Full control over your playlist`
        )
        .setColor(BRAND.ultimateColor)
    ],
    components: [upgradeButton("Upgrade to Ultimate")],
    ephemeral: true,
  };
}

export function botLimitEmbed(currentPlan, maxBots, requestedIndex) {
  return {
    embeds: [
      baseEmbed()
        .setTitle("Bot Limit Reached")
        .setDescription(
          `Your **${PLANS[currentPlan]?.name || "Free"}** plan allows up to **${maxBots}** bots.\n` +
          `You requested bot #${requestedIndex}.\n\n` +
          `> **Pro** — up to 8 bots\n` +
          `> **Ultimate** — up to 16 bots`
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
        .setTitle("Reconnect Priority")
        .setDescription(
          `Faster reconnects are available with ${BRAND.name} upgrades:\n\n` +
          `> **Pro** — Priority reconnect (1.5s)\n` +
          `> **Ultimate** — Instant reconnect (0.4s)\n\n` +
          `Your current plan: **${PLANS[currentPlan]?.name || "Free"}** (5s)`
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
        .setTitle("Seat Limit Reached")
        .setDescription(
          `This license covers **${seats}** server(s) and all seats are occupied.\n\n` +
          `> Unlink an existing server first, or\n` +
          `> Upgrade to a larger bundle`
        )
        .setColor(BRAND.proColor)
    ],
    components: [upgradeButton("Manage License")],
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
