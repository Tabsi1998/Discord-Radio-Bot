export function createPremiumReadRoutesHandler(deps) {
  const {
    BRAND,
    DURATION_OPTIONS,
    PRO_TRIAL_MONTHS,
    SEAT_OPTIONS,
    TIERS,
    buildInviteUrlForRuntime,
    calculateUpgradePrice,
    durationPricingInEuro,
    getBotAccessForTier,
    getDashboardRequestTranslator,
    getDefaultLanguage,
    getLicense,
    getPricePerMonthCents,
    getTierConfig,
    isAdminApiRequest,
    isProTrialEnabled,
    languagePick,
    methodNotAllowed,
    normalizeLanguage,
    normalizeSeats,
    resolveLanguageFromAcceptLanguage,
    sanitizeLicenseForApi,
    seatPricingInEuro,
    sendJson,
  } = deps;

  return async function handlePremiumReadRoutes(context) {
    const { req, res, requestUrl, runtimes } = context;

    if (requestUrl.pathname === "/api/premium/check") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      const serverId = requestUrl.searchParams.get("serverId");
      if (!serverId || !/^\d{17,22}$/.test(serverId)) {
        sendJson(res, 400, {
          error: languagePick(language, "serverId muss 17-22 Ziffern sein.", "serverId must be 17-22 digits."),
        });
        return true;
      }

      const tierConfig = getTierConfig(serverId);
      const license = getLicense(serverId);
      const includeSensitive = isAdminApiRequest(req);
      sendJson(res, 200, {
        serverId,
        tier: tierConfig.tier,
        name: tierConfig.name,
        bitrate: tierConfig.bitrate,
        reconnectMs: tierConfig.reconnectMs,
        maxBots: tierConfig.maxBots,
        license: sanitizeLicenseForApi(license, includeSensitive),
      });
      return true;
    }

    if (requestUrl.pathname === "/api/premium/invite-links") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      const serverId = requestUrl.searchParams.get("serverId");
      if (!serverId || !/^\d{17,22}$/.test(serverId)) {
        sendJson(res, 400, {
          error: languagePick(language, "serverId muss 17-22 Ziffern sein.", "serverId must be 17-22 digits."),
        });
        return true;
      }

      const tierConfig = getTierConfig(serverId);
      const links = runtimes.map((runtime) => {
        const botTier = runtime.config.requiredTier || "free";
        const access = getBotAccessForTier(runtime.config, tierConfig);
        return {
          botId: runtime.config.id,
          name: runtime.config.name,
          index: runtime.config.index,
          role: runtime.role || "worker",
          requiredTier: botTier,
          hasAccess: access.hasAccess,
          blockedReason: access.reason,
          inviteUrl: access.hasAccess ? buildInviteUrlForRuntime(runtime) : null,
        };
      });

      sendJson(res, 200, { serverId, serverTier: tierConfig.tier, bots: links });
      return true;
    }

    if (requestUrl.pathname === "/api/premium/tiers") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      sendJson(res, 200, { tiers: TIERS });
      return true;
    }

    if (requestUrl.pathname !== "/api/premium/pricing") {
      return false;
    }

    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return true;
    }

    const pricingLanguage = normalizeLanguage(
      requestUrl.searchParams.get("lang"),
      resolveLanguageFromAcceptLanguage(req.headers["accept-language"], getDefaultLanguage())
    );
    const t = (de, en) => languagePick(pricingLanguage, de, en);
    const formatPricingValue = (cents) => (Number(cents || 0) / 100).toFixed(2);
    const serverId = requestUrl.searchParams.get("serverId");

    const result = {
      brand: BRAND.name,
      tiers: {
        free: {
          name: "Free",
          pricePerMonth: 0,
          features: [
            t("64k Bitrate", "64k bitrate"),
            t("Bis zu 2 Bots", "Up to 2 bots"),
            t("20 Free Stationen", "20 free stations"),
            t("Standard Reconnect (5s)", "Standard reconnect (5s)"),
          ],
        },
        pro: {
          name: "Pro",
          pricePerMonth: TIERS.pro.pricePerMonth,
          startingAt: formatPricingValue(getPricePerMonthCents("pro", 1)),
          durationPricing: durationPricingInEuro("pro"),
          seatPricing: seatPricingInEuro("pro"),
          features: [
            t("128k Bitrate (HQ Opus)", "128k bitrate (HQ Opus)"),
            t("Bis zu 8 Bots", "Up to 8 bots"),
            t("120 Stationen (Free + Pro)", "120 stations (free + pro)"),
            t("Priority Reconnect (1,5s)", "Priority reconnect (1.5s)"),
            t("Rollenbasierte Command-Berechtigungen", "Role-based command permissions"),
            t("Event-Scheduler", "Event scheduler"),
          ],
        },
        ultimate: {
          name: "Ultimate",
          pricePerMonth: TIERS.ultimate.pricePerMonth,
          startingAt: formatPricingValue(getPricePerMonthCents("ultimate", 1)),
          durationPricing: durationPricingInEuro("ultimate"),
          seatPricing: seatPricingInEuro("ultimate"),
          features: [
            t("320k Bitrate (Ultra HQ)", "320k bitrate (Ultra HQ)"),
            t("Bis zu 16 Bots", "Up to 16 bots"),
            t("Alle Stationen + Custom URLs", "All stations + custom URLs"),
            t("Instant Reconnect (0,4s)", "Instant reconnect (0.4s)"),
            t("Rollenbasierte Command-Berechtigungen", "Role-based command permissions"),
          ],
        },
      },
      durations: [...DURATION_OPTIONS],
      seatOptions: [...SEAT_OPTIONS],
      trial: {
        enabled: isProTrialEnabled(),
        tier: "pro",
        months: PRO_TRIAL_MONTHS,
        oneTimePerEmail: true,
      },
    };

    if (serverId && /^\d{17,22}$/.test(serverId)) {
      const license = getLicense(serverId);
      if (license && !license.expired) {
        result.currentLicense = {
          tier: license.tier || license.plan,
          seats: normalizeSeats(license.seats || 1),
          expiresAt: license.expiresAt,
          remainingDays: license.remainingDays,
        };
        if ((license.tier || license.plan) === "pro") {
          const upgrade = calculateUpgradePrice(license, "ultimate");
          if (upgrade) {
            result.upgrade = {
              to: "ultimate",
              seats: upgrade.seats,
              cost: upgrade.upgradeCost,
              daysLeft: upgrade.daysLeft,
            };
          }
        }
      }
    }

    sendJson(res, 200, result);
    return true;
  };
}
