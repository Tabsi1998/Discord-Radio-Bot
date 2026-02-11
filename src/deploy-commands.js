import { REST } from "@discordjs/rest";
import { SlashCommandBuilder, Routes } from "discord.js";
import dotenv from "dotenv";

dotenv.config();
const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Startet einen Radio-Stream")
    .addStringOption((option) =>
      option
        .setName("station")
        .setDescription("Welche Station?")
        .setRequired(false)
        .setAutocomplete(true)
    ),
  new SlashCommandBuilder().setName("pause").setDescription("Pausiert die Wiedergabe"),
  new SlashCommandBuilder().setName("resume").setDescription("Setzt die Wiedergabe fort"),
  new SlashCommandBuilder().setName("stop").setDescription("Stoppt die Wiedergabe und verlässt den Channel"),
  new SlashCommandBuilder().setName("stations").setDescription("Zeigt verfügbare Stationen"),
  new SlashCommandBuilder().setName("now").setDescription("Zeigt die aktuelle Station"),
  new SlashCommandBuilder()
    .setName("addstation")
    .setDescription("Fügt eine Station hinzu")
    .addStringOption((option) =>
      option.setName("name").setDescription("Anzeigename").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("url").setDescription("Stream-URL").setRequired(true)
    )
    .addStringOption((option) =>
      option.setName("key").setDescription("Optionaler Key (ohne Leerzeichen)").setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("removestation")
    .setDescription("Entfernt eine Station")
    .addStringOption((option) =>
      option.setName("key").setDescription("Station-Key").setRequired(true).setAutocomplete(true)
    )
].map((cmd) => cmd.toJSON());

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("Fehlende ENV Variablen: DISCORD_TOKEN, CLIENT_ID, GUILD_ID");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

try {
  console.log("Slash Commands werden registriert...");
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  console.log("Fertig.");
} catch (err) {
  console.error(err);
  process.exit(1);
}
