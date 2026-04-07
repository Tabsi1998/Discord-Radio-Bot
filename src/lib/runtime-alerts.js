import { getDb, isConnected } from "./db.js";
import {
  buildDashboardWebhookPayload,
  deliverDashboardWebhook,
  normalizeDashboardExportsWebhookConfig,
  shouldDeliverDashboardWebhook,
} from "./dashboard-webhooks.js";
import { log } from "./logging.js";
import { serverHasCapability } from "../core/entitlements.js";

async function loadRuntimeWebhookConfig(guildId) {
  if (!isConnected() || !getDb()) return null;

  try {
    const settings = await getDb().collection("guild_settings").findOne(
      { guildId: String(guildId || "").trim() },
      { projection: { exportsWebhook: 1 } }
    );
    return normalizeDashboardExportsWebhookConfig(settings?.exportsWebhook || {});
  } catch {
    return null;
  }
}

export async function dispatchRuntimeReliabilityWebhook(input, deps = {}) {
  const guildId = String(input?.guildId || "").trim();
  const eventKey = String(input?.eventKey || "").trim().toLowerCase();
  if (!guildId || !eventKey) {
    return { attempted: false, delivered: false, skipped: "invalid" };
  }

  const hasCapability = typeof deps.hasCapability === "function"
    ? deps.hasCapability
    : (targetGuildId) => serverHasCapability(targetGuildId, "exports_webhooks");
  if (!hasCapability(guildId)) {
    return { attempted: false, delivered: false, skipped: "capability" };
  }

  const resolvedConfig = input?.webhookConfig && typeof input.webhookConfig === "object"
    ? normalizeDashboardExportsWebhookConfig(input.webhookConfig)
    : await (typeof deps.loadWebhookConfig === "function"
      ? deps.loadWebhookConfig(guildId)
      : loadRuntimeWebhookConfig(guildId));
  if (!resolvedConfig) {
    return { attempted: false, delivered: false, skipped: "config" };
  }

  const shouldDeliver = typeof deps.shouldDeliver === "function"
    ? deps.shouldDeliver
    : shouldDeliverDashboardWebhook;
  if (!shouldDeliver(resolvedConfig, eventKey)) {
    return { attempted: false, delivered: false, skipped: "disabled" };
  }

  const buildPayload = typeof deps.buildPayload === "function"
    ? deps.buildPayload
    : buildDashboardWebhookPayload;
  const payload = buildPayload(eventKey, {
    source: input?.source || "runtime",
    server: {
      id: guildId,
      name: String(input?.guildName || guildId).trim(),
      tier: String(input?.tier || "").trim().toLowerCase(),
    },
    actor: input?.actor || null,
    payload: input?.payload && typeof input.payload === "object" ? input.payload : {},
  });

  const deliver = typeof deps.deliver === "function"
    ? deps.deliver
    : deliverDashboardWebhook;
  const delivery = await deliver(resolvedConfig, eventKey, payload);

  if (!delivery?.delivered) {
    const logger = typeof deps.logger === "function" ? deps.logger : log;
    logger(
      "WARN",
      `[runtime-alerts] Webhook delivery failed guild=${guildId} event=${eventKey}: ${delivery?.error || delivery?.status || "unknown"}`
    );
  }

  return {
    ...delivery,
    payloadPreview: payload,
  };
}
