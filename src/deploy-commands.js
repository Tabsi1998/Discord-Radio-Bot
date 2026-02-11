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
    ),
  new SlashCommandBuilder()
    .setName("setdefault")
    .setDescription("Setzt die Standard-Station")
    .addStringOption((option) =>
      option.setName("key").setDescription("Station-Key").setRequired(true).setAutocomplete(true)
    ),
  new SlashCommandBuilder()
    .setName("renamestation")
    .setDescription("Benennt eine Station um")
    .addStringOption((option) =>
      option.setName("key").setDescription("Station-Key").setRequired(true).setAutocomplete(true)
    )
    .addStringOption((option) =>
      option.setName("name").setDescription("Neuer Name").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("setvolume")
    .setDescription("Setzt die Lautstärke (0-100)")
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
    .setName("backupstations")
    .setDescription("Exportiert stations.json"),
  new SlashCommandBuilder()
    .setName("importstations")
    .setDescription("Importiert stations.json (Attachment)")
    .addAttachmentOption((option) =>
      option.setName("file").setDescription("stations.json").setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName("quality")
    .setDescription("Setzt Transcoding Preset")
    .addStringOption((option) =>
      option
        .setName("preset")
        .setDescription("low/medium/high/custom")
        .setRequired(true)
        .addChoices(
          { name: "low", value: "low" },
          { name: "medium", value: "medium" },
          { name: "high", value: "high" },
          { name: "custom", value: "custom" }
        )
    ),
  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Sperrt/entsperrt Stations-Änderungen")
    .addStringOption((option) =>
      option
        .setName("mode")
        .setDescription("on/off")
        .setRequired(true)
        .addChoices(
          { name: "on", value: "on" },
          { name: "off", value: "off" }
        )
    ),
  new SlashCommandBuilder()
    .setName("audit")
    .setDescription("Zeigt letzte Änderungen")
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
