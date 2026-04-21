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

function buildReliabilitySummary({
  connects = 0,
  reconnects = 0,
  disconnects = 0,
  errors = 0,
  t = (de, en) => de,
} = {}) {
  const totalConnects = Math.max(0, Number(connects) || 0);
  const totalReconnects = Math.max(0, Number(reconnects) || 0);
  const totalDisconnects = Math.max(0, Number(disconnects) || 0);
  const totalErrors = Math.max(0, Number(errors) || 0);
  const totalSuccessfulConnections = totalConnects + totalReconnects;
  const totalDisruptions = totalDisconnects + totalErrors;

  if ((totalSuccessfulConnections + totalDisruptions) <= 0) {
    return {
      value: "\u2014",
      accent: "#71717A",
      sub: t("Noch keine Verbindungsdaten", "No connection data yet"),
    };
  }

  const reliability = totalSuccessfulConnections > 0
    ? Math.max(0, Math.min(100, Math.round((totalSuccessfulConnections / (totalSuccessfulConnections + totalDisruptions)) * 100)))
    : 0;
  return {
    value: `${reliability}%`,
    accent: reliability >= 95 ? "#10B981" : reliability >= 80 ? "#F59E0B" : "#EF4444",
    sub: totalSuccessfulConnections > 0
      ? `${totalSuccessfulConnections} ${t("erfolgreiche Verbindungen", "successful connections")}`
      : `${totalDisruptions} ${t("Stoerungen", "disruptions")}`,
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

function buildSessionHistoryEntryId(session = {}) {
  return JSON.stringify([
    String(session?.startedAt || ""),
    String(session?.stationKey || ""),
    String(session?.channelId || ""),
    Math.max(0, Number(session?.durationMs || 0) || 0),
    Math.max(0, Number(session?.humanListeningMs || 0) || 0),
    Math.max(0, Number(session?.peakListeners || 0) || 0),
    Math.max(0, Number(session?.avgListeners || 0) || 0),
  ]);
}

function buildConnectionEventEntryId(event = {}) {
  return JSON.stringify([
    String(event?.timestamp || ""),
    String(event?.botId || ""),
    String(event?.eventType || ""),
    String(event?.channelId || ""),
    String(event?.details || ""),
  ]);
}

function normalizeDashboardTimestamp(value) {
  if (!value) return null;
  const parsedMs = typeof value === "number"
    ? value
    : Date.parse(String(value || ""));
  return Number.isFinite(parsedMs) && parsedMs > 0 ? new Date(parsedMs).toISOString() : null;
}

function formatDashboardTimestampLabel(value, formatDate = null) {
  const normalized = normalizeDashboardTimestamp(value);
  if (!normalized) return "";
  if (typeof formatDate === "function") {
    return formatDate(normalized, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return new Date(normalized).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeDashboardHealthBot(source = {}) {
  const input = source && typeof source === "object" ? source : {};
  const restoreCooldownMs = Math.max(0, Number(input.restoreCooldownMs || 0) || 0);
  const reconnectCircuitRemainingMs = Math.max(0, Number(input.reconnectCircuitRemainingMs || 0) || 0);
  return {
    botId: String(input.botId || "").trim() || null,
    botName: String(input.botName || "").trim() || null,
    role: String(input.role || "").trim() || null,
    ready: input.ready === true,
    status: String(input.status || "").trim() || "idle",
    playing: input.playing === true,
    recovering: input.recovering === true,
    shouldReconnect: input.shouldReconnect === true,
    listeners: Math.max(0, Number(input.listeners || 0) || 0),
    reconnectAttempts: Math.max(0, Number(input.reconnectAttempts || 0) || 0),
    reconnectCount: Math.max(0, Number(input.reconnectCount || 0) || 0),
    streamErrorCount: Math.max(0, Number(input.streamErrorCount || 0) || 0),
    channelId: String(input.channelId || "").trim() || null,
    channelName: String(input.channelName || "").trim() || null,
    stationKey: String(input.stationKey || "").trim() || null,
    stationName: String(input.stationName || "").trim() || null,
    reconnectPending: input.reconnectPending === true,
    reconnectInFlight: input.reconnectInFlight === true,
    streamRestartPending: input.streamRestartPending === true,
    voiceConnectInFlight: input.voiceConnectInFlight === true,
    lastReconnectAt: normalizeDashboardTimestamp(input.lastReconnectAt),
    lastStreamErrorAt: normalizeDashboardTimestamp(input.lastStreamErrorAt),
    lastProcessExitCode: input.lastProcessExitCode ?? null,
    lastProcessExitDetail: String(input.lastProcessExitDetail || "").trim() || null,
    lastProcessExitAt: normalizeDashboardTimestamp(input.lastProcessExitAt),
    lastStreamEndReason: String(input.lastStreamEndReason || "").trim() || null,
    lastNetworkFailureAt: normalizeDashboardTimestamp(input.lastNetworkFailureAt),
    voiceDisconnectObservedAt: normalizeDashboardTimestamp(input.voiceDisconnectObservedAt),
    restoreBlockedUntil: normalizeDashboardTimestamp(input.restoreBlockedUntil),
    restoreBlockedAt: normalizeDashboardTimestamp(input.restoreBlockedAt),
    restoreBlockCount: Math.max(0, Number(input.restoreBlockCount || 0) || 0),
    restoreBlockReason: String(input.restoreBlockReason || "").trim() || null,
    restoreCooldownMs,
    reconnectCircuitTripCount: Math.max(0, Number(input.reconnectCircuitTripCount || 0) || 0),
    reconnectCircuitOpenUntil: normalizeDashboardTimestamp(input.reconnectCircuitOpenUntil),
    reconnectCircuitRemainingMs,
    networkRecoveryDelayMs: Math.max(0, Number(input.networkRecoveryDelayMs || 0) || 0),
    voiceGuardPolicy: String(input.voiceGuardPolicy || "").trim() || "default",
    voiceGuardEffectivePolicy: String(input.voiceGuardEffectivePolicy || "").trim() || null,
    voiceGuardUnlockUntil: normalizeDashboardTimestamp(input.voiceGuardUnlockUntil),
    voiceGuardCooldownUntil: normalizeDashboardTimestamp(input.voiceGuardCooldownUntil),
    voiceGuardUnlockRemainingMs: Math.max(0, Number(input.voiceGuardUnlockRemainingMs || 0) || 0),
    voiceGuardCooldownRemainingMs: Math.max(0, Number(input.voiceGuardCooldownRemainingMs || 0) || 0),
    voiceGuardMoveCount: Math.max(0, Number(input.voiceGuardMoveCount || 0) || 0),
    voiceGuardWindowMoveCount: Math.max(0, Number(input.voiceGuardWindowMoveCount || 0) || 0),
    voiceGuardReturnCount: Math.max(0, Number(input.voiceGuardReturnCount || 0) || 0),
    voiceGuardDisconnectCount: Math.max(0, Number(input.voiceGuardDisconnectCount || 0) || 0),
    voiceGuardEscalationCount: Math.max(0, Number(input.voiceGuardEscalationCount || 0) || 0),
    voiceGuardLastAction: String(input.voiceGuardLastAction || "").trim() || null,
    voiceGuardLastActionAt: normalizeDashboardTimestamp(input.voiceGuardLastActionAt),
    voiceGuardLastActionReason: String(input.voiceGuardLastActionReason || "").trim() || null,
  };
}

function buildDashboardHealthBotDebug(source = {}, {
  t = (de, en) => de,
  formatDate = null,
} = {}) {
  const bot = normalizeDashboardHealthBot(source);
  const flags = [];
  if (bot.reconnectPending) flags.push(t("Reconnect-Timer", "Reconnect timer"));
  if (bot.reconnectInFlight) flags.push(t("Reconnect laeuft", "Reconnect in progress"));
  if (bot.streamRestartPending) flags.push(t("Stream-Retry", "Stream retry"));
  if (bot.voiceConnectInFlight) flags.push(t("Voice-Connect", "Voice connect"));
  if (bot.restoreBlockCount > 0) {
    flags.push(t(`${bot.restoreBlockCount} Restore-Blocks`, `${bot.restoreBlockCount} restore blocks`));
  }
  if (bot.networkRecoveryDelayMs > 0) {
    flags.push(t(
      `Netzwerk-Backoff ${formatDashboardDuration(bot.networkRecoveryDelayMs, { short: true })}`,
      `Network backoff ${formatDashboardDuration(bot.networkRecoveryDelayMs, { short: true })}`
    ));
  }
  if (bot.voiceGuardUnlockRemainingMs > 0) {
    flags.push(t(
      `Voice-Guard Unlock ${formatDashboardDuration(bot.voiceGuardUnlockRemainingMs, { short: true })}`,
      `Voice guard unlock ${formatDashboardDuration(bot.voiceGuardUnlockRemainingMs, { short: true })}`
    ));
  }
  if (bot.voiceGuardCooldownRemainingMs > 0) {
    flags.push(t(
      `Voice-Guard Cooldown ${formatDashboardDuration(bot.voiceGuardCooldownRemainingMs, { short: true })}`,
      `Voice guard cooldown ${formatDashboardDuration(bot.voiceGuardCooldownRemainingMs, { short: true })}`
    ));
  }

  let summary = "";
  if (!bot.ready && bot.recovering) {
    summary = t(
      "Worker offline mit aktivem Recovery-Ziel",
      "Worker offline with an active recovery target"
    );
  } else if (bot.restoreCooldownMs > 0) {
    summary = t("Restore-Cooldown aktiv", "Restore cooldown active");
  } else if (bot.reconnectCircuitRemainingMs > 0) {
    summary = t("Reconnect-Circuit pausiert", "Reconnect circuit paused");
  } else if (bot.voiceConnectInFlight) {
    summary = t("Voice-Verbindung wird aufgebaut", "Voice connection is being established");
  } else if (bot.reconnectInFlight) {
    summary = t("Reconnect laeuft gerade", "Reconnect is currently in progress");
  } else if (bot.streamRestartPending) {
    summary = t("Stream-Neustart geplant", "Stream restart is scheduled");
  } else if (bot.reconnectPending) {
    summary = t("Reconnect-Retry geplant", "Reconnect retry is scheduled");
  } else if (bot.voiceGuardLastAction === "disconnect") {
    summary = t("Voice Guard hat die Session beendet", "Voice guard ended the session");
  } else if (bot.voiceGuardLastAction === "return") {
    summary = t("Voice Guard plant Rueckkehr in den Ziel-Channel", "Voice guard is returning to the target channel");
  } else if (bot.voiceGuardLastAction === "cooldown") {
    summary = t("Voice Guard pausiert weitere Rueckspruenge", "Voice guard is pausing further returns");
  } else if (bot.shouldReconnect && !bot.playing) {
    summary = t("Wartet auf Wiederverbindung", "Waiting for reconnect");
  } else if (bot.lastProcessExitDetail) {
    summary = t(`Letzter Exit: ${bot.lastProcessExitDetail}`, `Last exit: ${bot.lastProcessExitDetail}`);
  } else if (bot.lastStreamEndReason) {
    summary = t(`Letztes Stream-Ende: ${bot.lastStreamEndReason}`, `Last stream end: ${bot.lastStreamEndReason}`);
  }

  const detailLines = [];
  if (bot.restoreCooldownMs > 0) {
    detailLines.push(t(
      `Restore blockiert fuer ${formatDashboardDuration(bot.restoreCooldownMs)}${bot.restoreBlockReason ? ` | ${bot.restoreBlockReason}` : ""}`,
      `Restore blocked for ${formatDashboardDuration(bot.restoreCooldownMs)}${bot.restoreBlockReason ? ` | ${bot.restoreBlockReason}` : ""}`
    ));
  }
  if (bot.reconnectCircuitRemainingMs > 0) {
    detailLines.push(t(
      `Reconnect-Circuit offen fuer ${formatDashboardDuration(bot.reconnectCircuitRemainingMs)}${bot.reconnectCircuitTripCount > 0 ? ` | Trip ${bot.reconnectCircuitTripCount}` : ""}`,
      `Reconnect circuit open for ${formatDashboardDuration(bot.reconnectCircuitRemainingMs)}${bot.reconnectCircuitTripCount > 0 ? ` | trip ${bot.reconnectCircuitTripCount}` : ""}`
    ));
  }
  if (bot.lastProcessExitDetail || bot.lastProcessExitCode !== null) {
    const exitLabel = [
      bot.lastProcessExitDetail || "",
      bot.lastProcessExitCode !== null && bot.lastProcessExitCode !== undefined
        ? t(`Code ${bot.lastProcessExitCode}`, `Code ${bot.lastProcessExitCode}`)
        : "",
      bot.lastProcessExitAt ? formatDashboardTimestampLabel(bot.lastProcessExitAt, formatDate) : "",
    ].filter(Boolean).join(" | ");
    if (exitLabel) {
      detailLines.push(t(`Prozess-Exit: ${exitLabel}`, `Process exit: ${exitLabel}`));
    }
  }
  if (bot.lastStreamEndReason) {
    detailLines.push(t(`Stream-Ende: ${bot.lastStreamEndReason}`, `Stream end: ${bot.lastStreamEndReason}`));
  }
  if (bot.lastNetworkFailureAt) {
    detailLines.push(t(
      `Letzter Netzwerkfehler: ${formatDashboardTimestampLabel(bot.lastNetworkFailureAt, formatDate)}`,
      `Last network failure: ${formatDashboardTimestampLabel(bot.lastNetworkFailureAt, formatDate)}`
    ));
  }
  if (bot.voiceDisconnectObservedAt) {
    detailLines.push(t(
      `Voice-Disconnect gesehen: ${formatDashboardTimestampLabel(bot.voiceDisconnectObservedAt, formatDate)}`,
      `Voice disconnect observed: ${formatDashboardTimestampLabel(bot.voiceDisconnectObservedAt, formatDate)}`
    ));
  }
  if (bot.voiceGuardLastAction) {
    const actionParts = [
      bot.voiceGuardLastAction,
      bot.voiceGuardLastActionReason || "",
      bot.voiceGuardLastActionAt ? formatDashboardTimestampLabel(bot.voiceGuardLastActionAt, formatDate) : "",
    ].filter(Boolean).join(" | ");
    detailLines.push(t(`Voice Guard: ${actionParts}`, `Voice guard: ${actionParts}`));
  }
  if (bot.voiceGuardMoveCount > 0 || bot.voiceGuardReturnCount > 0 || bot.voiceGuardDisconnectCount > 0) {
    detailLines.push(t(
      `Moves: ${bot.voiceGuardMoveCount} | Returns: ${bot.voiceGuardReturnCount} | Disconnects: ${bot.voiceGuardDisconnectCount}`,
      `Moves: ${bot.voiceGuardMoveCount} | Returns: ${bot.voiceGuardReturnCount} | Disconnects: ${bot.voiceGuardDisconnectCount}`
    ));
  }

  return {
    summary,
    detailLines: detailLines.slice(0, 4),
    flags: flags.slice(0, 4),
  };
}

function normalizeDashboardHealthIncidentStatusFilter(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "open" || normalized === "acknowledged") return normalized;
  return "all";
}

function normalizeDashboardHealthIncident(source = {}) {
  const input = source && typeof source === "object" ? source : {};
  const eventKey = String(input.eventKey || "").trim().toLowerCase();
  if (!eventKey) return null;

  const payload = input?.payload && typeof input.payload === "object" ? input.payload : {};
  const acknowledgedBy = input?.acknowledgedBy && typeof input.acknowledgedBy === "object"
    ? {
      id: String(input.acknowledgedBy.id || "").trim() || null,
      username: String(input.acknowledgedBy.username || "").trim() || null,
    }
    : null;
  const acknowledgedAt = String(input.acknowledgedAt || "").trim() || null;
  return {
    id: String(input.id || "").trim() || buildConnectionEventEntryId({
      timestamp: input.timestamp || "",
      botId: input?.runtime?.id || "",
      eventType: eventKey,
      channelId: payload.previousStationKey || payload.failoverStationKey || payload.recoveredStationKey || "",
      details: payload.triggerError || payload.restartReason || "",
    }),
    eventKey,
    severity: ["success", "warning", "critical"].includes(String(input.severity || "").trim().toLowerCase())
      ? String(input.severity).trim().toLowerCase()
      : (eventKey === "stream_recovered" ? "success" : eventKey === "stream_failover_exhausted" ? "critical" : "warning"),
    timestamp: String(input.timestamp || "").trim() || null,
    acknowledgedAt,
    acknowledgedBy,
    status: acknowledgedAt ? "acknowledged" : "open",
    runtime: input?.runtime && typeof input.runtime === "object"
      ? {
        id: String(input.runtime.id || "").trim() || null,
        name: String(input.runtime.name || "").trim() || null,
        role: String(input.runtime.role || "").trim() || null,
      }
      : null,
    payload: {
      previousStationName: String(payload.previousStationName || "").trim() || null,
      recoveredStationName: String(payload.recoveredStationName || "").trim() || null,
      failoverStationName: String(payload.failoverStationName || "").trim() || null,
      restartReason: String(payload.restartReason || "").trim() || null,
      triggerError: String(payload.triggerError || "").trim() || null,
      streamErrorCount: Math.max(0, Number(payload.streamErrorCount || 0) || 0),
      reconnectAttempts: Math.max(0, Number(payload.reconnectAttempts || 0) || 0),
      listenerCount: Math.max(0, Number(payload.listenerCount || 0) || 0),
      attemptedCandidates: Array.isArray(payload.attemptedCandidates)
        ? payload.attemptedCandidates.map((entry) => String(entry || "").trim()).filter(Boolean).slice(0, 6)
        : [],
    },
  };
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
    incidents: Array.isArray(input.incidents) ? input.incidents.map((incident) => normalizeDashboardHealthIncident(incident)).filter(Boolean) : [],
    bots: Array.isArray(input.bots) ? input.bots.map((bot) => normalizeDashboardHealthBot(bot)).filter(Boolean) : [],
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

function buildDashboardHealthIncidentCounts(source = {}) {
  const health = normalizeDashboardHealth(source);
  return health.incidents.reduce((summary, incident) => {
    summary.all += 1;
    if (incident.status === "acknowledged") {
      summary.acknowledged += 1;
    } else {
      summary.open += 1;
    }
    return summary;
  }, { all: 0, open: 0, acknowledged: 0 });
}

function buildDashboardHealthIncidentRows(source = {}, {
  t = (de, en) => de,
  formatDate = null,
  statusFilter = "all",
  maxItems = 20,
} = {}) {
  const health = normalizeDashboardHealth(source);
  const normalizedStatusFilter = normalizeDashboardHealthIncidentStatusFilter(statusFilter);
  const safeMaxItems = Math.max(1, Number.parseInt(String(maxItems || 20), 10) || 20);
  return health.incidents
    .filter((incident) => normalizedStatusFilter === "all" || incident.status === normalizedStatusFilter)
    .slice(0, safeMaxItems)
    .map((incident, index) => {
    const runtimeName = incident?.runtime?.name || t("Runtime", "Runtime");
    const runtimeRole = incident?.runtime?.role ? String(incident.runtime.role).toUpperCase() : "";
    const previousStation = incident?.payload?.previousStationName || t("Unbekannte Station", "Unknown station");
    const recoveredStation = incident?.payload?.recoveredStationName || previousStation;
    const failoverStation = incident?.payload?.failoverStationName || t("Fallback unbekannt", "Fallback unknown");
    const attemptedCount = incident?.payload?.attemptedCandidates?.length || 0;
    const timestampLabel = incident?.timestamp && typeof formatDate === "function"
      ? formatDate(incident.timestamp, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : incident?.timestamp
        ? new Date(incident.timestamp).toLocaleString("en-US", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
        : "";

    let title = t("Reliability-Ereignis", "Reliability event");
    let detail = runtimeName;
    if (incident.eventKey === "stream_healthcheck_stalled") {
      title = t("Stream-Healthcheck ausgelöst", "Stream health check triggered");
      detail = `${previousStation} | ${runtimeName}`;
    } else if (incident.eventKey === "stream_recovered") {
      title = t("Stream wiederhergestellt", "Stream recovered");
      detail = `${recoveredStation} | ${runtimeName}`;
    } else if (incident.eventKey === "stream_failover_activated") {
      title = t("Failover aktiviert", "Failover activated");
      detail = `${previousStation} -> ${failoverStation}`;
    } else if (incident.eventKey === "stream_failover_exhausted") {
      title = t("Failover ausgeschoepft", "Failover exhausted");
      detail = attemptedCount > 0
        ? t(`${previousStation} | ${attemptedCount} Kandidaten ohne Erfolg`, `${previousStation} | ${attemptedCount} candidates failed`)
        : previousStation;
    }

    const chips = [
      runtimeName && runtimeName !== t("Runtime", "Runtime") ? runtimeName : "",
      runtimeRole,
      incident?.payload?.listenerCount > 0 ? t(`${incident.payload.listenerCount} Zuhoerer`, `${incident.payload.listenerCount} listeners`) : "",
      incident?.payload?.reconnectAttempts > 0 ? t(`${incident.payload.reconnectAttempts} Reconnects`, `${incident.payload.reconnectAttempts} reconnects`) : "",
      incident?.payload?.streamErrorCount > 0 ? t(`${incident.payload.streamErrorCount} Fehler`, `${incident.payload.streamErrorCount} errors`) : "",
    ].filter(Boolean).slice(0, 3);

    return {
      id: incident.id || `${incident.eventKey}-${index}`,
      severity: incident.severity,
      status: incident.status,
      isAcknowledged: incident.status === "acknowledged",
      title,
      detail,
      timestampLabel,
      acknowledgedLabel: incident?.acknowledgedAt && typeof formatDate === "function"
        ? formatDate(incident.acknowledgedAt, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
        : incident?.acknowledgedAt
          ? new Date(incident.acknowledgedAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })
          : "",
      acknowledgedByLabel: incident?.acknowledgedBy?.username || incident?.acknowledgedBy?.id || "",
      errorLabel: incident?.payload?.triggerError ? String(incident.payload.triggerError).slice(0, 160) : "",
      chips,
    };
  });
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
    const retries = Math.max(0, Number(row?.retries || 0) || 0);
    const disconnects = Math.max(0, Number(row?.disconnects || 0) || 0);
    const errors = Math.max(0, Number(row?.errors || 0) || 0);
    const successfulConnections = connects + reconnects;
    const disruptions = disconnects + errors;

    return {
      date: row?.date || "",
      label,
      connects,
      reconnects,
      retries,
      disconnects,
      errors,
      issues: retries + disconnects + errors,
      reliability: successfulConnections > 0
        ? Math.max(0, Math.min(100, Math.round((successfulConnections / (successfulConnections + disruptions)) * 100)))
        : null,
    };
  });
}

function buildSessionTimelineRows(sessionHistory = [], formatDate = null) {
  return (Array.isArray(sessionHistory) ? sessionHistory : [])
    .slice(0, 20)
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
        id: session?.id || buildSessionHistoryEntryId(session),
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
  buildDashboardHealthBotDebug,
  buildDashboardHealthAlerts,
  buildDashboardHealthIncidentCounts,
  buildDashboardHealthIncidentRows,
  buildDashboardHealthStatus,
  buildConnectionTimelineRows,
  buildConnectionEventEntryId,
  normalizeDashboardHealthIncidentStatusFilter,
  buildSessionQualitySummary,
  buildSessionHistoryEntryId,
  formatDashboardDuration,
  buildReliabilitySummary,
  buildSessionTimelineRows,
  buildVoiceChannelUsageRows,
};
