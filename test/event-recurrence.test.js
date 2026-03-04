import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDiscordScheduledEventRecurrenceRule,
  computeNextEventRunAtMs,
  getRepeatLabel,
} from "../src/lib/event-time.js";

test("buildDiscordScheduledEventRecurrenceRule creates a weekly recurrence for the event weekday", () => {
  const runAtMs = Date.parse("2026-03-06T21:00:00.000Z");
  const rule = buildDiscordScheduledEventRecurrenceRule(runAtMs, "weekly", "Europe/Vienna");

  assert.ok(rule);
  assert.equal(rule.frequency, 2);
  assert.equal(rule.interval, 1);
  assert.deepEqual(rule.byWeekday, [4]);
});

test("buildDiscordScheduledEventRecurrenceRule supports biweekly, weekdays, yearly and monthly patterns", () => {
  const runAtMs = Date.parse("2026-03-06T21:00:00.000Z");

  const biweekly = buildDiscordScheduledEventRecurrenceRule(runAtMs, "biweekly", "Europe/Vienna");
  assert.equal(biweekly.frequency, 2);
  assert.equal(biweekly.interval, 2);
  assert.deepEqual(biweekly.byWeekday, [4]);

  const weekdays = buildDiscordScheduledEventRecurrenceRule(runAtMs, "weekdays", "Europe/Vienna");
  assert.equal(weekdays.frequency, 3);
  assert.deepEqual(weekdays.byWeekday, [0, 1, 2, 3, 4]);

  const yearly = buildDiscordScheduledEventRecurrenceRule(runAtMs, "yearly", "Europe/Vienna");
  assert.equal(yearly.frequency, 0);
  assert.deepEqual(yearly.byMonth, [3]);
  assert.deepEqual(yearly.byMonthDay, [6]);

  const monthly = buildDiscordScheduledEventRecurrenceRule(runAtMs, "monthly_first_weekday", "Europe/Vienna");
  assert.equal(monthly.frequency, 1);
  assert.deepEqual(monthly.byNWeekday, [{ n: 1, day: 4 }]);
});

test("computeNextEventRunAtMs supports weekdays, biweekly and yearly schedules", () => {
  const fridayRunAtMs = Date.parse("2026-03-06T21:00:00.000Z");

  const weekdaysNext = computeNextEventRunAtMs(
    fridayRunAtMs,
    "weekdays",
    Date.parse("2026-03-06T21:05:00.000Z"),
    "Europe/Vienna"
  );
  assert.equal(new Date(weekdaysNext).toISOString(), "2026-03-09T21:00:00.000Z");

  const biweeklyNext = computeNextEventRunAtMs(
    fridayRunAtMs,
    "biweekly",
    Date.parse("2026-03-06T21:05:00.000Z"),
    "Europe/Vienna"
  );
  assert.equal(new Date(biweeklyNext).toISOString(), "2026-03-20T21:00:00.000Z");

  const yearlyNext = computeNextEventRunAtMs(
    fridayRunAtMs,
    "yearly",
    Date.parse("2026-03-06T21:05:00.000Z"),
    "Europe/Vienna"
  );
  assert.equal(new Date(yearlyNext).toISOString(), "2027-03-06T21:00:00.000Z");
});

test("getRepeatLabel uses Discord-style wording for recurring events", () => {
  const runAtMs = Date.parse("2026-03-06T21:00:00.000Z");

  assert.equal(getRepeatLabel("weekly", "de", { runAtMs, timeZone: "Europe/Vienna" }), "Jeden Freitag");
  assert.equal(getRepeatLabel("weekdays", "en", { runAtMs, timeZone: "Europe/Vienna" }), "Weekdays (Monday to Friday)");
  assert.equal(getRepeatLabel("yearly", "de", { runAtMs, timeZone: "Europe/Vienna" }), "Jährlich am 6. März");
});
