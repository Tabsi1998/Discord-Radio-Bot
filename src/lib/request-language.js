import {
  getDefaultLanguage,
  normalizeLanguage,
  resolveLanguageFromAcceptLanguage,
} from "../i18n.js";

export function resolveRequestLanguage(headers = {}, explicitLanguage = "", fallback = getDefaultLanguage()) {
  const directLanguage = String(explicitLanguage || headers["x-omnifm-language"] || "").trim();
  if (directLanguage) {
    return normalizeLanguage(directLanguage, fallback);
  }

  return resolveLanguageFromAcceptLanguage(headers["accept-language"], fallback);
}

