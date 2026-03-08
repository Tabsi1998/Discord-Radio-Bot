function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeWeeklyDigestLanguage(value, fallback = "de") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return normalized === "en" ? "en" : "de";
}

function normalizeWeeklyDigestConfig(input = {}, fallbackLanguage = "de") {
  const source = input && typeof input === "object" ? input : {};
  return {
    enabled: source.enabled === true,
    channelId: String(source.channelId || "").trim(),
    dayOfWeek: clampInt(source.dayOfWeek, 0, 6, 1),
    hour: clampInt(source.hour, 0, 23, 9),
    language: normalizeWeeklyDigestLanguage(source.language, fallbackLanguage),
  };
}

function toValidDate(value, fallback = null) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return new Date(value.getTime());
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return fallback;
  return parsed;
}

function computeNextWeeklyDigestRunAt(config, now = new Date()) {
  const digest = normalizeWeeklyDigestConfig(config);
  const base = toValidDate(now);
  if (!base) return null;

  const next = new Date(base.getTime());
  const dayOffset = (digest.dayOfWeek - base.getDay() + 7) % 7;
  next.setDate(base.getDate() + dayOffset);
  next.setHours(digest.hour, 0, 0, 0);

  if (next.getTime() < base.getTime()) {
    next.setDate(next.getDate() + 7);
  }

  return next.toISOString();
}

function buildWeeklyDigestMeta(config, { now = new Date(), lastSentAt = null } = {}) {
  const digest = normalizeWeeklyDigestConfig(config);
  const nextRunAt = computeNextWeeklyDigestRunAt(digest, now);
  const lastSent = toValidDate(lastSentAt);

  return {
    ready: digest.enabled === true && Boolean(digest.channelId),
    channelConfigured: Boolean(digest.channelId),
    nextRunAt,
    lastSentAt: lastSent ? lastSent.toISOString() : null,
  };
}

function shouldSendWeeklyDigest(config, { now = new Date(), lastSentAt = null } = {}) {
  const digest = normalizeWeeklyDigestConfig(config);
  const current = toValidDate(now);
  if (!current || digest.enabled !== true || !digest.channelId) return false;
  if (current.getDay() !== digest.dayOfWeek || current.getHours() !== digest.hour) return false;

  const lastSent = toValidDate(lastSentAt);
  if (lastSent && (current.getTime() - lastSent.getTime()) < 23 * 60 * 60 * 1000) {
    return false;
  }

  return true;
}

export {
  buildWeeklyDigestMeta,
  computeNextWeeklyDigestRunAt,
  normalizeWeeklyDigestConfig,
  shouldSendWeeklyDigest,
};
