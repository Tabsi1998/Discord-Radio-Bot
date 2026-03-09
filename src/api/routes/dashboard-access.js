export function createDashboardAccessRouteHandler(deps) {
  const {
    buildServerCapabilityPayload,
    getDashboardRequestTranslator,
    getDashboardSession,
    methodNotAllowed,
    resolveDashboardGuildForSession,
    resolveDashboardGuildsForSession,
    sendJson,
    sendLocalizedError,
  } = deps;

  return async function handleDashboardAccessRoute(context) {
    const { req, res, requestUrl } = context;

    if (requestUrl.pathname === "/api/dashboard/guilds") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
        return true;
      }
      sendJson(res, 200, { guilds: resolveDashboardGuildsForSession(session) });
      return true;
    }

    if (requestUrl.pathname !== "/api/dashboard/capabilities") {
      return false;
    }

    const { language } = getDashboardRequestTranslator(req, requestUrl);
    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return true;
    }

    const { session } = getDashboardSession(req);
    if (!session) {
      sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
      return true;
    }

    const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
    if (!guild) {
      sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
      return true;
    }

    sendJson(res, 200, buildServerCapabilityPayload(guild.id));
    return true;
  };
}
