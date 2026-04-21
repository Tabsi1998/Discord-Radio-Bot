import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { logError } from "../src/lib/logging.js";
import {
  getRecentOperatorIncidents,
  installOperatorIncidentRecorder,
  recordOperatorIncident,
  resetOperatorIncidentStateForTests,
} from "../src/operator-incidents-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const storePath = path.join(repoRoot, "operator-incidents.json");
const backupPath = `${storePath}.bak`;

function snapshotOptionalFile(filePath) {
  try {
    return {
      exists: true,
      content: fs.readFileSync(filePath),
    };
  } catch {
    return { exists: false, content: null };
  }
}

function restoreOptionalFile(filePath, snapshot) {
  if (snapshot?.exists) {
    fs.writeFileSync(filePath, snapshot.content);
    return;
  }
  fs.rmSync(filePath, { force: true });
}

test("operator incidents persist normalized fallback entries", async () => {
  const storeSnapshot = snapshotOptionalFile(storePath);
  const backupSnapshot = snapshotOptionalFile(backupPath);

  try {
    resetOperatorIncidentStateForTests();

    const stored = await recordOperatorIncident({
      timestamp: "2026-04-21T10:00:00.000Z",
      level: "critical",
      summary: "Worker queue failed",
      message: "Queue worker could not renew lease.",
      source: "worker-manager",
      entry: "worker.js",
      errorCode: "LEASE_TIMEOUT",
      context: {
        source: "worker-manager",
        guildId: "123456789012345678",
      },
      stackLines: ["Error: Worker queue failed", "at worker-manager.js:10:5"],
    });

    assert.equal(stored?.level, "CRITICAL");
    assert.equal(stored?.source, "worker-manager");
    assert.equal(stored?.context?.guildId, "123456789012345678");

    const incidents = await getRecentOperatorIncidents(10);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].summary, "Worker queue failed");
    assert.equal(incidents[0].stackLines.length, 2);
  } finally {
    resetOperatorIncidentStateForTests();
    restoreOptionalFile(storePath, storeSnapshot);
    restoreOptionalFile(backupPath, backupSnapshot);
  }
});

test("operator incident recorder subscribes to logError and deduplicates repeated incidents", async () => {
  const storeSnapshot = snapshotOptionalFile(storePath);
  const backupSnapshot = snapshotOptionalFile(backupPath);
  const unsubscribe = installOperatorIncidentRecorder({ entry: "operator-test.js" });

  try {
    resetOperatorIncidentStateForTests();

    logError("[Test] Runtime healthcheck failed", new Error("MongoDB is not connected."), {
      context: {
        source: "dashboard-settings",
        route: "/api/dashboard/settings",
      },
      includeStack: false,
    });
    logError("[Test] Runtime healthcheck failed", new Error("MongoDB is not connected."), {
      context: {
        source: "dashboard-settings",
        route: "/api/dashboard/settings",
      },
      includeStack: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 25));

    const incidents = await getRecentOperatorIncidents(10);
    assert.equal(incidents.length, 1);
    assert.equal(incidents[0].summary, "[Test] Runtime healthcheck failed");
    assert.equal(incidents[0].source, "dashboard-settings");
    assert.equal(incidents[0].entry, "operator-test.js");
  } finally {
    unsubscribe();
    resetOperatorIncidentStateForTests();
    restoreOptionalFile(storePath, storeSnapshot);
    restoreOptionalFile(backupPath, backupSnapshot);
  }
});
