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
import { buildEventDateTimeFromParts } from "../src/lib/event-time.js";
import {
  parseTrackFromStreamTitle,
  extractTrackFromMetadataText,
  normalizeTrackSearchText,
} from "../src/services/now-playing.js";
import {
  extractAcoustIdCandidate,
  selectBestAcoustIdMatch,
} from "../src/services/audio-recognition.js";

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

test("worker manager can reuse a bot that is still connected in the target channel", async () => {
  const connectedWorker = {
    config: { index: 2 },
    guildState: new Map(),
    client: {
      isReady: () => true,
      guilds: {
        cache: new Map([
          ["guild-1", {
            members: {
              me: {
                voice: {
                  channelId: "voice-7",
                },
              },
              fetchMe: async () => ({
                voice: {
                  channelId: "voice-7",
                },
              }),
            },
          }],
        ]),
        fetch: async () => null,
      },
    },
  };
  const idleWorker = {
    config: { index: 3 },
    guildState: new Map(),
    client: {
      isReady: () => true,
      guilds: {
        cache: new Map(),
        fetch: async () => null,
      },
    },
  };

  const manager = new WorkerManager([connectedWorker, idleWorker]);
  const resolved = await manager.findConnectedWorkerByChannel("guild-1", "voice-7", "pro");

  assert.equal(resolved, connectedWorker);
});

test("track parsing removes common prefixes and dash variants", () => {
  const parsed = parseTrackFromStreamTitle("Now Playing: Artist \u2013 Song Title");

  assert.equal(parsed.artist, "Artist");
  assert.equal(parsed.title, "Song Title");
  assert.equal(parsed.displayTitle, "Artist - Song Title");
});

test("metadata parser falls back to artist/title fields when StreamTitle is missing", () => {
  const parsed = extractTrackFromMetadataText("artist='Don Diablo';title='The Rhythm Of The Night';");

  assert.equal(parsed.artist, "Don Diablo");
  assert.equal(parsed.title, "The Rhythm Of The Night");
  assert.equal(parsed.displayTitle, "Don Diablo - The Rhythm Of The Night");
});

test("track search text removes broadcast noise for better cover lookup", () => {
  const cleaned = normalizeTrackSearchText("Metro (Played by Mau P Freedom TML 24)");

  assert.equal(cleaned, "Metro");
});

test("AcoustID candidate extraction keeps artist, title, album, and score", () => {
  const candidate = extractAcoustIdCandidate(
    { id: "acoustid-1", score: 0.91 },
    {
      id: "2f1f6b1f-0d34-4d84-ae8e-9b2d4c69f555",
      title: "The Rhythm Of The Night",
      artists: [{ name: "Corona" }],
      releases: [{ id: "e50d244f-97db-4f3b-8208-0f5e4f89b8e1", title: "The Rhythm Of The Night" }],
    }
  );

  assert.equal(candidate.artist, "Corona");
  assert.equal(candidate.title, "The Rhythm Of The Night");
  assert.equal(candidate.album, "The Rhythm Of The Night");
  assert.equal(candidate.score, 0.91);
});

test("AcoustID best-match selection rejects weak matches and prefers the richest strong match", () => {
  const match = selectBestAcoustIdMatch({
    status: "ok",
    results: [
      {
        id: "weak",
        score: 0.31,
        recordings: [{ title: "Unknown Song", artists: [{ name: "Unknown Artist" }] }],
      },
      {
        id: "strong",
        score: 0.88,
        recordings: [{
          id: "2f1f6b1f-0d34-4d84-ae8e-9b2d4c69f555",
          title: "Starlight",
          artists: [{ name: "The Supermen Lovers", joinphrase: " feat. " }, { name: "Mani Hoffman" }],
          releases: [{ id: "e50d244f-97db-4f3b-8208-0f5e4f89b8e1", title: "The Player" }],
        }],
      },
    ],
  });

  assert.ok(match);
  assert.equal(match.displayTitle, "The Supermen Lovers feat. Mani Hoffman - Starlight");
  assert.equal(match.album, "The Player");
  assert.equal(match.acoustidId, "strong");
});

test("event time parser accepts screenshot-style YYYY-DD-MM input", () => {
  const parsed = buildEventDateTimeFromParts({
    rawDateTime: "2026-28-02 20:15",
    language: "de",
    preferredTimeZone: "Europe/Berlin",
    nowMs: Date.UTC(2026, 1, 20, 12, 0, 0, 0),
  });

  assert.equal(parsed.ok, true);
  assert.equal(new Date(parsed.runAtMs).toISOString(), "2026-02-28T19:15:00.000Z");
});

test("event time parser accepts time-only input and starts immediately around now", () => {
  const nowMs = Date.UTC(2026, 1, 28, 19, 0, 30, 0);
  const parsed = buildEventDateTimeFromParts({
    rawDateTime: "20:00",
    language: "de",
    preferredTimeZone: "Europe/Berlin",
    nowMs,
    fallbackRunAtMs: nowMs,
  });

  assert.equal(parsed.ok, true);
  assert.equal(parsed.runAtMs, nowMs);
});
