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
  return {
    status: ["healthy", "warning", "critical"].includes(String(input.status || ""))
      ? String(input.status)
      : "unknown",
    managedBots: Math.max(0, Number(input.managedBots || 0) || 0),
    readyBots: Math.max(0, Number(input.readyBots || 0) || 0),
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
  const unavailableBots = Math.max(0, health.managedBots - health.readyBots);

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

export {
  buildDashboardAnalyticsUpgradeHint,
  buildDashboardHealthAlerts,
  buildDashboardHealthStatus,
  formatDashboardDuration,
  buildReliabilitySummary,
  buildVoiceChannelUsageRows,
};
