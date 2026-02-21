import fs from "node:fs";
import path from "node:path";
import net from "node:net";
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

function isPrivateOrLocalHost(hostnameInput) {
  const hostname = String(hostnameInput || "").trim().toLowerCase().replace(/\.$/, "");
  if (!hostname) return true;
  if (hostname === "localhost" || hostname === "0.0.0.0") return true;
  if (hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.endsWith(".lan") || hostname.endsWith(".home")) {
    return true;
  }

  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) {
    const parts = hostname.split(".").map((p) => Number.parseInt(p, 10));
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
    return { ok: false, error: "URL-Format ungueltig." };
  }
  if (!/^https?:$/i.test(parsedUrl.protocol)) {
    return { ok: false, error: "URL muss mit http:// oder https:// beginnen." };
  }
  if (parsedUrl.username || parsedUrl.password) {
    return { ok: false, error: "URL mit Benutzername/Passwort sind nicht erlaubt." };
  }
  if (isPrivateOrLocalHost(parsedUrl.hostname)) {
    return { ok: false, error: "Lokale/private Hosts sind nicht erlaubt." };
  }
  return { ok: true, url: parsedUrl.toString() };
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

  const validation = validateCustomStationUrl(url);
  if (!validation.ok) return { error: validation.error };

  data[gid][sKey] = {
    name: name.trim().substring(0, 100),
    url: validation.url,
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
  validateCustomStationUrl,
  getGuildStations, addGuildStation, removeGuildStation,
  listGuildStations, countGuildStations, clearGuildStations,
};
