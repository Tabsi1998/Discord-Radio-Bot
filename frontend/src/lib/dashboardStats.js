function normalizeDurationMs(ms) {
  const value = Number(ms);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function formatDashboardDuration(ms, { short = false } = {}) {
  const value = normalizeDurationMs(ms);
  if (value <= 0) return "0m";
  if (value < 60_000) return "<1m";

  const totalMin = Math.floor(value / 60_000);
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;

  if (short) {
    if (hours > 0) {
      const roundedHours = Math.round((value / 3_600_000) * 10) / 10;
      return `${roundedHours}h`;
    }
    return `${totalMin}m`;
  }

  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function buildReliabilitySummary({ connects = 0, errors = 0, t = (de, en) => de } = {}) {
  const totalConnects = Math.max(0, Number(connects) || 0);
  const totalErrors = Math.max(0, Number(errors) || 0);

  if (totalConnects <= 0) {
    return {
      value: "\u2014",
      accent: "#71717A",
      sub: t("Noch keine Verbindungsdaten", "No connection data yet"),
    };
  }

  const reliability = Math.max(0, Math.min(100, Math.round(((totalConnects - totalErrors) / totalConnects) * 100)));
  return {
    value: `${reliability}%`,
    accent: reliability >= 95 ? "#10B981" : reliability >= 80 ? "#F59E0B" : "#EF4444",
    sub: `${totalConnects} ${t("Verbindungen", "connections")}`,
  };
}

function buildVoiceChannelUsageRows(voiceChannels = {}, voiceChannelNames = {}) {
  return Object.entries(voiceChannels || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => {
      const resolvedName = String(voiceChannelNames?.[id] || "").trim();
      return {
        id,
        name: resolvedName ? `#${resolvedName}` : id,
        count: Math.max(0, Number(count) || 0),
      };
    });
}

export {
  formatDashboardDuration,
  buildReliabilitySummary,
  buildVoiceChannelUsageRows,
};
