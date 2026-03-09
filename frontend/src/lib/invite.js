export function resolvePrimaryInviteUrl(bots) {
  if (!Array.isArray(bots) || bots.length === 0) return '#bots';

  const commanderBot = bots.find((bot) => String(bot?.role || '').toLowerCase() === 'commander')
    || bots.find((bot) => String(bot?.name || '').toLowerCase().includes('dj'))
    || bots.find((bot) => String(bot?.requiredTier || 'free').toLowerCase() === 'free' && (bot?.inviteUrl || bot?.invite_url))
    || bots[0];

  return commanderBot?.inviteUrl || commanderBot?.invite_url || '#bots';
}
