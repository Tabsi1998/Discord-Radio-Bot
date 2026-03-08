function normalizeCommandRegistrationMode(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "global") return "global";
  if (normalized === "hybrid") return "hybrid";
  return "guild";
}

function resolveCommandRegistrationMode(env = process.env) {
  const explicit = String(env?.COMMAND_REGISTRATION_MODE || "").trim();
  if (explicit) return normalizeCommandRegistrationMode(explicit);

  const legacyGuildSyncEnabled = String(env?.SYNC_GUILD_COMMANDS_ON_BOOT ?? "1") !== "0";
  return legacyGuildSyncEnabled ? "guild" : "global";
}

function usesGuildCommandRegistration(mode) {
  const normalized = normalizeCommandRegistrationMode(mode);
  return normalized === "guild" || normalized === "hybrid";
}

function usesGlobalCommandRegistration(mode) {
  const normalized = normalizeCommandRegistrationMode(mode);
  return normalized === "global" || normalized === "hybrid";
}

export {
  normalizeCommandRegistrationMode,
  resolveCommandRegistrationMode,
  usesGlobalCommandRegistration,
  usesGuildCommandRegistration,
};
