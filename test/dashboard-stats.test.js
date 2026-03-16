import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDashboardAnalyticsUpgradeHint,
  buildConnectionTimelineRows,
  buildDashboardHealthAlerts,
  buildDashboardHealthStatus,
  buildReliabilitySummary,
  buildSessionQualitySummary,
  buildSessionTimelineRows,
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

test("buildDashboardHealthAlerts honors explicit unavailable bot counts from the API payload", () => {
  const t = (_de, en) => en;
  const alerts = buildDashboardHealthAlerts({
    managedBots: 3,
    readyBots: 3,
    unavailableBots: 1,
    recoveringStreams: 0,
    degradedStreams: 0,
  }, t);

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].severity, "warning");
  assert.match(alerts[0].message, /1 bot/i);
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

test("buildConnectionTimelineRows formats daily connection trend rows", () => {
  const rows = buildConnectionTimelineRows({
    timeline: [
      { date: "2026-03-07", connects: 4, reconnects: 1, errors: 1 },
      { date: "2026-03-08", connects: 2, reconnects: 0, errors: 0 },
    ],
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].issues, 2);
  assert.equal(rows[0].reliability, 75);
  assert.equal(rows[1].reliability, 100);
});

test("buildSessionTimelineRows keeps recent sessions ordered oldest-to-newest for charts", () => {
  const rows = buildSessionTimelineRows([
    {
      stationName: "Night Shift",
      startedAt: "2026-03-08T20:00:00.000Z",
      durationMs: 2 * 3_600_000,
      humanListeningMs: 90 * 60_000,
      peakListeners: 6,
      avgListeners: 4,
    },
    {
      stationName: "Morning Drive",
      startedAt: "2026-03-09T06:00:00.000Z",
      durationMs: 60 * 60_000,
      humanListeningMs: 45 * 60_000,
      peakListeners: 3,
      avgListeners: 2,
    },
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].stationName, "Night Shift");
  assert.equal(rows[1].stationName, "Morning Drive");
  assert.equal(rows[0].runtimeHours, 2);
  assert.equal(rows[1].listeningHours, 0.8);
});

test("buildSessionQualitySummary aggregates recent session quality metrics", () => {
  const summary = buildSessionQualitySummary([
    { humanListeningMs: 90 * 60_000, peakListeners: 6, avgListeners: 4 },
    { humanListeningMs: 30 * 60_000, peakListeners: 2, avgListeners: 1 },
  ], (_de, en) => en);

  assert.equal(summary.trackedSessions, 2);
  assert.equal(summary.avgListeningLabel, "1h 0m");
  assert.equal(summary.longestListeningLabel, "1h 30m");
  assert.equal(summary.topPeakLabel, "6");
  assert.equal(summary.avgPeakLabel, "3");
});
