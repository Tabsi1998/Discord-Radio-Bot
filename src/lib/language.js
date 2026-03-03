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
  return normalizeLanguage(language, getDefaultLanguage()) === "de" ? de : en;
}

function buildMessageCatalog(entries) {
  const map = new Map();
  for (const entry of entries) {
    const values = [entry.de, entry.en, ...(entry.aliases || [])];
    for (const value of values) {
      const normalized = String(value || "").trim();
      if (!normalized) continue;
      map.set(normalized, entry);
    }
  }
  return map;
}

function translateCatalogMessage(message, language, catalog) {
  const value = String(message || "").trim();
  if (!value) return value;
  const match = catalog.get(value);
  if (!match) return value;
  return languagePick(language, match.de, match.en);
}

const permissionStoreCatalog = buildMessageCatalog([
  {
    de: "Ungültige Guild-ID.",
    en: "Invalid guild ID.",
    aliases: ["Ungueltige Guild-ID."],
  },
  {
    de: "Command wird nicht unterstützt.",
    en: "Command is not supported.",
    aliases: ["Command wird nicht unterstuetzt."],
  },
  {
    de: "Ungültige Rollen-ID.",
    en: "Invalid role ID.",
    aliases: ["Ungueltige Rollen-ID."],
  },
  {
    de: "Mode muss 'allow' oder 'deny' sein.",
    en: "Mode must be 'allow' or 'deny'.",
  },
]);

const scheduledEventCatalog = buildMessageCatalog([
  {
    de: "Event ist ungültig.",
    en: "Event is invalid.",
    aliases: ["Event ist ungueltig."],
  },
  {
    de: "Event-ID fehlt.",
    en: "Event ID is missing.",
  },
  {
    de: "Event nicht gefunden.",
    en: "Event was not found.",
  },
  {
    de: "Event-Update ist ungültig.",
    en: "Event update is invalid.",
    aliases: ["Event-Update ist ungueltig."],
  },
]);

const customStationCatalog = buildMessageCatalog([
  {
    de: "Ungültiger Station-Key.",
    en: "Invalid station key.",
    aliases: ["Ungueltiger Station-Key."],
  },
  {
    de: "Name darf nicht leer sein.",
    en: "Name must not be empty.",
  },
  {
    de: "URL darf nicht leer sein.",
    en: "URL must not be empty.",
  },
  {
    de: "URL-Format ungültig.",
    en: "Invalid URL format.",
    aliases: ["URL-Format ungueltig."],
  },
  {
    de: "URL muss mit http:// oder https:// beginnen.",
    en: "URL must start with http:// or https://.",
  },
  {
    de: "URLs mit Benutzername/Passwort sind nicht erlaubt.",
    en: "URLs with username/password are not allowed.",
    aliases: ["URL mit Benutzername/Passwort sind nicht erlaubt."],
  },
  {
    de: "Lokale/private Hosts sind nicht erlaubt.",
    en: "Local/private hosts are not allowed.",
  },
  {
    de: "Host konnte nicht aufgelöst werden.",
    en: "Host could not be resolved.",
    aliases: ["Host konnte nicht aufgeloest werden."],
  },
]);

function translatePermissionStoreMessage(message, language = "de") {
  return translateCatalogMessage(message, language, permissionStoreCatalog);
}

function translateScheduledEventStoreMessage(message, language = "de") {
  return translateCatalogMessage(message, language, scheduledEventCatalog);
}

function translateCustomStationErrorMessage(message, language = "de") {
  const value = String(message || "").trim();
  if (!value) return value;

  const maxStationsMatch = value.match(/^Maximum (\d+) Custom-Stationen erreicht\.$/);
  if (maxStationsMatch) {
    return languagePick(
      language,
      `Maximum ${maxStationsMatch[1]} Custom-Stationen erreicht.`,
      `Maximum of ${maxStationsMatch[1]} custom stations reached.`
    );
  }

  const duplicateKeyMatch = value.match(/^Station mit Key '([^']+)' existiert bereits\.$/);
  if (duplicateKeyMatch) {
    return languagePick(
      language,
      `Station mit Key '${duplicateKeyMatch[1]}' existiert bereits.`,
      `Station with key '${duplicateKeyMatch[1]}' already exists.`
    );
  }

  return translateCatalogMessage(value, language, customStationCatalog);
}

function getFeatureRequirementMessage(featureResult, language = "de") {
  if (!featureResult || featureResult.ok) return "";
  if (normalizeLanguage(language, getDefaultLanguage()) !== "de") {
    return String(featureResult.message || "Feature not available.");
  }

  const labels = {
    hqAudio: "HQ Audio (128k Opus)",
    ultraAudio: "Ultra HQ Audio (320k)",
    priorityReconnect: "Priority Auto-Reconnect",
    instantReconnect: "Instant Reconnect",
    premiumStations: "100+ Premium-Stationen",
    customStationURLs: "Custom-Station-URLs",
    commandPermissions: "Rollenbasierte Command-Berechtigungen",
    scheduledEvents: "Event-Scheduler mit Auto-Play",
  };
  const label = labels[featureResult.featureKey] || featureResult.featureKey || "Dieses Feature";
  const requiredPlanName = PLANS[featureResult.requiredPlan]?.name || String(featureResult.requiredPlan || "Pro");
  const planLabel = TIERS.free.name === "Free"
    ? `OmniFM **${requiredPlanName}**`
    : `**${requiredPlanName}**`;
  return `**${label}** erfordert ${planLabel} oder höher.`;
}

export {
  resolveLanguageFromDiscordLocale,
  languagePick,
  translatePermissionStoreMessage,
  translateScheduledEventStoreMessage,
  translateCustomStationErrorMessage,
  getFeatureRequirementMessage,
};
