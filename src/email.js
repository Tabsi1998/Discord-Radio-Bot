import nodemailer from "nodemailer";
import fs from "node:fs";
import { getDefaultLanguage, getLocaleForLanguage, normalizeLanguage } from "./i18n.js";

function resolveTlsMode(port, rawMode) {
  const mode = String(rawMode || "auto").trim().toLowerCase();
  if (["plain", "starttls", "smtps"].includes(mode)) return mode;
  if (port === 465) return "smtps";
  if (port === 25) return "plain";
  return "starttls";
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  const adminEmail = process.env.ADMIN_EMAIL || "";
  const tlsMode = resolveTlsMode(port, process.env.SMTP_TLS_MODE);
  const rejectUnauthorized = String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED ?? "0") !== "0";
  const tlsServername = String(process.env.SMTP_TLS_SERVERNAME || "").trim() || null;
  const tlsCaPath = String(process.env.SMTP_TLS_CA_PATH || "").trim() || null;

  if (!host || !user || !pass) return null;
  return {
    host, port, user, pass, from, adminEmail,
    tlsMode, rejectUnauthorized, tlsServername, tlsCaPath,
  };
}

function createTransporter() {
  const cfg = getSmtpConfig();
  if (!cfg) return null;

  const options = {
    host: cfg.host,
    port: cfg.port,
    auth: { user: cfg.user, pass: cfg.pass },
    tls: { rejectUnauthorized: cfg.rejectUnauthorized },
  };

  if (cfg.tlsMode === "smtps") {
    options.secure = true;
  } else if (cfg.tlsMode === "starttls") {
    options.secure = false;
    options.requireTLS = true;
  } else {
    options.secure = false;
    options.ignoreTLS = true;
  }

  if (cfg.tlsServername) {
    options.tls.servername = cfg.tlsServername;
  }

  if (cfg.tlsCaPath) {
    try {
      options.tls.ca = fs.readFileSync(cfg.tlsCaPath, "utf8");
    } catch (err) {
      console.error(`[email] CA file konnte nicht gelesen werden (${cfg.tlsCaPath}): ${err.message}`);
    }
  }

  return nodemailer.createTransport(options);
}

function isConfigured() {
  return getSmtpConfig() !== null;
}

async function sendMail(to, subject, html) {
  const cfg = getSmtpConfig();
  if (!cfg) return { error: "SMTP nicht konfiguriert." };

  const transporter = createTransporter();
  try {
    await transporter.sendMail({
      from: `"OmniFM Premium" <${cfg.from}>`,
      to,
      subject,
      html,
    });
    return { success: true };
  } catch (err) {
    console.error(`[email] Send failed: ${err.message}`);
    return { error: err.message };
  }
}

function resolveLanguage(rawLanguage) {
  return normalizeLanguage(rawLanguage, getDefaultLanguage());
}

function formatMoney(cents, currency = "eur", rawLanguage = getDefaultLanguage()) {
  const language = resolveLanguage(rawLanguage);
  const value = Number(cents || 0) / 100;
  const locale = getLocaleForLanguage(language);
  const cur = String(currency || "eur").toUpperCase();

  let formattedNumber = value.toFixed(2);
  try {
    formattedNumber = new Intl.NumberFormat(locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // fallback to fixed
  }

  return language === "de"
    ? `${formattedNumber} ${cur}`
    : `${cur} ${formattedNumber}`;
}

function buildPurchaseEmail(data) {
  const {
    tier,
    tierName,
    months,
    licenseKey,
    seats,
    expiresAt,
    inviteOverview,
    dashboardUrl,
    pricePaid,
    currency,
    language,
  } = data;

  const lang = resolveLanguage(language);
  const isDe = lang === "de";
  const locale = getLocaleForLanguage(lang);
  const expDate = new Date(expiresAt).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });
  const tierColor = tier === "ultimate" ? "#BD00FF" : "#FFB800";
  const moneyLabel = formatMoney(pricePaid || 0, currency || "eur", lang);
  const seatCount = Number(seats || 1);
  const freeWebsiteUrl = String(
    inviteOverview?.freeWebsiteUrl || dashboardUrl || "https://discord.gg/UeRkfGS43R"
  ).trim();

  const heading = isDe ? `OmniFM ${tierName} - Dein Lizenz-Key` : `OmniFM ${tierName} - Your license key`;
  const keyTitle = isDe ? "Dein Lizenz-Key" : "Your license key";
  const keyHint = isDe ? "Bewahre diesen Key sicher auf!" : "Keep this key in a safe place.";
  const planLabel = isDe ? "Plan" : "Plan";
  const seatsLabel = isDe ? "Server-Slots" : "Server seats";
  const durationLabel = isDe ? "Laufzeit" : "Duration";
  const validUntilLabel = isDe ? "Gueltig bis" : "Valid until";
  const paidLabel = isDe ? "Bezahlt" : "Paid";
  const durationText = isDe
    ? `${months} Monat${months > 1 ? "e" : ""}`
    : `${months} month${months > 1 ? "s" : ""}`;
  const seatsText = isDe
    ? `${seatCount} Server`
    : `${seatCount} server${seatCount > 1 ? "s" : ""}`;

  let tierBenefits = "";
  if (tier === "ultimate") {
    tierBenefits = isDe
      ? `
      <ul style="margin:0;padding-left:18px;color:#A1A1AA;line-height:1.7">
        <li>Bis zu 16 Bots gleichzeitig</li>
        <li>320k Ultra HQ Audio + Instant Reconnect (0.4s)</li>
        <li>Alle 120+ Stationen inkl. Premium</li>
        <li>Custom Stations (eigene URLs)</li>
        <li>Priority-Support per Discord</li>
      </ul>`
      : `
      <ul style="margin:0;padding-left:18px;color:#A1A1AA;line-height:1.7">
        <li>Up to 16 bots at the same time</li>
        <li>320k Ultra HQ audio + instant reconnect (0.4s)</li>
        <li>All 120+ stations including premium</li>
        <li>Custom stations (your own URLs)</li>
        <li>Priority support via Discord</li>
      </ul>`;
  } else {
    tierBenefits = isDe
      ? `
      <ul style="margin:0;padding-left:18px;color:#A1A1AA;line-height:1.7">
        <li>Bis zu 8 Bots gleichzeitig</li>
        <li>128k HQ Audio + Priority Reconnect (1.5s)</li>
        <li>100+ Premium Stationen</li>
        <li>Support per Discord</li>
      </ul>`
      : `
      <ul style="margin:0;padding-left:18px;color:#A1A1AA;line-height:1.7">
        <li>Up to 8 bots at the same time</li>
        <li>128k HQ audio + priority reconnect (1.5s)</li>
        <li>100+ premium stations</li>
        <li>Support via Discord</li>
      </ul>`;
  }

  const benefitsTitle = isDe ? "Was dein Abo bringt" : "What your plan includes";
  const nextStepsTitle = isDe ? "Naechste Schritte - Server zuweisen" : "Next steps - assign your server";
  const nextStep1 = isDe
    ? "Kopiere deine Discord <strong>Server-ID(s)</strong> (Rechtsklick auf Server &rarr; Server-ID kopieren)"
    : "Copy your Discord <strong>server ID(s)</strong> (right-click server &rarr; copy server ID)";
  const nextStep2 = isDe
    ? "Sende uns die Server-ID(s) per <strong>E-Mail</strong> oder im <strong>Discord-Support</strong>"
    : "Send your server ID(s) via <strong>email</strong> or through <strong>Discord support</strong>";
  const nextStep3 = isDe
    ? `Wir aktivieren deine ${seatCount > 1 ? `${seatCount} Server` : "Server"} innerhalb weniger Stunden`
    : `We activate your ${seatCount > 1 ? `${seatCount} servers` : "server"} within a few hours`;
  const slotHint = isDe
    ? `Du hast ${seatCount} Server-Slot${seatCount > 1 ? "s" : ""} - sende uns bis zu ${seatCount} Server-ID${seatCount > 1 ? "s" : ""}.`
    : `You have ${seatCount} server slot${seatCount > 1 ? "s" : ""} - send us up to ${seatCount} server ID${seatCount > 1 ? "s" : ""}.`;
  const supportLabel = isDe ? "Discord Support" : "Discord support";
  const websiteLabel = isDe ? "OmniFM Website" : "OmniFM website";
  const footerNote = isDe
    ? `Server aendern? Schreib uns jederzeit per E-Mail oder Discord${tier === "ultimate" ? " (Priority-Support fuer Ultimate)" : ""}.`
    : `Need to switch servers? Contact us any time via email or Discord${tier === "ultimate" ? " (priority support for Ultimate)" : ""}.`;

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,${tierColor}22,transparent);padding:32px;text-align:center">
        <h1 style="font-size:24px;margin:0;color:${tierColor}">${heading}</h1>
      </div>
      <div style="padding:24px 32px">
        <div style="margin:0 0 24px;padding:20px;background:#111;border-radius:14px;border:2px solid ${tierColor}40;text-align:center">
          <p style="margin:0 0 8px;color:#A1A1AA;font-size:12px;text-transform:uppercase;letter-spacing:0.1em;font-weight:700">${keyTitle}</p>
          <p style="margin:0;font-size:28px;font-weight:800;font-family:'Courier New',monospace;letter-spacing:3px;color:${tierColor}">${licenseKey || "---"}</p>
          <p style="margin:8px 0 0;color:#52525B;font-size:11px">${keyHint}</p>
        </div>

        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="color:#888;padding:8px 0">${planLabel}</td><td style="text-align:right;padding:8px 0;color:${tierColor};font-weight:700">${tierName}</td></tr>
          <tr><td style="color:#888;padding:8px 0">${seatsLabel}</td><td style="text-align:right;padding:8px 0;font-weight:600">${seatsText}</td></tr>
          <tr><td style="color:#888;padding:8px 0">${durationLabel}</td><td style="text-align:right;padding:8px 0">${durationText}</td></tr>
          <tr><td style="color:#888;padding:8px 0">${validUntilLabel}</td><td style="text-align:right;padding:8px 0;font-weight:700">${expDate}</td></tr>
          <tr><td style="color:#888;padding:8px 0">${paidLabel}</td><td style="text-align:right;padding:8px 0">${moneyLabel}</td></tr>
        </table>

        <div style="margin:16px 0 8px">
          <h3 style="margin:0 0 8px;color:${tierColor};font-size:15px">${benefitsTitle}</h3>
          ${tierBenefits}
        </div>

        <div style="margin:20px 0;padding:18px;background:#1a1a1a;border-radius:12px;border:1px solid ${tierColor}33">
          <h3 style="color:${tierColor};margin:0 0 12px;font-size:15px">${nextStepsTitle}</h3>
          <ol style="margin:0;padding-left:20px;color:#A1A1AA;font-size:13px;line-height:2">
            <li>${nextStep1}</li>
            <li>${nextStep2}</li>
            <li>${nextStep3}</li>
          </ol>
          <p style="margin:12px 0 0;color:#52525B;font-size:11px">${slotHint}</p>
        </div>

        <div style="margin:16px 0;display:flex;gap:10px">
          <a href="https://discord.gg/UeRkfGS43R" style="flex:1;text-align:center;color:#fff;text-decoration:none;background:${tierColor}22;border:1px solid ${tierColor}33;padding:12px;border-radius:10px;font-weight:600;font-size:13px">${supportLabel}</a>
          <a href="${freeWebsiteUrl}" style="flex:1;text-align:center;color:#fff;text-decoration:none;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.1);padding:12px;border-radius:10px;font-weight:600;font-size:13px">${websiteLabel}</a>
        </div>

        <p style="color:#52525B;font-size:11px;margin-top:20px;text-align:center;line-height:1.6">
          ${footerNote}
        </p>
      </div>
    </div>`;
}

function buildAdminNotification(data) {
  const { tier, tierName, months, serverId, expiresAt, pricePaid, language } = data;
  const lang = resolveLanguage(language);
  const isDe = lang === "de";
  const locale = getLocaleForLanguage(lang);
  const expDate = new Date(expiresAt).toLocaleDateString(locale);
  const price = pricePaid ? formatMoney(pricePaid, "eur", lang) : (isDe ? "Manuell" : "Manual");

  const title = isDe ? "Neuer Premium-Kauf" : "New premium purchase";
  const labelServer = isDe ? "Server" : "Server";
  const labelTier = isDe ? "Tier" : "Tier";
  const labelDuration = isDe ? "Laufzeit" : "Duration";
  const labelExpires = isDe ? "Ablauf" : "Expires";
  const labelAmount = isDe ? "Betrag" : "Amount";
  const labelTime = isDe ? "Zeit" : "Time";
  const duration = isDe
    ? `${months} Monat(e)`
    : `${months} month${months > 1 ? "s" : ""}`;

  return `
    <div style="font-family:monospace;padding:16px">
      <h2>${title}</h2>
      <ul>
        <li>${labelServer}: ${serverId}</li>
        <li>${labelTier}: ${tierName} (${tier})</li>
        <li>${labelDuration}: ${duration}</li>
        <li>${labelExpires}: ${expDate}</li>
        <li>${labelAmount}: ${price}</li>
        <li>${labelTime}: ${new Date().toLocaleString(locale)}</li>
      </ul>
    </div>`;
}

function buildInvoiceEmail(data) {
  const {
    invoiceId,
    sessionId,
    serverId,
    tierName,
    tier,
    months,
    isUpgrade,
    amountPaid,
    currency,
    issuedAt,
    expiresAt,
    customerEmail,
    customerName,
    language,
  } = data;

  const lang = resolveLanguage(language);
  const isDe = lang === "de";
  const locale = getLocaleForLanguage(lang);
  const issueDate = new Date(issuedAt || Date.now()).toLocaleDateString(locale);
  const expDate = expiresAt ? new Date(expiresAt).toLocaleDateString(locale) : "-";
  const amount = formatMoney(amountPaid || 0, currency || "eur", lang);
  const lineText = isUpgrade
    ? (isDe ? `Upgrade auf ${tierName} (${tier})` : `Upgrade to ${tierName} (${tier})`)
    : `${tierName} (${tier}) - ${months} ${isDe ? `Monat${months > 1 ? "e" : ""}` : `month${months > 1 ? "s" : ""}`}`;

  const title = isDe ? "Kaufbeleg" : "Invoice";
  const subTitle = isDe ? "OmniFM Premium" : "OmniFM Premium";
  const invoiceLabel = isDe ? "Beleg-Nr" : "Invoice no.";
  const dateLabel = isDe ? "Datum" : "Date";
  const customerLabel = isDe ? "Kunde" : "Customer";
  const emailLabel = isDe ? "E-Mail" : "Email";
  const serverLabel = isDe ? "Server ID" : "Server ID";
  const validUntilLabel = isDe ? "Gueltig bis" : "Valid until";
  const sessionLabel = isDe ? "Session" : "Session";
  const serviceLabel = isDe ? "Leistung" : "Service";
  const amountLabel = isDe ? "Betrag" : "Amount";
  const hint = isDe
    ? "Hinweis: Automatisch erstellter Kaufbeleg fuer den Premium-Service."
    : "Note: Automatically generated invoice for the premium service.";

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:700px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
      <div style="padding:28px 32px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <h1 style="margin:0;font-size:22px">${title}</h1>
          <p style="margin:8px 0 0;color:#A1A1AA;font-size:13px">${subTitle}</p>
        </div>
        <div style="text-align:right;min-width:220px">
          <div style="font-family:JetBrains Mono,monospace;font-size:13px">${invoiceLabel}: ${invoiceId}</div>
          <div style="font-size:13px;color:#A1A1AA;margin-top:4px">${dateLabel}: ${issueDate}</div>
        </div>
      </div>
      <div style="padding:24px 32px">
        <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
          <tr><td style="color:#888;padding:7px 0">${customerLabel}</td><td style="text-align:right;padding:7px 0">${customerName || "-"}</td></tr>
          <tr><td style="color:#888;padding:7px 0">${emailLabel}</td><td style="text-align:right;padding:7px 0">${customerEmail || "-"}</td></tr>
          <tr><td style="color:#888;padding:7px 0">${serverLabel}</td><td style="text-align:right;padding:7px 0;font-family:JetBrains Mono,monospace">${serverId}</td></tr>
          <tr><td style="color:#888;padding:7px 0">${validUntilLabel}</td><td style="text-align:right;padding:7px 0">${expDate}</td></tr>
          <tr><td style="color:#888;padding:7px 0">${sessionLabel}</td><td style="text-align:right;padding:7px 0;font-family:JetBrains Mono,monospace">${sessionId || "-"}</td></tr>
        </table>
        <div style="border:1px solid rgba(255,255,255,0.1);border-radius:12px;overflow:hidden">
          <div style="display:grid;grid-template-columns:1fr 120px;background:rgba(255,255,255,0.04);padding:10px 14px;font-size:12px;color:#A1A1AA;font-weight:700;letter-spacing:0.04em">
            <span>${serviceLabel}</span><span style="text-align:right">${amountLabel}</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 120px;padding:14px">
            <span>${lineText}</span><span style="text-align:right;font-weight:700">${amount}</span>
          </div>
        </div>
        <div style="margin-top:14px;font-size:12px;color:#A1A1AA">
          ${hint}
        </div>
      </div>
    </div>`;
}

function buildExpiryWarningEmail(data) {
  const { tierName, serverId, expiresAt, daysLeft, language } = data;
  const lang = resolveLanguage(language);
  const isDe = lang === "de";
  const locale = getLocaleForLanguage(lang);
  const expDate = new Date(expiresAt).toLocaleDateString(locale, { day: "2-digit", month: "2-digit", year: "numeric" });

  const title = isDe ? "Premium laeuft bald ab!" : "Premium is expiring soon!";
  const text1 = isDe
    ? `Dein <strong>${tierName}</strong>-Abo fuer Server <code>${serverId}</code> laeuft in <strong>${daysLeft} Tagen</strong> ab (${expDate}).`
    : `Your <strong>${tierName}</strong> plan for server <code>${serverId}</code> expires in <strong>${daysLeft} days</strong> (${expDate}).`;
  const text2 = isDe
    ? "Nach Ablauf werden Premium-Bots und Custom-Stationen deaktiviert."
    : "After expiry, premium bots and custom stations will be disabled.";
  const action = isDe ? "Jetzt verlaengern &rarr;" : "Renew now &rarr;";

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
      <div style="background:#FF2A2A22;padding:32px;text-align:center">
        <h1 style="font-size:22px;margin:0;color:#FF2A2A">${title}</h1>
      </div>
      <div style="padding:24px 32px">
        <p>${text1}</p>
        <p>${text2}</p>
        <p style="margin-top:20px">
          <a href="https://discord.gg/UeRkfGS43R" style="color:#FFB800;font-weight:700">${action}</a>
        </p>
      </div>
    </div>`;
}

function buildExpiryEmail(data) {
  const { tierName, serverId, language } = data;
  const lang = resolveLanguage(language);
  const isDe = lang === "de";

  const title = isDe ? "Premium abgelaufen" : "Premium expired";
  const text1 = isDe
    ? `Dein <strong>${tierName}</strong>-Abo fuer Server <code>${serverId}</code> ist abgelaufen.`
    : `Your <strong>${tierName}</strong> plan for server <code>${serverId}</code> has expired.`;
  const text2 = isDe
    ? "Premium-Bots und Custom-Stationen sind jetzt deaktiviert. Invite-Links sind nicht mehr gueltig."
    : "Premium bots and custom stations are now disabled. Invite links are no longer valid.";
  const action = isDe ? "Abo erneuern &rarr;" : "Renew plan &rarr;";

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
      <div style="background:#FF2A2A22;padding:32px;text-align:center">
        <h1 style="font-size:22px;margin:0;color:#FF2A2A">${title}</h1>
      </div>
      <div style="padding:24px 32px">
        <p>${text1}</p>
        <p>${text2}</p>
        <p style="margin-top:20px">
          <a href="https://discord.gg/UeRkfGS43R" style="color:#FFB800;font-weight:700">${action}</a>
        </p>
      </div>
    </div>`;
}

export {
  isConfigured, sendMail, getSmtpConfig,
  buildPurchaseEmail, buildAdminNotification,
  buildInvoiceEmail,
  buildExpiryWarningEmail, buildExpiryEmail,
};
