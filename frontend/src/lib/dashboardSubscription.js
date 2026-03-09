export function formatSubscriptionPriceCents(cents, locale = 'de-AT') {
  const amount = Math.max(0, Number(cents || 0) || 0) / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
}

export function buildSubscriptionLimitCards(data, t) {
  const license = data?.license || {};
  const currentPlan = data?.currentPlan || {};
  const limits = currentPlan?.limits || {};
  const seats = Math.max(1, Number(license.seats || 1) || 1);
  const seatsUsed = Math.max(0, Number(license.seatsUsed || 0) || 0);
  const seatsAvailable = Math.max(0, Number(license.seatsAvailable || (seats - seatsUsed)) || 0);

  return [
    {
      key: 'seats',
      label: t('Seat-Status', 'Seat status'),
      value: `${seatsUsed} / ${seats}`,
      detail: seatsAvailable > 0
        ? t(`${seatsAvailable} frei`, `${seatsAvailable} free`)
        : t('Keine freien Seats', 'No free seats'),
    },
    {
      key: 'bots',
      label: t('Bot-Limit', 'Bot limit'),
      value: String(Math.max(0, Number(limits.maxBots || 0) || 0)),
      detail: t('gleichzeitig verwaltbar', 'manageable in parallel'),
    },
    {
      key: 'bitrate',
      label: t('Audio-Profil', 'Audio profile'),
      value: String(limits.bitrate || '64k'),
      detail: t('maximale Streaming-Qualitaet', 'maximum streaming quality'),
    },
    {
      key: 'reconnect',
      label: t('Reconnect', 'Reconnect'),
      value: `${Math.max(0, Number(limits.reconnectMs || 0) || 0)} ms`,
      detail: t('Ziel fuer Auto-Recovery', 'target for auto recovery'),
    },
  ];
}

export function buildSubscriptionUpgradeSummary(data, blockedFeatureLabels, t) {
  const recommended = data?.recommendedUpgrade || null;
  if (!recommended) return null;

  const highlights = [];
  if (Array.isArray(blockedFeatureLabels)) {
    for (const label of blockedFeatureLabels) {
      if (!label) continue;
      highlights.push(label);
      if (highlights.length >= 3) break;
    }
  }

  return {
    tier: recommended.tier,
    title: t(
      `Naechster sinnvoller Schritt: ${String(recommended.tierName || recommended.tier || '').toUpperCase()}`,
      `Best next step: ${String(recommended.tierName || recommended.tier || '').toUpperCase()}`
    ),
    description: t(
      `Bis zu ${recommended.limits?.maxBots || 0} Bots, ${recommended.limits?.bitrate || '-'} Audio und ${highlights.length > 0 ? highlights.join(', ') : 'mehr Funktionen'} auf einem Upgrade-Pfad.`,
      `Up to ${recommended.limits?.maxBots || 0} bots, ${recommended.limits?.bitrate || '-'} audio, and ${highlights.length > 0 ? highlights.join(', ') : 'more features'} on a clear upgrade path.`
    ),
    highlights,
    pricing: recommended.pricing || {},
    upgradeCostCents: Number(recommended.upgradeCostCents || 0) || 0,
    daysLeft: Number(recommended.daysLeft || 0) || 0,
  };
}
