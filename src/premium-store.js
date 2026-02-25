// ============================================================
// OmniFM - License Store (Seat-Based Licensing) – MongoDB
// ============================================================
import { getDb } from "./lib/db.js";
import { log } from "./lib/logging.js";
import { PLANS } from "./config/plans.js";
import { getDefaultLanguage, normalizeLanguage } from "./i18n.js";

const MAX_PROCESSED_ENTRIES = 5000;
const TRIAL_RESERVATION_STALE_MS = 15 * 60 * 1000;
const PLAN_RANK = { free: 0, pro: 1, ultimate: 2 };
const VALID_SEATS = [1, 2, 3, 5];

function col(name) { const db = getDb(); return db ? db.collection(name) : null; }
function licensesCol() { return col("licenses"); }
function entitlementsCol() { return col("server_entitlements"); }
function sessionsCol() { return col("processed_sessions"); }
function eventsCol() { return col("processed_events"); }
function trialsCol() { return col("trial_claims"); }

function isExpired(license) {
  if (!license || !license.expiresAt) return false;
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

function normalizeContactEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeSeatCount(rawSeats) {
  const seats = Number(rawSeats);
  return VALID_SEATS.includes(seats) ? seats : 1;
}

function planRank(plan) {
  return PLAN_RANK[String(plan || "free").toLowerCase()] ?? 0;
}

// --- License CRUD ---

export function createLicense({
  plan, seats = 1, billingPeriod = "monthly", months = 1,
  activatedBy = "admin", note = "", contactEmail = "",
  preferredLanguage = getDefaultLanguage(),
}) {
  if (!PLANS[plan] || plan === "free") throw new Error("Plan must be 'pro' or 'ultimate'.");
  if (!VALID_SEATS.includes(seats)) throw new Error("Seats must be 1, 2, 3, or 5.");

  const c = licensesCol();
  if (!c) throw new Error("DB nicht verfuegbar.");

  const id = generateLicenseId();
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + months);

  const doc = {
    _licenseId: id, id, plan, seats, billingPeriod, active: true,
    linkedServerIds: [], createdAt: now.toISOString(), updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(), durationMonths: months,
    activatedBy, note,
    contactEmail: normalizeContactEmail(contactEmail),
    preferredLanguage: normalizeLanguage(preferredLanguage, getDefaultLanguage()),
  };
  c.insertOne(doc);
  const { _id, ...rest } = doc;
  return rest;
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

// --- In-memory cache with MongoDB persistence ---
let _cache = null;
let _cacheLoadedAt = 0;
const CACHE_TTL_MS = 5000;

function _ensureCache() {
  if (_cache && (Date.now() - _cacheLoadedAt) < CACHE_TTL_MS) return _cache;
  // Load from MongoDB synchronously is not possible with the driver.
  // We use the cache and async-load in background.
  if (!_cache) {
    _cache = { licenses: {}, serverEntitlements: {}, processedSessions: {}, processedEvents: {}, trialClaims: {} };
  }
  return _cache;
}

async function _loadFromDb() {
  const lc = licensesCol();
  const ec = entitlementsCol();
  const sc = sessionsCol();
  const evc = eventsCol();
  const tc = trialsCol();

  const cache = { licenses: {}, serverEntitlements: {}, processedSessions: {}, processedEvents: {}, trialClaims: {} };

  if (lc) {
    try {
      const docs = await lc.find({}, { projection: { _id: 0 } }).toArray();
      for (const doc of docs) {
        const id = doc._licenseId || doc.id;
        if (id) cache.licenses[id] = { ...doc, id };
      }
    } catch (err) { log("ERROR", `Licenses laden: ${err.message}`); }
  }

  if (ec) {
    try {
      const docs = await ec.find({}, { projection: { _id: 0 } }).toArray();
      for (const doc of docs) {
        const sid = doc._serverId || doc.serverId;
        if (sid) cache.serverEntitlements[sid] = { serverId: sid, licenseId: doc.licenseId || doc._licenseId || "" };
      }
    } catch (err) { log("ERROR", `Entitlements laden: ${err.message}`); }
  }

  if (sc) {
    try {
      const docs = await sc.find({}, { projection: { _id: 0 } }).toArray();
      for (const doc of docs) {
        const sid = doc._sessionId || doc.sessionId;
        if (sid) cache.processedSessions[sid] = doc;
      }
    } catch (err) { log("ERROR", `Sessions laden: ${err.message}`); }
  }

  if (evc) {
    try {
      const docs = await evc.find({}, { projection: { _id: 0 } }).toArray();
      for (const doc of docs) {
        const eid = doc._eventId || doc.eventId;
        if (eid) cache.processedEvents[eid] = doc;
      }
    } catch (err) { log("ERROR", `Events laden: ${err.message}`); }
  }

  if (tc) {
    try {
      const docs = await tc.find({}, { projection: { _id: 0 } }).toArray();
      for (const doc of docs) {
        const email = doc.email;
        if (email) cache.trialClaims[email] = doc;
      }
    } catch (err) { log("ERROR", `Trials laden: ${err.message}`); }
  }

  _cache = cache;
  _cacheLoadedAt = Date.now();
  return cache;
}

async function _saveToDb(data) {
  const lc = licensesCol();
  const ec = entitlementsCol();
  const sc = sessionsCol();
  const evc = eventsCol();
  const tc = trialsCol();

  if (lc) {
    for (const [id, lic] of Object.entries(data.licenses)) {
      try {
        await lc.replaceOne({ _licenseId: id }, { ...lic, _licenseId: id }, { upsert: true });
      } catch {}
    }
  }
  if (ec) {
    for (const [sid, ent] of Object.entries(data.serverEntitlements)) {
      try {
        await ec.replaceOne({ _serverId: sid }, { ...ent, _serverId: sid }, { upsert: true });
      } catch {}
    }
  }

  _cache = data;
  _cacheLoadedAt = Date.now();
}

// --- Synchronous API (uses cache) ---

function load() {
  return _ensureCache();
}

function save(data) {
  _cache = data;
  _cacheLoadedAt = Date.now();
  // Persist async (fire-and-forget)
  _saveToDb(data).catch((err) => log("ERROR", `Premium save: ${err.message}`));
}

// --- Initialize cache from DB ---
export async function initPremiumStore() {
  try {
    await _loadFromDb();
    log("INFO", `Premium-Store geladen: ${Object.keys(_cache.licenses).length} Lizenzen, ${Object.keys(_cache.serverEntitlements).length} Entitlements`);
  } catch (err) {
    log("WARN", `Premium-Store init: ${err.message}`);
  }
}

// --- License CRUD (sync, using cache) ---

function _getLicenseByIdSync(licenseId) {
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

// Re-export getLicenseById properly
export { _getLicenseByIdSync as getLicenseById };

export function linkServerToLicense(serverId, licenseId) {
  const sid = String(serverId);
  const lid = String(licenseId);
  const data = load();
  const lic = data.licenses[lid];
  if (!lic) return { ok: false, message: "License not found." };
  if (!lic.active || isExpired(lic)) return { ok: false, message: "License is not active or has expired." };

  const currentEntitlement = data.serverEntitlements[sid];
  const currentLicenseId = String(currentEntitlement?.licenseId || "");
  if (currentLicenseId && currentLicenseId !== lid) {
    const oldLicense = data.licenses[currentLicenseId];
    if (oldLicense) {
      oldLicense.linkedServerIds = (oldLicense.linkedServerIds || []).filter((id) => id !== sid);
      oldLicense.updatedAt = new Date().toISOString();
    }
  }

  const linked = lic.linkedServerIds || [];
  if (linked.includes(sid)) {
    data.serverEntitlements[sid] = { serverId: sid, licenseId: lid };
    save(data);
    return { ok: true, message: "Server already linked." };
  }
  if (linked.length >= lic.seats) return { ok: false, message: `All ${lic.seats} seat(s) are occupied.` };

  lic.linkedServerIds = [...linked, sid];
  lic.updatedAt = new Date().toISOString();
  data.serverEntitlements[sid] = { serverId: sid, licenseId: lid };
  save(data);
  return { ok: true };
}

export function unlinkServerFromLicense(serverId, licenseId) {
  const sid = String(serverId);
  const lid = String(licenseId);
  const data = load();
  const lic = data.licenses[lid];
  if (!lic) return { ok: false, message: "License not found." };

  lic.linkedServerIds = (lic.linkedServerIds || []).filter(id => id !== sid);
  lic.updatedAt = new Date().toISOString();
  const entitlement = data.serverEntitlements[sid];
  if (entitlement && String(entitlement.licenseId || "") === lid) {
    delete data.serverEntitlements[sid];
    // Also delete from DB
    const ec = entitlementsCol();
    if (ec) ec.deleteOne({ _serverId: sid }).catch(() => {});
  }
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
  for (const sid of (lic.linkedServerIds || [])) {
    delete data.serverEntitlements[sid];
    const ec = entitlementsCol();
    if (ec) ec.deleteOne({ _serverId: sid }).catch(() => {});
  }
  delete data.licenses[String(licenseId)];
  const lc = licensesCol();
  if (lc) lc.deleteOne({ _licenseId: String(licenseId) }).catch(() => {});
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

export function listLicensesByContactEmail(email) {
  const normalizedEmail = normalizeContactEmail(email);
  if (!normalizedEmail) return [];
  const data = load();
  return Object.values(data.licenses)
    .filter((lic) => normalizeContactEmail(lic.contactEmail) === normalizedEmail)
    .map((lic) => ({
      ...lic,
      expired: isExpired(lic),
      remainingDays: remainingDays(lic),
      seatsUsed: (lic.linkedServerIds || []).length,
      seatsAvailable: Number(lic.seats || 0) - (lic.linkedServerIds || []).length,
    }))
    .sort((a, b) => {
      const aExpiry = Date.parse(a.expiresAt || "");
      const bExpiry = Date.parse(b.expiresAt || "");
      return (Number.isFinite(bExpiry) ? bExpiry : 0) - (Number.isFinite(aExpiry) ? aExpiry : 0);
    });
}

export function createOrExtendLicenseForEmail({
  plan, seats = 1, billingPeriod = "monthly", months = 1,
  activatedBy = "admin", note = "", contactEmail = "",
  preferredLanguage = getDefaultLanguage(),
}) {
  if (!PLANS[plan] || plan === "free") throw new Error("Plan must be 'pro' or 'ultimate'.");
  const normalizedEmail = normalizeContactEmail(contactEmail);
  if (!normalizedEmail) throw new Error("contactEmail is required.");

  const normalizedSeats = normalizeSeatCount(seats);
  const normalizedMonths = Math.max(1, Number.parseInt(String(months), 10) || 1);
  const targetPlanRank = planRank(plan);
  const data = load();

  let candidate = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const lic of Object.values(data.licenses)) {
    if (normalizeContactEmail(lic.contactEmail) !== normalizedEmail) continue;
    if (planRank(lic.plan) > targetPlanRank) continue;
    let score = 0;
    if (String(lic.plan || "") === plan) score += 1_000;
    if (!isExpired(lic)) score += 500;
    score += Math.min((lic.linkedServerIds || []).length, 50);
    const expiryMs = Date.parse(lic.expiresAt || "");
    if (Number.isFinite(expiryMs)) score += expiryMs / 1e12;
    if (!candidate || score > bestScore) { candidate = lic; bestScore = score; }
  }

  if (!candidate) {
    const created = createLicense({ plan, seats: normalizedSeats, billingPeriod, months: normalizedMonths, activatedBy, note, contactEmail: normalizedEmail, preferredLanguage });
    const withMeta = _getLicenseByIdSync(created.id) || created;
    return { license: withMeta, created: true, extended: false, upgraded: false, previousPlan: null, previousExpiresAt: null };
  }

  const previousPlan = String(candidate.plan || "free");
  const previousExpiresAt = candidate.expiresAt || null;
  const wasExpired = isExpired(candidate);
  const linkedCount = (candidate.linkedServerIds || []).length;
  const now = new Date();
  const currentExpiry = candidate.expiresAt ? new Date(candidate.expiresAt) : now;
  const base = currentExpiry > now ? currentExpiry : now;
  const newExpiry = new Date(base);
  newExpiry.setMonth(newExpiry.getMonth() + normalizedMonths);

  candidate.plan = planRank(plan) >= planRank(candidate.plan) ? plan : candidate.plan;
  candidate.seats = Math.max(normalizedSeats, linkedCount);
  candidate.billingPeriod = billingPeriod;
  candidate.expiresAt = newExpiry.toISOString();
  candidate.durationMonths = Math.max(1, Number(candidate.durationMonths || 1)) + normalizedMonths;
  candidate.active = true;
  candidate.updatedAt = now.toISOString();
  candidate.activatedBy = activatedBy || candidate.activatedBy || "admin";
  candidate.contactEmail = normalizedEmail;
  candidate.preferredLanguage = normalizeLanguage(preferredLanguage, getDefaultLanguage());
  if (String(note || "").trim()) {
    candidate.note = String(candidate.note || "").trim() ? `${candidate.note} | ${note}` : note;
  }

  save(data);
  const withMeta = getLicenseById(candidate.id) || candidate;
  return { license: withMeta, created: false, extended: true, upgraded: planRank(previousPlan) < planRank(withMeta.plan), previousPlan, previousExpiresAt, wasExpired };
}

// --- Dedup helpers ---

export function isSessionProcessed(sessionId) {
  const data = load();
  return !!data.processedSessions[String(sessionId)];
}

export function markSessionProcessed(sessionId, meta = {}) {
  const data = load();
  const sid = String(sessionId);
  data.processedSessions[sid] = { ...meta, processedAt: new Date().toISOString() };
  save(data);
  const sc = sessionsCol();
  if (sc) sc.replaceOne({ _sessionId: sid }, { ...data.processedSessions[sid], _sessionId: sid }, { upsert: true }).catch(() => {});
}

export function isEventProcessed(eventId) {
  const data = load();
  return !!data.processedEvents[String(eventId)];
}

export function markEventProcessed(eventId, meta = {}) {
  const data = load();
  const eid = String(eventId);
  data.processedEvents[eid] = { ...meta, processedAt: new Date().toISOString() };
  save(data);
  const evc = eventsCol();
  if (evc) evc.replaceOne({ _eventId: eid }, { ...data.processedEvents[eid], _eventId: eid }, { upsert: true }).catch(() => {});
}

// --- Trial claim helpers ---

export function getTrialClaimByEmail(email) {
  const normalizedEmail = normalizeContactEmail(email);
  if (!normalizedEmail) return null;
  const data = load();
  return data.trialClaims[normalizedEmail] || null;
}

export function reserveTrialClaim(email, meta = {}) {
  const normalizedEmail = normalizeContactEmail(email);
  if (!normalizedEmail) return { ok: false, message: "email is required" };
  const data = load();
  const existing = data.trialClaims[normalizedEmail];
  if (existing) {
    const existingCreatedAtMs = Date.parse(existing.createdAt || "");
    const isStale = existing.status === "reserved" && !existing.licenseId && Number.isFinite(existingCreatedAtMs) && (Date.now() - existingCreatedAtMs) > TRIAL_RESERVATION_STALE_MS;
    if (!isStale) return { ok: false, message: "trial already claimed", claim: existing };
  }

  data.trialClaims[normalizedEmail] = { email: normalizedEmail, status: "reserved", createdAt: new Date().toISOString(), ...meta };
  save(data);
  const tc = trialsCol();
  if (tc) tc.replaceOne({ email: normalizedEmail }, data.trialClaims[normalizedEmail], { upsert: true }).catch(() => {});
  return { ok: true, claim: data.trialClaims[normalizedEmail] };
}

export function finalizeTrialClaim(email, patch = {}) {
  const normalizedEmail = normalizeContactEmail(email);
  if (!normalizedEmail) return null;
  const data = load();
  const existing = data.trialClaims[normalizedEmail];
  if (!existing) return null;
  data.trialClaims[normalizedEmail] = { ...existing, ...patch, email: normalizedEmail, status: "claimed", claimedAt: new Date().toISOString() };
  save(data);
  const tc = trialsCol();
  if (tc) tc.replaceOne({ email: normalizedEmail }, data.trialClaims[normalizedEmail], { upsert: true }).catch(() => {});
  return data.trialClaims[normalizedEmail];
}

export function releaseTrialClaim(email) {
  const normalizedEmail = normalizeContactEmail(email);
  if (!normalizedEmail) return false;
  const data = load();
  if (!data.trialClaims[normalizedEmail]) return false;
  delete data.trialClaims[normalizedEmail];
  save(data);
  const tc = trialsCol();
  if (tc) tc.deleteOne({ email: normalizedEmail }).catch(() => {});
  return true;
}

// --- Server-level convenience functions ---

export function addLicenseForServer(serverId, plan, months = 1, activatedBy = "admin", note = "") {
  const license = createLicense({ plan, seats: 1, billingPeriod: months >= 12 ? "yearly" : "monthly", months, activatedBy, note });
  const link = linkServerToLicense(serverId, license.id);
  if (!link.ok) throw new Error(link.message);
  return license;
}

export function patchLicenseForServer(serverId, patch) {
  const data = load();
  const entitlement = data.serverEntitlements[String(serverId)];
  if (!entitlement) return null;
  const lic = data.licenses[entitlement.licenseId];
  if (!lic) return null;
  Object.assign(lic, patch);
  lic.updatedAt = new Date().toISOString();
  save(data);
  return lic;
}

export function patchLicenseById(licenseId, patch) {
  const lid = String(licenseId || "");
  if (!lid) return null;
  const data = load();
  const lic = data.licenses[lid];
  if (!lic) return null;
  Object.assign(lic, patch);
  lic.updatedAt = new Date().toISOString();
  save(data);
  return lic;
}

export function upgradeLicenseForServer(serverId, newPlan) {
  const data = load();
  const entitlement = data.serverEntitlements[String(serverId)];
  if (!entitlement) throw new Error("No active license for this server.");
  const lic = data.licenses[entitlement.licenseId];
  if (!lic) throw new Error("License not found.");
  lic.plan = newPlan;
  lic.updatedAt = new Date().toISOString();
  lic.active = true;
  save(data);
  return lic;
}

export { isExpired, remainingDays };
