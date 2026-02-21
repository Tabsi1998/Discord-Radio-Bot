import nodemailer from "nodemailer";
import fs from "node:fs";

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
    tlsMode, rejectUnauthorized, tlsServername, tlsCaPath
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

function formatMoney(cents, currency = "eur") {
  const value = Number(cents || 0) / 100;
  const cur = String(currency || "eur").toUpperCase();
  return `${value.toFixed(2).replace(".", ",")} ${cur}`;
}

function buildPurchaseEmail(data) {
  const {
    tier,
    tierName,
    months,
    serverId,
    expiresAt,
    inviteOverview,
    dashboardUrl,
    isUpgrade,
    pricePaid,
    currency,
  } = data;
  const expDate = new Date(expiresAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const tierColor = tier === "ultimate" ? "#BD00FF" : "#FFB800";
  const moneyLabel = formatMoney(pricePaid || 0, currency || "eur");
  const freeWebsiteUrl = String(
    inviteOverview?.freeWebsiteUrl || dashboardUrl || "https://discord.gg/UeRkfGS43R"
  ).trim();
  const freeInfo = inviteOverview?.freeInfo || "Free Bots #1-#4 sind immer verfuegbar.";
  const proBots = Array.isArray(inviteOverview?.proBots) ? inviteOverview.proBots : [];
  const ultimateBots = Array.isArray(inviteOverview?.ultimateBots) ? inviteOverview.ultimateBots : [];
  const includesPro = tier === "pro" || tier === "ultimate";
  const includesUltimate = tier === "ultimate";

  function renderInviteButtons(items) {
    return items
      .map((bot) => `
        <div style="margin:8px 0">
          <a href="${bot.url}" style="color:#fff;text-decoration:none;background:${tierColor};padding:8px 16px;border-radius:8px;display:inline-block;font-weight:600">${bot.name} (#${bot.index}) einladen</a>
        </div>
      `)
      .join("");
  }

  let tierBenefits = "";
  if (tier === "ultimate") {
    tierBenefits = `
      <ul style="margin:0;padding-left:18px;color:#A1A1AA;line-height:1.7">
        <li>Bots #1-#20 nutzbar (inkl. Ultimate Bots #11-#20)</li>
        <li>320k Audio + schnellster Reconnect</li>
        <li>Custom Stations (eigene URLs)</li>
      </ul>`;
  } else {
    tierBenefits = `
      <ul style="margin:0;padding-left:18px;color:#A1A1AA;line-height:1.7">
        <li>Bots #1-#10 nutzbar (inkl. Pro Bots #5-#10)</li>
        <li>192k Audio + schneller Reconnect</li>
        <li>Priority-Support</li>
      </ul>`;
  }

  let inviteHtml = `
    <div style="margin:20px 0;padding:16px;background:#1a1a1a;border-radius:12px;border:1px solid ${tierColor}33">
      <h3 style="color:${tierColor};margin:0 0 8px">Free Bots (#1-#4)</h3>
      <p style="margin:0 0 10px;color:#A1A1AA;font-size:13px">${freeInfo}</p>
      <a href="${freeWebsiteUrl}" style="color:#050505;text-decoration:none;background:#00F0FF;padding:8px 14px;border-radius:8px;display:inline-block;font-weight:700">Zur Bot-Webseite</a>
      <p style="margin:10px 0 0;color:#777;font-size:12px">Premium-Features gueltig bis ${expDate}.</p>
    </div>`;

  if (includesPro) {
    if (proBots.length > 0) {
      inviteHtml += `
        <div style="margin:20px 0;padding:16px;background:#1a1a1a;border-radius:12px;border:1px solid ${tierColor}33">
          <h3 style="color:${tierColor};margin:0 0 12px">Pro Bots (#5-#10)</h3>
          ${renderInviteButtons(proBots)}
          <p style="margin:10px 0 0;color:#777;font-size:12px">Links gueltig bis ${expDate} (Lizenzlaufzeit).</p>
        </div>`;
    } else {
      inviteHtml += `
        <div style="margin:20px 0;padding:16px;background:#1a1a1a;border-radius:12px;border:1px solid ${tierColor}33">
          <h3 style="color:${tierColor};margin:0 0 12px">Pro Bots (#5-#10)</h3>
          <p style="margin:0;color:#FFB800;font-size:13px">Keine Pro-Bot-Links gefunden. Bitte BOT_5 bis BOT_10 in der .env pruefen (TOKEN + CLIENT_ID).</p>
        </div>`;
    }
  }
  if (includesUltimate) {
    if (ultimateBots.length > 0) {
      inviteHtml += `
        <div style="margin:20px 0;padding:16px;background:#1a1a1a;border-radius:12px;border:1px solid ${tierColor}33">
          <h3 style="color:${tierColor};margin:0 0 12px">Ultimate Bots (#11-#20)</h3>
          ${renderInviteButtons(ultimateBots)}
          <p style="margin:10px 0 0;color:#777;font-size:12px">Links gueltig bis ${expDate} (Lizenzlaufzeit).</p>
        </div>`;
    } else {
      inviteHtml += `
        <div style="margin:20px 0;padding:16px;background:#1a1a1a;border-radius:12px;border:1px solid ${tierColor}33">
          <h3 style="color:${tierColor};margin:0 0 12px">Ultimate Bots (#11-#20)</h3>
          <p style="margin:0;color:#FFB800;font-size:13px">Keine Ultimate-Bot-Links gefunden. Bitte BOT_11 bis BOT_20 in der .env pruefen (TOKEN + CLIENT_ID).</p>
        </div>`;
    }
  }
  inviteHtml += `<p style="color:#666;font-size:12px;margin:12px 0 0">Premium-Bots sind servergebunden und nur fuer den lizenzierten Server ${serverId} gueltig.</p>`;
  inviteHtml += `<div style="margin:16px 0;padding:14px;background:#1a1a1a;border-radius:10px;border:1px solid #333">
    <p style="margin:0 0 6px;color:#A1A1AA;font-size:13px;font-weight:600">Server aendern?</p>
    <p style="margin:0;color:#888;font-size:12px;line-height:1.6">Deine Lizenz ist an Server <code style="background:#222;padding:2px 5px;border-radius:4px">${serverId}</code> gebunden. Wenn du den Server wechseln moechtest, schreibe uns eine E-Mail oder nutze den Discord-Support${tier === "ultimate" ? " (Priority-Support fuer Ultimate)" : ""}.</p>
    <p style="margin:8px 0 0;font-size:12px"><a href="https://discord.gg/UeRkfGS43R" style="color:${tierColor};text-decoration:none;font-weight:600">Discord Support &rarr;</a></p>
  </div>`;

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,${tierColor}22,transparent);padding:32px;text-align:center">
        <h1 style="font-size:24px;margin:0;color:${tierColor}">Premium ${tierName} aktiviert!</h1>
      </div>
      <div style="padding:24px 32px">
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="color:#888;padding:8px 0">Server ID</td><td style="text-align:right;padding:8px 0;font-family:monospace">${serverId}</td></tr>
          <tr><td style="color:#888;padding:8px 0">Tier</td><td style="text-align:right;padding:8px 0;color:${tierColor};font-weight:700">${tierName}</td></tr>
          <tr><td style="color:#888;padding:8px 0">Typ</td><td style="text-align:right;padding:8px 0">${isUpgrade ? "Upgrade" : "Neukauf/Verlaengerung"}</td></tr>
          <tr><td style="color:#888;padding:8px 0">Laufzeit</td><td style="text-align:right;padding:8px 0">${months > 0 ? `${months} Monat${months > 1 ? "e" : ""}` : "Upgrade (Restlaufzeit bleibt)"}</td></tr>
          <tr><td style="color:#888;padding:8px 0">Gueltig bis</td><td style="text-align:right;padding:8px 0;font-weight:700">${expDate}</td></tr>
          <tr><td style="color:#888;padding:8px 0">Bezahlt</td><td style="text-align:right;padding:8px 0">${moneyLabel}</td></tr>
        </table>
        <div style="margin:16px 0 8px">
          <h3 style="margin:0 0 8px;color:${tierColor};font-size:15px">Was dein Abo bringt</h3>
          ${tierBenefits}
        </div>
        ${inviteHtml}
        <p style="color:#888;font-size:13px;margin-top:24px;text-align:center">Support: <a href="https://discord.gg/UeRkfGS43R" style="color:${tierColor}">Discord Server</a></p>
      </div>
    </div>`;
}

function buildAdminNotification(data) {
  const { tier, tierName, months, serverId, expiresAt, pricePaid } = data;
  const expDate = new Date(expiresAt).toLocaleDateString("de-DE");
  const price = pricePaid ? `${(pricePaid / 100).toFixed(2)} EUR` : "Manuell";

  return `
    <div style="font-family:monospace;padding:16px">
      <h2>Neuer Premium-Kauf</h2>
      <ul>
        <li>Server: ${serverId}</li>
        <li>Tier: ${tierName} (${tier})</li>
        <li>Laufzeit: ${months} Monat(e)</li>
        <li>Ablauf: ${expDate}</li>
        <li>Betrag: ${price}</li>
        <li>Zeit: ${new Date().toLocaleString("de-DE")}</li>
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
  } = data;

  const issueDate = new Date(issuedAt || Date.now()).toLocaleDateString("de-DE");
  const expDate = expiresAt ? new Date(expiresAt).toLocaleDateString("de-DE") : "-";
  const amount = formatMoney(amountPaid || 0, currency || "eur");
  const lineText = isUpgrade
    ? `Upgrade auf ${tierName} (${tier})`
    : `${tierName} (${tier}) - ${months} Monat${months > 1 ? "e" : ""}`;

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:700px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
      <div style="padding:28px 32px;border-bottom:1px solid rgba(255,255,255,0.08);display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div>
          <h1 style="margin:0;font-size:22px">Kaufbeleg</h1>
          <p style="margin:8px 0 0;color:#A1A1AA;font-size:13px">OmniFM Premium</p>
        </div>
        <div style="text-align:right;min-width:220px">
          <div style="font-family:JetBrains Mono,monospace;font-size:13px">Beleg-Nr: ${invoiceId}</div>
          <div style="font-size:13px;color:#A1A1AA;margin-top:4px">Datum: ${issueDate}</div>
        </div>
      </div>
      <div style="padding:24px 32px">
        <table style="width:100%;border-collapse:collapse;margin-bottom:18px">
          <tr><td style="color:#888;padding:7px 0">Kunde</td><td style="text-align:right;padding:7px 0">${customerName || "-"}</td></tr>
          <tr><td style="color:#888;padding:7px 0">E-Mail</td><td style="text-align:right;padding:7px 0">${customerEmail || "-"}</td></tr>
          <tr><td style="color:#888;padding:7px 0">Server ID</td><td style="text-align:right;padding:7px 0;font-family:JetBrains Mono,monospace">${serverId}</td></tr>
          <tr><td style="color:#888;padding:7px 0">Gueltig bis</td><td style="text-align:right;padding:7px 0">${expDate}</td></tr>
          <tr><td style="color:#888;padding:7px 0">Session</td><td style="text-align:right;padding:7px 0;font-family:JetBrains Mono,monospace">${sessionId || "-"}</td></tr>
        </table>
        <div style="border:1px solid rgba(255,255,255,0.1);border-radius:12px;overflow:hidden">
          <div style="display:grid;grid-template-columns:1fr 120px;background:rgba(255,255,255,0.04);padding:10px 14px;font-size:12px;color:#A1A1AA;font-weight:700;letter-spacing:0.04em">
            <span>Leistung</span><span style="text-align:right">Betrag</span>
          </div>
          <div style="display:grid;grid-template-columns:1fr 120px;padding:14px">
            <span>${lineText}</span><span style="text-align:right;font-weight:700">${amount}</span>
          </div>
        </div>
        <div style="margin-top:14px;font-size:12px;color:#A1A1AA">
          Hinweis: Automatisch erstellter Kaufbeleg fuer den Premium-Service.
        </div>
      </div>
    </div>`;
}

function buildExpiryWarningEmail(data) {
  const { tierName, serverId, expiresAt, daysLeft } = data;
  const expDate = new Date(expiresAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });

  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
      <div style="background:#FF2A2A22;padding:32px;text-align:center">
        <h1 style="font-size:22px;margin:0;color:#FF2A2A">Premium laeuft bald ab!</h1>
      </div>
      <div style="padding:24px 32px">
        <p>Dein <strong>${tierName}</strong>-Abo fuer Server <code>${serverId}</code> laeuft in <strong>${daysLeft} Tagen</strong> ab (${expDate}).</p>
        <p>Nach Ablauf werden Premium-Bots und Custom-Stationen deaktiviert.</p>
        <p style="margin-top:20px">
          <a href="https://discord.gg/UeRkfGS43R" style="color:#FFB800;font-weight:700">Jetzt verlaengern &rarr;</a>
        </p>
      </div>
    </div>`;
}

function buildExpiryEmail(data) {
  const { tierName, serverId } = data;
  return `
    <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
      <div style="background:#FF2A2A22;padding:32px;text-align:center">
        <h1 style="font-size:22px;margin:0;color:#FF2A2A">Premium abgelaufen</h1>
      </div>
      <div style="padding:24px 32px">
        <p>Dein <strong>${tierName}</strong>-Abo fuer Server <code>${serverId}</code> ist abgelaufen.</p>
        <p>Premium-Bots und Custom-Stationen sind jetzt deaktiviert. Invite-Links sind nicht mehr gueltig.</p>
        <p style="margin-top:20px">
          <a href="https://discord.gg/UeRkfGS43R" style="color:#FFB800;font-weight:700">Abo erneuern &rarr;</a>
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
