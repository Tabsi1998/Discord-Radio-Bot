import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDashboardCustomStationsHint,
  buildDashboardEventsHint,
  buildDashboardNextSetupAction,
  buildDashboardPermissionsHint,
  resolveDashboardInviteUrls,
} from "../frontend/src/lib/dashboardOnboarding.js";

const t = (_de, en) => en;

test("resolveDashboardInviteUrls separates commander and worker links", () => {
  const urls = resolveDashboardInviteUrls({
    bots: [
      { role: "worker", inviteUrl: "https://example.com/worker" },
      { role: "commander", inviteUrl: "https://example.com/commander" },
    ],
  });

  assert.equal(urls.commanderInviteUrl, "https://example.com/commander");
  assert.equal(urls.workerInviteUrl, "https://example.com/worker");
});

test("buildDashboardNextSetupAction points to the next missing setup step", () => {
  const action = buildDashboardNextSetupAction({
    setupStatus: {
      commanderReady: true,
      workerInvited: false,
      firstStreamLive: false,
    },
    inviteLinks: {
      bots: [{ role: "worker", inviteUrl: "https://example.com/worker" }],
    },
    t,
  });

  assert.equal(action.title, "Next step: invite the first worker");
  assert.equal(action.inviteUrl, "https://example.com/worker");
  assert.equal(action.command, "/workers");
});

test("buildDashboardEventsHint blocks event setup until a worker is invited", () => {
  const hint = buildDashboardEventsHint({
    setupStatus: { workerInvited: false },
    inviteLinks: {
      bots: [{ role: "worker", inviteUrl: "https://example.com/worker" }],
    },
    hasEvents: false,
    voiceChannelCount: 2,
    t,
  });

  assert.match(hint.title, /invite a worker/i);
  assert.equal(hint.inviteUrl, "https://example.com/worker");
  assert.equal(hint.command, "/workers");
});

test("buildDashboardPermissionsHint guides unrestricted command setups", () => {
  const hint = buildDashboardPermissionsHint({
    setupStatus: { commanderReady: true },
    availableRoleCount: 3,
    hasRestrictedCommands: false,
    t,
  });

  assert.match(hint.title, /open to everyone/i);
  assert.match(hint.body, /\/play, \/stop, and \/event/i);
});

test("buildDashboardCustomStationsHint prefers /play before the first live stream", () => {
  const hint = buildDashboardCustomStationsHint({
    setupStatus: {
      workerInvited: true,
      firstStreamLive: false,
    },
    inviteLinks: { bots: [] },
    hasStations: false,
    t,
  });

  assert.match(hint.title, /normal live stream/i);
  assert.equal(hint.command, "/play");
});
