import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const premiumFile = path.resolve(__dirname, "..", "premium.json");

const TIERS = {
  free:     { name: "Free",     bitrate: "128k", reconnectMs: 3000, maxBots: 4,  pricePerMonth: 0    },
  pro:      { name: "Pro",      bitrate: "192k", reconnectMs: 1000, maxBots: 10, pricePerMonth: 499  },
  ultimate: { name: "Ultimate", bitrate: "320k", reconnectMs: 500,  maxBots: 20, pricePerMonth: 999  },
};

// 12 Monate = nur 10 bezahlen
const YEARLY_DISCOUNT_MONTHS = 10;

function load() {
  try {
    if (!fs.existsSync(premiumFile)) return { licenses: {} };
    return JSON.parse(fs.readFileSync(premiumFile, "utf-8"));
  } catch {
    return { licenses: {} };
  }
}

function save(data) {
  fs.writeFileSync(premiumFile, JSON.stringify(data, null, 2) + "\n", "utf-8");
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

export {
  TIERS, YEARLY_DISCOUNT_MONTHS,
  load, save, getTier, getTierConfig,
  getLicense, isExpired, remainingDays,
  calculatePrice, calculateUpgradePrice,
  addLicense, upgradeLicense,
  removeLicense, listLicenses
};
