import dotenv from "dotenv";
import { REST } from "@discordjs/rest";
import { Routes } from "discord.js";
import { loadBotConfigs } from "./bot-config.js";
import { buildCommandsJson } from "./commands.js";

dotenv.config();

const commands = buildCommandsJson();
const syncGuildCommands = String(process.env.SYNC_GUILD_COMMANDS_ON_BOOT ?? "1") !== "0";
const cleanGlobalCommands = String(process.env.CLEAN_GLOBAL_COMMANDS_ON_BOOT ?? "1") !== "0";
let bots;

try {
  bots = loadBotConfigs(process.env);
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}

const failedBots = [];
const configuredCommander = Number.parseInt(String(process.env.COMMANDER_BOT_INDEX || "1"), 10);
const commanderBot = Number.isFinite(configuredCommander) && configuredCommander >= 1
  ? bots.find((bot) => Number(bot?.index || 0) === configuredCommander) || bots[0]
  : bots[0];

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
    const isCommander = bot.id === commanderBot.id;

    if (!isCommander) {
      if (cleanGlobalCommands) {
        await rest.put(Routes.applicationCommands(runtimeClientId), { body: [] });
        console.log(`Worker ${bot.name}: globale Slash-Commands entfernt.`);
      } else {
        console.log(`Worker ${bot.name}: globale Slash-Commands bleiben unveraendert (Cleanup deaktiviert).`);
      }
      console.log("Fertig.");
      continue;
    }

    if (syncGuildCommands) {
      if (cleanGlobalCommands) {
        await rest.put(Routes.applicationCommands(runtimeClientId), { body: [] });
        console.log(`Commander ${bot.name}: globale Slash-Commands bereinigt (nur Guild-Sync aktiv).`);
      } else {
        console.log(`Ueberspringe globale Slash-Commands fuer Commander ${bot.name} (${runtimeClientId}) (nur Guild-Sync aktiv).`);
      }
    } else {
      console.log(`Registriere globale Slash-Commands fuer Commander ${bot.name} (${runtimeClientId})...`);
      await rest.put(Routes.applicationCommands(runtimeClientId), { body: commands });
    }
    console.log("Fertig.");
  } catch (err) {
    failedBots.push(bot.name);
    console.error(`Fehler bei ${bot.name}:`, err?.message || err);
  }
}

if (syncGuildCommands) {
  console.log("Global-Command-Deploy uebersprungen (nur Guild-Sync). Nur der Commander synchronisiert Guild-Commands beim Bot-Start.");
} else {
  console.log("Globale Commands fuer Commander registriert (Worker haben keine Commands).");
}

if (failedBots.length > 0) {
  console.error(`[WARN] Command-Deploy unvollstaendig. Fehlgeschlagen fuer: ${failedBots.join(", ")}`);
  process.exitCode = 1;
}
