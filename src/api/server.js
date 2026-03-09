// ============================================================
// OmniFM: Web Server & API Routes
// ============================================================
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { createDashboardChannelsRouteHandler } from "./routes/dashboard-channels.js";
import { createDashboardEventsRouteHandler } from "./routes/dashboard-events.js";
import { createDashboardLicenseRouteHandler } from "./routes/dashboard-license.js";
import { createDashboardPermsRouteHandler } from "./routes/dashboard-perms.js";
import { createDashboardRolesRouteHandler } from "./routes/dashboard-roles.js";
import { createDashboardSettingsRouteHandler } from "./routes/dashboard-settings.js";
import { createDashboardStatsRouteHandler } from "./routes/dashboard-stats.js";

import { log, webDir, webRootSource, frontendBuildStamp, rootDir } from "../lib/logging.js";
import {
  TIERS,
  TIER_RANK,
  clipText,
  normalizeDuration,
  normalizeSeats,
  isValidEmailAddress,
  calculatePrice,
  calculateUpgradePrice,
  durationPricingInEuro,
  seatPricingInEuro,
  sanitizeOfferCode,
  translateOfferReason,
  isProTrialEnabled,
  PRO_TRIAL_MONTHS,
  DURATION_OPTIONS,
  SEAT_OPTIONS,
  getPricePerMonthCents,
} from "../lib/helpers.js";
import { normalizeLanguage, getDefaultLanguage, resolveLanguageFromAcceptLanguage } from "../i18n.js";
import {
  languagePick,
  translateCustomStationErrorMessage,
  translatePermissionStoreMessage,
  translateScheduledEventStoreMessage,
} from "../lib/language.js";
import { resolveRequestLanguage } from "../lib/request-language.js";
import {
  EVENT_FALLBACK_TIME_ZONE,
  getZonedPartsFromUtcMs,
  normalizeEventTimeZone,
  normalizeRepeatMode,
  getRepeatLabel,
  isWorkdayInTimeZone,
  computeNextEventRunAtMs,
} from "../lib/event-time.js";
import {
  getCommonSecurityHeaders,
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
import {
  buildWeeklyDigestEmbedData,
  buildWeeklyDigestMeta,
  buildWeeklyDigestPreview,
  normalizeWeeklyDigestConfig,
} from "../lib/weekly-digest.js";
import {
  DEFAULT_DASHBOARD_EXPORTS_WEBHOOK_CONFIG,
  normalizeDashboardExportsWebhookConfig,
  validateDashboardExportsWebhookConfig,
  shouldDeliverDashboardWebhook,
  buildDashboardWebhookPayload,
  deliverDashboardWebhook,
} from "../lib/dashboard-webhooks.js";
import {
  getPrimaryFailoverStation,
  normalizeFailoverChain,
} from "../lib/failover-chain.js";
import { loadStations, filterStationsByTier } from "../stations-store.js";
import { buildPublicStationCatalog } from "../lib/public-stations.js";
import {
  getGuildStations as getCustomStations,
  addGuildStation as addCustomStation,
  updateGuildStation as updateCustomStation,
  removeGuildStation as removeCustomStation,
} from "../custom-stations.js";
import {
  getTier,
  checkFeatureAccess,
  getServerPlanConfig,
  getServerCapabilities,
  getPlanLimits,
  getServerSeats,
  serverHasCapability,
  buildUpgradeHints,
} from "../core/entitlements.js";
import {
  getServerLicense,
  getLicenseById,
  linkServerToLicense,
  unlinkServerFromLicense,
  listLicensesByContactEmail,
  listProcessedSessionsByEmail,
  updateLicenseContactEmail,
  isSessionProcessed,
  isEventProcessed,
  markEventProcessed,
  getTrialClaimByEmail,
} from "../premium-store.js";
import {
  resolveCheckoutOfferForRequest,
  activatePaidStripeSession,
  activateProTrial,
} from "../services/payment.js";
import {
  listOffers,
  upsertOffer,
  deleteOffer,
  setOfferActive,
  listRecentRedemptions,
  getOffer,
  getRedemptionBySession,
} from "../coupon-store.js";
import { PLANS, BRAND, CAPABILITY_KEYS } from "../config/plans.js";
import {
  getDashboardTelemetry,
  setDashboardTelemetry,
  setDashboardOauthState,
  popDashboardOauthState,
  setDashboardAuthSession,
  getDashboardAuthSession,
  deleteDashboardAuthSession,
  cleanupDashboardAuthState,
} from "../dashboard-store.js";
import { getDb } from "../lib/db.js";
import {
  getSupportedPermissionCommands,
  getGuildCommandPermissionRules,
  setCommandRolePermission,
  resetCommandPermissions,
} from "../command-permissions-store.js";
import {
  listScheduledEvents,
  createScheduledEvent,
  patchScheduledEvent,
  deleteScheduledEvent,
  getScheduledEvent,
} from "../scheduled-events-store.js";
import {
  getGuildListeningStats,
  getGuildDailyStats,
  getGuildSessionHistory,
  getGuildConnectionHealth,
  getGuildListenerTimeline,
  getGlobalStats,
  getActiveSessionsForGuild,
  resetGuildStats,
} from "../listening-stats-store.js";
import {
  getDiscordBotListStatus,
  handleDiscordBotListVoteWebhook,
  syncDiscordBotListCommands,
  syncDiscordBotListStats,
  syncDiscordBotListVotes,
} from "../services/discordbotlist.js";

const appStartTime = Date.now();
const webhookEventsInFlight = new Set();
let binaryHealthCache = null;

function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

function getLicense(guildId) {
  return getServerLicense(guildId);
}

function maskDashboardEmail(rawEmail) {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!isValidEmailAddress(email)) return "";
  const [localPart = "", domain = ""] = email.split("@");
  const visible = localPart.slice(0, Math.min(2, localPart.length));
  const maskedLocal = localPart.length > 2 ? `${visible}***` : `${visible}***`;
  return `${maskedLocal}@${domain}`;
}

function buildDashboardUpgradePreview(currentLicense, targetTier, seatCount) {
  const normalizedTier = String(targetTier || "").trim().toLowerCase();
  if (!["pro", "ultimate"].includes(normalizedTier)) return null;

  const seats = Math.max(1, Number(seatCount || 1) || 1);
  const targetLimits = getPlanLimits(normalizedTier);
  const upgradeCost = currentLicense ? calculateUpgradePrice(currentLicense, normalizedTier) : null;

  return {
    tier: normalizedTier,
    tierName: normalizedTier === "ultimate" ? "Ultimate" : "Pro",
    seats,
    limits: targetLimits,
    pricing: {
      monthlyCents: calculatePrice(normalizedTier, 1, seats),
      quarterlyCents: calculatePrice(normalizedTier, 3, seats),
      yearlyCents: calculatePrice(normalizedTier, 12, seats),
    },
    upgradeCostCents: Number(upgradeCost?.upgradeCost || 0) || 0,
    daysLeft: Number(upgradeCost?.daysLeft || 0) || 0,
  };
}

function buildDashboardLicensePayload(guildInfo) {
  const license = getLicense(guildInfo.id);
  const capabilityPayload = buildServerCapabilityPayload(guildInfo.id);
  const effectiveTier = String(license?.plan || guildInfo.tier || "free").trim().toLowerCase();
  const currentLimits = getPlanLimits(effectiveTier);
  const seats = Math.max(1, Number(license?.seats || capabilityPayload?.limits?.seats || 1) || 1);
  const nextUpgradeTier = String(capabilityPayload?.upgradeHints?.nextTier || "").trim().toLowerCase();
  const licenseEmail = String(license?.contactEmail || license?.email || "").trim().toLowerCase();
  const hasBillingEmail = isValidEmailAddress(licenseEmail);
  const linkedServers = Array.isArray(license?.linkedServerIds) ? license.linkedServerIds : [];

  return {
    serverId: guildInfo.id,
    tier: guildInfo.tier,
    effectiveTier,
    tierName: effectiveTier === "ultimate" ? "Ultimate" : effectiveTier === "pro" ? "Pro" : "Free",
    capabilities: capabilityPayload.capabilities,
    limits: capabilityPayload.limits,
    upgradeHints: capabilityPayload.upgradeHints,
    dashboardEnabled: capabilityPayload.capabilities.dashboardAccess === true,
    ultimateEnabled: capabilityPayload.capabilities.advancedAnalytics === true
      || capabilityPayload.capabilities.customStationUrls === true
      || capabilityPayload.capabilities.failoverRules === true,
    currentPlan: {
      tier: effectiveTier,
      tierName: effectiveTier === "ultimate" ? "Ultimate" : effectiveTier === "pro" ? "Pro" : "Free",
      limits: currentLimits,
      pricing: effectiveTier === "free"
        ? null
        : {
          monthlyCents: calculatePrice(effectiveTier, 1, seats),
          quarterlyCents: calculatePrice(effectiveTier, 3, seats),
          yearlyCents: calculatePrice(effectiveTier, 12, seats),
        },
    },
    recommendedUpgrade: nextUpgradeTier
      ? buildDashboardUpgradePreview(license, nextUpgradeTier, seats)
      : null,
    promotions: {
      couponCodesSupported: true,
      proTrialEnabled: isProTrialEnabled(),
      proTrialMonths: PRO_TRIAL_MONTHS,
      trialOnlyForNewCustomers: true,
    },
    activity: buildDashboardLicenseActivity(license),
    license: license ? {
      plan: license.plan || license.tier || "free",
      seats,
      seatsUsed: linkedServers.length,
      seatsAvailable: Math.max(0, seats - linkedServers.length),
      active: Boolean(license.active) && !Boolean(license.expired),
      expired: Boolean(license.expired),
      expiresAt: license.expiresAt || null,
      remainingDays: Number.isFinite(license.remainingDays) ? license.remainingDays : 0,
      billingPeriod: license.billingPeriod || "monthly",
      durationMonths: license.durationMonths || null,
      emailMasked: maskDashboardEmail(licenseEmail),
      hasBillingEmail,
      canUpdateEmail: true,
      updatedAt: license.updatedAt || null,
      contactEmailDomain: hasBillingEmail ? licenseEmail.split("@")[1] : "",
    } : null,
  };
}

function buildDashboardLicenseActivity(license) {
  const licenseEmail = String(license?.contactEmail || license?.email || "").trim().toLowerCase();
  const hasBillingEmail = isValidEmailAddress(licenseEmail);
  if (!hasBillingEmail) {
    return {
      replayProtection: {
        enabled: true,
        recentSessionCount: 0,
        lastProcessedAt: null,
        lastSessionId: null,
      },
      recentSessions: [],
      trial: null,
    };
  }

  const recentSessions = listProcessedSessionsByEmail(licenseEmail, 5);
  const trialClaim = getTrialClaimByEmail(licenseEmail);
  const mappedSessions = recentSessions.map((entry) => {
    const redemption = getRedemptionBySession(entry.sessionId);
    const tier = String(entry.tier || license?.plan || "free").trim().toLowerCase();
    return {
      sessionId: entry.sessionId,
      processedAt: entry.processedAt || null,
      source: entry.source || null,
      tier,
      tierName: tier === "ultimate" ? "Ultimate" : tier === "pro" ? "Pro" : "Free",
      seats: Number(entry.seats || license?.seats || 1) || 1,
      months: Number(entry.months || 1) || 1,
      expiresAt: entry.expiresAt || null,
      created: Boolean(entry.created),
      renewed: Boolean(entry.renewed),
      upgraded: Boolean(entry.upgraded),
      replayProtected: entry.replayProtected !== false,
      amountPaidCents: Math.max(0, Number(entry.amountPaidCents || entry.finalAmountCents || 0) || 0),
      baseAmountCents: Math.max(0, Number(entry.baseAmountCents || 0) || 0),
      discountCents: Math.max(0, Number(entry.discountCents || 0) || 0),
      finalAmountCents: Math.max(0, Number(entry.finalAmountCents || entry.amountPaidCents || 0) || 0),
      appliedOfferCode: String(entry.appliedOfferCode || redemption?.code || "").trim().toUpperCase(),
      appliedOfferKind: String(entry.appliedOfferKind || redemption?.kind || "").trim().toLowerCase(),
      referralCode: String(entry.referralCode || redemption?.referralCode || "").trim().toUpperCase(),
    };
  });
  const latestSession = mappedSessions[0] || null;

  return {
    replayProtection: {
      enabled: true,
      recentSessionCount: mappedSessions.length,
      lastProcessedAt: latestSession?.processedAt || null,
      lastSessionId: latestSession?.sessionId || null,
    },
    recentSessions: mappedSessions,
    trial: trialClaim ? {
      status: trialClaim.status || null,
      source: trialClaim.source || null,
      claimedAt: trialClaim.claimedAt || null,
      createdAt: trialClaim.createdAt || null,
      expiresAt: trialClaim.expiresAt || null,
      licenseId: trialClaim.licenseId || null,
      months: Number(trialClaim.months || 0) || 0,
      seats: Number(trialClaim.seats || 0) || 0,
    } : null,
  };
}

function extractMailbox(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) return "";
  const bracketMatch = text.match(/<([^>]+)>/);
  if (bracketMatch?.[1]) return bracketMatch[1].trim();
  const plainMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plainMatch?.[0] || "";
}

function getBlockedCapabilitiesForServer(serverId) {
  return CAPABILITY_KEYS.filter((capabilityKey) => !serverHasCapability(serverId, capabilityKey));
}

function buildServerCapabilityPayload(serverId) {
  const guildId = String(serverId || "").trim();
  const tier = getTier(guildId);
  const limits = getPlanLimits(tier);
  return {
    serverId: guildId,
    tier,
    capabilities: getServerCapabilities(guildId, { apiShape: true }),
    limits: {
      ...limits,
      seats: getServerSeats(guildId),
    },
    upgradeHints: buildUpgradeHints(tier, getBlockedCapabilitiesForServer(guildId)),
  };
}

function mapDashboardCustomStation(key, station) {
  return {
    key,
    name: station?.name || key,
    url: station?.url || "",
    genre: station?.genre || "",
    folder: station?.folder || "",
    tags: Array.isArray(station?.tags) ? station.tags : [],
    custom: true,
  };
}

function buildDashboardExportsWebhookResponse(rawConfig) {
  return normalizeDashboardExportsWebhookConfig(
    rawConfig && typeof rawConfig === "object"
      ? rawConfig
      : DEFAULT_DASHBOARD_EXPORTS_WEBHOOK_CONFIG
  );
}

const handleDashboardLicenseRoute = createDashboardLicenseRouteHandler({
  BRAND,
  TIERS,
  buildDashboardLicensePayload,
  calculatePrice,
  getDashboardSession,
  getLicense,
  getLocalizedJsonBodyError,
  getStripeSecretKey,
  isValidEmailAddress,
  languagePick,
  log,
  maskDashboardEmail,
  methodNotAllowed,
  normalizeDuration,
  normalizeLanguage,
  normalizeSeats,
  resolveCheckoutOfferForRequest,
  resolveCheckoutReturnBase,
  resolveDashboardGuildForSession,
  resolveDashboardRequestLanguage,
  resolvePublicWebsiteUrl,
  sanitizeOfferCode,
  sendJson,
  sendLocalizedError,
  updateLicenseContactEmail,
});

const handleDashboardPermsRoute = createDashboardPermsRouteHandler({
  formatDashboardPermissionMapForClient,
  formatDashboardPermissionRulesForClient,
  getDashboardRequestTranslator,
  getDashboardSession,
  getGuildCommandPermissionRules,
  getLocalizedJsonBodyError,
  methodNotAllowed,
  resetCommandPermissions,
  resolveDashboardGuildForSession,
  resolveDashboardPermissionRuleUpdates,
  resolveRuntimeForGuild,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
  setCommandRolePermission,
});

const handleDashboardSettingsRoute = createDashboardSettingsRouteHandler({
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
});

const handleDashboardStatsRoute = createDashboardStatsRouteHandler({
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
});

const handleDashboardEventsRoute = createDashboardEventsRouteHandler({
  buildDashboardDiscordSyncPatch,
  buildDashboardEventConflicts,
  buildDashboardEventResponse,
  buildDashboardSchedulePreviewRows,
  createScheduledEvent,
  deleteScheduledEvent,
  getDashboardRequestTranslator,
  getDashboardSession,
  getLocalizedJsonBodyError,
  getRepeatLabel,
  getScheduledEvent,
  getTier,
  languagePick,
  listScheduledEvents,
  log,
  methodNotAllowed,
  normalizeDashboardEventInput,
  patchScheduledEvent,
  resolveDashboardGuildForSession,
  resolveRuntimeForGuild,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
  translateScheduledEventStoreMessage,
  validateDashboardEventChannels,
});

const handleDashboardChannelsRoute = createDashboardChannelsRouteHandler({
  getDashboardRequestTranslator,
  getDashboardSession,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  resolveRuntimeForGuild,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
});

const handleDashboardRolesRoute = createDashboardRolesRouteHandler({
  getDashboardRequestTranslator,
  getDashboardSession,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  resolveRuntimeForGuild,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
});

function buildDashboardSelectableStations(guildId) {
  const tier = getTier(guildId);
  const scopedStations = filterStationsByTier(loadStations().stations || {}, tier);
  const customStations = getCustomStations(guildId) || {};
  const entries = [];

  for (const [key, station] of Object.entries(customStations)) {
    const normalizedKey = `custom:${String(key || "").trim().toLowerCase()}`;
    entries.push({
      value: normalizedKey,
      name: station?.name || key,
      label: `${station?.name || key} (Custom)`,
      tier: "ultimate",
      isCustom: true,
      folder: station?.folder || "",
      tags: Array.isArray(station?.tags) ? station.tags : [],
    });
  }

  for (const [key, station] of Object.entries(scopedStations)) {
    const tierLabel = String(station?.tier || "free").trim().toLowerCase();
    const suffix = tierLabel === "free" ? "" : ` (${tierLabel.charAt(0).toUpperCase()}${tierLabel.slice(1)})`;
    entries.push({
      value: key,
      name: station?.name || key,
      label: `${station?.name || key}${suffix}`,
      tier: tierLabel,
      isCustom: false,
    });
  }

  return entries;
}

function buildDashboardFallbackStationPreview(guildId, rawFallbackStation) {
  const selectedValue = String(rawFallbackStation || "").trim().toLowerCase();
  if (!selectedValue) {
    return {
      configured: false,
      valid: true,
      key: "",
      name: "",
      label: "",
      tier: null,
      isCustom: false,
    };
  }

  const match = buildDashboardSelectableStations(guildId).find((entry) => entry.value === selectedValue) || null;
  if (!match) {
    return {
      configured: true,
      valid: false,
      key: selectedValue,
      name: "",
      label: selectedValue,
      tier: null,
      isCustom: selectedValue.startsWith("custom:"),
    };
  }

  return {
    configured: true,
    valid: true,
    key: match.value,
    name: match.name,
    label: match.label,
    tier: match.tier,
    isCustom: match.isCustom,
  };
}

function resolveDashboardFailoverChain(settings = {}) {
  const configuredChain = normalizeFailoverChain(settings?.failoverChain || []);
  if (configuredChain.length > 0) return configuredChain;
  return normalizeFailoverChain(settings?.fallbackStation || "");
}

function buildDashboardFailoverChainPreview(guildId, rawFailoverChain = [], rawFallbackStation = "") {
  const chain = normalizeFailoverChain(
    Array.isArray(rawFailoverChain) && rawFailoverChain.length > 0
      ? rawFailoverChain
      : rawFallbackStation
  );
  return chain.map((stationKey, index) => ({
    order: index + 1,
    ...buildDashboardFallbackStationPreview(guildId, stationKey),
  }));
}

function getHealthBinaryProbe() {
  const cacheAgeMs = 30_000;
  if (binaryHealthCache && (Date.now() - binaryHealthCache.checkedAt) < cacheAgeMs) {
    return binaryHealthCache;
  }

  const probe = (command, variants = [["-version"], ["--version"]]) => {
    for (const args of variants) {
      try {
        const result = spawnSync(command, args, {
          encoding: "utf8",
          timeout: 2_000,
          windowsHide: true,
        });
        if (result.error) continue;
        const firstLine = String(result.stdout || result.stderr || "").split(/\r?\n/).find(Boolean) || "";
        return {
          available: result.status === 0,
          version: firstLine.trim() || null,
          status: result.status,
        };
      } catch {}
    }
    return {
      available: false,
      version: null,
      status: null,
    };
  };

  binaryHealthCache = {
    checkedAt: Date.now(),
    ffmpeg: probe("ffmpeg"),
    fpcalc: probe("fpcalc"),
  };
  return binaryHealthCache;
}

function buildPublicLegalNotice() {
  const publicUrl = String(process.env.PUBLIC_WEB_URL || "").trim();
  const fallbackEmail = extractMailbox(process.env.SMTP_FROM || "");
  const legal = {
    providerName: String(process.env.LEGAL_PROVIDER_NAME || "").trim(),
    legalForm: String(process.env.LEGAL_LEGAL_FORM || "").trim(),
    representative: String(process.env.LEGAL_REPRESENTATIVE || "").trim(),
    streetAddress: String(process.env.LEGAL_STREET_ADDRESS || "").trim(),
    postalCode: String(process.env.LEGAL_POSTAL_CODE || "").trim(),
    city: String(process.env.LEGAL_CITY || "").trim(),
    country: String(process.env.LEGAL_COUNTRY || "").trim(),
    email: String(process.env.LEGAL_EMAIL || "").trim() || fallbackEmail,
    phone: String(process.env.LEGAL_PHONE || "").trim(),
    website: String(process.env.LEGAL_WEBSITE || "").trim() || publicUrl,
    businessPurpose: String(process.env.LEGAL_BUSINESS_PURPOSE || "").trim(),
    commercialRegisterNumber: String(process.env.LEGAL_COMMERCIAL_REGISTER_NUMBER || "").trim(),
    commercialRegisterCourt: String(process.env.LEGAL_COMMERCIAL_REGISTER_COURT || "").trim(),
    vatId: String(process.env.LEGAL_VAT_ID || "").trim(),
    supervisoryAuthority: String(process.env.LEGAL_SUPERVISORY_AUTHORITY || "").trim(),
    chamber: String(process.env.LEGAL_CHAMBER || "").trim(),
    profession: String(process.env.LEGAL_PROFESSION || "").trim(),
    professionRules: String(process.env.LEGAL_PROFESSION_RULES || "").trim(),
    editorialResponsible: String(process.env.LEGAL_EDITORIAL_RESPONSIBLE || "").trim(),
    mediaOwner: String(process.env.LEGAL_MEDIA_OWNER || "").trim(),
    mediaLine: String(process.env.LEGAL_MEDIA_LINE || "").trim(),
  };

  const missingCoreFields = [];
  if (!legal.providerName) missingCoreFields.push("providerName");
  if (!legal.streetAddress) missingCoreFields.push("streetAddress");
  if (!legal.postalCode) missingCoreFields.push("postalCode");
  if (!legal.city) missingCoreFields.push("city");
  if (!legal.email) missingCoreFields.push("email");

  return {
    legal,
    missingCoreFields,
    isConfigured: missingCoreFields.length === 0,
    basis: ["ECG_5", "UGB_14", "GewO_63", "MedienG_25"],
    updatedAt: new Date().toISOString(),
  };
}

function buildPublicPrivacyNotice() {
  const legalNotice = buildPublicLegalNotice();
  const legal = legalNotice.legal || {};
  const hasStripe = Boolean(getStripeSecretKey());
  const hasSmtp = Boolean(String(process.env.SMTP_HOST || "").trim());
  const hasDiscordBotList = String(process.env.DISCORDBOTLIST_ENABLED || "1").trim() !== "0"
    && Boolean(String(process.env.DISCORDBOTLIST_TOKEN || "").trim());
  const hasRecognition = String(process.env.NOW_PLAYING_RECOGNITION_ENABLED || "0").trim() === "1"
    && Boolean(String(process.env.ACOUSTID_API_KEY || "").trim());

  const controller = {
    name: String(process.env.PRIVACY_CONTROLLER_NAME || "").trim() || legal.providerName,
    representative: String(process.env.PRIVACY_CONTROLLER_REPRESENTATIVE || "").trim() || legal.representative,
    streetAddress: String(process.env.PRIVACY_CONTROLLER_STREET_ADDRESS || "").trim() || legal.streetAddress,
    postalCode: String(process.env.PRIVACY_CONTROLLER_POSTAL_CODE || "").trim() || legal.postalCode,
    city: String(process.env.PRIVACY_CONTROLLER_CITY || "").trim() || legal.city,
    country: String(process.env.PRIVACY_CONTROLLER_COUNTRY || "").trim() || legal.country || "Österreich",
    website: String(process.env.PRIVACY_CONTROLLER_WEBSITE || "").trim() || legal.website,
  };

  const contact = {
    email: String(process.env.PRIVACY_CONTACT_EMAIL || "").trim() || legal.email,
    phone: String(process.env.PRIVACY_CONTACT_PHONE || "").trim() || legal.phone,
  };

  const dpo = {
    name: String(process.env.PRIVACY_DPO_NAME || "").trim(),
    email: String(process.env.PRIVACY_DPO_EMAIL || "").trim(),
  };

  const hosting = {
    provider: String(process.env.PRIVACY_HOSTING_PROVIDER || "").trim(),
    location: String(process.env.PRIVACY_HOSTING_LOCATION || "").trim(),
  };

  const authority = {
    name: String(process.env.PRIVACY_AUTHORITY_NAME || "").trim() || "Österreichische Datenschutzbehörde",
    website: String(process.env.PRIVACY_AUTHORITY_WEBSITE || "").trim() || "https://www.dsb.gv.at/",
  };

  const additionalRecipients = String(process.env.PRIVACY_ADDITIONAL_RECIPIENTS || "").trim();
  const customNote = String(process.env.PRIVACY_CUSTOM_NOTE || "").trim();
  const missingCoreFields = [];

  if (!controller.name) missingCoreFields.push("controllerName");
  if (!controller.streetAddress) missingCoreFields.push("controllerStreetAddress");
  if (!controller.postalCode) missingCoreFields.push("controllerPostalCode");
  if (!controller.city) missingCoreFields.push("controllerCity");
  if (!contact.email) missingCoreFields.push("contactEmail");

  return {
    controller,
    contact,
    dpo,
    hosting,
    authority,
    additionalRecipients,
    customNote,
    features: {
      stripeEnabled: hasStripe,
      smtpEnabled: hasSmtp,
      discordBotListEnabled: hasDiscordBotList,
      recognitionEnabled: hasRecognition,
      stationPreviewEnabled: true,
      localeStorageKey: "omnifm.web.locale",
    },
    retention: {
      logDays: Number.parseInt(String(process.env.LOG_MAX_DAYS || "14"), 10) || 14,
      songHistoryEnabled: String(process.env.SONG_HISTORY_ENABLED || "1").trim() !== "0",
      songHistoryMaxPerGuild: Number.parseInt(String(process.env.SONG_HISTORY_MAX_PER_GUILD || "100"), 10) || 100,
      listeningStatsEnabled: true,
      scheduledEventsEnabled: true,
    },
    missingCoreFields,
    isConfigured: missingCoreFields.length === 0,
    basis: ["GDPR_ART_13", "GDPR_ART_15_22", "DSB_AT"],
    updatedAt: new Date().toISOString(),
  };
}

function parseEnvInt(value, fallback, minimum = 1) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

function getDashboardSessionCookieName() {
  return String(process.env.DASHBOARD_SESSION_COOKIE || "omnifm_session").trim() || "omnifm_session";
}

function getDashboardSessionTtlSeconds() {
  return parseEnvInt(process.env.DASHBOARD_SESSION_TTL_SECONDS, 86_400, 300);
}

function getDiscordOauthStateTtlSeconds() {
  return parseEnvInt(process.env.DISCORD_OAUTH_STATE_TTL_SECONDS, 600, 60);
}

function getDiscordOauthScopes() {
  return String(process.env.DISCORD_OAUTH_SCOPES || "identify guilds").trim() || "identify guilds";
}

function getDiscordClientId() {
  return String(process.env.DISCORD_CLIENT_ID || "").trim();
}

function getDiscordClientSecret() {
  return String(process.env.DISCORD_CLIENT_SECRET || "").trim();
}

function getDiscordRedirectUri() {
  return String(process.env.DISCORD_REDIRECT_URI || "").trim();
}

function isDiscordOauthConfigured() {
  return Boolean(getDiscordClientId() && getDiscordClientSecret() && getDiscordRedirectUri());
}

function hasManageGuildPermission(rawPermissions) {
  try {
    const bitfield = BigInt(String(rawPermissions || "0").trim() || "0");
    return (bitfield & 0x20n) === 0x20n || (bitfield & 0x8n) === 0x8n;
  } catch {
    return false;
  }
}

function sanitizeDashboardPage(rawPage) {
  const page = String(rawPage || "dashboard").trim().toLowerCase();
  return page === "home" ? "home" : "dashboard";
}

function parseCookieHeader(rawCookieHeader) {
  const cookies = {};
  for (const part of String(rawCookieHeader || "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function resolveDashboardSessionToken(req) {
  const auth = String(req.headers.authorization || "").trim();
  if (/^Bearer\s+/i.test(auth)) {
    const bearer = auth.replace(/^Bearer\s+/i, "").trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookieHeader(req.headers.cookie);
  const cookieToken = String(cookies[getDashboardSessionCookieName()] || "").trim();
  if (cookieToken) return cookieToken;
  const headerToken = String(req.headers["x-session-token"] || "").trim();
  if (headerToken) return headerToken;
  return "";
}

function getDashboardSession(req) {
  cleanupDashboardAuthState();
  const token = resolveDashboardSessionToken(req);
  if (!token) return { session: null, token: "" };
  return {
    session: getDashboardAuthSession(token),
    token,
  };
}

function getFrontendBaseOrigin(req, publicUrl, preferredOrigin = "") {
  const preferred = toOrigin(preferredOrigin);
  if (preferred) return preferred;
  const requestOrigin = toOrigin(String(req.headers.origin || "").trim());
  if (requestOrigin) return requestOrigin;
  const refererOrigin = toOrigin(String(req.headers.referer || req.headers.referrer || "").trim());
  if (refererOrigin) return refererOrigin;
  const publicOrigin = toOrigin(publicUrl);
  if (publicOrigin) return publicOrigin;
  const redirectOrigin = toOrigin(getDiscordRedirectUri());
  if (redirectOrigin) return redirectOrigin;
  return getConfiguredPublicOrigin(publicUrl);
}

function isSecureCookieRequest(req, targetOrigin = "") {
  if (String(targetOrigin || "").startsWith("https://")) return true;
  if (String(req.socket?.encrypted || false) === "true") return true;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").trim().toLowerCase().split(",")[0].trim();
  return forwardedProto === "https";
}

function buildDashboardSessionCookie(token, req, targetOrigin) {
  const secure = isSecureCookieRequest(req, targetOrigin);
  const sameSite = secure ? "None" : "Lax";
  return [
    `${getDashboardSessionCookieName()}=${encodeURIComponent(token)}`,
    `Max-Age=${getDashboardSessionTtlSeconds()}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
    "Path=/",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function buildDashboardSessionCookieDeletion(req, targetOrigin) {
  const secure = isSecureCookieRequest(req, targetOrigin);
  const sameSite = secure ? "None" : "Lax";
  return [
    `${getDashboardSessionCookieName()}=`,
    "Max-Age=0",
    "HttpOnly",
    `SameSite=${sameSite}`,
    "Path=/",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function buildDiscordAuthorizeUrl(stateToken) {
  const params = new URLSearchParams({
    client_id: getDiscordClientId(),
    response_type: "code",
    redirect_uri: getDiscordRedirectUri(),
    scope: getDiscordOauthScopes(),
    state: stateToken,
    prompt: "consent",
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

async function exchangeDiscordCodeForToken(code) {
  const body = new URLSearchParams({
    client_id: getDiscordClientId(),
    client_secret: getDiscordClientSecret(),
    grant_type: "authorization_code",
    code: String(code || "").trim(),
    redirect_uri: getDiscordRedirectUri(),
  });
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`discord_token_exchange_failed:${response.status}`);
  }
  const payload = await response.json();
  const accessToken = String(payload?.access_token || "").trim();
  if (!accessToken) {
    throw new Error("discord_access_token_missing");
  }
  return accessToken;
}

async function fetchDiscordUserProfile(accessToken) {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`discord_user_fetch_failed:${response.status}`);
  }
  const payload = await response.json();
  return {
    id: String(payload?.id || "").trim(),
    username: clipText(payload?.username || "Discord User", 80),
    globalName: clipText(payload?.global_name || "", 80),
    avatar: clipText(payload?.avatar || "", 120),
  };
}

async function fetchDiscordUserGuilds(accessToken) {
  const response = await fetch("https://discord.com/api/users/@me/guilds", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`discord_guilds_fetch_failed:${response.status}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) return [];
  return payload
    .map((guild) => ({
      id: String(guild?.id || "").trim(),
      name: clipText(guild?.name || "Guild", 120),
      icon: clipText(guild?.icon || "", 120),
      owner: Boolean(guild?.owner),
      permissions: String(guild?.permissions || "0"),
    }))
    .filter((guild) => /^\d{17,22}$/.test(guild.id));
}

function resolveDashboardGuildsForSession(sessionPayload) {
  const guilds = Array.isArray(sessionPayload?.guilds) ? sessionPayload.guilds : [];
  return guilds
    .filter((guild) => guild && /^\d{17,22}$/.test(String(guild.id || "")) && hasManageGuildPermission(guild.permissions))
    .map((guild) => {
      const entitlement = buildServerCapabilityPayload(guild.id);
      return {
        id: guild.id,
        name: clipText(guild.name || guild.id, 120),
        icon: clipText(guild.icon || "", 120),
        owner: Boolean(guild.owner),
        permissions: String(guild.permissions || "0"),
        tier: entitlement.tier,
        capabilities: entitlement.capabilities,
        limits: entitlement.limits,
        upgradeHints: entitlement.upgradeHints,
        dashboardEnabled: entitlement.capabilities.dashboardAccess === true,
        ultimateEnabled: entitlement.capabilities.advancedAnalytics === true
          || entitlement.capabilities.customStationUrls === true
          || entitlement.capabilities.failoverRules === true,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveDashboardGuildForSession(sessionPayload, serverId) {
  const guildId = String(serverId || "").trim();
  if (!/^\d{17,22}$/.test(guildId)) return null;
  return resolveDashboardGuildsForSession(sessionPayload).find((guild) => guild.id === guildId) || null;
}

function buildDashboardErrorRedirect(origin, errorCode, language = "") {
  const safeOrigin = toOrigin(origin) || "http://localhost";
  const lang = normalizeLanguage(language || "", "");
  const langParam = lang ? `&lang=${encodeURIComponent(lang)}` : "";
  return `${safeOrigin}/?page=dashboard&authError=${encodeURIComponent(String(errorCode || "oauth_error"))}${langParam}`;
}

function resolveDashboardRequestLanguage(req, requestUrl, fallback = getDefaultLanguage()) {
  return resolveRequestLanguage(
    req?.headers || {},
    requestUrl?.searchParams?.get("lang") || "",
    fallback
  );
}

function getDashboardRequestTranslator(req, requestUrl, fallback = getDefaultLanguage()) {
  const language = resolveDashboardRequestLanguage(req, requestUrl, fallback);
  return {
    language,
    t: (de, en) => languagePick(language, de, en),
  };
}

function sendLocalizedError(res, status, language, de, en) {
  sendJson(res, status, { error: languagePick(language, de, en) });
}

function getLocalizedJsonBodyError(language, status) {
  return languagePick(
    language,
    status === 413 ? "Request-Body ist zu groß." : "Ungültiges JSON im Request-Body.",
    status === 413 ? "Request body is too large." : "Invalid JSON in request body."
  );
}

function sortDashboardRuntimes(runtimes) {
  return [...(Array.isArray(runtimes) ? runtimes : [])].sort((a, b) => {
    if (a.role === "commander" && b.role !== "commander") return -1;
    if (a.role !== "commander" && b.role === "commander") return 1;
    return Number(a?.config?.index || 0) - Number(b?.config?.index || 0);
  });
}

function resolveRuntimeForGuild(runtimes, guildId) {
  const sorted = sortDashboardRuntimes(runtimes);

  for (const runtime of sorted) {
    const guild = runtime?.client?.guilds?.cache?.get?.(guildId) || null;
    if (guild) return { runtime, guild };
  }

  return { runtime: sorted[0] || null, guild: null };
}

function collectGuildLiveDetails(runtimes, guildId) {
  const rows = [];
  for (const runtime of runtimes) {
    if (typeof runtime?.getPublicStatus !== "function") continue;
    const status = typeof runtime?.getDashboardStatus === "function"
      ? runtime.getDashboardStatus()
      : runtime.getPublicStatus();
    const guildDetails = Array.isArray(status?.guildDetails) ? status.guildDetails : [];
    for (const detail of guildDetails) {
      if (String(detail?.guildId || "") !== String(guildId)) continue;
      if (!detail?.playing) continue;
      rows.push({
        botId: status.botId || status.id || null,
        botName: status.name || "Bot",
        stationKey: detail.stationKey || null,
        stationName: detail.stationName || detail.stationKey || "-",
        channelId: detail.channelId || null,
        channelName: detail.channelName || detail.channelId || "Voice",
        listeners: Number(detail.listenerCount || 0) || 0,
        reconnectAttempts: Number(detail.reconnectAttempts || 0) || 0,
        streamErrorCount: Number(detail.streamErrorCount || 0) || 0,
        shouldReconnect: detail.shouldReconnect === true,
      });
    }
  }
  return rows;
}

function collectGuildBotHealthRows(runtimes, guildId) {
  const rows = [];
  for (const runtime of sortDashboardRuntimes(runtimes)) {
    const guild = runtime?.client?.guilds?.cache?.get?.(guildId) || null;
    if (!guild) continue;

    const status = typeof runtime?.getDashboardStatus === "function"
      ? runtime.getDashboardStatus()
      : (typeof runtime?.getPublicStatus === "function" ? runtime.getPublicStatus() : {});
    const guildDetails = Array.isArray(status?.guildDetails) ? status.guildDetails : [];
    const detail = guildDetails.find((entry) => String(entry?.guildId || "") === String(guildId)) || null;
    const reconnectAttempts = Number(detail?.reconnectAttempts || 0) || 0;
    const streamErrorCount = Number(detail?.streamErrorCount || 0) || 0;
    const playing = detail?.playing === true;
    const shouldReconnect = detail?.shouldReconnect === true;

    let botStatus = "idle";
    if (runtime?.client?.isReady?.() !== true) {
      botStatus = "offline";
    } else if (shouldReconnect) {
      botStatus = "recovering";
    } else if (playing && (reconnectAttempts > 0 || streamErrorCount > 0)) {
      botStatus = "degraded";
    } else if (playing) {
      botStatus = "streaming";
    }

    rows.push({
      botId: status?.botId || status?.id || runtime?.config?.id || null,
      botName: status?.name || runtime?.config?.name || "Bot",
      role: runtime?.role || status?.role || "worker",
      ready: runtime?.client?.isReady?.() === true,
      status: botStatus,
      playing,
      listeners: Number(detail?.listenerCount || 0) || 0,
      reconnectAttempts,
      streamErrorCount,
      shouldReconnect,
      channelId: detail?.channelId || null,
      channelName: detail?.channelName || detail?.channelId || null,
      stationKey: detail?.stationKey || null,
      stationName: detail?.stationName || detail?.stationKey || null,
    });
  }
  return rows;
}

function buildDashboardHealthSummary(serverId, runtimes, {
  liveRows = null,
  listenersNow = null,
  activeStreams = null,
  events = null,
} = {}) {
  const botRows = collectGuildBotHealthRows(runtimes, serverId);
  const activeLiveRows = Array.isArray(liveRows) ? liveRows : collectGuildLiveDetails(runtimes, serverId);
  const eventRows = Array.isArray(events) ? events : listScheduledEvents({ guildId: serverId });
  const enabledEvents = eventRows.filter((entry) => entry?.enabled !== false);
  const nextEvent = enabledEvents
    .filter((entry) => Number.parseInt(String(entry?.runAtMs || 0), 10) > Date.now())
    .sort((a, b) => Number.parseInt(String(a?.runAtMs || 0), 10) - Number.parseInt(String(b?.runAtMs || 0), 10))[0] || null;

  const managedBots = botRows.length;
  const readyBots = botRows.filter((row) => row.ready).length;
  const liveStreamCount = Number(activeStreams ?? activeLiveRows.length) || 0;
  const activeVoiceChannels = new Set(
    activeLiveRows.map((row) => String(row?.channelId || row?.channelName || "").trim()).filter(Boolean)
  ).size;
  const recoveringStreams = activeLiveRows.filter((row) => row?.shouldReconnect === true).length;
  const degradedStreams = activeLiveRows.filter((row) => {
    const reconnectAttempts = Number(row?.reconnectAttempts || 0) || 0;
    const streamErrors = Number(row?.streamErrorCount || 0) || 0;
    return reconnectAttempts > 0 || streamErrors > 0;
  }).length;
  const reconnectAttempts = activeLiveRows.reduce((sum, row) => sum + (Number(row?.reconnectAttempts || 0) || 0), 0);
  const streamErrors = activeLiveRows.reduce((sum, row) => sum + (Number(row?.streamErrorCount || 0) || 0), 0);
  const unavailableBots = Math.max(0, managedBots - readyBots);

  let status = "healthy";
  if (managedBots <= 0 || (readyBots <= 0 && managedBots > 0)) {
    status = "critical";
  } else if (unavailableBots > 0 || recoveringStreams > 0 || degradedStreams > 0) {
    status = "warning";
  }

  const alerts = [];
  if (managedBots <= 0) {
    alerts.push({ code: "no_bot_available", severity: "critical", count: 1 });
  } else if (unavailableBots > 0) {
    alerts.push({
      code: "bot_unavailable",
      severity: readyBots <= 0 ? "critical" : "warning",
      count: unavailableBots,
    });
  }
  if (recoveringStreams > 0) {
    alerts.push({ code: "stream_recovering", severity: "warning", count: recoveringStreams });
  }
  if (degradedStreams > 0) {
    alerts.push({
      code: "stream_unstable",
      severity: streamErrors >= 3 ? "critical" : "warning",
      count: degradedStreams,
    });
  }

  return {
    status,
    managedBots,
    readyBots,
    liveStreams: liveStreamCount,
    activeVoiceChannels,
    listenersNow: Number(listenersNow ?? 0) || 0,
    recoveringStreams,
    degradedStreams,
    reconnectAttempts,
    streamErrors,
    eventsConfigured: eventRows.length,
    eventsActive: enabledEvents.length,
    nextEventAt: nextEvent?.runAtMs ? new Date(Number(nextEvent.runAtMs)).toISOString() : null,
    nextEventTitle: clipText(nextEvent?.name || "", 120) || null,
    alerts,
    bots: botRows,
  };
}

async function buildGuildChannelNameMap(guild, channelIds = []) {
  const uniqueIds = [...new Set((Array.isArray(channelIds) ? channelIds : []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (!guild || !uniqueIds.length) return {};

  try {
    if (typeof guild.channels?.fetch === "function") {
      await guild.channels.fetch();
    }
  } catch {
    // Ignore channel fetch failures and fall back to cached names only.
  }

  return uniqueIds.reduce((map, channelId) => {
    const channel = guild.channels?.cache?.get?.(channelId) || null;
    if (channel?.name) {
      map[channelId] = channel.name;
    }
    return map;
  }, {});
}

async function resolveGuildTextChannel(guild, channelId) {
  const normalizedChannelId = String(channelId || "").trim();
  if (!guild || !normalizedChannelId) return null;

  let channel = guild.channels?.cache?.get?.(normalizedChannelId) || null;
  if (channel) return channel;

  try {
    if (typeof guild.channels?.fetch === "function") {
      channel = await guild.channels.fetch(normalizedChannelId);
    }
  } catch {
    channel = null;
  }

  return channel || null;
}

async function buildDashboardWeeklyDigestPreviewPayload(guildInfo, runtimes, weeklyDigest, language) {
  const digest = normalizeWeeklyDigestConfig(weeklyDigest || {}, language);
  const { guild } = resolveRuntimeForGuild(runtimes, guildInfo.id);
  const stats = getGuildListeningStats(guildInfo.id) || {};
  const dailyStats = await getGuildDailyStats(guildInfo.id, 7);
  const channelNames = await buildGuildChannelNameMap(guild, digest.channelId ? [digest.channelId] : []);
  const guildName = String(guild?.name || guildInfo?.name || guildInfo?.id || "OmniFM");

  const preview = buildWeeklyDigestPreview({
    guildName,
    channelId: digest.channelId,
    channelName: channelNames[digest.channelId] || "",
    stats,
    dailyStats,
    language: digest.language || language,
    now: new Date(),
  });

  return {
    weeklyDigest: digest,
    weeklyDigestMeta: buildWeeklyDigestMeta(digest),
    preview: {
      ...preview,
      embed: buildWeeklyDigestEmbedData({
        guildName,
        channelId: digest.channelId,
        channelName: channelNames[digest.channelId] || "",
        stats,
        dailyStats,
        language: digest.language || language,
        now: preview.generatedAt,
      }),
    },
  };
}

function normalizeDashboardTelemetryPayload(rawTelemetry) {
  const source = rawTelemetry && typeof rawTelemetry === "object" ? rawTelemetry : {};
  const listenersByChannel = Array.isArray(source.listenersByChannel)
    ? source.listenersByChannel
        .filter((item) => item && typeof item === "object")
        .slice(0, 20)
        .map((item) => ({
          name: clipText(item.name || item.channel || "Voice", 80),
          listeners: Math.max(0, Number.parseInt(String(item.listeners || 0), 10) || 0),
        }))
    : [];

  const dailyReport = Array.isArray(source.dailyReport)
    ? source.dailyReport
        .filter((item) => item && typeof item === "object")
        .slice(0, 31)
        .map((item) => ({
          day: clipText(item.day || "", 20),
          starts: Math.max(0, Number.parseInt(String(item.starts || 0), 10) || 0),
          peakListeners: Math.max(0, Number.parseInt(String(item.peakListeners || 0), 10) || 0),
        }))
        .filter((item) => item.day)
    : [];

  const stationBreakdown = Array.isArray(source.stationBreakdown)
    ? source.stationBreakdown
        .filter((item) => item && typeof item === "object")
        .slice(0, 20)
        .map((item) => ({
          name: clipText(item.name || item.station || "Station", 80),
          starts: Math.max(0, Number.parseInt(String(item.starts || 0), 10) || 0),
          peakListeners: Math.max(0, Number.parseInt(String(item.peakListeners || 0), 10) || 0),
        }))
    : [];

  return {
    listenersNow: Math.max(0, Number.parseInt(String(source.listenersNow || 0), 10) || 0),
    activeStreams: Math.max(0, Number.parseInt(String(source.activeStreams || 0), 10) || 0),
    peakListeners: Math.max(0, Number.parseInt(String(source.peakListeners || 0), 10) || 0),
    peakTime: clipText(source.peakTime || "", 80),
    topStation: {
      name: clipText(source?.topStation?.name || source.topStationName || "-", 120) || "-",
      listeners: Math.max(0, Number.parseInt(String(source?.topStation?.listeners || source.topStationListeners || 0), 10) || 0),
    },
    listenersByChannel,
    dailyReport,
    stationBreakdown,
    updatedAt: clipText(source.updatedAt || new Date().toISOString(), 80),
  };
}

function buildEventInsights(events, listeningStats, nowMs = Date.now()) {
  const list = Array.isArray(events) ? events : [];
  const stationStarts = listeningStats?.stationStarts || {};
  const stationListeningMs = listeningStats?.stationListeningMs || {};
  const stationNames = listeningStats?.stationNames || {};

  const configured = list.length;
  const active = list.filter((eventRow) => eventRow?.enabled !== false).length;
  const enabledEvents = list.filter((eventRow) => eventRow?.enabled !== false);
  const nextEvent = enabledEvents
    .filter((eventRow) => Number.parseInt(String(eventRow?.runAtMs || 0), 10) > nowMs)
    .sort((a, b) => Number.parseInt(String(a?.runAtMs || 0), 10) - Number.parseInt(String(b?.runAtMs || 0), 10))[0] || null;

  const repeats = Object.entries(enabledEvents.reduce((map, eventRow) => {
    const repeat = normalizeRepeatMode(eventRow?.repeat || "none");
    map[repeat] = (map[repeat] || 0) + 1;
    return map;
  }, {}))
    .map(([repeat, count]) => ({ repeat, count: Number(count || 0) || 0 }))
    .sort((a, b) => b.count - a.count || a.repeat.localeCompare(b.repeat));

  const topStations = Object.entries(enabledEvents.reduce((map, eventRow) => {
    const stationKey = String(eventRow?.stationKey || "").trim();
    if (!stationKey) return map;
    map[stationKey] = (map[stationKey] || 0) + 1;
    return map;
  }, {}))
    .map(([stationKey, eventCount]) => ({
      stationKey,
      stationName: stationNames?.[stationKey] || stationKey,
      eventCount: Number(eventCount || 0) || 0,
      starts: Number(stationStarts?.[stationKey] || 0) || 0,
      listeningMs: Number(stationListeningMs?.[stationKey] || 0) || 0,
    }))
    .sort((a, b) => b.listeningMs - a.listeningMs || b.eventCount - a.eventCount || a.stationName.localeCompare(b.stationName))
    .slice(0, 8);

  return {
    configured,
    active,
    nextRunAt: nextEvent?.runAtMs ? new Date(Number(nextEvent.runAtMs)).toISOString() : null,
    repeats,
    topStations,
  };
}

function buildDashboardStatsForGuild(serverId, tier, runtimes) {
  const listeningStats = getGuildListeningStats(serverId) || {};
  const telemetry = normalizeDashboardTelemetryPayload(getDashboardTelemetry(serverId));
  const liveRows = collectGuildLiveDetails(runtimes, serverId);
  const events = listScheduledEvents({ guildId: serverId });
  const permissionRules = getGuildCommandPermissionRules(serverId);

  const listenersNow = liveRows.reduce((sum, row) => sum + (Number(row.listeners || 0) || 0), 0);
  const activeStreams = liveRows.length;
  const listenersByChannel = liveRows
    .reduce((map, row) => {
      const key = row.channelId || row.channelName || row.botId || row.botName;
      const current = map.get(key) || { name: row.channelName || row.channelId || "Voice", listeners: 0 };
      current.listeners += Number(row.listeners || 0) || 0;
      map.set(key, current);
      return map;
    }, new Map());
  const telemetryStationBreakdown = Array.isArray(telemetry.stationBreakdown) ? telemetry.stationBreakdown : [];
  const telemetryStationPeakMap = telemetryStationBreakdown.reduce((map, entry) => {
    const key = clipText(entry?.name || "", 120);
    if (!key) return map;
    map.set(key, Math.max(map.get(key) || 0, Number(entry?.peakListeners || 0) || 0));
    return map;
  }, new Map());

  const stationBreakdown = Object.entries(listeningStats.stationStarts || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name, starts]) => ({
      name: listeningStats.stationNames?.[name] || name,
      starts: Number(starts || 0) || 0,
      peakListeners: telemetryStationPeakMap.get(listeningStats.stationNames?.[name] || name) || 0,
    }));
  const stationTimeBreakdown = Object.entries(listeningStats.stationListeningMs || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name, listeningMs]) => ({
      name: listeningStats.stationNames?.[name] || name,
      listeningMs: Number(listeningMs || 0) || 0,
      peakListeners: telemetryStationPeakMap.get(listeningStats.stationNames?.[name] || name) || 0,
    }));

  const liveTopStation = liveRows
    .filter((row) => (Number(row.listeners || 0) || 0) > 0)
    .slice()
    .sort((a, b) => b.listeners - a.listeners || String(a.stationName).localeCompare(String(b.stationName)))[0];
  const topStationByStarts = stationBreakdown[0] || null;
  const topStationByListening = stationTimeBreakdown[0] || null;
  const historicalTopStation = topStationByListening || telemetryStationBreakdown[0] || topStationByStarts || null;
  const topStation = liveTopStation
    ? { name: liveTopStation.stationName || "-", listeners: liveTopStation.listeners || 0 }
    : telemetry.topStation?.name && telemetry.topStation.name !== "-"
      ? telemetry.topStation
      : historicalTopStation
        ? {
            name: historicalTopStation.name,
            listeners: historicalTopStation.peakListeners || 0,
            listeningMs: historicalTopStation.listeningMs || 0,
          }
        : { name: "-", listeners: 0 };

  const peakTime = telemetry.peakTime
    || (listeningStats.lastStartedAt ? new Date(listeningStats.lastStartedAt).toISOString() : "");
  const peakListeners = Math.max(
    Number(listeningStats.peakListeners || 0) || 0,
    Number(telemetry.peakListeners || 0) || 0,
    listenersNow
  );

  const basic = {
    listenersNow,
    activeStreams,
    peakListeners,
    peakTime,
    topStation,
    topStationByStarts: topStationByStarts
      ? {
          name: topStationByStarts.name || "-",
          starts: Number(topStationByStarts.starts || 0) || 0,
          peakListeners: Number(topStationByStarts.peakListeners || 0) || 0,
        }
      : null,
    topStationByListening: topStationByListening
      ? {
          name: topStationByListening.name || "-",
          listeningMs: Number(topStationByListening.listeningMs || 0) || 0,
          peakListeners: Number(topStationByListening.peakListeners || 0) || 0,
        }
      : null,
    eventsConfigured: events.length,
    eventsActive: events.filter((item) => item?.enabled !== false).length,
    permRules: Object.keys(permissionRules || {}).length,
    totalStarts: Number(listeningStats.totalStarts || 0),
    totalSessions: Number(listeningStats.totalSessions || 0),
    totalListeningMs: Number(listeningStats.currentTotalListeningMs || listeningStats.totalListeningMs || 0),
    avgSessionMs: Number(listeningStats.avgSessionMs || 0),
    longestSessionMs: Number(listeningStats.longestSessionMs || 0),
    totalConnections: Number(listeningStats.totalConnections || 0),
    totalReconnects: Number(listeningStats.totalReconnects || 0),
    totalConnectionErrors: Number(listeningStats.totalConnectionErrors || 0),
    updatedAt: telemetry.updatedAt || new Date().toISOString(),
    health: buildDashboardHealthSummary(serverId, runtimes, {
      liveRows,
      listenersNow,
      activeStreams,
      events,
    }),
  };

  if (tier !== "ultimate") {
    return { basic, advanced: null };
  }

  const unstableStreams = liveRows
    .map((row) => {
      const streamErrors = Number(row.streamErrorCount || 0) || 0;
      const reconnectAttempts = Number(row.reconnectAttempts || 0) || 0;
      const issueScore = (streamErrors * 2) + reconnectAttempts;
      return {
        botId: row.botId,
        botName: row.botName,
        stationKey: row.stationKey,
        stationName: row.stationName,
        channelId: row.channelId,
        channelName: row.channelName,
        listeners: row.listeners,
        streamErrors,
        reconnectAttempts,
        shouldReconnect: row.shouldReconnect === true,
        issueScore,
      };
    })
    .filter((row) => row.issueScore > 0)
    .sort((a, b) => b.issueScore - a.issueScore || b.listeners - a.listeners || a.stationName.localeCompare(b.stationName))
    .slice(0, 8);

  const eventInsights = buildEventInsights(events, listeningStats);

  const advanced = {
    listenersByChannel: listenersByChannel.size
      ? [...listenersByChannel.values()].sort((a, b) => b.listeners - a.listeners || a.name.localeCompare(b.name))
      : telemetry.listenersByChannel,
    dailyReport: telemetry.dailyReport,
    stationBreakdown: stationBreakdown.length ? stationBreakdown : telemetry.stationBreakdown,
    stationTimeBreakdown,
    hours: listeningStats.hours || {},
    daysOfWeek: listeningStats.daysOfWeek || {},
    stationListeningMs: listeningStats.stationListeningMs || {},
    commands: listeningStats.commands || {},
    voiceChannels: listeningStats.voiceChannels || {},
    firstSeenAt: listeningStats.firstSeenAt || 0,
    unstableStreams,
    eventInsights,
  };

  return { basic, advanced };
}

async function buildDashboardDetailStatsPayload(guild, runtimes, days = 30) {
  const safeDays = Math.min(90, Math.max(1, Number.parseInt(String(days || "30"), 10) || 30));
  const [dailyStats, sessionHistory, connectionHealth, listenerTimeline, activeSessions] = await Promise.all([
    getGuildDailyStats(guild.id, safeDays),
    getGuildSessionHistory(guild.id, 20),
    getGuildConnectionHealth(guild.id, safeDays),
    getGuildListenerTimeline(guild.id, 24),
    Promise.resolve(getActiveSessionsForGuild(guild.id)),
  ]);

  const listeningStats = getGuildListeningStats(guild.id) || {};
  const { guild: managedGuild } = resolveRuntimeForGuild(runtimes, guild.id);
  const voiceChannelNames = await buildGuildChannelNameMap(managedGuild, [
    ...Object.keys(listeningStats.voiceChannels || {}),
    ...activeSessions.map((session) => session?.channelId).filter(Boolean),
  ]);
  const events = listScheduledEvents({ guildId: guild.id });
  const eventInsights = buildEventInsights(events, listeningStats);
  const unstableStreams = collectGuildLiveDetails(runtimes, guild.id)
    .map((row) => {
      const streamErrors = Number(row.streamErrorCount || 0) || 0;
      const reconnectAttempts = Number(row.reconnectAttempts || 0) || 0;
      const issueScore = (streamErrors * 2) + reconnectAttempts;
      return {
        botId: row.botId,
        botName: row.botName,
        stationKey: row.stationKey,
        stationName: row.stationName,
        channelId: row.channelId,
        channelName: row.channelName,
        listeners: row.listeners,
        streamErrors,
        reconnectAttempts,
        shouldReconnect: row.shouldReconnect === true,
        issueScore,
      };
    })
    .filter((row) => row.issueScore > 0)
    .sort((a, b) => b.issueScore - a.issueScore || b.listeners - a.listeners || a.stationName.localeCompare(b.stationName))
    .slice(0, 12);

  return {
    serverId: guild.id,
    tier: guild.tier,
    days: safeDays,
    listeningStats: {
      totalListeningMs: listeningStats.currentTotalListeningMs || listeningStats.totalListeningMs || 0,
      totalSessions: listeningStats.totalSessions || 0,
      avgSessionMs: listeningStats.avgSessionMs || 0,
      longestSessionMs: listeningStats.longestSessionMs || 0,
      totalStarts: listeningStats.totalStarts || 0,
      peakListeners: listeningStats.peakListeners || 0,
      stationStarts: listeningStats.stationStarts || {},
      stationListeningMs: listeningStats.stationListeningMs || {},
      stationNames: listeningStats.stationNames || {},
      hours: listeningStats.hours || {},
      daysOfWeek: listeningStats.daysOfWeek || {},
      commands: listeningStats.commands || {},
      voiceChannels: listeningStats.voiceChannels || {},
      voiceChannelNames,
      firstSeenAt: listeningStats.firstSeenAt || 0,
    },
    dailyStats,
    sessionHistory: sessionHistory.map((s) => ({
      stationKey: s.stationKey,
      stationName: s.stationName,
      channelId: s.channelId,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationMs: s.durationMs,
      humanListeningMs: s.humanListeningMs,
      peakListeners: s.peakListeners,
      avgListeners: s.avgListeners,
    })),
    connectionHealth,
    connectionWindowDays: safeDays,
    listenerTimeline,
    unstableStreams,
    eventInsights,
    activeSessions: activeSessions.map((s) => ({
      botId: s.botId,
      stationKey: s.stationKey,
      stationName: s.stationName,
      channelId: s.channelId,
      currentDurationMs: s.currentDurationMs,
      currentHumanListeningMs: s.currentHumanListeningMs,
      currentAvgListeners: s.currentAvgListeners,
      currentListeners: s.currentListeners,
      peakListeners: s.peakListeners,
    })),
  };
}

function normalizeDashboardRoleToken(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) return "";
  const mention = text.match(/^<@&(\d{17,22})>$/);
  if (mention) return mention[1];
  return text;
}

async function resolveGuildRoleIds(guild, rawRoles) {
  const roleIds = [];
  const unresolved = [];
  const seen = new Set();
  const roleCollection = guild?.roles?.cache || new Map();

  if (guild?.roles?.fetch) {
    try {
      await guild.roles.fetch();
    } catch {}
  }

  for (const rawRole of Array.isArray(rawRoles) ? rawRoles : []) {
    const token = normalizeDashboardRoleToken(rawRole);
    if (!token) continue;

    let roleId = /^\d{17,22}$/.test(token) ? token : "";
    if (!roleId) {
      const lowerToken = token.toLowerCase();
      const match = [...roleCollection.values()].find((role) => String(role?.name || "").trim().toLowerCase() === lowerToken);
      roleId = String(match?.id || "").trim();
    }

    if (!/^\d{17,22}$/.test(roleId)) {
      unresolved.push(token);
      continue;
    }
    if (seen.has(roleId)) continue;
    seen.add(roleId);
    roleIds.push(roleId);
  }

  return { roleIds, unresolved };
}

function formatDashboardPermissionMapForClient(commandRules, guild) {
  const output = {};
  const roleCollection = guild?.roles?.cache || new Map();
  const supportedCommands = getSupportedPermissionCommands();

  for (const command of supportedCommands) {
    const rule = commandRules?.[command];
    const allowRoleIds = Array.isArray(rule?.allowRoleIds) ? rule.allowRoleIds : [];
    output[command] = allowRoleIds.map((roleId) => roleCollection.get(roleId)?.name || roleId);
  }

  return output;
}

function formatDashboardPermissionRulesForClient(commandRules, guild) {
  const roleCollection = guild?.roles?.cache || new Map();
  return getSupportedPermissionCommands().map((command) => {
    const rule = commandRules?.[command];
    const allowRoleIds = Array.isArray(rule?.allowRoleIds) ? [...new Set(rule.allowRoleIds)] : [];
    return {
      command,
      allowRoleIds,
      allowRoles: allowRoleIds.map((roleId) => ({
        id: roleId,
        name: roleCollection.get(roleId)?.name || roleId,
      })),
    };
  });
}

function extractDashboardPermissionRuleTokens(rawRule) {
  const tokens = [];
  for (const roleId of Array.isArray(rawRule?.allowRoleIds) ? rawRule.allowRoleIds : []) {
    tokens.push(roleId);
  }
  for (const roleEntry of Array.isArray(rawRule?.allowRoles) ? rawRule.allowRoles : []) {
    if (typeof roleEntry === "string") {
      tokens.push(roleEntry);
      continue;
    }
    if (!roleEntry || typeof roleEntry !== "object") continue;
    tokens.push(roleEntry.id || roleEntry.roleId || roleEntry.name || "");
  }
  return tokens.filter(Boolean);
}

async function resolveDashboardPermissionRuleUpdates(guild, body) {
  const supportedCommands = getSupportedPermissionCommands();
  const unresolved = [];
  const resolvedCommands = [];

  if (Array.isArray(body?.rules)) {
    for (const rawRule of body.rules) {
      const command = String(rawRule?.command || "").trim().replace(/^\//, "").toLowerCase();
      if (!supportedCommands.includes(command)) continue;
      const resolved = await resolveGuildRoleIds(guild, extractDashboardPermissionRuleTokens(rawRule));
      if (resolved.unresolved.length) {
        unresolved.push(`${command}: ${resolved.unresolved.join(", ")}`);
        continue;
      }
      resolvedCommands.push({ command, roleIds: resolved.roleIds });
    }
    return { supportedCommands, unresolved, resolvedCommands };
  }

  const incomingMap = body?.commandRoleMap && typeof body.commandRoleMap === "object"
    ? body.commandRoleMap
    : {};
  for (const [rawCommand, rawRoles] of Object.entries(incomingMap)) {
    const command = String(rawCommand || "").trim().replace(/^\//, "").toLowerCase();
    if (!supportedCommands.includes(command)) continue;
    const resolved = await resolveGuildRoleIds(guild, rawRoles);
    if (resolved.unresolved.length) {
      unresolved.push(`${command}: ${resolved.unresolved.join(", ")}`);
      continue;
    }
    resolvedCommands.push({ command, roleIds: resolved.roleIds });
  }
  return { supportedCommands, unresolved, resolvedCommands };
}

function hasOwnDashboardField(payload, field) {
  return Object.prototype.hasOwnProperty.call(payload, field);
}

function formatDashboardDateTimeLocal(runAtMs, timeZone = EVENT_FALLBACK_TIME_ZONE) {
  const utcMs = Number.parseInt(String(runAtMs || 0), 10);
  if (!Number.isFinite(utcMs) || utcMs <= 0) return "";

  const zoned = getZonedPartsFromUtcMs(
    utcMs,
    normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE
  );
  const pad = (value) => String(value || 0).padStart(2, "0");
  return `${zoned.year}-${pad(zoned.month)}-${pad(zoned.day)}T${pad(zoned.hour)}:${pad(zoned.minute)}`;
}

function buildDashboardEventResponse(eventRow) {
  const runAtMs = Number.parseInt(String(eventRow?.runAtMs || 0), 10);
  const timezone = normalizeEventTimeZone(eventRow?.timeZone || eventRow?.timezone, EVENT_FALLBACK_TIME_ZONE)
    || EVENT_FALLBACK_TIME_ZONE;
  const discordScheduledEventId = String(eventRow?.discordScheduledEventId || "").trim() || null;
  const discordSyncError = clipText(eventRow?.discordSyncError || "", 300) || null;

  return {
    id: String(eventRow?.id || ""),
    title: eventRow?.name || "OmniFM Event",
    stationKey: eventRow?.stationKey || "",
    startsAt: runAtMs > 0 ? new Date(runAtMs).toISOString() : "",
    startsAtLocal: formatDashboardDateTimeLocal(runAtMs, timezone),
    timezone,
    channelId: eventRow?.voiceChannelId || "",
    textChannelId: eventRow?.textChannelId || "",
    enabled: eventRow?.enabled !== false,
    repeat: normalizeRepeatMode(eventRow?.repeat || "none"),
    repeatLabelDe: getRepeatLabel(eventRow?.repeat || "none", "de", { runAtMs, timeZone: timezone }),
    repeatLabelEn: getRepeatLabel(eventRow?.repeat || "none", "en", { runAtMs, timeZone: timezone }),
    durationMs: Number(eventRow?.durationMs || 0),
    announceMessage: eventRow?.announceMessage || "",
    description: eventRow?.description || "",
    stageTopic: eventRow?.stageTopic || "",
    createDiscordEvent: eventRow?.createDiscordEvent === true,
    discordScheduledEventId,
    discordEventSynced: eventRow?.createDiscordEvent === true && Boolean(discordScheduledEventId) && !discordSyncError,
    discordSyncError,
    createdByUserId: eventRow?.createdByUserId || "",
    createdAt: eventRow?.createdAt || new Date().toISOString(),
    updatedAt: eventRow?.updatedAt || eventRow?.createdAt || new Date().toISOString(),
  };
}

function buildDashboardPreviewOccurrenceRow(runAtMs, durationMs, timezone) {
  const safeRunAtMs = Number.parseInt(String(runAtMs || 0), 10);
  const safeDurationMs = Math.max(0, Number(durationMs || 0) || 0);
  const safeTimezone = normalizeEventTimeZone(timezone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  const endAtMs = safeDurationMs > 0 ? safeRunAtMs + safeDurationMs : 0;

  return {
    runAtMs: safeRunAtMs,
    durationMs: safeDurationMs,
    startsAt: safeRunAtMs > 0 ? new Date(safeRunAtMs).toISOString() : "",
    startsAtLocal: formatDashboardDateTimeLocal(safeRunAtMs, safeTimezone),
    endsAt: endAtMs > 0 ? new Date(endAtMs).toISOString() : "",
    endsAtLocal: endAtMs > 0 ? formatDashboardDateTimeLocal(endAtMs, safeTimezone) : "",
  };
}

function buildDashboardSchedulePreviewRows(eventRow, limit = 5) {
  const rows = [];
  const safeLimit = Math.max(1, Math.min(10, Number(limit || 5) || 5));
  const repeat = normalizeRepeatMode(eventRow?.repeat || "none");
  const timezone = normalizeEventTimeZone(eventRow?.timeZone || eventRow?.timezone, EVENT_FALLBACK_TIME_ZONE)
    || EVENT_FALLBACK_TIME_ZONE;
  let runAtMs = Number.parseInt(String(eventRow?.runAtMs || 0), 10);
  const durationMs = Math.max(0, Number(eventRow?.durationMs || 0) || 0);

  for (let index = 0; index < safeLimit; index += 1) {
    if (!Number.isFinite(runAtMs) || runAtMs <= 0) break;
    rows.push(buildDashboardPreviewOccurrenceRow(runAtMs, durationMs, timezone));
    if (repeat === "none") break;
    runAtMs = computeNextEventRunAtMs(runAtMs, repeat, runAtMs, timezone);
  }

  return rows;
}

function buildDashboardEventConflicts(candidateEvent, scheduledEvents, { language = "de", ignoreEventId = "" } = {}) {
  const candidateRows = buildDashboardSchedulePreviewRows(candidateEvent, 5);
  const seen = new Set();
  const conflicts = [];
  const candidateDurationMs = Math.max(0, Number(candidateEvent?.durationMs || 0) || 0);

  for (const existingEvent of Array.isArray(scheduledEvents) ? scheduledEvents : []) {
    if (!existingEvent || existingEvent.enabled === false) continue;
    if (String(existingEvent.id || "") === String(ignoreEventId || "")) continue;
    if (String(existingEvent.voiceChannelId || "") !== String(candidateEvent?.voiceChannelId || "")) continue;

    const existingRows = buildDashboardSchedulePreviewRows(existingEvent, 5);
    const existingDurationMs = Math.max(0, Number(existingEvent?.durationMs || 0) || 0);
    const existingResponse = buildDashboardEventResponse(existingEvent);

    for (const candidateRow of candidateRows) {
      for (const existingRow of existingRows) {
        let severity = "";
        let message = "";

        if (candidateDurationMs > 0 && existingDurationMs > 0) {
          const candidateEndAtMs = candidateRow.runAtMs + candidateDurationMs;
          const existingEndAtMs = existingRow.runAtMs + existingDurationMs;
          if (candidateRow.runAtMs < existingEndAtMs && existingRow.runAtMs < candidateEndAtMs) {
            severity = "error";
            message = languagePick(
              language,
              `Überlappt mit "${existingEvent.name}" im selben Voice-Channel.`,
              `Overlaps with "${existingEvent.name}" in the same voice channel.`
            );
          }
        } else if (candidateDurationMs <= 0 && existingRow.runAtMs >= candidateRow.runAtMs) {
          severity = "warning";
          message = languagePick(
            language,
            `Dieses Event hat kein Enddatum und könnte "${existingEvent.name}" blockieren.`,
            `This event has no end time and may block "${existingEvent.name}".`
          );
        } else if (existingDurationMs <= 0 && existingRow.runAtMs <= candidateRow.runAtMs) {
          severity = "warning";
          message = languagePick(
            language,
            `"${existingEvent.name}" hat kein Enddatum und könnte dieses Event blockieren.`,
            `"${existingEvent.name}" has no end time and may block this event.`
          );
        }

        if (!severity || !message) continue;

        const key = `${existingEvent.id}:${candidateRow.runAtMs}:${existingRow.runAtMs}:${severity}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          severity,
          message,
          eventId: existingResponse.id,
          title: existingResponse.title,
          repeat: existingResponse.repeat,
          repeatLabelDe: existingResponse.repeatLabelDe,
          repeatLabelEn: existingResponse.repeatLabelEn,
          startsAt: existingRow.startsAt,
          startsAtLocal: existingRow.startsAtLocal,
          endsAt: existingRow.endsAt,
          endsAtLocal: existingRow.endsAtLocal,
          channelId: existingResponse.channelId,
        });
      }
    }
  }

  return conflicts.sort((a, b) => {
    const severityOrder = { error: 0, warning: 1 };
    const severityDelta = (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    if (severityDelta !== 0) return severityDelta;
    return String(a.startsAt || "").localeCompare(String(b.startsAt || ""));
  });
}

function parseDashboardStartsAtInput(payload) {
  const localRaw = String(payload?.startsAtLocal || "").trim();
  if (localRaw) {
    return { mode: "local", value: localRaw };
  }

  const legacyRaw = String(payload?.startsAt || payload?.startAt || "").trim();
  if (legacyRaw) {
    return { mode: "legacy_iso", value: legacyRaw };
  }

  return { mode: "unchanged", value: "" };
}

async function validateDashboardEventChannels(runtime, guild, event, language = "de") {
  if (!runtime || !guild) {
    return {
      ok: false,
      message: languagePick(language, "Der Bot ist auf diesem Server aktuell nicht verfügbar.", "The bot is currently unavailable on this server."),
    };
  }

  const me = await runtime.resolveBotMember(guild);
  if (!me) {
    return { ok: false, message: languagePick(language, "Bot-Mitglied im Server konnte nicht geladen werden.", "Could not load the bot member in this server.") };
  }

  const { channel: voiceChannel } = await runtime.resolveGuildVoiceChannel(guild.id, event.voiceChannelId);
  if (!voiceChannel) {
    return { ok: false, message: languagePick(language, "Bitte wähle einen Voice- oder Stage-Channel.", "Please choose a voice or stage channel.") };
  }
  if (event.stageTopic && voiceChannel.type !== ChannelType.GuildStageVoice) {
    return { ok: false, message: languagePick(language, "`stagetopic` funktioniert nur mit Stage-Channels.", "`stagetopic` only works with stage channels.") };
  }

  const voicePerms = voiceChannel.permissionsFor(me);
  if (!voicePerms?.has(PermissionFlagsBits.Connect)) {
    return {
      ok: false,
      message: languagePick(
        language,
        `Ich habe keine Connect-Berechtigung für ${voiceChannel.toString()}.`,
        `I do not have Connect permission for ${voiceChannel.toString()}.`
      ),
    };
  }
  if (voiceChannel.type !== ChannelType.GuildStageVoice && !voicePerms?.has(PermissionFlagsBits.Speak)) {
    return {
      ok: false,
      message: languagePick(
        language,
        `Ich habe keine Speak-Berechtigung für ${voiceChannel.toString()}.`,
        `I do not have Speak permission for ${voiceChannel.toString()}.`
      ),
    };
  }
  if (event.createDiscordEvent) {
    const eventPermError = runtime.validateDiscordScheduledEventPermissions(guild, voiceChannel, language);
    if (eventPermError) {
      return { ok: false, message: eventPermError };
    }
  }

  let textChannel = null;
  if (event.textChannelId) {
    textChannel = guild.channels?.cache?.get(event.textChannelId) || null;
    if (!textChannel && guild.channels?.fetch) {
      textChannel = await guild.channels.fetch(event.textChannelId).catch(() => null);
    }
    if (!textChannel || textChannel.guildId !== guild.id || typeof textChannel.send !== "function") {
      return {
        ok: false,
        message: languagePick(
          language,
          "Der gewählte Text-Channel ist nicht in diesem Server.",
          "The selected text channel is not in this server."
        ),
      };
    }

    const textPerms = textChannel.permissionsFor(me);
    if (!textPerms?.has(PermissionFlagsBits.ViewChannel) || !textPerms?.has(PermissionFlagsBits.SendMessages)) {
      return {
        ok: false,
        message: languagePick(
          language,
          `Ich kann in ${textChannel.toString()} nicht schreiben.`,
          `I cannot send messages in ${textChannel.toString()}.`
        ),
      };
    }
  }

  return { ok: true, voiceChannel, textChannel };
}

function buildDashboardDiscordSyncPatch(event, { discordScheduledEventId = null, discordSyncError = null } = {}) {
  return {
    discordScheduledEventId: discordScheduledEventId || null,
    discordSyncError: clipText(discordSyncError || "", 300) || null,
  };
}

async function normalizeDashboardEventInput(body, {
  guildId,
  botId,
  runtime,
  existingEvent = null,
  language = "de",
} = {}) {
  const payload = body && typeof body === "object" ? body : {};
  const title = clipText(
    hasOwnDashboardField(payload, "title") || hasOwnDashboardField(payload, "name")
      ? payload.title || payload.name
      : (existingEvent?.name || "OmniFM Event"),
    120
  ).trim();
  const stationKey = clipText(
    hasOwnDashboardField(payload, "stationKey") || hasOwnDashboardField(payload, "station")
      ? payload.stationKey || payload.station
      : (existingEvent?.stationKey || ""),
    120
  ).trim().toLowerCase();
  const channelId = String(
    hasOwnDashboardField(payload, "channelId") || hasOwnDashboardField(payload, "voiceChannelId")
      ? payload.channelId || payload.voiceChannelId
      : (existingEvent?.voiceChannelId || "")
  ).trim();
  const textChannelId = String(
    hasOwnDashboardField(payload, "textChannelId")
      ? payload.textChannelId || ""
      : (existingEvent?.textChannelId || "")
  ).trim();
  const timezoneInput = clipText(
    hasOwnDashboardField(payload, "timezone")
      ? payload.timezone
      : (existingEvent?.timeZone || EVENT_FALLBACK_TIME_ZONE),
    80
  );
  const timezone = normalizeEventTimeZone(timezoneInput, EVENT_FALLBACK_TIME_ZONE);
  const repeat = normalizeRepeatMode(
    hasOwnDashboardField(payload, "repeat")
      ? payload.repeat
      : (existingEvent?.repeat || "none")
  );
  const durationMs = Math.max(
    0,
    Number(
      hasOwnDashboardField(payload, "durationMs")
        ? payload.durationMs
        : (existingEvent?.durationMs || 0)
    ) || 0
  );
  const announceMessage = hasOwnDashboardField(payload, "announceMessage")
    ? runtime.normalizeClearableText(payload.announceMessage, 1200)
    : (existingEvent?.announceMessage || null);
  const description = hasOwnDashboardField(payload, "description")
    ? runtime.normalizeClearableText(payload.description, 800)
    : (existingEvent?.description || null);
  const stageTopic = hasOwnDashboardField(payload, "stageTopic")
    ? runtime.normalizeClearableText(payload.stageTopic, 120)
    : (existingEvent?.stageTopic || null);
  const createDiscordEvent = hasOwnDashboardField(payload, "createDiscordEvent")
    ? payload.createDiscordEvent === true
    : existingEvent?.createDiscordEvent === true;
  const enabled = hasOwnDashboardField(payload, "enabled")
    ? payload.enabled !== false
    : existingEvent?.enabled !== false;

  if (!title) return { ok: false, message: languagePick(language, "Titel fehlt.", "Title is required.") };
  if (!stationKey) return { ok: false, message: languagePick(language, "Station-Key fehlt.", "Station key is required.") };
  if (!/^\d{17,22}$/.test(channelId)) return { ok: false, message: languagePick(language, "Voice-Channel-ID fehlt oder ist ungültig.", "Voice channel ID is missing or invalid.") };
  if (textChannelId && !/^\d{17,22}$/.test(textChannelId)) return { ok: false, message: languagePick(language, "Text-Channel-ID ist ungültig.", "Text channel ID is invalid.") };
  if (!timezone) return { ok: false, message: languagePick(language, "Zeitzone ist ungültig.", "Time zone is invalid.") };
  if (!botId) return { ok: false, message: languagePick(language, "Kein geeigneter Bot für dieses Event gefunden.", "No suitable bot was found for this event.") };

  const startInput = parseDashboardStartsAtInput(payload);
  let parsedWindow;
  if (startInput.mode === "legacy_iso") {
    const parsedRunAtMs = Date.parse(startInput.value);
    if (!Number.isFinite(parsedRunAtMs) || parsedRunAtMs <= 0) {
      return { ok: false, message: languagePick(language, "Startzeit ist ungültig.", "Start time is invalid.") };
    }
    parsedWindow = {
      ok: true,
      runAtMs: parsedRunAtMs,
      timeZone: timezone,
      durationMs,
      endAtMs: durationMs > 0 ? parsedRunAtMs + durationMs : 0,
    };
  } else {
    parsedWindow = runtime.parseEventWindowInput({
      startRaw: startInput.mode === "local" ? startInput.value : undefined,
      baseRunAtMs: existingEvent?.runAtMs || 0,
      baseDurationMs: durationMs,
      requestedTimeZone: timezone,
      allowImmediate: !createDiscordEvent,
    }, language);
  }
  if (!parsedWindow?.ok) {
    return { ok: false, message: parsedWindow?.message || languagePick(language, "Startzeit ist ungültig.", "Start time is invalid.") };
  }
  if (createDiscordEvent && parsedWindow.runAtMs < Date.now() + 60_000) {
    return {
      ok: false,
      message: languagePick(
        language,
        "Mit Discord-Server-Event muss die Startzeit mindestens 60 Sekunden in der Zukunft liegen.",
        "With a Discord server event, the start time must be at least 60 seconds in the future."
      ),
    };
  }
  if (repeat === "weekdays" && !isWorkdayInTimeZone(parsedWindow.runAtMs, parsedWindow.timeZone || timezone)) {
    return {
      ok: false,
      message: languagePick(
        language,
        "Für Werktags-Wiederholung muss die Startzeit auf Montag bis Freitag liegen.",
        "For weekday recurrence, the start time must fall on Monday to Friday."
      ),
    };
  }

  const station = runtime.resolveStationForGuild(guildId, stationKey, language);
  if (!station.ok) {
    return { ok: false, message: station.message };
  }

  return {
    ok: true,
    station,
    parsedWindow,
    event: {
      guildId,
      botId,
      name: title,
      stationKey: station.key,
      voiceChannelId: channelId,
      textChannelId: textChannelId || null,
      announceMessage: announceMessage || null,
      description: description || null,
      stageTopic: stageTopic || null,
      timeZone: parsedWindow.timeZone || timezone,
      createDiscordEvent,
      repeat,
      runAtMs: parsedWindow.runAtMs,
      durationMs: parsedWindow.durationMs > 0 ? parsedWindow.durationMs : 0,
      enabled,
    },
  };
}

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
      sendJson(res, 400, { error: "Ungültige Request-URL." });
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

    if (requestUrl.pathname === "/api/workers") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }

      const sortedRuntimes = [...runtimes].sort(
        (a, b) => Number(a?.config?.index || 0) - Number(b?.config?.index || 0)
      );
      const commanderRuntime = sortedRuntimes.find((runtime) => runtime.role === "commander") || sortedRuntimes[0] || null;

      const toWorkerPayload = (runtime, fallbackIndex = 0) => {
        const status = runtime.getPublicStatus?.() || {};
        const stats = runtime.collectStats?.() || {};
        const activeStreams = Number(
          runtime.getPlayingGuildCount?.()
          ?? status.connections
          ?? status.listeners
          ?? 0
        ) || 0;
        const servers = Number(stats.servers ?? status.servers ?? status.guilds ?? 0) || 0;
        const index = Number(runtime?.config?.index || fallbackIndex || 0) || fallbackIndex || 0;

        return {
          id: runtime?.config?.id || null,
          botId: runtime?.config?.id || null,
          index,
          name: runtime?.config?.name || `Bot ${index || "?"}`,
          role: runtime?.role || "worker",
          requiredTier: runtime?.config?.requiredTier || "free",
          color: status.color || (runtime?.role === "commander" ? "#00F0FF" : "#39FF14"),
          online: Boolean(runtime?.client?.isReady?.()),
          servers,
          activeStreams,
        };
      };

      const workers = sortedRuntimes
        .filter((runtime) => runtime !== commanderRuntime)
        .map((runtime, position) => toWorkerPayload(runtime, position + 1));

      sendJson(res, 200, {
        architecture: "commander_worker",
        commander: commanderRuntime ? toWorkerPayload(commanderRuntime, 1) : null,
        workers,
        tiers: {
          free: { maxWorkers: Number(TIERS.free?.maxBots || 2) },
          pro: { maxWorkers: Number(TIERS.pro?.maxBots || 8) },
          ultimate: { maxWorkers: Number(TIERS.ultimate?.maxBots || 16) },
        },
      });
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
      const publicStations = buildPublicStationCatalog(loadStations());
      sendJson(res, 200, {
        ...totals,
        bots: runtimes.length,
        stations: publicStations.total,
        freeStations: publicStations.freeStations,
        proStations: publicStations.proStations,
        ultimateStations: publicStations.ultimateStations,
      });
      return;
    }

    if (requestUrl.pathname === "/api/stations") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const publicStations = buildPublicStationCatalog(loadStations());
      sendJson(res, 200, {
        defaultStationKey: publicStations.defaultStationKey,
        qualityPreset: publicStations.qualityPreset,
        total: publicStations.total,
        stations: publicStations.stations,
      });
      return;
    }

    if (requestUrl.pathname === "/api/legal") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      sendJson(res, 200, buildPublicLegalNotice());
      return;
    }

    if (requestUrl.pathname === "/api/privacy") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      sendJson(res, 200, buildPublicPrivacyNotice());
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
        status: "online",
        brand: BRAND.name,
        timestamp: new Date().toISOString(),
        uptimeSec: Math.floor((Date.now() - appStartTime) / 1000),
        bots: runtimes.length,
        readyBots
      });
      return;
    }

    if (requestUrl.pathname === "/api/health/detail") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      if (!isAdminApiRequest(req)) {
        sendJson(res, 401, { error: "Unauthorized. API admin token required." });
        return;
      }

      const { getDb, isConnected } = await import("../lib/db.js");
      const binaryProbe = getHealthBinaryProbe();
      const readyBots = runtimes.filter((runtime) => runtime.client.isReady()).length;
      const runtimeDetails = runtimes.map((runtime) => {
        const snapshot = runtime.buildStatusSnapshot();
        return {
          id: snapshot.id,
          name: snapshot.name,
          role: snapshot.role,
          requiredTier: snapshot.requiredTier,
          ready: snapshot.ready,
          servers: snapshot.servers,
          listeners: snapshot.listeners,
          connections: snapshot.connections,
          uptimeSec: snapshot.uptimeSec,
          error: snapshot.error,
        };
      });

      sendJson(res, 200, {
        ok: true,
        status: readyBots > 0 ? "online" : "degraded",
        brand: BRAND.name,
        timestamp: new Date().toISOString(),
        uptimeSec: Math.floor((Date.now() - appStartTime) / 1000),
        container: {
          pid: process.pid,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          webRootSource,
          frontendBuildStamp,
        },
        discord: {
          bots: runtimes.length,
          readyBots,
          runtimes: runtimeDetails,
        },
        db: {
          connected: isConnected(),
          database: getDb()?.databaseName || null,
          fallbackActive: !isConnected(),
        },
        stripe: {
          configured: Boolean(getStripeSecretKey()),
        },
        binaries: {
          ffmpeg: binaryProbe.ffmpeg,
          fpcalc: binaryProbe.fpcalc,
        },
        stores: {
          dashboardSessions: {
            backend: "json-file",
            filePresent: fs.existsSync(path.join(rootDir, "dashboard.json")),
          },
          premiumLicenses: {
            backend: "json-file",
            filePresent: fs.existsSync(path.join(rootDir, "premium.json")),
          },
          commandPermissions: {
            backend: "json-file",
            filePresent: fs.existsSync(path.join(rootDir, "command-permissions.json")),
          },
          customStations: {
            backend: "json-file",
            filePresent: fs.existsSync(path.join(rootDir, "custom-stations.json")),
          },
          listeningStats: {
            backend: isConnected() ? "mongodb+json-fallback" : "json-fallback",
            dbConnected: isConnected(),
          },
        },
      });
      return;
    }

    if (requestUrl.pathname === "/api/discordbotlist/status") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      if (!isAdminApiRequest(req)) {
        sendJson(res, 401, { error: "Unauthorized. API admin token required." });
        return;
      }
      const voteLimit = Number.parseInt(String(requestUrl.searchParams.get("limit") || "20"), 10);
      sendJson(res, 200, getDiscordBotListStatus(runtimes, { voteLimit }));
      return;
    }

    if (requestUrl.pathname === "/api/discordbotlist/votes") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      if (!isAdminApiRequest(req)) {
        sendJson(res, 401, { error: "Unauthorized. API admin token required." });
        return;
      }
      const voteLimit = Number.parseInt(String(requestUrl.searchParams.get("limit") || "50"), 10);
      const status = getDiscordBotListStatus(runtimes, { voteLimit });
      sendJson(res, 200, {
        totalVotes: status?.state?.totalVotes || 0,
        votes: status?.state?.votes || [],
      });
      return;
    }

    if (requestUrl.pathname === "/api/discordbotlist/vote") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
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
            error: status === 413 ? "Request-Body ist zu groß." : "Ungültiges JSON im Request-Body.",
          });
          return;
        }
        log("ERROR", `DiscordBotList webhook error: ${err?.message || err}`);
        sendJson(res, 500, { success: false, error: "DiscordBotList Webhook fehlgeschlagen." });
      }
      return;
    }

    if (requestUrl.pathname === "/api/discordbotlist/sync") {
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
            error: status === 413 ? "Request-Body ist zu groß." : "Ungültiges JSON im Request-Body.",
          });
          return;
        }
        log("ERROR", `DiscordBotList sync API error: ${err?.message || err}`);
        sendJson(res, 500, { success: false, error: "DiscordBotList Sync fehlgeschlagen." });
      }
      return;
    }

    if (requestUrl.pathname === "/api/auth/discord/login") {
      const requestLanguage = resolveDashboardRequestLanguage(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      if (!isDiscordOauthConfigured()) {
        sendJson(res, 503, {
          error: languagePick(requestLanguage, "Discord OAuth ist noch nicht konfiguriert.", "Discord OAuth is not configured yet."),
          oauthConfigured: false,
        });
        return;
      }

      const nextPage = sanitizeDashboardPage(requestUrl.searchParams.get("nextPage"));
      const stateToken = randomBytes(24).toString("base64url");
      const frontendOrigin = getFrontendBaseOrigin(req, publicUrl);
      const nowTs = Math.floor(Date.now() / 1000);
      setDashboardOauthState(stateToken, {
        nextPage,
        language: requestLanguage,
        origin: frontendOrigin,
        createdAt: nowTs,
        expiresAt: nowTs + getDiscordOauthStateTtlSeconds(),
      });

      sendJson(res, 200, {
        oauthConfigured: true,
        authUrl: buildDiscordAuthorizeUrl(stateToken),
        state: stateToken,
      });
      return;
    }

    if (requestUrl.pathname === "/api/auth/discord/callback") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }

      const code = String(requestUrl.searchParams.get("code") || "").trim();
      const stateToken = String(requestUrl.searchParams.get("state") || "").trim();
      const fallbackOrigin = getFrontendBaseOrigin(req, publicUrl);
      const statePayload = popDashboardOauthState(stateToken);
      const frontendOrigin = statePayload?.origin || fallbackOrigin;
      const oauthLanguage = normalizeLanguage(statePayload?.language, getDefaultLanguage());

      if (!isDiscordOauthConfigured()) {
        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: buildDashboardErrorRedirect(frontendOrigin, "oauth_not_configured", oauthLanguage),
        });
        res.end();
        return;
      }
      if (!statePayload) {
        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: buildDashboardErrorRedirect(frontendOrigin, "invalid_state", oauthLanguage),
        });
        res.end();
        return;
      }
      if (!code) {
        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: buildDashboardErrorRedirect(frontendOrigin, "missing_code", oauthLanguage),
        });
        res.end();
        return;
      }

      try {
        const accessToken = await exchangeDiscordCodeForToken(code);
        const userProfile = await fetchDiscordUserProfile(accessToken);
        const guilds = await fetchDiscordUserGuilds(accessToken);
        const sessionToken = randomBytes(32).toString("base64url");
        const nowTs = Math.floor(Date.now() / 1000);
        setDashboardAuthSession(sessionToken, {
          user: userProfile,
          guilds,
          createdAt: nowTs,
          expiresAt: nowTs + getDashboardSessionTtlSeconds(),
        });

        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: `${frontendOrigin}/?page=${sanitizeDashboardPage(statePayload.nextPage)}&lang=${encodeURIComponent(oauthLanguage)}`,
          "Set-Cookie": buildDashboardSessionCookie(sessionToken, req, frontendOrigin),
        });
        res.end();
      } catch (err) {
        log("ERROR", `Discord OAuth callback failed: ${err?.message || err}`);
        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: buildDashboardErrorRedirect(frontendOrigin, "oauth_exchange_failed", oauthLanguage),
        });
        res.end();
      }
      return;
    }

    if (requestUrl.pathname === "/api/auth/session") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }

      const { session } = getDashboardSession(req);
      if (!session) {
        sendJson(res, 200, {
          authenticated: false,
          oauthConfigured: isDiscordOauthConfigured(),
          user: null,
          guilds: [],
        });
        return;
      }

      sendJson(res, 200, {
        authenticated: true,
        oauthConfigured: isDiscordOauthConfigured(),
        user: session.user || null,
        guilds: resolveDashboardGuildsForSession(session),
        expiresAt: session.expiresAt || null,
      });
      return;
    }

    if (requestUrl.pathname === "/api/auth/logout") {
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }

      const { token } = getDashboardSession(req);
      if (token) {
        deleteDashboardAuthSession(token);
      }
      res.writeHead(200, {
        ...getCommonSecurityHeaders(),
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Set-Cookie": buildDashboardSessionCookieDeletion(req, getFrontendBaseOrigin(req, publicUrl)),
      });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    if (requestUrl.pathname === "/api/dashboard/guilds") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
        return;
      }
      sendJson(res, 200, { guilds: resolveDashboardGuildsForSession(session) });
      return;
    }

    if (requestUrl.pathname === "/api/dashboard/capabilities") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
        return;
      }
      const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guild) {
        sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
        return;
      }
      sendJson(res, 200, buildServerCapabilityPayload(guild.id));
      return;
    }
    if (await handleDashboardStatsRoute({ req, res, requestUrl, runtimes })) {
      return;
    }

    // Global stats endpoint (public, anonymized)
    if (requestUrl.pathname === "/api/stats/global") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      try {
        const globalStats = await getGlobalStats();
        sendJson(res, 200, globalStats);
      } catch (err) {
        log("ERROR", `Global stats error: ${err?.message || err}`);
        sendJson(res, 500, { error: "Globale Statistiken konnten nicht geladen werden." });
      }
      return;
    }

    if (requestUrl.pathname === "/api/dashboard/telemetry") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return;
      }
      if (!isAdminApiRequest(req)) {
        sendJson(res, 401, { error: "Unauthorized. API admin token required." });
        return;
      }
      const serverId = String(requestUrl.searchParams.get("serverId") || "").trim();
      if (!/^\d{17,22}$/.test(serverId)) {
        sendLocalizedError(res, 400, language, "Ungültige serverId.", "Invalid serverId.");
        return;
      }
      try {
        const body = await readJsonBody();
        const telemetry = setDashboardTelemetry(serverId, normalizeDashboardTelemetryPayload(body));
        sendJson(res, 200, { success: true, serverId, telemetry });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
          return;
        }
        sendLocalizedError(res, 500, language, "Telemetry konnte nicht gespeichert werden.", "Telemetry could not be saved.");
      }
      return;
    }
    if (await handleDashboardEventsRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    if (await handleDashboardPermsRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }
    if (await handleDashboardChannelsRoute({ req, res, requestUrl, runtimes })) {
      return;
    }

    // --- Dashboard: Guild Emojis ---
    if (requestUrl.pathname === "/api/dashboard/emojis") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return; }
      const { session } = getDashboardSession(req);
      if (!session) { sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in."); return; }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) { sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server."); return; }
      if (!serverHasCapability(guildInfo.id, "dashboard_access")) { sendLocalizedError(res, 403, language, "Dashboard ist erst ab Pro verfügbar.", "Dashboard is only available from Pro."); return; }

      const { guild } = resolveRuntimeForGuild(runtimes, guildInfo.id);
      if (!guild) { sendJson(res, 200, { emojis: [] }); return; }

      try { await guild.emojis.fetch(); } catch {}
      const emojis = [];
      for (const [, emoji] of guild.emojis.cache) {
        emojis.push({
          id: emoji.id,
          name: emoji.name || "",
          animated: !!emoji.animated,
          url: emoji.animated
            ? `https://cdn.discordapp.com/emojis/${emoji.id}.gif?size=48`
            : `https://cdn.discordapp.com/emojis/${emoji.id}.webp?size=48`,
          requiresColons: emoji.requiresColons !== false,
          managed: !!emoji.managed,
          available: emoji.available !== false,
        });
      }
      emojis.sort((a, b) => a.name.localeCompare(b.name));
      sendJson(res, 200, { emojis });
      return;
    }

    // --- Dashboard: All Stations (Free + Pro + Custom) ---
    if (requestUrl.pathname === "/api/dashboard/stations") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return; }
      const { session } = getDashboardSession(req);
      if (!session) { sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in."); return; }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) { sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server."); return; }
      if (!serverHasCapability(guildInfo.id, "dashboard_access")) { sendLocalizedError(res, 403, language, "Dashboard ist erst ab Pro verfügbar.", "Dashboard is only available from Pro."); return; }

      const allStations = loadStations();
      const tierStations = filterStationsByTier(allStations.stations || {}, guildInfo.tier);
      const freeStations = {};
      const proStations = {};
      const ultimateStations = {};
      for (const [key, st] of Object.entries(tierStations)) {
        const tier = String(st?.tier || "free").toLowerCase();
        if (tier === "ultimate") {
          ultimateStations[key] = st;
        } else if (tier === "pro") {
          proStations[key] = st;
        } else {
          freeStations[key] = st;
        }
      }

      const formatList = (obj) => Object.entries(obj).map(([key, st]) => ({
        key, name: st.name || key, url: st.url || "", genre: st.genre || "", country: st.country || "",
      })).sort((a, b) => a.name.localeCompare(b.name));

      const customStations = serverHasCapability(guildInfo.id, "custom_station_urls") ? getCustomStations(guildInfo.id) : {};
      const customList = Object.entries(customStations)
        .map(([key, st]) => mapDashboardCustomStation(key, st))
        .sort((a, b) => {
          const folderCompare = String(a.folder || "").localeCompare(String(b.folder || ""));
          if (folderCompare !== 0) return folderCompare;
          return a.name.localeCompare(b.name);
        });

      sendJson(res, 200, {
        free: formatList(freeStations),
        pro: formatList(proStations),
        ultimate: formatList(ultimateStations),
        custom: customList,
        tier: guildInfo.tier,
      });
      return;
    }

    // --- Dashboard: Custom Stations CRUD ---
    if (requestUrl.pathname === "/api/dashboard/custom-stations") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      const { session } = getDashboardSession(req);
      if (!session) { sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in."); return; }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) { sendLocalizedError(res, 403, language, "Kein Zugriff.", "No access."); return; }
      if (!serverHasCapability(guildInfo.id, "dashboard_access")) { sendLocalizedError(res, 403, language, "Dashboard ist erst ab Pro verfügbar.", "Dashboard is only available from Pro."); return; }
      if (!serverHasCapability(guildInfo.id, "custom_station_urls")) {
        sendLocalizedError(
          res,
          403,
          language,
          "Custom-Stationen sind nur für Ultimate verfügbar.",
          "Custom stations are only available for Ultimate."
        );
        return;
      }

      if (req.method === "GET") {
        const stations = getCustomStations(guildInfo.id);
        const list = Object.entries(stations)
          .map(([key, st]) => mapDashboardCustomStation(key, st))
          .sort((a, b) => {
            const folderCompare = String(a.folder || "").localeCompare(String(b.folder || ""));
            if (folderCompare !== 0) return folderCompare;
            return a.name.localeCompare(b.name);
          });
        sendJson(res, 200, { stations: list, tier: guildInfo.tier });
        return;
      }

      if (req.method === "POST") {
        try {
          const body = await readJsonBody();
          const key = clipText(body?.key || "", 80).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
          const name = clipText(body?.name || "", 120).trim();
          const url = clipText(body?.url || "", 500).trim();
          if (!key || !name || !url) {
            sendLocalizedError(res, 400, language, "Key, Name und URL sind erforderlich.", "Key, name and URL are required.");
            return;
          }
          const result = await addCustomStation(guildInfo.id, key, {
            name,
            url,
            genre: clipText(body?.genre || "", 80),
            folder: clipText(body?.folder || "", 80),
            tags: Array.isArray(body?.tags)
              ? body.tags.map((tag) => clipText(tag || "", 40))
              : clipText(body?.tags || "", 240),
          });
          if (!result?.success) {
            sendJson(res, 400, {
              error: translateCustomStationErrorMessage(
                result?.error || languagePick(language, "Station konnte nicht hinzugefügt werden.", "Station could not be added."),
                language
              ),
            });
            return;
          }
          sendJson(res, 201, { success: true, station: mapDashboardCustomStation(result.key, result.station) });
        } catch (err) {
          sendJson(res, 400, {
            error: translateCustomStationErrorMessage(
              err?.message || languagePick(language, "Ungültige Anfrage.", "Invalid request."),
              language
            ),
          });
        }
        return;
      }

      if (req.method === "DELETE") {
        const key = requestUrl.searchParams.get("key");
        if (!key) { sendLocalizedError(res, 400, language, "Station-Key fehlt.", "Station key is missing."); return; }
        const result = removeCustomStation(guildInfo.id, key);
        sendJson(res, 200, { success: !!result, key });
        return;
      }

      if (req.method === "PUT") {
        try {
          const body = await readJsonBody();
          const key = clipText(body?.key || "", 80).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
          if (!key) { sendLocalizedError(res, 400, language, "Station-Key fehlt.", "Station key is missing."); return; }
          const existing = getCustomStations(guildInfo.id);
          if (!existing[key]) { sendLocalizedError(res, 404, language, "Station nicht gefunden.", "Station was not found."); return; }
          const current = existing[key];
          const updated = {
            name: clipText(body?.name || current.name || key, 120).trim(),
            url: clipText(body?.url || current.url || "", 500).trim(),
            genre: clipText(body?.genre !== undefined ? body.genre : (current.genre || ""), 80),
            folder: clipText(body?.folder !== undefined ? body.folder : (current.folder || ""), 80),
            tags: Array.isArray(body?.tags)
              ? body.tags.map((tag) => clipText(tag || "", 40))
              : (body?.tags !== undefined ? clipText(body.tags || "", 240) : (current.tags || [])),
          };
          const result = await updateCustomStation(guildInfo.id, key, updated);
          if (!result?.success) {
            sendJson(res, 400, {
              error: translateCustomStationErrorMessage(
                result?.error || languagePick(language, "Station konnte nicht aktualisiert werden.", "Station could not be updated."),
                language
              ),
            });
            return;
          }
          sendJson(res, 200, { success: true, station: mapDashboardCustomStation(result.key, result.station) });
        } catch (err) {
          sendJson(res, 400, {
            error: translateCustomStationErrorMessage(
              err?.message || languagePick(language, "Ungültige Anfrage.", "Invalid request."),
              language
            ),
          });
        }
        return;
      }

      methodNotAllowed(res, ["GET", "POST", "PUT", "DELETE"]);
      return;
    }
    if (await handleDashboardRolesRoute({ req, res, requestUrl, runtimes })) {
      return;
    }

    if (await handleDashboardLicenseRoute({ req, res, requestUrl, readJsonBody })) {
      return;
    }

    if (await handleDashboardSettingsRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
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
              "Bitte eine gültige E-Mail-Adresse eingeben.",
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
                ? "Request-Body ist zu groß."
                : "Ungültiges JSON im Request-Body."
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
        } = body;
        const rawCouponCode = body?.couponCode ?? body?.coupon ?? "";
        const rawReferralCode = body?.referralCode ?? body?.referral ?? "";
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
          sendJson(res, 400, { error: t("Bitte eine gültige E-Mail-Adresse eingeben.", "Please enter a valid email address.") });
          return;
        }
        if (tier !== "pro" && tier !== "ultimate") {
          sendJson(res, 400, { error: t("tier muss 'pro' oder 'ultimate' sein.", "tier must be 'pro' or 'ultimate'.") });
          return;
        }

        const durationMonths = normalizeDuration(months);
        const seats = normalizeSeats(rawSeats);
        const requestedSeats = rawSeats === undefined || rawSeats === null || rawSeats === ""
          ? null
          : Number.parseInt(String(rawSeats), 10);
        if (requestedSeats !== null && !SEAT_OPTIONS.includes(requestedSeats)) {
          sendJson(res, 400, {
            error: t(
              `seats muss einer der Werte ${SEAT_OPTIONS.join(", ")} sein.`,
              `seats must be one of ${SEAT_OPTIONS.join(", ")}.`
            ),
          });
          return;
        }

        const stripeKey = getStripeSecretKey();
        if (!stripeKey) {
          sendJson(res, 503, { error: t("Stripe nicht konfiguriert. Nutze: ./update.sh --stripe", "Stripe is not configured. Use: ./update.sh --stripe") });
          return;
        }

        const basePriceInCents = calculatePrice(tier, durationMonths, seats);
        if (basePriceInCents <= 0) {
          sendJson(res, 400, { error: t("Ungültige Preisberechnung für die gewählte Kombination.", "Invalid price calculation for the selected combination.") });
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
          sendJson(res, 400, { error: t("Preis ist nach Rabatt ungültig.", "Price is invalid after discount.") });
          return;
        }
        const tierName = TIERS[tier].name;
        const seatsLabel = seats > 1
          ? (isDe ? ` (${seats} Server)` : ` (${seats} servers)`)
          : "";
        let description;
        if (durationMonths >= 12) {
          description = isDe
            ? `${tierName}${seatsLabel} - ${durationMonths} Monate`
            : `${tierName}${seatsLabel} - ${durationMonths} months`;
        } else {
          description = isDe
            ? `${tierName}${seatsLabel} - ${durationMonths} Monat${durationMonths > 1 ? "e" : ""}`
            : `${tierName}${seatsLabel} - ${durationMonths} month${durationMonths > 1 ? "s" : ""}`;
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
                ? "Request-Body ist zu groß."
                : "Ungültiges JSON im Request-Body."
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
          language: rawLanguage,
        } = body || {};
        const couponCode = body?.couponCode ?? body?.coupon ?? "";
        const referralCode = body?.referralCode ?? body?.referral ?? "";
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

        const durationMonths = normalizeDuration(months);
        const seats = normalizeSeats(rawSeats);
        const requestedSeats = rawSeats === undefined || rawSeats === null || rawSeats === ""
          ? null
          : Number.parseInt(String(rawSeats), 10);
        if (requestedSeats !== null && !SEAT_OPTIONS.includes(requestedSeats)) {
          sendJson(res, 400, {
            success: false,
            error: t(
              `seats muss einer der Werte ${SEAT_OPTIONS.join(", ")} sein.`,
              `seats must be one of ${SEAT_OPTIONS.join(", ")}.`
            ),
          });
          return;
        }
        const baseAmountCents = calculatePrice(cleanTier, durationMonths, seats);
        if (baseAmountCents <= 0) {
          sendJson(res, 400, {
            success: false,
            error: t("Ungültige Preisberechnung für die gewählte Kombination.", "Invalid price calculation for the selected combination."),
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
            error: status === 413 ? "Request-Body ist zu groß." : "Ungültiges JSON im Request-Body.",
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
          sendJson(res, 400, { error: `Webhook-Signatur ungültig: ${err.message}` });
          return;
        }

        if (!event?.id) {
          sendJson(res, 400, { error: "Webhook-Event ungültig." });
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
          sendJson(res, 413, { error: "Webhook-Body ist zu groß." });
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
              ? "Request-Body ist zu groß."
              : "Ungültiges JSON im Request-Body.",
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
            ]
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
            ]
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
            ]
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
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "API route not found." });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      methodNotAllowed(res, ["GET", "HEAD"]);
      return;
    }

    // --- Static file serving from the built frontend ---
    const staticPath = requestUrl.pathname === "/"
      ? "index.html"
      : requestUrl.pathname.replace(/^\/+/, "");
    const filePath = path.join(webDir, staticPath);
    sendStaticFile(res, filePath, { headOnly: req.method === "HEAD" });
  });

  server.listen(webInternalPort, webBind, () => {
    log("INFO", `Webseite aktiv (container) auf http://${webBind}:${webInternalPort}`);
    log("INFO", `Webseite Host-Port: ${webPort}`);
    log("INFO", `Web-Static-Root: ${webDir}`);
    log("INFO", `Web-Root-Quelle: ${webRootSource}`);
    if (frontendBuildStamp) {
      log("INFO", `Frontend-Build-Timestamp: ${frontendBuildStamp}`);
    }
    if (publicUrl) {
      log("INFO", `Public URL: ${publicUrl}`);
    }
  });

  return server;
}

export { startWebServer };
