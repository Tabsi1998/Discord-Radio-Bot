import test from "node:test";
import assert from "node:assert/strict";

import {
  calculatePrice,
  calculateUpgradePrice,
  seatPricingInEuro,
  isWithinWorkerPlanLimit,
} from "../src/lib/helpers.js";
import { buildCommandsJson } from "../src/commands.js";
import { WorkerManager } from "../src/bot/worker-manager.js";
import { BotRuntime } from "../src/bot/runtime.js";
import { shouldLogFfmpegStderrLine } from "../src/lib/logging.js";
import { NowPlayingQueue } from "../src/lib/now-playing-queue.js";
import { buildEventDateTimeFromParts } from "../src/lib/event-time.js";
import {
  buildNowPlayingSignature,
  getNowPlayingCandidateIds,
} from "../src/lib/now-playing-target.js";
import {
  parseTrackFromStreamTitle,
  extractTrackFromMetadataText,
  hasUsableStreamTrack,
  normalizeTrackSearchText,
} from "../src/services/now-playing.js";
import {
  estimatePcmWavDurationSeconds,
  extractAcoustIdCandidate,
  extractFpcalcResultFromError,
  isFpcalcMissingInputError,
  isSoftRecognitionFailure,
  parseFpcalcOutput,
  selectBestAcoustIdMatch,
} from "../src/services/audio-recognition.js";
import { getDefaultLanguage } from "../src/i18n.js";

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

test("public bot status omits guild details while dashboard status keeps them", () => {
  const fakeRuntime = {
    collectStats() {
      return { servers: 3, users: 42, connections: 1, listeners: 7 };
    },
    getApplicationId() {
      return "app-123";
    },
    getCurrentListenerCount() {
      return 7;
    },
    config: {
      id: "bot-1",
      index: 1,
      name: "OmniFM Bot 1",
      clientId: "client-123",
      requiredTier: "free",
    },
    role: "commander",
    client: {
      isReady: () => true,
      user: {
        tag: "OmniFM#0001",
        displayAvatarURL: () => "https://example.com/avatar.png",
      },
      guilds: {
        cache: new Map([
          ["guild-1", {
            name: "Guild One",
            channels: {
              cache: new Map([
                ["voice-1", { name: "Radio" }],
              ]),
            },
          }],
        ]),
      },
    },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "custom:secret-fm",
        currentStationName: "Secret FM",
        lastChannelId: "voice-1",
        volume: 80,
        connection: { joinConfig: { channelId: "voice-1" } },
        currentMeta: { title: "Hidden Track" },
      }],
    ]),
    startedAt: Date.now() - 5_000,
    startError: null,
  };

  fakeRuntime.buildStatusSnapshot = BotRuntime.prototype.buildStatusSnapshot;

  const publicStatus = BotRuntime.prototype.getPublicStatus.call(fakeRuntime);
  assert.equal("guildDetails" in publicStatus, false);
  assert.equal(publicStatus.listeners, 7);
  assert.equal(typeof publicStatus.inviteUrl, "string");

  const dashboardStatus = BotRuntime.prototype.getDashboardStatus.call(fakeRuntime);
  assert.equal(Array.isArray(dashboardStatus.guildDetails), true);
  assert.equal(dashboardStatus.guildDetails.length, 1);
  assert.deepEqual(dashboardStatus.guildDetails[0], {
    guildId: "guild-1",
    guildName: "Guild One",
    stationKey: "custom:secret-fm",
    stationName: "Secret FM",
    channelId: "voice-1",
    channelName: "Radio",
    listenerCount: 7,
    volume: 80,
    playing: true,
    meta: { title: "Hidden Track" },
  });
});

test("programmatic stop routes through resetVoiceSession so listening sessions are finalized", () => {
  let resetArgs = null;
  const fakeState = { shouldReconnect: true };
  const fakeRuntime = {
    guildState: new Map([["guild-1", fakeState]]),
    resetVoiceSession(guildId, state, options) {
      resetArgs = { guildId, state, options };
    },
  };

  const result = BotRuntime.prototype.stopInGuild.call(fakeRuntime, "guild-1");

  assert.deepEqual(result, { ok: true });
  assert.equal(fakeState.shouldReconnect, false);
  assert.deepEqual(resetArgs, {
    guildId: "guild-1",
    state: fakeState,
    options: { preservePlaybackTarget: false, clearLastChannel: true },
  });
});

test("commander live playback snapshots include the commander's own stream and worker streams", () => {
  const workerRuntime = {
    config: { id: "bot-worker" },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "worker-station",
        currentStationName: "Worker FM",
        lastChannelId: "voice-2",
        connection: { joinConfig: { channelId: "voice-2" } },
      }],
    ]),
    getState(guildId) {
      return this.guildState.get(guildId);
    },
    getGuildInfo(guildId) {
      const state = this.guildState.get(guildId);
      return {
        stationKey: state.currentStationKey,
        stationName: state.currentStationName,
        channelId: state.lastChannelId,
      };
    },
    getCurrentListenerCount() {
      return 4;
    },
  };
  const fakeRuntime = {
    role: "commander",
    workerManager: {
      getStreamingWorkers() {
        return [workerRuntime];
      },
    },
    guildState: new Map([
      ["guild-1", {
        currentStationKey: "commander-station",
        currentStationName: "Commander FM",
        lastChannelId: "voice-1",
        connection: { joinConfig: { channelId: "voice-1" } },
      }],
    ]),
    getGuildInfo(guildId) {
      const state = this.guildState.get(guildId);
      return {
        stationKey: state.currentStationKey,
        stationName: state.currentStationName,
        channelId: state.lastChannelId,
      };
    },
    getCurrentListenerCount(guildId, state) {
      return state.lastChannelId === "voice-1" ? 2 : 0;
    },
  };

  fakeRuntime.buildLocalLivePlaybackSnapshot = BotRuntime.prototype.buildLocalLivePlaybackSnapshot;

  const snapshot = BotRuntime.prototype.getLiveGuildPlaybackSnapshot.call(fakeRuntime, "guild-1");

  assert.equal(snapshot.length, 2);
  assert.deepEqual(
    snapshot.map((entry) => ({ stationName: entry.stationName, listenerCount: entry.listenerCount })),
    [
      { stationName: "Commander FM", listenerCount: 2 },
      { stationName: "Worker FM", listenerCount: 4 },
    ]
  );
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

test("now playing prefers the active voice channel over a remembered legacy target", () => {
  const candidateIds = getNowPlayingCandidateIds({
    nowPlayingChannelId: "legacy-text",
    connection: { joinConfig: { channelId: "voice-1" } },
    lastChannelId: "voice-1",
  }, {
    systemChannelId: "system-1",
  });

  assert.deepEqual(candidateIds, ["voice-1", "legacy-text", "system-1"]);
});

test("now playing signature changes when the embed target channel changes", () => {
  const meta = {
    displayTitle: "Artist - Track",
    artist: "Artist",
    title: "Track",
    artworkUrl: "https://example.com/cover.jpg",
    album: "Album",
    metadataStatus: "ok",
    metadataSource: "icy",
    musicBrainzRecordingId: "recording-1",
    musicBrainzReleaseId: "release-1",
  };
  const state = {
    connection: { joinConfig: { channelId: "voice-1" } },
    lastChannelId: "voice-1",
  };

  const activeVoiceSignature = buildNowPlayingSignature("station-a", meta, state, "voice-1");
  const legacyTargetSignature = buildNowPlayingSignature("station-a", meta, state, "legacy-text");

  assert.notEqual(activeVoiceSignature, legacyTargetSignature);
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

test("metadata parser accepts double-quoted artist/title/album fields", () => {
  const parsed = extractTrackFromMetadataText('artist="Martin Ikin";title="Out of my Head";album="Out of my Head";');

  assert.equal(parsed.artist, "Martin Ikin");
  assert.equal(parsed.title, "Out of my Head");
  assert.equal(parsed.album, "Out of my Head");
  assert.equal(parsed.displayTitle, "Martin Ikin - Out of my Head");
});

test("usable stream metadata is enough to skip audio recognition fallback", () => {
  assert.equal(hasUsableStreamTrack({ displayTitle: "Artist - Title" }), true);
  assert.equal(hasUsableStreamTrack({ raw: "Station Artist - Song" }), true);
  assert.equal(hasUsableStreamTrack({ artist: "", title: "" }), false);
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

test("fpcalc output parser extracts duration and fingerprint", () => {
  const parsed = parseFpcalcOutput("FILE=sample.wav\nDURATION=17.8\nFINGERPRINT=abc123\n");

  assert.deepEqual(parsed, {
    duration: 18,
    fingerprint: "abc123",
  });
});

test("fpcalc code 3 with usable stdout still yields a fingerprint result", () => {
  const error = Object.assign(new Error("fpcalc exited with code 3"), {
    code: 3,
    command: "fpcalc",
    stdout: "ERROR: Error decoding audio frame (End of file)\nDURATION=22\nFINGERPRINT=abc123\n",
  });

  assert.deepEqual(extractFpcalcResultFromError(error), {
    duration: 22,
    fingerprint: "abc123",
  });
});

test("wav duration estimate matches mono 11025 Hz PCM sizing", () => {
  const bytesForTwelveSeconds = 44 + (12 * 11025 * 2);
  assert.equal(estimatePcmWavDurationSeconds(bytesForTwelveSeconds), 12);
});

test("wav duration estimate respects configured sample rate and channels", () => {
  const bytesForEightSecondsStereo = 44 + (8 * 44100 * 2 * 2);
  assert.equal(estimatePcmWavDurationSeconds(bytesForEightSecondsStereo, 44100, 2), 8);
});

test("recognition decode EOF errors are treated as soft failures", () => {
  const error = new Error("fpcalc exited with code 3: ERROR: Error decoding audio frame (End of file)");
  assert.equal(isSoftRecognitionFailure(error), true);
});

test("recognition EOF errors remain soft failures for retryable sample repair", () => {
  const error = new Error("fpcalc exited with code 3: ERROR: Error decoding audio frame (End of file)");
  assert.equal(isSoftRecognitionFailure(error), true);
});

test("recognition missing-input errors are treated as soft failures", () => {
  const error = new Error("fpcalc exited with code 2: ERROR: Could not open the input file (No such file or directory)");
  assert.equal(isFpcalcMissingInputError(error), true);
  assert.equal(isSoftRecognitionFailure(error), true);
});

test("now playing queue coalesces duplicate queued task ids", async () => {
  const queue = new NowPlayingQueue(1);
  let releaseFirstTask;
  let secondTaskRuns = 0;

  const firstTask = queue.enqueue("guild-1", async () => new Promise((resolve) => {
    releaseFirstTask = resolve;
  }));
  const secondTaskA = queue.enqueue("guild-2", async () => {
    secondTaskRuns += 1;
    return "first";
  });
  const secondTaskB = queue.enqueue("guild-2", async () => {
    secondTaskRuns += 1;
    return "second";
  });

  assert.equal(secondTaskA, secondTaskB);
  releaseFirstTask();
  await firstTask;
  const result = await secondTaskB;

  assert.equal(result, "second");
  assert.equal(secondTaskRuns, 1);
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

test("default language falls back to English when nothing explicit is set", () => {
  assert.equal(getDefaultLanguage(), "en");
});

test("slash commands expose English defaults with German localizations", () => {
  const commands = buildCommandsJson();
  const play = commands.find((command) => command.name === "play");
  const language = commands.find((command) => command.name === "language");

  assert.ok(play);
  assert.equal(play.description, "Start a radio stream in your voice channel");
  assert.equal(play.description_localizations.de, "Startet einen Radio-Stream in deinem Voice-Channel");

  assert.ok(language);
  assert.equal(language.description, "Manage the language for this server");
  assert.equal(language.description_localizations.de, "Sprache für diesen Server verwalten");
});
