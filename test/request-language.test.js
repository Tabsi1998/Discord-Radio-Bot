import test from "node:test";
import assert from "node:assert/strict";

import { resolveRequestLanguage } from "../src/lib/request-language.js";
import { buildDiscordEventDescriptionPreview } from "../frontend/src/lib/dashboardEvents.js";

test("resolveRequestLanguage prefers explicit dashboard language header", () => {
  const result = resolveRequestLanguage(
    { "accept-language": "en-US,en;q=0.9", "x-omnifm-language": "de" },
    "",
    "en"
  );

  assert.equal(result, "de");
});

test("resolveRequestLanguage falls back to accept-language when no explicit value is present", () => {
  const result = resolveRequestLanguage(
    { "accept-language": "de-AT,de;q=0.9,en;q=0.7" },
    "",
    "en"
  );

  assert.equal(result, "de");
});

test("buildDiscordEventDescriptionPreview supports localized details prefixes", () => {
  const preview = buildDiscordEventDescriptionPreview("Line one", "Groove Salad", {
    detailsPrefix: "OmniFM Auto-Event | Sender",
  });

  assert.equal(preview, "Line one\n\nOmniFM Auto-Event | Sender: Groove Salad");
});
