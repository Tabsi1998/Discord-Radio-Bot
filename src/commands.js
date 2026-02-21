import { SlashCommandBuilder } from "discord.js";

export function buildCommandBuilders() {
  return [
    new SlashCommandBuilder()
      .setName("play")
      .setDescription("Starte einen Radio-Stream in deinem Voice-Channel")
      .addStringOption((o) => o.setName("station").setDescription("Stationsname oder ID").setRequired(false).setAutocomplete(true))
      .addStringOption((o) => o.setName("channel").setDescription("Voice-Channel (optional)").setRequired(false).setAutocomplete(true)),
    new SlashCommandBuilder().setName("pause").setDescription("Wiedergabe pausieren"),
    new SlashCommandBuilder().setName("resume").setDescription("Wiedergabe fortsetzen"),
    new SlashCommandBuilder().setName("stop").setDescription("Stoppen und Channel verlassen"),
    new SlashCommandBuilder().setName("stations").setDescription("Verfuegbare Stationen fuer deinen Plan anzeigen"),
    new SlashCommandBuilder().setName("now").setDescription("Zeigt was gerade laeuft"),
    new SlashCommandBuilder()
      .setName("setvolume")
      .setDescription("Lautstaerke setzen (0-100)")
      .addIntegerOption((o) => o.setName("value").setDescription("0 bis 100").setRequired(true)),
    new SlashCommandBuilder().setName("status").setDescription("Bot-Status und Uptime anzeigen"),
    new SlashCommandBuilder()
      .setName("list")
      .setDescription("Stationen auflisten (paginiert)")
      .addIntegerOption((o) => o.setName("page").setDescription("Seitennummer").setRequired(false)),
    new SlashCommandBuilder().setName("health").setDescription("Stream-Health und Reconnect-Info anzeigen"),
    new SlashCommandBuilder().setName("diag").setDescription("Diagnose: Audio/ffmpeg Profil und Stream-Details anzeigen"),
    new SlashCommandBuilder().setName("premium").setDescription("OmniFM Premium-Status deines Servers anzeigen"),
    // Custom Stations (Ultimate)
    new SlashCommandBuilder()
      .setName("addstation")
      .setDescription("[Ultimate] Eigene Station-URL hinzufuegen")
      .addStringOption((o) => o.setName("key").setDescription("Kurzer Key (z.B. mystation)").setRequired(true))
      .addStringOption((o) => o.setName("name").setDescription("Anzeigename").setRequired(true))
      .addStringOption((o) => o.setName("url").setDescription("Stream-URL (http/https)").setRequired(true)),
    new SlashCommandBuilder()
      .setName("removestation")
      .setDescription("[Ultimate] Eigene Station entfernen")
      .addStringOption((o) => o.setName("key").setDescription("Station-Key").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("mystations").setDescription("[Ultimate] Deine eigenen Stationen anzeigen"),
    // License Management
    new SlashCommandBuilder()
      .setName("license")
      .setDescription("Lizenz verwalten - aktivieren, info, entfernen")
      .addSubcommand((sub) =>
        sub.setName("activate").setDescription("Lizenz-Key fuer diesen Server aktivieren")
          .addStringOption((o) => o.setName("key").setDescription("Dein Lizenz-Key (z.B. OMNI-XXXX-XXXX-XXXX)").setRequired(true))
      )
      .addSubcommand((sub) =>
        sub.setName("info").setDescription("Lizenz-Info fuer diesen Server anzeigen")
      )
      .addSubcommand((sub) =>
        sub.setName("remove").setDescription("Diesen Server von der Lizenz entfernen")
      ),
  ];
}

export function buildCommandsJson() {
  return buildCommandBuilders().map((cmd) => cmd.toJSON());
}
