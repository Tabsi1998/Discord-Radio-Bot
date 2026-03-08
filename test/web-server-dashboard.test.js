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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const GUILD_ID = "123456789012345678";
const ROLE_DJ_ID = "223456789012345678";
const ROLE_ADMIN_ID = "323456789012345678";

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

  return {
    id: GUILD_ID,
    name: "OmniFM Test Guild",
    roles: {
      cache: roles,
      fetch: async () => roles,
    },
    channels: {
      cache: new Map(),
      fetch: async () => new Map(),
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
