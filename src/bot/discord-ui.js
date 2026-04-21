import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

import { BRAND } from "../config/plans.js";

export const DISCORD_UI_COLORS = {
  info: BRAND.color,
  live: BRAND.proColor,
  admin: BRAND.ultimateColor,
  success: 0x10B981,
  warning: 0xF59E0B,
  danger: 0xEF4444,
  neutral: 0x64748B,
};

export function buildOmniEmbed({
  tone = "info",
  title = "",
  description = "",
  fields = [],
  footer = "",
} = {}) {
  const embed = new EmbedBuilder().setColor(DISCORD_UI_COLORS[tone] || DISCORD_UI_COLORS.info);
  if (title) embed.setTitle(title);
  if (description) embed.setDescription(description);
  if (Array.isArray(fields) && fields.length > 0) {
    embed.addFields(fields);
  }
  if (footer) {
    embed.setFooter({ text: String(footer) });
  }
  return embed;
}

export function buildLinkRow(buttons = []) {
  const components = buttons
    .filter((button) => button?.label && button?.url)
    .slice(0, 5)
    .map((button) => new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(String(button.label))
      .setURL(String(button.url)));
  if (!components.length) return null;
  return new ActionRowBuilder().addComponents(...components);
}
