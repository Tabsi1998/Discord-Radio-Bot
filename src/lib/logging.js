// ============================================================
// OmniFM: Logging System
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const legacyWebDir = path.join(rootDir, "web");
const frontendPublicDir = path.join(rootDir, "frontend", "public");
const frontendBuildDir = path.join(rootDir, "frontend", "build");
const frontendBuildIndex = path.join(frontendBuildDir, "index.html");
const frontendPublicIndex = path.join(frontendPublicDir, "index.html");
const hasFrontendBuild = fs.existsSync(frontendBuildIndex);
const hasFrontendPublic = fs.existsSync(frontendPublicIndex);
const strictFrontendBuild = String(process.env.WEB_STRICT_FRONTEND_BUILD ?? "0") === "1";
if (strictFrontendBuild && !hasFrontendBuild) {
  throw new Error(
    "WEB_STRICT_FRONTEND_BUILD=1 aber frontend/build/index.html fehlt. Bitte Frontend-Build erzeugen."
  );
}
const webDir = hasFrontendBuild ? frontendBuildDir : (hasFrontendPublic ? frontendPublicDir : legacyWebDir);
const webRootSource = hasFrontendBuild
  ? "frontend/build"
  : (hasFrontendPublic ? "frontend/public (fallback)" : "web (legacy fallback)");
let frontendBuildStamp = null;
try {
  const stat = fs.statSync(frontendBuildIndex);
  frontendBuildStamp = stat?.mtime?.toISOString?.() || null;
} catch {
  frontendBuildStamp = null;
}
const logsDir = path.join(rootDir, "logs");
const logFile = path.join(logsDir, "bot.log");
const maxLogSizeBytes = Number(process.env.LOG_MAX_MB || "5") * 1024 * 1024;
const logRotateCheckIntervalMs = Number(process.env.LOG_ROTATE_CHECK_MS || "5000");
const logPruneCheckIntervalMs = Number(process.env.LOG_PRUNE_CHECK_MS || "600000");
const maxRotatedLogFiles = Math.max(
  1,
  Number.parseInt(String(process.env.LOG_MAX_FILES || "30"), 10) || 30
);
const maxRotatedLogDays = Math.max(
  1,
  Number.parseInt(String(process.env.LOG_MAX_DAYS || "14"), 10) || 14
);

let logWriteQueue = Promise.resolve();
let lastLogRotateCheckAt = 0;
let lastLogPruneCheckAt = 0;

async function ensureLogsDir() {
  await fs.promises.mkdir(logsDir, { recursive: true });
}

async function rotateLogIfNeeded() {
  const now = Date.now();
  if (now - lastLogRotateCheckAt < logRotateCheckIntervalMs) return;
  lastLogRotateCheckAt = now;

  try {
    const stat = await fs.promises.stat(logFile).catch(() => null);
    if (!stat) return;
    const size = stat.size;
    if (size < maxLogSizeBytes) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rotated = path.join(logsDir, `bot-${stamp}.log`);
    await fs.promises.rename(logFile, rotated);
  } catch {
    // ignore
  }
}

async function pruneRotatedLogsIfNeeded() {
  const now = Date.now();
  if (now - lastLogPruneCheckAt < logPruneCheckIntervalMs) return;
  lastLogPruneCheckAt = now;

  const retentionMs = maxRotatedLogDays * 24 * 60 * 60 * 1000;
  try {
    const entries = await fs.promises.readdir(logsDir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
      if (!entry?.isFile?.()) continue;
      if (!/^bot-.*\.log$/i.test(entry.name)) continue;
      const filePath = path.join(logsDir, entry.name);
      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.promises.stat(filePath).catch(() => null);
      if (!stat) continue;
      files.push({ filePath, mtimeMs: stat.mtimeMs });
    }

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (let index = 0; index < files.length; index++) {
      const info = files[index];
      const olderThanLimit = now - info.mtimeMs > retentionMs;
      const exceedsCountLimit = index >= maxRotatedLogFiles;
      if (!olderThanLimit && !exceedsCountLimit) continue;
      // eslint-disable-next-line no-await-in-loop
      await fs.promises.unlink(info.filePath).catch(() => null);
    }
  } catch {
    // ignore
  }
}

function queueLogWrite(line) {
  logWriteQueue = logWriteQueue
    .then(async () => {
      await ensureLogsDir();
      await rotateLogIfNeeded();
      await pruneRotatedLogsIfNeeded();
      await fs.promises.appendFile(logFile, `${line}\n`, "utf8");
    })
    .catch(() => {
      // ignore
    });
}

function log(level, message) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${level}] ${message}`;
  if (level === "ERROR") {
    console.error(line);
  } else {
    console.log(line);
  }

  queueLogWrite(line);
}

function shouldLogFfmpegStderrLine(line) {
  const text = String(line || "").trim();
  if (!text) return false;

  const mode = String(process.env.FFMPEG_STDERR_VERBOSITY || "warn").trim().toLowerCase();
  if (mode === "all" || mode === "debug" || mode === "info") return true;
  if (mode === "off" || mode === "none") return false;

  const lc = text.toLowerCase();
  return lc.includes("error")
    || lc.includes("failed")
    || lc.includes("invalid")
    || lc.includes("warn")
    || lc.includes("timed out")
    || lc.includes("http error")
    || lc.includes("reconnect");
}

function getLogWriteQueue() {
  return logWriteQueue;
}

export {
  log,
  shouldLogFfmpegStderrLine,
  getLogWriteQueue,
  rootDir,
  webDir,
  webRootSource,
  frontendBuildStamp,
  logsDir,
};
