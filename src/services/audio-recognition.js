import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { log } from "../lib/logging.js";
import { clipText, parseEnvInt, waitMs } from "../lib/helpers.js";

const RECOGNITION_ENABLED = String(process.env.NOW_PLAYING_RECOGNITION_ENABLED ?? "0").trim() !== "0";
const ACOUSTID_API_KEY = String(process.env.ACOUSTID_API_KEY || "").trim();
const MUSICBRAINZ_ENABLED = String(process.env.NOW_PLAYING_MUSICBRAINZ_ENABLED ?? "1").trim() !== "0";
const RECOGNITION_SAMPLE_SECONDS = parseEnvInt("NOW_PLAYING_RECOGNITION_SAMPLE_SECONDS", 18, 8, 30);
const RECOGNITION_TIMEOUT_MS = parseEnvInt("NOW_PLAYING_RECOGNITION_TIMEOUT_MS", 28_000, 8_000, 60_000);
const RECOGNITION_CACHE_TTL_MS = parseEnvInt("NOW_PLAYING_RECOGNITION_CACHE_TTL_MS", 90_000, 30_000, 10 * 60_000);
const RECOGNITION_FAILURE_TTL_MS = parseEnvInt("NOW_PLAYING_RECOGNITION_FAILURE_TTL_MS", 180_000, 30_000, 30 * 60_000);
const MUSICBRAINZ_MIN_DELAY_MS = parseEnvInt("NOW_PLAYING_MUSICBRAINZ_MIN_DELAY_MS", 1100, 1000, 10_000);
const ACOUSTID_MIN_DELAY_MS = parseEnvInt("NOW_PLAYING_ACOUSTID_MIN_DELAY_MS", 350, 150, 5_000);
const RECOGNITION_SCORE_THRESHOLD = Math.max(
  0.1,
  Math.min(1, Number.parseFloat(String(process.env.NOW_PLAYING_RECOGNITION_SCORE_THRESHOLD || "0.55")) || 0.55)
);
const PUBLIC_WEB_URL = String(process.env.PUBLIC_WEB_URL || "").trim() || "https://omnifm.xyz";
const USER_AGENT = `OmniFM/3.0 (+${PUBLIC_WEB_URL})`;
const MBID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const recognitionCache = new Map();
const recognitionInFlight = new Map();
let fpcalcAvailabilityPromise = null;
let nextAcoustIdRequestAt = 0;
let nextMusicBrainzRequestAt = 0;

function normalizeRecognitionValue(rawValue, maxLength = 200) {
  const text = clipText(String(rawValue || "").replace(/\s+/g, " ").trim(), maxLength);
  if (!text) return null;
  const lower = text.toLowerCase();
  if (lower === "-" || lower === "--" || lower === "unknown" || lower === "n/a") {
    return null;
  }
  return text;
}

function joinArtistNames(entries = []) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const artistText = entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return "";
      const name = normalizeRecognitionValue(entry.name || entry.artist?.name, 160) || "";
      const joinphrase = String(entry.joinphrase || "").slice(0, 12);
      return `${name}${joinphrase}`;
    })
    .join("")
    .trim();
  return normalizeRecognitionValue(artistText, 180);
}

function buildDisplayTitle(artist, title) {
  const cleanArtist = normalizeRecognitionValue(artist, 140);
  const cleanTitle = normalizeRecognitionValue(title, 180);
  if (cleanArtist && cleanTitle) return `${cleanArtist} - ${cleanTitle}`;
  return cleanTitle || cleanArtist || null;
}

function buildRecognitionCacheKey(url, existingTrack = null) {
  const normalizedUrl = String(url || "").trim().toLowerCase();
  const trackHint = normalizeRecognitionValue(
    existingTrack?.displayTitle || existingTrack?.title || existingTrack?.artist || "",
    120
  );
  return `${normalizedUrl}|${String(trackHint || "-").toLowerCase()}`;
}

async function waitForProviderWindow(provider, minDelayMs) {
  const now = Date.now();
  let readyAt = provider === "musicbrainz" ? nextMusicBrainzRequestAt : nextAcoustIdRequestAt;
  if (readyAt > now) {
    await waitMs(readyAt - now);
  }
  readyAt = Date.now() + Math.max(0, Number(minDelayMs) || 0);
  if (provider === "musicbrainz") {
    nextMusicBrainzRequestAt = readyAt;
  } else {
    nextAcoustIdRequestAt = readyAt;
  }
}

function runProcess(command, args, { timeoutMs = 15_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: { ...process.env, AV_LOG_FORCE_NOCOLOR: "1" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, Math.max(1000, timeoutMs));

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${clipText(stderr || stdout, 300)}`));
    });
  });
}

async function hasFpcalcSupport() {
  if (fpcalcAvailabilityPromise) return fpcalcAvailabilityPromise;
  fpcalcAvailabilityPromise = runProcess("fpcalc", ["-version"], { timeoutMs: 2500 })
    .then(() => true)
    .catch(() => false);
  return fpcalcAvailabilityPromise;
}

async function captureFingerprintFromStream(url) {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-fingerprint-"));
  const samplePath = path.join(tempDir, "sample.wav");

  try {
    await runProcess("ffmpeg", [
      "-hide_banner",
      "-loglevel", "error",
      "-nostdin",
      "-y",
      "-reconnect", "1",
      "-reconnect_streamed", "1",
      "-reconnect_at_eof", "1",
      "-reconnect_delay_max", "3",
      "-rw_timeout", "15000000",
      "-timeout", "15000000",
      "-t", String(RECOGNITION_SAMPLE_SECONDS),
      "-i", String(url || ""),
      "-vn",
      "-ac", "1",
      "-ar", "11025",
      "-c:a", "pcm_s16le",
      "-f", "wav",
      samplePath,
    ], { timeoutMs: RECOGNITION_TIMEOUT_MS });

    const output = await runProcess("fpcalc", [
      "-length",
      String(RECOGNITION_SAMPLE_SECONDS),
      samplePath,
    ], { timeoutMs: Math.min(RECOGNITION_TIMEOUT_MS, 12_000) });

    const durationMatch = output.stdout.match(/^DURATION=(.+)$/m);
    const fingerprintMatch = output.stdout.match(/^FINGERPRINT=(.+)$/m);
    const duration = Number.parseFloat(String(durationMatch?.[1] || "").trim());
    const fingerprint = String(fingerprintMatch?.[1] || "").trim();

    if (!Number.isFinite(duration) || duration <= 0 || !fingerprint) {
      throw new Error("fpcalc returned no usable fingerprint");
    }

    return {
      duration: Math.round(duration),
      fingerprint,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => null);
  }
}

function extractAcoustIdCandidate(result, recording) {
  if (!recording || typeof recording !== "object") return null;
  const title = normalizeRecognitionValue(recording.title, 180);
  const artist = joinArtistNames(recording.artists || recording["artist-credit"] || []);
  const release = Array.isArray(recording.releases) ? recording.releases.find((entry) => entry?.id || entry?.title) : null;
  const releaseGroup = Array.isArray(recording.releasegroups) ? recording.releasegroups[0] : null;
  const releaseTitle = normalizeRecognitionValue(release?.title || releaseGroup?.title, 180);
  const releaseId = MBID_PATTERN.test(String(release?.id || "").trim()) ? String(release.id).trim() : null;
  const recordingId = MBID_PATTERN.test(String(recording.id || "").trim()) ? String(recording.id).trim() : null;
  const score = Math.max(0, Math.min(1, Number.parseFloat(String(result?.score || 0)) || 0));
  const displayTitle = buildDisplayTitle(artist, title);
  if (!displayTitle) return null;

  return {
    acoustidId: normalizeRecognitionValue(result?.id, 64),
    musicBrainzRecordingId: recordingId,
    musicBrainzReleaseId: releaseId,
    artist,
    title,
    displayTitle,
    album: releaseTitle,
    releaseTitle,
    score,
    recognitionProvider: "AcoustID",
  };
}

function selectBestAcoustIdMatch(payload) {
  const results = Array.isArray(payload?.results) ? payload.results : [];
  const candidates = [];

  for (const result of results) {
    const recordings = Array.isArray(result?.recordings) ? result.recordings : [];
    for (const recording of recordings) {
      const candidate = extractAcoustIdCandidate(result, recording);
      if (!candidate) continue;
      candidates.push(candidate);
    }
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftRichness = Number(Boolean(left.artist)) + Number(Boolean(left.album));
    const rightRichness = Number(Boolean(right.artist)) + Number(Boolean(right.album));
    if (rightRichness !== leftRichness) return rightRichness - leftRichness;
    return String(left.displayTitle || "").localeCompare(String(right.displayTitle || ""));
  });

  const best = candidates[0] || null;
  if (!best || best.score < RECOGNITION_SCORE_THRESHOLD) return null;
  return best;
}

async function lookupAcoustIdFingerprint(fingerprint, duration) {
  await waitForProviderWindow("acoustid", ACOUSTID_MIN_DELAY_MS);

  const body = new URLSearchParams();
  body.set("client", ACOUSTID_API_KEY);
  body.set("duration", String(Math.max(1, Number(duration) || RECOGNITION_SAMPLE_SECONDS)));
  body.set("fingerprint", fingerprint);
  body.set("meta", "recordings+releasegroups+releases+tracks+compress");
  body.set("format", "json");

  const response = await fetch("https://api.acoustid.org/v2/lookup", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body,
    signal: AbortSignal.timeout(Math.min(12_000, RECOGNITION_TIMEOUT_MS)),
  });

  if (!response.ok) {
    throw new Error(`AcoustID lookup failed with HTTP ${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  if (!payload || payload.status !== "ok") {
    throw new Error("AcoustID did not return a valid result");
  }

  return selectBestAcoustIdMatch(payload);
}

function selectPreferredRelease(releases = []) {
  if (!Array.isArray(releases) || !releases.length) return null;
  const normalized = releases
    .filter((entry) => entry && typeof entry === "object")
    .map((entry) => ({
      ...entry,
      releaseId: MBID_PATTERN.test(String(entry.id || "").trim()) ? String(entry.id).trim() : null,
      releaseTitle: normalizeRecognitionValue(entry.title, 180),
      status: String(entry.status || "").trim().toLowerCase(),
      date: String(entry.date || "").trim(),
    }))
    .filter((entry) => entry.releaseId || entry.releaseTitle);

  normalized.sort((left, right) => {
    const leftOfficial = left.status === "official" ? 1 : 0;
    const rightOfficial = right.status === "official" ? 1 : 0;
    if (rightOfficial !== leftOfficial) return rightOfficial - leftOfficial;
    if (left.date && right.date && left.date !== right.date) return left.date.localeCompare(right.date);
    if (left.releaseTitle && right.releaseTitle && left.releaseTitle !== right.releaseTitle) {
      return left.releaseTitle.localeCompare(right.releaseTitle);
    }
    return 0;
  });

  return normalized[0] || null;
}

async function resolveCoverArtArchiveUrl(releaseId) {
  if (!MBID_PATTERN.test(String(releaseId || "").trim())) return null;
  const preferred = `https://coverartarchive.org/release/${releaseId}/front-500`;
  const fallback = `https://coverartarchive.org/release/${releaseId}/front`;

  for (const candidate of [preferred, fallback]) {
    const response = await fetch(candidate, {
      method: "HEAD",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);
    if (response?.ok) return candidate;
  }

  return null;
}

async function fetchMusicBrainzRecording(recordingId) {
  if (!MUSICBRAINZ_ENABLED || !MBID_PATTERN.test(String(recordingId || "").trim())) return null;
  await waitForProviderWindow("musicbrainz", MUSICBRAINZ_MIN_DELAY_MS);

  const response = await fetch(
    `https://musicbrainz.org/ws/2/recording/${recordingId}?fmt=json&inc=artists+releases+release-groups`,
    {
      method: "GET",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    }
  );

  if (!response.ok) {
    throw new Error(`MusicBrainz lookup failed with HTTP ${response.status}`);
  }

  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") {
    throw new Error("MusicBrainz returned no usable payload");
  }

  const release = selectPreferredRelease(payload.releases || []);
  const artist = joinArtistNames(payload["artist-credit"] || payload.artists || []);
  const title = normalizeRecognitionValue(payload.title, 180);
  const album = normalizeRecognitionValue(release?.releaseTitle, 180);
  const releaseId = release?.releaseId || null;
  const artworkUrl = releaseId ? await resolveCoverArtArchiveUrl(releaseId) : null;

  return {
    musicBrainzRecordingId: recordingId,
    musicBrainzReleaseId: releaseId,
    artist,
    title,
    displayTitle: buildDisplayTitle(artist, title),
    album,
    releaseTitle: album,
    artworkUrl,
    recognitionProvider: "AcoustID + MusicBrainz",
  };
}

function mergeRecognitionData(baseCandidate, enrichedCandidate) {
  const artist = enrichedCandidate?.artist || baseCandidate?.artist || null;
  const title = enrichedCandidate?.title || baseCandidate?.title || null;
  const displayTitle = enrichedCandidate?.displayTitle || baseCandidate?.displayTitle || buildDisplayTitle(artist, title);

  return {
    artist,
    title,
    displayTitle,
    raw: displayTitle || baseCandidate?.displayTitle || null,
    album: enrichedCandidate?.album || baseCandidate?.album || null,
    releaseTitle: enrichedCandidate?.releaseTitle || baseCandidate?.releaseTitle || null,
    artworkUrl: enrichedCandidate?.artworkUrl || null,
    recognitionProvider: enrichedCandidate?.recognitionProvider || baseCandidate?.recognitionProvider || "AcoustID",
    recognitionConfidence: baseCandidate?.score || null,
    acoustidId: baseCandidate?.acoustidId || null,
    musicBrainzRecordingId: enrichedCandidate?.musicBrainzRecordingId || baseCandidate?.musicBrainzRecordingId || null,
    musicBrainzReleaseId: enrichedCandidate?.musicBrainzReleaseId || baseCandidate?.musicBrainzReleaseId || null,
  };
}

async function recognizeTrackFromStream(url, { existingTrack = null } = {}) {
  if (!RECOGNITION_ENABLED || !ACOUSTID_API_KEY) return null;
  if (!(await hasFpcalcSupport())) return null;

  const cacheKey = buildRecognitionCacheKey(url, existingTrack);
  const cached = recognitionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (recognitionInFlight.has(cacheKey)) {
    return recognitionInFlight.get(cacheKey);
  }

  const request = (async () => {
    try {
      const sample = await captureFingerprintFromStream(url);
      const acoustIdCandidate = await lookupAcoustIdFingerprint(sample.fingerprint, sample.duration);
      if (!acoustIdCandidate) {
        recognitionCache.set(cacheKey, { value: null, expiresAt: Date.now() + RECOGNITION_FAILURE_TTL_MS });
        return null;
      }

      let enriched = null;
      if (acoustIdCandidate.musicBrainzRecordingId) {
        try {
          enriched = await fetchMusicBrainzRecording(acoustIdCandidate.musicBrainzRecordingId);
        } catch (error) {
          log("WARN", `[NowPlaying] MusicBrainz enrichment failed: ${error?.message || error}`);
        }
      }

      const resolved = mergeRecognitionData(acoustIdCandidate, enriched);
      if (!resolved.displayTitle) {
        recognitionCache.set(cacheKey, { value: null, expiresAt: Date.now() + RECOGNITION_FAILURE_TTL_MS });
        return null;
      }

      recognitionCache.set(cacheKey, {
        value: resolved,
        expiresAt: Date.now() + RECOGNITION_CACHE_TTL_MS,
      });
      return resolved;
    } catch (error) {
      log("WARN", `[NowPlaying] Audio recognition failed: ${clipText(error?.message || String(error), 220)}`);
      recognitionCache.set(cacheKey, { value: null, expiresAt: Date.now() + RECOGNITION_FAILURE_TTL_MS });
      return null;
    }
  })().finally(() => {
    recognitionInFlight.delete(cacheKey);
  });

  recognitionInFlight.set(cacheKey, request);
  return request;
}

export {
  extractAcoustIdCandidate,
  selectBestAcoustIdMatch,
  recognizeTrackFromStream,
};
