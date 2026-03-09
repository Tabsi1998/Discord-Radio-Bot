import { getDb, isConnected } from "../../lib/db.js";

async function loadGuildSettings(guildId) {
  if (!isConnected() || !getDb()) {
    return {};
  }

  try {
    return await getDb().collection("guild_settings").findOne(
      { guildId },
      { projection: { _id: 0 } }
    ) || {};
  } catch {
    return {};
  }
}

export function createDashboardSettingsRouteHandler(deps) {
  const {
    buildDashboardDetailStatsPayload,
    buildDashboardExportsWebhookResponse,
    buildDashboardFailoverChainPreview,
    buildDashboardFallbackStationPreview,
    buildDashboardStatsForGuild,
    buildDashboardWeeklyDigestPreviewPayload,
    buildDashboardWebhookPayload,
    buildServerCapabilityPayload,
    buildWeeklyDigestMeta,
    clipText,
    deliverDashboardWebhook,
    getCustomStations,
    getDashboardRequestTranslator,
    getDashboardSession,
    getLocalizedJsonBodyError,
    getPrimaryFailoverStation,
    languagePick,
    log,
    mapDashboardCustomStation,
    methodNotAllowed,
    normalizeFailoverChain,
    normalizeWeeklyDigestConfig,
    resolveDashboardFailoverChain,
    resolveDashboardGuildForSession,
    resolveGuildTextChannel,
    resolveRuntimeForGuild,
    sendJson,
    sendLocalizedError,
    serverHasCapability,
    shouldDeliverDashboardWebhook,
    validateDashboardExportsWebhookConfig,
  } = deps;

  return async function handleDashboardSettingsRoute(context) {
    const { req, res, requestUrl, readJsonBody, runtimes } = context;

    if (requestUrl.pathname === "/api/dashboard/settings/digest-preview") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }
      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
        return true;
      }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) {
        sendLocalizedError(res, 403, language, "Kein Zugriff.", "No access.");
        return true;
      }
      if (!serverHasCapability(guildInfo.id, "weekly_digest")) {
        sendLocalizedError(res, 403, language, "Woechentlicher Digest ist erst ab Pro verfuegbar.", "Weekly digest is only available from Pro.");
        return true;
      }

      try {
        const body = await readJsonBody();
        const currentSettings = await loadGuildSettings(guildInfo.id);
        const weeklyDigest = body?.weeklyDigest && typeof body.weeklyDigest === "object"
          ? body.weeklyDigest
          : currentSettings.weeklyDigest || {};
        const previewPayload = await buildDashboardWeeklyDigestPreviewPayload(guildInfo, runtimes, weeklyDigest, language);
        sendJson(res, 200, {
          success: true,
          serverId: guildInfo.id,
          tier: guildInfo.tier,
          ...previewPayload,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
          return true;
        }
        sendLocalizedError(res, 500, language, "Digest-Vorschau konnte nicht geladen werden.", "Digest preview could not be loaded.");
      }
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/settings/digest-test") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }
      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
        return true;
      }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) {
        sendLocalizedError(res, 403, language, "Kein Zugriff.", "No access.");
        return true;
      }
      if (!serverHasCapability(guildInfo.id, "weekly_digest")) {
        sendLocalizedError(res, 403, language, "Woechentlicher Digest ist erst ab Pro verfuegbar.", "Weekly digest is only available from Pro.");
        return true;
      }

      try {
        const body = await readJsonBody();
        const digest = normalizeWeeklyDigestConfig(body?.weeklyDigest || {}, language);
        if (!digest.channelId) {
          sendLocalizedError(
            res,
            400,
            language,
            "Fuer einen Test-Digest muss ein Text-Channel ausgewaehlt werden.",
            "A text channel is required for a test digest."
          );
          return true;
        }

        const { guild } = resolveRuntimeForGuild(runtimes, guildInfo.id);
        if (!guild) {
          sendLocalizedError(
            res,
            503,
            language,
            "Der Bot ist aktuell nicht mit diesem Server verbunden.",
            "The bot is not connected to this server right now."
          );
          return true;
        }

        const channel = await resolveGuildTextChannel(guild, digest.channelId);
        if (!channel || typeof channel.send !== "function") {
          sendLocalizedError(
            res,
            400,
            language,
            "Der ausgewaehlte Text-Channel ist nicht verfuegbar.",
            "The selected text channel is not available."
          );
          return true;
        }

        const previewPayload = await buildDashboardWeeklyDigestPreviewPayload(guildInfo, runtimes, digest, language);
        await channel.send({ embeds: [previewPayload.preview.embed] });
        sendJson(res, 200, {
          success: true,
          serverId: guildInfo.id,
          tier: guildInfo.tier,
          channelId: digest.channelId,
          channelName: previewPayload.preview.channelName || channel.name || "",
          sentAt: new Date().toISOString(),
          ...previewPayload,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
          return true;
        }
        sendLocalizedError(res, 500, language, "Test-Digest konnte nicht gesendet werden.", "Test digest could not be sent.");
      }
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/exports/webhook-test") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }
      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
        return true;
      }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) {
        sendLocalizedError(res, 403, language, "Kein Zugriff.", "No access.");
        return true;
      }
      if (!serverHasCapability(guildInfo.id, "exports_webhooks")) {
        sendLocalizedError(res, 403, language, "Exporte und Webhooks sind nur fuer Ultimate verfuegbar.", "Exports and webhooks are only available for Ultimate.");
        return true;
      }

      try {
        const body = await readJsonBody();
        const currentSettings = await loadGuildSettings(guildInfo.id);
        const candidateConfig = body?.exportsWebhook && typeof body.exportsWebhook === "object"
          ? body.exportsWebhook
          : currentSettings.exportsWebhook || {};
        const validatedWebhook = await validateDashboardExportsWebhookConfig(candidateConfig);
        if (!validatedWebhook.ok) {
          sendJson(res, 400, { error: validatedWebhook.error });
          return true;
        }
        if (!validatedWebhook.config.url) {
          sendLocalizedError(
            res,
            400,
            language,
            "Bitte zuerst eine Webhook-URL hinterlegen.",
            "Please configure a webhook URL first."
          );
          return true;
        }

        const payload = buildDashboardWebhookPayload("test", {
          server: {
            id: guildInfo.id,
            name: guildInfo.name || "",
            tier: guildInfo.tier,
          },
          actor: session.user || null,
          payload: {
            message: languagePick(
              language,
              "Dies ist ein manueller Dashboard-Test fuer OmniFM Exporte/Webhooks.",
              "This is a manual dashboard test for OmniFM exports/webhooks."
            ),
            enabled: validatedWebhook.config.enabled === true,
            events: validatedWebhook.config.events,
          },
        });

        const delivery = await deliverDashboardWebhook(validatedWebhook.config, "test", payload);
        if (!delivery.delivered) {
          sendJson(res, 502, {
            error: delivery.error || languagePick(language, "Webhook-Test fehlgeschlagen.", "Webhook test failed."),
            delivery,
          });
          return true;
        }

        sendJson(res, 200, {
          success: true,
          serverId: guildInfo.id,
          tier: guildInfo.tier,
          payloadPreview: payload,
          delivery,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
          return true;
        }
        sendLocalizedError(res, 500, language, "Webhook-Test konnte nicht gesendet werden.", "Webhook test could not be sent.");
      }
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/exports/stats") {
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
        sendLocalizedError(res, 403, language, "Kein Zugriff.", "No access.");
        return true;
      }
      if (!serverHasCapability(guild.id, "exports_webhooks")) {
        sendLocalizedError(res, 403, language, "Exporte sind nur fuer Ultimate verfuegbar.", "Exports are only available for Ultimate.");
        return true;
      }

      try {
        const detailPayload = await buildDashboardDetailStatsPayload(
          guild,
          runtimes,
          requestUrl.searchParams.get("days") || "30"
        );
        const summaryPayload = buildDashboardStatsForGuild(guild.id, guild.tier, runtimes);
        const exportPayload = {
          exportType: "stats",
          exportedAt: new Date().toISOString(),
          serverId: guild.id,
          tier: guild.tier,
          basic: summaryPayload.basic,
          advanced: summaryPayload.advanced,
          detail: detailPayload,
        };

        let webhookDelivery = null;
        const settings = await loadGuildSettings(guild.id);
        const webhookConfig = buildDashboardExportsWebhookResponse(settings.exportsWebhook || {});
        if (shouldDeliverDashboardWebhook(webhookConfig, "stats_exported")) {
          webhookDelivery = await deliverDashboardWebhook(
            webhookConfig,
            "stats_exported",
            buildDashboardWebhookPayload("stats_exported", {
              server: {
                id: guild.id,
                name: guild.name || "",
                tier: guild.tier,
              },
              actor: session.user || null,
              payload: {
                exportType: "stats",
                days: detailPayload.days,
                totalSessions: detailPayload.listeningStats.totalSessions,
                dailyPoints: detailPayload.dailyStats.length,
              },
            })
          );
        }

        sendJson(res, 200, {
          ...exportPayload,
          webhookDelivery,
        });
      } catch (err) {
        log("ERROR", `Dashboard stats export error: ${err?.message || err}`);
        sendLocalizedError(res, 500, language, "Stats-Export konnte nicht erstellt werden.", "Stats export could not be created.");
      }
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/exports/custom-stations") {
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
        sendLocalizedError(res, 403, language, "Kein Zugriff.", "No access.");
        return true;
      }
      if (!serverHasCapability(guild.id, "exports_webhooks")) {
        sendLocalizedError(res, 403, language, "Exporte sind nur fuer Ultimate verfuegbar.", "Exports are only available for Ultimate.");
        return true;
      }

      const stations = Object.entries(getCustomStations(guild.id) || {})
        .map(([key, station]) => mapDashboardCustomStation(key, station))
        .sort((a, b) => {
          const folderCompare = String(a.folder || "").localeCompare(String(b.folder || ""));
          if (folderCompare !== 0) return folderCompare;
          return a.name.localeCompare(b.name);
        });

      let webhookDelivery = null;
      try {
        const settings = await loadGuildSettings(guild.id);
        const webhookConfig = buildDashboardExportsWebhookResponse(settings.exportsWebhook || {});
        if (shouldDeliverDashboardWebhook(webhookConfig, "custom_stations_exported")) {
          const folderCount = new Set(stations.map((station) => station.folder).filter(Boolean)).size;
          webhookDelivery = await deliverDashboardWebhook(
            webhookConfig,
            "custom_stations_exported",
            buildDashboardWebhookPayload("custom_stations_exported", {
              server: {
                id: guild.id,
                name: guild.name || "",
                tier: guild.tier,
              },
              actor: session.user || null,
              payload: {
                exportType: "custom_stations",
                stationCount: stations.length,
                folderCount,
              },
            })
          );
        }
      } catch (err) {
        log("WARN", `Dashboard custom station export webhook error: ${err?.message || err}`);
      }

      sendJson(res, 200, {
        exportType: "custom_stations",
        exportedAt: new Date().toISOString(),
        serverId: guild.id,
        tier: guild.tier,
        stations,
        webhookDelivery,
      });
      return true;
    }

    if (requestUrl.pathname !== "/api/dashboard/settings") {
      return false;
    }

    const { language } = getDashboardRequestTranslator(req, requestUrl);
    const { session } = getDashboardSession(req);
    if (!session) {
      sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
      return true;
    }
    const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
    if (!guildInfo) {
      sendLocalizedError(res, 403, language, "Kein Zugriff.", "No access.");
      return true;
    }
    if (!serverHasCapability(guildInfo.id, "dashboard_access")) {
      sendLocalizedError(res, 403, language, "Dashboard ist erst ab Pro verfuegbar.", "Dashboard is only available from Pro.");
      return true;
    }

    if (req.method === "GET") {
      const settings = await loadGuildSettings(guildInfo.id);
      const weeklyDigest = normalizeWeeklyDigestConfig(settings.weeklyDigest || {}, language);
      const failoverChain = resolveDashboardFailoverChain(settings);
      const fallbackStation = getPrimaryFailoverStation(failoverChain, settings.fallbackStation || "");
      sendJson(res, 200, {
        guildId: guildInfo.id,
        tier: guildInfo.tier,
        capabilities: buildServerCapabilityPayload(guildInfo.id).capabilities,
        weeklyDigest,
        weeklyDigestMeta: buildWeeklyDigestMeta(weeklyDigest, {
          lastSentAt: settings.weeklyDigestLastSent || null,
        }),
        failoverChain,
        failoverChainPreview: buildDashboardFailoverChainPreview(guildInfo.id, failoverChain, fallbackStation),
        fallbackStation,
        fallbackStationPreview: buildDashboardFallbackStationPreview(guildInfo.id, fallbackStation),
        exportsWebhook: buildDashboardExportsWebhookResponse(settings.exportsWebhook || {}),
      });
      return true;
    }

    if (req.method === "PUT") {
      try {
        const body = await readJsonBody();
        const updates = { guildId: guildInfo.id };

        if (body?.weeklyDigest && typeof body.weeklyDigest === "object") {
          if (!serverHasCapability(guildInfo.id, "weekly_digest")) {
            sendLocalizedError(res, 403, language, "Woechentlicher Digest ist erst ab Pro verfuegbar.", "Weekly digest is only available from Pro.");
            return true;
          }
          updates.weeklyDigest = normalizeWeeklyDigestConfig(body.weeklyDigest, language);
          if (updates.weeklyDigest.enabled && !updates.weeklyDigest.channelId) {
            sendLocalizedError(
              res,
              400,
              language,
              "Fuer einen aktiven Digest muss ein Text-Channel ausgewaehlt werden.",
              "An active digest requires a selected text channel."
            );
            return true;
          }
        }

        if (body?.failoverChain !== undefined || body?.fallbackStation !== undefined) {
          if (!serverHasCapability(guildInfo.id, "failover_rules")) {
            sendLocalizedError(res, 403, language, "Fallback-Station ist nur fuer Ultimate verfuegbar.", "Fallback station is only available for Ultimate.");
            return true;
          }
          const rawFailoverInput = body?.failoverChain !== undefined
            ? (Array.isArray(body.failoverChain)
              ? body.failoverChain.map((value) => clipText(value || "", 120))
              : clipText(body.failoverChain || "", 120))
            : clipText(body?.fallbackStation || "", 120);
          const normalizedFailoverChain = normalizeFailoverChain(rawFailoverInput);
          const failoverPreviews = buildDashboardFailoverChainPreview(guildInfo.id, normalizedFailoverChain);
          const invalidPreview = failoverPreviews.find((preview) => preview.valid !== true) || null;
          if (invalidPreview) {
            sendLocalizedError(
              res,
              400,
              language,
              "Die gewaehlte Fallback-Station ist fuer diesen Server nicht verfuegbar.",
              "The selected fallback station is not available for this server."
            );
            return true;
          }
          updates.failoverChain = normalizedFailoverChain;
          updates.fallbackStation = getPrimaryFailoverStation(normalizedFailoverChain, "");
        }

        if (body?.exportsWebhook && typeof body.exportsWebhook === "object") {
          if (!serverHasCapability(guildInfo.id, "exports_webhooks")) {
            sendLocalizedError(res, 403, language, "Exporte und Webhooks sind nur fuer Ultimate verfuegbar.", "Exports and webhooks are only available for Ultimate.");
            return true;
          }
          const validatedWebhook = await validateDashboardExportsWebhookConfig(body.exportsWebhook);
          if (!validatedWebhook.ok) {
            sendJson(res, 400, { error: validatedWebhook.error });
            return true;
          }
          if (validatedWebhook.config.enabled && !validatedWebhook.config.url) {
            sendLocalizedError(
              res,
              400,
              language,
              "Fuer aktive Export-Webhooks muss eine URL hinterlegt werden.",
              "An active export webhook requires a configured URL."
            );
            return true;
          }
          updates.exportsWebhook = validatedWebhook.config;
        }

        if (!isConnected() || !getDb()) {
          sendLocalizedError(res, 503, language, "MongoDB nicht verbunden.", "MongoDB is not connected.");
          return true;
        }

        const currentSettings = await loadGuildSettings(guildInfo.id);
        await getDb().collection("guild_settings").updateOne(
          { guildId: guildInfo.id },
          { $set: updates },
          { upsert: true }
        );

        const weeklyDigest = updates.weeklyDigest
          || normalizeWeeklyDigestConfig(currentSettings.weeklyDigest || {}, language);
        const failoverChain = Object.prototype.hasOwnProperty.call(updates, "failoverChain")
          ? normalizeFailoverChain(updates.failoverChain || [])
          : resolveDashboardFailoverChain(currentSettings);
        const fallbackStation = Object.prototype.hasOwnProperty.call(updates, "fallbackStation")
          ? String(updates.fallbackStation || "").trim().toLowerCase()
          : getPrimaryFailoverStation(failoverChain, currentSettings.fallbackStation || "");
        const exportsWebhook = Object.prototype.hasOwnProperty.call(updates, "exportsWebhook")
          ? buildDashboardExportsWebhookResponse(updates.exportsWebhook)
          : buildDashboardExportsWebhookResponse(currentSettings.exportsWebhook || {});

        sendJson(res, 200, {
          success: true,
          guildId: guildInfo.id,
          tier: guildInfo.tier,
          capabilities: buildServerCapabilityPayload(guildInfo.id).capabilities,
          weeklyDigest,
          weeklyDigestMeta: buildWeeklyDigestMeta(weeklyDigest, {
            lastSentAt: currentSettings.weeklyDigestLastSent || null,
          }),
          failoverChain,
          failoverChainPreview: buildDashboardFailoverChainPreview(guildInfo.id, failoverChain, fallbackStation),
          fallbackStation,
          fallbackStationPreview: buildDashboardFallbackStationPreview(guildInfo.id, fallbackStation),
          exportsWebhook,
        });
      } catch (err) {
        sendJson(res, 400, { error: err?.message || languagePick(language, "Ungueltige Anfrage.", "Invalid request.") });
      }
      return true;
    }

    methodNotAllowed(res, ["GET", "PUT"]);
    return true;
  };
}
