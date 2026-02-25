// ============================================================
// OmniFM: Language / i18n Helper Functions
// ============================================================
import { normalizeLanguage, getDefaultLanguage } from "../i18n.js";
import { PLANS } from "../config/plans.js";
import { TIERS } from "./helpers.js";

function resolveLanguageFromDiscordLocale(rawLocale, fallbackLanguage = getDefaultLanguage()) {
  const locale = String(rawLocale || "").trim().toLowerCase();
  if (!locale) return normalizeLanguage(fallbackLanguage, getDefaultLanguage());
  return locale.startsWith("de") ? "de" : "en";
}

function languagePick(language, de, en) {
  return normalizeLanguage(language, "de") === "de" ? de : en;
}

function translatePermissionStoreMessage(message, language = "de") {
  const value = String(message || "").trim();
  const map = {
    "Ungueltige Guild-ID.": "Invalid guild ID.",
    "Command wird nicht unterstuetzt.": "Command is not supported.",
    "Ungueltige Rollen-ID.": "Invalid role ID.",
    "Mode muss 'allow' oder 'deny' sein.": "Mode must be 'allow' or 'deny'.",
  };
  return languagePick(language, value, map[value] || value);
}

function translateScheduledEventStoreMessage(message, language = "de") {
  const value = String(message || "").trim();
  const map = {
    "Event ist ungueltig.": "Event is invalid.",
    "Event-ID fehlt.": "Event ID is missing.",
    "Event nicht gefunden.": "Event was not found.",
    "Event-Update ist ungueltig.": "Event update is invalid.",
  };
  return languagePick(language, value, map[value] || value);
}

function translateCustomStationErrorMessage(message, language = "de") {
  const value = String(message || "").trim();
  if (!value) return value;
  const maxStationsMatch = value.match(/^Maximum (\d+) Custom-Stationen erreicht\.$/);
  if (maxStationsMatch) {
    return languagePick(
      language,
      value,
      `Maximum of ${maxStationsMatch[1]} custom stations reached.`
    );
  }
  const map = {
    "Ungueltiger Station-Key.": "Invalid station key.",
    "Name darf nicht leer sein.": "Name must not be empty.",
    "URL darf nicht leer sein.": "URL must not be empty.",
    "URL-Format ungueltig.": "Invalid URL format.",
    "URL muss mit http:// oder https:// beginnen.": "URL must start with http:// or https://.",
    "URL mit Benutzername/Passwort sind nicht erlaubt.": "URLs with username/password are not allowed.",
    "Lokale/private Hosts sind nicht erlaubt.": "Local/private hosts are not allowed.",
  };
  return languagePick(language, value, map[value] || value);
}

function getFeatureRequirementMessage(featureResult, language = "de") {
  if (!featureResult || featureResult.ok) return "";
  if (normalizeLanguage(language, "de") !== "de") {
    return String(featureResult.message || "Feature not available.");
  }
  const labels = {
    hqAudio: "HQ Audio (128k Opus)",
    ultraAudio: "Ultra HQ Audio (320k)",
    priorityReconnect: "Priority Auto-Reconnect",
    instantReconnect: "Instant Reconnect",
    premiumStations: "100+ Premium Stationen",
    customStationURLs: "Custom-Station URLs",
    commandPermissions: "Rollenbasierte Command-Berechtigungen",
    scheduledEvents: "Event-Scheduler mit Auto-Play",
  };
  const label = labels[featureResult.featureKey] || featureResult.featureKey || "Dieses Feature";
  const requiredPlanName = PLANS[featureResult.requiredPlan]?.name || String(featureResult.requiredPlan || "Pro");
  return `**${label}** erfordert ${TIERS.free.name === "Free" ? "OmniFM" : ""} **${requiredPlanName}** oder hoeher.`;
}

export {
  resolveLanguageFromDiscordLocale,
  languagePick,
  translatePermissionStoreMessage,
  translateScheduledEventStoreMessage,
  translateCustomStationErrorMessage,
  getFeatureRequirementMessage,
};
