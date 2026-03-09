import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_FAILOVER_CHAIN_LENGTH,
  buildFailoverCandidateChain,
  getPrimaryFailoverStation,
  normalizeFailoverChain,
} from "../src/lib/failover-chain.js";

test("normalizeFailoverChain deduplicates, trims, and enforces the max length", () => {
  const chain = normalizeFailoverChain([
    " ROCK ",
    "rock",
    "custom:nightshift",
    "",
    "jazz",
    "pop",
    "news",
    "talk",
    "electro",
  ]);

  assert.deepEqual(chain, [
    "rock",
    "custom:nightshift",
    "jazz",
    "pop",
    "news",
  ]);
  assert.equal(chain.length, MAX_FAILOVER_CHAIN_LENGTH);
});

test("buildFailoverCandidateChain merges configured, legacy, and automatic fallbacks", () => {
  const chain = buildFailoverCandidateChain({
    currentStationKey: "rock",
    configuredChain: ["custom:nightshift", "rock", "pop"],
    fallbackStation: "jazz",
    automaticFallbackKey: "news",
  });

  assert.deepEqual(chain, ["custom:nightshift", "pop", "jazz", "news"]);
});

test("getPrimaryFailoverStation prefers the configured chain and falls back to legacy", () => {
  assert.equal(getPrimaryFailoverStation(["custom:nightshift", "pop"], "jazz"), "custom:nightshift");
  assert.equal(getPrimaryFailoverStation([], "jazz"), "jazz");
  assert.equal(getPrimaryFailoverStation([], ""), "");
});
