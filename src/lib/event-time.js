// ============================================================
// OmniFM: Event Scheduling Time Functions
// ============================================================
import { normalizeLanguage, getDefaultLanguage } from "../i18n.js";
import { parseEnvInt } from "./helpers.js";
import { languagePick } from "./language.js";

const REPEAT_MODES = new Set([
  "none",
  "daily",
  "weekly",
  "monthly_first_weekday",
  "monthly_second_weekday",
  "monthly_third_weekday",
  "monthly_fourth_weekday",
  "monthly_last_weekday",
]);

const MONTHLY_REPEAT_NTH = Object.freeze({
  monthly_first_weekday: 1,
  monthly_second_weekday: 2,
  monthly_third_weekday: 3,
  monthly_fourth_weekday: 4,
  monthly_last_weekday: -1,
});

const EVENT_TIME_ZONE_ALIASES = Object.freeze({
  UTC: "UTC",
  GMT: "UTC",
  CET: "Europe/Berlin",
  CEST: "Europe/Berlin",
  MEZ: "Europe/Berlin",
  MESZ: "Europe/Berlin",
  BERLIN: "Europe/Berlin",
  VIENNA: "Europe/Vienna",
  WIEN: "Europe/Vienna",
});

const EVENT_TIME_ZONE_SUGGESTIONS = [
  // Häufigste (Top 20) mit Emojis für bessere Lesbarkeit
  { label: "🇩🇪 Europe/Berlin (CET)", value: "Europe/Berlin" },
  { label: "🌍 UTC / GMT", value: "UTC" },
  { label: "🇺🇸 America/New_York (EST)", value: "America/New_York" },
  { label: "🇺🇸 America/Los_Angeles (PST)", value: "America/Los_Angeles" },
  { label: "🇬🇧 Europe/London (GMT)", value: "Europe/London" },
  { label: "🇦🇹 Europe/Vienna", value: "Europe/Vienna" },
  { label: "🇨🇭 Europe/Zurich", value: "Europe/Zurich" },
  { label: "🇫🇷 Europe/Paris", value: "Europe/Paris" },
  { label: "🇮🇹 Europe/Rome", value: "Europe/Rome" },
  { label: "🇪🇸 Europe/Madrid", value: "Europe/Madrid" },
  { label: "🇸🇪 Europe/Stockholm", value: "Europe/Stockholm" },
  { label: "🇨🇦 America/Toronto", value: "America/Toronto" },
  { label: "🇺🇸 America/Chicago", value: "America/Chicago" },
  { label: "🇲🇽 America/Mexico_City", value: "America/Mexico_City" },
  { label: "🇧🇷 America/Sao_Paulo", value: "America/Sao_Paulo" },
  { label: "🇦🇪 Asia/Dubai", value: "Asia/Dubai" },
  { label: "🇮🇳 Asia/Kolkata", value: "Asia/Kolkata" },
  { label: "🇹🇭 Asia/Bangkok", value: "Asia/Bangkok" },
  { label: "🇨🇳 Asia/Shanghai", value: "Asia/Shanghai" },
  { label: "🇯🇵 Asia/Tokyo", value: "Asia/Tokyo" },
  { label: "🇦🇺 Australia/Sydney", value: "Australia/Sydney" },
];

// Alle ~400 IANA Zeitzonen gruppiert nach Region (kostenlos via Intl API)
function getGroupedTimeZones() {
  const allZones = Intl.supportedValuesOf('timeZone');
  const grouped = {};
  
  allZones.forEach(zone => {
    const region = zone.split('/')[0]; // "Europe", "America", etc.
    if (!grouped[region]) grouped[region] = [];
    grouped[region].push(zone);
  });
  
  return grouped;
}

function canonicalizeTimeZone(rawTimeZone) {
  const raw = String(rawTimeZone || "").trim();
  if (!raw) return null;

  const aliasKey = raw.replace(/\s+/g, "").toUpperCase();
  const alias = EVENT_TIME_ZONE_ALIASES[aliasKey];
  const candidate = String(alias || raw).replace(/\s+/g, "_");
  if (!candidate) return null;

  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone || candidate;
  } catch {
    return null;
  }
}

const EVENT_FALLBACK_TIME_ZONE =
  canonicalizeTimeZone(process.env.EVENT_DEFAULT_TIMEZONE)
  || canonicalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  || "UTC";

function normalizeEventTimeZone(rawTimeZone, fallback = EVENT_FALLBACK_TIME_ZONE) {
  const raw = String(rawTimeZone || "").trim();
  if (!raw) return fallback;
  return canonicalizeTimeZone(raw);
}

function getZonedPartsFromUtcMs(utcMs, timeZone) {
  const tz = normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const rawParts = formatter.formatToParts(new Date(utcMs));
  const map = {};
  for (const part of rawParts) {
    if (part.type === "literal") continue;
    map[part.type] = part.value;
  }

  return {
    year: Number.parseInt(map.year || "0", 10),
    month: Number.parseInt(map.month || "0", 10),
    day: Number.parseInt(map.day || "0", 10),
    hour: Number.parseInt(map.hour || "0", 10),
    minute: Number.parseInt(map.minute || "0", 10),
    second: Number.parseInt(map.second || "0", 10),
  };
}

function getTimeZoneOffsetMs(utcMs, timeZone) {
  const zoned = getZonedPartsFromUtcMs(utcMs, timeZone);
  const asUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second, 0);
  return asUtc - utcMs;
}

function zonedDateTimeToUtcMs(parts, timeZone) {
  const guessUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0, 0);
  let offset = getTimeZoneOffsetMs(guessUtcMs, timeZone);
  let resolvedUtcMs = guessUtcMs - offset;
  const nextOffset = getTimeZoneOffsetMs(resolvedUtcMs, timeZone);
  if (offset !== nextOffset) {
    resolvedUtcMs = guessUtcMs - nextOffset;
  }
  return resolvedUtcMs;
}

function getWeekdayIndexInTimeZone(utcMs, timeZone) {
  const tz = normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  const short = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(utcMs));
  const key = String(short || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 3);
  const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return map[key] ?? new Date(utcMs).getUTCDay();
}

function getWeekdayName(utcMs, language = "de", timeZone = EVENT_FALLBACK_TIME_ZONE) {
  const locale = normalizeLanguage(language, "de") === "de" ? "de-DE" : "en-US";
  const tz = normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  return new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long" }).format(new Date(utcMs));
}

function addDaysCalendar(year, month, day, dayDelta) {
  const next = new Date(Date.UTC(year, month - 1, day + dayDelta, 12, 0, 0, 0));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function addMonthsYearMonth(year, month, monthDelta) {
  const next = new Date(Date.UTC(year, month - 1 + monthDelta, 1, 0, 0, 0, 0));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
  };
}

function getDaysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0, 0, 0, 0, 0)).getUTCDate();
}

function nthWeekdayOfMonth(year, month, weekdayIndex, nth) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)).getUTCDay();
  const firstTargetDay = 1 + ((7 + weekdayIndex - firstWeekday) % 7);
  const day = firstTargetDay + ((nth - 1) * 7);
  return day <= getDaysInMonth(year, month) ? day : null;
}

function lastWeekdayOfMonth(year, month, weekdayIndex) {
  const maxDay = getDaysInMonth(year, month);
  const lastWeekday = new Date(Date.UTC(year, month - 1, maxDay, 0, 0, 0, 0)).getUTCDay();
  return maxDay - ((7 + lastWeekday - weekdayIndex) % 7);
}

function parseEventStartDateTime(rawInput, language = "de", preferredTimeZone = "") {
  const raw = String(rawInput || "").trim();
  if (!raw) {
    return {
      ok: false,
      message: languagePick(language, "Zeit fehlt.", "Time is missing."),
    };
  }

  const normalized = raw.replace("T", " ");
  const match = normalized.match(
    /^(?:(\d{4})[-\/](\d{2})[-\/](\d{2})|(\d{2})\.(\d{2})\.(\d{4}))\s+(\d{2}):(\d{2})(?:\s+([A-Za-z0-9_+\-\/]+))?$/
  );
  if (!match) {
    return {
      ok: false,
      message: languagePick(
        language,
        "Ungueltiges Format. Nutze `YYYY-MM-DD HH:MM` oder `DD.MM.YYYY HH:MM` (optional mit TZ, z.B. `2026-03-01 20:30 CET`).",
        "Invalid format. Use `YYYY-MM-DD HH:MM` or `DD.MM.YYYY HH:MM` (optionally with TZ, e.g. `2026-03-01 20:30 CET`)."
      ),
    };
  }

  const year = Number.parseInt(match[1] || match[6], 10);
  const month = Number.parseInt(match[2] || match[5], 10);
  const day = Number.parseInt(match[3] || match[4], 10);
  const hour = Number.parseInt(match[7], 10);
  const minute = Number.parseInt(match[8], 10);
  const inlineTimeZone = String(match[9] || "").trim();

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return {
      ok: false,
      message: languagePick(language, "Datum/Uhrzeit ungueltig.", "Date/time is invalid."),
    };
  }

  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== (month - 1)
    || parsed.getUTCDate() !== day
    || parsed.getUTCHours() !== hour
    || parsed.getUTCMinutes() !== minute
  ) {
    return {
      ok: false,
      message: languagePick(language, "Datum/Uhrzeit ungueltig.", "Date/time is invalid."),
    };
  }

  const rawTimeZone = String(preferredTimeZone || inlineTimeZone || EVENT_FALLBACK_TIME_ZONE).trim();
  const timeZone = normalizeEventTimeZone(rawTimeZone, EVENT_FALLBACK_TIME_ZONE);
  if (!timeZone) {
    return {
      ok: false,
      message: languagePick(
        language,
        "Zeitzone ungueltig. Beispiele: `Europe/Berlin`, `Europe/Vienna`, `CET`, `MEZ`, `UTC`.",
        "Invalid time zone. Examples: `Europe/Berlin`, `Europe/Vienna`, `CET`, `MEZ`, `UTC`."
      ),
    };
  }

  const runAtMs = zonedDateTimeToUtcMs({ year, month, day, hour, minute, second: 0 }, timeZone);
  const roundTrip = getZonedPartsFromUtcMs(runAtMs, timeZone);
  if (
    roundTrip.year !== year
    || roundTrip.month !== month
    || roundTrip.day !== day
    || roundTrip.hour !== hour
    || roundTrip.minute !== minute
  ) {
    return {
      ok: false,
      message: languagePick(
        language,
        "Die Uhrzeit ist in dieser Zeitzone ungueltig (z.B. DST-Umstellung). Bitte andere Uhrzeit waehlen.",
        "That local time is invalid in this time zone (for example DST transition). Please choose another time."
      ),
    };
  }

  return {
    ok: true,
    runAtMs,
    timeZone,
    parsed: new Date(runAtMs),
  };
}

function formatDateTime(ms, language = "de", timeZone = null) {
  const value = Number.parseInt(String(ms || ""), 10);
  if (!Number.isFinite(value) || value <= 0) return "-";
  const locale = normalizeLanguage(language, "de") === "de" ? "de-DE" : "en-US";
  const tz = normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  return new Date(value).toLocaleString(locale, {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeRepeatMode(raw) {
  const repeat = String(raw || "none").trim().toLowerCase();
  if (REPEAT_MODES.has(repeat)) return repeat;
  return "none";
}

function getRepeatLabel(raw, language = "de", { runAtMs = null, timeZone = null } = {}) {
  const repeat = normalizeRepeatMode(raw);
  const isDe = normalizeLanguage(language, "de") === "de";
  const weekday = Number.isFinite(Number(runAtMs)) && Number(runAtMs) > 0
    ? getWeekdayName(Number(runAtMs), language, timeZone || EVENT_FALLBACK_TIME_ZONE)
    : null;

  if (repeat === "daily") return isDe ? "taeglich" : "daily";
  if (repeat === "weekly") {
    return weekday
      ? (isDe ? `woechentlich (${weekday})` : `weekly (${weekday})`)
      : (isDe ? "woechentlich" : "weekly");
  }
  if (repeat === "monthly_first_weekday") return isDe ? `monatlich (1. ${weekday || "Wochentag"})` : `monthly (1st ${weekday || "weekday"})`;
  if (repeat === "monthly_second_weekday") return isDe ? `monatlich (2. ${weekday || "Wochentag"})` : `monthly (2nd ${weekday || "weekday"})`;
  if (repeat === "monthly_third_weekday") return isDe ? `monatlich (3. ${weekday || "Wochentag"})` : `monthly (3rd ${weekday || "weekday"})`;
  if (repeat === "monthly_fourth_weekday") return isDe ? `monatlich (4. ${weekday || "Wochentag"})` : `monthly (4th ${weekday || "weekday"})`;
  if (repeat === "monthly_last_weekday") return isDe ? `monatlich (letzter ${weekday || "Wochentag"})` : `monthly (last ${weekday || "weekday"})`;
  return isDe ? "einmalig" : "once";
}

function computeNextEventRunAtMs(runAtMs, repeat, nowMs = Date.now(), timeZone = null) {
  const base = Number.parseInt(String(runAtMs || ""), 10);
  if (!Number.isFinite(base) || base <= 0) return null;

  const mode = normalizeRepeatMode(repeat);
  if (mode === "none") return null;

  const tz = normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  const baseParts = getZonedPartsFromUtcMs(base, tz);
  const baseClock = {
    hour: baseParts.hour,
    minute: baseParts.minute,
    second: 0,
  };

  if (mode === "daily" || mode === "weekly") {
    const stepDays = mode === "weekly" ? 7 : 1;
    let cursor = { year: baseParts.year, month: baseParts.month, day: baseParts.day };
    let next = base;
    for (let i = 0; i < 5000 && next <= nowMs; i += 1) {
      cursor = addDaysCalendar(cursor.year, cursor.month, cursor.day, stepDays);
      next = zonedDateTimeToUtcMs({ ...cursor, ...baseClock }, tz);
    }
    return next > nowMs ? next : null;
  }

  const monthlyNth = MONTHLY_REPEAT_NTH[mode];
  if (!monthlyNth) return null;

  const weekdayIndex = getWeekdayIndexInTimeZone(base, tz);
  let monthCursor = addMonthsYearMonth(baseParts.year, baseParts.month, 1);
  for (let i = 0; i < 2400; i += 1) {
    const targetDay = monthlyNth === -1
      ? lastWeekdayOfMonth(monthCursor.year, monthCursor.month, weekdayIndex)
      : nthWeekdayOfMonth(monthCursor.year, monthCursor.month, weekdayIndex, monthlyNth);
    if (targetDay) {
      const next = zonedDateTimeToUtcMs({
        year: monthCursor.year,
        month: monthCursor.month,
        day: targetDay,
        ...baseClock,
      }, tz);
      if (next > nowMs) return next;
    }
    monthCursor = addMonthsYearMonth(monthCursor.year, monthCursor.month, 1);
  }
  return null;
}

function renderEventAnnouncement(template, values, language = "de") {
  const fallback = languagePick(
    language,
    "Event **{event}** startet jetzt: **{station}** in {voice}.",
    "Event **{event}** is starting now: **{station}** in {voice}."
  );
  const base = String(template || "").trim() || fallback;
  return base
    .replace(/\{event\}/gi, String(values?.event || "-"))
    .replace(/\{station\}/gi, String(values?.station || "-"))
    .replace(/\{voice\}/gi, String(values?.voice || "-"))
    .replace(/\{time\}/gi, String(values?.time || "-"))
    .replace(/\{end\}/gi, String(values?.end || "-"))
    .replace(/\{timezone\}/gi, String(values?.timeZone || values?.timezone || "-"))
    .trim();
}

function renderStageTopic(template, values) {
  const base = String(template || "").trim() || "{event} - {station}";
  return base
    .replace(/\{event\}/gi, String(values?.event || "-"))
    .replace(/\{station\}/gi, String(values?.station || "-"))
    .replace(/\{time\}/gi, String(values?.time || "-"))
    .replace(/\{end\}/gi, String(values?.end || "-"))
    .replace(/\{timezone\}/gi, String(values?.timeZone || values?.timezone || "-"))
    .trim();
}

// Alle Zeitzonen gruppiert abrufen (für Advanced Users)
function getAllTimeZonesGrouped() {
  return getGroupedTimeZones();
}

// Validierung: Checkt ob Timezone korrekt ist
function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export {
  REPEAT_MODES,
  MONTHLY_REPEAT_NTH,
  EVENT_TIME_ZONE_ALIASES,
  EVENT_TIME_ZONE_SUGGESTIONS,
  EVENT_FALLBACK_TIME_ZONE,
  canonicalizeTimeZone,
  normalizeEventTimeZone,
  getZonedPartsFromUtcMs,
  getTimeZoneOffsetMs,
  zonedDateTimeToUtcMs,
  getWeekdayIndexInTimeZone,
  getWeekdayName,
  addDaysCalendar,
  addMonthsYearMonth,
  getDaysInMonth,
  nthWeekdayOfMonth,
  lastWeekdayOfMonth,
  parseEventStartDateTime,
  formatDateTime,
  normalizeRepeatMode,
  getRepeatLabel,
  computeNextEventRunAtMs,
  renderEventAnnouncement,
  renderStageTopic,
  getGroupedTimeZones,
  getAllTimeZonesGrouped,
  isValidTimeZone,
};
