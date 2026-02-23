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

const failedBots = [];

for (const bot of bots) {
  try {
    const rest = new REST({ version: "10" }).setToken(bot.token);
    const me = await rest.get(Routes.user("@me"));
    const runtimeClientId = String(me?.id || bot.clientId || "").trim();
    if (!runtimeClientId) {
      throw new Error("Application ID konnte nicht aufgeloest werden.");
    }
    if (runtimeClientId !== String(bot.clientId || "").trim()) {
      console.warn(`[WARN] ${bot.name}: CLIENT_ID mismatch (env=${bot.clientId}, runtime=${runtimeClientId}). Nutze runtime-ID.`);
    }
    if (syncGuildCommands) {
      console.log(`Ueberspringe globale Slash-Commands fuer ${bot.name} (${runtimeClientId}) (nur Guild-Sync aktiv).`);
    } else {
      console.log(`Registriere globale Slash-Commands fuer ${bot.name} (${runtimeClientId})...`);
      await rest.put(Routes.applicationCommands(runtimeClientId), { body: commands });
    }
    console.log("Fertig.");
  } catch (err) {
    failedBots.push(bot.name);
    console.error(`Fehler bei ${bot.name}:`, err?.message || err);
  }
}

if (syncGuildCommands) {
  console.log("Global-Command-Deploy uebersprungen (nur Guild-Sync). Guild-Commands werden beim Bot-Start synchronisiert.");
} else {
  console.log("Alle Bot-Commands registriert (globale Commands koennen bis zu 1h fuer volle Sichtbarkeit brauchen).");
}

if (failedBots.length > 0) {
  console.error(`[WARN] Command-Deploy unvollstaendig. Fehlgeschlagen fuer: ${failedBots.join(", ")}`);
  process.exitCode = 1;
}
