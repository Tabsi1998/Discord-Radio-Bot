import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { TIERS, addLicense, removeLicense, listLicenses, getLicense, getTierConfig } from "./premium-store.js";
import { loadBotConfigs, buildInviteUrl } from "./bot-config.js";
import dotenv from "dotenv";

dotenv.config();

const rl = createInterface({ input: stdin, output: stdout });

function printBanner() {
  console.log("");
  console.log("  \x1b[36m\x1b[1m╔═══════════════════════════════════════╗\x1b[0m");
  console.log("  \x1b[36m\x1b[1m║   Discord Radio Bot - Premium CLI     ║\x1b[0m");
  console.log("  \x1b[36m\x1b[1m╚═══════════════════════════════════════╝\x1b[0m");
  console.log("");
}

function ok(msg)   { console.log(`  \x1b[32m[OK]\x1b[0m   ${msg}`); }
function info(msg) { console.log(`  \x1b[36m[INFO]\x1b[0m ${msg}`); }
function fail(msg) { console.log(`  \x1b[31m[FAIL]\x1b[0m ${msg}`); }
function warn(msg) { console.log(`  \x1b[33m[WARN]\x1b[0m ${msg}`); }

function printTierInfo(tier, config) {
  const colors = { free: "\x1b[37m", pro: "\x1b[33m", ultimate: "\x1b[35m" };
  const c = colors[tier] || "\x1b[37m";
  console.log(`  ${c}${config.name}\x1b[0m: Bitrate ${config.bitrate}, Reconnect ${config.reconnectMs}ms, Max ${config.maxBots} Bots`);
}

function validateServerId(id) {
  return /^\d{17,22}$/.test(id);
}

async function cmdAdd(args) {
  let serverId = args[0];
  let tier = args[1];
  let note = args.slice(2).join(" ");

  if (!serverId) {
    serverId = await rl.question("  \x1b[36m?\x1b[0m \x1b[1mServer ID\x1b[0m: ");
  }
  if (!validateServerId(serverId)) {
    fail("Server ID muss 17-22 Ziffern sein.");
    return 1;
  }

  if (!tier) {
    console.log("");
    console.log("  Verfuegbare Tiers:");
    console.log("    \x1b[33m1\x1b[0m) Pro      (4.99 EUR/Monat) - 192k, 10 Bots");
    console.log("    \x1b[35m2\x1b[0m) Ultimate (9.99 EUR/Monat) - 320k, 20 Bots");
    console.log("");
    const choice = await rl.question("  \x1b[36m?\x1b[0m \x1b[1mTier waehlen (1/2)\x1b[0m: ");
    tier = choice === "1" ? "pro" : choice === "2" ? "ultimate" : choice;
  }

  if (tier !== "pro" && tier !== "ultimate") {
    fail("Tier muss 'pro' oder 'ultimate' sein.");
    return 1;
  }

  if (!note) {
    note = await rl.question("  \x1b[36m?\x1b[0m \x1b[2mNotiz (optional)\x1b[0m: ");
  }

  try {
    addLicense(serverId, tier, "admin", note);
    ok(`Server ${serverId} auf ${TIERS[tier].name} aktiviert.`);
    return 0;
  } catch (err) {
    fail(err.message);
    return 1;
  }
}

async function cmdRemove(args) {
  let serverId = args[0];
  if (!serverId) {
    serverId = await rl.question("  \x1b[36m?\x1b[0m \x1b[1mServer ID zum Entfernen\x1b[0m: ");
  }
  if (!validateServerId(serverId)) {
    fail("Server ID muss 17-22 Ziffern sein.");
    return 1;
  }

  const existed = removeLicense(serverId);
  if (existed) {
    ok(`Premium fuer Server ${serverId} entfernt (zurueck auf Free).`);
  } else {
    warn(`Server ${serverId} hatte kein Premium.`);
  }
  return 0;
}

async function cmdList() {
  const licenses = listLicenses();
  const entries = Object.entries(licenses);
  if (entries.length === 0) {
    info("Keine Premium-Lizenzen vorhanden.");
    return 0;
  }

  console.log("");
  console.log("  \x1b[1mServer ID            Tier       Aktiviert            Notiz\x1b[0m");
  console.log("  " + "-".repeat(75));
  for (const [id, lic] of entries) {
    const tierColor = lic.tier === "ultimate" ? "\x1b[35m" : "\x1b[33m";
    const date = lic.activatedAt ? lic.activatedAt.slice(0, 19).replace("T", " ") : "-";
    console.log(`  ${id}  ${tierColor}${(lic.tier || "?").padEnd(10)}\x1b[0m ${date}  ${lic.note || ""}`);
  }
  console.log("");
  info(`${entries.length} Lizenz(en) gesamt.`);
  return 0;
}

async function cmdCheck(args) {
  let serverId = args[0];
  if (!serverId) {
    serverId = await rl.question("  \x1b[36m?\x1b[0m \x1b[1mServer ID pruefen\x1b[0m: ");
  }
  if (!validateServerId(serverId)) {
    fail("Server ID muss 17-22 Ziffern sein.");
    return 1;
  }

  const config = getTierConfig(serverId);
  const license = getLicense(serverId);
  console.log("");
  console.log(`  Server: ${serverId}`);
  printTierInfo(config.tier, config);
  if (license) {
    console.log(`  Aktiviert: ${license.activatedAt || "-"}`);
    console.log(`  Von: ${license.activatedBy || "-"}`);
    if (license.note) console.log(`  Notiz: ${license.note}`);
  }
  console.log("");
  return 0;
}

async function cmdWizard() {
  printBanner();
  console.log("  Verfuegbare Aktionen:");
  console.log("    \x1b[32m1\x1b[0m) Premium aktivieren");
  console.log("    \x1b[31m2\x1b[0m) Premium entfernen");
  console.log("    \x1b[36m3\x1b[0m) Alle Lizenzen anzeigen");
  console.log("    \x1b[33m4\x1b[0m) Server pruefen");
  console.log("    \x1b[35m5\x1b[0m) Tier-Infos");
  console.log("    \x1b[36m6\x1b[0m) Bot Invite-Links");
  console.log("    \x1b[2m7\x1b[0m) Beenden");
  console.log("");

  const choice = await rl.question("  \x1b[36m?\x1b[0m \x1b[1mAktion waehlen\x1b[0m: ");

  switch (choice.trim()) {
    case "1": return cmdAdd([]);
    case "2": return cmdRemove([]);
    case "3": return cmdList();
    case "4": return cmdCheck([]);
    case "5": return cmdTiers();
    case "6": return cmdInvite();
    case "7": return 0;
    default:
      fail("Unbekannte Aktion.");
      return 1;
  }
}

async function cmdTiers() {
  console.log("");
  console.log("  \x1b[1mVerfuegbare Tiers:\x1b[0m");
  console.log("");
  Object.entries(TIERS).forEach(([k, v]) => printTierInfo(k, v));
  console.log("");
  return 0;
}

async function cmdInvite() {
  let bots;
  try {
    bots = loadBotConfigs();
  } catch (err) {
    fail("Fehler beim Laden der Bot-Konfiguration: " + err.message);
    info("Pruefe deine .env Datei.");
    return 1;
  }
  console.log("");
  console.log(`  \x1b[1mBot Invite-Links (${bots.length} Bots):\x1b[0m`);
  console.log("");
  for (const bot of bots) {
    const url = buildInviteUrl(bot);
    console.log(`  \x1b[36m${bot.name}\x1b[0m \x1b[2m(${bot.clientId})\x1b[0m`);
    console.log(`  \x1b[32m${url}\x1b[0m`);
    console.log("");
  }
  return 0;
}

async function run() {
  const args = process.argv.slice(2);
  const cmd = args[0] || "";
  const rest = args.slice(1);

  switch (cmd) {
    case "add":     return cmdAdd(rest);
    case "remove":  return cmdRemove(rest);
    case "list":    return cmdList();
    case "check":   return cmdCheck(rest);
    case "wizard":  return cmdWizard();
    case "help":
    case "--help":
    case "-h":
      printBanner();
      console.log("  Verwendung:");
      console.log("    premium.sh add <server-id> <pro|ultimate> [notiz]");
      console.log("    premium.sh remove <server-id>");
      console.log("    premium.sh list");
      console.log("    premium.sh check <server-id>");
      console.log("    premium.sh wizard");
      console.log("");
      console.log("  Tiers:");
      Object.entries(TIERS).forEach(([k, v]) => printTierInfo(k, v));
      console.log("");
      return 0;
    default:
      return cmdWizard();
  }
}

const code = await run();
rl.close();
process.exit(code);
