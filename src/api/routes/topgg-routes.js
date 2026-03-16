export function createTopGGRoutesHandler(deps) {
  const {
    fetchTopGGProjectSummary,
    fetchTopGGVoteStatus,
    getDashboardRequestTranslator,
    getLocalizedJsonBodyError,
    getTopGGStatus,
    handleTopGGWebhook,
    isAdminApiRequest,
    languagePick,
    log,
    methodNotAllowed,
    sendJson,
    syncTopGGCommands,
    syncTopGGProject,
    syncTopGGStats,
    syncTopGGVotes,
  } = deps;

  return async function handleTopGGRoutes(context) {
    const { req, res, requestUrl, readJsonBody, readRawBody, runtimes } = context;

    if (requestUrl.pathname === "/api/topgg/status") {
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
      const includeLive = String(requestUrl.searchParams.get("live") || "").trim() === "1";
      const payload = getTopGGStatus(runtimes, { voteLimit });
      if (includeLive && typeof fetchTopGGProjectSummary === "function") {
        try {
          payload.live = await fetchTopGGProjectSummary(runtimes);
        } catch (err) {
          payload.live = {
            ok: false,
            error: err?.message || String(err),
            botId: payload.botId || null,
          };
        }
      }
      sendJson(res, 200, payload);
      return true;
    }

    if (requestUrl.pathname === "/api/topgg/votes") {
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
      const status = getTopGGStatus(runtimes, { voteLimit });
      sendJson(res, 200, {
        totalVotes: status?.state?.totalVotes || 0,
        votes: status?.state?.votes || [],
      });
      return true;
    }

    if (requestUrl.pathname === "/api/topgg/vote-status") {
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

      const userId = String(requestUrl.searchParams.get("userId") || "").trim();
      const source = String(requestUrl.searchParams.get("source") || "discord").trim() || "discord";
      const result = await fetchTopGGVoteStatus(runtimes, userId, { source });
      sendJson(res, result.ok ? 200 : 400, result.ok ? result : {
        success: false,
        error: result.reason || "invalid_request",
      });
      return true;
    }

    if (requestUrl.pathname === "/api/topgg/webhook") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }

      try {
        const rawBody = await readRawBody();
        const result = handleTopGGWebhook(req.headers || {}, rawBody);
        sendJson(
          res,
          result.status || (result.ok ? 200 : 400),
          result.ok
            ? {
                success: true,
                added: result.added ?? false,
                totalVotes: result.totalVotes ?? null,
                eventType: result.eventType || null,
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
        log("ERROR", `TopGG webhook error: ${err?.message || err}`);
        sendJson(res, 500, {
          success: false,
          error: languagePick(language, "Top.gg Webhook fehlgeschlagen.", "Top.gg webhook failed."),
        });
      }
      return true;
    }

    if (requestUrl.pathname !== "/api/topgg/sync") {
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
      const runProject = body?.project !== false;
      const runCommands = body?.commands !== false;
      const runStats = body?.stats !== false;
      const runVotes = body?.votes !== false;
      const results = {};
      let hadFailure = false;

      if (runProject) {
        try {
          results.project = await syncTopGGProject(runtimes);
        } catch (err) {
          hadFailure = true;
          results.project = { ok: false, error: err?.message || String(err) };
        }
      }
      if (runCommands) {
        try {
          results.commands = await syncTopGGCommands(runtimes);
        } catch (err) {
          hadFailure = true;
          results.commands = { ok: false, error: err?.message || String(err) };
        }
      }
      if (runStats) {
        try {
          results.stats = await syncTopGGStats(runtimes);
        } catch (err) {
          hadFailure = true;
          results.stats = { ok: false, error: err?.message || String(err) };
        }
      }
      if (runVotes) {
        try {
          results.votes = await syncTopGGVotes(runtimes);
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
      log("ERROR", `TopGG sync API error: ${err?.message || err}`);
      sendJson(res, 500, {
        success: false,
        error: languagePick(language, "Top.gg Sync fehlgeschlagen.", "Top.gg sync failed."),
      });
    }

    return true;
  };
}
