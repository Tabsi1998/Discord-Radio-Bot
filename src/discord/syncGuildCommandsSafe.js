import { once } from "node:events";
import { runExclusive } from "../utils/commandSyncGuard.js";

function toInt(rawValue, fallback) {
  const parsed = Number.parseInt(String(rawValue ?? fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultLog(level, message) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level}] ${message}`);
}

function emit(logFn, level, message) {
  if (typeof logFn === "function") {
    logFn(level, message);
    return;
  }
  defaultLog(level, message);
}

function resolveApplicationId(client) {
  return String(client?.application?.id || client?.user?.id || "").trim();
}

function extractGuildIds(collection) {
  if (!collection) return [];
  if (typeof collection.keys === "function") {
    return [...collection.keys()].map((id) => String(id));
  }
  if (Array.isArray(collection)) {
    return collection
      .map((entry) => String(entry?.id || entry || "").trim())
      .filter(Boolean);
  }
  return [];
}

function uniqueGuildIds(ids) {
  const out = [];
  const seen = new Set();
  for (const rawId of ids || []) {
    const guildId = String(rawId || "").trim();
    if (!guildId || seen.has(guildId)) continue;
    seen.add(guildId);
    out.push(guildId);
  }
  return out;
}

async function ensureClientReady(client) {
  if (client?.isReady?.()) return;
  await once(client, "clientReady");
}

export async function syncGuildCommandsSafe({
  client,
  rest,
  routes,
  commands,
  botLabel,
  source,
  logFn = null,
}) {
  if (!client || !rest || !routes || typeof routes.applicationGuildCommands !== "function") {
    throw new Error("syncGuildCommandsSafe: client/rest/routes fehlen.");
  }

  const label = botLabel || "Bot";
  const syncSource = source || "sync";
  const shouldDelayAfterReady = String(syncSource).toLowerCase() === "startup";
  const payload = Array.isArray(commands) ? commands : [];
  const readyDelayMs = Math.max(
    0,
    toInt(process.env.GUILD_COMMAND_SYNC_READY_DELAY_MS ?? process.env.GUILD_COMMAND_READY_DELAY_MS, 7000)
  );
  const retryDelayMs = Math.max(
    1000,
    toInt(process.env.GUILD_COMMAND_SYNC_RETRY_DELAY_MS ?? process.env.GUILD_COMMAND_SYNC_RETRY_MS, 10000)
  );
  const configuredTries = toInt(
    process.env.GUILD_COMMAND_SYNC_TRIES ?? process.env.GUILD_COMMAND_SYNC_RETRIES,
    3
  );
  const maxTries = Math.min(3, Math.max(1, configuredTries));

  if (payload.length === 0) {
    emit(logFn, "ERROR", `[${label}] Command Sync aborted: commandsCount=0 source=${syncSource}`);
    return { ok: 0, failed: 0, attempts: 0, skipped: true, reason: "empty-commands" };
  }

  let lastResult = { ok: 0, failed: 0, attempts: 0 };

  for (let attempt = 1; attempt <= maxTries; attempt++) {
    try {
      await ensureClientReady(client);
    } catch (err) {
      emit(
        logFn,
        "ERROR",
        `[${label}] Command Sync ready wait failed (attempt=${attempt}/${maxTries}): ${err?.message || err}`
      );
      if (attempt < maxTries) {
        await waitMs(retryDelayMs);
        continue;
      }
      throw err;
    }

    let fetchedGuilds;
    try {
      fetchedGuilds = await client.guilds.fetch();
    } catch (err) {
      emit(
        logFn,
        "ERROR",
        `[${label}] Guild fetch failed (attempt=${attempt}/${maxTries}): ${err?.message || err}`
      );
      if (attempt < maxTries) {
        await waitMs(retryDelayMs);
        continue;
      }
      throw err;
    }

    const fetchedGuildIds = extractGuildIds(fetchedGuilds);
    const cacheGuildIds = [...client.guilds.cache.keys()];
    const guildIds = uniqueGuildIds([...fetchedGuildIds, ...cacheGuildIds]);
    const guildCount = guildIds.length;
    const fetchedCount = fetchedGuildIds.length;
    const cacheCount = cacheGuildIds.length;
    const applicationId = resolveApplicationId(client);

    emit(logFn, "INFO", `[${label}] Ready -> Guilds fetched: ${fetchedCount}`);
    emit(
      logFn,
      "INFO",
      `[${label}] Command Sync debug: botId=${client.user?.id || "n/a"} applicationId=${applicationId || "n/a"} guildCount=${guildCount} fetchedGuildCount=${fetchedCount} cacheGuildCount=${cacheCount} guildIds=${guildIds.join(",") || "-"} commandsCount=${payload.length} source=${syncSource} attempt=${attempt}/${maxTries}`
    );

    if (!applicationId) {
      emit(
        logFn,
        "ERROR",
        `[${label}] Command Sync blocked: applicationId missing (attempt=${attempt}/${maxTries})`
      );
      if (attempt < maxTries) {
        await waitMs(retryDelayMs);
        continue;
      }
      return { ok: 0, failed: guildCount, attempts: attempt, skipped: true, reason: "missing-application-id" };
    }

    if (guildCount === 0) {
      const reason = "no-guild-ids-after-fetch";
      emit(
        logFn,
        "ERROR",
        `[${label}] Command Sync retry trigger: ${reason} (attempt=${attempt}/${maxTries})`
      );
      if (attempt < maxTries) {
        await waitMs(retryDelayMs);
        continue;
      }
      return { ok: 0, failed: guildCount, attempts: attempt, skipped: true, reason };
    }

    if (shouldDelayAfterReady && readyDelayMs > 0) {
      await waitMs(readyDelayMs);
    }

    const result = await runExclusive(async () => {
      let ok = 0;
      let failed = 0;
      emit(logFn, "INFO", `[${label}] Command Sync start: guilds=${guildCount} commands=${payload.length} source=${syncSource}`);

      for (const guildId of guildIds) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await rest.put(routes.applicationGuildCommands(applicationId, guildId), { body: payload });
          ok += 1;
          emit(logFn, "INFO", `[${label}] Command Sync guild ok: guild=${guildId}`);
        } catch (err) {
          failed += 1;
          emit(logFn, "ERROR", `[${label}] Command Sync guild fail: guild=${guildId} error=${err?.message || err}`);
        }
      }

      emit(logFn, "INFO", `[${label}] Command Sync done: ok=${ok} failed=${failed}`);
      return { ok, failed, attempts: attempt };
    });

    lastResult = result;
    if (result.failed === 0) {
      return result;
    }

    if (attempt < maxTries) {
      emit(
        logFn,
        "INFO",
        `[${label}] Command Sync retry scheduled in ${retryDelayMs}ms (attempt=${attempt + 1}/${maxTries})`
      );
      await waitMs(retryDelayMs);
    }
  }

  return lastResult;
}
