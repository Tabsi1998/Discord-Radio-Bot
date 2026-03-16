// ============================================================
// OmniFM: Logging System
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..", "..");
const legacyWebDir = path.join(rootDir, "web");
const frontendBuildDir = path.join(rootDir, "frontend", "build");
const frontendBuildIndex = path.join(frontendBuildDir, "index.html");
const legacyWebIndex = path.join(legacyWebDir, "index.html");
const hasFrontendBuild = fs.existsSync(frontendBuildIndex);
const hasLegacyWeb = fs.existsSync(legacyWebIndex);
const allowLegacyWebFallback = String(process.env.WEB_ALLOW_LEGACY_FALLBACK ?? "0") === "1";
const strictFrontendBuild = String(process.env.WEB_STRICT_FRONTEND_BUILD ?? "0") === "1";
if (!hasFrontendBuild && strictFrontendBuild && !(allowLegacyWebFallback && hasLegacyWeb)) {
  throw new Error(
    "frontend/build/index.html fehlt. Bitte React-Frontend bauen oder nur fuer Notfaelle WEB_ALLOW_LEGACY_FALLBACK=1 setzen."
  );
}
const webDir = hasFrontendBuild
  ? frontendBuildDir
  : (allowLegacyWebFallback && hasLegacyWeb ? legacyWebDir : frontendBuildDir);
const webRootSource = hasFrontendBuild
  ? "frontend/build"
  : (allowLegacyWebFallback && hasLegacyWeb
      ? "web (legacy fallback via WEB_ALLOW_LEGACY_FALLBACK=1)"
      : "frontend/build (missing, build required)");
let frontendBuildStamp = null;
try {
  const stat = fs.statSync(frontendBuildIndex);
  frontendBuildStamp = stat?.mtime?.toISOString?.() || null;
} catch {
  frontendBuildStamp = null;
}
const logsDir = path.join(rootDir, "logs");
const logFile = path.join(logsDir, "bot.log");
const errorLogFile = path.join(logsDir, "error.log");
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
const lastLogRotateCheckAt = new Map();
const lastLogPruneCheckAt = new Map();
const logTargets = [
  { filePath: logFile, rotatedPrefix: "bot" },
  { filePath: errorLogFile, rotatedPrefix: "error" },
];

async function ensureLogsDir() {
  await fs.promises.mkdir(logsDir, { recursive: true });
}

async function rotateLogIfNeeded(filePath, rotatedPrefix) {
  const now = Date.now();
  const lastCheckedAt = lastLogRotateCheckAt.get(rotatedPrefix) || 0;
  if (now - lastCheckedAt < logRotateCheckIntervalMs) return;
  lastLogRotateCheckAt.set(rotatedPrefix, now);

  try {
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) return;
    const size = stat.size;
    if (size < maxLogSizeBytes) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rotated = path.join(logsDir, `${rotatedPrefix}-${stamp}.log`);
    await fs.promises.rename(filePath, rotated);
  } catch {
    // ignore
  }
}

async function pruneRotatedLogsIfNeeded(rotatedPrefix) {
  const now = Date.now();
  const lastCheckedAt = lastLogPruneCheckAt.get(rotatedPrefix) || 0;
  if (now - lastCheckedAt < logPruneCheckIntervalMs) return;
  lastLogPruneCheckAt.set(rotatedPrefix, now);

  const retentionMs = maxRotatedLogDays * 24 * 60 * 60 * 1000;
  try {
    const entries = await fs.promises.readdir(logsDir, { withFileTypes: true }).catch(() => []);
    const files = [];
    for (const entry of entries) {
      if (!entry?.isFile?.()) continue;
      if (!new RegExp(`^${rotatedPrefix}-.*\\.log$`, "i").test(entry.name)) continue;
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

function queueLogWrite(line, { includeErrorLog = false } = {}) {
  logWriteQueue = logWriteQueue
    .then(async () => {
      await ensureLogsDir();
      for (const target of logTargets) {
        // eslint-disable-next-line no-await-in-loop
        await rotateLogIfNeeded(target.filePath, target.rotatedPrefix);
        // eslint-disable-next-line no-await-in-loop
        await pruneRotatedLogsIfNeeded(target.rotatedPrefix);
      }
      await fs.promises.appendFile(logFile, `${line}\n`, "utf8");
      if (includeErrorLog) {
        await fs.promises.appendFile(errorLogFile, `${line}\n`, "utf8");
      }
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

  queueLogWrite(line, { includeErrorLog: level === "ERROR" });
}

function shouldLogFfmpegStderrLine(line) {
  const text = String(line || "").trim();
  if (!text) return false;

  const mode = String(process.env.FFMPEG_STDERR_VERBOSITY || "warn").trim().toLowerCase();
  if (mode === "all" || mode === "debug" || mode === "info") return true;
  if (mode === "off" || mode === "none") return false;

  const lc = text.toLowerCase();
  const noisyDecodeLine = lc.includes("error while decoding stream")
    || lc.includes("error decoding aac frame header")
    || lc.includes("invalid band type")
    || lc.includes("pulse data corrupt or invalid")
    || lc.includes("not yet implemented in ffmpeg, patches welcome");
  if (noisyDecodeLine) return false;
  const noisyBrokenPipeLine = lc.includes("broken pipe")
    || lc.includes("error writing trailer of pipe")
    || lc.includes("error closing file pipe");
  if (noisyBrokenPipeLine) return false;

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
