export const DASHBOARD_EXPORT_WEBHOOK_EVENTS = Object.freeze([
  { key: 'stats_exported', de: 'Stats-Exporte', en: 'Stats exports' },
  { key: 'custom_stations_exported', de: 'Custom-Station-Exporte', en: 'Custom station exports' },
]);

export const DASHBOARD_EXPORTS_WEBHOOK_DEFAULTS = Object.freeze({
  enabled: false,
  url: '',
  secret: '',
  events: [],
});

export function normalizeDashboardExportsWebhookConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const events = [];
  const seen = new Set();

  for (const event of Array.isArray(config.events) ? config.events : []) {
    const key = String(event || '').trim().toLowerCase();
    if (!DASHBOARD_EXPORT_WEBHOOK_EVENTS.some((entry) => entry.key === key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(key);
  }

  return {
    enabled: config.enabled === true,
    url: String(config.url || '').trim(),
    secret: String(config.secret || '').trim(),
    events,
  };
}

export function getDashboardExportWebhookEventLabel(eventKey, t) {
  const match = DASHBOARD_EXPORT_WEBHOOK_EVENTS.find((event) => event.key === String(eventKey || '').trim().toLowerCase());
  return match ? t(match.de, match.en) : String(eventKey || '');
}

export function buildDashboardExportsWebhookSummary(rawConfig, t) {
  const config = normalizeDashboardExportsWebhookConfig(rawConfig);
  if (!config.url) {
    return {
      statusLabel: t('Nicht konfiguriert', 'Not configured'),
      statusAccent: '#71717A',
      description: t(
        'Lege eine URL fest, um Stats- oder Stations-Exporte an deine Automationen weiterzugeben.',
        'Add a URL to forward stats or station exports to your automations.'
      ),
    };
  }

  if (config.enabled) {
    return {
      statusLabel: t('Aktiv', 'Active'),
      statusAccent: '#10B981',
      description: t(
        'Export-Webhooks werden bei passenden Exporten automatisch ausgeloest.',
        'Export webhooks are triggered automatically for matching exports.'
      ),
    };
  }

  return {
    statusLabel: t('Bereit', 'Ready'),
    statusAccent: '#8B5CF6',
    description: t(
      'Die Webhook-Ziele sind gespeichert, aber automatische Ausloesungen sind aktuell deaktiviert.',
      'The webhook target is saved, but automatic triggers are currently disabled.'
    ),
  };
}

export function buildDashboardExportDownloadName(kind, serverId, exportedAt = new Date()) {
  const safeKind = String(kind || 'export').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'export';
  const safeServerId = String(serverId || 'server').trim().replace(/[^a-z0-9_-]/gi, '') || 'server';
  const date = new Date(exportedAt);
  const stamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
  ].join('');
  return `omnifm-${safeKind}-${safeServerId}-${stamp}.json`;
}
