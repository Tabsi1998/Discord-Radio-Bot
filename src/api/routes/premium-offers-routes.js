export function createPremiumOffersRoutesHandler(deps) {
  const {
    clipText,
    deleteOffer,
    getDashboardRequestTranslator,
    getLocalizedJsonBodyError,
    getOffer,
    isAdminApiRequest,
    listOffers,
    listRecentRedemptions,
    methodNotAllowed,
    sanitizeOfferCode,
    sendJson,
    setOfferActive,
    upsertOffer,
  } = deps;

  function sendUnauthorized(res, language) {
    sendJson(res, 401, {
      error: language === "de"
        ? "Nicht autorisiert. API-Admin-Token erforderlich."
        : "Unauthorized. API admin token required.",
    });
  }

  return async function handlePremiumOffersRoutes(context) {
    const { req, res, requestUrl, readJsonBody } = context;

    if (requestUrl.pathname === "/api/premium/offers") {
      const { language, t } = getDashboardRequestTranslator(req, requestUrl);
      if (!isAdminApiRequest(req)) {
        sendUnauthorized(res, language);
        return true;
      }

      if (req.method === "GET") {
        const includeInactive = requestUrl.searchParams.get("includeInactive") !== "0";
        const includeStats = requestUrl.searchParams.get("includeStats") !== "0";
        const offers = listOffers({ includeInactive, includeStats });
        sendJson(res, 200, { offers });
        return true;
      }

      if (req.method === "POST" || req.method === "PATCH") {
        try {
          const body = await readJsonBody();
          const actor = clipText(req.headers["x-admin-user"] || body?.updatedBy || "api-admin", 120);
          const offer = upsertOffer({
            ...(body || {}),
            updatedBy: actor,
            createdBy: body?.createdBy || actor,
          }, {
            partial: req.method === "PATCH",
          });
          sendJson(res, 200, { success: true, offer });
        } catch (err) {
          const status = Number(err?.status || 0);
          if (status === 400 || status === 413) {
            sendJson(res, status, {
              success: false,
              error: getLocalizedJsonBodyError(language, status),
            });
            return true;
          }
          sendJson(res, 400, { success: false, error: err?.message || String(err) });
        }
        return true;
      }

      if (req.method === "DELETE") {
        const code = sanitizeOfferCode(requestUrl.searchParams.get("code") || "");
        if (!code) {
          sendJson(res, 400, { success: false, error: t("code ist erforderlich.", "code is required.") });
          return true;
        }
        const deleted = deleteOffer(code);
        sendJson(res, deleted ? 200 : 404, {
          success: deleted,
          code,
          ...(deleted ? {} : { error: t("Code nicht gefunden.", "Code not found.") }),
        });
        return true;
      }

      methodNotAllowed(res, ["GET", "POST", "PATCH", "DELETE"]);
      return true;
    }

    if (requestUrl.pathname === "/api/premium/offers/active") {
      const { language, t } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }
      if (!isAdminApiRequest(req)) {
        sendUnauthorized(res, language);
        return true;
      }
      try {
        const body = await readJsonBody();
        const code = sanitizeOfferCode(body?.code || "");
        const active = body?.active !== undefined ? Boolean(body.active) : true;
        if (!code) {
          sendJson(res, 400, { success: false, error: t("code ist erforderlich.", "code is required.") });
          return true;
        }
        const offer = setOfferActive(code, active);
        if (!offer) {
          sendJson(res, 404, { success: false, error: t("Code nicht gefunden.", "Code not found.") });
          return true;
        }
        sendJson(res, 200, { success: true, offer });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, {
            success: false,
            error: getLocalizedJsonBodyError(language, status),
          });
          return true;
        }
        sendJson(res, 400, { success: false, error: err?.message || String(err) });
      }
      return true;
    }

    if (requestUrl.pathname === "/api/premium/redemptions") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      if (!isAdminApiRequest(req)) {
        sendUnauthorized(res, language);
        return true;
      }
      const limit = Number.parseInt(String(requestUrl.searchParams.get("limit") || "100"), 10);
      const redemptions = listRecentRedemptions(limit);
      sendJson(res, 200, { redemptions });
      return true;
    }

    if (requestUrl.pathname !== "/api/premium/offer") {
      return false;
    }

    const { t } = getDashboardRequestTranslator(req, requestUrl);
    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return true;
    }
    const code = sanitizeOfferCode(requestUrl.searchParams.get("code") || "");
    if (!code) {
      sendJson(res, 400, { error: t("code ist erforderlich.", "code is required.") });
      return true;
    }
    const offer = getOffer(code);
    if (!offer) {
      sendJson(res, 404, { error: t("Code nicht gefunden.", "Code not found.") });
      return true;
    }
    sendJson(res, 200, { offer });
    return true;
  };
}
