import test from "node:test";
import assert from "node:assert/strict";

import {
  isSafeUserFacingErrorMessage,
  resolveUserFacingErrorMessage,
} from "../src/lib/user-facing-errors.js";
import {
  isDashboardSafeUserMessage,
  resolveDashboardApiErrorMessage,
  resolveDashboardClientErrorMessage,
} from "../frontend/src/lib/dashboardErrors.js";

test("backend user-facing error helper keeps short actionable messages", () => {
  assert.equal(isSafeUserFacingErrorMessage("Bitte eine gueltige Lizenz-E-Mail eingeben."), true);
  assert.equal(
    resolveUserFacingErrorMessage("de", new Error("Bitte eine gueltige Lizenz-E-Mail eingeben.")),
    "Bitte eine gueltige Lizenz-E-Mail eingeben."
  );
});

test("backend user-facing error helper hides technical internals", () => {
  assert.equal(isSafeUserFacingErrorMessage("MongoDB-Verbindung fehlgeschlagen."), false);
  assert.equal(
    resolveUserFacingErrorMessage("de", new Error("MongoDB-Verbindung fehlgeschlagen."), {
      fallbackDe: "Die Einstellungen konnten gerade nicht gespeichert werden.",
      fallbackEn: "The settings could not be saved right now.",
    }),
    "Die Einstellungen konnten gerade nicht gespeichert werden."
  );
});

test("dashboard API error helper keeps safe validation errors", () => {
  assert.equal(isDashboardSafeUserMessage("Please enter a valid license email."), true);
  assert.equal(
    resolveDashboardApiErrorMessage(400, "Please enter a valid license email.", "en"),
    "Please enter a valid license email."
  );
});

test("dashboard API error helper masks technical 5xx messages", () => {
  assert.equal(isDashboardSafeUserMessage("MongoDB is not connected."), false);
  assert.equal(
    resolveDashboardApiErrorMessage(503, "MongoDB is not connected.", "en"),
    "The service is temporarily unavailable."
  );
});

test("dashboard client error helper normalizes transport failures", () => {
  assert.equal(
    resolveDashboardClientErrorMessage(new Error("fetch failed"), "de"),
    "Der Dienst ist gerade nicht erreichbar."
  );
});

test("dashboard client error helper hides technical thrown messages", () => {
  assert.equal(
    resolveDashboardClientErrorMessage(new Error("discord_token_exchange_failed:500"), "en", {
      fallback: "Action failed.",
    }),
    "Action failed."
  );
});
