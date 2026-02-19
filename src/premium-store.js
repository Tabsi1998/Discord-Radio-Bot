import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const premiumFile = path.resolve(__dirname, "..", "premium.json");

const TIERS = {
  free:     { name: "Free",     bitrate: "128k", reconnectMs: 3000, maxBots: 4  },
  pro:      { name: "Pro",      bitrate: "192k", reconnectMs: 1000, maxBots: 10 },
  ultimate: { name: "Ultimate", bitrate: "320k", reconnectMs: 500,  maxBots: 20 },
};

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

function getTier(guildId) {
  const data = load();
  const license = data.licenses[String(guildId)];
  if (!license) return "free";
  return TIERS[license.tier] ? license.tier : "free";
}

function getTierConfig(guildId) {
  const tier = getTier(guildId);
  return { tier, ...TIERS[tier] };
}

function addLicense(guildId, tier, activatedBy, note) {
  if (!TIERS[tier] || tier === "free") throw new Error("Tier muss 'pro' oder 'ultimate' sein.");
  const data = load();
  data.licenses[String(guildId)] = {
    tier,
    activatedAt: new Date().toISOString(),
    activatedBy: activatedBy || "admin",
    note: note || "",
  };
  save(data);
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

function getLicense(guildId) {
  const data = load();
  return data.licenses[String(guildId)] || null;
}

export { TIERS, load, save, getTier, getTierConfig, addLicense, removeLicense, listLicenses, getLicense };
