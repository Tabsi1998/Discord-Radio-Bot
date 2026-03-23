import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readText(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

async function exists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

function expectIncludes(text, needle, label) {
  assert.equal(text.includes(needle), true, label ?? `Expected to find ${needle}`);
}

test("github automation files and docs stay in sync", async () => {
  const requiredFiles = [
    ".github/workflows/ci.yml",
    ".github/workflows/codeql.yml",
    ".github/workflows/dependency-review.yml",
    ".github/workflows/nightly.yml",
    ".github/dependabot.yml",
    ".github/CODEOWNERS",
    ".github/pull_request_template.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".github/ISSUE_TEMPLATE/config.yml",
  ];

  for (const file of requiredFiles) {
    assert.equal(await exists(file), true, `${file} is missing`);
  }

  const ci = await readText(".github/workflows/ci.yml");
  expectIncludes(ci, "concurrency:", "ci concurrency missing");
  expectIncludes(ci, "workflow_dispatch:", "ci workflow_dispatch missing");
  expectIncludes(ci, "node-version: [22, 24]", "ci matrix missing Node 22/24");
  expectIncludes(ci, "actions/upload-artifact@v6", "ci artifact upload missing");
  expectIncludes(ci, "mongo-smoke:", "ci mongo smoke job missing");
  expectIncludes(ci, "frontend-build:", "ci frontend job missing");
  expectIncludes(ci, "docker-build:", "ci docker job missing");

  const nightly = await readText(".github/workflows/nightly.yml");
  expectIncludes(nightly, "schedule:", "nightly schedule missing");
  expectIncludes(nightly, "workflow_dispatch:", "nightly dispatch missing");
  expectIncludes(nightly, "node-version: [22, 24]", "nightly matrix missing Node 22/24");
  expectIncludes(nightly, "recovery-focus:", "nightly recovery job missing");

  const codeql = await readText(".github/workflows/codeql.yml");
  expectIncludes(codeql, "workflow_dispatch:", "codeql workflow_dispatch missing");
  expectIncludes(codeql, "schedule:", "codeql schedule missing");
  expectIncludes(codeql, "code-scanning/alerts", "codeql preflight missing");
  expectIncludes(codeql, "Code scanning unavailable", "codeql skip notice missing");
  expectIncludes(codeql, "github/codeql-action/init@v4", "codeql init missing");
  expectIncludes(codeql, "github/codeql-action/analyze@v4", "codeql analyze missing");

  const dependencyReview = await readText(".github/workflows/dependency-review.yml");
  expectIncludes(dependencyReview, "Dependency review disabled", "dependency review disabled notice missing");
  assert.equal(
    dependencyReview.includes("actions/dependency-review-action@v4"),
    false,
    "dependency review action should not run on this repo"
  );

  const dependabot = await readText(".github/dependabot.yml");
  expectIncludes(dependabot, "package-ecosystem: github-actions", "dependabot actions config missing");
  expectIncludes(dependabot, "directory: /frontend", "dependabot frontend config missing");

  const codeowners = await readText(".github/CODEOWNERS");
  expectIncludes(codeowners, "* @Tabsi1998", "CODEOWNERS default owner missing");
  expectIncludes(codeowners, "/.github/ @Tabsi1998", "CODEOWNERS GitHub owner missing");
  expectIncludes(codeowners, "/src/ @Tabsi1998", "CODEOWNERS src owner missing");

  const issueConfig = await readText(".github/ISSUE_TEMPLATE/config.yml");
  expectIncludes(issueConfig, "blank_issues_enabled: false", "issue template config should disable blank issues");

  const bugTemplate = await readText(".github/ISSUE_TEMPLATE/bug_report.yml");
  expectIncludes(bugTemplate, "title: \"[Bug]: \"", "bug issue template missing title prefix");

  const featureTemplate = await readText(".github/ISSUE_TEMPLATE/feature_request.yml");
  expectIncludes(featureTemplate, "title: \"[Feature]: \"", "feature issue template missing title prefix");

  const readme = await readText("README.md");
  expectIncludes(readme, "## GitHub Automation", "README GitHub automation section missing");
  expectIncludes(readme, "Recommended required checks for `main`", "README required checks note missing");
  expectIncludes(readme, "`ci`", "README required ci check missing");
  expectIncludes(readme, "`codeql`", "README codeql check missing");
  expectIncludes(readme, "VOICE_CHANNEL_STATUS_REFRESH_MS", "README voice channel refresh setting missing");

  const envExample = await readText(".env.example");
  expectIncludes(envExample, "VOICE_CHANNEL_STATUS_ENABLED=1", "voice channel status flag missing");
  expectIncludes(envExample, "VOICE_CHANNEL_STATUS_TEMPLATE=🔊 | 24/7 {station}", "voice channel status template missing");
  expectIncludes(envExample, "VOICE_CHANNEL_STATUS_REFRESH_MS=900000", "voice channel status refresh missing");
  expectIncludes(envExample, "VOICE_STATE_RECONCILE_ENABLED=1", "voice reconcile flag missing");
  expectIncludes(envExample, "VOICE_STATE_RECONCILE_MS=30000", "voice reconcile interval missing");
  expectIncludes(envExample, "STREAM_RESTART_BASE_MS=1000", "stream restart base missing");
  expectIncludes(envExample, "STREAM_RESTART_MAX_MS=120000", "stream restart max missing");
  expectIncludes(envExample, "STREAM_ERROR_COOLDOWN_THRESHOLD=8", "stream cooldown threshold missing");
  expectIncludes(envExample, "STREAM_ERROR_COOLDOWN_MS=60000", "stream cooldown ms missing");
  expectIncludes(envExample, "VOICE_RECONNECT_MAX_MS=120000", "voice reconnect max missing");
});
