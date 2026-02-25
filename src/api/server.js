// ============================================================
// OmniFM: Web Server & API Routes
// ============================================================
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import Stripe from "stripe";

import { log, webDir } from "../lib/logging.js";
import {
  TIERS,
  TIER_RANK,
  clipText,
  normalizeDuration,
  isValidEmailAddress,
  calculatePrice,
  calculateUpgradePrice,
  durationPricingInEuro,
  formatEuroCentsDe,
  sanitizeOfferCode,
  translateOfferReason,
  isProTrialEnabled,
  DURATION_OPTIONS,
  getPricePerMonthCents,
} from "../lib/helpers.js";
import { normalizeLanguage, getDefaultLanguage } from "../i18n.js";
import { languagePick } from "../lib/language.js";
import {
  sendJson,
  methodNotAllowed,
  sendStaticFile,
  applyCors,
  isAdminApiRequest,
  sanitizeLicenseForApi,
  API_COMMANDS,
  getBotAccessForTier,
  resolveRuntimeClientId,
  buildInviteUrlForRuntime,
  resolvePublicWebsiteUrl,
  buildInviteOverviewForTier,
  getStripeSecretKey,
  resolveCheckoutReturnBase,
  getConfiguredPublicOrigin,
  toOrigin,
  enforceApiRateLimit,
  getClientIp,
} from "../lib/api-helpers.js";
import { loadStations } from "../stations-store.js";
import { getTier, checkFeatureAccess } from "../core/entitlements.js";
import {
  getServerLicense,
  getLicenseById,
  linkServerToLicense,
  unlinkServerFromLicense,
  listLicensesByContactEmail,
  isSessionProcessed,
  isEventProcessed,
  markEventProcessed,
} from "../premium-store.js";
import {
  resolveCheckoutOfferForRequest,
  activatePaidStripeSession,
  activateProTrial,
} from "../services/payment.js";
import { PLANS, BRAND } from "../config/plans.js";

function startWebServer(runtimes) {
  const webInternalPort = Number(process.env.WEB_INTERNAL_PORT || "8080");
  const webPort = Number(process.env.WEB_PORT || "8081");
  const webBind = process.env.WEB_BIND || "0.0.0.0";
  const publicUrl = String(process.env.PUBLIC_WEB_URL || "").trim();

  const server = http.createServer(async (req, res) => {
    let requestUrl;
    try {
      requestUrl = new URL(req.url || "/", "http://localhost");
    } catch {
      sendJson(res, 400, { error: "Ungueltige Request-URL." });
      return;
    }

    // CORS
    const originAllowed = applyCors(req, res, publicUrl);
    if (req.method === "OPTIONS") {
      if (!originAllowed) {
        sendJson(res, 403, { error: "Origin nicht erlaubt." });
        return;
      }
      res.writeHead(204, { ...getCommonSecurityHeaders() });
      res.end();
      return;
    }
    if (!originAllowed) {
      sendJson(res, 403, { error: "Origin nicht erlaubt." });
      return;
    }

    if (!enforceApiRateLimit(req, res, requestUrl.pathname)) {
      return;
    }

    // --- Helper to read request body ---
    function readRawBody(maxBytes = 1024 * 1024) {
      return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;

        const fail = (status, message, err = null) => {
          if (settled) return;
          settled = true;
          const error = err || new Error(message);
          error.status = status;
          reject(error);
        };

        req.on("data", (chunk) => {
          if (settled) return;
          size += chunk.length;
          if (size > maxBytes) {
            fail(413, "Body too large");
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (settled) return;
          settled = true;
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
        req.on("error", (err) => fail(400, err?.message || "Body read error", err));
      });
    }

    async function readJsonBody() {
      const raw = await readRawBody();
      if (!raw.trim()) return {};
      try {
        return JSON.parse(raw);
      } catch {
        const err = new Error("Invalid JSON");
        err.status = 400;
        throw err;
      }
    }

    // --- API routes ---
    if (requestUrl.pathname === "/api/bots") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const bots = runtimes.map((runtime) => runtime.getPublicStatus());
      const totals = bots.reduce(
        (acc, bot) => {
          acc.servers += Number(bot.servers) || 0;
          acc.users += Number(bot.users) || 0;
          acc.connections += Number(bot.connections) || 0;
          acc.listeners += Number(bot.listeners) || 0;
          return acc;
        },
        { servers: 0, users: 0, connections: 0, listeners: 0 }
      );

      sendJson(res, 200, { bots, totals });
      return;
    }

    if (requestUrl.pathname === "/api/commands") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      sendJson(res, 200, { commands: API_COMMANDS });
      return;
    }

    if (requestUrl.pathname === "/api/stats") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const bots = runtimes.map((runtime) => runtime.getPublicStatus());
      const totals = bots.reduce(
        (acc, bot) => {
          acc.servers += Number(bot.servers) || 0;
          acc.users += Number(bot.users) || 0;
          acc.connections += Number(bot.connections) || 0;
          acc.listeners += Number(bot.listeners) || 0;
          return acc;
        },
        { servers: 0, users: 0, connections: 0, listeners: 0 }
      );
      const stationCount = Object.keys(loadStations().stations).length;
      sendJson(res, 200, {
        ...totals,
        bots: runtimes.length,
        stations: stationCount,
      });
      return;
    }

    if (requestUrl.pathname === "/api/stations") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const stations = loadStations();
      const stationArr = Object.entries(stations.stations).map(([key, value]) => ({
        key,
        name: value.name,
        url: value.url,
        tier: value.tier || "free",
      }));
      // Sort: free first, then pro, then ultimate
      const tierOrder = { free: 0, pro: 1, ultimate: 2 };
      stationArr.sort((a, b) => (tierOrder[a.tier] || 0) - (tierOrder[b.tier] || 0) || a.name.localeCompare(b.name));
      sendJson(res, 200, {
        defaultStationKey: stations.defaultStationKey,
        qualityPreset: stations.qualityPreset,
        total: stationArr.length,
        stations: stationArr,
      });
      return;
    }

    if (requestUrl.pathname === "/api/health") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const readyBots = runtimes.filter((runtime) => runtime.client.isReady()).length;
      sendJson(res, 200, {
        ok: true,
        uptimeSec: Math.floor((Date.now() - appStartTime) / 1000),
        bots: runtimes.length,
        readyBots
      });
      return;
    }

    // --- Premium API ---
    if (requestUrl.pathname === "/api/premium/check") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const serverId = requestUrl.searchParams.get("serverId");
      if (!serverId || !/^\d{17,22}$/.test(serverId)) {
        sendJson(res, 400, { error: "serverId muss 17-22 Ziffern sein." });
        return;
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
      return;
    }

    // Premium Bot Invite-Links: nur fuer berechtigte Server
    if (requestUrl.pathname === "/api/premium/invite-links") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const serverId = requestUrl.searchParams.get("serverId");
      if (!serverId || !/^\d{17,22}$/.test(serverId)) {
        sendJson(res, 400, { error: "serverId muss 17-22 Ziffern sein." });
        return;
      }
      const tierConfig = getTierConfig(serverId);
      const links = runtimes.map((rt) => {
        const botTier = rt.config.requiredTier || "free";
        const access = getBotAccessForTier(rt.config, tierConfig);
        return {
          botId: rt.config.id,
          name: rt.config.name,
          index: rt.config.index,
          requiredTier: botTier,
          hasAccess: access.hasAccess,
          blockedReason: access.reason,
          inviteUrl: access.hasAccess ? buildInviteUrlForRuntime(rt) : null,
        };
      });

      sendJson(res, 200, { serverId, serverTier: tierConfig.tier, bots: links });
      return;
    }

    if (requestUrl.pathname === "/api/premium/tiers") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      sendJson(res, 200, { tiers: TIERS });
      return;
    }

    if (requestUrl.pathname === "/api/premium/trial") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
      try {
        const body = await readJsonBody();
        const { email, language: rawLanguage } = body;
        const acceptLanguage = req.headers["accept-language"];
        const trialLanguage = normalizeLanguage(
          rawLanguage,
          resolveLanguageFromAcceptLanguage(acceptLanguage, getDefaultLanguage())
        );
        const t = (de, en) => (trialLanguage === "de" ? de : en);

        if (!isProTrialEnabled()) {
          sendJson(res, 403, {
            success: false,
            message: t(
              "Der Pro-Testmonat ist aktuell deaktiviert.",
              "The Pro trial month is currently disabled."
            ),
          });
          return;
        }

        if (!isValidEmailAddress(email)) {
          sendJson(res, 400, {
            success: false,
            message: t(
              "Bitte eine gueltige E-Mail-Adresse eingeben.",
              "Please enter a valid email address."
            ),
          });
          return;
        }

        const result = await activateProTrial({
          email,
          language: trialLanguage,
          runtimes,
          source: "api:trial",
        });
        if (!result.success) {
          sendJson(res, result.status || 400, {
            success: false,
            message: result.message,
          });
          return;
        }

        sendJson(res, 200, {
          success: true,
          email: result.email,
          tier: result.tier,
          licenseKey: result.licenseKey,
          expiresAt: result.expiresAt,
          seats: result.seats,
          months: result.months,
          message: result.message,
          emailStatus: result.emailStatus,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          const fallbackLanguage = resolveLanguageFromAcceptLanguage(req.headers["accept-language"], getDefaultLanguage());
          sendJson(res, status, {
            success: false,
            message: fallbackLanguage === "de"
              ? status === 413
                ? "Request-Body ist zu gross."
                : "Ungueltiges JSON im Request-Body."
              : status === 413
                ? "Request body is too large."
                : "Invalid JSON in request body.",
          });
          return;
        }
        log("ERROR", `Pro trial activation error: ${err.message}`);
        const fallbackLanguage = resolveLanguageFromAcceptLanguage(req.headers["accept-language"], getDefaultLanguage());
        sendJson(res, 500, {
          success: false,
          message: fallbackLanguage === "de"
            ? "Der Pro-Testmonat konnte nicht aktiviert werden."
            : "Could not activate the Pro trial month.",
        });
      }
      return;
    }

    if (requestUrl.pathname === "/api/premium/checkout") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
      try {
        const body = await readJsonBody();
        const {
          tier,
          email,
          months,
          seats: rawSeats,
          returnUrl,
          language: rawLanguage,
          couponCode: rawCouponCode,
          referralCode: rawReferralCode,
        } = body;
        const acceptLanguage = req.headers["accept-language"];
        const checkoutLanguage = normalizeLanguage(
          rawLanguage,
          resolveLanguageFromAcceptLanguage(acceptLanguage, getDefaultLanguage())
        );
        const isDe = checkoutLanguage === "de";
        const t = (de, en) => (isDe ? de : en);
        if (!tier || !email) {
          sendJson(res, 400, { error: t("tier und email erforderlich.", "tier and email are required.") });
          return;
        }
        if (!isValidEmailAddress(email)) {
          sendJson(res, 400, { error: t("Bitte eine gueltige E-Mail-Adresse eingeben.", "Please enter a valid email address.") });
          return;
        }
        if (tier !== "pro" && tier !== "ultimate") {
          sendJson(res, 400, { error: t("tier muss 'pro' oder 'ultimate' sein.", "tier must be 'pro' or 'ultimate'.") });
          return;
        }

        const durationMonths = normalizeDuration(months);

        const stripeKey = getStripeSecretKey();
        if (!stripeKey) {
          sendJson(res, 503, { error: t("Stripe nicht konfiguriert. Nutze: ./update.sh --stripe", "Stripe is not configured. Use: ./update.sh --stripe") });
          return;
        }

        const basePriceInCents = calculatePrice(tier, durationMonths);
        if (basePriceInCents <= 0) {
          sendJson(res, 400, { error: t("Ungueltige Preisberechnung fuer die gewaehlte Kombination.", "Invalid price calculation for the selected combination.") });
          return;
        }
        const offerResolution = resolveCheckoutOfferForRequest({
          tier,
          seats,
          months: durationMonths,
          email: email.trim().toLowerCase(),
          couponCode: rawCouponCode,
          referralCode: rawReferralCode,
          baseAmountCents: basePriceInCents,
          language: checkoutLanguage,
        });
        if (!offerResolution.ok) {
          sendJson(res, offerResolution.status || 400, {
            error: offerResolution.error || t("Rabattcode konnte nicht angewendet werden.", "Could not apply discount code."),
            discount: offerResolution.preview || null,
          });
          return;
        }
        const offerPreview = offerResolution.preview;
        const priceInCents = Math.max(0, Number(offerPreview?.finalAmountCents || basePriceInCents));
        const discountCents = Math.max(0, Number(offerPreview?.discountCents || 0));
        const appliedOfferCode = sanitizeOfferCode(offerPreview?.applied?.code);
        const appliedOfferKind = String(offerPreview?.applied?.kind || "").trim().toLowerCase();
        const referralCode = sanitizeOfferCode(offerPreview?.attributionReferralCode || "");
        if (priceInCents <= 0) {
          sendJson(res, 400, { error: t("Preis ist nach Rabatt ungueltig.", "Price is invalid after discount.") });
          return;
        }
        const tierName = TIERS[tier].name;
        const seats = 1;
        let description;
        if (durationMonths >= 12) {
          description = isDe
            ? `${tierName} - ${durationMonths} Monate`
            : `${tierName} - ${durationMonths} months`;
        } else {
          description = isDe
            ? `${tierName} - ${durationMonths} Monat${durationMonths > 1 ? "e" : ""}`
            : `${tierName} - ${durationMonths} month${durationMonths > 1 ? "s" : ""}`;
        }

        const stripe = await import("stripe");
        const stripeClient = new stripe.default(stripeKey);

        const session = await stripeClient.checkout.sessions.create({
          payment_method_types: ["card"],
          mode: "payment",
          customer_email: email.trim().toLowerCase(),
          line_items: [{
            price_data: {
              currency: "eur",
              product_data: {
                name: `${BRAND.name} ${TIERS[tier].name}`,
                description,
              },
              unit_amount: priceInCents,
            },
            quantity: 1,
          }],
          metadata: {
            email: email.trim().toLowerCase(),
            tier,
            seats: String(seats),
            months: String(durationMonths),
            language: checkoutLanguage,
            isUpgrade: "false",
            checkoutCreatedAt: new Date().toISOString(),
            couponCode: offerResolution.couponCode || "",
            referralCode: referralCode || "",
            appliedOfferCode: appliedOfferCode || "",
            appliedOfferKind: appliedOfferKind || "",
            offerOwnerLabel: String(offerPreview?.applied?.ownerLabel || ""),
            baseAmountCents: String(basePriceInCents),
            discountCents: String(discountCents),
            finalAmountCents: String(priceInCents),
          },
          success_url: resolveCheckoutReturnBase(returnUrl, publicUrl, req) + "?payment=success&session_id={CHECKOUT_SESSION_ID}",
          cancel_url: resolveCheckoutReturnBase(returnUrl, publicUrl, req) + "?payment=cancelled",
        });

        sendJson(res, 200, {
          sessionId: session.id,
          url: session.url,
          pricing: {
            baseAmountCents: basePriceInCents,
            discountCents,
            finalAmountCents: priceInCents,
          },
          discount: offerPreview,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          const fallbackLanguage = resolveLanguageFromAcceptLanguage(req.headers["accept-language"], getDefaultLanguage());
          sendJson(res, status, {
            error: fallbackLanguage === "de"
              ? status === 413
                ? "Request-Body ist zu gross."
                : "Ungueltiges JSON im Request-Body."
              : status === 413
                ? "Request body is too large."
                : "Invalid JSON in request body.",
          });
          return;
        }
        log("ERROR", `Stripe checkout error: ${err.message}`);
        const fallbackLanguage = resolveLanguageFromAcceptLanguage(req.headers["accept-language"], getDefaultLanguage());
        sendJson(res, 500, {
          error: fallbackLanguage === "de"
            ? "Checkout fehlgeschlagen: " + err.message
            : "Checkout failed: " + err.message,
        });
      }
      return;
    }

    if (requestUrl.pathname === "/api/premium/offer/preview") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
      try {
        const body = await readJsonBody();
        const {
          tier,
          email,
          months,
          seats: rawSeats,
          couponCode,
          referralCode,
          language: rawLanguage,
        } = body || {};
        const acceptLanguage = req.headers["accept-language"];
        const previewLanguage = normalizeLanguage(
          rawLanguage,
          resolveLanguageFromAcceptLanguage(acceptLanguage, getDefaultLanguage())
        );
        const isDe = previewLanguage === "de";
        const t = (de, en) => (isDe ? de : en);

        const cleanTier = String(tier || "").trim().toLowerCase();
        if (!["pro", "ultimate"].includes(cleanTier)) {
          sendJson(res, 400, { success: false, error: t("tier muss 'pro' oder 'ultimate' sein.", "tier must be 'pro' or 'ultimate'.") });
          return;
        }

        const durationMonths = Math.max(1, parseInt(months, 10) || 1);
        const seats = normalizeSeats(rawSeats);
        const baseAmountCents = calculatePrice(cleanTier, durationMonths, seats);
        if (baseAmountCents <= 0) {
          sendJson(res, 400, {
            success: false,
            error: t("Ungueltige Preisberechnung fuer die gewaehlte Kombination.", "Invalid price calculation for the selected combination."),
          });
          return;
        }

        const resolved = resolveCheckoutOfferForRequest({
          tier: cleanTier,
          seats,
          months: durationMonths,
          email: String(email || "").trim().toLowerCase(),
          couponCode,
          referralCode,
          baseAmountCents,
          language: previewLanguage,
        });

        if (!resolved.ok) {
          sendJson(res, resolved.status || 400, {
            success: false,
            error: resolved.error,
            discount: resolved.preview || null,
          });
          return;
        }

        sendJson(res, 200, {
          success: true,
          discount: resolved.preview,
          pricing: {
            baseAmountCents,
            discountCents: resolved.preview?.discountCents || 0,
            finalAmountCents: resolved.preview?.finalAmountCents || baseAmountCents,
          },
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, {
            success: false,
            error: status === 413 ? "Request-Body ist zu gross." : "Ungueltiges JSON im Request-Body.",
          });
          return;
        }
        log("ERROR", `Offer preview error: ${err.message}`);
        sendJson(res, 500, { success: false, error: "Offer-Vorschau fehlgeschlagen: " + err.message });
      }
      return;
    }

    if (requestUrl.pathname === "/api/premium/offers") {
      if (!isAdminApiRequest(req)) {
        sendJson(res, 401, { error: "Unauthorized. API admin token required." });
        return;
      }

      if (req.method === "GET") {
        const includeInactive = requestUrl.searchParams.get("includeInactive") !== "0";
        const includeStats = requestUrl.searchParams.get("includeStats") !== "0";
        const offers = listOffers({ includeInactive, includeStats });
        sendJson(res, 200, { offers });
        return;
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
          sendJson(res, 400, { success: false, error: err?.message || String(err) });
        }
        return;
      }

      if (req.method === "DELETE") {
        const code = sanitizeOfferCode(requestUrl.searchParams.get("code") || "");
        if (!code) {
          sendJson(res, 400, { success: false, error: "code ist erforderlich." });
          return;
        }
        const deleted = deleteOffer(code);
        sendJson(res, deleted ? 200 : 404, { success: deleted, code });
        return;
      }

      methodNotAllowed(res, ["GET", "POST", "PATCH", "DELETE"]);
      return;
    }

    if (requestUrl.pathname === "/api/premium/offers/active") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
      if (!isAdminApiRequest(req)) {
        sendJson(res, 401, { error: "Unauthorized. API admin token required." });
        return;
      }
      try {
        const body = await readJsonBody();
        const code = sanitizeOfferCode(body?.code || "");
        const active = body?.active !== undefined ? Boolean(body.active) : true;
        if (!code) {
          sendJson(res, 400, { success: false, error: "code ist erforderlich." });
          return;
        }
        const offer = setOfferActive(code, active);
        if (!offer) {
          sendJson(res, 404, { success: false, error: "Code nicht gefunden." });
          return;
        }
        sendJson(res, 200, { success: true, offer });
      } catch (err) {
        sendJson(res, 400, { success: false, error: err?.message || String(err) });
      }
      return;
    }

    if (requestUrl.pathname === "/api/premium/redemptions") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      if (!isAdminApiRequest(req)) {
        sendJson(res, 401, { error: "Unauthorized. API admin token required." });
        return;
      }
      const limit = Number.parseInt(String(requestUrl.searchParams.get("limit") || "100"), 10);
      const redemptions = listRecentRedemptions(limit);
      sendJson(res, 200, { redemptions });
      return;
    }

    if (requestUrl.pathname === "/api/premium/offer") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const code = sanitizeOfferCode(requestUrl.searchParams.get("code") || "");
      if (!code) {
        sendJson(res, 400, { error: "code ist erforderlich." });
        return;
      }
      const offer = getOffer(code);
      if (!offer) {
        sendJson(res, 404, { error: "Code nicht gefunden." });
        return;
      }
      sendJson(res, 200, { offer });
      return;
    }

    if (requestUrl.pathname === "/api/premium/webhook") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
      try {
        const stripeKey = getStripeSecretKey();
        const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
        if (!stripeKey || !webhookSecret) {
          sendJson(res, 503, { error: "Stripe Webhook nicht konfiguriert." });
          return;
        }

        const signatureHeader = req.headers["stripe-signature"];
        const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
        if (!signature) {
          sendJson(res, 400, { error: "Stripe-Signatur fehlt." });
          return;
        }

        const rawBody = await readRawBody(2 * 1024 * 1024);
        const stripe = await import("stripe");
        const stripeClient = new stripe.default(stripeKey);

        let event;
        try {
          event = stripeClient.webhooks.constructEvent(rawBody, signature, webhookSecret);
        } catch (err) {
          sendJson(res, 400, { error: `Webhook-Signatur ungueltig: ${err.message}` });
          return;
        }

        if (!event?.id) {
          sendJson(res, 400, { error: "Webhook-Event ungueltig." });
          return;
        }

        if (isEventProcessed(event.id)) {
          sendJson(res, 200, { received: true, duplicate: true });
          return;
        }

        if (webhookEventsInFlight.has(event.id)) {
          sendJson(res, 200, { received: true, duplicate: true, inFlight: true });
          return;
        }
        webhookEventsInFlight.add(event.id);

        try {
          if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
            const result = await activatePaidStripeSession(event.data.object, runtimes, `webhook:${event.type}`);
            if (!result.success) {
              log("ERROR", `Webhook-Aktivierung fehlgeschlagen (event=${event.id}, type=${event.type}): ${result.message}`);
              sendJson(res, 500, {
                received: true,
                processed: false,
                replay: !!result.replay,
                message: result.message,
              });
              return;
            }

            markEventProcessed(event.id, {
              type: event.type,
              sessionId: event.data?.object?.id || null,
              success: true,
            });
            sendJson(res, 200, {
              received: true,
              processed: true,
              replay: !!result.replay,
              message: result.message,
            });
            return;
          }

          markEventProcessed(event.id, { type: event.type, ignored: true });
          sendJson(res, 200, { received: true, ignored: true });
        } finally {
          webhookEventsInFlight.delete(event.id);
        }
      } catch (err) {
        if (Number(err?.status || 0) === 413) {
          sendJson(res, 413, { error: "Webhook-Body ist zu gross." });
          return;
        }
        log("ERROR", `Stripe webhook error: ${err.message}`);
        sendJson(res, 500, { error: "Webhook-Verarbeitung fehlgeschlagen: " + err.message });
      }
      return;
    }

    if (requestUrl.pathname === "/api/premium/verify") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
      try {
        const body = await readJsonBody();
        const { sessionId } = body;
        if (!sessionId) {
          sendJson(res, 400, { error: "sessionId erforderlich." });
          return;
        }

        const stripeKey = getStripeSecretKey();
        if (!stripeKey) {
          sendJson(res, 503, { error: "Stripe nicht konfiguriert." });
          return;
        }

        const normalizedSessionId = String(sessionId).trim();
        if (isSessionProcessed(normalizedSessionId)) {
          const stripe = await import("stripe");
          const stripeClient = new stripe.default(stripeKey);
          const replaySession = await stripeClient.checkout.sessions.retrieve(normalizedSessionId);
          const replayResult = await activatePaidStripeSession(replaySession, runtimes, "verify:replay");
          sendJson(res, 200, {
            success: true,
            replay: true,
            email: replayResult.email || null,
            licenseKey: replayResult.licenseKey || null,
            tier: replayResult.tier || null,
            discountCents: replayResult.discountCents || 0,
            appliedOfferCode: replayResult.appliedOfferCode || null,
            appliedOfferKind: replayResult.appliedOfferKind || null,
            referralCode: replayResult.referralCode || null,
            message: replayResult.message,
          });
          return;
        }

        const stripe = await import("stripe");
        const stripeClient = new stripe.default(stripeKey);
        const session = await stripeClient.checkout.sessions.retrieve(normalizedSessionId);
        const result = await activatePaidStripeSession(session, runtimes, "verify");
        if (!result.success) {
          sendJson(res, result.status || 400, { success: false, message: result.message });
          return;
        }

        sendJson(res, 200, {
          success: true,
          replay: !!result.replay,
          email: result.email,
          licenseKey: result.licenseKey,
          tier: result.tier,
          expiresAt: result.expiresAt,
          seats: result.seats,
           discountCents: result.discountCents || 0,
           appliedOfferCode: result.appliedOfferCode || null,
           appliedOfferKind: result.appliedOfferKind || null,
           referralCode: result.referralCode || null,
          message: result.message,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, {
            error: status === 413
              ? "Request-Body ist zu gross."
              : "Ungueltiges JSON im Request-Body.",
          });
          return;
        }
        log("ERROR", `Stripe verify error: ${err.message}`);
        sendJson(res, 500, { error: "Verifizierung fehlgeschlagen: " + err.message });
      }
      return;
    }

    // --- Pricing info endpoint ---
    if (requestUrl.pathname === "/api/premium/pricing") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const serverId = requestUrl.searchParams.get("serverId");
      const result = {
        brand: BRAND.name,
        tiers: {
          free: {
            name: "Free",
            pricePerMonth: 0,
            features: [
              "64k Bitrate",
              "Bis zu 2 Bots",
              "20 Free Stationen",
              "Standard Reconnect (5s)",
            ]
          },
          pro: {
            name: "Pro",
            pricePerMonth: TIERS.pro.pricePerMonth,
            startingAt: formatEuroCentsDe(getSeatPricePerMonthCents("pro", 1)),
            seatPricing: seatPricingInEuro("pro"),
            features: [
              "128k Bitrate (HQ Opus)",
              "Bis zu 8 Bots",
              "120 Stationen (Free + Pro)",
              "Priority Reconnect (1,5s)",
              "Server-Lizenz (1/2/3/5 Server)",
              "Rollenbasierte Command-Berechtigungen",
            ]
          },
          ultimate: {
            name: "Ultimate",
            pricePerMonth: TIERS.ultimate.pricePerMonth,
            startingAt: formatEuroCentsDe(getSeatPricePerMonthCents("ultimate", 1)),
            seatPricing: seatPricingInEuro("ultimate"),
            features: [
              "320k Bitrate (Ultra HQ)",
              "Bis zu 16 Bots",
              "Alle Stationen + Custom URLs",
              "Instant Reconnect (0,4s)",
              "Server-Lizenz Bundles",
              "Rollenbasierte Command-Berechtigungen",
            ]
          },
        },
        yearlyDiscount: "12 Monate = 10 bezahlen (2 Monate gratis)",
        seatOptions: [...SEAT_OPTIONS],
        trial: {
          enabled: isProTrialEnabled(),
          tier: "pro",
          months: PRO_TRIAL_MONTHS,
          seats: PRO_TRIAL_SEATS,
          oneTimePerEmail: true,
        },
      };

      if (serverId && /^\d{17,22}$/.test(serverId)) {
        const license = getLicense(serverId);
        if (license && !license.expired) {
          result.currentLicense = {
            tier: license.tier || license.plan,
            expiresAt: license.expiresAt,
            remainingDays: license.remainingDays,
          };
          if ((license.tier || license.plan) === "pro") {
            const upgrade = calculateUpgradePrice(serverId, "ultimate");
            if (upgrade) {
              result.upgrade = {
                to: "ultimate",
                cost: upgrade.upgradeCost,
                daysLeft: upgrade.daysLeft,
              };
            }
          }
        }
      }

      sendJson(res, 200, result);
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "API route not found." });
      return;
    }

    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return;
    }

    // --- Static file serving from web/ ---
    const staticPath = requestUrl.pathname === "/"
      ? "index.html"
      : requestUrl.pathname.replace(/^\/+/, "");
    const filePath = path.join(webDir, staticPath);
    sendStaticFile(res, filePath);
  });

  server.listen(webInternalPort, webBind, () => {
    log("INFO", `Webseite aktiv (container) auf http://${webBind}:${webInternalPort}`);
    log("INFO", `Webseite Host-Port: ${webPort}`);
    if (publicUrl) {
      log("INFO", `Public URL: ${publicUrl}`);
    }
  });

  return server;
}

export { startWebServer };
