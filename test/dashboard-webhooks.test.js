import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeDashboardExportsWebhookConfig,
  validateDashboardExportsWebhookConfig,
  shouldDeliverDashboardWebhook,
  buildDashboardWebhookPayload,
} from "../src/lib/dashboard-webhooks.js";

test("dashboard webhook helpers normalize config and gate delivery", () => {
  const config = normalizeDashboardExportsWebhookConfig({
    enabled: true,
    url: "https://example.com/hook",
    secret: "demo",
    events: ["stats_exported", "custom_stations_exported", "stats_exported", "invalid"],
  });

  assert.deepEqual(config, {
    enabled: true,
    url: "https://example.com/hook",
    secret: "demo",
    events: ["stats_exported", "custom_stations_exported"],
  });
  assert.equal(shouldDeliverDashboardWebhook(config, "stats_exported"), true);
  assert.equal(shouldDeliverDashboardWebhook(config, "missing"), false);
});

test("dashboard webhook validation allows loopback test URLs only with explicit opt-in", async () => {
  const previous = process.env.OMNIFM_ALLOW_LOCAL_WEBHOOKS;
  process.env.OMNIFM_ALLOW_LOCAL_WEBHOOKS = "1";

  try {
    const validated = await validateDashboardExportsWebhookConfig({
      enabled: false,
      url: "http://127.0.0.1:9999/hook",
      events: [],
    });
    assert.equal(validated.ok, true);
    assert.equal(validated.config.url, "http://127.0.0.1:9999/hook");
  } finally {
    if (previous === undefined) delete process.env.OMNIFM_ALLOW_LOCAL_WEBHOOKS;
    else process.env.OMNIFM_ALLOW_LOCAL_WEBHOOKS = previous;
  }
});

test("dashboard webhook payloads include source, server, and actor metadata", () => {
  const payload = buildDashboardWebhookPayload("stats_exported", {
    server: { id: "1", name: "Guild", tier: "ultimate" },
    actor: { id: "2", username: "Tester" },
    payload: { exportType: "stats" },
  });

  assert.equal(payload.event, "stats_exported");
  assert.equal(payload.source, "dashboard");
  assert.equal(payload.server.id, "1");
  assert.equal(payload.actor.username, "Tester");
  assert.equal(payload.payload.exportType, "stats");
});
