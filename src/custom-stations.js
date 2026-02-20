import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUSTOM_FILE = path.resolve(__dirname, "..", "custom-stations.json");
const MAX_STATIONS_PER_GUILD = 50;

function load() {
  try {
    if (fs.existsSync(CUSTOM_FILE) && !fs.statSync(CUSTOM_FILE).isDirectory()) {
      const raw = fs.readFileSync(CUSTOM_FILE, "utf8");
      if (raw.trim()) return JSON.parse(raw);
    }
  } catch (err) {
    console.error(`[custom-stations] Load error: ${err.message}`);
  }
  return {};
}

function save(data) {
  try {
    if (fs.existsSync(CUSTOM_FILE) && fs.statSync(CUSTOM_FILE).isDirectory()) {
      console.warn(`[custom-stations] ${CUSTOM_FILE} ist ein Verzeichnis - Speichern uebersprungen.`);
      return;
    }
    fs.writeFileSync(CUSTOM_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
  } catch (err) {
    console.error(`[custom-stations] Save error: ${err.message}`);
  }
}

function sanitizeKey(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").substring(0, 40);
}

function getGuildStations(guildId) {
  const data = load();
  return data[String(guildId)] || {};
}

function addGuildStation(guildId, key, name, url) {
  const data = load();
  const gid = String(guildId);
  if (!data[gid]) data[gid] = {};

  const existing = Object.keys(data[gid]).length;
  if (existing >= MAX_STATIONS_PER_GUILD) {
    return { error: `Maximum ${MAX_STATIONS_PER_GUILD} Custom-Stationen erreicht.` };
  }

  const sKey = sanitizeKey(key);
  if (!sKey) return { error: "Ungueltiger Station-Key." };
  if (!name || !name.trim()) return { error: "Name darf nicht leer sein." };
  if (!url || !url.trim()) return { error: "URL darf nicht leer sein." };
  if (!/^https?:\/\//i.test(url)) return { error: "URL muss mit http:// oder https:// beginnen." };

  data[gid][sKey] = {
    name: name.trim().substring(0, 100),
    url: url.trim(),
    addedAt: new Date().toISOString(),
  };
  save(data);
  return { success: true, key: sKey, station: data[gid][sKey] };
}

function removeGuildStation(guildId, key) {
  const data = load();
  const gid = String(guildId);
  if (!data[gid] || !data[gid][key]) return false;
  delete data[gid][key];
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

export {
  MAX_STATIONS_PER_GUILD,
  getGuildStations, addGuildStation, removeGuildStation,
  listGuildStations, countGuildStations, clearGuildStations,
};
