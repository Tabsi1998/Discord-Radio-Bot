import { ChannelType, SlashCommandBuilder } from "discord.js";

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
      .addChannelOption((option) =>
        option
          .setName("channel")
          .setDescription("Voice- oder Stage-Channel (optional)")
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)
      ),
    new SlashCommandBuilder().setName("pause").setDescription("Pausiert die Wiedergabe"),
    new SlashCommandBuilder().setName("resume").setDescription("Setzt die Wiedergabe fort"),
    new SlashCommandBuilder().setName("stop").setDescription("Stoppt die Wiedergabe und verlaesst den Channel"),
    new SlashCommandBuilder().setName("stations").setDescription("Zeigt verfuegbare Stationen"),
    new SlashCommandBuilder().setName("now").setDescription("Zeigt die aktuelle Station"),
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
      .setDescription("Zeigt Stream-Health und Reconnects")
  ];
}

export function buildCommandsJson() {
  return buildCommandBuilders().map((cmd) => cmd.toJSON());
}
