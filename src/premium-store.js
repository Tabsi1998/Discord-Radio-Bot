// ============================================================
// OmniFM - License Store (Seat-Based Licensing)
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PLANS } from "../config/plans.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const premiumFile = path.resolve(__dirname, "..", "premium.json");
const premiumBackupFile = premiumFile + ".bak";

const MAX_PROCESSED_ENTRIES = 5000;

// --- Internal helpers ---

function emptyStore() {
  return { licenses: {}, serverEntitlements: {}, processedSessions: {}, processedEvents: {} };
}

function readFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    if (fs.statSync(filePath).isDirectory()) return null;
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) return emptyStore();
    return JSON.parse(raw);
  } catch { return null; }
}

function load() {
  const data = readFileSafe(premiumFile) || readFileSafe(premiumBackupFile) || emptyStore();
  // Ensure all fields exist
  if (!data.licenses) data.licenses = {};
  if (!data.serverEntitlements) data.serverEntitlements = {};
  if (!data.processedSessions) data.processedSessions = {};
  if (!data.processedEvents) data.processedEvents = {};

  // Migrate old format: if a license key looks like a guild ID (17+ digits),
  // convert to new format
  for (const [key, val] of Object.entries(data.licenses)) {
    if (/^\d{17,22}$/.test(key) && val.tier && !val.seats) {
      // Old format: guildId -> license. Migrate to new format
      const licId = `legacy_${key}`;
      data.licenses[licId] = {
        id: licId,
        plan: val.tier,
        seats: 1,
        billingPeriod: "monthly",
        active: !isExpired(val),
        linkedServerIds: [key],
        createdAt: val.activatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: val.expiresAt || null,
        activatedBy: val.activatedBy || "legacy",
        note: val.note || "",
        contactEmail: val.contactEmail || "",
      };
      data.serverEntitlements[key] = { serverId: key, licenseId: licId };
      delete data.licenses[key];
    }
  }

  return data;
}

function save(data) {
  const tmpFile = `${premiumFile}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (fs.existsSync(premiumFile) && fs.statSync(premiumFile).isDirectory()) return;

    // Trim lookup maps
    for (const mapKey of ["processedSessions", "processedEvents"]) {
      const entries = Object.entries(data[mapKey] || {});
      if (entries.length > MAX_PROCESSED_ENTRIES) {
        entries.sort((a, b) => new Date(b[1]?.processedAt || 0) - new Date(a[1]?.processedAt || 0));
        data[mapKey] = Object.fromEntries(entries.slice(0, MAX_PROCESSED_ENTRIES));
      }
    }

    const payload = JSON.stringify(data, null, 2) + "\n";
    if (fs.existsSync(premiumFile)) {
      try { fs.copyFileSync(premiumFile, premiumBackupFile); } catch {}
    }
    fs.writeFileSync(tmpFile, payload, "utf-8");
    try {
      fs.renameSync(tmpFile, premiumFile);
    } catch {
      fs.writeFileSync(premiumFile, payload, "utf-8");
    }
  } catch (err) {
    console.error(`[OmniFM] License save error: ${err.message}`);
  } finally {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
  }
}

// --- License CRUD ---

function isExpired(license) {
  if (!license || !license.expiresAt) return false; // No expiry = perpetual (for now)
  return new Date(license.expiresAt) <= new Date();
}

function remainingDays(license) {
  if (!license || !license.expiresAt) return Infinity;
  const diff = new Date(license.expiresAt) - new Date();
  return Math.max(0, Math.ceil(diff / 86400000));
}

function generateLicenseId() {
  return `lic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createLicense({ plan, seats = 1, billingPeriod = "monthly", months = 1, activatedBy = "admin", note = "", contactEmail = "" }) {
  if (!PLANS[plan] || plan === "free") throw new Error("Plan must be 'pro' or 'ultimate'.");
  if (![1, 2, 3, 5].includes(seats)) throw new Error("Seats must be 1, 2, 3, or 5.");

  const data = load();
  const id = generateLicenseId();
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + months);

  data.licenses[id] = {
    id,
    plan,
    seats,
    billingPeriod,
    active: true,
    linkedServerIds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    durationMonths: months,
    activatedBy,
    note,
    contactEmail,
  };
  save(data);
  return data.licenses[id];
}

export function getLicenseById(licenseId) {
  const data = load();
  const lic = data.licenses[String(licenseId)];
  if (!lic) return null;
  return {
    ...lic,
    expired: isExpired(lic),
    remainingDays: remainingDays(lic),
    seatsUsed: (lic.linkedServerIds || []).length,
    seatsAvailable: lic.seats - (lic.linkedServerIds || []).length,
  };
}

export function linkServerToLicense(serverId, licenseId) {
  const data = load();
  const lic = data.licenses[String(licenseId)];
  if (!lic) return { ok: false, message: "License not found." };
  if (!lic.active || isExpired(lic)) return { ok: false, message: "License is not active or has expired." };

  const linked = lic.linkedServerIds || [];
  if (linked.includes(String(serverId))) return { ok: true, message: "Server already linked." };
  if (linked.length >= lic.seats) return { ok: false, message: `All ${lic.seats} seat(s) are occupied. Unlink a server first or upgrade.` };

  lic.linkedServerIds = [...linked, String(serverId)];
  lic.updatedAt = new Date().toISOString();
  data.serverEntitlements[String(serverId)] = { serverId: String(serverId), licenseId: String(licenseId) };
  save(data);
  return { ok: true };
}

export function unlinkServerFromLicense(serverId, licenseId) {
  const data = load();
  const lic = data.licenses[String(licenseId)];
  if (!lic) return { ok: false, message: "License not found." };

  lic.linkedServerIds = (lic.linkedServerIds || []).filter(id => id !== String(serverId));
  lic.updatedAt = new Date().toISOString();
  delete data.serverEntitlements[String(serverId)];
  save(data);
  return { ok: true };
}

export function getServerLicense(serverId) {
  const data = load();
  const entitlement = data.serverEntitlements[String(serverId)];
  if (!entitlement) return null;
  const lic = data.licenses[entitlement.licenseId];
  if (!lic) return null;
  if (isExpired(lic)) return { ...lic, active: false, expired: true };
  return { ...lic, expired: false, remainingDays: remainingDays(lic) };
}

export function getServerPlan(serverId) {
  const lic = getServerLicense(serverId);
  if (!lic || !lic.active || lic.expired) return "free";
  return PLANS[lic.plan] ? lic.plan : "free";
}

export function isServerLicensed(serverId) {
  return getServerPlan(serverId) !== "free";
}

export function listLicenses() {
  const data = load();
  return data.licenses;
}

export function removeLicense(licenseId) {
  const data = load();
  const lic = data.licenses[String(licenseId)];
  if (!lic) return false;
  // Unlink all servers
  for (const sid of (lic.linkedServerIds || [])) {
    delete data.serverEntitlements[sid];
  }
  delete data.licenses[String(licenseId)];
  save(data);
  return true;
}

export function extendLicense(licenseId, months) {
  const data = load();
  const lic = data.licenses[String(licenseId)];
  if (!lic) throw new Error("License not found.");
  const currentExpiry = lic.expiresAt ? new Date(lic.expiresAt) : new Date();
  const base = currentExpiry > new Date() ? currentExpiry : new Date();
  const newExpiry = new Date(base);
  newExpiry.setMonth(newExpiry.getMonth() + months);
  lic.expiresAt = newExpiry.toISOString();
  lic.updatedAt = new Date().toISOString();
  lic.active = true;
  save(data);
  return lic;
}

// --- Dedup helpers ---

export function isSessionProcessed(sessionId) {
  const data = load();
  return !!data.processedSessions[String(sessionId)];
}

export function markSessionProcessed(sessionId, meta = {}) {
  const data = load();
  data.processedSessions[String(sessionId)] = { ...meta, processedAt: new Date().toISOString() };
  save(data);
}

export function isEventProcessed(eventId) {
  const data = load();
  return !!data.processedEvents[String(eventId)];
}

export function markEventProcessed(eventId, meta = {}) {
  const data = load();
  data.processedEvents[String(eventId)] = { ...meta, processedAt: new Date().toISOString() };
  save(data);
}

// Expose for entitlements module
export { isExpired, remainingDays };
