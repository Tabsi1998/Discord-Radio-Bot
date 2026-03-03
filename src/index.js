// ============================================================
// OmniFM v3.0 - Entry Point
// ============================================================
import dotenv from "dotenv";
dotenv.config();

import { log, getLogWriteQueue } from "./lib/logging.js";
import { connect as connectDb } from "./lib/db.js";
import { TIERS, parseExpiryReminderDays } from "./lib/helpers.js";
import { normalizeLanguage, getDefaultLanguage } from "./i18n.js";
import { loadBotConfigs } from "./bot-config.js";
import { BotRuntime } from "./bot/runtime.js";
import { WorkerManager } from "./bot/worker-manager.js";
import { startWebServer } from "./api/server.js";
import { loadStations, initStationsStore } from "./stations-store.js";
import {
  listLicenses,
  patchLicenseById,
  getServerLicense,
  initPremiumStore,
} from "./premium-store.js";
import { setLicenseProvider } from "./core/entitlements.js";
import {
  isConfigured as isEmailConfigured,
  sendMail,
  buildExpiryWarningEmail,
  buildExpiryEmail,
} from "./email.js";
import {
  getDiscordBotListIntervals,
  isDiscordBotListEnabled,
  syncDiscordBotListCommands,
  syncDiscordBotListStats,
  syncDiscordBotListVotes,
} from "./services/discordbotlist.js";

const EXPIRY_REMINDER_DAYS = parseExpiryReminderDays(process.env.EXPIRY_REMINDER_DAYS);
const AUTO_RESTORE_STAGGER_MS = Math.max(0, Number.parseInt(String(process.env.AUTO_RESTORE_STAGGER_MS || "2500"), 10) || 2500);
const AUTO_RESTORE_READY_GRACE_MS = Math.max(0, Number.parseInt(String(process.env.AUTO_RESTORE_READY_GRACE_MS || "2000"), 10) || 2000);

// ---- Optional MongoDB-Verbindung ----
const mongoUrlConfigured = String(process.env.MONGO_URL || "").trim().length > 0;
const mongoEnabled = String(process.env.MONGO_ENABLED || "").trim() === "1" || mongoUrlConfigured;
if (mongoEnabled) {
  try {
    await connectDb();
    log("INFO", "MongoDB-Verbindung fuer Node.js Bot hergestellt.");
  } catch (err) {
    log("WARN", `MongoDB-Verbindung fehlgeschlagen: ${err.message}. Datei-basierte Stores bleiben aktiv.`);
  }
} else {
  log("INFO", "MongoDB ist deaktiviert (MONGO_ENABLED=0 und MONGO_URL nicht gesetzt). Nutze Datei-basierte Stores.");
}
await initPremiumStore();
await initStationsStore();

// ---- Lizenz-Provider fuer Entitlements verbinden ----
setLicenseProvider((serverId) => {
  const license = getServerLicense(serverId);
  if (!license) return null;
  return { plan: license.plan || license.tier || "free", active: !license.expired };
});

// ---- Bot Startup: Commander/Worker Architecture ----
let botConfigs;
try {
  botConfigs = loadBotConfigs(process.env);
} catch (err) {
  log("ERROR", err.message || String(err));
  process.exit(1);
}

// Commander per BOT_N waehlen (COMMANDER_BOT_INDEX=N), fallback auf ersten konfigurierten Bot.
const configuredCommander = Number.parseInt(String(process.env.COMMANDER_BOT_INDEX || "1"), 10);
const commanderIndex = Number.isFinite(configuredCommander) && configuredCommander >= 1
  ? botConfigs.findIndex((cfg) => Number(cfg?.index || 0) === configuredCommander)
  : -1;
const resolvedCommanderIndex = commanderIndex >= 0 ? commanderIndex : 0;
if (commanderIndex >= 0) {
  log("INFO", `Commander-Bot aus ENV: BOT_${configuredCommander}`);
} else if (Number.isFinite(configuredCommander) && configuredCommander >= 1) {
  log("WARN", `COMMANDER_BOT_INDEX=${configuredCommander} ist nicht konfiguriert. Fallback auf BOT_${botConfigs[0]?.index || 1}.`);
}
const commanderConfig = botConfigs[resolvedCommanderIndex];
const workerConfigs = botConfigs.filter((_, idx) => idx !== resolvedCommanderIndex);

// Create worker runtimes first (so WorkerManager can reference them)
const workerRuntimes = workerConfigs.map((config) => new BotRuntime(config, { role: "worker" }));
const workerManager = new WorkerManager(workerRuntimes);

// Create commander runtime with worker manager reference
const commanderRuntime = new BotRuntime(commanderConfig, { role: "commander", workerManager });

// All runtimes for shared operations
const runtimes = [commanderRuntime, ...workerRuntimes];

log("INFO", `Bot-Architektur: Commander="${commanderConfig.name}", Worker=${workerConfigs.length} (${workerConfigs.map(c => c.name).join(", ") || "keine"})`);

const startResults = await Promise.all(runtimes.map((runtime) => runtime.start()));
const startedRuntimes = [];
const failedRuntimes = [];

for (let index = 0; index < runtimes.length; index++) {
  if (startResults[index]) {
    startedRuntimes.push(runtimes[index]);
  } else {
    failedRuntimes.push(runtimes[index]);
  }
}

log(
  "INFO",
  `Bot-Startup abgeschlossen: started=${startedRuntimes.length}/${runtimes.length}, failed=${failedRuntimes.length}/${runtimes.length}`
);

for (const failedRuntime of failedRuntimes) {
  const errText = failedRuntime.startError?.message || String(failedRuntime.startError || "unbekannt");
  log(
    "ERROR",
    `[${failedRuntime.config.name}] Start fehlgeschlagen. Dieser Bot liefert keine Slash-Commands, bis der Login/Token-Fehler behoben ist. Grund: ${errText}`
  );
}

if (!startResults.some(Boolean)) {
  log("ERROR", "Kein Bot konnte gestartet werden. Backend wird beendet.");
  process.exit(1);
}

// ---- Auto-Restore ----
const stations = loadStations();
const autoRestoreBaseAtMs = Date.now() + AUTO_RESTORE_READY_GRACE_MS;
for (const [runtimeIndex, runtime] of startedRuntimes.entries()) {
  const scheduledRestoreAtMs = autoRestoreBaseAtMs + (runtimeIndex * AUTO_RESTORE_STAGGER_MS);
  const scheduleRestore = () => {
    const restoreDelayMs = Math.max(0, scheduledRestoreAtMs - Date.now());
    const doRestore = () => {
      if (restoreDelayMs > 0) {
        log("INFO", `[${runtime.config.name}] Starte Auto-Restore nach ${restoreDelayMs}ms Staffelung...`);
      } else {
        log("INFO", `[${runtime.config.name}] Starte Auto-Restore...`);
      }
      runtime.restoreState(stations).catch((err) => {
        log("ERROR", `[${runtime.config.name}] Auto-Restore fehlgeschlagen: ${err?.message || err}`);
      });
    };
    setTimeout(doRestore, restoreDelayMs);
  };

  if (runtime.client.isReady()) {
    scheduleRestore();
  } else {
    runtime.client.once("clientReady", scheduleRestore);
  }
}

// ---- Web Server ----
const webServer = startWebServer(runtimes);

// ---- DiscordBotList Sync ----
const discordBotListEnabled = isDiscordBotListEnabled(runtimes);
if (discordBotListEnabled) {
  const discordBotListIntervals = getDiscordBotListIntervals();
  let discordBotListCommandsSyncRunning = false;
  let discordBotListStatsSyncRunning = false;
  let discordBotListVotesSyncRunning = false;

  const runDiscordBotListCommandsSync = async (source = "periodic") => {
    if (discordBotListCommandsSyncRunning) return;
    discordBotListCommandsSyncRunning = true;
    try {
      await syncDiscordBotListCommands(runtimes);
    } catch (err) {
      log("ERROR", `[DiscordBotList] Command sync (${source}) fehlgeschlagen: ${err?.message || err}`);
    } finally {
      discordBotListCommandsSyncRunning = false;
    }
  };

  const runDiscordBotListStatsSync = async (source = "periodic") => {
    if (discordBotListStatsSyncRunning) return;
    discordBotListStatsSyncRunning = true;
    try {
      await syncDiscordBotListStats(runtimes);
    } catch (err) {
      log("ERROR", `[DiscordBotList] Stats sync (${source}) fehlgeschlagen: ${err?.message || err}`);
    } finally {
      discordBotListStatsSyncRunning = false;
    }
  };

  const runDiscordBotListVotesSync = async (source = "periodic") => {
    if (discordBotListVotesSyncRunning) return;
    discordBotListVotesSyncRunning = true;
    try {
      await syncDiscordBotListVotes(runtimes);
    } catch (err) {
      log("ERROR", `[DiscordBotList] Vote sync (${source}) fehlgeschlagen: ${err?.message || err}`);
    } finally {
      discordBotListVotesSyncRunning = false;
    }
  };

  const startupDelayMs = discordBotListIntervals.startupDelayMs;
  log("INFO", `[DiscordBotList] Sync aktiviert (startupDelay=${startupDelayMs}ms).`);
  setTimeout(() => {
    runDiscordBotListCommandsSync("startup");
    runDiscordBotListStatsSync("startup");
    runDiscordBotListVotesSync("startup");
  }, startupDelayMs);

  if (discordBotListIntervals.commandsSyncMs > 0) {
    setInterval(() => {
      runDiscordBotListCommandsSync("periodic");
    }, discordBotListIntervals.commandsSyncMs);
  }

  if (discordBotListIntervals.statsSyncMs > 0) {
    setInterval(() => {
      runDiscordBotListStatsSync("periodic");
    }, discordBotListIntervals.statsSyncMs);
  }

  if (discordBotListIntervals.voteSyncMs > 0) {
    setInterval(() => {
      runDiscordBotListVotesSync("periodic");
    }, discordBotListIntervals.voteSyncMs);
  }
} else {
  log("INFO", "[DiscordBotList] Sync deaktiviert oder nicht konfiguriert.");
}

// ---- Periodic Tasks ----

// Periodisches Speichern des Bot-State (alle 60s) als Backup
setInterval(() => {
  for (const runtime of startedRuntimes) {
    if (runtime.client.isReady()) {
      runtime.persistState();
    }
  }
}, 60_000);

// Periodischer Guild-Command-Sync
const periodicGuildSyncIntervalRaw = Number.parseInt(String(process.env.PERIODIC_GUILD_COMMAND_SYNC_MS ?? "1800000"), 10);
const periodicGuildSyncIntervalMs = Number.isFinite(periodicGuildSyncIntervalRaw) && periodicGuildSyncIntervalRaw >= 60_000
  ? periodicGuildSyncIntervalRaw
  : 0;
let periodicGuildSyncRunning = false;

if (periodicGuildSyncIntervalMs > 0) {
  log("INFO", `Periodischer Guild-Command-Sync aktiv: alle ${Math.round(periodicGuildSyncIntervalMs / 1000)}s.`);
  setInterval(() => {
    if (periodicGuildSyncRunning) return;
    periodicGuildSyncRunning = true;
    (async () => {
      for (const runtime of runtimes) {
        if (runtime.role !== "commander") continue;
        if (!runtime.client.isReady()) continue;
        if (!runtime.isGuildCommandSyncEnabled()) continue;
        await runtime.syncGuildCommands("periodic");
      }
    })()
      .catch((err) => {
        log("ERROR", `[GuildSync] Periodischer Sync fehlgeschlagen: ${err?.message || err}`);
      })
      .finally(() => {
        periodicGuildSyncRunning = false;
      });
  }, periodicGuildSyncIntervalMs);
} else {
  log("INFO", "Periodischer Guild-Command-Sync deaktiviert (PERIODIC_GUILD_COMMAND_SYNC_MS=0).");
}

// Lizenz-Ablauf pruefen (alle 6 Stunden)
log("INFO", `Lizenz-Reminder aktiv fuer: ${EXPIRY_REMINDER_DAYS.join(", ")} Tage vor Ablauf + abgelaufen.`);
setInterval(async () => {
  if (!isEmailConfigured()) return;
  try {
    const all = listLicenses();
    for (const [rawLicenseId, lic] of Object.entries(all)) {
      if (!lic?.expiresAt) continue;

      const licenseId = String(lic.id || rawLicenseId || "").trim();
      const serverId = String((lic.linkedServerIds || [])[0] || "-");
      const tierKey = String(lic.plan || lic.tier || "free");
      const tierName = TIERS[tierKey]?.name || tierKey;
      const emailLanguage = normalizeLanguage(lic.preferredLanguage || lic.language, getDefaultLanguage());
      const contactEmail = String(lic.contactEmail || "").trim().toLowerCase();
      const daysUntilExpiry = Math.ceil((new Date(lic.expiresAt) - new Date()) / 86400000);

      if (daysUntilExpiry > 0) {
        for (let idx = 0; idx < EXPIRY_REMINDER_DAYS.length; idx++) {
          const reminderDay = EXPIRY_REMINDER_DAYS[idx];
          const nextLowerDay = EXPIRY_REMINDER_DAYS[idx + 1] ?? 0;
          const withinWindow = daysUntilExpiry <= reminderDay && daysUntilExpiry > nextLowerDay;
          if (!withinWindow) continue;

          const warningFlagField = `_warning${reminderDay}ForExpiryAt`;
          const warningAlreadySent = lic[warningFlagField] === lic.expiresAt;
          if (warningAlreadySent) break;
          if (!contactEmail) break;

          const html = buildExpiryWarningEmail({
            tierName,
            serverId,
            expiresAt: lic.expiresAt,
            daysLeft: Math.max(1, daysUntilExpiry),
            language: emailLanguage,
          });
          const warningSubject = emailLanguage === "de"
            ? `Premium ${tierName} laeuft in ${Math.max(1, daysUntilExpiry)} ${Math.max(1, daysUntilExpiry) === 1 ? "Tag" : "Tagen"} ab!`
            : `Premium ${tierName} expires in ${Math.max(1, daysUntilExpiry)} day${Math.max(1, daysUntilExpiry) === 1 ? "" : "s"}!`;
          const result = await sendMail(contactEmail, warningSubject, html);
          if (result?.success) {
            patchLicenseById(licenseId, { [warningFlagField]: lic.expiresAt });
            log("INFO", `[Email] Ablauf-Warnung (${reminderDay}d) gesendet an ${contactEmail} fuer Lizenz ${licenseId} (Server ${serverId})`);
          } else {
            log("ERROR", `[Email] Ablauf-Warnung (${reminderDay}d) fehlgeschlagen fuer Lizenz ${licenseId}: ${result?.error || "Unbekannter Fehler"}`);
          }
          break;
        }
      }

      const expiredAlreadyNotified =
        lic._expiredNotifiedForExpiryAt === lic.expiresAt || lic._expiredNotified === true;
      if (daysUntilExpiry <= 0 && contactEmail && !expiredAlreadyNotified) {
        const html = buildExpiryEmail({ tierName, serverId, language: emailLanguage });
        const expiredSubject = emailLanguage === "de"
          ? `Premium ${tierName} abgelaufen`
          : `Premium ${tierName} expired`;
        const result = await sendMail(contactEmail, expiredSubject, html);
        if (result?.success) {
          patchLicenseById(licenseId, { _expiredNotifiedForExpiryAt: lic.expiresAt, _expiredNotified: true });
          log("INFO", `[Email] Ablauf-Benachrichtigung gesendet an ${contactEmail} fuer Lizenz ${licenseId} (Server ${serverId})`);
        } else {
          log("ERROR", `[Email] Ablauf-Benachrichtigung fehlgeschlagen fuer Lizenz ${licenseId}: ${result?.error || "Unbekannter Fehler"}`);
        }
      }
    }
  } catch (err) {
    log("ERROR", `[ExpiryCheck] ${err.message}`);
  }
}, 6 * 60 * 60 * 1000);

// Premium-Bot-Guild-Scope regelmaessig durchsetzen
setInterval(() => {
  for (const runtime of runtimes) {
    if (!runtime.client.isReady()) continue;
    runtime.enforcePremiumGuildScope("periodic").catch((err) => {
      log("ERROR", `[${runtime.config.name}] Periodische Premium-Guild-Scope Pruefung fehlgeschlagen: ${err?.message || err}`);
    });
  }
}, 10 * 60 * 1000);

// ---- Shutdown ----
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("INFO", `Shutdown via ${signal}...`);

  log("INFO", "Speichere Bot-State fuer Auto-Reconnect...");
  for (const runtime of runtimes) {
    runtime.persistState();
  }
  log("INFO", "Bot-State gespeichert.");

  webServer.close();
  await Promise.all(runtimes.map((runtime) => runtime.stop()));
  try {
    await getLogWriteQueue();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on("SIGINT", () => {
  shutdown("SIGINT").catch(() => process.exit(1));
});
process.on("SIGTERM", () => {
  shutdown("SIGTERM").catch(() => process.exit(1));
});
