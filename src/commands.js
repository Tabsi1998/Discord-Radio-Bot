import { SlashCommandBuilder } from "discord.js";

export function buildCommandBuilders() {
  return [
    new SlashCommandBuilder()
      .setName("play")
      .setDescription("Start a radio stream in your voice channel")
      .addStringOption((o) => o.setName("station").setDescription("Station name or ID").setRequired(false).setAutocomplete(true))
      .addStringOption((o) => o.setName("channel").setDescription("Voice channel (optional)").setRequired(false).setAutocomplete(true)),
    new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
    new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
    new SlashCommandBuilder().setName("stop").setDescription("Stop playback and leave the channel"),
    new SlashCommandBuilder().setName("stations").setDescription("Browse available stations for your plan"),
    new SlashCommandBuilder().setName("now").setDescription("Show what is currently playing"),
    new SlashCommandBuilder()
      .setName("setvolume")
      .setDescription("Set volume (0-100)")
      .addIntegerOption((o) => o.setName("value").setDescription("0 to 100").setRequired(true)),
    new SlashCommandBuilder().setName("status").setDescription("Show bot status and uptime"),
    new SlashCommandBuilder()
      .setName("list")
      .setDescription("List stations (paginated)")
      .addIntegerOption((o) => o.setName("page").setDescription("Page number").setRequired(false)),
    new SlashCommandBuilder().setName("health").setDescription("Show stream health and reconnect info"),
    new SlashCommandBuilder().setName("premium").setDescription("Show your server premium status"),
    // Custom Stations (Ultimate)
    new SlashCommandBuilder()
      .setName("addstation")
      .setDescription("[Ultimate] Add a custom station URL")
      .addStringOption((o) => o.setName("key").setDescription("Short key (e.g. mystation)").setRequired(true))
      .addStringOption((o) => o.setName("name").setDescription("Display name").setRequired(true))
      .addStringOption((o) => o.setName("url").setDescription("Stream URL (http/https)").setRequired(true)),
    new SlashCommandBuilder()
      .setName("removestation")
      .setDescription("[Ultimate] Remove a custom station")
      .addStringOption((o) => o.setName("key").setDescription("Station key").setRequired(true).setAutocomplete(true)),
    new SlashCommandBuilder().setName("mystations").setDescription("[Ultimate] Show your custom stations"),
  ];
}

export function buildCommandsJson() {
  return buildCommandBuilders().map((cmd) => cmd.toJSON());
}
