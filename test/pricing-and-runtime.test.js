import test from "node:test";
import assert from "node:assert/strict";

import {
  calculatePrice,
  calculateUpgradePrice,
  seatPricingInEuro,
  isWithinWorkerPlanLimit,
} from "../src/lib/helpers.js";
import { WorkerManager } from "../src/bot/worker-manager.js";
import { shouldLogFfmpegStderrLine } from "../src/lib/logging.js";
import { parseTrackFromStreamTitle } from "../src/services/now-playing.js";

test("seat pricing stays aligned with documented bundle totals", () => {
  assert.deepEqual(seatPricingInEuro("pro"), {
    1: "2.99",
    2: "5.49",
    3: "7.49",
    5: "11.49",
  });
  assert.deepEqual(seatPricingInEuro("ultimate"), {
    1: "4.99",
    2: "7.99",
    3: "10.99",
    5: "16.99",
  });
});

test("calculatePrice applies seat bundles and duration discounts together", () => {
  assert.equal(calculatePrice("pro", 1, 2), 549);
  assert.equal(calculatePrice("pro", 3, 2), 1372);
  assert.equal(calculatePrice("ultimate", 1, 5), 1699);
});

test("calculateUpgradePrice uses seat-aware deltas", () => {
  const license = {
    plan: "pro",
    seats: 5,
    expiresAt: new Date(Date.now() + (15 * 24 * 60 * 60 * 1000)).toISOString(),
  };
  const quote = calculateUpgradePrice(license, "ultimate");

  assert.ok(quote);
  assert.equal(quote.seats, 5);
  assert.equal(quote.oldTier, "pro");
  assert.equal(quote.targetTier, "ultimate");
  assert.equal(quote.upgradeCost, Math.round((1699 - 1149) * (quote.daysLeft / 30)));
});

test("ffmpeg decode spam is suppressed in default logging mode", () => {
  const originalVerbosity = process.env.FFMPEG_STDERR_VERBOSITY;
  delete process.env.FFMPEG_STDERR_VERBOSITY;

  try {
    assert.equal(
      shouldLogFfmpegStderrLine("Error while decoding stream #0:0: Invalid data found when processing input"),
      false
    );
    assert.equal(
      shouldLogFfmpegStderrLine("HTTP error 502 Bad Gateway"),
      true
    );
  } finally {
    if (originalVerbosity === undefined) {
      delete process.env.FFMPEG_STDERR_VERBOSITY;
    } else {
      process.env.FFMPEG_STDERR_VERBOSITY = originalVerbosity;
    }
  }
});

test("worker access limit uses worker slot instead of absolute BOT_N index", () => {
  assert.equal(
    isWithinWorkerPlanLimit({ role: "worker", workerSlot: 2, botIndex: 3, maxBots: 2 }),
    true
  );
  assert.equal(
    isWithinWorkerPlanLimit({ role: "worker", workerSlot: null, botIndex: 3, maxBots: 2 }),
    false
  );
});

test("worker manager reuses the worker already streaming in the requested channel", () => {
  const workerA = {
    config: { index: 2 },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "station-a",
        connection: { joinConfig: { channelId: "voice-1" } },
        lastChannelId: "voice-1",
      }],
    ]),
  };
  const workerB = {
    config: { index: 3 },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "station-b",
        connection: { joinConfig: { channelId: "voice-2" } },
        lastChannelId: "voice-2",
      }],
    ]),
  };

  const manager = new WorkerManager([workerA, workerB]);
  assert.equal(manager.findStreamingWorkerByChannel("guild-1", "voice-1"), workerA);
  assert.equal(manager.findStreamingWorkerByChannel("guild-1", "voice-2"), workerB);
  assert.equal(manager.findStreamingWorkerByChannel("guild-1", "voice-9"), null);
});

test("track parsing removes common prefixes and dash variants", () => {
  const parsed = parseTrackFromStreamTitle("Now Playing: Artist \u2013 Song Title");

  assert.equal(parsed.artist, "Artist");
  assert.equal(parsed.title, "Song Title");
  assert.equal(parsed.displayTitle, "Artist - Song Title");
});
