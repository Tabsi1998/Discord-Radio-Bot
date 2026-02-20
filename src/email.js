import nodemailer from "nodemailer";

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user;
  const adminEmail = process.env.ADMIN_EMAIL || "";

  if (!host || !user || !pass) return null;
  return { host, port, user, pass, from, adminEmail };
}

function createTransporter() {
  const cfg = getSmtpConfig();
  if (!cfg) return null;

  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.pass },
    tls: { rejectUnauthorized: false },
  });
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
      from: `"Radio Bot Premium" <${cfg.from}>`,
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

function buildPurchaseEmail(data) {
  const { tier, tierName, months, serverId, expiresAt, inviteLinks } = data;
  const expDate = new Date(expiresAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const tierColor = tier === "ultimate" ? "#BD00FF" : "#FFB800";

  let inviteHtml = "";
  if (inviteLinks && inviteLinks.length > 0) {
    inviteHtml = `
      <div style="margin:20px 0;padding:16px;background:#1a1a1a;border-radius:12px;border:1px solid ${tierColor}33">
        <h3 style="color:${tierColor};margin:0 0 12px">Deine Bot Invite-Links</h3>
        ${inviteLinks.map((b, i) => `
          <div style="margin:8px 0">
            <a href="${b.url}" style="color:#fff;text-decoration:none;background:${tierColor};padding:8px 16px;border-radius:8px;display:inline-block;font-weight:600">${b.name} einladen</a>
          </div>
        `).join("")}
        <p style="color:#666;font-size:12px;margin:12px 0 0">Diese Links sind gueltig bis ${expDate}.</p>
      </div>`;
  }

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;border-radius:16px;overflow:hidden">
      <div style="background:linear-gradient(135deg,${tierColor}22,transparent);padding:32px;text-align:center">
        <h1 style="font-size:24px;margin:0;color:${tierColor}">Premium ${tierName} aktiviert!</h1>
      </div>
      <div style="padding:24px 32px">
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="color:#888;padding:8px 0">Server ID</td><td style="text-align:right;padding:8px 0;font-family:monospace">${serverId}</td></tr>
          <tr><td style="color:#888;padding:8px 0">Tier</td><td style="text-align:right;padding:8px 0;color:${tierColor};font-weight:700">${tierName}</td></tr>
          <tr><td style="color:#888;padding:8px 0">Laufzeit</td><td style="text-align:right;padding:8px 0">${months} Monat${months > 1 ? "e" : ""}</td></tr>
          <tr><td style="color:#888;padding:8px 0">Gueltig bis</td><td style="text-align:right;padding:8px 0;font-weight:700">${expDate}</td></tr>
        </table>
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
  buildExpiryWarningEmail, buildExpiryEmail,
};
