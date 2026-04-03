import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const dashboardFile = path.join(repoRoot, "dashboard.json");
const dashboardBackupFile = path.join(repoRoot, "dashboard.json.bak");

async function snapshotFile(filePath) {
  try {
    return {
      exists: true,
      content: await fs.readFile(filePath),
    };
  } catch {
    return {
      exists: false,
      content: null,
    };
  }
}

async function restoreFile(filePath, snapshot) {
  if (snapshot?.exists) {
    await fs.writeFile(filePath, snapshot.content);
    return;
  }
  await fs.rm(filePath, { force: true });
}

test("dashboard oauth state preserves the selected language", async (t) => {
  const dashboardSnapshot = await snapshotFile(dashboardFile);
  const dashboardBackupSnapshot = await snapshotFile(dashboardBackupFile);

  t.after(async () => {
    await restoreFile(dashboardFile, dashboardSnapshot);
    await restoreFile(dashboardBackupFile, dashboardBackupSnapshot);
  });

  await fs.rm(dashboardFile, { force: true });
  await fs.rm(dashboardBackupFile, { force: true });

  const moduleUrl = new URL(`../src/dashboard-store.js?oauth-language=${Date.now()}`, import.meta.url);
  const dashboardStore = await import(moduleUrl);
  const token = `oauth-state-${Date.now()}`;

  dashboardStore.setDashboardOauthState(token, {
    nextPage: "settings",
    language: "de",
    origin: "https://app.example",
    createdAt: 1,
    expiresAt: 9999999999,
  });

  const popped = dashboardStore.popDashboardOauthState(token);

  assert.equal(popped?.language, "de");
  assert.equal(popped?.origin, "https://app.example");
  assert.equal(popped?.nextPage, "settings");
});
