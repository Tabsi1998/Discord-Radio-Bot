function buildDiscordCustomEmojiToken(emoji) {
  const name = String(emoji?.name || "").trim();
  const id = String(emoji?.id || "").trim();
  if (!name || !/^\d{2,32}$/.test(id)) return "";
  return emoji?.animated
    ? `<a:${name}:${id}>`
    : `<:${name}:${id}>`;
}

function normalizeEmojiEntries(entries) {
  const byName = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    const name = String(entry?.name || "").trim();
    const token = buildDiscordCustomEmojiToken(entry);
    if (!name || !token || byName.has(name)) continue;
    byName.set(name, token);
  }
  return byName;
}

function expandDiscordEmojiAliases(text, entries = []) {
  const source = String(text || "");
  if (!source) return "";

  const emojiTokensByName = normalizeEmojiEntries(entries);
  if (!emojiTokensByName.size) return source;

  const protectedFullTokens = [];
  let normalized = source.replace(/<(a?):([a-zA-Z0-9_]+):(\d+)>/g, (match) => {
    const token = `@@DISCORD_FULL_EMOJI_${protectedFullTokens.length}@@`;
    protectedFullTokens.push({ token, match });
    return token;
  });

  normalized = normalized.replace(/(^|[^<\w]):([A-Za-z0-9_]{2,32}):(?!\d+>)/g, (match, prefix, name) => {
    const token = emojiTokensByName.get(name);
    if (!token) return match;
    return `${prefix}${token}`;
  });

  for (const { token, match } of protectedFullTokens) {
    normalized = normalized.replaceAll(token, match);
  }

  return normalized;
}

export {
  buildDiscordCustomEmojiToken,
  expandDiscordEmojiAliases,
};
