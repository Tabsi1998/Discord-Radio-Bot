function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function computeWeeklyDigestNextRun(weeklyDigest, now = new Date()) {
  const source = weeklyDigest && typeof weeklyDigest === "object" ? weeklyDigest : {};
  const base = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (!Number.isFinite(base.getTime())) return null;

  const targetDay = clampInt(source.dayOfWeek, 0, 6, 1);
  const targetHour = clampInt(source.hour, 0, 23, 9);
  const next = new Date(base.getTime());
  next.setDate(base.getDate() + ((targetDay - base.getDay() + 7) % 7));
  next.setHours(targetHour, 0, 0, 0);

  if (next.getTime() < base.getTime()) {
    next.setDate(next.getDate() + 7);
  }

  return next.toISOString();
}

function formatSummaryDate(value, formatDate, fallbackLabel, options) {
  if (!value) return fallbackLabel;
  if (typeof formatDate === "function") {
    return formatDate(value, options);
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return fallbackLabel;
  return parsed.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  });
}

function buildWeeklyDigestSummary(settings, t = (de, en) => de, formatDate = null) {
  const weeklyDigest = settings?.weeklyDigest && typeof settings.weeklyDigest === "object"
    ? settings.weeklyDigest
    : { enabled: false, channelId: "", dayOfWeek: 1, hour: 9, language: "de" };
  const meta = settings?.weeklyDigestMeta && typeof settings.weeklyDigestMeta === "object"
    ? settings.weeklyDigestMeta
    : {};
  const enabled = weeklyDigest.enabled === true;
  const hasChannel = Boolean(String(weeklyDigest.channelId || "").trim());

  let statusLabel = t("Deaktiviert", "Disabled");
  let statusAccent = "#71717A";
  let description = t(
    "Der Weekly Digest ist aktuell ausgeschaltet.",
    "The weekly digest is currently turned off."
  );

  if (enabled && !hasChannel) {
    statusLabel = t("Channel fehlt", "Channel required");
    statusAccent = "#EF4444";
    description = t(
      "Waehle einen Text-Channel, damit der Weekly Digest gesendet werden kann.",
      "Select a text channel so the weekly digest can be sent."
    );
  } else if (enabled && hasChannel) {
    statusLabel = t("Geplant", "Scheduled");
    statusAccent = "#10B981";
    description = t(
      "Der Weekly Digest wird automatisch im gewaehlten Channel gepostet.",
      "The weekly digest will automatically post in the selected channel."
    );
  }

  return {
    statusLabel,
    statusAccent,
    description,
    missingChannel: enabled && !hasChannel,
    nextRunLabel: formatSummaryDate(
      computeWeeklyDigestNextRun(weeklyDigest),
      formatDate,
      t("Noch nicht geplant", "Not scheduled yet"),
      { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    ),
    lastSentLabel: formatSummaryDate(
      meta.lastSentAt || null,
      formatDate,
      t("Noch nie gesendet", "Never sent"),
      { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    ),
    languageLabel: String(weeklyDigest.language || "de").toLowerCase() === "en"
      ? "English"
      : "Deutsch",
  };
}

function buildFallbackStationSummary(settings, t = (de, en) => de) {
  const selectedValue = String(settings?.fallbackStation || "").trim().toLowerCase();
  const preview = settings?.fallbackStationPreview && typeof settings.fallbackStationPreview === "object"
    ? settings.fallbackStationPreview
    : null;

  if (!selectedValue) {
    return {
      statusLabel: t("Nicht gesetzt", "Not configured"),
      statusAccent: "#71717A",
      description: t(
        "Ohne Fallback bleibt es bei der normalen Auto-Reconnect-Logik.",
        "Without a fallback the normal auto-reconnect logic stays in place."
      ),
      stationLabel: t("Keine Fallback-Station", "No fallback station"),
      badgeLabel: "",
    };
  }

  if (preview?.valid === false) {
    return {
      statusLabel: t("Ungueltig", "Invalid"),
      statusAccent: "#EF4444",
      description: t(
        "Die gespeicherte Fallback-Station ist aktuell nicht verfuegbar.",
        "The saved fallback station is currently unavailable."
      ),
      stationLabel: preview.label || selectedValue,
      badgeLabel: "",
    };
  }

  const badgeLabel = preview?.isCustom
    ? t("Custom", "Custom")
    : String(preview?.tier || "ultimate").toUpperCase();

  return {
    statusLabel: t("Bereit", "Ready"),
    statusAccent: "#8B5CF6",
    description: t(
      "Wenn ein Stream hart fehlschlaegt, wechselt OmniFM auf diese Station.",
      "If a stream fails hard, OmniFM switches to this station."
    ),
    stationLabel: preview?.label || preview?.name || selectedValue,
    badgeLabel,
  };
}

export {
  buildFallbackStationSummary,
  buildWeeklyDigestSummary,
  computeWeeklyDigestNextRun,
};
