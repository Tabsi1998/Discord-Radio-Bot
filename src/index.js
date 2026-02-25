// ============================================================
// OmniFM v3.0 - Entry Point
// ============================================================
import dotenv from "dotenv";
dotenv.config();

import { log, getLogWriteQueue } from "./lib/logging.js";
import { TIERS, parseExpiryReminderDays } from "./lib/helpers.js";
import { normalizeLanguage, getDefaultLanguage } from "./i18n.js";
import { loadBotConfigs } from "./bot-config.js";
import { BotRuntime } from "./bot/runtime.js";
import { startWebServer } from "./api/server.js";
import { loadStations } from "./stations-store.js";
import {
  listRawLicenses,
  patchLicenseById,
} from "./premium-store.js";
import {
  isConfigured as isEmailConfigured,
  sendMail,
  buildExpiryWarningEmail,
  buildExpiryEmail,
} from "./email.js";

const EXPIRY_REMINDER_DAYS = parseExpiryReminderDays(process.env.EXPIRY_REMINDER_DAYS);

// ---- Bot Startup ----
let botConfigs;
try {
  botConfigs = loadBotConfigs(process.env);
} catch (err) {
  log("ERROR", err.message || String(err));
  process.exit(1);
}

const runtimes = botConfigs.map((config) => new BotRuntime(config));
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
for (const runtime of startedRuntimes) {
  const doRestore = () => {
    log("INFO", `[${runtime.config.name}] Starte Auto-Restore...`);
    runtime.restoreState(stations).catch((err) => {
      log("ERROR", `[${runtime.config.name}] Auto-Restore fehlgeschlagen: ${err?.message || err}`);
    });
  };

  if (runtime.client.isReady()) {
    doRestore();
  } else {
    runtime.client.once("clientReady", () => {
      setTimeout(doRestore, 2000);
    });
  }
}

// ---- Web Server ----
const webServer = startWebServer(runtimes);

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
    const all = listRawLicenses();
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
