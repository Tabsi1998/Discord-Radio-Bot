import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";

import {
  translateCustomStationErrorMessage,
  translatePermissionStoreMessage,
  getFeatureRequirementMessage,
} from "../src/lib/language.js";

test("custom station store accepts dashboard payload objects and persists folder and tags", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "omnifm-custom-stations-"));
  const customFile = path.join(tempDir, "custom-stations.json");
  const previousOverride = process.env.OMNIFM_CUSTOM_STATIONS_FILE;
  process.env.OMNIFM_CUSTOM_STATIONS_FILE = customFile;

  try {
    const moduleUrl = new URL(`../src/custom-stations.js?test=${Date.now()}`, import.meta.url);
    const customStations = await import(moduleUrl.href);

    const result = await customStations.addGuildStation("guild-1", "demo", {
      name: "MÃ¼nchen FM",
      url: "https://1.1.1.1/live",
      genre: "Pop",
      folder: "Night Rotation",
      tags: "night, synthwave, night",
    });

    assert.equal(result.success, true);
    assert.equal(result.key, "demo");
    assert.equal(result.station.name, "MÃ¼nchen FM");
    assert.equal(result.station.genre, "Pop");
    assert.equal(result.station.folder, "Night Rotation");
    assert.deepEqual(result.station.tags, ["night", "synthwave"]);

    const stored = customStations.getGuildStations("guild-1");
    assert.deepEqual(stored.demo, result.station);
  } finally {
    if (previousOverride === undefined) {
      delete process.env.OMNIFM_CUSTOM_STATIONS_FILE;
    } else {
      process.env.OMNIFM_CUSTOM_STATIONS_FILE = previousOverride;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("custom station validation returns a dedicated DNS resolution error", async () => {
  const moduleUrl = new URL(`../src/custom-stations.js?dns-test=${Date.now()}`, import.meta.url);
  const customStations = await import(moduleUrl.href);

  const result = await customStations.validateCustomStationUrlWithDns("https://definitely-not-a-real-host.invalid/live");

  assert.deepEqual(result, {
    ok: false,
    error: "Host konnte nicht aufgel\u00f6st werden.",
  });
});

test("custom station helpers normalize folder and tags safely", async () => {
  const moduleUrl = new URL(`../src/custom-stations.js?normalize-test=${Date.now()}`, import.meta.url);
  const customStations = await import(moduleUrl.href);

  assert.equal(customStations.normalizeCustomStationFolder("  Late Night Rotation  "), "Late Night Rotation");
  assert.deepEqual(
    customStations.normalizeCustomStationTags([" News ", "Live", "news", "", "DJ Set"]),
    ["News", "Live", "DJ Set"]
  );
  assert.deepEqual(
    customStations.normalizeCustomStationTags("alpha, beta\nalpha, gamma"),
    ["alpha", "beta", "gamma"]
  );
});

test("language helper canonicalizes legacy ASCII store messages", () => {
  assert.equal(
    translateCustomStationErrorMessage("Ungueltiger Station-Key.", "de"),
    "Ung\u00fcltiger Station-Key."
  );
  assert.equal(
    translateCustomStationErrorMessage("URL-Format ungueltig.", "en"),
    "Invalid URL format."
  );
  assert.equal(
    translatePermissionStoreMessage("Command wird nicht unterstuetzt.", "de"),
    "Command wird nicht unterst\u00fctzt."
  );
  assert.equal(
    getFeatureRequirementMessage({ ok: false, featureKey: "customStationURLs", requiredPlan: "ultimate" }, "de"),
    "**Custom-Station-URLs** erfordert OmniFM **Ultimate** oder h\u00f6her."
  );
});
