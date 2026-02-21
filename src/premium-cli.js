import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import dotenv from "dotenv";
import { PLANS } from "./config/plans.js";
import {
  getServerLicense, listLicenses, addLicenseForServer, removeLicense,
  upgradeLicenseForServer,
} from "./premium-store.js";
import { isConfigured as isEmailConfigured, sendMail } from "./email.js";
import { loadBotConfigs, buildInviteUrl } from "./bot-config.js";

dotenv.config();

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
const SUPPORT_URL = "https://discord.gg/UeRkfGS43R";

function escapeHtml(input) {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeLicense(license, fallbackId = null) {
  if (!license) return null;
  const expiresAt = license.expiresAt || null;
  const expired = expiresAt ? new Date(expiresAt) <= new Date() : false;
  const remainingDays = expiresAt ? Math.max(0, Math.ceil((new Date(expiresAt) - new Date()) / 86400000)) : null;
  return {
    ...license,
    id: license.id || fallbackId || null,
    expired: typeof license.expired === "boolean" ? license.expired : expired,
    remainingDays: Number.isFinite(license.remainingDays) ? license.remainingDays : remainingDays,
    linkedServerIds: Array.isArray(license.linkedServerIds) ? [...license.linkedServerIds] : [],
  };
}

function resolvePublicWebsiteUrl() {
  const raw = String(process.env.PUBLIC_WEB_URL || "").trim();
  if (!raw) return SUPPORT_URL;
  try {
    return new URL(raw).toString();
  } catch {
    return SUPPORT_URL;
  }
}

function getLicenseByInput(input) {
  const query = String(input || "").trim();
  if (!query) return null;

  if (/^\d{17,22}$/.test(query)) {
    return normalizeLicense(getServerLicense(query));
  }

  const all = listLicenses();
  if (all[query]) return normalizeLicense(all[query], query);

  const lower = query.toLowerCase();
  for (const [id, license] of Object.entries(all)) {
    if (id.toLowerCase() === lower) return normalizeLicense(license, id);
  }

  return null;
}

function buildInviteOverviewForTier(botConfigs, tier) {
  const normalizedTier = String(tier || "free").toLowerCase();
  const hasPro = normalizedTier === "pro" || normalizedTier === "ultimate";
  const hasUltimate = normalizedTier === "ultimate";
  const overview = {
    freeWebsiteUrl: resolvePublicWebsiteUrl(),
    proBots: [],
    ultimateBots: [],
  };

  const sorted = [...botConfigs].sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  const seenPro = new Set();
  const seenUltimate = new Set();

  for (const botConfig of sorted) {
    const index = Number(botConfig.index || 0);
    const bucket = String(botConfig.requiredTier || "free").toLowerCase();
    if (bucket !== "pro" && bucket !== "ultimate") continue;
    if ((bucket === "pro" && !hasPro) || (bucket === "ultimate" && !hasUltimate)) continue;
    const seen = bucket === "ultimate" ? seenUltimate : seenPro;
    if (seen.has(index)) continue;
    seen.add(index);
    if (bucket === "pro") {
      overview.proBots.push({ index, name: botConfig.name, url: buildInviteUrl(botConfig) });
    } else {
      overview.ultimateBots.push({ index, name: botConfig.name, url: buildInviteUrl(botConfig) });
    }
  }

  overview.proBots.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  overview.ultimateBots.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  return overview;
}

function getInviteOverviewForTier(tier) {
  try {
    const botConfigs = loadBotConfigs(process.env);
    return buildInviteOverviewForTier(botConfigs, tier);
  } catch {
    return { freeWebsiteUrl: resolvePublicWebsiteUrl(), proBots: [], ultimateBots: [] };
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function renderInviteList(title, bots) {
  if (!bots.length) {
    return `
      <h3 style="margin:18px 0 8px;font-size:15px;color:#A1A1AA">${escapeHtml(title)}</h3>
      <p style="margin:0;color:#52525B;font-size:12px">Keine direkten Bot-Links verfuegbar.</p>`;
  }

  const rows = bots
    .map((bot) => `<li style="margin:6px 0"><a href="${escapeHtml(bot.url)}" style="color:#00F0FF;text-decoration:none">Bot #${escapeHtml(bot.index)} - ${escapeHtml(bot.name || "Bot")}</a></li>`)
    .join("");

  return `
    <h3 style="margin:18px 0 8px;font-size:15px;color:#A1A1AA">${escapeHtml(title)}</h3>
    <ul style="margin:0;padding-left:18px;color:#A1A1AA;line-height:1.6">${rows}</ul>`;
}

function buildResendEmailHtml({ license, tierName, inviteOverview }) {
  const expDate = license.expiresAt
    ? new Date(license.expiresAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
    : "Unbegrenzt";
  const tier = String(license.plan || "pro").toLowerCase();
  const tierColor = tier === "ultimate" ? "#BD00FF" : "#FFB800";
  const seats = Number(license.seats || 1);
  const linkedServerIds = Array.isArray(license.linkedServerIds) ? license.linkedServerIds : [];

  const proList = renderInviteList("Pro Bots", inviteOverview.proBots || []);
  const ultimateList = tier === "ultimate"
    ? renderInviteList("Ultimate Bots", inviteOverview.ultimateBots || [])
    : "";

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:680px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,${tierColor}22,transparent);padding:32px;text-align:center">
        <h1 style="font-size:24px;margin:0;color:${tierColor}">OmniFM ${escapeHtml(tierName)} - Lizenzdaten (Resend)</h1>
      </div>
      <div style="padding:24px 32px">
        <div style="margin:0 0 18px;padding:18px;background:#111;border-radius:12px;border:1px solid ${tierColor}40;text-align:center">
          <p style="margin:0 0 6px;color:#A1A1AA;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700">Lizenz-Key</p>
          <p style="margin:0;font-size:24px;font-weight:800;font-family:'Courier New',monospace;color:${tierColor}">${escapeHtml(license.id || "-")}</p>
        </div>

        <table style="width:100%;border-collapse:collapse;margin:10px 0 18px">
          <tr><td style="color:#888;padding:7px 0">Plan</td><td style="text-align:right;padding:7px 0;color:${tierColor};font-weight:700">${escapeHtml(tierName)}</td></tr>
          <tr><td style="color:#888;padding:7px 0">Server-Slots</td><td style="text-align:right;padding:7px 0">${escapeHtml(linkedServerIds.length)}/${escapeHtml(seats)}</td></tr>
          <tr><td style="color:#888;padding:7px 0">Gueltig bis</td><td style="text-align:right;padding:7px 0">${escapeHtml(expDate)}</td></tr>
          <tr><td style="color:#888;padding:7px 0">Kontakt-E-Mail</td><td style="text-align:right;padding:7px 0">${escapeHtml(license.contactEmail || "-")}</td></tr>
        </table>

        <div style="padding:14px;background:#1a1a1a;border-radius:12px;border:1px solid rgba(255,255,255,0.08)">
          <p style="margin:0 0 8px;color:#A1A1AA">Server zuweisen:</p>
          <ol style="margin:0;padding-left:20px;color:#A1A1AA;line-height:1.8">
            <li>Im Zielserver: <code>/license activate ${escapeHtml(license.id || "")}</code></li>
            <li>Status pruefen: <code>/license info</code></li>
            <li>Invite-Links unten verwenden.</li>
          </ol>
        </div>

        ${proList}
        ${ultimateList}

        <p style="margin:18px 0 0;color:#A1A1AA;font-size:12px">
          Weitere Links: <a href="${escapeHtml(inviteOverview.freeWebsiteUrl || resolvePublicWebsiteUrl())}" style="color:#00F0FF;text-decoration:none">${escapeHtml(inviteOverview.freeWebsiteUrl || resolvePublicWebsiteUrl())}</a><br/>
          Support: <a href="${escapeHtml(SUPPORT_URL)}" style="color:#00F0FF;text-decoration:none">${escapeHtml(SUPPORT_URL)}</a>
        </p>
      </div>
    </div>`;
}

function printInviteOverviewToConsole(overview, tier) {
  const isUltimate = String(tier || "").toLowerCase() === "ultimate";
  const proBots = Array.isArray(overview.proBots) ? overview.proBots : [];
  const ultimateBots = Array.isArray(overview.ultimateBots) ? overview.ultimateBots : [];

  info("Invite-Links (Copy/Paste):");
  for (const bot of proBots) {
    console.log(`    PRO #${bot.index} - ${bot.name}: ${bot.url}`);
  }
  if (isUltimate) {
    for (const bot of ultimateBots) {
      console.log(`    ULTIMATE #${bot.index} - ${bot.name}: ${bot.url}`);
    }
  }
  console.log(`    Website: ${overview.freeWebsiteUrl || resolvePublicWebsiteUrl()}`);
  console.log(`    Support: ${SUPPORT_URL}`);
}

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
  console.log("    9) Lizenz-Mail + Invite-Links erneut senden");
  console.log("    10) Beenden");
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
        console.log(`  Preistabelle fuer ${PLANS[tier].name}:`);
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
        for (const [key, t] of Object.entries(PLANS)) {
          const price = PRICE_PER_MONTH_CENTS[key] > 0 ? centsToEur(PRICE_PER_MONTH_CENTS[key]) + "/Monat" : "Kostenlos";
          console.log(`  ${t.name.padEnd(10)} ${price.padEnd(16)} Bitrate: ${t.bitrate} | Max Bots: ${t.maxBots} | Reconnect: ${t.reconnectMs}ms`);
        }
        console.log("");
        break;
      }

      // --- Resend Lizenz-Mail ---
      case "9":
      case "resend": {
        if (!isEmailConfigured()) {
          fail("SMTP ist nicht konfiguriert. Nutze zuerst: ./update.sh --email-settings");
          break;
        }

        const query = await ask("Lizenz-ID oder Server-ID");
        const license = getLicenseByInput(query);
        if (!license || !license.id) {
          fail("Lizenz nicht gefunden.");
          break;
        }

        if (!["pro", "ultimate"].includes(String(license.plan || "").toLowerCase())) {
          fail("Nur Pro/Ultimate Lizenzen koennen erneut versendet werden.");
          break;
        }

        const tier = String(license.plan || "").toLowerCase();
        const tierName = PLANS[tier]?.name || tier;
        const defaultEmail = String(license.contactEmail || "").trim().toLowerCase();
        const emailPrompt = defaultEmail
          ? `Ziel-E-Mail (Enter fuer ${defaultEmail})`
          : "Ziel-E-Mail";
        const rawEmail = (await ask(emailPrompt)).trim().toLowerCase();
        const targetEmail = rawEmail || defaultEmail;

        if (!targetEmail) {
          fail("Keine Ziel-E-Mail angegeben.");
          break;
        }
        if (!isValidEmail(targetEmail)) {
          fail("Ungueltige E-Mail-Adresse.");
          break;
        }

        if (license.expired) {
          const continueExpired = (await ask("Lizenz ist abgelaufen. Trotzdem E-Mail senden? (j/n)")).trim().toLowerCase();
          if (continueExpired !== "j" && continueExpired !== "y") {
            info("Abgebrochen.");
            break;
          }
        }

        const inviteOverview = getInviteOverviewForTier(tier);
        const html = buildResendEmailHtml({
          license,
          tierName,
          inviteOverview,
        });

        const subject = `OmniFM ${tierName} - Lizenz-Key & Invite-Links (Resend)`;
        const result = await sendMail(targetEmail, subject, html);
        if (result?.success) {
          ok(`Resend erfolgreich an ${targetEmail} gesendet.`);
          info(`Lizenz-Key: ${license.id}`);
          printInviteOverviewToConsole(inviteOverview, tier);
        } else {
          fail(`Resend fehlgeschlagen: ${result?.error || "Unbekannter Fehler"}`);
        }
        break;
      }

      case "10":
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
