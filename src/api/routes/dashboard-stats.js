export function createDashboardStatsRouteHandler(deps) {
  const {
    buildDashboardDetailStatsPayload,
    buildDashboardStatsForGuild,
    getDashboardRequestTranslator,
    getDashboardSession,
    getDb,
    languagePick,
    log,
    methodNotAllowed,
    resetGuildStats,
    resolveDashboardGuildForSession,
    sendJson,
    sendLocalizedError,
    serverHasCapability,
  } = deps;

  return async function handleDashboardStatsRoute(context) {
    const { req, res, requestUrl, runtimes } = context;

    if (!requestUrl.pathname.startsWith("/api/dashboard/stats")) {
      return false;
    }

    if (requestUrl.pathname === "/api/dashboard/stats") {
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
      if (!serverHasCapability(guild.id, "dashboard_access")) {
        sendLocalizedError(res, 403, language, "Dashboard ist erst ab Pro verfuegbar.", "Dashboard is only available from Pro.");
        return true;
      }

      const statsPayload = buildDashboardStatsForGuild(guild.id, guild.tier, runtimes);
      sendJson(res, 200, {
        serverId: guild.id,
        tier: guild.tier,
        basic: statsPayload.basic,
        advanced: serverHasCapability(guild.id, "advanced_analytics") ? statsPayload.advanced : null,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/stats/reset") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "DELETE") {
        methodNotAllowed(res, ["DELETE"]);
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
      if (!serverHasCapability(guild.id, "dashboard_access")) {
        sendLocalizedError(res, 403, language, "Dashboard ist erst ab Pro verfuegbar.", "Dashboard is only available from Pro.");
        return true;
      }

      const guildId = guild.id;
      const deletedCounts = {};
      try {
        const db = getDb();
        if (db) {
          for (const collectionName of ["daily_stats", "listening_sessions", "listener_snapshots"]) {
            const result = await db.collection(collectionName).deleteMany({ guildId });
            deletedCounts[collectionName] = result.deletedCount || 0;
          }
          const statsResult = await db.collection("guild_stats").deleteMany({ guildId });
          deletedCounts.guild_stats = statsResult.deletedCount || 0;
        }
        if (typeof resetGuildStats === "function") {
          resetGuildStats(guildId);
        }
      } catch (err) {
        console.error(`[stats-reset] Error for guild ${guildId}: ${err.message}`);
        sendJson(res, 500, {
          error: languagePick(
            language,
            `Fehler beim Zuruecksetzen: ${err.message}`,
            `Reset failed: ${err.message}`
          ),
        });
        return true;
      }

      sendJson(res, 200, { success: true, serverId: guildId, deleted: deletedCounts });
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/stats/detail") {
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
      if (!serverHasCapability(guild.id, "advanced_analytics")) {
        sendLocalizedError(
          res,
          403,
          language,
          "Detaillierte Statistiken sind nur fuer Ultimate verfuegbar.",
          "Detailed statistics are only available for Ultimate."
        );
        return true;
      }

      try {
        const detailPayload = await buildDashboardDetailStatsPayload(
          guild,
          runtimes,
          requestUrl.searchParams.get("days") || "30"
        );
        sendJson(res, 200, detailPayload);
      } catch (err) {
        log("ERROR", `Dashboard detail stats error: ${err?.message || err}`);
        sendLocalizedError(
          res,
          500,
          language,
          "Detaillierte Statistiken konnten nicht geladen werden.",
          "Detailed statistics could not be loaded."
        );
      }
      return true;
    }

    return false;
  };
}
