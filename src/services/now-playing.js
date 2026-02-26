// ============================================================
// OmniFM: Now-Playing / ICY Metadata / Album Cover
// ============================================================
import { log } from "../lib/logging.js";
import {
  clipText,
  concatUint8Arrays,
  NOW_PLAYING_COVER_ENABLED,
  NOW_PLAYING_COVER_TIMEOUT_MS,
  NOW_PLAYING_COVER_CACHE_TTL_MS,
  NOW_PLAYING_FETCH_TIMEOUT_MS,
  NOW_PLAYING_MAX_METAINT_BYTES,
} from "../lib/helpers.js";

const nowPlayingCoverCache = new Map();
const nowPlayingCoverInFlight = new Map();

function extractIcyField(metadataText, fieldName) {
  const escapedFieldName = String(fieldName || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!escapedFieldName) return null;
  const match = String(metadataText || "").match(new RegExp(`${escapedFieldName}\\s*=\\s*'([^']*)'`, "i"));
  return match?.[1] || null;
}

function normalizeTrackText(raw) {
  const text = String(raw || "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;

  const lower = text.toLowerCase();
  const blockedValues = new Set(["-", "--", "n/a", "na", "none", "null", "undefined", "unknown"]);
  if (blockedValues.has(lower)) return null;
  return text;
}

function parseTrackFromStreamTitle(rawTitle) {
  const cleaned = normalizeTrackText(rawTitle);
  if (!cleaned) {
    return { raw: null, artist: null, title: null, displayTitle: null };
  }

  const separators = [" - ", " – ", " — ", " | ", " ~ ", " / ", " :: ", ": "];
  for (const separator of separators) {
    const index = cleaned.indexOf(separator);
    if (index <= 0 || index >= cleaned.length - separator.length) continue;
    const left = normalizeTrackText(cleaned.slice(0, index));
    const right = normalizeTrackText(cleaned.slice(index + separator.length));
    if (!left || !right) continue;
    return {
      raw: cleaned,
      artist: left,
      title: right,
      displayTitle: `${left} - ${right}`,
    };
  }

  return {
    raw: cleaned,
    artist: null,
    title: cleaned,
    displayTitle: cleaned,
  };
}

async function fetchCoverArtFromItunes(query) {
  try {
    const endpoint = new URL("https://itunes.apple.com/search");
    endpoint.searchParams.set("term", query);
    endpoint.searchParams.set("media", "music");
    endpoint.searchParams.set("entity", "song");
    endpoint.searchParams.set("limit", "1");

    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: { "User-Agent": "OmniFM/3.0" },
      signal: AbortSignal.timeout(Math.min(NOW_PLAYING_COVER_TIMEOUT_MS, 2000)),
    });
    
    if (!response.ok) return null;
    
    const payload = await response.json().catch(() => null);
    const result = Array.isArray(payload?.results) ? payload.results[0] : null;
    let artworkUrl = result?.artworkUrl100 || result?.artworkUrl60 || null;
    
    if (artworkUrl) {
      artworkUrl = artworkUrl.replace(/\/\d+x\d+bb\./i, "/600x600bb.");
    }
    
    return artworkUrl || null;
  } catch {
    return null;
  }
}

async function fetchCoverArtFromMusicBrainz(artist, title) {
  try {
    // MusicBrainz Recording Search API
    const query = `artist:"${artist}" recording:"${title}"`;
    const endpoint = new URL("https://musicbrainz.org/ws/2/recording");
    endpoint.searchParams.set("query", query);
    endpoint.searchParams.set("fmt", "json");
    endpoint.searchParams.set("limit", "1");

    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: { "User-Agent": "OmniFM/3.0 (+omnifm.radio)" },
      signal: AbortSignal.timeout(2500),
    });
    
    if (!response.ok) return null;
    
    const data = await response.json().catch(() => null);
    if (!data?.recordings || !Array.isArray(data.recordings) || data.recordings.length === 0) {
      return null;
    }
    
    // Try to find cover art from releases
    const recording = data.recordings[0];
    const releases = recording.releases || [];
    
    for (const release of releases) {
      if (release.images && Array.isArray(release.images) && release.images.length > 0) {
        // Prefer front cover, fall back to any image
        const frontImage = release.images.find(img => img.front);
        const coverImage = frontImage || release.images[0];
        if (coverImage?.image) {
          return coverImage.image;
        }
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

async function fetchCoverArtFromDiscogs(artist, title) {
  try {
    // Discogs API - Release Search
    const query = `${artist} ${title}`;
    const endpoint = new URL("https://api.discogs.com/database/search");
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("type", "release");
    endpoint.searchParams.set("per_page", "1");

    const response = await fetch(endpoint.toString(), {
      method: "GET",
      headers: { "User-Agent": "OmniFM/3.0 (+omnifm.radio)" },
      signal: AbortSignal.timeout(2500),
    });
    
    if (!response.ok) return null;
    
    const data = await response.json().catch(() => null);
    if (!data?.results || !Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }
    
    // Discogs gibt cover_image direkt zurück
    const release = data.results[0];
    if (release?.cover_image && release.cover_image.trim() !== "") {
      return release.cover_image;
    }
    
    return null;
  } catch {
    return null;
  }
}

async function fetchCoverArtForTrack(artist, title) {
  if (!NOW_PLAYING_COVER_ENABLED) return null;

  const artistPart = normalizeTrackText(artist);
  const titlePart = normalizeTrackText(title);
  const query = clipText([artistPart, titlePart].filter(Boolean).join(" "), 180);
  if (!query || query.length < 3) return null;

  const cacheKey = query.toLowerCase();
  const now = Date.now();
  const cached = nowPlayingCoverCache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.url || null;

  if (nowPlayingCoverInFlight.has(cacheKey)) {
    return nowPlayingCoverInFlight.get(cacheKey);
  }

  const request = (async () => {
    let artworkUrl = null;
    
    try {
      // Versuch 1: iTunes (schnell & populär)
      artworkUrl = await fetchCoverArtFromItunes(query);
      if (artworkUrl) {
        nowPlayingCoverCache.set(cacheKey, {
          url: artworkUrl,
          expiresAt: now + NOW_PLAYING_COVER_CACHE_TTL_MS,
        });
        return artworkUrl;
      }
      
      // Versuch 2: MusicBrainz (zuverlässig für klassische Musik & Professionelle Labels)
      if (artistPart && titlePart) {
        artworkUrl = await fetchCoverArtFromMusicBrainz(artistPart, titlePart);
        if (artworkUrl) {
          nowPlayingCoverCache.set(cacheKey, {
            url: artworkUrl,
            expiresAt: now + NOW_PLAYING_COVER_CACHE_TTL_MS,
          });
          return artworkUrl;
        }
      }
      
      // Versuch 3: Discogs (Elektronik, Indie, Alternative)
      if (artistPart && titlePart) {
        artworkUrl = await fetchCoverArtFromDiscogs(artistPart, titlePart);
        if (artworkUrl) {
          nowPlayingCoverCache.set(cacheKey, {
            url: artworkUrl,
            expiresAt: now + NOW_PLAYING_COVER_CACHE_TTL_MS,
          });
          return artworkUrl;
        }
      }
    } catch {
      // ignore all errors
    }

    // Kein Cover gefunden
    nowPlayingCoverCache.set(cacheKey, {
      url: null,
      expiresAt: now + NOW_PLAYING_COVER_CACHE_TTL_MS,
    });
    return null;
  })().finally(() => {
    nowPlayingCoverInFlight.delete(cacheKey);
  });

  nowPlayingCoverInFlight.set(cacheKey, request);
  return request;
}

async function fetchStreamSnapshot(url, { includeCover = false } = {}) {
  const empty = {
    name: null,
    description: null,
    streamTitle: null,
    artist: null,
    title: null,
    displayTitle: null,
    artworkUrl: null,
  };

  let res = null;
  let reader = null;

  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "Icy-MetaData": "1",
        "User-Agent": "OmniFM/3.0"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(NOW_PLAYING_FETCH_TIMEOUT_MS)
    });

    const snapshot = {
      ...empty,
      name: normalizeTrackText(res.headers.get("icy-name")),
      description: normalizeTrackText(res.headers.get("icy-description")),
    };

    const metaint = Number.parseInt(String(res.headers.get("icy-metaint") || "").trim(), 10);
    if (!res.body || !Number.isFinite(metaint) || metaint <= 0 || metaint > NOW_PLAYING_MAX_METAINT_BYTES) {
      return snapshot;
    }

    reader = res.body.getReader();
    let buffer = new Uint8Array(0);

    const readAtLeast = async (requiredBytes) => {
      while (buffer.length < requiredBytes) {
        const { done, value } = await reader.read();
        if (done) return false;
        if (value?.length) {
          buffer = concatUint8Arrays(buffer, value);
        }
      }
      return true;
    };

    if (!(await readAtLeast(metaint + 1))) {
      return snapshot;
    }

    buffer = buffer.slice(metaint);
    const metadataLength = (buffer[0] || 0) * 16;
    buffer = buffer.slice(1);
    if (metadataLength <= 0) {
      return snapshot;
    }

    if (!(await readAtLeast(metadataLength))) {
      return snapshot;
    }

    const metadataChunk = buffer.slice(0, metadataLength);
    const metadataText = new TextDecoder("utf-8")
      .decode(metadataChunk)
      .replace(/\u0000+/g, "")
      .trim();
    const track = parseTrackFromStreamTitle(extractIcyField(metadataText, "StreamTitle"));
    snapshot.streamTitle = track.raw;
    snapshot.artist = track.artist;
    snapshot.title = track.title;
    snapshot.displayTitle = track.displayTitle;

    if (includeCover && track.displayTitle) {
      snapshot.artworkUrl = await fetchCoverArtForTrack(track.artist, track.title || track.displayTitle);
    }

    return snapshot;
  } catch {
    return empty;
  } finally {
    try {
      if (reader) await reader.cancel();
    } catch {
      // ignore
    }
    try {
      await res?.body?.cancel?.();
    } catch {
      // ignore
    }
  }
}

async function fetchStreamInfo(url) {
  const snapshot = await fetchStreamSnapshot(url, { includeCover: false });
  return {
    name: snapshot.name,
    description: snapshot.description,
    streamTitle: snapshot.streamTitle,
    artist: snapshot.artist,
    title: snapshot.title,
    displayTitle: snapshot.displayTitle,
    artworkUrl: null,
    updatedAt: new Date().toISOString(),
  };
}

export {
  extractIcyField,
  normalizeTrackText,
  parseTrackFromStreamTitle,
  fetchCoverArtForTrack,
  fetchStreamSnapshot,
  fetchStreamInfo,
  nowPlayingCoverCache,
};
