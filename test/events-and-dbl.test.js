import test from "node:test";
import assert from "node:assert/strict";

import { buildCustomStationReference } from "../src/custom-stations.js";
import { normalizeScheduledEventInput } from "../src/scheduled-events-store.js";
import { buildPublicStationCatalog } from "../src/lib/public-stations.js";
import { buildScopedStationsData, filterStationsByTier } from "../src/stations-store.js";
import {
  buildDiscordBotListCommandsPayload,
  collectDiscordBotListStats,
} from "../src/services/discordbotlist.js";

test("scheduled events keep custom station references intact", () => {
  const customStationKey = buildCustomStationReference("nightshift");
  const normalized = normalizeScheduledEventInput({
    id: "evt_custom_ref",
    guildId: "123456789012345678",
    botId: "bot-main",
    name: "Night Shift",
    stationKey: customStationKey,
    voiceChannelId: "234567890123456789",
    runAtMs: Date.now() + 60_000,
    durationMs: 90 * 60 * 1000,
  });

  assert.ok(normalized);
  assert.equal(normalized.stationKey, customStationKey);
  assert.equal(normalized.durationMs, 90 * 60 * 1000);
});

test("scheduled events keep monthly repeat modes and sync metadata", () => {
  const normalized = normalizeScheduledEventInput({
    id: "evt_monthly_sync",
    guildId: "123456789012345678",
    botId: "bot-main",
    name: "Monthly Stage Night",
    stationKey: "lofi",
    voiceChannelId: "234567890123456789",
    runAtMs: Date.now() + 120_000,
    repeat: "monthly_first_weekday",
    discordSyncError: "Missing Create Events permission.",
    updatedAt: "2026-03-03T10:00:00.000Z",
  });

  assert.ok(normalized);
  assert.equal(normalized.repeat, "monthly_first_weekday");
  assert.equal(normalized.discordSyncError, "Missing Create Events permission.");
  assert.equal(normalized.updatedAt, "2026-03-03T10:00:00.000Z");
});

test("scheduled events downgrade unsupported dashboard repeat modes to none", () => {
  const normalized = normalizeScheduledEventInput({
    id: "evt_bad_repeat",
    guildId: "123456789012345678",
    botId: "bot-main",
    name: "Broken Repeat",
    stationKey: "dance",
    voiceChannelId: "234567890123456789",
    runAtMs: Date.now() + 120_000,
    repeat: "weekdays",
  });

  assert.ok(normalized);
  assert.equal(normalized.repeat, "none");
});

test("public station catalog excludes custom and ultimate stations from public totals", () => {
  const catalog = buildPublicStationCatalog({
    defaultStationKey: "lofi",
    qualityPreset: "high",
    stations: {
      lofi: { name: "LoFi", url: "https://example.com/lofi", tier: "free" },
      hits: { name: "Hits", url: "https://example.com/hits", tier: "pro" },
      premium: { name: "Premium", url: "https://example.com/premium", tier: "ultimate" },
      "custom:secret": { name: "Secret", url: "https://example.com/secret", tier: "ultimate" },
    },
  });

  assert.equal(catalog.total, 2);
  assert.equal(catalog.freeStations, 1);
  assert.equal(catalog.proStations, 1);
  assert.equal(catalog.ultimateStations, 0);
  assert.deepEqual(catalog.stations.map((station) => station.key), ["lofi", "hits"]);
});

test("tier filtering excludes leaked custom station keys from official station lists", () => {
  const filtered = filterStationsByTier({
    lofi: { name: "LoFi", url: "https://example.com/lofi", tier: "free" },
    hits: { name: "Hits", url: "https://example.com/hits", tier: "pro" },
    "custom:secret": { name: "Secret", url: "https://example.com/secret", tier: "ultimate" },
  }, "ultimate");

  assert.deepEqual(Object.keys(filtered), ["lofi", "hits"]);
});

test("scoped station catalogs clone station maps instead of mutating the source catalog", () => {
  const source = {
    defaultStationKey: "lofi",
    qualityPreset: "high",
    locked: false,
    fallbackKeys: ["lofi", "hits", "custom:secret"],
    stations: {
      lofi: { name: "LoFi", url: "https://example.com/lofi", tier: "free" },
      hits: { name: "Hits", url: "https://example.com/hits", tier: "pro" },
    },
  };

  const scoped = buildScopedStationsData(source, {
    ...source.stations,
    "custom:secret": { name: "Secret", url: "https://example.com/secret", tier: "ultimate" },
  });

  assert.equal(Object.prototype.hasOwnProperty.call(source.stations, "custom:secret"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(scoped.stations, "custom:secret"), true);
  assert.deepEqual(scoped.fallbackKeys, ["lofi", "hits", "custom:secret"]);
});

test("DiscordBotList aggregate stats deduplicate guilds across runtimes", () => {
  const runtimes = [
    {
      role: "commander",
      client: {
        isReady: () => true,
        guilds: {
          cache: new Map([
            ["1", { id: "1", memberCount: 10 }],
            ["2", { id: "2", memberCount: 20 }],
          ]),
        },
      },
      collectStats: () => ({ servers: 2, users: 30, connections: 1 }),
    },
    {
      role: "worker",
      client: {
        isReady: () => true,
        guilds: {
          cache: new Map([
            ["2", { id: "2", memberCount: 20 }],
            ["3", { id: "3", memberCount: 40 }],
          ]),
        },
      },
      collectStats: () => ({ servers: 2, users: 60, connections: 2 }),
    },
  ];

  const stats = collectDiscordBotListStats(runtimes, "aggregate");

  assert.equal(stats.scope, "aggregate");
  assert.equal(stats.guilds, 3);
  assert.equal(stats.users, 70);
  assert.equal(stats.voiceConnections, 3);
});

test("DiscordBotList commands payload includes slash commands for publish", () => {
  const commands = buildDiscordBotListCommandsPayload();
  const names = commands.map((command) => command.name);

  assert.ok(names.includes("play"));
  assert.ok(names.includes("event"));
  assert.ok(names.includes("license"));
});
