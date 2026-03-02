import { spawn } from "node:child_process";

import { clipText } from "../lib/helpers.js";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

function isYouTubeUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    return YOUTUBE_HOSTS.has(String(parsed.hostname || "").trim().toLowerCase());
  } catch {
    return false;
  }
}

function getYtDlpBinary() {
  return String(process.env.YTDLP_BIN || "yt-dlp").trim() || "yt-dlp";
}

function buildLiveError(message, code) {
  const err = new Error(message);
  err.code = code;
  err.isYoutubeLiveError = true;
  return err;
}

function runYtDlp(args, timeoutMs = 20_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(getYtDlpBinary(), args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (String(err?.code || "") === "ENOENT") {
        reject(buildLiveError("yt-dlp ist nicht installiert. Bitte Container/Image aktualisieren.", "ytdlp_missing"));
        return;
      }
      reject(buildLiveError(`yt-dlp konnte nicht gestartet werden: ${err?.message || err}`, "ytdlp_spawn_failed"));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);

      if (timedOut) {
        reject(buildLiveError("YouTube-Livestream-Aufloesung hat zu lange gedauert.", "ytdlp_timeout"));
        return;
      }

      if (code !== 0) {
        const detail = clipText(stderr.trim() || stdout.trim() || `exit ${code}`, 220);
        reject(buildLiveError(`YouTube-Livestream konnte nicht aufgeloest werden: ${detail}`, "ytdlp_failed"));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function pickBestAudioUrl(formats) {
  if (!Array.isArray(formats)) return "";

  const candidates = formats
    .filter((format) => format && String(format.url || "").trim())
    .filter((format) => String(format.acodec || "").trim().toLowerCase() !== "none")
    .sort((left, right) => {
      const leftAudioOnly = String(left?.vcodec || "").trim().toLowerCase() === "none" ? 1 : 0;
      const rightAudioOnly = String(right?.vcodec || "").trim().toLowerCase() === "none" ? 1 : 0;
      if (leftAudioOnly !== rightAudioOnly) return rightAudioOnly - leftAudioOnly;

      const leftAbr = Number(left?.abr || left?.asr || 0) || 0;
      const rightAbr = Number(right?.abr || right?.asr || 0) || 0;
      return rightAbr - leftAbr;
    });

  return String(candidates[0]?.url || "").trim();
}

function extractPlayableUrl(payload) {
  const direct = String(payload?.url || "").trim();
  if (direct) return direct;

  const requested = Array.isArray(payload?.requested_formats) ? pickBestAudioUrl(payload.requested_formats) : "";
  if (requested) return requested;

  return pickBestAudioUrl(payload?.formats);
}

async function resolveYouTubeLiveStream(rawUrl) {
  const sourceUrl = String(rawUrl || "").trim();
  if (!isYouTubeUrl(sourceUrl)) {
    return {
      isYoutube: false,
      sourceUrl,
      playbackUrl: sourceUrl,
      forceTranscode: false,
      title: "",
      channel: "",
    };
  }

  const { stdout } = await runYtDlp([
    "--dump-single-json",
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    "--format",
    "bestaudio/best",
    "--",
    sourceUrl,
  ]);

  let payload;
  try {
    payload = JSON.parse(String(stdout || "").trim() || "{}");
  } catch {
    throw buildLiveError("yt-dlp hat ungueltige Daten fuer den YouTube-Stream geliefert.", "ytdlp_invalid_json");
  }

  const liveStatus = String(payload?.live_status || "").trim().toLowerCase();
  const isLive = payload?.is_live === true || liveStatus === "is_live";
  if (!isLive) {
    if (liveStatus === "is_upcoming") {
      throw buildLiveError("Der YouTube-Livestream ist noch nicht live.", "youtube_not_live_yet");
    }
    if (liveStatus === "post_live" || liveStatus === "was_live") {
      throw buildLiveError("Der YouTube-Livestream ist bereits beendet.", "youtube_live_ended");
    }
    throw buildLiveError("Es werden nur aktuell laufende YouTube-Livestreams unterstuetzt.", "youtube_not_live");
  }

  const playbackUrl = extractPlayableUrl(payload);
  if (!playbackUrl) {
    throw buildLiveError("Die Audio-URL des YouTube-Livestreams konnte nicht gefunden werden.", "youtube_stream_url_missing");
  }

  return {
    isYoutube: true,
    sourceUrl,
    playbackUrl,
    forceTranscode: true,
    title: clipText(payload?.fulltitle || payload?.title || "", 160),
    channel: clipText(payload?.channel || payload?.uploader || "", 120),
  };
}

export {
  isYouTubeUrl,
  resolveYouTubeLiveStream,
};
