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
function isTestRun() {
  return String(process.env.NODE_TEST_CONTEXT || "").toLowerCase() === "child"
    || process.argv.some((arg) => /\.test\.[cm]?js$/i.test(String(arg || "")));
}

function resolveLogsDir() {
  const explicit = String(process.env.LOGS_DIR || "").trim();
  if (explicit) {
    return path.isAbsolute(explicit) ? explicit : path.resolve(rootDir, explicit);
  }
  if (isTestRun()) {
    return path.join(rootDir, "logs", "test");
  }
  return path.join(rootDir, "logs");
}

const logsDir = resolveLogsDir();
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
const repeatedLogCooldownMs = Math.max(
  1_000,
  Number.parseInt(String(process.env.LOG_REPEAT_COOLDOWN_MS || "300000"), 10) || 300000
);

let logWriteQueue = Promise.resolve();
const lastLogRotateCheckAt = new Map();
const lastLogPruneCheckAt = new Map();
const repeatedLogState = new Map();
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

function normalizeLogLines(ts, level, message) {
  const rawLines = String(message ?? "").replace(/\r\n/g, "\n").split("\n");
  const lines = rawLines.length > 0 ? rawLines : [""];
  return lines.map((line) => `[${ts}] [${level}] ${line}`);
}

function queueLogWrite(lines, { includeErrorLog = false } = {}) {
  const payload = `${lines.join("\n")}\n`;
  logWriteQueue = logWriteQueue
    .then(async () => {
      await ensureLogsDir();
      for (const target of logTargets) {
        // eslint-disable-next-line no-await-in-loop
        await rotateLogIfNeeded(target.filePath, target.rotatedPrefix);
        // eslint-disable-next-line no-await-in-loop
        await pruneRotatedLogsIfNeeded(target.rotatedPrefix);
      }
      await fs.promises.appendFile(logFile, payload, "utf8");
      if (includeErrorLog) {
        await fs.promises.appendFile(errorLogFile, payload, "utf8");
      }
    })
    .catch(() => {
      // ignore
    });
}

function log(level, message) {
  const ts = new Date().toISOString();
  const lines = normalizeLogLines(ts, level, message);
  for (const line of lines) {
    if (level === "ERROR") {
      console.error(line);
    } else {
      console.log(line);
    }
  }

  queueLogWrite(lines, { includeErrorLog: level === "ERROR" });
}

function logWithCooldown(level, key, message, cooldownMs = repeatedLogCooldownMs) {
  const normalizedMessage = String(message ?? "");
  const normalizedKey = String(key || "").trim();
  if (!normalizedKey || cooldownMs <= 0) {
    log(level, normalizedMessage);
    return true;
  }

  const now = Date.now();
  const previous = repeatedLogState.get(normalizedKey);
  if (previous && previous.message === normalizedMessage && (now - previous.loggedAt) < cooldownMs) {
    return false;
  }

  repeatedLogState.set(normalizedKey, {
    message: normalizedMessage,
    loggedAt: now,
  });
  log(level, normalizedMessage);
  return true;
}

function logStoreLoadError(storeKey, filePath, err, cooldownMs = repeatedLogCooldownMs) {
  const label = String(storeKey || "store").trim() || "store";
  const resolvedPath = String(filePath || "").trim();
  const message = `[${label}] Load error (${resolvedPath}): ${err?.message || err}`;
  return logWithCooldown("ERROR", `store-load:${label}:${resolvedPath}`, message, cooldownMs);
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

function resetLogCooldownStateForTests() {
  repeatedLogState.clear();
}

export {
  log,
  logWithCooldown,
  logStoreLoadError,
  shouldLogFfmpegStderrLine,
  getLogWriteQueue,
  resetLogCooldownStateForTests,
  rootDir,
  webDir,
  webRootSource,
  frontendBuildStamp,
  logsDir,
};
