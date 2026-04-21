export const DASHBOARD_CAPABILITY_DEFAULTS = Object.freeze({
  dashboardAccess: false,
  eventScheduler: false,
  rolePermissions: false,
  weeklyDigest: false,
  basicHealth: false,
  customStationUrls: false,
  advancedAnalytics: false,
  failoverRules: false,
  licenseWorkspace: false,
  exportsWebhooks: false,
  voiceGuard: false,
});

export const DASHBOARD_CAPABILITY_REQUIRED_TIERS = Object.freeze({
  dashboardAccess: 'pro',
  eventScheduler: 'pro',
  rolePermissions: 'pro',
  weeklyDigest: 'pro',
  basicHealth: 'pro',
  customStationUrls: 'ultimate',
  advancedAnalytics: 'ultimate',
  failoverRules: 'ultimate',
  licenseWorkspace: 'ultimate',
  exportsWebhooks: 'ultimate',
  voiceGuard: 'free',
});

const DASHBOARD_CAPABILITY_LABELS = Object.freeze({
  dashboardAccess: { de: 'Dashboard-Zugriff', en: 'Dashboard access' },
  eventScheduler: { de: 'Event-Planer', en: 'Event scheduler' },
  rolePermissions: { de: 'Rollenrechte', en: 'Role permissions' },
  weeklyDigest: { de: 'Wochen-Digest', en: 'Weekly digest' },
  basicHealth: { de: 'Health-Übersicht', en: 'Health overview' },
  customStationUrls: { de: 'Custom-Stationen', en: 'Custom stations' },
  advancedAnalytics: { de: 'Advanced Analytics', en: 'Advanced analytics' },
  failoverRules: { de: 'Failover-Regeln', en: 'Failover rules' },
  licenseWorkspace: { de: 'Lizenz-Workspace', en: 'License workspace' },
  exportsWebhooks: { de: 'Exporte & Webhooks', en: 'Exports & webhooks' },
  voiceGuard: { de: 'Voice Guard', en: 'Voice guard' },
});

export function getDashboardCapabilityRequiredTier(capabilityKey) {
  return DASHBOARD_CAPABILITY_REQUIRED_TIERS[String(capabilityKey || '').trim()] || null;
}

export function getDashboardCapabilityLabel(capabilityKey, t) {
  const key = String(capabilityKey || '').trim();
  const entry = DASHBOARD_CAPABILITY_LABELS[key];
  if (entry) {
    return t(entry.de, entry.en);
  }
  return key;
}

export function getDashboardBlockedFeatureLabels(featureKeys, t, limit = Infinity) {
  const labels = [];
  const seen = new Set();
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Number(limit) || 1) : Infinity;

  for (const rawKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const key = String(rawKey || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(getDashboardCapabilityLabel(key, t));
    if (labels.length >= safeLimit) break;
  }

  return labels;
}

export function normalizeDashboardCapabilityPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      serverId: '',
      tier: 'free',
      capabilities: { ...DASHBOARD_CAPABILITY_DEFAULTS },
      limits: {},
      upgradeHints: { nextTier: null, blockedFeatures: [] },
    };
  }

  return {
    serverId: String(payload.serverId || ''),
    tier: String(payload.tier || 'free'),
    capabilities: {
      ...DASHBOARD_CAPABILITY_DEFAULTS,
      ...(payload.capabilities && typeof payload.capabilities === 'object' ? payload.capabilities : {}),
    },
    limits: payload.limits && typeof payload.limits === 'object' ? payload.limits : {},
    upgradeHints: payload.upgradeHints && typeof payload.upgradeHints === 'object'
      ? {
        nextTier: payload.upgradeHints.nextTier || null,
        blockedFeatures: Array.isArray(payload.upgradeHints.blockedFeatures) ? payload.upgradeHints.blockedFeatures : [],
      }
      : { nextTier: null, blockedFeatures: [] },
  };
}
