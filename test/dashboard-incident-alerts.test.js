import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeDashboardIncidentAlertsConfig,
  validateDashboardIncidentAlertsConfig,
  shouldDeliverDashboardIncidentAlert,
} from "../src/lib/dashboard-incident-alerts.js";

test("dashboard incident alert helpers normalize config and gate delivery", () => {
  const config = normalizeDashboardIncidentAlertsConfig({
    enabled: true,
    channelId: "523456789012345678",
    events: ["stream_recovered", "stream_failover_exhausted", "stream_recovered", "invalid"],
  });

  assert.deepEqual(config, {
    enabled: true,
    channelId: "523456789012345678",
    events: ["stream_recovered", "stream_failover_exhausted"],
  });
  assert.equal(shouldDeliverDashboardIncidentAlert(config, "stream_recovered"), true);
  assert.equal(shouldDeliverDashboardIncidentAlert(config, "stream_healthcheck_stalled"), false);
});

test("dashboard incident alert validation rejects invalid text channel ids", () => {
  const validated = validateDashboardIncidentAlertsConfig({
    enabled: true,
    channelId: "alerts",
    events: ["stream_failover_exhausted"],
  });

  assert.equal(validated.ok, false);
  assert.match(validated.error, /Text-Channel/i);
});
