import dotenv from "dotenv";
import { REST } from "@discordjs/rest";
import { Routes } from "discord.js";
import { loadBotConfigs } from "./bot-config.js";
import { buildCommandsJson } from "./commands.js";

dotenv.config();

const commands = buildCommandsJson();
const syncGuildCommands = String(process.env.SYNC_GUILD_COMMANDS_ON_BOOT ?? "1") !== "0";
let bots;

try {
  bots = loadBotConfigs(process.env);
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}

for (const bot of bots) {
  try {
    const rest = new REST({ version: "10" }).setToken(bot.token);
    if (syncGuildCommands) {
      console.log(`Loesche globale Slash-Commands fuer ${bot.name} (${bot.clientId}) (Guild-Sync aktiv)...`);
      await rest.put(Routes.applicationCommands(bot.clientId), { body: [] });
    } else {
      console.log(`Registriere globale Slash-Commands fuer ${bot.name} (${bot.clientId})...`);
      await rest.put(Routes.applicationCommands(bot.clientId), { body: commands });
    }
    console.log("Fertig.");
  } catch (err) {
    console.error(`Fehler bei ${bot.name}:`, err);
    process.exit(1);
  }
}

if (syncGuildCommands) {
  console.log("Globale Commands wurden geloescht. Guild-Commands werden beim Bot-Start synchronisiert.");
} else {
  console.log("Alle Bot-Commands registriert (globale Commands koennen bis zu 1h fuer volle Sichtbarkeit brauchen).");
}
