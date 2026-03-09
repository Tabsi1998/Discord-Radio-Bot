export function createDashboardTelemetryRouteHandler(deps) {
  const {
    getDashboardRequestTranslator,
    getLocalizedJsonBodyError,
    isAdminApiRequest,
    languagePick,
    methodNotAllowed,
    normalizeDashboardTelemetryPayload,
    sendJson,
    sendLocalizedError,
    setDashboardTelemetry,
  } = deps;

  return async function handleDashboardTelemetryRoute(context) {
    const { req, res, requestUrl, readJsonBody } = context;

    if (requestUrl.pathname !== "/api/dashboard/telemetry") {
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

    const serverId = String(requestUrl.searchParams.get("serverId") || "").trim();
    if (!/^\d{17,22}$/.test(serverId)) {
      sendLocalizedError(res, 400, language, "Ungültige serverId.", "Invalid serverId.");
      return true;
    }

    try {
      const body = await readJsonBody();
      const telemetry = setDashboardTelemetry(serverId, normalizeDashboardTelemetryPayload(body));
      sendJson(res, 200, { success: true, serverId, telemetry });
    } catch (err) {
      const status = Number(err?.status || 0);
      if (status === 400 || status === 413) {
        sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
        return true;
      }
      sendLocalizedError(res, 500, language, "Telemetry konnte nicht gespeichert werden.", "Telemetry could not be saved.");
    }

    return true;
  };
}
