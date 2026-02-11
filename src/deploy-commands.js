import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REST, Routes } from "@discordjs/rest";
import { SlashCommandBuilder } from "discord.js";
import dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stationsPath = path.resolve(__dirname, "..", "stations.json");
const stations = JSON.parse(fs.readFileSync(stationsPath, "utf8"));

const stationChoices = Object.entries(stations.stations)
  .slice(0, 25)
  .map(([key, value]) => ({ name: value.name, value: key }));

const commands = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("Startet einen Radio-Stream")
    .addStringOption((option) =>
      option
        .setName("station")
        .setDescription("Welche Station?")
        .setRequired(false)
        .addChoices(...stationChoices)
    ),
  new SlashCommandBuilder().setName("pause").setDescription("Pausiert die Wiedergabe"),
  new SlashCommandBuilder().setName("resume").setDescription("Setzt die Wiedergabe fort"),
  new SlashCommandBuilder().setName("stop").setDescription("Stoppt die Wiedergabe und verlässt den Channel"),
  new SlashCommandBuilder().setName("stations").setDescription("Zeigt verfügbare Stationen"),
  new SlashCommandBuilder().setName("now").setDescription("Zeigt die aktuelle Station")
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
