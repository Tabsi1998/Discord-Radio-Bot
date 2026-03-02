import test from "node:test";
import assert from "node:assert/strict";

import { buildCommandsJson } from "../src/commands.js";

test("play command exposes the fallback option", () => {
  const commands = buildCommandsJson();
  const play = commands.find((command) => command.name === "play");
  const optionNames = (play?.options || []).map((option) => option.name);

  assert.ok(optionNames.includes("fallback"));
});
