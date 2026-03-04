import test from "node:test";
import assert from "node:assert/strict";

import {
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
