import test from "node:test";
import assert from "node:assert/strict";

import { buildListeningAnalyticsFromStats } from "../src/listening-stats-store.js";

test("listening analytics ranks stations by listener hours and keeps channel details", () => {
  const analytics = buildListeningAnalyticsFromStats({
    guildId: "123456789012345678",
    totalStarts: 9,
    totalStreamSeconds: 54_000,
    totalListenerSeconds: 72_000,
    totalActiveSeconds: 32_400,
    peakListeners: 5,
    lastStartedAt: Date.UTC(2026, 1, 28, 18, 0, 0, 0),
    stationStats: {
      chill: {
        key: "chill",
        name: "Chillout Radio",
        totalStarts: 3,
        totalStreamSeconds: 18_000,
        totalListenerSeconds: 10_800,
        totalActiveSeconds: 7_200,
        peakListeners: 3,
        lastStartedAt: Date.UTC(2026, 1, 28, 18, 0, 0, 0),
      },
      rock: {
        key: "rock",
        name: "Rock Radio",
        totalStarts: 6,
        totalStreamSeconds: 36_000,
        totalListenerSeconds: 61_200,
        totalActiveSeconds: 25_200,
        peakListeners: 5,
        lastStartedAt: Date.UTC(2026, 1, 27, 18, 0, 0, 0),
      },
    },
    channelStats: {
      "111": {
        channelId: "111",
        name: "RADIO 1",
        totalStarts: 4,
        totalStreamSeconds: 18_000,
        totalListenerSeconds: 28_800,
        totalActiveSeconds: 10_800,
        peakListeners: 4,
      },
      "222": {
        channelId: "222",
        name: "RADIO 2",
        totalStarts: 5,
        totalStreamSeconds: 36_000,
        totalListenerSeconds: 43_200,
        totalActiveSeconds: 21_600,
        peakListeners: 5,
      },
    },
    dailyStats: {
      "2026-02-27": {
        day: "2026-02-27",
        starts: 4,
        streamSeconds: 18_000,
        listenerSeconds: 21_600,
        activeSeconds: 10_800,
        peakListeners: 4,
      },
      "2026-02-28": {
        day: "2026-02-28",
        starts: 5,
        streamSeconds: 36_000,
        listenerSeconds: 50_400,
        activeSeconds: 21_600,
        peakListeners: 5,
      },
    },
    hourListenerSeconds: {
      "17": 14_400,
      "18": 28_800,
    },
  }, {
    windowDays: 365,
    stationLimit: 10,
    channelLimit: 10,
    dailyLimit: 10,
  });

  assert.equal(analytics.topStation?.name, "Rock Radio");
  assert.equal(analytics.stations[0]?.listenerSeconds, 61_200);
  assert.equal(analytics.channels[0]?.name, "RADIO 2");
  assert.equal(analytics.topHour?.hour, 18);
  assert.equal(analytics.lifetime.stationCount, 2);
});

test("listening analytics window summary uses recent daily buckets only", () => {
  const now = Date.now();
  const recentDay = new Date(now - (2 * 24 * 60 * 60 * 1000));
  const oldDay = new Date(now - (250 * 24 * 60 * 60 * 1000));
  const recentKey = `${recentDay.getFullYear()}-${String(recentDay.getMonth() + 1).padStart(2, "0")}-${String(recentDay.getDate()).padStart(2, "0")}`;
  const oldKey = `${oldDay.getFullYear()}-${String(oldDay.getMonth() + 1).padStart(2, "0")}-${String(oldDay.getDate()).padStart(2, "0")}`;

  const analytics = buildListeningAnalyticsFromStats({
    guildId: "123456789012345678",
    dailyStats: {
      [recentKey]: {
        day: recentKey,
        starts: 3,
        streamSeconds: 7_200,
        listenerSeconds: 10_800,
        activeSeconds: 3_600,
        peakListeners: 2,
      },
      [oldKey]: {
        day: oldKey,
        starts: 9,
        streamSeconds: 14_400,
        listenerSeconds: 28_800,
        activeSeconds: 7_200,
        peakListeners: 6,
      },
    },
    hourListenerSeconds: {
      "8": 3_600,
    },
  }, {
    windowDays: 30,
    stationLimit: 5,
    channelLimit: 5,
    dailyLimit: 10,
  });

  assert.equal(analytics.window.totalStarts, 3);
  assert.equal(analytics.window.totalListenerSeconds, 10_800);
  assert.equal(analytics.window.peakListeners, 2);
  assert.equal(analytics.window.topDay?.day, recentKey);
});
