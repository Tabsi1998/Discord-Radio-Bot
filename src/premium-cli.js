import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PLANS } from "./config/plans.js";
import {
  getServerLicense, listLicenses, addLicenseForServer, removeLicense,
  upgradeLicenseForServer,
} from "./premium-store.js";

const PRICE_PER_MONTH_CENTS = { free: 0, pro: 299, ultimate: 499 };
const YEARLY_DISCOUNT_MONTHS = 10;

function calculatePrice(tier, months) {
  const ppm = PRICE_PER_MONTH_CENTS[tier];
  if (!ppm) return 0;
  if (months >= 12) return ppm * YEARLY_DISCOUNT_MONTHS;
  return ppm * months;
}

function calculateUpgradePrice(serverId, targetTier) {
  const lic = getServerLicense(serverId);
  if (!lic || lic.expired || !lic.active) return null;
  const oldTier = lic.plan || "free";
  if (oldTier === targetTier) return null;
  const oldPpm = PRICE_PER_MONTH_CENTS[oldTier] || 0;
  const newPpm = PRICE_PER_MONTH_CENTS[targetTier] || 0;
  const diff = newPpm - oldPpm;
  if (diff <= 0) return null;
  const daysLeft = lic.remainingDays || 0;
  if (daysLeft <= 0) return null;
  return { oldTier, targetTier, daysLeft, upgradeCost: Math.ceil(diff * daysLeft / 30) };
}

const rl = createInterface({ input: stdin, output: stdout });
const ask = (q) => rl.question(`  \x1b[36m?\x1b[0m ${q}: `);
const ok = (m) => console.log(`  \x1b[32m[OK]\x1b[0m ${m}`);
const info = (m) => console.log(`  \x1b[36m[INFO]\x1b[0m ${m}`);
const fail = (m) => console.log(`  \x1b[31m[FAIL]\x1b[0m ${m}`);
const centsToEur = (c) => (c / 100).toFixed(2).replace(".", ",") + " EUR";

function printHeader() {
  console.log("");
  console.log("  \x1b[36m\x1b[1m╔═══════════════════════════════════════╗");
  console.log("  ║   OmniFM - Premium CLI                ║");
  console.log("  ╚═══════════════════════════════════════╝\x1b[0m");
  console.log("");
}

function formatDate(iso) {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" });
}

async function wizardMenu() {
  console.log("  Verfuegbare Aktionen:");
  console.log("    \x1b[32m1\x1b[0m) Premium aktivieren (mit Laufzeit)");
  console.log("    \x1b[33m2\x1b[0m) Premium verlaengern");
  console.log("    \x1b[35m3\x1b[0m) Upgrade (Pro -> Ultimate)");
  console.log("    \x1b[31m4\x1b[0m) Premium entfernen");
  console.log("    \x1b[36m5\x1b[0m) Alle Lizenzen anzeigen");
  console.log("    6) Server pruefen");
  console.log("    7) Preisrechner");
  console.log("    8) Tier-Infos");
  console.log("    9) Beenden");
  console.log("");
  return ask("Aktion waehlen");
}

async function run() {
  printHeader();

  while (true) {
    const choice = await wizardMenu();

    switch (choice.trim()) {
      // --- Aktivieren ---
      case "1": {
        const serverId = await ask("Server ID");
        if (!/^\d{17,22}$/.test(serverId)) { fail("Ungueltige Server ID."); break; }

        const existing = getServerLicense(serverId);
        if (existing && !existing.expired) {
          info(`Server hat bereits ${(existing.plan || "free").toUpperCase()} (${existing.remainingDays} Tage uebrig).`);
          info("Nutze Option 2 (Verlaengern) oder 3 (Upgrade).");
          break;
        }

        const tier = (await ask("Tier (pro/ultimate)")).toLowerCase();
        if (tier !== "pro" && tier !== "ultimate") { fail("Muss 'pro' oder 'ultimate' sein."); break; }

        const months = parseInt(await ask("Laufzeit in Monaten")) || 1;
        const price = calculatePrice(tier, months);
        info(`Preis: ${centsToEur(price)} (${months} Monat${months > 1 ? "e" : ""})`);
        if (months >= 12) info("Jahresrabatt: 12 Monate zum Preis von 10!");

        const note = await ask("Notiz (optional)") || "";
        const lic = addLicenseForServer(serverId, tier, months, "admin-cli", note);
        ok(`Server ${serverId} auf ${tier.toUpperCase()} aktiviert bis ${formatDate(lic.expiresAt)}.`);
        break;
      }

      // --- Verlaengern ---
      case "2": {
        const serverId = await ask("Server ID");
        if (!/^\d{17,22}$/.test(serverId)) { fail("Ungueltige Server ID."); break; }

        const lic = getServerLicense(serverId);
        if (!lic || lic.expired) { fail("Keine aktive Lizenz. Nutze Option 1 zum Aktivieren."); break; }

        info(`Aktiv: ${(lic.plan || "free").toUpperCase()} (${lic.remainingDays} Tage uebrig, bis ${formatDate(lic.expiresAt)})`);

        const months = parseInt(await ask("Zusaetzliche Monate")) || 1;
        const price = calculatePrice(lic.plan, months);
        info(`Preis: ${centsToEur(price)} fuer ${months} Monat${months > 1 ? "e" : ""}`);

        const updated = addLicenseForServer(serverId, lic.plan, months, "admin-cli", `Verlaengerung +${months}M`);
        ok(`Laufzeit verlaengert bis ${formatDate(updated.expiresAt)}.`);
        break;
      }

      // --- Upgrade ---
      case "3": {
        const serverId = await ask("Server ID");
        if (!/^\d{17,22}$/.test(serverId)) { fail("Ungueltige Server ID."); break; }

        const lic = getServerLicense(serverId);
        if (!lic || lic.expired) { fail("Keine aktive Lizenz."); break; }
        if (lic.plan === "ultimate") { fail("Bereits Ultimate."); break; }

        const upgrade = calculateUpgradePrice(serverId, "ultimate");
        if (!upgrade) { fail("Upgrade nicht moeglich."); break; }

        info(`Aktiv: PRO (${upgrade.daysLeft} Tage uebrig)`);
        info(`Upgrade-Preis: ${centsToEur(upgrade.upgradeCost)} (Aufpreis fuer Restlaufzeit)`);

        const confirm = (await ask("Upgrade durchfuehren? (j/n)")).toLowerCase();
        if (confirm === "j" || confirm === "y") {
          upgradeLicenseForServer(serverId, "ultimate");
          ok(`Server ${serverId} auf ULTIMATE upgraded!`);
        }
        break;
      }

      // --- Entfernen ---
      case "4": {
        const serverId = await ask("Server ID");
        const lic = getServerLicense(serverId);
        if (lic && lic.id) {
          removeLicense(lic.id);
          ok(`Lizenz fuer ${serverId} entfernt.`);
        } else {
          fail("Keine Lizenz gefunden.");
        }
        break;
      }

      // --- Alle Lizenzen ---
      case "5": {
        const all = listLicenses();
        const entries = Object.entries(all);
        if (entries.length === 0) {
          info("Keine Lizenzen vorhanden.");
          break;
        }
        console.log("");
        console.log("  Server ID            Tier       Ablauf               Tage   Notiz");
        console.log("  " + "-".repeat(75));
        for (const [id, lic] of entries) {
          const expired = new Date(lic.expiresAt) <= new Date();
          const daysLeft = Math.max(0, Math.ceil((new Date(lic.expiresAt) - new Date()) / 86400000));
          const status = expired ? "\x1b[31mABGELAUFEN\x1b[0m" : `${daysLeft}`;
          const tierStr = (lic.plan || "?").padEnd(10);
          const expStr = formatDate(lic.expiresAt).padEnd(20);
          const servers = (lic.linkedServerIds || []).join(", ") || "-";
          const noteStr = (lic.note || "").substring(0, 30);
          console.log(`  ${id}  ${tierStr} ${expStr} ${status.padEnd(6)} ${noteStr}`);
          console.log(`    Server: ${servers} (${(lic.linkedServerIds || []).length}/${lic.seats || 1} Seats)`);
        }
        console.log("");
        info(`${entries.length} Lizenz(en) gesamt.`);
        break;
      }

      // --- Server pruefen ---
      case "6": {
        const serverId = await ask("Server ID");
        const lic = getServerLicense(serverId);
        if (!lic) {
          info(`Server ${serverId}: FREE (keine Lizenz).`);
        } else if (lic.expired) {
          fail(`Server ${serverId}: ABGELAUFEN (war ${lic.plan}).`);
          info(`Abgelaufen am: ${formatDate(lic.expiresAt)}`);
        } else {
          ok(`Server ${serverId}: ${(lic.plan || "free").toUpperCase()}`);
          info(`Laeuft ab: ${formatDate(lic.expiresAt)} (${lic.remainingDays} Tage uebrig)`);
          info(`Lizenz-ID: ${lic.id} | Seats: ${(lic.linkedServerIds || []).length}/${lic.seats || 1}`);
        }
        break;
      }

      // --- Preisrechner ---
      case "7": {
        const tier = (await ask("Tier (pro/ultimate)")).toLowerCase();
        if (tier !== "pro" && tier !== "ultimate") { fail("Muss 'pro' oder 'ultimate' sein."); break; }
        console.log("");
        console.log(`  Preistabelle fuer ${TIERS[tier].name}:`);
        console.log("  " + "-".repeat(40));
        for (const m of [1, 3, 6, 12, 24]) {
          const price = calculatePrice(tier, m);
          const monthly = centsToEur(Math.round(price / m));
          const total = centsToEur(price);
          const label = m >= 12 ? ` (${Math.floor(m / 12) * 2} Monate gratis!)` : "";
          console.log(`  ${String(m).padStart(2)} Monat${m > 1 ? "e" : " "}: ${total.padStart(12)}  (${monthly}/Monat)${label}`);
        }
        console.log("");
        break;
      }

      // --- Tier-Infos ---
      case "8": {
        console.log("");
        for (const [key, t] of Object.entries(TIERS)) {
          const price = t.pricePerMonth > 0 ? centsToEur(t.pricePerMonth) + "/Monat" : "Kostenlos";
          console.log(`  ${t.name.padEnd(10)} ${price.padEnd(16)} Bitrate: ${t.bitrate} | Max Bots: ${t.maxBots} | Reconnect: ${t.reconnectMs}ms`);
        }
        console.log("");
        break;
      }

      case "9":
      case "q":
      case "exit":
        return 0;

      default:
        fail("Ungueltige Auswahl.");
    }
    console.log("");
  }
}

const code = await run();
rl.close();
process.exit(code);
