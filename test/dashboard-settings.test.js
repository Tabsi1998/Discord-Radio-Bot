import test from "node:test";
import assert from "node:assert/strict";

import {
  FAILOVER_CHAIN_LIMIT,
  buildFallbackStationSummary,
  buildWeeklyDigestSummary,
  computeWeeklyDigestNextRun,
  getConfiguredFailoverChain,
  normalizeFailoverChain,
} from "../frontend/src/lib/dashboardSettings.js";
import {
  buildDashboardVoiceGuardSummary,
  normalizeDashboardVoiceGuardConfig,
} from "../frontend/src/lib/dashboardVoiceGuard.js";

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
  assert.equal(summary.chainLength, 1);
});

test("normalizeFailoverChain mirrors the dashboard failover limits", () => {
  const chain = normalizeFailoverChain([
    " rock ",
    "rock",
    "custom:nightshift",
    "jazz",
    "pop",
    "news",
    "talk",
  ]);

  assert.deepEqual(chain, ["rock", "custom:nightshift", "jazz", "pop", "news"]);
  assert.equal(chain.length, FAILOVER_CHAIN_LIMIT);
});

test("getConfiguredFailoverChain prefers the explicit chain over the legacy fallbackStation", () => {
  assert.deepEqual(
    getConfiguredFailoverChain({
      failoverChain: ["custom:nightshift", "rock"],
      fallbackStation: "jazz",
    }),
    ["custom:nightshift", "rock"]
  );

  assert.deepEqual(
    getConfiguredFailoverChain({
      fallbackStation: "jazz",
    }),
    ["jazz"]
  );
});

test("buildFallbackStationSummary reflects additional failover steps", () => {
  const summary = buildFallbackStationSummary(
    {
      failoverChain: ["custom:nightshift", "rock", "jazz"],
      failoverChainPreview: [
        {
          valid: true,
          label: "Night Shift (Custom)",
          name: "Night Shift",
          tier: "ultimate",
          isCustom: true,
        },
      ],
    },
    (_de, en) => en
  );

  assert.equal(summary.statusLabel, "Ready");
  assert.equal(summary.chainLength, 3);
  assert.equal(summary.chainLabel, "+2 more steps");
  assert.match(summary.description, /additional failover steps/i);
});

test("normalizeDashboardVoiceGuardConfig keeps default policy and threshold defaults", () => {
  const config = normalizeDashboardVoiceGuardConfig({
    policy: "default",
    effectivePolicy: "return",
  });

  assert.equal(config.policy, "default");
  assert.equal(config.effectivePolicy, "return");
  assert.equal(config.defaults.moveConfirmations >= 1, true);
  assert.equal(config.defaults.maxMovesPerWindow >= 2, true);
});

test("buildDashboardVoiceGuardSummary explains disconnect policy clearly", () => {
  const summary = buildDashboardVoiceGuardSummary(
    {
      policy: "disconnect",
      effectivePolicy: "disconnect",
      defaults: {
        policy: "return",
        moveConfirmations: 2,
        returnCooldownMs: 15000,
        moveWindowMs: 120000,
        maxMovesPerWindow: 4,
        escalation: "disconnect",
        escalationCooldownMs: 600000,
      },
    },
    (_de, en) => en
  );

  assert.equal(summary.statusLabel, "Disconnect");
  assert.equal(summary.policyLabel, "Disconnect");
  assert.match(summary.description, /confirmed foreign moves/i);
  assert.match(summary.thresholdsLabel, /confirmations/i);
});
