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

function normalizeDashboardHealth(source = {}) {
  const input = source && typeof source === "object" ? source : {};
  const managedBots = Math.max(0, Number(input.managedBots || 0) || 0);
  const readyBots = Math.max(0, Number(input.readyBots || 0) || 0);
  const providedUnavailableBots = Math.max(0, Number(input.unavailableBots || 0) || 0);
  return {
    status: ["healthy", "warning", "critical"].includes(String(input.status || ""))
      ? String(input.status)
      : "unknown",
    managedBots,
    readyBots,
    unavailableBots: Math.max(providedUnavailableBots, Math.max(0, managedBots - readyBots)),
    liveStreams: Math.max(0, Number(input.liveStreams || 0) || 0),
    activeVoiceChannels: Math.max(0, Number(input.activeVoiceChannels || 0) || 0),
    listenersNow: Math.max(0, Number(input.listenersNow || 0) || 0),
    recoveringStreams: Math.max(0, Number(input.recoveringStreams || 0) || 0),
    degradedStreams: Math.max(0, Number(input.degradedStreams || 0) || 0),
    reconnectAttempts: Math.max(0, Number(input.reconnectAttempts || 0) || 0),
    streamErrors: Math.max(0, Number(input.streamErrors || 0) || 0),
    eventsConfigured: Math.max(0, Number(input.eventsConfigured || 0) || 0),
    eventsActive: Math.max(0, Number(input.eventsActive || 0) || 0),
    nextEventAt: input.nextEventAt || null,
    nextEventTitle: String(input.nextEventTitle || "").trim() || null,
    alerts: Array.isArray(input.alerts) ? input.alerts : [],
    bots: Array.isArray(input.bots) ? input.bots : [],
  };
}

function buildDashboardHealthStatus(source = {}, t = (de, en) => de) {
  const health = normalizeDashboardHealth(source);

  if (health.managedBots <= 0) {
    return {
      label: t("Bot fehlt", "Bot missing"),
      accent: "#EF4444",
      sub: t("Kein OmniFM Bot ist aktuell in diesem Server verfuegbar.", "No OmniFM bot is currently available in this server."),
    };
  }

  if (health.status === "critical") {
    return {
      label: t("Kritisch", "Critical"),
      accent: "#EF4444",
      sub: `${health.readyBots}/${health.managedBots} ${t("Bots bereit", "bots ready")}`,
    };
  }

  if (health.status === "warning") {
    return {
      label: t("Achtung", "Warning"),
      accent: "#F59E0B",
      sub: `${health.recoveringStreams + health.degradedStreams} ${t("aktive Hinweise", "active issues")}`,
    };
  }

  if (health.status === "healthy") {
    return {
      label: t("Stabil", "Stable"),
      accent: "#10B981",
      sub: `${health.readyBots}/${health.managedBots} ${t("Bots bereit", "bots ready")}`,
    };
  }

  return {
    label: t("Unbekannt", "Unknown"),
    accent: "#71717A",
    sub: t("Noch keine Health-Daten", "No health data yet"),
  };
}

function buildDashboardHealthAlerts(source = {}, t = (de, en) => de) {
  const health = normalizeDashboardHealth(source);
  const alerts = [];
  const unavailableBots = Math.max(0, Number(health.unavailableBots || 0) || 0);

  if (health.managedBots <= 0) {
    alerts.push({
      severity: "critical",
      message: t(
        "Kein OmniFM Bot ist aktuell auf diesem Server verfuegbar.",
        "No OmniFM bot is currently available on this server."
      ),
    });
  }

  if (unavailableBots > 0) {
    alerts.push({
      severity: health.readyBots <= 0 ? "critical" : "warning",
      message: t(
        `${unavailableBots} Bot(s) sind aktuell nicht bereit.`,
        `${unavailableBots} bot(s) are currently not ready.`
      ),
    });
  }

  if (health.recoveringStreams > 0) {
    alerts.push({
      severity: "warning",
      message: t(
        `${health.recoveringStreams} Stream(s) befinden sich im Reconnect.`,
        `${health.recoveringStreams} stream(s) are currently reconnecting.`
      ),
    });
  }

  if (health.degradedStreams > 0) {
    alerts.push({
      severity: health.streamErrors >= 3 ? "critical" : "warning",
      message: t(
        `${health.degradedStreams} Stream(s) zeigen Verbindungsprobleme.`,
        `${health.degradedStreams} stream(s) show connection issues.`
      ),
    });
  }

  if (!alerts.length) {
    alerts.push({
      severity: "success",
      message: t(
        "Keine aktiven Health-Probleme erkannt.",
        "No active health issues detected."
      ),
    });
  }

  return alerts;
}

function buildDashboardAnalyticsUpgradeHint({ isUltimate = false, t = (de, en) => de } = {}) {
  if (isUltimate) return null;

  return {
    requiredTier: "ultimate",
    badge: "ULTIMATE",
    title: t("Ultimate Analytics", "Ultimate analytics"),
    description: t(
      "Stundenmuster, Wochentage, Stations-Breakdowns und Tagestrends sind exklusiv im Ultimate-Paket enthalten.",
      "Hourly trends, weekday patterns, station breakdowns, and daily trends are exclusive to the Ultimate plan."
    ),
    bullets: [
      t("Starts nach Stunde und Wochentag", "Starts by hour and weekday"),
      t("Stations-Breakdown pro Server", "Station breakdown per server"),
      t("Taegliche Trendkurve der letzten 30 Tage", "Daily trend curve for the last 30 days"),
    ],
  };
}

function buildConnectionTimelineRows(connectionHealth = {}, formatDate = null) {
  const timeline = Array.isArray(connectionHealth?.timeline) ? connectionHealth.timeline : [];
  return timeline.map((row) => {
    const parsed = row?.date ? new Date(`${row.date}T12:00:00`) : null;
    const label = Number.isFinite(parsed?.getTime?.())
      ? (typeof formatDate === "function"
        ? formatDate(parsed.toISOString(), { month: "short", day: "numeric" })
        : row.date.slice(5))
      : String(row?.date || "");
    const connects = Math.max(0, Number(row?.connects || 0) || 0);
    const reconnects = Math.max(0, Number(row?.reconnects || 0) || 0);
    const errors = Math.max(0, Number(row?.errors || 0) || 0);

    return {
      date: row?.date || "",
      label,
      connects,
      reconnects,
      errors,
      issues: reconnects + errors,
      reliability: connects > 0
        ? Math.max(0, Math.min(100, Math.round(((connects - errors) / connects) * 100)))
        : null,
    };
  });
}

function buildSessionTimelineRows(sessionHistory = [], formatDate = null) {
  return (Array.isArray(sessionHistory) ? sessionHistory : [])
    .slice(0, 12)
    .sort((a, b) => String(a?.startedAt || "").localeCompare(String(b?.startedAt || "")))
    .map((session, index) => {
      const stationName = String(session?.stationName || session?.stationKey || "Session");
      const startedAt = session?.startedAt || null;
      const label = startedAt
        ? (typeof formatDate === "function"
          ? formatDate(startedAt, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
          : new Date(startedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))
        : `#${index + 1}`;

      return {
        id: `${startedAt || "session"}-${index}`,
        label,
        stationName,
        runtimeHours: Math.round(((Number(session?.durationMs || 0) || 0) / 3_600_000) * 10) / 10,
        listeningHours: Math.round(((Number(session?.humanListeningMs || 0) || 0) / 3_600_000) * 10) / 10,
        peakListeners: Math.max(0, Number(session?.peakListeners || 0) || 0),
        avgListeners: Math.max(0, Number(session?.avgListeners || 0) || 0),
      };
    });
}

function buildSessionQualitySummary(sessionHistory = [], t = (de, en) => de) {
  const sessions = Array.isArray(sessionHistory) ? sessionHistory : [];
  if (!sessions.length) {
    return {
      trackedSessions: 0,
      avgListeningLabel: "0m",
      longestListeningLabel: "0m",
      topPeakLabel: "0",
      avgPeakLabel: "0",
      subLabel: t("Noch keine Sessions im Verlauf", "No sessions in history yet"),
    };
  }

  const totalListeningMs = sessions.reduce((sum, session) => sum + (Number(session?.humanListeningMs || 0) || 0), 0);
  const longestListeningMs = sessions.reduce((max, session) => Math.max(max, Number(session?.humanListeningMs || 0) || 0), 0);
  const topPeak = sessions.reduce((max, session) => Math.max(max, Number(session?.peakListeners || 0) || 0), 0);
  const avgPeak = Math.round(sessions.reduce((sum, session) => sum + (Number(session?.avgListeners || 0) || 0), 0) / sessions.length);

  return {
    trackedSessions: sessions.length,
    avgListeningLabel: formatDashboardDuration(Math.round(totalListeningMs / sessions.length)),
    longestListeningLabel: formatDashboardDuration(longestListeningMs),
    topPeakLabel: String(topPeak),
    avgPeakLabel: String(avgPeak),
    subLabel: t(
      `${sessions.length} Session(s) im aktuellen Verlauf`,
      `${sessions.length} session(s) in the current history`
    ),
  };
}

export {
  buildDashboardAnalyticsUpgradeHint,
  buildDashboardHealthAlerts,
  buildDashboardHealthStatus,
  buildConnectionTimelineRows,
  buildSessionQualitySummary,
  formatDashboardDuration,
  buildReliabilitySummary,
  buildSessionTimelineRows,
  buildVoiceChannelUsageRows,
};
