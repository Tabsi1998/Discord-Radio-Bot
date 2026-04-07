import test from "node:test";
import assert from "node:assert/strict";

import { dispatchRuntimeReliabilityWebhook } from "../src/lib/runtime-alerts.js";

test("runtime reliability webhooks deliver selected recovery events with runtime source", async () => {
  let capturedDelivery = null;

  const result = await dispatchRuntimeReliabilityWebhook({
    guildId: "123",
    guildName: "OmniFM Guild",
    tier: "ultimate",
    eventKey: "stream_recovered",
    payload: {
      recoveredStationKey: "rock",
      streamErrorCount: 2,
    },
  }, {
    hasCapability: () => true,
    loadWebhookConfig: async () => ({
      enabled: true,
      url: "https://example.com/hook",
      secret: "demo",
      events: ["stream_recovered"],
    }),
    deliver: async (config, eventKey, payload) => {
      capturedDelivery = { config, eventKey, payload };
      return { attempted: true, delivered: true, status: 204 };
    },
  });

  assert.equal(result.delivered, true);
  assert.equal(capturedDelivery.eventKey, "stream_recovered");
  assert.equal(capturedDelivery.payload.source, "runtime");
  assert.equal(capturedDelivery.payload.server.name, "OmniFM Guild");
  assert.equal(capturedDelivery.payload.payload.recoveredStationKey, "rock");
});

test("runtime reliability webhooks skip unselected events without attempting delivery", async () => {
  let deliverCalls = 0;

  const result = await dispatchRuntimeReliabilityWebhook({
    guildId: "123",
    guildName: "OmniFM Guild",
    tier: "ultimate",
    eventKey: "stream_failover_exhausted",
    payload: {
      previousStationKey: "rock",
    },
  }, {
    hasCapability: () => true,
    loadWebhookConfig: async () => ({
      enabled: true,
      url: "https://example.com/hook",
      secret: "",
      events: ["stats_exported"],
    }),
    deliver: async () => {
      deliverCalls += 1;
      return { attempted: true, delivered: true, status: 204 };
    },
  });

  assert.equal(result.skipped, "disabled");
  assert.equal(deliverCalls, 0);
});

test("runtime reliability webhooks deliver stream stall alerts when selected", async () => {
  let capturedDelivery = null;

  const result = await dispatchRuntimeReliabilityWebhook({
    guildId: "123",
    guildName: "OmniFM Guild",
    tier: "ultimate",
    eventKey: "stream_healthcheck_stalled",
    payload: {
      previousStationKey: "nightwave",
      silenceMs: 60000,
    },
  }, {
    hasCapability: () => true,
    loadWebhookConfig: async () => ({
      enabled: true,
      url: "https://example.com/hook",
      secret: "",
      events: ["stream_healthcheck_stalled"],
    }),
    deliver: async (config, eventKey, payload) => {
      capturedDelivery = { config, eventKey, payload };
      return { attempted: true, delivered: true, status: 204 };
    },
  });

  assert.equal(result.delivered, true);
  assert.equal(capturedDelivery.eventKey, "stream_healthcheck_stalled");
  assert.equal(capturedDelivery.payload.source, "runtime");
  assert.equal(capturedDelivery.payload.payload.previousStationKey, "nightwave");
  assert.equal(capturedDelivery.payload.payload.silenceMs, 60000);
});

test("runtime reliability webhooks respect capability gating before loading config", async () => {
  let loadCalls = 0;

  const result = await dispatchRuntimeReliabilityWebhook({
    guildId: "123",
    guildName: "OmniFM Guild",
    tier: "pro",
    eventKey: "stream_recovered",
    payload: {},
  }, {
    hasCapability: () => false,
    loadWebhookConfig: async () => {
      loadCalls += 1;
      return null;
    },
  });

  assert.equal(result.skipped, "capability");
  assert.equal(loadCalls, 0);
});
