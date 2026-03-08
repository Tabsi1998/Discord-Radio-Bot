import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startWebServer } from "../src/api/server.js";
import { setLicenseProvider } from "../src/core/entitlements.js";
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
    send: async () => null,
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
  });

  let activePlan = "pro";
  let activeSeats = 2;
  setLicenseProvider((serverId) => {
    if (String(serverId) !== GUILD_ID) return null;
    return {
      plan: activePlan,
      active: activePlan !== "free",
      seats: activeSeats,
    };
  });

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

  const server = startWebServer([createRuntimeStub()]);
  await once(server, "listening");
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    deleteDashboardAuthSession(sessionToken);
    setLicenseProvider(() => null);
    restoreEnv();
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
