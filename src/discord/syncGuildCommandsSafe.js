import { once } from "node:events";
import { runExclusive } from "../utils/commandSyncGuard.js";

function toInt(rawValue, fallback) {
  const parsed = Number.parseInt(String(rawValue ?? fallback), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(err) {
  if (!err) return "unknown";
  if (typeof err === "string") return err;
  return String(err?.message || err);
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

function getRateLimitMeta(err) {
  const status = Number(err?.status ?? err?.statusCode ?? 0);
  const retryAfterSeconds = Number(
    err?.rawError?.retry_after
    ?? err?.data?.retry_after
    ?? err?.retry_after
    ?? 0
  );
  const isRateLimited = status === 429 || retryAfterSeconds > 0;
  const isGlobal = Boolean(err?.rawError?.global ?? err?.data?.global ?? false);
  return {
    isRateLimited,
    status,
    retryAfterSeconds: Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 0,
    isGlobal,
  };
}

async function putGuildCommandsWithTimeout({
  rest,
  route,
  payload,
  timeoutMs,
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    await rest.put(route, { body: payload });
    return;
  }

  let timeoutHandle = null;
  let didTimeout = false;
  const controller = typeof AbortController === "function" ? new AbortController() : null;

  const requestPromise = rest.put(route, {
    body: payload,
    ...(controller ? { signal: controller.signal } : {}),
  });

  // If timeout already happened, swallow late request rejection to avoid hanging queue on unhandled rejections.
  const settledRequest = requestPromise.catch((err) => {
    if (didTimeout) return undefined;
    throw err;
  });

  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      didTimeout = true;
      if (controller) {
        try {
          controller.abort();
        } catch {
          // ignore abort errors
        }
      }
      const timeoutError = new Error(`Guild command sync timeout after ${timeoutMs}ms`);
      timeoutError.code = "SYNC_TIMEOUT";
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    await Promise.race([settledRequest, timeoutPromise]);
  } catch (err) {
    if (err?.code === "SYNC_TIMEOUT") {
      throw err;
    }
    const aborted = didTimeout || controller?.signal?.aborted || err?.name === "AbortError";
    if (aborted) {
      const wrapped = new Error(`Guild command sync timeout after ${timeoutMs}ms`);
      wrapped.code = "SYNC_TIMEOUT";
      wrapped.cause = err;
      throw wrapped;
    }
    throw err;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function logSyncDone(logFn, label, ok, failed, source, reason = "") {
  const reasonSuffix = reason ? ` reason=${reason}` : "";
  emit(logFn, "INFO", `[${label}] Command Sync done: ok=${ok} failed=${failed} source=${source}${reasonSuffix}`);
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
  const requestTimeoutMs = Math.max(
    1000,
    toInt(process.env.GUILD_COMMAND_SYNC_REQUEST_TIMEOUT_MS, 10000)
  );
  const configuredTries = toInt(
    process.env.GUILD_COMMAND_SYNC_TRIES ?? process.env.GUILD_COMMAND_SYNC_RETRIES,
    3
  );
  const maxTries = Math.min(3, Math.max(1, configuredTries));

  if (payload.length === 0) {
    emit(logFn, "ERROR", `[${label}] Command Sync aborted: commandsCount=0 source=${syncSource}`);
    logSyncDone(logFn, label, 0, 0, syncSource, "empty-commands");
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
      logSyncDone(logFn, label, 0, 0, syncSource, "ready-wait-failed");
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
      logSyncDone(logFn, label, 0, 0, syncSource, "guild-fetch-failed");
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
      logSyncDone(logFn, label, 0, guildCount, syncSource, "missing-application-id");
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
      logSyncDone(logFn, label, 0, guildCount, syncSource, reason);
      return { ok: 0, failed: guildCount, attempts: attempt, skipped: true, reason };
    }

    if (shouldDelayAfterReady && readyDelayMs > 0) {
      await waitMs(readyDelayMs);
    }

    const result = await runExclusive(async () => {
      let ok = 0;
      let failed = 0;
      emit(logFn, "INFO", `[${label}] Command Sync start: guilds=${guildCount} commands=${payload.length} source=${syncSource}`);

      try {
        for (const guildId of guildIds) {
          emit(logFn, "INFO", `[${label}] Syncing guild ${guildId}...`);
          try {
            // eslint-disable-next-line no-await-in-loop
            await putGuildCommandsWithTimeout({
              rest,
              route: routes.applicationGuildCommands(applicationId, guildId),
              payload,
              timeoutMs: requestTimeoutMs,
            });
            ok += 1;
            emit(logFn, "INFO", `[${label}] Guild ${guildId} success`);
          } catch (err) {
            failed += 1;
            const rateLimitMeta = getRateLimitMeta(err);
            if (rateLimitMeta.isRateLimited) {
              emit(
                logFn,
                "ERROR",
                `[${label}] Guild ${guildId} failed: rate_limit status=${rateLimitMeta.status || 429} retry_after=${rateLimitMeta.retryAfterSeconds}s global=${rateLimitMeta.isGlobal} error=${toErrorMessage(err)}`
              );
            } else {
              emit(logFn, "ERROR", `[${label}] Guild ${guildId} failed: ${toErrorMessage(err)}`);
            }
          }
        }
      } finally {
        logSyncDone(logFn, label, ok, failed, syncSource);
      }
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
