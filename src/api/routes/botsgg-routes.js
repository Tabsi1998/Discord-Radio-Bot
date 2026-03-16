export function createBotsGGRoutesHandler(deps) {
  const {
    fetchBotsGGPublicBotSummary,
    getBotsGGStatus,
    getDashboardRequestTranslator,
    isAdminApiRequest,
    languagePick,
    methodNotAllowed,
    sendJson,
    syncBotsGGStats,
  } = deps;

  return async function handleBotsGGRoutes(context) {
    const { req, res, requestUrl, runtimes } = context;

    if (requestUrl.pathname === "/api/botsgg/status") {
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

      const includePublic = String(requestUrl.searchParams.get("live") || "").trim() === "1";
      const payload = getBotsGGStatus(runtimes);
      if (includePublic && payload?.botId && typeof fetchBotsGGPublicBotSummary === "function") {
        try {
          payload.public = await fetchBotsGGPublicBotSummary(payload.botId);
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

    if (requestUrl.pathname !== "/api/botsgg/sync") {
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
      const result = await syncBotsGGStats(runtimes);
      sendJson(res, result.ok ? 200 : 503, {
        success: result.ok === true,
        result,
      });
    } catch (err) {
      sendJson(res, 500, {
        success: false,
        error: err?.message || String(err),
      });
    }

    return true;
  };
}
