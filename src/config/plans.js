// ============================================================
// OmniFM - Plan Configuration (Single Source of Truth)
// ============================================================

export const PLAN_ORDER = ["free", "pro", "ultimate"];

export const PLANS = {
  free: {
    id: "free",
    name: "Free",
    maxBots: 2,
    bitrate: "64k",
    bitrateNum: 64,
    reconnectMs: 5000,
    features: {
      hqAudio: false,
      ultraAudio: false,
      priorityReconnect: false,
      instantReconnect: false,
      premiumStations: false,
      customStationURLs: false,
      commandPermissions: false,
    },
  },
  pro: {
    id: "pro",
    name: "Pro",
    maxBots: 8,
    bitrate: "128k",
    bitrateNum: 128,
    reconnectMs: 1500,
    features: {
      hqAudio: true,
      ultraAudio: false,
      priorityReconnect: true,
      instantReconnect: false,
      premiumStations: true,
      customStationURLs: false,
      commandPermissions: true,
    },
  },
  ultimate: {
    id: "ultimate",
    name: "Ultimate",
    maxBots: 16,
    bitrate: "320k",
    bitrateNum: 320,
    reconnectMs: 400,
    features: {
      hqAudio: true,
      ultraAudio: true,
      priorityReconnect: true,
      instantReconnect: true,
      premiumStations: true,
      customStationURLs: true,
      commandPermissions: true,
    },
  },
};

export const FEATURE_LABELS = {
  hqAudio:            "HQ Audio (128k Opus)",
  ultraAudio:         "Ultra HQ Audio (320k)",
  priorityReconnect:  "Priority Auto-Reconnect",
  instantReconnect:   "Instant Reconnect",
  premiumStations:    "100+ Premium Stations",
  customStationURLs:  "Custom Station URLs",
  commandPermissions: "Rollenbasierte Command-Berechtigungen",
};

export const BRAND = {
  name: "OmniFM",
  tagline: "Streaming the future of radio",
  footer: "Powered by OmniFM",
  presence: "Streaming the future of radio | /play",
  color: 0x00F0FF,
  colorHex: "#00F0FF",
  proColor: 0xFFB800,
  ultimateColor: 0xBD00FF,
  upgradeUrl: "",
};
