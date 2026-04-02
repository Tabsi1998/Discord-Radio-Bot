import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { fileURLToPath } from "node:url";
import { log, logStoreLoadError } from "./lib/logging.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CUSTOM_FILE = path.resolve(__dirname, "..", "custom-stations.json");
const CUSTOM_FILE = path.resolve(process.env.OMNIFM_CUSTOM_STATIONS_FILE || DEFAULT_CUSTOM_FILE);
const CUSTOM_BACKUP_FILE = `${CUSTOM_FILE}.bak`;
const MAX_STATIONS_PER_GUILD = 50;
const MAX_TAGS_PER_STATION = 8;
const MAX_FOLDER_LENGTH = 40;
const MAX_TAG_LENGTH = 24;
const CUSTOM_STATION_PREFIX = "custom:";
const dnsValidationCache = new Map();

function parseEnvInt(rawValue, fallbackValue, minValue = 0, maxValue = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(rawValue ?? fallbackValue), 10);
  if (!Number.isFinite(parsed)) return fallbackValue;
  return Math.min(maxValue, Math.max(minValue, parsed));
}

const DNS_LOOKUP_RETRY_COUNT = parseEnvInt(process.env.DNS_LOOKUP_RETRY_COUNT, 3, 1, 6);
const DNS_LOOKUP_RETRY_DELAY_MS = parseEnvInt(process.env.DNS_LOOKUP_RETRY_DELAY_MS, 750, 0, 10_000);
const DNS_LOOKUP_CACHE_TTL_MS = parseEnvInt(process.env.DNS_LOOKUP_CACHE_TTL_MS, 10 * 60_000, 5_000, 24 * 60 * 60_000);
const DNS_LOOKUP_STALE_TTL_MS = parseEnvInt(process.env.DNS_LOOKUP_STALE_TTL_MS, 60 * 60_000, DNS_LOOKUP_CACHE_TTL_MS, 7 * 24 * 60 * 60_000);

function waitMs(ms) {
  const delay = Math.max(0, Number(ms) || 0);
  if (delay <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    setTimeout(resolve, delay);
  });
}

function normalizeResolvedAddresses(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .map((entry) => ({
      address: String(entry?.address || "").trim(),
      family: Number(entry?.family || 0) || 0,
    }))
    .filter((entry) => Boolean(entry.address));
}

function getCachedDnsValidation(hostname, { allowStale = false } = {}) {
  const key = String(hostname || "").trim().toLowerCase();
  if (!key) return null;

  const cached = dnsValidationCache.get(key);
  if (!cached) return null;

  const ageMs = Date.now() - Number(cached.savedAt || 0);
  const maxAgeMs = allowStale ? DNS_LOOKUP_STALE_TTL_MS : DNS_LOOKUP_CACHE_TTL_MS;
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > maxAgeMs) {
    dnsValidationCache.delete(key);
    return null;
  }

  return cached;
}

function setCachedDnsValidation(hostname, addresses) {
  const key = String(hostname || "").trim().toLowerCase();
  const normalizedAddresses = normalizeResolvedAddresses(addresses);
  if (!key || normalizedAddresses.length === 0) return;
  dnsValidationCache.set(key, {
    addresses: normalizedAddresses,
    savedAt: Date.now(),
  });
}

function isRetryableDnsLookupError(err) {
  const code = String(err?.code || "").trim().toUpperCase();
  if (["EAI_AGAIN", "ETIMEDOUT", "ETIME", "ESERVFAIL", "EREFUSED"].includes(code)) {
    return true;
  }

  const message = String(err?.message || err || "").trim().toLowerCase();
  if (!message) return false;
  return (
    message.includes("temporary failure") ||
    message.includes("try again") ||
    message.includes("timed out") ||
    message.includes("timeout") ||
    message.includes("servfail") ||
    message.includes("refused")
  );
}

async function resolveHostnameWithRetries(hostname, {
  lookupFn = dnsLookup,
  retryCount = DNS_LOOKUP_RETRY_COUNT,
  retryDelayMs = DNS_LOOKUP_RETRY_DELAY_MS,
} = {}) {
  const attempts = Math.max(1, Number(retryCount) || 1);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const resolvedAddresses = normalizeResolvedAddresses(
        await lookupFn(hostname, { all: true, verbatim: true })
      );
      if (resolvedAddresses.length > 0) {
        return { ok: true, addresses: resolvedAddresses, attempts: attempt };
      }
      lastError = new Error("empty-dns-result");
      lastError.code = "EEMPTYDNS";
    } catch (err) {
      lastError = err;
    }

    if (attempt >= attempts || !isRetryableDnsLookupError(lastError)) {
      break;
    }
    await waitMs(retryDelayMs);
  }

  return { ok: false, error: lastError, addresses: [] };
}

function normalizeWhitespace(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function readStationsFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  if (fs.statSync(filePath).isDirectory()) {
    log("WARN", `[custom-stations] ${filePath} ist ein Verzeichnis - ueberspringe.`);
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function load() {
  const candidates = [CUSTOM_FILE, CUSTOM_BACKUP_FILE];
  for (const filePath of candidates) {
    try {
      const data = readStationsFile(filePath);
      if (data) {
        if (filePath === CUSTOM_BACKUP_FILE) {
          log("WARN", "[custom-stations] Verwende Backup-Datei custom-stations.json.bak");
        }
        // Migrate legacy array-per-guild format to canonical object-per-guild format
        let migrated = false;
        for (const [gid, value] of Object.entries(data)) {
          if (Array.isArray(value)) {
            const objMap = {};
            for (const item of value) {
              const key = sanitizeKey(item.id || item.key || item.name || "");
              if (!key) continue;
              objMap[key] = {
                name: String(item.name || item.title || key).trim().substring(0, 100),
                url: String(item.streamURL || item.url || item.streamUrl || "").trim(),
                genre: String(item.genre || "").trim().substring(0, 80),
                folder: normalizeCustomStationFolder(item.folder || item.group || ""),
                tags: normalizeCustomStationTags(item.tags),
                addedAt: item.addedAt || new Date().toISOString(),
              };
            }
            data[gid] = objMap;
            migrated = true;
          }
        }
        if (migrated) {
          try {
            save(data);
            log("INFO", "[custom-stations] Migration: legacy array format konvertiert und gespeichert.");
          } catch (err) {
            log("ERROR", `[custom-stations] Migration Save failed: ${err?.message || err}`);
          }
        }
        return data;
      }
    } catch (err) {
      logStoreLoadError("custom-stations", filePath, err);
    }
  }
  return {};
}

function save(data) {
  const tmpFile = `${CUSTOM_FILE}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (fs.existsSync(CUSTOM_FILE) && fs.statSync(CUSTOM_FILE).isDirectory()) {
      log("WARN", `[custom-stations] ${CUSTOM_FILE} ist ein Verzeichnis - Speichern uebersprungen.`);
      return;
    }

    if (fs.existsSync(CUSTOM_FILE)) {
      try {
        fs.copyFileSync(CUSTOM_FILE, CUSTOM_BACKUP_FILE);
      } catch (copyErr) {
        log("ERROR", `[custom-stations] Backup warnung: ${copyErr.message}`);
      }
    }

    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2) + "\n", "utf8");
    try {
      fs.renameSync(tmpFile, CUSTOM_FILE);
    } catch (renameErr) {
      const code = String(renameErr?.code || "");
      if (["EBUSY", "EPERM", "EACCES", "EXDEV"].includes(code)) {
        fs.writeFileSync(CUSTOM_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
        log("WARN", `[custom-stations] Atomic rename nicht moeglich (${code}), nutze direkten Write-Fallback.`);
      } else {
        throw renameErr;
      }
    }
  } catch (err) {
    log("ERROR", `[custom-stations] Save error: ${err.message}`);
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

function sanitizeKey(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").substring(0, 40);
}

function normalizeCustomStationKey(raw) {
  return sanitizeKey(raw);
}

function normalizeCustomStationFolder(raw) {
  return normalizeWhitespace(raw).substring(0, MAX_FOLDER_LENGTH);
}

function normalizeCustomStationTags(rawTags) {
  const source = Array.isArray(rawTags)
    ? rawTags
    : typeof rawTags === "string"
      ? rawTags.split(/[,\n]/g)
      : [];

  const tags = [];
  const seen = new Set();
  for (const rawTag of source) {
    const value = normalizeWhitespace(rawTag).substring(0, MAX_TAG_LENGTH);
    if (!value) continue;
    const normalizedKey = value.toLowerCase();
    if (seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);
    tags.push(value);
    if (tags.length >= MAX_TAGS_PER_STATION) break;
  }

  return tags;
}

function normalizeStoredStation(station, fallbackKey = "") {
  const raw = station && typeof station === "object" ? station : {};
  return {
    name: String(raw.name || raw.title || fallbackKey).trim().substring(0, 100),
    url: String(raw.url || raw.streamURL || raw.streamUrl || "").trim(),
    genre: String(raw.genre || "").trim().substring(0, 80),
    folder: normalizeCustomStationFolder(raw.folder || raw.group || ""),
    tags: normalizeCustomStationTags(raw.tags),
    addedAt: raw.addedAt || null,
  };
}

function buildCustomStationReference(rawKey) {
  const key = normalizeCustomStationKey(rawKey);
  return key ? `${CUSTOM_STATION_PREFIX}${key}` : null;
}

function parseCustomStationReference(rawReference) {
  const raw = String(rawReference || "").trim().toLowerCase();
  if (!raw.startsWith(CUSTOM_STATION_PREFIX)) {
    return { isCustom: false, key: null, reference: null };
  }

  const key = normalizeCustomStationKey(raw.slice(CUSTOM_STATION_PREFIX.length));
  if (!key) {
    return { isCustom: true, key: null, reference: null };
  }

  return {
    isCustom: true,
    key,
    reference: `${CUSTOM_STATION_PREFIX}${key}`,
  };
}

function isPrivateIpv4(hostname) {
  const parts = String(hostname || "").split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function legacyHostToIpv4(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return null;

  let value = null;
  if (/^\d+$/.test(host)) {
    value = BigInt(host);
  } else if (/^0x[0-9a-f]+$/i.test(host)) {
    value = BigInt(host);
  } else if (/^0[0-7]+$/.test(host) && host !== "0") {
    value = BigInt(`0o${host.slice(1)}`);
  }

  if (value === null) return null;
  if (value < 0n || value > 0xFFFFFFFFn) return null;

  const a = Number((value >> 24n) & 0xFFn);
  const b = Number((value >> 16n) & 0xFFn);
  const c = Number((value >> 8n) & 0xFFn);
  const d = Number(value & 0xFFn);
  return `${a}.${b}.${c}.${d}`;
}

function isPrivateOrLocalHost(hostnameInput) {
  const hostname = String(hostnameInput || "").trim().toLowerCase().replace(/\.$/, "");
  if (!hostname) return true;
  if (hostname === "localhost" || hostname === "0.0.0.0") return true;
  if (hostname.endsWith(".nip.io") || hostname.endsWith(".sslip.io")) return true;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".lan") || hostname.endsWith(".home")) {
    return true;
  }

  const legacyIpv4 = legacyHostToIpv4(hostname);
  if (legacyIpv4 && isPrivateIpv4(legacyIpv4)) {
    return true;
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) {
    return isPrivateIpv4(hostname);
  }

  if (ipVersion === 6) {
    if (hostname === "::1" || hostname === "::") return true;
    if (hostname.startsWith("fe80:")) return true; // link-local
    if (hostname.startsWith("fc") || hostname.startsWith("fd")) return true; // unique local
    if (hostname.startsWith("::ffff:127.")) return true; // mapped loopback
  }

  return false;
}

function validateCustomStationUrl(rawUrl) {
  let parsedUrl;
  try {
    parsedUrl = new URL(String(rawUrl || "").trim());
  } catch {
    return { ok: false, error: "URL-Format ungültig." };
  }
  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    return { ok: false, error: "URL muss mit http:// oder https:// beginnen." };
  }
  if (parsedUrl.username || parsedUrl.password) {
    return { ok: false, error: "URLs mit Benutzername/Passwort sind nicht erlaubt." };
  }
  if (isPrivateOrLocalHost(parsedUrl.hostname)) {
    return { ok: false, error: "Lokale/private Hosts sind nicht erlaubt." };
  }
  return { ok: true, url: parsedUrl.toString() };
}

async function validateCustomStationUrlWithDns(rawUrl, options = {}) {
  const basicValidation = validateCustomStationUrl(rawUrl);
  if (!basicValidation.ok) return basicValidation;

  const parsedUrl = new URL(basicValidation.url);
  if (net.isIP(parsedUrl.hostname)) {
    return basicValidation;
  }

  let resolvedAddresses = getCachedDnsValidation(parsedUrl.hostname)?.addresses || [];
  if (resolvedAddresses.length === 0) {
    try {
      const resolution = await resolveHostnameWithRetries(parsedUrl.hostname, options);
      if (!resolution.ok) {
        const staleCache = getCachedDnsValidation(parsedUrl.hostname, { allowStale: true });
        if (!staleCache?.addresses?.length) {
          return { ok: false, error: "Host konnte nicht aufgelöst werden." };
        }

        resolvedAddresses = staleCache.addresses;
        log(
          "WARN",
          `[custom-stations] DNS-Cache-Fallback fuer ${parsedUrl.hostname} nach Lookup-Fehler: ${resolution.error?.message || resolution.error || "unknown"}`
        );
      } else {
        resolvedAddresses = resolution.addresses;
        setCachedDnsValidation(parsedUrl.hostname, resolvedAddresses);
        if (Number(resolution.attempts || 1) > 1) {
          log("INFO", `[custom-stations] DNS-Aufloesung fuer ${parsedUrl.hostname} nach ${resolution.attempts} Versuchen erfolgreich.`);
        }
      }
    } catch {
      return { ok: false, error: "Host konnte nicht aufgelöst werden." };
    }
  }

  if (!Array.isArray(resolvedAddresses) || resolvedAddresses.length === 0) {
    return { ok: false, error: "Host konnte nicht aufgelöst werden." };
  }

  for (const entry of resolvedAddresses) {
    const address = String(entry?.address || "").trim();
    if (!address) continue;
    if (isPrivateOrLocalHost(address)) {
      return { ok: false, error: "Lokale/private Hosts sind nicht erlaubt." };
    }
  }

  return basicValidation;
}

function getGuildStations(guildId) {
  const data = load();
  const rawStations = data[String(guildId)] || {};
  const stations = {};
  for (const [key, station] of Object.entries(rawStations)) {
    stations[key] = normalizeStoredStation(station, key);
  }
  return stations;
}

function normalizeStationInput(nameOrStation, url) {
  if (nameOrStation && typeof nameOrStation === "object" && !Array.isArray(nameOrStation)) {
    return {
      name: String(nameOrStation.name || "").trim(),
      url: String(nameOrStation.url || nameOrStation.streamURL || nameOrStation.streamUrl || "").trim(),
      genre: String(nameOrStation.genre || "").trim().substring(0, 80),
      folder: normalizeCustomStationFolder(nameOrStation.folder || ""),
      tags: normalizeCustomStationTags(nameOrStation.tags),
    };
  }

  return {
    name: String(nameOrStation || "").trim(),
    url: String(url || "").trim(),
    genre: "",
    folder: "",
    tags: [],
  };
}

async function saveGuildStation(guildId, key, nameOrStation, url, options = {}) {
  const data = load();
  const gid = String(guildId);
  if (!data[gid]) data[gid] = {};

  const sKey = sanitizeKey(key);
  if (!sKey) return { error: "Ungültiger Station-Key." };

  const existingStation = data[gid][sKey];
  if (!existingStation && Object.keys(data[gid]).length >= MAX_STATIONS_PER_GUILD) {
    return { error: `Maximum ${MAX_STATIONS_PER_GUILD} Custom-Stationen erreicht.` };
  }
  if (!options?.overwrite && existingStation) {
    return { error: `Station mit Key '${sKey}' existiert bereits.` };
  }

  const stationInput = normalizeStationInput(nameOrStation, url);
  if (!stationInput.name) return { error: "Name darf nicht leer sein." };
  if (!stationInput.url) return { error: "URL darf nicht leer sein." };

  const validation = await validateCustomStationUrlWithDns(stationInput.url);
  if (!validation.ok) return { error: validation.error };

  data[gid][sKey] = {
    name: stationInput.name.substring(0, 100),
    url: validation.url,
    genre: stationInput.genre,
    folder: stationInput.folder,
    tags: stationInput.tags,
    addedAt: existingStation?.addedAt || new Date().toISOString(),
  };
  save(data);
  return { success: true, key: sKey, station: data[gid][sKey] };
}

async function addGuildStation(guildId, key, nameOrStation, url) {
  return saveGuildStation(guildId, key, nameOrStation, url, { overwrite: false });
}

async function updateGuildStation(guildId, key, nameOrStation, url) {
  return saveGuildStation(guildId, key, nameOrStation, url, { overwrite: true });
}

function removeGuildStation(guildId, key) {
  const data = load();
  const gid = String(guildId);
  const sKey = sanitizeKey(key);
  if (!data[gid] || !data[gid][sKey]) return false;
  delete data[gid][sKey];
  if (Object.keys(data[gid]).length === 0) delete data[gid];
  save(data);
  return true;
}

function listGuildStations(guildId) {
  return getGuildStations(guildId);
}

function countGuildStations(guildId) {
  return Object.keys(getGuildStations(guildId)).length;
}

function clearGuildStations(guildId) {
  const data = load();
  delete data[String(guildId)];
  save(data);
}

// Legacy aliases used by older runtime code.
const addCustomStation = addGuildStation;
const updateCustomStation = updateGuildStation;
const removeCustomStation = removeGuildStation;
const listCustomStations = listGuildStations;

export {
  CUSTOM_STATION_PREFIX,
  MAX_STATIONS_PER_GUILD,
  MAX_TAGS_PER_STATION,
  normalizeCustomStationKey,
  normalizeCustomStationFolder,
  normalizeCustomStationTags,
  buildCustomStationReference,
  parseCustomStationReference,
  validateCustomStationUrl,
  validateCustomStationUrlWithDns,
  getGuildStations, addGuildStation, removeGuildStation,
  updateGuildStation,
  listGuildStations, countGuildStations, clearGuildStations,
  addCustomStation, updateCustomStation, removeCustomStation, listCustomStations,
};
