import dotenv from "dotenv";
import { REST } from "@discordjs/rest";
import { Routes } from "discord.js";
import { loadBotConfigs } from "./bot-config.js";
import { buildCommandsJson } from "./commands.js";

dotenv.config();

const commands = buildCommandsJson();
let bots;

try {
  bots = loadBotConfigs(process.env);
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}

for (const bot of bots) {
  try {
    console.log(`Registriere globale Slash-Commands fuer ${bot.name} (${bot.clientId})...`);
    const rest = new REST({ version: "10" }).setToken(bot.token);
    await rest.put(Routes.applicationCommands(bot.clientId), { body: commands });
    console.log("Fertig.");
  } catch (err) {
    console.error(`Fehler bei ${bot.name}:`, err);
    process.exit(1);
  }
}

console.log("Alle Bot-Commands registriert (globale Commands koennen bis zu 1h fuer volle Sichtbarkeit brauchen).");
