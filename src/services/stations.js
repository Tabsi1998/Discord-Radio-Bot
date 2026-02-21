// ============================================================
// OmniFM - Station Service
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLANS, PLAN_ORDER } from "../config/plans.js";
import { getServerPlan, planAtLeast, requireFeature } from "../core/entitlements.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "..", "data");
const customFile = path.resolve(__dirname, "..", "..", "custom-stations.json");

const MAX_CUSTOM_PER_SERVER = 50;

let _freeStations = [];
let _proStations = [];

function loadJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    if (fs.statSync(filePath).isDirectory()) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { return []; }
}

export function loadAllStations() {
  _freeStations = loadJsonSafe(path.join(dataDir, "stations.free.json"));
  _proStations = loadJsonSafe(path.join(dataDir, "stations.pro.json"));
  return { free: _freeStations.length, pro: _proStations.length };
}

// Initialize on first import
loadAllStations();

export function getAllFreeStations() { return _freeStations; }
export function getAllProStations() { return _proStations; }

export function getStationsForServer(serverId) {
  const plan = getServerPlan(serverId);
  let stations = [..._freeStations];

  if (planAtLeast(plan, "pro")) {
    stations = [...stations, ..._proStations];
  }

  if (planAtLeast(plan, "ultimate")) {
    const custom = getCustomStations(serverId);
    stations = [...stations, ...custom];
  }

  return stations;
}

export function getStationById(serverId, stationId) {
  const visible = getStationsForServer(serverId);
  return visible.find(s => s.id === stationId) || null;
}

export function findStation(serverId, query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return null;
  const visible = getStationsForServer(serverId);
  return visible.find(s => s.id === q || s.name.toLowerCase() === q) ||
         visible.find(s => s.id.includes(q) || s.name.toLowerCase().includes(q)) ||
         null;
}

export function isStationAccessible(serverId, stationId) {
  const plan = getServerPlan(serverId);

  // Check free stations
  if (_freeStations.some(s => s.id === stationId)) return { ok: true };

  // Check pro stations
  if (_proStations.some(s => s.id === stationId)) {
    if (planAtLeast(plan, "pro")) return { ok: true };
    const station = _proStations.find(s => s.id === stationId);
    return { ok: false, station, requiredPlan: "pro" };
  }

  // Check custom stations
  const custom = getCustomStations(serverId);
  if (custom.some(s => s.id === stationId)) {
    if (planAtLeast(plan, "ultimate")) return { ok: true };
    return { ok: false, requiredPlan: "ultimate" };
  }

  return { ok: false, notFound: true };
}

// --- Custom Stations (Ultimate only) ---

function loadCustomData() {
  try {
    if (!fs.existsSync(customFile)) return {};
    if (fs.statSync(customFile).isDirectory()) return {};
    const raw = fs.readFileSync(customFile, "utf-8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

function saveCustomData(data) {
  try {
    if (fs.existsSync(customFile) && fs.statSync(customFile).isDirectory()) return;
    fs.writeFileSync(customFile, JSON.stringify(data, null, 2) + "\n", "utf-8");
  } catch (err) {
    console.error(`[OmniFM] Custom stations save error: ${err.message}`);
  }
}

export function getCustomStations(serverId) {
  const data = loadCustomData();
  const arr = data[String(serverId)];
  if (!Array.isArray(arr)) return [];
  return arr.map(s => ({
    ...s,
    requiredPlan: "ultimate",
    tags: s.tags || ["custom"],
  }));
}

export function addCustomStation(serverId, stationData) {
  const check = requireFeature(String(serverId), "customStationURLs");
  if (!check.ok) return { ok: false, message: check.message };

  const id = String(stationData.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").substring(0, 40);
  const name = String(stationData.name || "").trim().substring(0, 100);
  const url = String(stationData.streamURL || stationData.url || "").trim();

  if (!id || !name || !url) return { ok: false, message: "id, name, and streamURL are required." };
  const urlCheck = validateStreamURL(url);
  if (!urlCheck.ok) return urlCheck;

  const data = loadCustomData();
  const arr = data[String(serverId)] || [];

  if (arr.length >= MAX_CUSTOM_PER_SERVER) {
    return { ok: false, message: `Maximum ${MAX_CUSTOM_PER_SERVER} custom stations per server.` };
  }
  if (arr.some(s => s.id === id)) {
    return { ok: false, message: `Station "${id}" already exists. Remove it first.` };
  }

  arr.push({ id, name, streamURL: url, bitrate: 0, tags: ["custom"], requiredPlan: "ultimate" });
  data[String(serverId)] = arr;
  saveCustomData(data);
  return { ok: true, station: arr[arr.length - 1] };
}

export function removeCustomStation(serverId, stationId) {
  const check = requireFeature(String(serverId), "customStationURLs");
  if (!check.ok) return { ok: false, message: check.message };

  const data = loadCustomData();
  const arr = data[String(serverId)] || [];
  const idx = arr.findIndex(s => s.id === stationId);
  if (idx === -1) return { ok: false, message: `Station "${stationId}" not found.` };

  arr.splice(idx, 1);
  data[String(serverId)] = arr;
  saveCustomData(data);
  return { ok: true };
}

export function validateStreamURL(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, message: "Only http/https URLs are allowed." };
    }
    if (parsed.hostname === "localhost" || parsed.hostname.startsWith("127.") || parsed.hostname === "0.0.0.0") {
      return { ok: false, message: "Local URLs are not allowed." };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Invalid URL format." };
  }
}

export function getStationCounts() {
  return { free: _freeStations.length, pro: _proStations.length };
}
