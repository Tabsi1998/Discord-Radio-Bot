import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { startWebServer } from "../src/api/server.js";
import {
  buildPageHref,
  getCanonicalPagePath,
  resolvePageFromUrl,
} from "../frontend/src/lib/pageRouting.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const frontendBuildDir = path.join(repoRoot, "frontend", "build");
const frontendIndexPath = path.join(frontendBuildDir, "index.html");

async function snapshotFile(filePath) {
  try {
    return {
      exists: true,
      content: await fs.readFile(filePath),
    };
  } catch {
    return { exists: false, content: null };
  }
}

async function restoreFile(filePath, snapshot) {
  if (snapshot?.exists) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, snapshot.content);
    return;
  }
  await fs.rm(filePath, { force: true });
}

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

test("pageRouting resolves aliases and localized legal paths", () => {
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/?page=imprint"), "imprint");
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/?page=terms"), "terms");
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/nutzungsbedingungen?lang=de"), "terms");
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/terms-of-service"), "terms");
  assert.equal(getCanonicalPagePath("terms", "de"), "/nutzungsbedingungen");
  assert.equal(buildPageHref("de", "terms"), "/nutzungsbedingungen?lang=de");
  assert.equal(buildPageHref("en", "privacy"), "/privacy?lang=en");
});

test("startWebServer serves SPA entry for clean legal paths and exposes terms payload", async () => {
  const restoreEnv = setEnv({
    WEB_INTERNAL_PORT: "0",
    WEB_PORT: "0",
    WEB_BIND: "127.0.0.1",
    PUBLIC_WEB_URL: "http://127.0.0.1",
    CORS_ALLOWED_ORIGINS: "",
    CORS_ORIGINS: "",
    WEB_DOMAIN: "",
    LEGAL_PROVIDER_NAME: "OmniFM Test Operator",
    LEGAL_STREET_ADDRESS: "Test Street 1",
    LEGAL_POSTAL_CODE: "1010",
    LEGAL_CITY: "Vienna",
    LEGAL_EMAIL: "legal@example.com",
    LEGAL_WEBSITE: "https://omnifm.example",
    PRIVACY_CONTACT_EMAIL: "privacy@example.com",
    TERMS_CONTACT_EMAIL: "terms@example.com",
    TERMS_SUPPORT_URL: "https://omnifm.example/terms",
    TERMS_EFFECTIVE_DATE: "2026-03-11",
    TERMS_GOVERNING_LAW: "Law of the Republic of Austria",
  });
  const indexSnapshot = await snapshotFile(frontendIndexPath);
  await fs.mkdir(frontendBuildDir, { recursive: true });
  await fs.writeFile(
    frontendIndexPath,
    "<!doctype html><html><body>legal-routing-marker</body></html>",
    "utf8"
  );

  const server = startWebServer([]);
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const termsPageResponse = await fetch(`http://127.0.0.1:${port}/nutzungsbedingungen?lang=de`);
    assert.equal(termsPageResponse.status, 200);
    assert.match(await termsPageResponse.text(), /legal-routing-marker/);

    const termsApiResponse = await fetch(`http://127.0.0.1:${port}/api/terms`);
    assert.equal(termsApiResponse.status, 200);
    const termsData = await termsApiResponse.json();

    assert.equal(termsData.operator?.providerName, "OmniFM Test Operator");
    assert.equal(termsData.contact?.email, "terms@example.com");
    assert.equal(termsData.contact?.website, "https://omnifm.example/terms");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await restoreFile(frontendIndexPath, indexSnapshot);
    restoreEnv();
  }
});
