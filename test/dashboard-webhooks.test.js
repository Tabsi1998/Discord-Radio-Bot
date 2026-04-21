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
    events: ["stats_exported", "stream_failover_exhausted", "stream_recovered", "custom_stations_exported", "stats_exported", "invalid"],
  });

  assert.deepEqual(config, {
    enabled: true,
    url: "https://example.com/hook",
    secret: "demo",
    events: ["stats_exported", "stream_failover_exhausted", "stream_recovered", "custom_stations_exported"],
  });
  assert.equal(shouldDeliverDashboardWebhook(config, "stats_exported"), true);
  assert.equal(shouldDeliverDashboardWebhook(config, "stream_failover_exhausted"), true);
  assert.equal(shouldDeliverDashboardWebhook(config, "stream_healthcheck_stalled"), false);
  assert.equal(shouldDeliverDashboardWebhook(config, "stream_recovered"), true);
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
    source: "runtime",
    server: { id: "1", name: "Guild", tier: "ultimate" },
    actor: { id: "2", username: "Tester" },
    payload: { exportType: "stats" },
  });

  assert.equal(payload.event, "stats_exported");
  assert.equal(payload.source, "runtime");
  assert.equal(payload.server.id, "1");
  assert.equal(payload.actor.username, "Tester");
  assert.equal(payload.payload.exportType, "stats");
});

test("dashboard webhook payloads sanitize technical runtime fields for customer-facing reliability events", () => {
  const payload = buildDashboardWebhookPayload("stream_failover_exhausted", {
    source: "runtime",
    server: { id: "1", name: "Guild", tier: "ultimate" },
    payload: {
      runtime: { id: "bot-1", name: "OmniFM 1", role: "worker" },
      previousStationName: "Nightwave FM",
      failoverStationName: "Rock FM",
      listenerCount: 4,
      triggerError: "timeout",
      reconnectAttempts: 3,
      streamErrorCount: 7,
      attemptedCandidates: ["rock", "pop"],
    },
  });

  assert.equal(payload.payload.previousStationName, "Nightwave FM");
  assert.equal(payload.payload.failoverStationName, "Rock FM");
  assert.equal(payload.payload.listenerCount, 4);
  assert.equal(payload.payload.runtime.name, "OmniFM 1");
  assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, "triggerError"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, "reconnectAttempts"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, "streamErrorCount"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, "attemptedCandidates"), false);
});
