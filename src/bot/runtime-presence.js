import { ActivityType } from "discord.js";

import { clipText } from "../lib/helpers.js";
import { WEBSITE_URL } from "./runtime-links.js";

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function resolveRuntimePresenceName(runtime) {
  const workerSlot = Number(runtime.workerSlot || runtime.config?.index || 0) || null;
  if (runtime.role === "commander") {
    return clipText(runtime.config?.name || "OmniFM DJ", 48) || "OmniFM DJ";
  }
  return clipText(runtime.config?.name || `Worker ${workerSlot || "?"}`, 48) || `Worker ${workerSlot || "?"}`;
}

function resolvePresenceStationLabel(activeStates = []) {
  if (!Array.isArray(activeStates) || activeStates.length !== 1) return "";
  const [, state] = activeStates[0] || [];
  return clipText(
    state?.currentStationName
      || state?.currentStationKey
      || "",
    52
  ) || "";
}

export function buildRuntimePresenceActivity(runtime) {
  const activeStates = [...runtime.guildState.entries()]
    .filter(([, state]) => state.currentStationKey && state.connection);
  const activeStreams = activeStates.length;
  const connectedGuilds = Number(runtime.client?.guilds?.cache?.size || 0) || 0;
  const publicUrlRaw = String(process.env.PUBLIC_WEB_URL || WEBSITE_URL || "").trim();
  const publicLabel = publicUrlRaw
    ? clipText(publicUrlRaw.replace(/\/+$/, ""), 64)
    : "";
  const runtimeName = resolveRuntimePresenceName(runtime);
  const singleStationLabel = resolvePresenceStationLabel(activeStates);

  let totalListeners = 0;
  if (typeof runtime.collectStats === "function") {
    totalListeners = Math.max(0, Number(runtime.collectStats()?.listeners || 0) || 0);
  } else {
    for (const [guildId, state] of activeStates) {
      const listeners = typeof runtime.getCurrentListenerCount === "function"
        ? runtime.getCurrentListenerCount(guildId, state)
        : Number(state?.listenerCount || 0) || 0;
      totalListeners += Math.max(0, Number(listeners || 0) || 0);
    }
  }

  const listenerSuffix = totalListeners > 0 ? ` | ${countLabel(totalListeners, "listener")}` : "";

  if (runtime.role === "commander") {
    if (activeStreams > 0) {
      return {
        type: ActivityType.Playing,
        name: clipText(
          activeStreams === 1 && singleStationLabel
            ? `DJ routing ${singleStationLabel}${listenerSuffix}`
            : `DJ routing ${countLabel(activeStreams, "server")}${listenerSuffix}`,
          120
        ),
      };
    }
    return {
      type: ActivityType.Listening,
      name: clipText(
        publicLabel
          ? `${runtimeName} | /play | ${publicLabel}`
          : `${runtimeName} | /play | ${countLabel(connectedGuilds, "server")}`,
        120
      ),
    };
  }

  if (activeStreams > 0) {
    return {
      type: ActivityType.Playing,
      name: clipText(
        activeStreams === 1 && singleStationLabel
          ? `${runtimeName} | ${singleStationLabel}${listenerSuffix}`
          : `${runtimeName} | ${countLabel(activeStreams, "server")} live${listenerSuffix}`,
        120
      ),
    };
  }

  return {
    type: ActivityType.Listening,
    name: clipText(
      publicLabel
        ? `${runtimeName} ready | /play | ${publicLabel}`
        : `${runtimeName} ready | /play`,
      120
    ),
  };
}
