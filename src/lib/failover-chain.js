const MAX_FAILOVER_CHAIN_LENGTH = 5;

function normalizeFailoverKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeFailoverChain(input, maxLength = MAX_FAILOVER_CHAIN_LENGTH) {
  const values = Array.isArray(input)
    ? input
    : input === undefined || input === null || input === ""
      ? []
      : [input];
  const out = [];
  const seen = new Set();

  for (const rawValue of values) {
    const key = normalizeFailoverKey(rawValue);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= maxLength) break;
  }

  return out;
}

function buildFailoverCandidateChain({
  currentStationKey = "",
  configuredChain = [],
  fallbackStation = "",
  automaticFallbackKey = "",
} = {}) {
  const combined = normalizeFailoverChain([
    ...normalizeFailoverChain(configuredChain),
    fallbackStation,
    automaticFallbackKey,
  ]);
  const currentKey = normalizeFailoverKey(currentStationKey);
  return combined.filter((key) => key !== currentKey);
}

function getPrimaryFailoverStation(configuredChain = [], fallbackStation = "") {
  const chain = buildFailoverCandidateChain({
    configuredChain,
    fallbackStation,
  });
  return chain[0] || "";
}

export {
  MAX_FAILOVER_CHAIN_LENGTH,
  buildFailoverCandidateChain,
  getPrimaryFailoverStation,
  normalizeFailoverChain,
  normalizeFailoverKey,
};
