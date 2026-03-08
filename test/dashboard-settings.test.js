import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFallbackStationSummary,
  buildWeeklyDigestSummary,
  computeWeeklyDigestNextRun,
} from "../frontend/src/lib/dashboardSettings.js";

test("computeWeeklyDigestNextRun follows the next matching weekly slot", () => {
  const nextRunAt = computeWeeklyDigestNextRun(
    { dayOfWeek: 2, hour: 18 },
    new Date(2026, 2, 8, 17, 30, 0)
  );

  const parsed = new Date(nextRunAt);
  assert.equal(parsed.getDay(), 2);
  assert.equal(parsed.getHours(), 18);
});

test("buildWeeklyDigestSummary exposes channel warnings and localized labels", () => {
  const summary = buildWeeklyDigestSummary(
    {
      weeklyDigest: {
        enabled: true,
        channelId: "",
        dayOfWeek: 1,
        hour: 9,
        language: "en",
      },
      weeklyDigestMeta: {
        lastSentAt: null,
      },
    },
    (_de, en) => en,
    (value) => `formatted:${String(value).slice(0, 10)}`
  );

  assert.equal(summary.statusLabel, "Channel required");
  assert.equal(summary.missingChannel, true);
  assert.equal(summary.languageLabel, "English");
  assert.match(summary.nextRunLabel, /^formatted:/);
  assert.equal(summary.lastSentLabel, "Never sent");
});

test("buildFallbackStationSummary highlights configured fallback stations", () => {
  const summary = buildFallbackStationSummary(
    {
      fallbackStation: "custom:nightshift",
      fallbackStationPreview: {
        valid: true,
        label: "Night Shift (Custom)",
        name: "Night Shift",
        tier: "ultimate",
        isCustom: true,
      },
    },
    (_de, en) => en
  );

  assert.equal(summary.statusLabel, "Ready");
  assert.equal(summary.stationLabel, "Night Shift (Custom)");
  assert.equal(summary.badgeLabel, "Custom");
});
