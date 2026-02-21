// ============================================================
// OmniFM - Entitlements (Centralized Permission Checks)
// ============================================================

import { PLANS, PLAN_ORDER, FEATURE_LABELS, BRAND } from "../config/plans.js";

// --- License storage interface (injected) ---
let _getLicenseForServer = null;

export function setLicenseProvider(fn) {
  _getLicenseForServer = fn;
}

// --- Plan helpers ---

export function comparePlans(a, b) {
  const ia = PLAN_ORDER.indexOf(a);
  const ib = PLAN_ORDER.indexOf(b);
  if (ia < ib) return -1;
  if (ia > ib) return 1;
  return 0;
}

export function planAtLeast(current, minimum) {
  return comparePlans(current, minimum) >= 0;
}

export function getServerPlan(serverId) {
  if (!_getLicenseForServer) return "free";
  const license = _getLicenseForServer(String(serverId));
  if (!license || !license.active) return "free";
  return PLANS[license.plan] ? license.plan : "free";
}

export function getServerPlanConfig(serverId) {
  const plan = getServerPlan(serverId);
  return { plan, ...PLANS[plan] };
}

export function getServerSeats(serverId) {
  if (!_getLicenseForServer) return 0;
  const license = _getLicenseForServer(String(serverId));
  return license && license.active ? 1 : 0;
}

export function hasFeature(planId, featureKey) {
  const plan = PLANS[planId];
  if (!plan) return false;
  return !!plan.features[featureKey];
}

export function serverHasFeature(serverId, featureKey) {
  return hasFeature(getServerPlan(serverId), featureKey);
}

// --- Requirement checks (return { ok, message } instead of throwing) ---

export function requirePlan(serverId, minimumPlan) {
  const current = getServerPlan(serverId);
  if (planAtLeast(current, minimumPlan)) {
    return { ok: true };
  }
  const minConfig = PLANS[minimumPlan];
  return {
    ok: false,
    currentPlan: current,
    requiredPlan: minimumPlan,
    message: `This feature requires ${BRAND.name} **${minConfig.name}** or higher. Your server is on the **${PLANS[current].name}** plan.`,
  };
}

export function requireFeature(serverId, featureKey) {
  const plan = getServerPlan(serverId);
  if (hasFeature(plan, featureKey)) {
    return { ok: true };
  }
  const label = FEATURE_LABELS[featureKey] || featureKey;
  const needed = PLAN_ORDER.find(p => PLANS[p].features[featureKey]) || "pro";
  return {
    ok: false,
    currentPlan: plan,
    requiredPlan: needed,
    featureKey,
    message: `**${label}** requires ${BRAND.name} **${PLANS[needed].name}** or higher.`,
  };
}

// --- Bitrate enforcement ---

export function getMaxBitrate(serverId) {
  const plan = getServerPlan(serverId);
  return PLANS[plan].bitrateNum;
}

export function getBitrateFlag(serverId) {
  return PLANS[getServerPlan(serverId)].bitrate;
}

// --- Reconnect policy ---

export function getReconnectDelay(serverId) {
  const plan = getServerPlan(serverId);
  return PLANS[plan].reconnectMs;
}

// --- Bot limit ---

export function getMaxBots(serverId) {
  const plan = getServerPlan(serverId);
  return PLANS[plan].maxBots;
}

export function isBotAllowed(serverId, botIndex) {
  return botIndex <= getMaxBots(serverId);
}
