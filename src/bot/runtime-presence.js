import { ActivityType } from "discord.js";

import { clipText } from "../lib/helpers.js";
import { WEBSITE_URL } from "./runtime-links.js";

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
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
  const workerSlot = Number(runtime.workerSlot || runtime.config?.index || 0) || null;

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
  const commanderName = clipText(runtime.config?.name || "OmniFM DJ", 48) || "OmniFM DJ";

  if (runtime.role === "commander") {
    if (activeStreams > 0) {
      return {
        type: ActivityType.Playing,
        name: clipText(`DJ on ${countLabel(activeStreams, "server")}${listenerSuffix}`, 120),
      };
    }
    return {
      type: ActivityType.Listening,
      name: clipText(
        publicLabel
          ? `${commanderName} | /play | ${publicLabel}`
          : `${commanderName} | /play | ${countLabel(connectedGuilds, "server")}`,
        120
      ),
    };
  }

  if (activeStreams > 0) {
    return {
      type: ActivityType.Playing,
      name: clipText(`Play on ${countLabel(activeStreams, "server")}${listenerSuffix}`, 120),
    };
  }

  return {
    type: ActivityType.Listening,
    name: clipText(
      publicLabel
        ? `Worker ${workerSlot || "?"} ready | /play | ${publicLabel}`
        : `Worker ${workerSlot || "?"} ready | /play`,
      120
    ),
  };
}
