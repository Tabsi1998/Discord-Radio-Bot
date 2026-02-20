import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const premiumFile = path.resolve(__dirname, "..", "premium.json");
const premiumBackupFile = path.resolve(__dirname, "..", "premium.json.bak");

const TIERS = {
  free:     { name: "Free",     bitrate: "128k", reconnectMs: 3000, maxBots: 4,  pricePerMonth: 0    },
  pro:      { name: "Pro",      bitrate: "192k", reconnectMs: 1000, maxBots: 10, pricePerMonth: 499  },
  ultimate: { name: "Ultimate", bitrate: "320k", reconnectMs: 500,  maxBots: 20, pricePerMonth: 999  },
};

// 12 Monate = nur 10 bezahlen
const YEARLY_DISCOUNT_MONTHS = 10;
const MAX_PROCESSED_ENTRIES = 5000;

function emptyStore() {
  return { licenses: {}, processedSessions: {}, processedEvents: {} };
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function looksLikeLicense(value) {
  if (!isRecord(value)) return false;
  const tier = String(value.tier || "").toLowerCase();
  const hasTier = ["pro", "ultimate", "free"].includes(tier);
  const hasExpiry = typeof value.expiresAt === "string" && value.expiresAt.trim().length > 0;
  return hasTier || hasExpiry;
}

function extractLegacyLicenses(input) {
  if (!isRecord(input)) return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^\d{17,22}$/.test(String(key))) continue;
    if (!looksLikeLicense(value)) continue;
    out[String(key)] = value;
  }
  return out;
}

function normalizeLookupMap(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[String(key)] = {
        ...value,
        processedAt: value.processedAt || new Date().toISOString(),
      };
    } else {
      out[String(key)] = { processedAt: new Date().toISOString() };
    }
  }
  return out;
}

function trimLookupMap(mapInput) {
  const entries = Object.entries(mapInput || {});
  if (entries.length <= MAX_PROCESSED_ENTRIES) return mapInput || {};
  entries.sort((a, b) => {
    const aTs = new Date(a[1]?.processedAt || 0).getTime();
    const bTs = new Date(b[1]?.processedAt || 0).getTime();
    return bTs - aTs;
  });
  return Object.fromEntries(entries.slice(0, MAX_PROCESSED_ENTRIES));
}

function normalizeStore(input) {
  const base = emptyStore();
  if (!isRecord(input)) return base;

  const licenses =
    input.licenses && typeof input.licenses === "object" && !Array.isArray(input.licenses)
      ? input.licenses
      : extractLegacyLicenses(input);

  return {
    licenses,
    processedSessions: trimLookupMap(normalizeLookupMap(input.processedSessions)),
    processedEvents: trimLookupMap(normalizeLookupMap(input.processedEvents)),
  };
}

function readStoreFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  if (fs.statSync(filePath).isDirectory()) {
    console.warn(`[premium-store] ${filePath} ist ein Verzeichnis - ueberspringe.`);
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  if (!raw.trim()) return emptyStore();
  return normalizeStore(JSON.parse(raw));
}

function load() {
  const candidates = [premiumFile, premiumBackupFile];
  for (const filePath of candidates) {
    try {
      const store = readStoreFile(filePath);
      if (store) {
        if (filePath === premiumBackupFile) {
          console.warn("[premium-store] Verwende Backup-Datei premium.json.bak");
        }
        return store;
      }
    } catch (err) {
      console.error(`[premium-store] Load error (${filePath}): ${err.message}`);
    }
  }
  return emptyStore();
}

function save(data) {
  const tmpFile = `${premiumFile}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (fs.existsSync(premiumFile) && fs.statSync(premiumFile).isDirectory()) {
      console.warn(`[premium-store] ${premiumFile} ist ein Verzeichnis - Speichern uebersprungen.`);
      return;
    }

    const normalized = normalizeStore(data);
    const payload = JSON.stringify(normalized, null, 2) + "\n";

    if (fs.existsSync(premiumFile)) {
      try {
        fs.copyFileSync(premiumFile, premiumBackupFile);
      } catch (copyErr) {
        console.error(`[premium-store] Backup warnung: ${copyErr.message}`);
      }
    }

    fs.writeFileSync(tmpFile, payload, "utf-8");
    fs.renameSync(tmpFile, premiumFile);
  } catch (err) {
    console.error(`[premium-store] Save error: ${err.message}`);
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

function isExpired(license) {
  if (!license || !license.expiresAt) return true;
  return new Date(license.expiresAt) <= new Date();
}

function remainingDays(license) {
  if (!license || !license.expiresAt) return 0;
  const diff = new Date(license.expiresAt) - new Date();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

function getTier(guildId) {
  const data = load();
  const license = data.licenses[String(guildId)];
  if (!license) return "free";
  if (isExpired(license)) return "free";
  return TIERS[license.tier] ? license.tier : "free";
}

function getTierConfig(guildId) {
  const tier = getTier(guildId);
  return { tier, ...TIERS[tier] };
}

function getLicense(guildId) {
  const data = load();
  const lic = data.licenses[String(guildId)] || null;
  if (!lic) return null;
  return {
    ...lic,
    expired: isExpired(lic),
    remainingDays: remainingDays(lic),
    activeTier: isExpired(lic) ? "free" : lic.tier,
  };
}

// Preis berechnen (in Cent)
function calculatePrice(tier, months) {
  const config = TIERS[tier];
  if (!config || tier === "free") return 0;
  const ppm = config.pricePerMonth;
  if (months >= 12) {
    // Jahresrabatt: 12 Monate zum Preis von 10
    const fullYears = Math.floor(months / 12);
    const remainingMonths = months % 12;
    return (fullYears * YEARLY_DISCOUNT_MONTHS * ppm) + (remainingMonths * ppm);
  }
  return months * ppm;
}

// Upgrade-Preis berechnen (Pro -> Ultimate)
function calculateUpgradePrice(guildId, newTier) {
  const data = load();
  const license = data.licenses[String(guildId)];
  if (!license || isExpired(license)) return null;

  const oldTier = license.tier;
  const oldConfig = TIERS[oldTier];
  const newConfig = TIERS[newTier];
  if (!oldConfig || !newConfig) return null;
  if (newConfig.pricePerMonth <= oldConfig.pricePerMonth) return null; // Kein Downgrade

  const daysLeft = remainingDays(license);
  if (daysLeft <= 0) return null;

  // Restlicher Wert des alten Plans
  const oldDailyRate = oldConfig.pricePerMonth / 30;
  const newDailyRate = newConfig.pricePerMonth / 30;
  const upgradeCost = Math.round((newDailyRate - oldDailyRate) * daysLeft);

  return {
    oldTier,
    newTier,
    daysLeft,
    upgradeCost, // in Cent
    expiresAt: license.expiresAt,
  };
}

function addLicense(guildId, tier, months, activatedBy, note) {
  if (!TIERS[tier] || tier === "free") throw new Error("Tier muss 'pro' oder 'ultimate' sein.");
  if (!months || months < 1) throw new Error("Mindestens 1 Monat.");

  const data = load();
  const existing = data.licenses[String(guildId)];
  const now = new Date();
  const contactEmail = typeof existing?.contactEmail === "string" ? existing.contactEmail.trim() : "";

  let expiresAt;
  // Wenn bereits aktive Lizenz gleichen Tiers: Laufzeit addieren
  if (existing && !isExpired(existing) && existing.tier === tier) {
    const currentExpiry = new Date(existing.expiresAt);
    expiresAt = new Date(currentExpiry);
    expiresAt.setMonth(expiresAt.getMonth() + months);
  } else {
    expiresAt = new Date(now);
    expiresAt.setMonth(expiresAt.getMonth() + months);
  }

  data.licenses[String(guildId)] = {
    tier,
    activatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    durationMonths: months,
    activatedBy: activatedBy || "admin",
    note: note || "",
    ...(contactEmail ? { contactEmail } : {}),
    _warning7ForExpiryAt: null,
    _expiredNotifiedForExpiryAt: null,
    _expiredNotified: false,
  };
  save(data);
  return data.licenses[String(guildId)];
}

function upgradeLicense(guildId, newTier) {
  const data = load();
  const license = data.licenses[String(guildId)];
  if (!license || isExpired(license)) throw new Error("Keine aktive Lizenz zum Upgraden.");
  if (!TIERS[newTier] || newTier === "free") throw new Error("Ungültiges Tier.");

  // Behalte das gleiche Ablaufdatum, aendere nur den Tier
  data.licenses[String(guildId)] = {
    ...license,
    tier: newTier,
    upgradedAt: new Date().toISOString(),
    upgradedFrom: license.tier,
  };
  save(data);
  return data.licenses[String(guildId)];
}

function removeLicense(guildId) {
  const data = load();
  const existed = !!data.licenses[String(guildId)];
  delete data.licenses[String(guildId)];
  save(data);
  return existed;
}

function listLicenses() {
  return load().licenses;
}

function patchLicense(guildId, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return null;
  const id = String(guildId || "").trim();
  if (!id) return null;
  const data = load();
  const existing = data.licenses[id];
  if (!existing) return null;
  data.licenses[id] = { ...existing, ...patch };
  save(data);
  return data.licenses[id];
}

function isSessionProcessed(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return false;
  const data = load();
  return Boolean(data.processedSessions[id]);
}

function markSessionProcessed(sessionId, meta = {}) {
  const id = String(sessionId || "").trim();
  if (!id) return;
  const data = load();
  data.processedSessions[id] = {
    ...meta,
    processedAt: new Date().toISOString(),
  };
  save(data);
}

function isEventProcessed(eventId) {
  const id = String(eventId || "").trim();
  if (!id) return false;
  const data = load();
  return Boolean(data.processedEvents[id]);
}

function markEventProcessed(eventId, meta = {}) {
  const id = String(eventId || "").trim();
  if (!id) return;
  const data = load();
  data.processedEvents[id] = {
    ...meta,
    processedAt: new Date().toISOString(),
  };
  save(data);
}

export {
  TIERS, YEARLY_DISCOUNT_MONTHS,
  load, save, getTier, getTierConfig,
  getLicense, isExpired, remainingDays,
  calculatePrice, calculateUpgradePrice,
  addLicense, upgradeLicense,
  removeLicense, listLicenses, patchLicense,
  isSessionProcessed, markSessionProcessed,
  isEventProcessed, markEventProcessed,
};
