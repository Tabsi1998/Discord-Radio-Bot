function sanitizeName(raw, fallback) {
  const name = String(raw || "").trim();
  return name || fallback;
}

function sanitizeNumberString(raw) {
  const value = String(raw || "").trim();
  return /^[0-9]+$/.test(value) ? value : null;
}

function loadNumberedBots(env) {
  const bots = [];

  for (let i = 1; i <= 20; i += 1) {
    const token = String(env[`BOT_${i}_TOKEN`] || "").trim();
    const clientId = sanitizeNumberString(env[`BOT_${i}_CLIENT_ID`]);

    if (!token && !clientId) continue;
    if (!token || !clientId) {
      throw new Error(`BOT_${i}_TOKEN und BOT_${i}_CLIENT_ID muessen gemeinsam gesetzt sein.`);
    }

    bots.push({
      id: `bot-${i}`,
      index: i,
      name: sanitizeName(env[`BOT_${i}_NAME`], `Radio Bot ${i}`),
      token,
      clientId,
      permissions: sanitizeNumberString(env[`BOT_${i}_PERMISSIONS`]) || null
    });
  }

  return bots;
}

function loadLegacySingleBot(env) {
  const token = String(env.DISCORD_TOKEN || "").trim();
  const clientId = sanitizeNumberString(env.CLIENT_ID);
  if (!token || !clientId) return [];

  return [
    {
      id: "bot-1",
      index: 1,
      name: sanitizeName(env.BOT_NAME, "Radio Bot"),
      token,
      clientId,
      permissions: sanitizeNumberString(env.BOT_PERMISSIONS) || null
    }
  ];
}

function ensureUniqueClientIds(bots) {
  const seen = new Set();
  for (const bot of bots) {
    if (seen.has(bot.clientId)) {
      throw new Error(`CLIENT_ID doppelt konfiguriert: ${bot.clientId}`);
    }
    seen.add(bot.clientId);
  }
}

export function buildInviteUrl(bot) {
  const base = new URL("https://discord.com/oauth2/authorize");
  base.searchParams.set("client_id", bot.clientId);
  base.searchParams.set("scope", "bot applications.commands");
  if (bot.permissions) {
    base.searchParams.set("permissions", bot.permissions);
  }
  return base.toString();
}

export function loadBotConfigs(env = process.env) {
  const numbered = loadNumberedBots(env);
  const bots = numbered.length > 0 ? numbered : loadLegacySingleBot(env);
  if (bots.length === 0) {
    throw new Error(
      "Keine Bot-Konfiguration gefunden. Setze BOT_1_TOKEN/BOT_1_CLIENT_ID (oder DISCORD_TOKEN/CLIENT_ID)."
    );
  }

  ensureUniqueClientIds(bots);
  return bots;
}
