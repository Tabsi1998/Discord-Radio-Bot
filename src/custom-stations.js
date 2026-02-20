import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CUSTOM_FILE = path.resolve(__dirname, "..", "custom-stations.json");
const CUSTOM_BACKUP_FILE = path.resolve(__dirname, "..", "custom-stations.json.bak");
const MAX_STATIONS_PER_GUILD = 50;

function readStationsFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  if (fs.statSync(filePath).isDirectory()) {
    console.warn(`[custom-stations] ${filePath} ist ein Verzeichnis - ueberspringe.`);
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
          console.warn("[custom-stations] Verwende Backup-Datei custom-stations.json.bak");
        }
        return data;
      }
    } catch (err) {
      console.error(`[custom-stations] Load error (${filePath}): ${err.message}`);
    }
  }
  return {};
}

function save(data) {
  const tmpFile = `${CUSTOM_FILE}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (fs.existsSync(CUSTOM_FILE) && fs.statSync(CUSTOM_FILE).isDirectory()) {
      console.warn(`[custom-stations] ${CUSTOM_FILE} ist ein Verzeichnis - Speichern uebersprungen.`);
      return;
    }

    if (fs.existsSync(CUSTOM_FILE)) {
      try {
        fs.copyFileSync(CUSTOM_FILE, CUSTOM_BACKUP_FILE);
      } catch (copyErr) {
        console.error(`[custom-stations] Backup warnung: ${copyErr.message}`);
      }
    }

    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2) + "\n", "utf8");
    try {
      fs.renameSync(tmpFile, CUSTOM_FILE);
    } catch (renameErr) {
      const code = String(renameErr?.code || "");
      if (["EBUSY", "EPERM", "EACCES", "EXDEV"].includes(code)) {
        fs.writeFileSync(CUSTOM_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
        console.warn(`[custom-stations] Atomic rename nicht moeglich (${code}), nutze direkten Write-Fallback.`);
      } else {
        throw renameErr;
      }
    }
  } catch (err) {
    console.error(`[custom-stations] Save error: ${err.message}`);
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
