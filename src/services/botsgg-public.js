import { clipText } from "../lib/helpers.js";

const BOTSGG_PUBLIC_SITE_BASE = "https://discord.bots.gg";
const BOTSGG_PUBLIC_API_BASE = "https://discord.bots.gg/api/v1";

function buildBotsGGPublicUrls(botId) {
  const normalizedBotId = String(botId || "").trim();
  if (!/^\d{17,22}$/.test(normalizedBotId)) {
    return {
      listingUrl: null,
      publicApiUrl: null,
    };
  }

  return {
    listingUrl: `${BOTSGG_PUBLIC_SITE_BASE}/bots/${normalizedBotId}`,
    publicApiUrl: `${BOTSGG_PUBLIC_API_BASE}/bots/${normalizedBotId}`,
  };
}

async function fetchBotsGGPublicBotSummary(botId) {
  const normalizedBotId = String(botId || "").trim();
  const urls = buildBotsGGPublicUrls(normalizedBotId);
  if (!urls.publicApiUrl) {
    return {
      ok: false,
      skipped: true,
      reason: "missing_bot_id",
      botId: null,
      ...urls,
    };
  }

  const response = await fetch(urls.publicApiUrl, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  const rawText = await response.text();
  let parsed = null;
  if (rawText.trim()) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { raw: rawText };
    }
  }

  if (!response.ok) {
    const message = parsed?.error || parsed?.message || clipText(rawText, 240) || `HTTP ${response.status}`;
    throw new Error(`GET public bot summary failed (${response.status}): ${message}`);
  }

  return {
    ok: true,
    botId: String(parsed?.clientId || parsed?.userId || normalizedBotId).trim() || normalizedBotId,
    username: clipText(String(parsed?.username || ""), 120) || null,
    online: parsed?.online === true,
    status: clipText(String(parsed?.status || ""), 60) || null,
    guildCount: Number(parsed?.guildCount || 0) || 0,
    verified: parsed?.verified === true,
    verificationLevel: clipText(String(parsed?.verificationLevel || ""), 60) || null,
    inGuild: parsed?.inGuild === true,
    uptime: Math.max(0, Number(parsed?.uptime || 0) || 0),
    lastOnlineChange: clipText(String(parsed?.lastOnlineChange || ""), 80) || null,
    libraryName: clipText(String(parsed?.libraryName || ""), 80) || null,
    addedDate: clipText(String(parsed?.addedDate || ""), 80) || null,
    ...urls,
  };
}

export {
  BOTSGG_PUBLIC_API_BASE,
  BOTSGG_PUBLIC_SITE_BASE,
  buildBotsGGPublicUrls,
  fetchBotsGGPublicBotSummary,
};
