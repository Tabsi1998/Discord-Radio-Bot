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
});

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
