import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWeeklyDigestMeta,
  computeNextWeeklyDigestRunAt,
  normalizeWeeklyDigestConfig,
  shouldSendWeeklyDigest,
} from "../src/lib/weekly-digest.js";

test("normalizeWeeklyDigestConfig clamps values and limits language", () => {
  const config = normalizeWeeklyDigestConfig({
    enabled: true,
    channelId: " 123 ",
    dayOfWeek: 99,
    hour: -2,
    language: "fr",
  });

  assert.deepEqual(config, {
    enabled: true,
    channelId: "123",
    dayOfWeek: 6,
    hour: 0,
    language: "de",
  });
});

test("computeNextWeeklyDigestRunAt picks the upcoming weekly slot", () => {
  const runAt = computeNextWeeklyDigestRunAt(
    { dayOfWeek: 1, hour: 9 },
    new Date(2026, 2, 8, 10, 15, 0)
  );

  const parsed = new Date(runAt);
  assert.equal(parsed.getDay(), 1);
  assert.equal(parsed.getHours(), 9);
});

test("shouldSendWeeklyDigest only allows configured slots and suppresses duplicate sends", () => {
  const config = normalizeWeeklyDigestConfig({
    enabled: true,
    channelId: "523456789012345678",
    dayOfWeek: 0,
    hour: 10,
    language: "en",
  });
  const now = new Date(2026, 2, 8, 10, 5, 0);

  assert.equal(shouldSendWeeklyDigest(config, { now }), true);
  assert.equal(
    shouldSendWeeklyDigest(config, {
      now,
      lastSentAt: new Date(2026, 2, 8, 9, 20, 0).toISOString(),
    }),
    false
  );

  const meta = buildWeeklyDigestMeta(config, {
    now,
    lastSentAt: new Date(2026, 2, 1, 10, 0, 0).toISOString(),
  });
  assert.equal(meta.ready, true);
  assert.equal(meta.channelConfigured, true);
  const nextRun = new Date(meta.nextRunAt);
  assert.equal(nextRun.getDay(), 0);
  assert.equal(nextRun.getHours(), 10);
  assert.equal(new Date(meta.lastSentAt).getDay(), 0);
});
