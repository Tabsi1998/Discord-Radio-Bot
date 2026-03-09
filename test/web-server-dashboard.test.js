import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startWebServer } from "../src/api/server.js";
import { setLicenseProvider } from "../src/core/entitlements.js";
import { connect as connectDb, close as closeDb, getDb } from "../src/lib/db.js";
import {
  createLicense,
  linkServerToLicense,
} from "../src/premium-store.js";
import { upsertOffer } from "../src/coupon-store.js";
import {
  setDashboardAuthSession,
  deleteDashboardAuthSession,
} from "../src/dashboard-store.js";
import { createScheduledEvent } from "../src/scheduled-events-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const GUILD_ID = "123456789012345678";
const ROLE_DJ_ID = "223456789012345678";
const ROLE_ADMIN_ID = "323456789012345678";
const VOICE_CHANNEL_ID = "423456789012345678";
const TEXT_CHANNEL_ID = "523456789012345678";

async function snapshotFile(filePath) {
  try {
    return {
      exists: true,
      content: await fs.readFile(filePath),
    };
  } catch {
    return { exists: false, content: null };
  }
}

async function restoreFile(filePath, snapshot) {
  if (snapshot?.exists) {
    await fs.writeFile(filePath, snapshot.content);
    return;
  }
  await fs.rm(filePath, { force: true });
}

function setEnv(overrides) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function createGuildStub() {
  const sentMessages = [];
  const roles = new Map([
    [ROLE_DJ_ID, { id: ROLE_DJ_ID, name: "DJ", managed: false, hexColor: "#5865F2", position: 2 }],
    [ROLE_ADMIN_ID, { id: ROLE_ADMIN_ID, name: "Admin", managed: false, hexColor: "#10B981", position: 1 }],
  ]);
  const voiceChannel = {
    id: VOICE_CHANNEL_ID,
    guildId: GUILD_ID,
    name: "radio-lounge",
    type: 2,
    isVoiceBased: () => true,
    permissionsFor: () => ({ has: () => true }),
    toString: () => `<#${VOICE_CHANNEL_ID}>`,
  };
  const textChannel = {
    id: TEXT_CHANNEL_ID,
    guildId: GUILD_ID,
    name: "announcements",
    type: 0,
    send: async (payload) => {
      sentMessages.push(payload);
      return payload;
    },
    permissionsFor: () => ({ has: () => true }),
    toString: () => `<#${TEXT_CHANNEL_ID}>`,
  };
  const channels = new Map([
    [VOICE_CHANNEL_ID, voiceChannel],
    [TEXT_CHANNEL_ID, textChannel],
  ]);

  return {
    id: GUILD_ID,
    name: "OmniFM Test Guild",
    __sentMessages: sentMessages,
    roles: {
      cache: roles,
      fetch: async () => roles,
    },
    channels: {
      cache: channels,
      fetch: async (channelId) => (channelId ? channels.get(channelId) || null : channels),
    },
    emojis: {
      cache: new Map(),
      fetch: async () => new Map(),
    },
  };
}

function createRuntimeStub() {
  const guild = createGuildStub();
  const guilds = new Map([[GUILD_ID, guild]]);

  return {
    __sentMessages: guild.__sentMessages,
    role: "commander",
    config: {
      id: "bot-test-1",
      index: 1,
      name: "OmniFM Test",
      requiredTier: "free",
    },
    client: {
      isReady: () => true,
      guilds: { cache: guilds },
    },
    collectStats() {
      return { servers: 1, users: 12, connections: 0, listeners: 0 };
    },
    getPlayingGuildCount() {
      return 0;
    },
    getPublicStatus() {
      return {
        id: "bot-test-1",
        botId: "bot-test-1",
        name: "OmniFM Test",
        role: "commander",
        requiredTier: "free",
        ready: true,
        servers: 1,
        users: 12,
        connections: 0,
        listeners: 0,
      };
    },
    getDashboardStatus() {
      return {
        id: "bot-test-1",
        botId: "bot-test-1",
        name: "OmniFM Test",
        role: "commander",
        requiredTier: "free",
        ready: true,
        servers: 1,
        users: 12,
        connections: 1,
        listeners: 4,
        guildDetails: [{
          guildId: GUILD_ID,
          guildName: "OmniFM Test Guild",
          stationKey: "rock",
          stationName: "Rock FM",
          channelId: VOICE_CHANNEL_ID,
          channelName: "radio-lounge",
          listenerCount: 4,
          playing: true,
          reconnectAttempts: 2,
          streamErrorCount: 1,
          shouldReconnect: true,
        }],
      };
    },
    buildStatusSnapshot() {
      return {
        id: "bot-test-1",
        name: "OmniFM Test",
        role: "commander",
        requiredTier: "free",
        ready: true,
        servers: 1,
        listeners: 0,
        connections: 0,
        uptimeSec: 5,
        error: null,
      };
    },
    normalizeClearableText(value, maxLen) {
      const text = String(value || "").trim();
      return text ? text.slice(0, maxLen) : null;
    },
    resolveStationForGuild(_guildId, rawStationKey) {
      const key = String(rawStationKey || "").trim().toLowerCase();
      if (!key) {
        return { ok: false, message: "Station key is invalid." };
      }
      return {
        ok: true,
        key,
        station: {
          name: key === "rock" ? "Rock FM" : "Test Station",
        },
      };
    },
    parseEventWindowInput({
      startRaw = "",
      baseRunAtMs = 0,
      baseDurationMs = 0,
      requestedTimeZone = "Europe/Vienna",
    } = {}) {
      let runAtMs = Number.parseInt(String(baseRunAtMs || 0), 10);
      if (String(startRaw || "").trim()) {
        const normalized = String(startRaw).trim();
        const isoLike = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)
          ? `${normalized}:00.000Z`
          : normalized;
        runAtMs = Date.parse(isoLike);
      }
      if (!Number.isFinite(runAtMs) || runAtMs <= 0) {
        return { ok: false, message: "Start time is invalid." };
      }
      const durationMs = Math.max(0, Number(baseDurationMs || 0) || 0);
      return {
        ok: true,
        runAtMs,
        timeZone: requestedTimeZone,
        durationMs,
        endAtMs: durationMs > 0 ? runAtMs + durationMs : 0,
      };
    },
    async resolveBotMember() {
      return { id: "bot-test-user" };
    },
    async resolveGuildVoiceChannel(guildId, channelId) {
      const selectedGuild = guilds.get(guildId) || null;
      return {
        guild: selectedGuild,
        channel: selectedGuild?.channels?.cache?.get(channelId) || null,
      };
    },
    validateDiscordScheduledEventPermissions() {
      return null;
    },
  };
}

async function requestJson(baseUrl, pathname, { method = "GET", headers = {}, body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers,
    body,
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

test("dashboard capability, permissions, and health routes work end-to-end", async (t) => {
  const trackedFiles = [
    path.join(repoRoot, "dashboard.json"),
    path.join(repoRoot, "dashboard.json.bak"),
    path.join(repoRoot, "command-permissions.json"),
    path.join(repoRoot, "command-permissions.json.bak"),
    path.join(repoRoot, "premium.json"),
    path.join(repoRoot, "premium.json.bak"),
    path.join(repoRoot, "coupons.json"),
    path.join(repoRoot, "coupons.json.bak"),
    path.join(repoRoot, "custom-stations.json"),
    path.join(repoRoot, "custom-stations.json.bak"),
    path.join(repoRoot, "scheduled-events.json"),
  ];
  const snapshots = new Map();
  for (const filePath of trackedFiles) {
    snapshots.set(filePath, await snapshotFile(filePath));
  }

  const restoreEnv = setEnv({
    WEB_INTERNAL_PORT: "0",
    WEB_PORT: "0",
    WEB_BIND: "127.0.0.1",
    API_ADMIN_TOKEN: "test-admin-token",
    OMNIFM_ALLOW_LOCAL_WEBHOOKS: "1",
  });

  let activePlan = "pro";
  let activeSeats = 2;
  let mongoAvailable = false;
  setLicenseProvider((serverId) => {
    if (String(serverId) !== GUILD_ID) return null;
    return {
      plan: activePlan,
      active: activePlan !== "free",
      seats: activeSeats,
    };
  });

  const seededLicense = createLicense({
    plan: "pro",
    seats: 2,
    billingPeriod: "monthly",
    months: 3,
    activatedBy: "test-suite",
    contactEmail: "owner@example.com",
    preferredLanguage: "en",
  });
  const seededLink = linkServerToLicense(GUILD_ID, seededLicense.id);
  assert.equal(seededLink.ok, true);
  upsertOffer({
    code: "RENEW25",
    kind: "coupon",
    active: true,
    percentOff: 25,
    allowedTiers: ["ultimate"],
    allowedSeats: [2],
    minMonths: 3,
    ownerLabel: "Spring Promo",
    createdBy: "test-suite",
  });

  try {
    await connectDb();
    if (getDb()) {
      mongoAvailable = true;
      await getDb().collection("guild_settings").deleteMany({ guildId: GUILD_ID });
    }
  } catch {}

  const sessionToken = `test-session-${Date.now()}`;
  const nowTs = Math.floor(Date.now() / 1000);
  setDashboardAuthSession(sessionToken, {
    user: {
      id: "423456789012345678",
      username: "TestUser",
    },
    guilds: [{
      id: GUILD_ID,
      name: "OmniFM Test Guild",
      permissions: "32",
      owner: true,
    }],
    createdAt: nowTs,
    expiresAt: nowTs + 3600,
  });

  const scheduledEventsFile = path.join(repoRoot, "scheduled-events.json");
  await fs.rm(scheduledEventsFile, { force: true });
  const conflictStartMs = Date.parse("2026-03-15T20:00:00.000Z");
  const seededEvent = createScheduledEvent({
    guildId: GUILD_ID,
    botId: "bot-test-1",
    name: "Existing Show",
    stationKey: "rock",
    voiceChannelId: VOICE_CHANNEL_ID,
    textChannelId: TEXT_CHANNEL_ID,
    runAtMs: conflictStartMs,
    durationMs: 60 * 60 * 1000,
    repeat: "none",
    timeZone: "Europe/Vienna",
  });
  assert.equal(seededEvent.ok, true);

  const runtimeStub = createRuntimeStub();
  const webhookRequests = [];
  const webhookServer = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const rawBody = Buffer.concat(chunks).toString("utf8");
    webhookRequests.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      payload: JSON.parse(rawBody || "{}"),
    });
    res.writeHead(204);
    res.end();
  });
  webhookServer.listen(0, "127.0.0.1");
  await once(webhookServer, "listening");
  const webhookAddress = webhookServer.address();
  const webhookUrl = `http://127.0.0.1:${webhookAddress.port}/exports`;
  const server = startWebServer([runtimeStub]);
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => webhookServer.close(resolve));
    deleteDashboardAuthSession(sessionToken);
    setLicenseProvider(() => null);
    restoreEnv();
    if (mongoAvailable && getDb()) {
      await getDb().collection("guild_settings").deleteMany({ guildId: GUILD_ID }).catch(() => null);
      await closeDb().catch(() => null);
    }
    for (const [filePath, snapshot] of snapshots.entries()) {
      await restoreFile(filePath, snapshot);
    }
  });

  const authHeaders = { "x-session-token": sessionToken };

  const sessionResponse = await requestJson(baseUrl, "/api/auth/session", { headers: authHeaders });
  assert.equal(sessionResponse.status, 200);
  assert.equal(sessionResponse.payload.authenticated, true);
  assert.equal(sessionResponse.payload.guilds[0].capabilities.dashboardAccess, true);

  const capabilityResponse = await requestJson(
    baseUrl,
    `/api/dashboard/capabilities?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(capabilityResponse.status, 200);
  assert.equal(capabilityResponse.payload.tier, "pro");
  assert.equal(capabilityResponse.payload.capabilities.dashboardAccess, true);
  assert.equal(capabilityResponse.payload.capabilities.advancedAnalytics, false);
  assert.equal(capabilityResponse.payload.limits.seats, 2);
  assert.equal(capabilityResponse.payload.upgradeHints.nextTier, "ultimate");
  assert.ok(capabilityResponse.payload.upgradeHints.blockedFeatures.includes("advancedAnalytics"));

  const initialLicenseResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(initialLicenseResponse.status, 200);
  assert.equal(initialLicenseResponse.payload.license.plan, "pro");
  assert.equal(initialLicenseResponse.payload.license.seats, 2);
  assert.equal(initialLicenseResponse.payload.license.seatsUsed, 1);
  assert.equal(initialLicenseResponse.payload.license.seatsAvailable, 1);
  assert.equal(initialLicenseResponse.payload.license.emailMasked, "ow***@example.com");
  assert.equal(initialLicenseResponse.payload.currentPlan.limits.maxBots, 8);
  assert.equal(initialLicenseResponse.payload.currentPlan.pricing.monthlyCents, 549);
  assert.equal(initialLicenseResponse.payload.recommendedUpgrade.tier, "ultimate");
  assert.equal(initialLicenseResponse.payload.recommendedUpgrade.pricing.monthlyCents, 799);
  assert.equal(initialLicenseResponse.payload.promotions.couponCodesSupported, true);
  assert.equal(initialLicenseResponse.payload.promotions.proTrialEnabled, true);
  assert.equal(initialLicenseResponse.payload.promotions.proTrialMonths, 1);

  const invalidLicenseEmailUpdate = await requestJson(
    baseUrl,
    `/api/dashboard/license?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contactEmail: "invalid-email",
        language: "en",
      }),
    }
  );
  assert.equal(invalidLicenseEmailUpdate.status, 400);
  assert.match(invalidLicenseEmailUpdate.payload.error, /valid license email/i);

  const updatedLicenseResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contactEmail: "billing@example.com",
        language: "en",
      }),
    }
  );
  assert.equal(updatedLicenseResponse.status, 200);
  assert.equal(updatedLicenseResponse.payload.success, true);
  assert.equal(updatedLicenseResponse.payload.license.emailMasked, "bi***@example.com");
  assert.equal(updatedLicenseResponse.payload.license.contactEmailDomain, "example.com");

  const offerPreviewResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license/offer-preview?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tier: "ultimate",
        months: 3,
        couponCode: "renew25",
        language: "en",
      }),
    }
  );
  assert.equal(offerPreviewResponse.status, 200);
  assert.equal(offerPreviewResponse.payload.success, true);
  assert.equal(offerPreviewResponse.payload.pricing.baseAmountCents, 1917);
  assert.equal(offerPreviewResponse.payload.pricing.discountCents, 479);
  assert.equal(offerPreviewResponse.payload.pricing.finalAmountCents, 1438);
  assert.equal(offerPreviewResponse.payload.discount.applied.code, "RENEW25");
  assert.equal(offerPreviewResponse.payload.discount.applied.ownerLabel, "Spring Promo");
  assert.equal(offerPreviewResponse.payload.renewal.targetPlan, "ultimate");
  assert.equal(offerPreviewResponse.payload.renewal.seats, 2);

  const invalidOfferPreviewResponse = await requestJson(
    baseUrl,
    `/api/dashboard/license/offer-preview?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tier: "ultimate",
        months: 3,
        couponCode: "INVALID",
        language: "en",
      }),
    }
  );
  assert.equal(invalidOfferPreviewResponse.status, 400);
  assert.match(invalidOfferPreviewResponse.payload.error, /(coupon|offer_not_found)/i);

  const settingsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    { headers: { ...authHeaders, "X-OmniFM-Language": "de" } }
  );
  assert.equal(settingsResponse.status, 200);
  assert.equal(settingsResponse.payload.weeklyDigest.language, "de");
  assert.equal(settingsResponse.payload.weeklyDigestMeta.ready, false);
  assert.equal(typeof settingsResponse.payload.weeklyDigestMeta.nextRunAt, "string");
  assert.deepEqual(settingsResponse.payload.failoverChain, []);
  assert.deepEqual(settingsResponse.payload.failoverChainPreview, []);
  assert.equal(settingsResponse.payload.fallbackStation, "");
  assert.equal(settingsResponse.payload.fallbackStationPreview.valid, true);
  assert.equal(settingsResponse.payload.exportsWebhook.enabled, false);
  assert.equal(settingsResponse.payload.exportsWebhook.url, "");
  assert.deepEqual(settingsResponse.payload.exportsWebhook.events, []);

  const invalidDigestSettings = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        weeklyDigest: {
          enabled: true,
          channelId: "",
          dayOfWeek: 1,
          hour: 9,
          language: "en",
        },
      }),
    }
  );
  assert.equal(invalidDigestSettings.status, 400);
  assert.match(invalidDigestSettings.payload.error, /text channel/i);

  const digestPreviewResponse = await requestJson(
    baseUrl,
    `/api/dashboard/settings/digest-preview?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        weeklyDigest: {
          enabled: true,
          channelId: TEXT_CHANNEL_ID,
          dayOfWeek: 1,
          hour: 9,
          language: "en",
        },
      }),
    }
  );
  assert.equal(digestPreviewResponse.status, 200);
  assert.equal(digestPreviewResponse.payload.preview.channelName, "announcements");
  assert.equal(digestPreviewResponse.payload.preview.embed.title, "Weekly radio report");
  assert.ok(Array.isArray(digestPreviewResponse.payload.preview.fields));
  assert.ok(digestPreviewResponse.payload.preview.fields.length >= 6);

  const digestTestResponse = await requestJson(
    baseUrl,
    `/api/dashboard/settings/digest-test?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        weeklyDigest: {
          enabled: true,
          channelId: TEXT_CHANNEL_ID,
          dayOfWeek: 1,
          hour: 9,
          language: "en",
        },
      }),
    }
  );
  assert.equal(digestTestResponse.status, 200);
  assert.equal(digestTestResponse.payload.channelName, "announcements");
  assert.equal(runtimeStub.__sentMessages.length, 1);
  assert.equal(runtimeStub.__sentMessages[0].embeds[0].title, "Weekly radio report");

  activePlan = "ultimate";
  activeSeats = 2;
  const detailStatsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/stats/detail?serverId=${GUILD_ID}&days=30`,
    { headers: authHeaders }
  );
  assert.equal(detailStatsResponse.status, 200);
  assert.equal(detailStatsResponse.payload.connectionHealth.timeline.length, 30);

  const webhookTestResponse = await requestJson(
    baseUrl,
    `/api/dashboard/exports/webhook-test?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        exportsWebhook: {
          enabled: false,
          url: webhookUrl,
          secret: "test-secret",
          events: ["stats_exported", "custom_stations_exported"],
        },
      }),
    }
  );
  assert.equal(webhookTestResponse.status, 200);
  assert.equal(webhookTestResponse.payload.delivery.delivered, true);
  assert.equal(webhookRequests.length, 1);
  assert.equal(webhookRequests[0].headers["x-omnifm-event"], "test");
  assert.equal(webhookRequests[0].headers["x-omnifm-webhook-secret"], "test-secret");
  assert.equal(webhookRequests[0].payload.event, "test");

  const initialCustomStationsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/custom-stations?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(initialCustomStationsResponse.status, 200);
  assert.deepEqual(initialCustomStationsResponse.payload.stations, []);

  const createCustomStationResponse = await requestJson(
    baseUrl,
    `/api/dashboard/custom-stations?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "nightwave",
        name: "Nightwave FM",
        url: "https://1.1.1.1/live",
        genre: "Synthwave",
        folder: "Night Rotation",
        tags: "night, synthwave, night",
      }),
    }
  );
  assert.equal(createCustomStationResponse.status, 201);
  assert.equal(createCustomStationResponse.payload.station.folder, "Night Rotation");
  assert.deepEqual(createCustomStationResponse.payload.station.tags, ["night", "synthwave"]);

  const updateCustomStationResponse = await requestJson(
    baseUrl,
    `/api/dashboard/custom-stations?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: "nightwave",
        name: "Nightwave Live",
        url: "https://1.1.1.1/live",
        genre: "Synthwave",
        folder: "Featured",
        tags: ["featured", "live"],
      }),
    }
  );
  assert.equal(updateCustomStationResponse.status, 200);
  assert.equal(updateCustomStationResponse.payload.station.name, "Nightwave Live");
  assert.equal(updateCustomStationResponse.payload.station.folder, "Featured");
  assert.deepEqual(updateCustomStationResponse.payload.station.tags, ["featured", "live"]);

  const customStationsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/custom-stations?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(customStationsResponse.status, 200);
  assert.equal(customStationsResponse.payload.stations.length, 1);
  assert.equal(customStationsResponse.payload.stations[0].folder, "Featured");
  assert.deepEqual(customStationsResponse.payload.stations[0].tags, ["featured", "live"]);

  const exportSettingsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        exportsWebhook: {
          enabled: true,
          url: webhookUrl,
          secret: "test-secret",
          events: ["stats_exported", "custom_stations_exported"],
        },
      }),
    }
  );
  assert.equal(exportSettingsResponse.status, mongoAvailable ? 200 : 503);
  if (mongoAvailable) {
    assert.equal(exportSettingsResponse.payload.exportsWebhook.enabled, true);
    assert.equal(exportSettingsResponse.payload.exportsWebhook.url, webhookUrl);
    assert.deepEqual(exportSettingsResponse.payload.exportsWebhook.events, ["stats_exported", "custom_stations_exported"]);
  }

  const stationsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/stations?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(stationsResponse.status, 200);
  assert.equal(stationsResponse.payload.custom.length, 1);
  assert.equal(stationsResponse.payload.custom[0].folder, "Featured");
  assert.deepEqual(stationsResponse.payload.custom[0].tags, ["featured", "live"]);

  const statsExportResponse = await requestJson(
    baseUrl,
    `/api/dashboard/exports/stats?serverId=${GUILD_ID}&days=14`,
    { headers: authHeaders }
  );
  assert.equal(statsExportResponse.status, 200);
  assert.equal(statsExportResponse.payload.exportType, "stats");
  assert.equal(statsExportResponse.payload.detail.days, 14);
  if (mongoAvailable) {
    assert.equal(statsExportResponse.payload.webhookDelivery.delivered, true);
    assert.equal(webhookRequests.length, 2);
    assert.equal(webhookRequests[1].payload.event, "stats_exported");
  }

  const stationsExportResponse = await requestJson(
    baseUrl,
    `/api/dashboard/exports/custom-stations?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(stationsExportResponse.status, 200);
  assert.equal(stationsExportResponse.payload.exportType, "custom_stations");
  assert.equal(stationsExportResponse.payload.stations.length, 1);
  if (mongoAvailable) {
    assert.equal(stationsExportResponse.payload.webhookDelivery.delivered, true);
    assert.equal(webhookRequests.length, 3);
    assert.equal(webhookRequests[2].payload.event, "custom_stations_exported");
  }

  const availableFailoverStations = [
    ...(stationsResponse.payload.custom || []).map((station) => `custom:${station.key}`),
    ...(stationsResponse.payload.free || []).map((station) => station.key),
    ...(stationsResponse.payload.pro || []).map((station) => station.key),
    ...(stationsResponse.payload.ultimate || []).map((station) => station.key),
  ].filter(Boolean);
  assert.ok(availableFailoverStations.length >= 2);
  const selectedFailoverChain = availableFailoverStations.slice(0, 2);

  const validFailoverSettings = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        failoverChain: selectedFailoverChain,
      }),
    }
  );
  assert.equal(validFailoverSettings.status, mongoAvailable ? 200 : 503);
  if (mongoAvailable) {
    assert.deepEqual(validFailoverSettings.payload.failoverChain, selectedFailoverChain);
    assert.equal(validFailoverSettings.payload.fallbackStation, selectedFailoverChain[0]);
    assert.equal(validFailoverSettings.payload.failoverChainPreview.length, selectedFailoverChain.length);
  }

  const legacyFallbackSettings = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fallbackStation: selectedFailoverChain[0],
      }),
    }
  );
  assert.equal(legacyFallbackSettings.status, mongoAvailable ? 200 : 503);
  if (mongoAvailable) {
    assert.deepEqual(legacyFallbackSettings.payload.failoverChain, [selectedFailoverChain[0]]);
    assert.equal(legacyFallbackSettings.payload.fallbackStation, selectedFailoverChain[0]);
  }

  const invalidFallbackSettings = await requestJson(
    baseUrl,
    `/api/dashboard/settings?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "X-OmniFM-Language": "en",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        failoverChain: ["custom:missing-station"],
      }),
    }
  );
  assert.equal(invalidFallbackSettings.status, 400);
  assert.match(invalidFallbackSettings.payload.error, /fallback station/i);
  activePlan = "pro";

  const previewResponse = await requestJson(
    baseUrl,
    `/api/dashboard/events/preview?serverId=${GUILD_ID}`,
    {
      method: "POST",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: "Preview Show",
        stationKey: "rock",
        channelId: VOICE_CHANNEL_ID,
        textChannelId: TEXT_CHANNEL_ID,
        startsAtLocal: "2026-03-15T20:00",
        timezone: "Europe/Vienna",
        durationMs: 30 * 60 * 1000,
        repeat: "none",
        createDiscordEvent: false,
      }),
    }
  );
  assert.equal(previewResponse.status, 200);
  assert.equal(previewResponse.payload.event.stationName, "Rock FM");
  assert.equal(previewResponse.payload.schedule.nextRuns.length, 1);
  assert.equal(previewResponse.payload.schedule.hasConflicts, true);
  assert.equal(previewResponse.payload.conflicts.length, 1);
  assert.equal(previewResponse.payload.conflicts[0].severity, "error");
  assert.match(previewResponse.payload.conflicts[0].message, /Existing Show/);

  const statsResponse = await requestJson(
    baseUrl,
    `/api/dashboard/stats?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(statsResponse.status, 200);
  assert.equal(statsResponse.payload.basic.health.status, "warning");
  assert.equal(statsResponse.payload.basic.health.managedBots, 1);
  assert.equal(statsResponse.payload.basic.health.liveStreams, 1);
  assert.equal(statsResponse.payload.basic.health.recoveringStreams, 1);
  assert.equal(statsResponse.payload.basic.health.streamErrors, 1);
  assert.equal(statsResponse.payload.basic.health.nextEventTitle, "Existing Show");
  assert.equal(statsResponse.payload.basic.health.alerts.length >= 1, true);

  const initialPerms = await requestJson(
    baseUrl,
    `/api/dashboard/perms?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(initialPerms.status, 200);
  assert.ok(Array.isArray(initialPerms.payload.rules));
  assert.ok(initialPerms.payload.rules.some((rule) => rule.command === "play"));

  const updatePerms = await requestJson(
    baseUrl,
    `/api/dashboard/perms?serverId=${GUILD_ID}`,
    {
      method: "PUT",
      headers: {
        ...authHeaders,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        commandRoleMap: {
          play: ["DJ"],
          stop: [ROLE_ADMIN_ID],
        },
      }),
    }
  );
  assert.equal(updatePerms.status, 200);
  const playRule = updatePerms.payload.rules.find((rule) => rule.command === "play");
  const stopRule = updatePerms.payload.rules.find((rule) => rule.command === "stop");
  assert.deepEqual(playRule.allowRoleIds, [ROLE_DJ_ID]);
  assert.deepEqual(stopRule.allowRoleIds, [ROLE_ADMIN_ID]);
  assert.deepEqual(updatePerms.payload.commandRoleMap.play, ["DJ"]);
  assert.deepEqual(updatePerms.payload.commandRoleMap.stop, ["Admin"]);

  activePlan = "free";
  activeSeats = 0;
  const blockedPerms = await requestJson(
    baseUrl,
    `/api/dashboard/perms?serverId=${GUILD_ID}`,
    { headers: authHeaders }
  );
  assert.equal(blockedPerms.status, 403);

  activePlan = "pro";
  activeSeats = 2;
  const unauthorizedHealth = await requestJson(baseUrl, "/api/health/detail");
  assert.equal(unauthorizedHealth.status, 401);

  const authorizedHealth = await requestJson(baseUrl, "/api/health/detail", {
    headers: { "x-admin-token": "test-admin-token" },
  });
  assert.equal(authorizedHealth.status, 200);
  assert.equal(authorizedHealth.payload.discord.readyBots, 1);
  assert.equal(authorizedHealth.payload.stores.commandPermissions.filePresent, true);
  assert.equal(typeof authorizedHealth.payload.binaries.ffmpeg.available, "boolean");
});
