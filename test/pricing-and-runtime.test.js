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
import { BotRuntime } from "../src/bot/runtime.js";
import { networkRecoveryCoordinator } from "../src/core/network-recovery.js";

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

test("reconnect scheduling is skipped while a voice connection attempt is already in flight", async () => {
  const runtime = new BotRuntime({
    id: "test-runtime",
    clientId: "123456789012345678",
    token: "unit-test-token",
    name: "OmniFM Test",
    requiredTier: "free",
  });

  const state = runtime.getState("guild-voice");
  state.shouldReconnect = true;
  state.lastChannelId = "voice-1";
  runtime.beginVoiceConnectionAttempt(state, "voice-1");
  runtime.scheduleReconnect("guild-voice", { reason: "unit-test" });

  assert.equal(state.reconnectTimer, null);
  assert.equal(state.reconnectAttempts, 0);

  await runtime.stop();
});

test("now playing cleanup runs before the tracked target is replaced", async () => {
  const runtime = new BotRuntime({
    id: "test-runtime-2",
    clientId: "223456789012345678",
    token: "unit-test-token",
    name: "OmniFM Test 2",
    requiredTier: "free",
  });

  const state = runtime.getState("guild-now-playing");
  state.nowPlayingChannelId = "text-1";
  state.nowPlayingMessageId = "message-1";

  let cleanupCall = null;
  runtime.queueDeleteNowPlayingMessage = (guildId, targetState) => {
    cleanupCall = {
      guildId,
      channelId: targetState.nowPlayingChannelId,
      messageId: targetState.nowPlayingMessageId,
    };
  };

  const changed = runtime.markNowPlayingTargetDirty("guild-now-playing", state, "voice-2");

  assert.equal(changed, true);
  assert.deepEqual(cleanupCall, {
    guildId: "guild-now-playing",
    channelId: "text-1",
    messageId: "message-1",
  });
  assert.equal(state.nowPlayingMessageId, null);
  assert.equal(state.nowPlayingChannelId, null);

  await runtime.stop();
});

test("upsert now playing cleans up the old message before posting into a different channel", async () => {
  const runtime = new BotRuntime({
    id: "test-runtime-3",
    clientId: "323456789012345678",
    token: "unit-test-token",
    name: "OmniFM Test 3",
    requiredTier: "free",
  });

  const state = runtime.getState("guild-upsert");
  state.nowPlayingChannelId = "text-1";
  state.nowPlayingMessageId = "message-1";

  let cleanupCall = null;
  runtime.queueDeleteNowPlayingMessage = (guildId, targetState) => {
    cleanupCall = {
      guildId,
      channelId: targetState.nowPlayingChannelId,
      messageId: targetState.nowPlayingMessageId,
    };
  };

  const targetChannel = {
    id: "text-2",
    name: "radio-updates",
    messages: {
      fetch: async () => null,
    },
    send: async () => ({ id: "message-2" }),
  };

  const sent = await runtime.upsertNowPlayingMessage(
    "guild-upsert",
    state,
    { embeds: [], components: [] },
    targetChannel,
  );

  assert.equal(sent, true);
  assert.deepEqual(cleanupCall, {
    guildId: "guild-upsert",
    channelId: "text-1",
    messageId: "message-1",
  });
  assert.equal(state.nowPlayingChannelId, "text-2");
  assert.equal(state.nowPlayingMessageId, "message-2");

  await runtime.stop();
});

test("now playing cleanup runs when no suitable target channel remains", async () => {
  const runtime = new BotRuntime({
    id: "test-runtime-4",
    clientId: "423456789012345678",
    token: "unit-test-token",
    name: "OmniFM Test 4",
    requiredTier: "free",
  });

  const state = runtime.getState("guild-no-channel");
  state.currentStationKey = "station-1";
  state.connection = { joinConfig: { channelId: "voice-1" } };
  state.nowPlayingChannelId = "text-1";
  state.nowPlayingMessageId = "message-1";
  state.nowPlayingSignature = "sig-1";

  let cleanupCall = null;
  runtime.resolveNowPlayingChannel = async () => null;
  runtime.queueDeleteNowPlayingMessage = (guildId, targetState) => {
    cleanupCall = {
      guildId,
      channelId: targetState.nowPlayingChannelId,
      messageId: targetState.nowPlayingMessageId,
    };
    targetState.nowPlayingChannelId = null;
    targetState.nowPlayingMessageId = null;
  };
  runtime.logNowPlayingIssue = () => {};

  await runtime.updateNowPlayingEmbed("guild-no-channel", state);

  assert.deepEqual(cleanupCall, {
    guildId: "guild-no-channel",
    channelId: "text-1",
    messageId: "message-1",
  });
  assert.equal(state.nowPlayingSignature, null);

  await runtime.stop();
});

test("voice reconnect scheduling caps excessive global network cooldown delays", async () => {
  const runtime = new BotRuntime({
    id: "test-runtime-5",
    clientId: "523456789012345678",
    token: "unit-test-token",
    name: "OmniFM Test 5",
    requiredTier: "free",
  });

  const state = runtime.getState("guild-network-cap");
  state.shouldReconnect = true;
  state.lastChannelId = "voice-1";

  const originalGetRecoveryDelayMs = networkRecoveryCoordinator.getRecoveryDelayMs;
  const originalSetTimeout = globalThis.setTimeout;
  let capturedDelay = null;

  networkRecoveryCoordinator.getRecoveryDelayMs = () => 180_000;
  globalThis.setTimeout = (fn, delay) => {
    capturedDelay = delay;
    return {
      unref() {},
    };
  };

  try {
    runtime.scheduleReconnect("guild-network-cap", { reason: "voice-error" });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    networkRecoveryCoordinator.getRecoveryDelayMs = originalGetRecoveryDelayMs;
    state.reconnectTimer = null;
  }

  assert.equal(typeof capturedDelay, "number");
  assert.ok(capturedDelay < 60_000, `expected capped reconnect delay, got ${capturedDelay}`);

  await runtime.stop();
});

test("voice lost keeps an already queued reconnect timer instead of replacing it", async () => {
  const runtime = new BotRuntime({
    id: "test-runtime-6",
    clientId: "623456789012345678",
    token: "unit-test-token",
    name: "OmniFM Test 6",
    requiredTier: "free",
  });

  runtime.client.user = {
    id: "bot-user",
    setPresence() {},
  };

  const state = runtime.getState("guild-voice-lost");
  state.shouldReconnect = true;
  state.currentStationKey = "station-1";
  state.lastChannelId = "voice-1";
  state.connection = {
    joinConfig: { channelId: "voice-1" },
    destroy() {},
  };

  const existingTimer = setTimeout(() => {}, 60_000);
  state.reconnectTimer = existingTimer;

  let scheduleCalls = 0;
  runtime.scheduleReconnect = () => {
    scheduleCalls += 1;
  };
  runtime.persistState = () => {};
  runtime.syncVoiceChannelStatus = () => Promise.resolve();

  runtime.handleBotVoiceStateUpdate(
    { channelId: "voice-1" },
    {
      id: "bot-user",
      guild: { id: "guild-voice-lost" },
      channelId: null,
    },
  );

  assert.equal(state.reconnectTimer, existingTimer);
  assert.equal(scheduleCalls, 0);

  await runtime.stop();
});

test("guild voice join lock serializes concurrent join attempts across runtimes", async () => {
  const runtimeA = new BotRuntime({
    id: "test-runtime-7",
    clientId: "723456789012345678",
    token: "unit-test-token",
    name: "OmniFM Test 7A",
    requiredTier: "free",
  });
  const runtimeB = new BotRuntime({
    id: "test-runtime-8",
    clientId: "823456789012345678",
    token: "unit-test-token",
    name: "OmniFM Test 7B",
    requiredTier: "free",
  });

  const steps = [];
  let releaseFirstJoin = null;
  const firstJoin = runtimeA.withGuildVoiceJoinLock(
    "guild-voice-lock",
    async () => {
      steps.push("join-a-start");
      await new Promise((resolve) => {
        releaseFirstJoin = resolve;
      });
      steps.push("join-a-end");
    },
    { reason: "test", cooldownMs: 0 },
  );

  await Promise.resolve();

  const secondJoin = runtimeB.withGuildVoiceJoinLock(
    "guild-voice-lock",
    async () => {
      steps.push("join-b-start");
    },
    { reason: "test", cooldownMs: 0 },
  );

  await Promise.resolve();
  assert.deepEqual(steps, ["join-a-start"]);

  releaseFirstJoin();
  await Promise.all([firstJoin, secondJoin]);

  assert.deepEqual(steps, ["join-a-start", "join-a-end", "join-b-start"]);

  await runtimeA.stop();
  await runtimeB.stop();
});
