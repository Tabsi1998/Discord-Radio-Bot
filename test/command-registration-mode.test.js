import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCommandRegistrationMode,
  resolveCommandRegistrationMode,
  usesGlobalCommandRegistration,
  usesGuildCommandRegistration,
} from "../src/discord/commandRegistrationMode.js";

test("normalizeCommandRegistrationMode keeps guild as safe default", () => {
  assert.equal(normalizeCommandRegistrationMode("guild"), "guild");
  assert.equal(normalizeCommandRegistrationMode("GLOBAL"), "global");
  assert.equal(normalizeCommandRegistrationMode("hybrid"), "hybrid");
  assert.equal(normalizeCommandRegistrationMode("unknown"), "guild");
});

test("resolveCommandRegistrationMode honors explicit mode before legacy fallback", () => {
  assert.equal(resolveCommandRegistrationMode({ COMMAND_REGISTRATION_MODE: "hybrid" }), "hybrid");
  assert.equal(resolveCommandRegistrationMode({ SYNC_GUILD_COMMANDS_ON_BOOT: "0" }), "global");
  assert.equal(resolveCommandRegistrationMode({ SYNC_GUILD_COMMANDS_ON_BOOT: "1" }), "guild");
});

test("command registration helpers expose guild/global behavior flags", () => {
  assert.equal(usesGuildCommandRegistration("guild"), true);
  assert.equal(usesGlobalCommandRegistration("guild"), false);
  assert.equal(usesGuildCommandRegistration("global"), false);
  assert.equal(usesGlobalCommandRegistration("global"), true);
  assert.equal(usesGuildCommandRegistration("hybrid"), true);
  assert.equal(usesGlobalCommandRegistration("hybrid"), true);
});
