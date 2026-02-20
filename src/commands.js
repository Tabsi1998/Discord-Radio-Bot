import { SlashCommandBuilder } from "discord.js";

export function buildCommandBuilders() {
  return [
    new SlashCommandBuilder()
      .setName("play")
      .setDescription("Startet einen Radio-Stream")
      .addStringOption((option) =>
        option
          .setName("station")
          .setDescription("Welche Station?")
          .setRequired(false)
          .setAutocomplete(true)
      )
      .addStringOption((option) =>
        option
          .setName("channel")
          .setDescription("Voice/Stage Channel Name oder ID (optional)")
          .setRequired(false)
          .setAutocomplete(true)
      ),
    new SlashCommandBuilder().setName("pause").setDescription("Pausiert die Wiedergabe"),
    new SlashCommandBuilder().setName("resume").setDescription("Setzt die Wiedergabe fort"),
    new SlashCommandBuilder().setName("stop").setDescription("Stoppt die Wiedergabe und verlaesst den Channel"),
    new SlashCommandBuilder().setName("stations").setDescription("Zeigt verfuegbare Stationen"),
    new SlashCommandBuilder().setName("now").setDescription("Zeigt was auf diesem Server laeuft + aktive Server-Anzahl"),
    new SlashCommandBuilder()
      .setName("setvolume")
      .setDescription("Setzt die Lautstaerke (0-100)")
      .addIntegerOption((option) =>
        option.setName("value").setDescription("0 bis 100").setRequired(true)
      ),
    new SlashCommandBuilder()
      .setName("status")
      .setDescription("Zeigt Status, Uptime und Last"),
    new SlashCommandBuilder()
      .setName("list")
      .setDescription("Listet Stationen (paginiert)")
      .addIntegerOption((option) =>
        option.setName("page").setDescription("Seite (ab 1)").setRequired(false)
      ),
    new SlashCommandBuilder()
      .setName("health")
      .setDescription("Zeigt Stream-Health und Reconnects"),
    new SlashCommandBuilder()
      .setName("premium")
      .setDescription("Zeigt den Premium-Status dieses Servers"),
    // Custom Stations (Ultimate)
    new SlashCommandBuilder()
      .setName("addstation")
      .setDescription("[Ultimate] Eigene Station hinzufuegen")
      .addStringOption((o) => o.setName("key").setDescription("Kurzname (z.B. meinestation)").setRequired(true))
      .addStringOption((o) => o.setName("name").setDescription("Anzeigename").setRequired(true))
      .addStringOption((o) => o.setName("url").setDescription("Stream URL (http/https)").setRequired(true)),
    new SlashCommandBuilder()
      .setName("removestation")
      .setDescription("[Ultimate] Eigene Station entfernen")
      .addStringOption((o) => o.setName("key").setDescription("Kurzname der Station").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder()
      .setName("mystations")
      .setDescription("[Ultimate] Zeigt deine Custom Stationen"),
  ];
}

export function buildCommandsJson() {
  return buildCommandBuilders().map((cmd) => cmd.toJSON());
}
