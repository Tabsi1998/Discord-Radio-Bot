export function createDiscordBotListRoutesHandler(deps) {
  const {
    fetchDiscordBotListPublicBotSummary,
    getDashboardRequestTranslator,
    getDiscordBotListStatus,
    getLocalizedJsonBodyError,
    handleDiscordBotListVoteWebhook,
    isAdminApiRequest,
    languagePick,
    log,
    methodNotAllowed,
    sendJson,
    syncDiscordBotListCommands,
    syncDiscordBotListStats,
    syncDiscordBotListVotes,
  } = deps;

  return async function handleDiscordBotListRoutes(context) {
    const { req, res, requestUrl, readJsonBody, runtimes } = context;

    if (requestUrl.pathname === "/api/discordbotlist/status") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      if (!isAdminApiRequest(req)) {
        sendJson(res, 401, {
          error: languagePick(language, "Nicht autorisiert. API-Admin-Token erforderlich.", "Unauthorized. API admin token required."),
        });
        return true;
      }

      const voteLimit = Number.parseInt(String(requestUrl.searchParams.get("limit") || "20"), 10);
      const includePublic = String(requestUrl.searchParams.get("live") || "").trim() === "1";
      const payload = getDiscordBotListStatus(runtimes, { voteLimit });
      if (includePublic && payload?.botId && typeof fetchDiscordBotListPublicBotSummary === "function") {
        try {
          payload.public = await fetchDiscordBotListPublicBotSummary(payload.botId);
        } catch (err) {
          payload.public = {
            ok: false,
            error: err?.message || String(err),
            botId: payload.botId,
            listingUrl: payload.listingUrl || null,
            publicApiUrl: payload.publicApiUrl || null,
          };
        }
      }
      sendJson(res, 200, payload);
      return true;
    }

    if (requestUrl.pathname === "/api/discordbotlist/votes") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      if (!isAdminApiRequest(req)) {
        sendJson(res, 401, {
          error: languagePick(language, "Nicht autorisiert. API-Admin-Token erforderlich.", "Unauthorized. API admin token required."),
        });
        return true;
      }

      const voteLimit = Number.parseInt(String(requestUrl.searchParams.get("limit") || "50"), 10);
      const status = getDiscordBotListStatus(runtimes, { voteLimit });
      sendJson(res, 200, {
        totalVotes: status?.state?.totalVotes || 0,
        votes: status?.state?.votes || [],
      });
      return true;
    }

    if (requestUrl.pathname === "/api/discordbotlist/vote") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }

      try {
        const body = await readJsonBody();
        const result = handleDiscordBotListVoteWebhook(req.headers || {}, body || {});
        sendJson(
          res,
          result.status || (result.ok ? 200 : 400),
          result.ok
            ? {
                success: true,
                added: result.added,
                totalVotes: result.totalVotes,
              }
            : {
                success: false,
                error: result.error,
              }
        );
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, {
            success: false,
            error: getLocalizedJsonBodyError(language, status),
          });
          return true;
        }
        log("ERROR", `DiscordBotList webhook error: ${err?.message || err}`);
        sendJson(res, 500, {
          success: false,
          error: languagePick(language, "DiscordBotList Webhook fehlgeschlagen.", "DiscordBotList webhook failed."),
        });
      }
      return true;
    }

    if (requestUrl.pathname !== "/api/discordbotlist/sync") {
      return false;
    }

    const { language } = getDashboardRequestTranslator(req, requestUrl);
    if (req.method !== "POST") {
      methodNotAllowed(res, ["POST"]);
      return true;
    }
    if (!isAdminApiRequest(req)) {
      sendJson(res, 401, {
        error: languagePick(language, "Nicht autorisiert. API-Admin-Token erforderlich.", "Unauthorized. API admin token required."),
      });
      return true;
    }

    try {
      const body = await readJsonBody();
      const runCommands = body?.commands !== false;
      const runStats = body?.stats !== false;
      const runVotes = body?.votes !== false;
      const results = {};
      let hadFailure = false;

      if (runCommands) {
        try {
          results.commands = await syncDiscordBotListCommands(runtimes);
        } catch (err) {
          hadFailure = true;
          results.commands = { ok: false, error: err?.message || String(err) };
        }
      }
      if (runStats) {
        try {
          results.stats = await syncDiscordBotListStats(runtimes);
        } catch (err) {
          hadFailure = true;
          results.stats = { ok: false, error: err?.message || String(err) };
        }
      }
      if (runVotes) {
        try {
          results.votes = await syncDiscordBotListVotes(runtimes);
        } catch (err) {
          hadFailure = true;
          results.votes = { ok: false, error: err?.message || String(err) };
        }
      }

      sendJson(res, hadFailure ? 500 : 200, {
        success: !hadFailure,
        results,
      });
    } catch (err) {
      const status = Number(err?.status || 0);
      if (status === 400 || status === 413) {
        sendJson(res, status, {
          success: false,
          error: getLocalizedJsonBodyError(language, status),
        });
        return true;
      }
      log("ERROR", `DiscordBotList sync API error: ${err?.message || err}`);
      sendJson(res, 500, {
        success: false,
        error: languagePick(language, "DiscordBotList Sync fehlgeschlagen.", "DiscordBotList sync failed."),
      });
    }

    return true;
  };
}
