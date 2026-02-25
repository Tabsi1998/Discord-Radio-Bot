// ============================================================================
// coupon-store.js – MongoDB-basiert (migriert von JSON-Datei)
// ============================================================================
import { getDb } from "./lib/db.js";
import { log } from "./lib/logging.js";

const OFFERS_COL = "coupon_offers";
const REDEMPTIONS_COL = "coupon_redemptions";
const OFFER_KINDS = new Set(["coupon", "referral"]);
const VALID_TIERS = new Set(["pro", "ultimate"]);
const VALID_SEATS = new Set([1, 2, 3, 5]);
const MAX_REDEMPTIONS = 50_000;

function offersCol() { const db = getDb(); return db ? db.collection(OFFERS_COL) : null; }
function redemptionsCol() { const db = getDb(); return db ? db.collection(REDEMPTIONS_COL) : null; }

function normalizeCode(rawCode) {
  const cleaned = String(rawCode || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "").slice(0, 40);
  return cleaned || null;
}

function clipText(value, maxLen = 200) {
  const text = String(value || "").trim();
  return text.slice(0, maxLen);
}

function normalizePositiveInt(rawValue, fallback = null) {
  const num = Number.parseInt(String(rawValue), 10);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return num;
}

function normalizeIsoDate(rawValue) {
  if (!rawValue) return null;
  const parsed = new Date(String(rawValue));
  const ms = parsed.getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function normalizeOffer(rawOffer, existing = null) {
  const source = rawOffer && typeof rawOffer === "object" ? rawOffer : {};
  const fallbackCode = normalizeCode(existing?.code);
  const code = normalizeCode(source.code) || fallbackCode;
  if (!code) throw new Error("Offer code is required.");

  const kindRaw = String(source.kind || existing?.kind || "coupon").trim().toLowerCase();
  const kind = OFFER_KINDS.has(kindRaw) ? kindRaw : "coupon";

  const hasPercentInput = source.percentOff !== undefined || source.percent_off !== undefined;
  const hasAmountInput = source.amountOffCents !== undefined || source.amount_off_cents !== undefined;
  const percentCandidate = Number(hasPercentInput ? (source.percentOff ?? source.percent_off) : (existing?.percentOff ?? 0));
  const amountCandidate = Number(hasAmountInput ? (source.amountOffCents ?? source.amount_off_cents) : (existing?.amountOffCents ?? 0));

  const percentOff = Number.isFinite(percentCandidate) && percentCandidate > 0 ? Math.min(95, Math.round(percentCandidate)) : 0;
  const amountOffCents = Number.isFinite(amountCandidate) && amountCandidate > 0 ? Math.min(2_000_000, Math.round(amountCandidate)) : 0;
  if (percentOff <= 0 && amountOffCents <= 0) throw new Error("Offer needs either percentOff or amountOffCents.");

  const allowedTiersRaw = Array.isArray(source.allowedTiers) ? source.allowedTiers : Array.isArray(source.allowed_tiers) ? source.allowed_tiers : Array.isArray(existing?.allowedTiers) ? existing.allowedTiers : [];
  const allowedTiers = [...new Set(allowedTiersRaw.map((e) => String(e || "").trim().toLowerCase()).filter((e) => VALID_TIERS.has(e)))];

  const allowedSeatsRaw = Array.isArray(source.allowedSeats) ? source.allowedSeats : Array.isArray(source.allowed_seats) ? source.allowed_seats : Array.isArray(existing?.allowedSeats) ? existing.allowedSeats : [];
  const allowedSeats = [...new Set(allowedSeatsRaw.map((e) => Number.parseInt(String(e), 10)).filter((e) => VALID_SEATS.has(e)))];

  const maxRedemptions = normalizePositiveInt(source.maxRedemptions ?? source.max_redemptions ?? existing?.maxRedemptions, null);
  const maxPerEmail = normalizePositiveInt(source.maxPerEmail ?? source.max_per_email ?? existing?.maxPerEmail, null);
  const minMonths = normalizePositiveInt(source.minMonths ?? source.min_months ?? existing?.minMonths, null);
  const startsAt = normalizeIsoDate(source.startsAt ?? source.starts_at ?? existing?.startsAt);
  const expiresAt = normalizeIsoDate(source.expiresAt ?? source.expires_at ?? existing?.expiresAt);
  if (startsAt && expiresAt && Date.parse(startsAt) > Date.parse(expiresAt)) throw new Error("startsAt must be before expiresAt.");

  const nowIso = new Date().toISOString();
  const updatedBy = clipText(source.updatedBy ?? source.updated_by ?? "", 120);
  const createdBy = clipText(source.createdBy ?? source.created_by ?? existing?.createdBy ?? updatedBy, 120);
  const active = source.active === undefined ? (existing?.active ?? true) : Boolean(source.active);

  return {
    code, kind, active, percentOff, amountOffCents, maxRedemptions, maxPerEmail, minMonths,
    allowedTiers, allowedSeats, startsAt, expiresAt,
    ownerLabel: clipText(source.ownerLabel ?? source.owner_label ?? existing?.ownerLabel ?? "", 160) || null,
    note: clipText(source.note ?? existing?.note ?? "", 400) || null,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    createdBy: createdBy || null,
    updatedBy: updatedBy || null,
  };
}

function sanitizeOfferPublic(offer) {
  if (!offer) return null;
  return {
    code: offer.code, kind: offer.kind, active: Boolean(offer.active),
    percentOff: Number(offer.percentOff || 0), amountOffCents: Number(offer.amountOffCents || 0),
    maxRedemptions: Number.isFinite(Number(offer.maxRedemptions)) ? Number(offer.maxRedemptions) : null,
    maxPerEmail: Number.isFinite(Number(offer.maxPerEmail)) ? Number(offer.maxPerEmail) : null,
    minMonths: Number.isFinite(Number(offer.minMonths)) ? Number(offer.minMonths) : null,
    allowedTiers: Array.isArray(offer.allowedTiers) ? [...offer.allowedTiers] : [],
    allowedSeats: Array.isArray(offer.allowedSeats) ? [...offer.allowedSeats] : [],
    startsAt: offer.startsAt || null, expiresAt: offer.expiresAt || null,
    ownerLabel: offer.ownerLabel || null,
  };
}

function sanitizeOfferAdmin(offer, redemptionStats = null) {
  if (!offer) return null;
  return {
    ...sanitizeOfferPublic(offer),
    note: offer.note || null, createdAt: offer.createdAt || null, updatedAt: offer.updatedAt || null,
    createdBy: offer.createdBy || null, updatedBy: offer.updatedBy || null,
    redemptions: redemptionStats || null,
  };
}

async function countRedemptionsForOffer(code) {
  const c = redemptionsCol();
  if (!c) return 0;
  try { return await c.countDocuments({ code }); } catch { return 0; }
}

async function countRedemptionsForOfferAndEmail(code, email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return 0;
  const c = redemptionsCol();
  if (!c) return 0;
  try { return await c.countDocuments({ code, email: normalizedEmail }); } catch { return 0; }
}

async function evaluateSingleOffer(rawCode, context = {}, expectedKind = null) {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: "code_missing", code: null, offer: null };
  const c = offersCol();
  if (!c) return { ok: false, reason: "db_unavailable", code, offer: null };

  let offer;
  try { offer = await c.findOne({ code }, { projection: { _id: 0 } }); } catch { return { ok: false, reason: "db_error", code, offer: null }; }
  if (!offer) return { ok: false, reason: "offer_not_found", code, offer: null };
  if (expectedKind && offer.kind !== expectedKind) return { ok: false, reason: "offer_kind_mismatch", code, offer };
  if (!offer.active) return { ok: false, reason: "offer_inactive", code, offer };

  const nowMs = Number.isFinite(context.nowMs) ? context.nowMs : Date.now();
  const startsAtMs = offer.startsAt ? Date.parse(offer.startsAt) : NaN;
  const expiresAtMs = offer.expiresAt ? Date.parse(offer.expiresAt) : NaN;
  if (Number.isFinite(startsAtMs) && nowMs < startsAtMs) return { ok: false, reason: "offer_not_started", code, offer };
  if (Number.isFinite(expiresAtMs) && nowMs > expiresAtMs) return { ok: false, reason: "offer_expired", code, offer };

  const tier = String(context.tier || "").trim().toLowerCase();
  if (offer.allowedTiers?.length && !offer.allowedTiers.includes(tier)) return { ok: false, reason: "offer_tier_mismatch", code, offer };
  const seats = Number(context.seats);
  if (offer.allowedSeats?.length && !offer.allowedSeats.includes(seats)) return { ok: false, reason: "offer_seat_mismatch", code, offer };
  const months = Number(context.months);
  if (Number.isFinite(offer.minMonths) && offer.minMonths > 0 && months < offer.minMonths) return { ok: false, reason: "offer_months_mismatch", code, offer };

  if (Number.isFinite(offer.maxRedemptions) && offer.maxRedemptions > 0) {
    const count = await countRedemptionsForOffer(code);
    if (count >= offer.maxRedemptions) return { ok: false, reason: "offer_maxed_out", code, offer };
  }
  const email = String(context.email || "").trim().toLowerCase();
  if (email && Number.isFinite(offer.maxPerEmail) && offer.maxPerEmail > 0) {
    const perEmailCount = await countRedemptionsForOfferAndEmail(code, email);
    if (perEmailCount >= offer.maxPerEmail) return { ok: false, reason: "offer_email_limit_reached", code, offer };
  }

  const baseAmountCents = Math.max(0, Number.parseInt(String(context.baseAmountCents || 0), 10) || 0);
  if (baseAmountCents <= 0) return { ok: false, reason: "invalid_base_amount", code, offer };

  let discountCents = 0;
  if (offer.percentOff > 0) discountCents = Math.round((baseAmountCents * offer.percentOff) / 100);
  else if (offer.amountOffCents > 0) discountCents = offer.amountOffCents;
  discountCents = Math.max(0, Math.min(baseAmountCents, discountCents));
  if (discountCents <= 0) return { ok: false, reason: "invalid_discount", code, offer };

  return { ok: true, code, offer, discountCents, percentOff: offer.percentOff || 0, amountOffCents: offer.amountOffCents || 0 };
}

function capDiscountForStripeMinimum(baseAmountCents, discountCents) {
  const base = Math.max(0, Number.parseInt(String(baseAmountCents || 0), 10) || 0);
  const discount = Math.max(0, Number.parseInt(String(discountCents || 0), 10) || 0);
  if (base <= 0) return 0;
  const minChargeCents = 50;
  return Math.max(0, Math.min(discount, Math.max(0, base - minChargeCents)));
}

export function normalizeOfferCode(rawCode) { return normalizeCode(rawCode); }

export async function getOffer(code) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return null;
  const c = offersCol();
  if (!c) return null;
  try {
    const offer = await c.findOne({ code: normalizedCode }, { projection: { _id: 0 } });
    return offer ? sanitizeOfferPublic(offer) : null;
  } catch { return null; }
}

export async function listOffers(options = {}) {
  const includeInactive = options.includeInactive !== false;
  const includeStats = options.includeStats === true;
  const c = offersCol();
  if (!c) return [];
  try {
    const filter = includeInactive ? {} : { active: true };
    const docs = await c.find(filter, { projection: { _id: 0 } }).sort({ code: 1 }).toArray();
    const list = [];
    for (const offer of docs) {
      let stats = null;
      if (includeStats) stats = { total: await countRedemptionsForOffer(offer.code) };
      list.push(sanitizeOfferAdmin(offer, stats));
    }
    return list;
  } catch { return []; }
}

export async function upsertOffer(input, options = {}) {
  const c = offersCol();
  if (!c) throw new Error("DB nicht verfuegbar.");
  const rawCode = normalizeCode(input?.code);
  if (!rawCode) throw new Error("code is required.");

  let existing = null;
  try { existing = await c.findOne({ code: rawCode }, { projection: { _id: 0 } }); } catch {}
  const mergedInput = options.partial && existing ? { ...existing, ...input, code: rawCode } : { ...input, code: rawCode };
  const normalized = normalizeOffer(mergedInput, existing);

  await c.updateOne({ code: rawCode }, { $set: normalized }, { upsert: true });
  const totalRedemptions = await countRedemptionsForOffer(rawCode);
  return sanitizeOfferAdmin(normalized, { total: totalRedemptions });
}

export async function setOfferActive(code, active) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return null;
  const c = offersCol();
  if (!c) return null;
  try {
    const result = await c.findOneAndUpdate(
      { code: normalizedCode },
      { $set: { active: Boolean(active), updatedAt: new Date().toISOString() } },
      { returnDocument: "after", projection: { _id: 0 } }
    );
    if (!result) return null;
    const total = await countRedemptionsForOffer(normalizedCode);
    return sanitizeOfferAdmin(result, { total });
  } catch { return null; }
}

export async function deleteOffer(code) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return false;
  const c = offersCol();
  if (!c) return false;
  try {
    const result = await c.deleteOne({ code: normalizedCode });
    return result.deletedCount > 0;
  } catch { return false; }
}

export async function previewCheckoutOffer(context = {}) {
  const baseAmountCents = Math.max(0, Number.parseInt(String(context.baseAmountCents || 0), 10) || 0);
  const checkoutContext = {
    baseAmountCents, tier: String(context.tier || "").trim().toLowerCase(),
    seats: Number(context.seats), months: Number(context.months),
    email: String(context.email || "").trim().toLowerCase(),
    nowMs: Number.isFinite(context.nowMs) ? Number(context.nowMs) : Date.now(),
  };

  const couponResult = await evaluateSingleOffer(context.couponCode, checkoutContext, "coupon");
  const referralResult = await evaluateSingleOffer(context.referralCode, checkoutContext, "referral");

  let applied = null;
  if (couponResult.ok) applied = { ...couponResult, kind: "coupon" };
  else if (referralResult.ok) applied = { ...referralResult, kind: "referral" };

  let discountCents = applied?.discountCents || 0;
  discountCents = capDiscountForStripeMinimum(baseAmountCents, discountCents);
  const finalAmountCents = Math.max(0, baseAmountCents - discountCents);

  return {
    baseAmountCents, finalAmountCents, discountCents,
    applied: applied ? { code: applied.code, kind: applied.kind, percentOff: applied.percentOff || 0, amountOffCents: applied.amountOffCents || 0, ownerLabel: applied.offer?.ownerLabel || null } : null,
    coupon: { code: couponResult.code, ok: couponResult.ok, reason: couponResult.ok ? null : couponResult.reason },
    referral: { code: referralResult.code, ok: referralResult.ok, reason: referralResult.ok ? null : referralResult.reason, ownerLabel: referralResult.offer?.ownerLabel || null },
    attributionReferralCode: referralResult.ok ? referralResult.code : null,
  };
}

export async function getRedemptionBySession(sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid) return null;
  const c = redemptionsCol();
  if (!c) return null;
  try {
    const doc = await c.findOne({ sessionId: sid }, { projection: { _id: 0 } });
    return doc || null;
  } catch { return null; }
}

export async function markOfferRedemption(sessionId, payload = {}) {
  const sid = String(sessionId || "").trim();
  if (!sid) return null;
  const c = redemptionsCol();
  if (!c) return null;
  try {
    const existing = await c.findOne({ sessionId: sid }, { projection: { _id: 0 } });
    if (existing) return existing;
    const doc = {
      sessionId: sid,
      source: clipText(payload.source, 80) || null,
      email: clipText(payload.email, 200).toLowerCase() || null,
      code: normalizeCode(payload.code),
      kind: OFFER_KINDS.has(String(payload.kind || "").toLowerCase()) ? String(payload.kind).toLowerCase() : null,
      referralCode: normalizeCode(payload.referralCode),
      tier: VALID_TIERS.has(String(payload.tier || "").toLowerCase()) ? String(payload.tier).toLowerCase() : null,
      seats: VALID_SEATS.has(Number(payload.seats)) ? Number(payload.seats) : null,
      months: normalizePositiveInt(payload.months, null),
      baseAmountCents: Math.max(0, Number.parseInt(String(payload.baseAmountCents || 0), 10) || 0),
      discountCents: Math.max(0, Number.parseInt(String(payload.discountCents || 0), 10) || 0),
      finalAmountCents: Math.max(0, Number.parseInt(String(payload.finalAmountCents || 0), 10) || 0),
      processedAt: new Date().toISOString(),
    };
    await c.insertOne(doc);
    const { _id, ...rest } = doc;
    return rest;
  } catch { return null; }
}

export async function listRecentRedemptions(limit = 100) {
  const max = Math.max(1, Math.min(500, Number.parseInt(String(limit), 10) || 100));
  const c = redemptionsCol();
  if (!c) return [];
  try {
    return await c.find({}, { projection: { _id: 0 } }).sort({ processedAt: -1 }).limit(max).toArray();
  } catch { return []; }
}
