import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSessionListenerSegments,
  summarizeSessionListeners,
  buildDailyListeningBreakdown,
} from "../src/listening-stats-store.js";

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
