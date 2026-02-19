import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const stationsPath = path.resolve(__dirname, "..", "stations.json");

const QUALITY_PRESETS = new Set(["low", "medium", "high", "custom"]);

function emptyStationsData() {
  return {
    defaultStationKey: null,
    stations: {},
    locked: false,
    qualityPreset: "custom",
    fallbackKeys: []
  };
}

function sanitizeKey(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function sanitizeStations(stationsInput) {
  const out = {};
  if (!stationsInput || typeof stationsInput !== "object") return out;

  for (const [rawKey, rawValue] of Object.entries(stationsInput)) {
    const key = sanitizeKey(rawKey);
    const name = String(rawValue?.name || "").trim();
    const url = String(rawValue?.url || "").trim();
    if (!key || !name || !url) continue;
    out[key] = { name, url };
  }
  return out;
}

export function normalizeStationsData(input) {
  const base = emptyStationsData();
  if (!input || typeof input !== "object") return base;

  const stations = sanitizeStations(input.stations);
  const stationKeys = Object.keys(stations);

  const defaultKey = sanitizeKey(input.defaultStationKey);
  const qualityPreset = String(input.qualityPreset || "custom").toLowerCase();
  const rawFallback = Array.isArray(input.fallbackKeys) ? input.fallbackKeys : [];

  const fallbackKeys = rawFallback
    .map((k) => sanitizeKey(k))
    .filter((k, idx, arr) => k && stations[k] && arr.indexOf(k) === idx);

  return {
    defaultStationKey: stations[defaultKey] ? defaultKey : stationKeys[0] || null,
    stations,
    locked: Boolean(input.locked),
    qualityPreset: QUALITY_PRESETS.has(qualityPreset) ? qualityPreset : "custom",
    fallbackKeys
  };
}

export function loadStations() {
  if (!fs.existsSync(stationsPath)) {
    return emptyStationsData();
  }

  try {
    const raw = fs.readFileSync(stationsPath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeStationsData(parsed);
  } catch {
    return emptyStationsData();
  }
}

export function saveStations(data) {
  const normalized = normalizeStationsData(data);
  const tempPath = `${stationsPath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(normalized, null, 2));
  fs.renameSync(tempPath, stationsPath);
  return normalized;
}

export function getStationsPath() {
  return stationsPath;
}

export function isValidQualityPreset(preset) {
  return QUALITY_PRESETS.has(String(preset || "").toLowerCase());
}

export function normalizeKey(rawKey) {
  return sanitizeKey(rawKey);
}
