import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { resetLogCooldownStateForTests } from "../src/lib/logging.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function setEnv(overrides) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function importFresh(relativePath, tag) {
  const moduleUrl = pathToFileURL(path.join(repoRoot, relativePath));
  moduleUrl.searchParams.set("cacheBust", `${tag}-${Date.now()}-${Math.random()}`);
  return import(moduleUrl.href);
}

test("custom station load errors are throttled for corrupt JSON files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "omnifm-custom-load-"));
  const customFile = path.join(tempDir, "custom-stations.json");
  const restoreEnv = setEnv({
    OMNIFM_CUSTOM_STATIONS_FILE: customFile,
  });
  const originalConsoleError = console.error;
  const errors = [];
  console.error = (...args) => {
    errors.push(args.join(" "));
  };

  try {
    await writeFile(customFile, "}{", "utf8");
    resetLogCooldownStateForTests();
    const customStations = await importFresh("src/custom-stations.js", "custom-load-error");

    assert.deepEqual(customStations.getGuildStations("guild-1"), {});
    assert.deepEqual(customStations.getGuildStations("guild-1"), {});

    const loadErrors = errors.filter((line) => line.includes("[custom-stations] Load error"));
    assert.equal(loadErrors.length, 1);
  } finally {
    console.error = originalConsoleError;
    resetLogCooldownStateForTests();
    restoreEnv();
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("command permission load errors are throttled for corrupt JSON files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "omnifm-command-perms-"));
  const commandPermissionsFile = path.join(tempDir, "command-permissions.json");
  const restoreEnv = setEnv({
    OMNIFM_COMMAND_PERMISSIONS_FILE: commandPermissionsFile,
  });
  const originalConsoleError = console.error;
  const errors = [];
  console.error = (...args) => {
    errors.push(args.join(" "));
  };

  try {
    await writeFile(commandPermissionsFile, "{\"broken\"", "utf8");
    resetLogCooldownStateForTests();
    const permissionsStore = await importFresh("src/command-permissions-store.js", "command-permissions-load-error");

    assert.deepEqual(
      permissionsStore.getCommandPermissionRule("123456789012345678", "play"),
      { allowRoleIds: [], denyRoleIds: [] }
    );
    assert.deepEqual(
      permissionsStore.getCommandPermissionRule("123456789012345678", "play"),
      { allowRoleIds: [], denyRoleIds: [] }
    );

    const loadErrors = errors.filter((line) => line.includes("[command-permissions] Load error"));
    assert.equal(loadErrors.length, 1);
  } finally {
    console.error = originalConsoleError;
    resetLogCooldownStateForTests();
    restoreEnv();
    await rm(tempDir, { recursive: true, force: true });
  }
});
