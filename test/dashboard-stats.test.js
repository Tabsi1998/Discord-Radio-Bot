import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDashboardAnalyticsUpgradeHint,
  buildDashboardHealthAlerts,
  buildDashboardHealthStatus,
  buildReliabilitySummary,
  buildVoiceChannelUsageRows,
  formatDashboardDuration,
} from "../frontend/src/lib/dashboardStats.js";

test("formatDashboardDuration keeps short live values readable", () => {
  assert.equal(formatDashboardDuration(0), "0m");
  assert.equal(formatDashboardDuration(30_000), "<1m");
  assert.equal(formatDashboardDuration(180_000), "3m");
  assert.equal(formatDashboardDuration(5_400_000, { short: true }), "1.5h");
});

test("buildReliabilitySummary reports missing connection basis clearly", () => {
  const summary = buildReliabilitySummary({
    connects: 0,
    errors: 0,
    t: (de, en) => en,
  });

  assert.equal(summary.value, "\u2014");
  assert.equal(summary.sub, "No connection data yet");
  assert.equal(summary.accent, "#71717A");
});

test("buildReliabilitySummary calculates percentages from connection events", () => {
  const summary = buildReliabilitySummary({
    connects: 10,
    errors: 1,
    t: (de, en) => en,
  });

  assert.equal(summary.value, "90%");
  assert.equal(summary.sub, "10 connections");
  assert.equal(summary.accent, "#F59E0B");
});

test("buildVoiceChannelUsageRows resolves channel names when available", () => {
  const rows = buildVoiceChannelUsageRows(
    { "123": 2, "456": 1 },
    { "123": "radio-1" }
  );

  assert.deepEqual(rows, [
    { id: "123", name: "#radio-1", count: 2 },
    { id: "456", name: "456", count: 1 },
  ]);
});

test("buildDashboardHealthStatus reports healthy and warning states clearly", () => {
  const t = (_de, en) => en;
  const healthy = buildDashboardHealthStatus({
    status: "healthy",
    managedBots: 2,
    readyBots: 2,
  }, t);
  const warning = buildDashboardHealthStatus({
    status: "warning",
    managedBots: 2,
    readyBots: 2,
    recoveringStreams: 1,
    degradedStreams: 1,
  }, t);

  assert.equal(healthy.label, "Stable");
  assert.equal(healthy.accent, "#10B981");
  assert.equal(warning.label, "Warning");
  assert.equal(warning.accent, "#F59E0B");
});

test("buildDashboardHealthAlerts derives actionable alert rows from health counters", () => {
  const t = (_de, en) => en;
  const alerts = buildDashboardHealthAlerts({
    managedBots: 2,
    readyBots: 1,
    recoveringStreams: 1,
    degradedStreams: 1,
    streamErrors: 3,
  }, t);

  assert.equal(alerts.length, 3);
  assert.equal(alerts[0].severity, "warning");
  assert.match(alerts[0].message, /1 bot/);
  assert.match(alerts[1].message, /reconnecting/i);
  assert.equal(alerts[2].severity, "critical");
});

test("buildDashboardAnalyticsUpgradeHint only targets non-ultimate overview users", () => {
  const t = (_de, en) => en;
  const proHint = buildDashboardAnalyticsUpgradeHint({ isUltimate: false, t });
  const ultimateHint = buildDashboardAnalyticsUpgradeHint({ isUltimate: true, t });

  assert.equal(ultimateHint, null);
  assert.equal(proHint.requiredTier, "ultimate");
  assert.equal(proHint.badge, "ULTIMATE");
  assert.equal(proHint.bullets.length, 3);
  assert.match(proHint.description, /exclusive to the Ultimate plan/i);
});
