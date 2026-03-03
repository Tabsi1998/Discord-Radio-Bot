// ============================================================
// OmniFM: Web Server & API Routes
// ============================================================
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { ChannelType, PermissionFlagsBits } from "discord.js";

import { log, webDir, webRootSource, frontendBuildStamp } from "../lib/logging.js";
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
import { languagePick } from "../lib/language.js";
import {
  EVENT_FALLBACK_TIME_ZONE,
  getZonedPartsFromUtcMs,
  normalizeEventTimeZone,
  normalizeRepeatMode,
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
import { loadStations, filterStationsByTier } from "../stations-store.js";
import { buildPublicStationCatalog } from "../lib/public-stations.js";
import {
  getGuildStations as getCustomStations,
  addGuildStation as addCustomStation,
  updateGuildStation as updateCustomStation,
  removeGuildStation as removeCustomStation,
} from "../custom-stations.js";
import { getTier, checkFeatureAccess, getServerPlanConfig } from "../core/entitlements.js";
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
import {
  listOffers,
  upsertOffer,
  deleteOffer,
  setOfferActive,
  listRecentRedemptions,
  getOffer,
} from "../coupon-store.js";
import { PLANS, BRAND } from "../config/plans.js";
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

function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

function getLicense(guildId) {
  return getServerLicense(guildId);
}

function extractMailbox(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) return "";
  const bracketMatch = text.match(/<([^>]+)>/);
  if (bracketMatch?.[1]) return bracketMatch[1].trim();
  const plainMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plainMatch?.[0] || "";
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
      const tier = getTier(guild.id);
      return {
        id: guild.id,
        name: clipText(guild.name || guild.id, 120),
        icon: clipText(guild.icon || "", 120),
        owner: Boolean(guild.owner),
        permissions: String(guild.permissions || "0"),
        tier,
        dashboardEnabled: (TIER_RANK[tier] || 0) >= (TIER_RANK.pro || 1),
        ultimateEnabled: tier === "ultimate",
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveDashboardGuildForSession(sessionPayload, serverId) {
  const guildId = String(serverId || "").trim();
  if (!/^\d{17,22}$/.test(guildId)) return null;
  return resolveDashboardGuildsForSession(sessionPayload).find((guild) => guild.id === guildId) || null;
}

function buildDashboardErrorRedirect(origin, errorCode) {
  const safeOrigin = toOrigin(origin) || "http://localhost";
  return `${safeOrigin}/?page=dashboard&authError=${encodeURIComponent(String(errorCode || "oauth_error"))}`;
}

function resolveRuntimeForGuild(runtimes, guildId) {
  const sorted = [...runtimes].sort((a, b) => {
    if (a.role === "commander" && b.role !== "commander") return -1;
    if (a.role !== "commander" && b.role === "commander") return 1;
    return Number(a?.config?.index || 0) - Number(b?.config?.index || 0);
  });

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
      });
    }
  }
  return rows;
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

  const stationBreakdown = Object.entries(listeningStats.stationStarts || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name, starts]) => ({
      name: listeningStats.stationNames?.[name] || name,
      starts: Number(starts || 0) || 0,
      peakListeners: 0,
    }));

  const liveTopStation = liveRows
    .slice()
    .sort((a, b) => b.listeners - a.listeners || String(a.stationName).localeCompare(String(b.stationName)))[0];
  const historicalTopStation = stationBreakdown[0];
  const topStation = liveTopStation
    ? { name: liveTopStation.stationName || "-", listeners: liveTopStation.listeners || 0 }
    : telemetry.topStation?.name && telemetry.topStation.name !== "-"
      ? telemetry.topStation
      : historicalTopStation
        ? { name: historicalTopStation.name, listeners: historicalTopStation.peakListeners || 0 }
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
  };

  if (tier !== "ultimate") {
    return { basic, advanced: null };
  }

  const advanced = {
    listenersByChannel: listenersByChannel.size
      ? [...listenersByChannel.values()].sort((a, b) => b.listeners - a.listeners || a.name.localeCompare(b.name))
      : telemetry.listenersByChannel,
    dailyReport: telemetry.dailyReport,
    stationBreakdown: stationBreakdown.length ? stationBreakdown : telemetry.stationBreakdown,
    hours: listeningStats.hours || {},
    daysOfWeek: listeningStats.daysOfWeek || {},
    stationListeningMs: listeningStats.stationListeningMs || {},
    commands: listeningStats.commands || {},
    voiceChannels: listeningStats.voiceChannels || {},
    firstSeenAt: listeningStats.firstSeenAt || 0,
  };

  return { basic, advanced };
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
    return { ok: false, message: "Der Bot ist auf diesem Server aktuell nicht verfuegbar." };
  }

  const me = await runtime.resolveBotMember(guild);
  if (!me) {
    return { ok: false, message: languagePick(language, "Bot-Mitglied im Server konnte nicht geladen werden.", "Could not load the bot member in this server.") };
  }

  const { channel: voiceChannel } = await runtime.resolveGuildVoiceChannel(guild.id, event.voiceChannelId);
  if (!voiceChannel) {
    return { ok: false, message: languagePick(language, "Bitte waehle einen Voice- oder Stage-Channel.", "Please choose a voice or stage channel.") };
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
        `Ich habe keine Connect-Berechtigung fuer ${voiceChannel.toString()}.`,
        `I do not have Connect permission for ${voiceChannel.toString()}.`
      ),
    };
  }
  if (voiceChannel.type !== ChannelType.GuildStageVoice && !voicePerms?.has(PermissionFlagsBits.Speak)) {
    return {
      ok: false,
      message: languagePick(
        language,
        `Ich habe keine Speak-Berechtigung fuer ${voiceChannel.toString()}.`,
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
          "Der gewaehlte Text-Channel ist nicht in diesem Server.",
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

  if (!title) return { ok: false, message: "Titel fehlt." };
  if (!stationKey) return { ok: false, message: "Station Key fehlt." };
  if (!/^\d{17,22}$/.test(channelId)) return { ok: false, message: "Voice Channel ID fehlt oder ist ungueltig." };
  if (textChannelId && !/^\d{17,22}$/.test(textChannelId)) return { ok: false, message: "Text Channel ID ist ungueltig." };
  if (!timezone) return { ok: false, message: "Zeitzone ist ungueltig." };
  if (!botId) return { ok: false, message: "Kein geeigneter Bot fuer dieses Event gefunden." };

  const startInput = parseDashboardStartsAtInput(payload);
  let parsedWindow;
  if (startInput.mode === "legacy_iso") {
    const parsedRunAtMs = Date.parse(startInput.value);
    if (!Number.isFinite(parsedRunAtMs) || parsedRunAtMs <= 0) {
      return { ok: false, message: "Startzeit ist ungueltig." };
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
    return { ok: false, message: parsedWindow?.message || "Startzeit ist ungueltig." };
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
            error: status === 413 ? "Request-Body ist zu gross." : "Ungueltiges JSON im Request-Body.",
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
            error: status === 413 ? "Request-Body ist zu gross." : "Ungueltiges JSON im Request-Body.",
          });
          return;
        }
        log("ERROR", `DiscordBotList sync API error: ${err?.message || err}`);
        sendJson(res, 500, { success: false, error: "DiscordBotList Sync fehlgeschlagen." });
      }
      return;
    }

    const dashboardEventMatch = requestUrl.pathname.match(/^\/api\/dashboard\/events\/([^/]+)$/);

    if (requestUrl.pathname === "/api/auth/discord/login") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      if (!isDiscordOauthConfigured()) {
        sendJson(res, 503, {
          error: "Discord OAuth ist noch nicht konfiguriert.",
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

      if (!isDiscordOauthConfigured()) {
        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: buildDashboardErrorRedirect(frontendOrigin, "oauth_not_configured"),
        });
        res.end();
        return;
      }
      if (!statePayload) {
        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: buildDashboardErrorRedirect(frontendOrigin, "invalid_state"),
        });
        res.end();
        return;
      }
      if (!code) {
        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: buildDashboardErrorRedirect(frontendOrigin, "missing_code"),
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
          Location: `${frontendOrigin}/?page=${sanitizeDashboardPage(statePayload.nextPage)}`,
          "Set-Cookie": buildDashboardSessionCookie(sessionToken, req, frontendOrigin),
        });
        res.end();
      } catch (err) {
        log("ERROR", `Discord OAuth callback failed: ${err?.message || err}`);
        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: buildDashboardErrorRedirect(frontendOrigin, "oauth_exchange_failed"),
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
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const { session } = getDashboardSession(req);
      if (!session) {
        sendJson(res, 401, { error: "Nicht eingeloggt." });
        return;
      }
      sendJson(res, 200, { guilds: resolveDashboardGuildsForSession(session) });
      return;
    }

    if (requestUrl.pathname === "/api/dashboard/stats") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const { session } = getDashboardSession(req);
      if (!session) {
        sendJson(res, 401, { error: "Nicht eingeloggt." });
        return;
      }

      const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guild) {
        sendJson(res, 403, { error: "Kein Zugriff auf diesen Server." });
        return;
      }
      if ((TIER_RANK[guild.tier] || 0) < (TIER_RANK.pro || 1)) {
        sendJson(res, 403, { error: "Dashboard ist erst ab Pro verfuegbar." });
        return;
      }

      const statsPayload = buildDashboardStatsForGuild(guild.id, guild.tier, runtimes);
      sendJson(res, 200, {
        serverId: guild.id,
        tier: guild.tier,
        basic: statsPayload.basic,
        advanced: guild.tier === "ultimate" ? statsPayload.advanced : null,
      });
      return;
    }

    // --- Dashboard: Stats Reset ---
    if (requestUrl.pathname === "/api/dashboard/stats/reset") {
      if (req.method !== "DELETE") { methodNotAllowed(res, ["DELETE"]); return; }
      const { session } = getDashboardSession(req);
      if (!session) { sendJson(res, 401, { error: "Nicht eingeloggt." }); return; }
      const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guild) { sendJson(res, 403, { error: "Kein Zugriff auf diesen Server." }); return; }

      const gid = guild.id;
      const deletedCounts = {};
      try {
        const { getDb } = await import("../lib/db.js");
        const db = getDb();
        if (db) {
          for (const coll of ["daily_stats", "listening_sessions", "listener_snapshots"]) {
            const r = await db.collection(coll).deleteMany({ guildId: gid });
            deletedCounts[coll] = r.deletedCount || 0;
          }
          const r2 = await db.collection("guild_stats").deleteMany({ guildId: gid });
          deletedCounts["guild_stats"] = r2.deletedCount || 0;
        }
        // Reset in-memory stats
        const { resetGuildStats } = await import("../listening-stats-store.js");
        if (typeof resetGuildStats === "function") resetGuildStats(gid);
      } catch (err) {
        console.error(`[stats-reset] Error for guild ${gid}: ${err.message}`);
        sendJson(res, 500, { error: `Fehler beim Zuruecksetzen: ${err.message}` });
        return;
      }
      sendJson(res, 200, { success: true, serverId: gid, deleted: deletedCounts });
      return;
    }

    // Enhanced stats endpoint with daily, session, connection, timeline data
    if (requestUrl.pathname === "/api/dashboard/stats/detail") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return;
      }
      const { session } = getDashboardSession(req);
      if (!session) {
        sendJson(res, 401, { error: "Nicht eingeloggt." });
        return;
      }

      const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guild) {
        sendJson(res, 403, { error: "Kein Zugriff auf diesen Server." });
        return;
      }
      if (guild.tier !== "ultimate") {
        sendJson(res, 403, { error: "Detaillierte Statistiken sind nur fuer Ultimate verfuegbar." });
        return;
      }

      try {
        const days = Math.min(90, Math.max(1, Number.parseInt(String(requestUrl.searchParams.get("days") || "30"), 10) || 30));
        const [dailyStats, sessionHistory, connectionHealth, listenerTimeline, activeSessions] = await Promise.all([
          getGuildDailyStats(guild.id, days),
          getGuildSessionHistory(guild.id, 20),
          getGuildConnectionHealth(guild.id, 7),
          getGuildListenerTimeline(guild.id, 24),
          Promise.resolve(getActiveSessionsForGuild(guild.id)),
        ]);

        const listeningStats = getGuildListeningStats(guild.id) || {};

        sendJson(res, 200, {
          serverId: guild.id,
          tier: guild.tier,
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
            peakListeners: s.peakListeners,
            avgListeners: s.avgListeners,
          })),
          connectionHealth,
          listenerTimeline,
          activeSessions: activeSessions.map((s) => ({
            botId: s.botId,
            stationKey: s.stationKey,
            stationName: s.stationName,
            channelId: s.channelId,
            currentDurationMs: s.currentDurationMs,
            currentListeners: s.currentListeners,
            peakListeners: s.peakListeners,
          })),
        });
      } catch (err) {
        log("ERROR", `Dashboard detail stats error: ${err?.message || err}`);
        sendJson(res, 500, { error: "Detaillierte Statistiken konnten nicht geladen werden." });
      }
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
        sendJson(res, 400, { error: "ungueltige serverId" });
        return;
      }
      try {
        const body = await readJsonBody();
        const telemetry = setDashboardTelemetry(serverId, normalizeDashboardTelemetryPayload(body));
        sendJson(res, 200, { success: true, serverId, telemetry });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, { error: status === 413 ? "Request-Body ist zu gross." : "Ungueltiges JSON im Request-Body." });
          return;
        }
        sendJson(res, 500, { error: "Telemetry konnte nicht gespeichert werden." });
      }
      return;
    }

    if (requestUrl.pathname === "/api/dashboard/events") {
      const { session } = getDashboardSession(req);
      if (!session) {
        sendJson(res, 401, { error: "Nicht eingeloggt." });
        return;
      }

      const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guild) {
        sendJson(res, 403, { error: "Kein Zugriff auf diesen Server." });
        return;
      }
      if ((TIER_RANK[guild.tier] || 0) < (TIER_RANK.pro || 1)) {
        sendJson(res, 403, { error: "Events sind erst ab Pro verfuegbar." });
        return;
      }

      if (req.method === "GET") {
        const events = listScheduledEvents({ guildId: guild.id }).map((eventRow) => buildDashboardEventResponse(eventRow));
        sendJson(res, 200, { serverId: guild.id, events });
        return;
      }

      if (req.method === "POST") {
        try {
          const body = await readJsonBody();
          const { runtime, guild: managedGuild } = resolveRuntimeForGuild(runtimes, guild.id);
          if (!runtime || !managedGuild) {
            sendJson(res, 400, { error: "Der Bot ist auf diesem Server aktuell nicht verfuegbar." });
            return;
          }
          const normalized = await normalizeDashboardEventInput(body, {
            guildId: guild.id,
            botId: runtime?.config?.id || "",
            runtime,
          });
          if (!normalized.ok) {
            sendJson(res, 400, { error: normalized.message });
            return;
          }

          const channelValidation = await validateDashboardEventChannels(runtime, managedGuild, normalized.event);
          if (!channelValidation.ok) {
            sendJson(res, 400, { error: channelValidation.message });
            return;
          }

          if (runtime.role === "commander" && runtime.workerManager && normalized.event.enabled !== false) {
            const invitedWorkers = runtime.workerManager.getInvitedWorkers(guild.id, getTier(guild.id));
            if (!invitedWorkers.length) {
              sendJson(res, 400, {
                error: "Kein geeigneter Worker-Bot ist auf diesem Server eingeladen. Bitte zuerst einen Worker mit /invite worker:1 einladen.",
              });
              return;
            }
          }

          const result = createScheduledEvent({
            ...normalized.event,
            discordScheduledEventId: null,
            discordSyncError: null,
            activeUntilMs: 0,
            deleteAfterStop: false,
            createdByUserId: session?.user?.id || null,
          });
          if (!result?.ok || !result?.event) {
            sendJson(res, 400, { error: result?.message || "Event konnte nicht erstellt werden." });
            return;
          }

          let replyEvent = result.event;
          const shouldSyncDiscordEvent = replyEvent.createDiscordEvent === true && replyEvent.enabled !== false;
          if (shouldSyncDiscordEvent) {
            try {
              const scheduledEvent = await runtime.syncDiscordScheduledEvent(replyEvent, normalized.station.station, {
                runAtMs: replyEvent.runAtMs,
              });
              const synced = patchScheduledEvent(
                replyEvent.id,
                buildDashboardDiscordSyncPatch(replyEvent, {
                  discordScheduledEventId: scheduledEvent?.id || replyEvent.discordScheduledEventId || null,
                  discordSyncError: null,
                })
              );
              replyEvent = synced?.event || {
                ...replyEvent,
                ...buildDashboardDiscordSyncPatch(replyEvent, {
                  discordScheduledEventId: scheduledEvent?.id || replyEvent.discordScheduledEventId || null,
                  discordSyncError: null,
                }),
              };
            } catch (err) {
              const syncPatch = buildDashboardDiscordSyncPatch(replyEvent, {
                discordScheduledEventId: replyEvent.discordScheduledEventId || null,
                discordSyncError: err?.message || err,
              });
              const patched = patchScheduledEvent(replyEvent.id, syncPatch);
              replyEvent = patched?.event || { ...replyEvent, ...syncPatch };
              log("WARN", `[dashboard] Event ${replyEvent.id}: Discord-Server-Event konnte nicht erstellt werden: ${err?.message || err}`);
            }
          }

          if (replyEvent.enabled && replyEvent.runAtMs <= Date.now() + 5_000) {
            runtime.queueImmediateScheduledEventTick(250);
          }

          sendJson(res, 200, {
            success: true,
            event: buildDashboardEventResponse(replyEvent),
          });
        } catch (err) {
          const status = Number(err?.status || 0);
          if (status === 400 || status === 413) {
            sendJson(res, status, { error: status === 413 ? "Request-Body ist zu gross." : "Ungueltiges JSON im Request-Body." });
            return;
          }
          sendJson(res, 500, { error: "Event konnte nicht erstellt werden." });
        }
        return;
      }

      methodNotAllowed(res, ["GET", "POST"]);
      return;
    }

    if (dashboardEventMatch) {
      const { session } = getDashboardSession(req);
      if (!session) {
        sendJson(res, 401, { error: "Nicht eingeloggt." });
        return;
      }

      const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guild) {
        sendJson(res, 403, { error: "Kein Zugriff auf diesen Server." });
        return;
      }
      if ((TIER_RANK[guild.tier] || 0) < (TIER_RANK.pro || 1)) {
        sendJson(res, 403, { error: "Events sind erst ab Pro verfuegbar." });
        return;
      }

      const eventId = decodeURIComponent(dashboardEventMatch[1] || "").trim();
      if (!eventId) {
        sendJson(res, 400, { error: "Event-ID fehlt." });
        return;
      }

      if (req.method === "PATCH") {
        try {
          const existingEvent = getScheduledEvent(eventId);
          if (!existingEvent || String(existingEvent.guildId || "") !== guild.id) {
            sendJson(res, 404, { error: "Event nicht gefunden." });
            return;
          }

          const body = await readJsonBody();
          const { runtime, guild: managedGuild } = resolveRuntimeForGuild(runtimes, guild.id);
          if (!runtime || !managedGuild) {
            sendJson(res, 400, { error: "Der Bot ist auf diesem Server aktuell nicht verfuegbar." });
            return;
          }

          const normalized = await normalizeDashboardEventInput(body, {
            guildId: guild.id,
            botId: existingEvent.botId || runtime?.config?.id || "",
            runtime,
            existingEvent,
          });
          if (!normalized.ok) {
            sendJson(res, 400, { error: normalized.message });
            return;
          }

          const channelValidation = await validateDashboardEventChannels(runtime, managedGuild, normalized.event);
          if (!channelValidation.ok) {
            sendJson(res, 400, { error: channelValidation.message });
            return;
          }

          if (runtime.role === "commander" && runtime.workerManager && normalized.event.enabled !== false) {
            const invitedWorkers = runtime.workerManager.getInvitedWorkers(guild.id, getTier(guild.id));
            if (!invitedWorkers.length) {
              sendJson(res, 400, {
                error: "Kein geeigneter Worker-Bot ist auf diesem Server eingeladen. Bitte zuerst einen Worker mit /invite worker:1 einladen.",
              });
              return;
            }
          }

          const eventIsActive = Number.parseInt(String(existingEvent.activeUntilMs || 0), 10) > Date.now()
            && Number.parseInt(String(existingEvent.lastStopAtMs || 0), 10) < Number.parseInt(String(existingEvent.activeUntilMs || 0), 10);
          const result = patchScheduledEvent(eventId, {
            ...normalized.event,
            activeUntilMs: eventIsActive ? normalized.parsedWindow.endAtMs : 0,
          });
          if (!result?.ok || !result?.event) {
            sendJson(res, result?.message === "Event nicht gefunden." ? 404 : 400, {
              error: result?.message || "Event konnte nicht aktualisiert werden.",
            });
            return;
          }

          let replyEvent = result.event;
          const shouldSyncDiscordEvent = replyEvent.createDiscordEvent === true && replyEvent.enabled !== false;
          if (!shouldSyncDiscordEvent && existingEvent.discordScheduledEventId) {
            await runtime.deleteDiscordScheduledEventById(guild.id, existingEvent.discordScheduledEventId).catch(() => false);
            const cleared = patchScheduledEvent(
              eventId,
              buildDashboardDiscordSyncPatch(replyEvent, {
                discordScheduledEventId: null,
                discordSyncError: null,
              })
            );
            replyEvent = cleared?.event || {
              ...replyEvent,
              ...buildDashboardDiscordSyncPatch(replyEvent, {
                discordScheduledEventId: null,
                discordSyncError: null,
              }),
            };
          } else if (shouldSyncDiscordEvent) {
            try {
              const scheduledEvent = await runtime.syncDiscordScheduledEvent(replyEvent, normalized.station.station || { name: replyEvent.stationKey }, {
                runAtMs: replyEvent.runAtMs,
              });
              const synced = patchScheduledEvent(
                eventId,
                buildDashboardDiscordSyncPatch(replyEvent, {
                  discordScheduledEventId: scheduledEvent?.id || replyEvent.discordScheduledEventId || null,
                  discordSyncError: null,
                })
              );
              replyEvent = synced?.event || {
                ...replyEvent,
                ...buildDashboardDiscordSyncPatch(replyEvent, {
                  discordScheduledEventId: scheduledEvent?.id || replyEvent.discordScheduledEventId || null,
                  discordSyncError: null,
                }),
              };
            } catch (err) {
              const syncPatch = buildDashboardDiscordSyncPatch(replyEvent, {
                discordScheduledEventId: replyEvent.discordScheduledEventId || null,
                discordSyncError: err?.message || err,
              });
              const patched = patchScheduledEvent(eventId, syncPatch);
              replyEvent = patched?.event || { ...replyEvent, ...syncPatch };
              log("WARN", `[dashboard] Event ${eventId}: Discord-Server-Event Sync fehlgeschlagen: ${err?.message || err}`);
            }
          } else if (!replyEvent.createDiscordEvent && (replyEvent.discordScheduledEventId || replyEvent.discordSyncError)) {
            const cleared = patchScheduledEvent(
              eventId,
              buildDashboardDiscordSyncPatch(replyEvent, {
                discordScheduledEventId: null,
                discordSyncError: null,
              })
            );
            replyEvent = cleared?.event || {
              ...replyEvent,
              ...buildDashboardDiscordSyncPatch(replyEvent, {
                discordScheduledEventId: null,
                discordSyncError: null,
              }),
            };
          }

          if (replyEvent.enabled && replyEvent.runAtMs <= Date.now() + 5_000) {
            runtime.queueImmediateScheduledEventTick(250);
          }

          sendJson(res, 200, { success: true, event: buildDashboardEventResponse(replyEvent) });
        } catch (err) {
          const status = Number(err?.status || 0);
          if (status === 400 || status === 413) {
            sendJson(res, status, { error: status === 413 ? "Request-Body ist zu gross." : "Ungueltiges JSON im Request-Body." });
            return;
          }
          sendJson(res, 500, { error: "Event konnte nicht aktualisiert werden." });
        }
        return;
      }

      if (req.method === "DELETE") {
        const existingEvent = getScheduledEvent(eventId);
        if (!existingEvent || String(existingEvent.guildId || "") !== guild.id) {
          sendJson(res, 404, { error: "Event nicht gefunden." });
          return;
        }

        const { runtime } = resolveRuntimeForGuild(runtimes, guild.id);
        if (runtime
          && Number.parseInt(String(existingEvent.activeUntilMs || 0), 10) > Date.now()
          && Number.parseInt(String(existingEvent.lastStopAtMs || 0), 10) < Number.parseInt(String(existingEvent.activeUntilMs || 0), 10)
        ) {
          await runtime.executeScheduledEventStop({ ...existingEvent, deleteAfterStop: false });
        }

        let removedDiscordEvent = false;
        if (runtime && existingEvent.discordScheduledEventId) {
          removedDiscordEvent = await runtime.deleteDiscordScheduledEventById(guild.id, existingEvent.discordScheduledEventId).catch(() => false);
        }

        const result = deleteScheduledEvent(eventId, { guildId: guild.id });
        if (!result?.ok) {
          sendJson(res, result?.message === "Event nicht gefunden." ? 404 : 400, {
            error: result?.message || "Event konnte nicht geloescht werden.",
          });
          return;
        }
        sendJson(res, 200, { success: true, eventId, removedDiscordEvent });
        return;
      }

      methodNotAllowed(res, ["PATCH", "DELETE"]);
      return;
    }

    if (requestUrl.pathname === "/api/dashboard/perms") {
      const { session } = getDashboardSession(req);
      if (!session) {
        sendJson(res, 401, { error: "Nicht eingeloggt." });
        return;
      }

      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) {
        sendJson(res, 403, { error: "Kein Zugriff auf diesen Server." });
        return;
      }
      if ((TIER_RANK[guildInfo.tier] || 0) < (TIER_RANK.pro || 1)) {
        sendJson(res, 403, { error: "Berechtigungen sind erst ab Pro verfuegbar." });
        return;
      }

      const { guild } = resolveRuntimeForGuild(runtimes, guildInfo.id);
      if (guild?.roles?.fetch) {
        try { await guild.roles.fetch(); } catch {}
      }

      if (req.method === "GET") {
        const rules = getGuildCommandPermissionRules(guildInfo.id);
        sendJson(res, 200, {
          serverId: guildInfo.id,
          tier: guildInfo.tier,
          commandRoleMap: formatDashboardPermissionMapForClient(rules, guild),
          updatedAt: null,
        });
        return;
      }

      if (req.method === "PUT") {
        try {
          const body = await readJsonBody();
          const incomingMap = body?.commandRoleMap && typeof body.commandRoleMap === "object"
            ? body.commandRoleMap
            : {};
          const supportedCommands = getSupportedPermissionCommands();
          const unresolved = [];
          const resolvedCommands = [];

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

          if (unresolved.length) {
            sendJson(res, 400, {
              error: `Folgende Rollen konnten nicht aufgeloest werden: ${unresolved.join(" | ")}`,
            });
            return;
          }

          for (const command of supportedCommands) {
            resetCommandPermissions(guildInfo.id, command);
          }

          for (const item of resolvedCommands) {
            for (const roleId of item.roleIds) {
              setCommandRolePermission(guildInfo.id, item.command, roleId, "allow");
            }
          }

          const rules = getGuildCommandPermissionRules(guildInfo.id);
          sendJson(res, 200, {
            success: true,
            serverId: guildInfo.id,
            commandRoleMap: formatDashboardPermissionMapForClient(rules, guild),
            updatedAt: new Date().toISOString(),
          });
        } catch (err) {
          const status = Number(err?.status || 0);
          if (status === 400 || status === 413) {
            sendJson(res, status, { error: status === 413 ? "Request-Body ist zu gross." : "Ungueltiges JSON im Request-Body." });
            return;
          }
          sendJson(res, 500, { error: "Berechtigungen konnten nicht gespeichert werden." });
        }
        return;
      }

      methodNotAllowed(res, ["GET", "PUT"]);
      return;
    }

    // --- Dashboard: Discord Channels Sync ---
    if (requestUrl.pathname === "/api/dashboard/channels") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return; }
      const { session } = getDashboardSession(req);
      if (!session) { sendJson(res, 401, { error: "Nicht eingeloggt." }); return; }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) { sendJson(res, 403, { error: "Kein Zugriff auf diesen Server." }); return; }

      const { guild } = resolveRuntimeForGuild(runtimes, guildInfo.id);
      if (!guild) { sendJson(res, 200, { voiceChannels: [], textChannels: [] }); return; }

      try { await guild.channels.fetch(); } catch {}
      const voiceChannels = [];
      const textChannels = [];
      for (const [, ch] of guild.channels.cache) {
        const entry = { id: ch.id, name: ch.name, position: ch.position || 0, parentName: ch.parent?.name || "" };
        if (ch.type === 2 || ch.type === 13) voiceChannels.push({ ...entry, type: ch.type === 13 ? "stage" : "voice" });
        else if (ch.type === 0) textChannels.push(entry);
      }
      voiceChannels.sort((a, b) => a.position - b.position);
      textChannels.sort((a, b) => a.position - b.position);
      sendJson(res, 200, { voiceChannels, textChannels });
      return;
    }

    // --- Dashboard: Guild Emojis ---
    if (requestUrl.pathname === "/api/dashboard/emojis") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return; }
      const { session } = getDashboardSession(req);
      if (!session) { sendJson(res, 401, { error: "Nicht eingeloggt." }); return; }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) { sendJson(res, 403, { error: "Kein Zugriff auf diesen Server." }); return; }

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
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return; }
      const { session } = getDashboardSession(req);
      if (!session) { sendJson(res, 401, { error: "Nicht eingeloggt." }); return; }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) { sendJson(res, 403, { error: "Kein Zugriff auf diesen Server." }); return; }

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

      const customStations = getCustomStations(guildInfo.id);
      const customList = Object.entries(customStations).map(([key, st]) => ({
        key, name: st.name || key, url: st.url || "", genre: st.genre || "", custom: true,
      })).sort((a, b) => a.name.localeCompare(b.name));

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
      const { session } = getDashboardSession(req);
      if (!session) { sendJson(res, 401, { error: "Nicht eingeloggt." }); return; }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) { sendJson(res, 403, { error: "Kein Zugriff." }); return; }

      if (req.method === "GET") {
        const stations = getCustomStations(guildInfo.id);
        const list = Object.entries(stations).map(([key, st]) => ({
          key, name: st.name || key, url: st.url || "", genre: st.genre || "",
        })).sort((a, b) => a.name.localeCompare(b.name));
        sendJson(res, 200, { stations: list, tier: guildInfo.tier });
        return;
      }

      if (req.method === "POST") {
        try {
          const body = await readJsonBody();
          const key = clipText(body?.key || "", 80).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
          const name = clipText(body?.name || "", 120).trim();
          const url = clipText(body?.url || "", 500).trim();
          if (!key || !name || !url) { sendJson(res, 400, { error: "Key, Name und URL sind erforderlich." }); return; }
          const result = await addCustomStation(guildInfo.id, key, { name, url, genre: clipText(body?.genre || "", 80) });
          if (!result?.success) {
            sendJson(res, 400, { error: result?.error || "Station konnte nicht hinzugefügt werden." });
            return;
          }
          sendJson(res, 201, { success: true, station: { key: result.key, ...result.station } });
        } catch (err) {
          sendJson(res, 400, { error: err?.message || "Ungültige Anfrage." });
        }
        return;
      }

      if (req.method === "DELETE") {
        const key = requestUrl.searchParams.get("key");
        if (!key) { sendJson(res, 400, { error: "Station Key fehlt." }); return; }
        const result = removeCustomStation(guildInfo.id, key);
        sendJson(res, 200, { success: !!result, key });
        return;
      }

      if (req.method === "PUT") {
        try {
          const body = await readJsonBody();
          const key = clipText(body?.key || "", 80).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
          if (!key) { sendJson(res, 400, { error: "Station Key fehlt." }); return; }
          const existing = getCustomStations(guildInfo.id);
          if (!existing[key]) { sendJson(res, 404, { error: "Station nicht gefunden." }); return; }
          const current = existing[key];
          const updated = {
            name: clipText(body?.name || current.name || key, 120).trim(),
            url: clipText(body?.url || current.url || "", 500).trim(),
            genre: clipText(body?.genre !== undefined ? body.genre : (current.genre || ""), 80),
          };
          const result = await updateCustomStation(guildInfo.id, key, updated);
          if (!result?.success) {
            sendJson(res, 400, { error: result?.error || "Station konnte nicht aktualisiert werden." });
            return;
          }
          sendJson(res, 200, { success: true, station: { key: result.key, ...result.station } });
        } catch (err) {
          sendJson(res, 400, { error: err?.message || "Ungültige Anfrage." });
        }
        return;
      }

      methodNotAllowed(res, ["GET", "POST", "PUT", "DELETE"]);
      return;
    }

    // --- Dashboard: Roles Sync ---
    if (requestUrl.pathname === "/api/dashboard/roles") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return; }
      const { session } = getDashboardSession(req);
      if (!session) { sendJson(res, 401, { error: "Nicht eingeloggt." }); return; }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) { sendJson(res, 403, { error: "Kein Zugriff." }); return; }

      const { guild } = resolveRuntimeForGuild(runtimes, guildInfo.id);
      if (!guild) { sendJson(res, 200, { roles: [] }); return; }

      try { await guild.roles.fetch(); } catch {}
      const roles = [];
      for (const [, role] of guild.roles.cache) {
        if (role.managed || role.name === "@everyone") continue;
        roles.push({ id: role.id, name: role.name, color: role.hexColor || "#99AAB5", position: role.position || 0 });
      }
      roles.sort((a, b) => b.position - a.position);
      sendJson(res, 200, { roles });
      return;
    }

    // --- Dashboard: License / Subscription Info ---
    if (requestUrl.pathname === "/api/dashboard/license") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return; }
      const { session } = getDashboardSession(req);
      if (!session) { sendJson(res, 401, { error: "Nicht eingeloggt." }); return; }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) { sendJson(res, 403, { error: "Kein Zugriff auf diesen Server." }); return; }

      const license = getLicense(guildInfo.id);
      const result = {
        serverId: guildInfo.id,
        tier: guildInfo.tier,
        tierName: guildInfo.tier === "ultimate" ? "Ultimate" : guildInfo.tier === "pro" ? "Pro" : "Free",
        dashboardEnabled: guildInfo.dashboardEnabled,
        ultimateEnabled: guildInfo.ultimateEnabled,
        license: null,
      };

      if (license) {
        const linkedServers = Array.isArray(license.linkedServerIds) ? license.linkedServerIds : [];
        const seats = Math.max(1, Number(license.seats || 1) || 1);
        const email = license.email || license.contactEmail || "";
        const emailParts = email.split("@");
        const maskedEmail = emailParts.length === 2
          ? emailParts[0].slice(0, 2) + "***@" + emailParts[1]
          : "";
        result.license = {
          plan: license.plan || license.tier || "free",
          seats,
          seatsUsed: linkedServers.length,
          active: Boolean(license.active) && !Boolean(license.expired),
          expired: Boolean(license.expired),
          expiresAt: license.expiresAt || null,
          remainingDays: Number.isFinite(license.remainingDays) ? license.remainingDays : 0,
          billingPeriod: license.billingPeriod || "monthly",
          durationMonths: license.durationMonths || null,
          emailMasked: maskedEmail,
        };
      }

      sendJson(res, 200, result);
      return;
    }

    // --- Dashboard: Guild Settings (Weekly Digest, Fallback Station) ---
    if (requestUrl.pathname === "/api/dashboard/settings") {
      const { session } = getDashboardSession(req);
      if (!session) { sendJson(res, 401, { error: "Nicht eingeloggt." }); return; }
      const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guildInfo) { sendJson(res, 403, { error: "Kein Zugriff." }); return; }

      const { getDb: getDatabase, isConnected: isDbConnected } = await import("../lib/db.js");

      if (req.method === "GET") {
        let settings = {};
        if (isDbConnected() && getDatabase()) {
          try {
            settings = await getDatabase().collection("guild_settings").findOne({ guildId: guildInfo.id }, { projection: { _id: 0 } }) || {};
          } catch {}
        }
        sendJson(res, 200, {
          guildId: guildInfo.id,
          tier: guildInfo.tier,
          weeklyDigest: settings.weeklyDigest || { enabled: false, channelId: "", dayOfWeek: 1, hour: 9, language: "de" },
          fallbackStation: settings.fallbackStation || "",
        });
        return;
      }

      if (req.method === "PUT") {
        if (!isDbConnected() || !getDatabase()) {
          sendJson(res, 503, { error: "MongoDB nicht verbunden." });
          return;
        }
        try {
          const body = await readJsonBody();
          const updates = { guildId: guildInfo.id };

          if (body?.weeklyDigest && typeof body.weeklyDigest === "object") {
            const wd = body.weeklyDigest;
            updates.weeklyDigest = {
              enabled: wd.enabled === true,
              channelId: String(wd.channelId || "").trim(),
              dayOfWeek: Math.max(0, Math.min(6, Number(wd.dayOfWeek) || 1)),
              hour: Math.max(0, Math.min(23, Number(wd.hour) || 9)),
              language: String(wd.language || "de").slice(0, 5),
            };
          }

          if (body?.fallbackStation !== undefined) {
            if (guildInfo.tier !== "ultimate") {
              sendJson(res, 403, { error: "Fallback-Station ist nur fuer Ultimate verfuegbar." });
              return;
            }
            updates.fallbackStation = clipText(body.fallbackStation || "", 120).trim().toLowerCase();
          }

          await getDatabase().collection("guild_settings").updateOne(
            { guildId: guildInfo.id },
            { $set: updates },
            { upsert: true }
          );
          sendJson(res, 200, { success: true, ...updates });
        } catch (err) {
          sendJson(res, 400, { error: err?.message || "Ungueltige Anfrage." });
        }
        return;
      }

      methodNotAllowed(res, ["GET", "PUT"]);
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
          sendJson(res, 400, { error: t("Bitte eine gueltige E-Mail-Adresse eingeben.", "Please enter a valid email address.") });
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
