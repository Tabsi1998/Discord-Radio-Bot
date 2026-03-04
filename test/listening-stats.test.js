import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildSessionListenerSegments,
  summarizeSessionListeners,
  buildDailyListeningBreakdown,
  startListeningSession,
  recordSessionListenerSample,
  endListeningSession,
  getGlobalStats,
  recordGuildListenerSample,
  getGuildListenerTimeline,
  recordConnectionEvent,
  getGuildConnectionHealth,
  getGuildSessionHistory,
  getGuildDailyStats,
  resetGuildStats,
  __resetListeningStatsStoreForTests,
} from "../src/listening-stats-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.resolve(__dirname, "..", "listening-stats.json");
const BACKUP_FILE = `${STORE_FILE}.bak`;
const TEST_GUILD_ID = "123456789012345678";

function snapshotFile(filePath) {
  if (!fs.existsSync(filePath)) return { exists: false, content: "" };
  return { exists: true, content: fs.readFileSync(filePath, "utf8") };
}

function restoreFile(filePath, snapshot) {
  if (!snapshot?.exists) {
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch {}
    return;
  }
  fs.writeFileSync(filePath, snapshot.content, "utf8");
}

async function withIsolatedStatsStore(fn) {
  const storeSnapshot = snapshotFile(STORE_FILE);
  const backupSnapshot = snapshotFile(BACKUP_FILE);
  const realNow = Date.now;

  __resetListeningStatsStoreForTests({ deleteFiles: true });

  try {
    await fn({
      setNow(value) {
        Date.now = () => value;
      },
      advanceNow(deltaMs) {
        const current = Date.now();
        Date.now = () => current + deltaMs;
      },
    });
  } finally {
    Date.now = realNow;
    restoreFile(STORE_FILE, storeSnapshot);
    restoreFile(BACKUP_FILE, backupSnapshot);
    __resetListeningStatsStoreForTests();
  }
}

test("session summaries use a full-session time-weighted listener average", () => {
  const startedAtMs = Date.UTC(2026, 2, 3, 16, 0, 0);
  const endedAtMs = startedAtMs + (20 * 60 * 1000);
  const samples = [
    { t: startedAtMs, n: 0 },
    { t: startedAtMs + (5 * 60 * 1000), n: 3 },
    { t: startedAtMs + (15 * 60 * 1000), n: 0 },
  ];

  const summary = summarizeSessionListeners({ samples, startedAtMs, endedAtMs });

  assert.equal(summary.durationMs, 20 * 60 * 1000);
  assert.equal(summary.humanListeningMs, 10 * 60 * 1000);
  assert.equal(summary.avgListeners, 2);
  assert.equal(summary.peakListeners, 3);
});

test("session segments stay ordered and close on the session end", () => {
  const startedAtMs = Date.UTC(2026, 2, 3, 18, 0, 0);
  const endedAtMs = startedAtMs + (12 * 60 * 1000);
  const samples = [
    { t: startedAtMs + (4 * 60 * 1000), n: 2 },
    { t: startedAtMs, n: 1 },
    { t: startedAtMs + (8 * 60 * 1000), n: 0 },
  ];

  const segments = buildSessionListenerSegments({ samples, startedAtMs, endedAtMs });

  assert.deepEqual(
    segments.map((segment) => ({ listeners: segment.listeners, durationMs: segment.durationMs })),
    [
      { listeners: 1, durationMs: 4 * 60 * 1000 },
      { listeners: 2, durationMs: 4 * 60 * 1000 },
      { listeners: 0, durationMs: 4 * 60 * 1000 },
    ]
  );
});

test("daily listening breakdown splits sessions across midnight", () => {
  const startedAtMs = new Date(2026, 2, 3, 23, 50, 0, 0).getTime();
  const endedAtMs = new Date(2026, 2, 4, 1, 10, 0, 0).getTime();
  const samples = [
    { t: startedAtMs, n: 2 },
    { t: endedAtMs, n: 0 },
  ];

  const breakdown = buildDailyListeningBreakdown({ samples, startedAtMs, endedAtMs });

  assert.equal(breakdown.length, 2);
  assert.deepEqual(breakdown[0], {
    date: "2026-03-03",
    totalListeningMs: 10 * 60 * 1000,
    peakListeners: 2,
  });
  assert.deepEqual(breakdown[1], {
    date: "2026-03-04",
    totalListeningMs: 70 * 60 * 1000,
    peakListeners: 2,
  });
});

test("global stats include active listening time from in-flight sessions", async () => {
  await withIsolatedStatsStore(async ({ setNow }) => {
    const startedAtMs = Date.UTC(2026, 2, 4, 12, 0, 0);
    setNow(startedAtMs);
    startListeningSession(TEST_GUILD_ID, {
      botId: "bot-1",
      stationKey: "reggaeton",
      stationName: "Reggaeton",
      channelId: "voice-1",
      listenerCount: 0,
    });

    setNow(startedAtMs + (5 * 60 * 1000));
    recordSessionListenerSample(TEST_GUILD_ID, { botId: "bot-1", listenerCount: 3, timestampMs: Date.now() });
    setNow(startedAtMs + (15 * 60 * 1000));
    recordSessionListenerSample(TEST_GUILD_ID, { botId: "bot-1", listenerCount: 0, timestampMs: Date.now() });
    setNow(startedAtMs + (20 * 60 * 1000));

    const stats = await getGlobalStats();

    assert.equal(stats.activeListeningMs, 10 * 60 * 1000);
    assert.equal(stats.totalListeningMs, 10 * 60 * 1000);
    assert.equal(stats.completedListeningMs, 0);
  });
});

test("listener timeline fallback deduplicates unchanged samples but keeps later buckets and changes", async () => {
  await withIsolatedStatsStore(async ({ setNow }) => {
    const startedAtMs = Date.UTC(2026, 2, 4, 9, 0, 0);
    setNow(startedAtMs);
    recordGuildListenerSample(TEST_GUILD_ID, 2, Date.now());
    setNow(startedAtMs + 30_000);
    recordGuildListenerSample(TEST_GUILD_ID, 2, Date.now());
    setNow(startedAtMs + 130_000);
    recordGuildListenerSample(TEST_GUILD_ID, 2, Date.now());
    setNow(startedAtMs + 150_000);
    recordGuildListenerSample(TEST_GUILD_ID, 4, Date.now());

    const timeline = await getGuildListenerTimeline(TEST_GUILD_ID, 24);

    assert.equal(timeline.length, 3);
    assert.deepEqual(timeline.map((item) => item.listeners), [2, 2, 4]);
  });
});

test("connection health fallback counts the full range instead of truncating to 100 events", async () => {
  await withIsolatedStatsStore(async ({ setNow }) => {
    const startedAtMs = Date.UTC(2026, 2, 4, 10, 0, 0);
    for (let index = 0; index < 120; index += 1) {
      setNow(startedAtMs + (index * 1_000));
      recordConnectionEvent(TEST_GUILD_ID, { botId: "bot-1", eventType: "connect", channelId: "voice-1" });
    }
    for (let index = 0; index < 3; index += 1) {
      setNow(startedAtMs + (200_000 + index * 1_000));
      recordConnectionEvent(TEST_GUILD_ID, { botId: "bot-1", eventType: "error", channelId: "voice-1" });
    }

    const health = await getGuildConnectionHealth(TEST_GUILD_ID, 7);

    assert.equal(health.connects, 120);
    assert.equal(health.errors, 3);
    assert.equal(health.events.length, 100);
  });
});

test("fallback detail data survives session writes and reset removes all guild detail state", async () => {
  await withIsolatedStatsStore(async ({ setNow }) => {
    const startedAtMs = Date.UTC(2026, 2, 4, 14, 0, 0);
    setNow(startedAtMs);
    startListeningSession(TEST_GUILD_ID, {
      botId: "bot-1",
      stationKey: "hiphopradio",
      stationName: "Hip Hop Radio",
      channelId: "voice-1",
      listenerCount: 0,
    });
    setNow(startedAtMs + (5 * 60 * 1000));
    recordSessionListenerSample(TEST_GUILD_ID, { botId: "bot-1", listenerCount: 2, timestampMs: Date.now() });
    setNow(startedAtMs + (15 * 60 * 1000));
    recordSessionListenerSample(TEST_GUILD_ID, { botId: "bot-1", listenerCount: 0, timestampMs: Date.now() });
    setNow(startedAtMs + (20 * 60 * 1000));
    await endListeningSession(TEST_GUILD_ID, { botId: "bot-1" });
    recordGuildListenerSample(TEST_GUILD_ID, 1, Date.now());
    recordConnectionEvent(TEST_GUILD_ID, { botId: "bot-1", eventType: "reconnect", channelId: "voice-1" });

    const sessionHistory = await getGuildSessionHistory(TEST_GUILD_ID, 5);
    const dailyStats = await getGuildDailyStats(TEST_GUILD_ID, 5);
    const timeline = await getGuildListenerTimeline(TEST_GUILD_ID, 24);
    const health = await getGuildConnectionHealth(TEST_GUILD_ID, 7);

    assert.equal(sessionHistory.length, 1);
    assert.equal(sessionHistory[0].humanListeningMs, 10 * 60 * 1000);
    assert.equal(dailyStats.length, 1);
    assert.equal(dailyStats[0].totalListeningMs, 10 * 60 * 1000);
    assert.equal(timeline.length, 1);
    assert.equal(health.reconnects, 1);

    resetGuildStats(TEST_GUILD_ID);

    assert.deepEqual(await getGuildSessionHistory(TEST_GUILD_ID, 5), []);
    assert.deepEqual(await getGuildDailyStats(TEST_GUILD_ID, 5), []);
    assert.deepEqual(await getGuildListenerTimeline(TEST_GUILD_ID, 24), []);
    assert.deepEqual(await getGuildConnectionHealth(TEST_GUILD_ID, 7), { connects: 0, reconnects: 0, errors: 0, events: [] });
  });
});
