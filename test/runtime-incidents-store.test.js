import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  acknowledgeRuntimeIncident,
  getRecentRuntimeIncidents,
  recordRuntimeIncident,
} from "../src/runtime-incidents-store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const storePath = path.join(repoRoot, "runtime-incidents.json");
const backupPath = path.join(repoRoot, "runtime-incidents.json.bak");

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

test("runtime incidents support acknowledgement and status filtering in fallback storage", async () => {
  const storeSnapshot = snapshotOptionalFile(storePath);
  const backupSnapshot = snapshotOptionalFile(backupPath);

  try {
    fs.rmSync(storePath, { force: true });
    fs.rmSync(backupPath, { force: true });

    const guildId = "123456789012345678";
    const incident = await recordRuntimeIncident({
      guildId,
      guildName: "OmniFM Test Guild",
      tier: "ultimate",
      eventKey: "stream_failover_exhausted",
      runtime: {
        id: "bot-1",
        name: "OmniFM 1",
        role: "worker",
      },
      payload: {
        previousStationName: "Nightwave FM",
        triggerError: "timeout",
      },
    });
    assert.ok(incident?.id);
    assert.equal(incident.status, "open");

    const openIncidents = await getRecentRuntimeIncidents(guildId, 10, { status: "open" });
    assert.equal(openIncidents.length, 1);
    assert.equal(openIncidents[0].status, "open");

    const acknowledgedIncident = await acknowledgeRuntimeIncident(guildId, incident.id, {
      id: "223456789012345678",
      username: "Tester",
    });
    assert.equal(acknowledgedIncident?.status, "acknowledged");
    assert.equal(acknowledgedIncident?.acknowledgedBy?.username, "Tester");

    const acknowledgedRows = await getRecentRuntimeIncidents(guildId, 10, { status: "acknowledged" });
    const remainingOpenRows = await getRecentRuntimeIncidents(guildId, 10, { status: "open" });

    assert.equal(acknowledgedRows.length, 1);
    assert.equal(acknowledgedRows[0].status, "acknowledged");
    assert.equal(remainingOpenRows.length, 0);
  } finally {
    restoreOptionalFile(storePath, storeSnapshot);
    restoreOptionalFile(backupPath, backupSnapshot);
  }
});
