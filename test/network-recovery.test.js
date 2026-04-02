import test from "node:test";
import assert from "node:assert/strict";

import { networkRecoveryCoordinator } from "../src/core/network-recovery.js";
import { handleRuntimeNetworkRecovered } from "../src/bot/runtime-recovery.js";

test("network recovery coordinator isolates failures and recoveries by scope", () => {
  networkRecoveryCoordinator.reset();
  const events = [];
  const unsubscribe = networkRecoveryCoordinator.onRecovered((event) => {
    events.push(event);
  });

  try {
    networkRecoveryCoordinator.noteFailure("voice-a", "timeout", { scope: "guild-a" });
    networkRecoveryCoordinator.noteFailure("voice-b", "timeout", { scope: "guild-b" });

    assert.ok(networkRecoveryCoordinator.getRecoveryDelayMs({ scope: "guild-a" }) > 0);
    assert.ok(networkRecoveryCoordinator.getRecoveryDelayMs({ scope: "guild-b" }) > 0);

    networkRecoveryCoordinator.noteSuccess("voice-a-ok", { scope: "guild-a" });

    assert.equal(networkRecoveryCoordinator.getRecoveryDelayMs({ scope: "guild-a" }), 0);
    assert.ok(networkRecoveryCoordinator.getRecoveryDelayMs({ scope: "guild-b" }) > 0);
    assert.deepEqual(
      events.map((event) => event.scope),
      ["guild-a"]
    );
  } finally {
    unsubscribe();
    networkRecoveryCoordinator.reset();
  }
});

test("runtime network recovery only schedules reconnects for the matching guild scope", () => {
  const scheduledReconnects = [];
  const runtime = {
    config: { name: "OmniFM Test" },
    guildState: new Map([
      ["guild-1", {
        shouldReconnect: true,
        currentStationKey: "rock",
        lastChannelId: "voice-1",
        connection: null,
        reconnectTimer: null,
        reconnectInFlight: false,
        voiceConnectInFlight: false,
        player: { state: { status: "idle" } },
        streamRestartTimer: null,
      }],
      ["guild-2", {
        shouldReconnect: true,
        currentStationKey: "jazz",
        lastChannelId: "voice-2",
        connection: null,
        reconnectTimer: null,
        reconnectInFlight: false,
        voiceConnectInFlight: false,
        player: { state: { status: "idle" } },
        streamRestartTimer: null,
      }],
    ]),
    getNetworkRecoveryScope(guildId) {
      return `scope:${guildId}`;
    },
    scheduleReconnect(guildId, options = {}) {
      scheduledReconnects.push({ guildId, options });
    },
    scheduleStreamRestart() {
      throw new Error("stream restart should not be scheduled for disconnected guilds");
    },
  };

  handleRuntimeNetworkRecovered(runtime, { scope: "scope:guild-1" });

  assert.deepEqual(scheduledReconnects, [
    {
      guildId: "guild-1",
      options: { resetAttempts: true, reason: "network-recovered" },
    },
  ]);
});
