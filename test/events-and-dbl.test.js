import test from "node:test";
import assert from "node:assert/strict";

import { buildCustomStationReference } from "../src/custom-stations.js";
import { normalizeScheduledEventInput } from "../src/scheduled-events-store.js";
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
