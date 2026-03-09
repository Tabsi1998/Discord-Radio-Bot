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

export function buildSubscriptionNextAction(data, blockedFeatureLabels, t) {
  const license = data?.license || null;
  if (!license) return null;

  const recommendedUpgrade = data?.recommendedUpgrade || null;
  const effectiveTier = String(data?.effectiveTier || license?.plan || data?.tier || 'free').trim().toLowerCase();
  const hasBillingEmail = Boolean(license?.hasBillingEmail || String(license?.emailMasked || '').trim());
  const seats = Math.max(1, Number(license?.seats || 1) || 1);
  const seatsUsed = Math.max(0, Number(license?.seatsUsed || 0) || 0);
  const seatsAvailable = Math.max(0, Number(license?.seatsAvailable || (seats - seatsUsed)) || 0);
  const remainingDays = Number(license?.remainingDays || 0) || 0;
  const upgradeHighlights = Array.isArray(blockedFeatureLabels)
    ? blockedFeatureLabels.filter(Boolean).slice(0, 2)
    : [];

  if (license?.expired) {
    return {
      key: 'renew-expired',
      accent: '#EF4444',
      eyebrow: t('Naechste Aktion', 'Next action'),
      title: t('Diese Lizenz jetzt direkt verlaengern', 'Renew this license right now'),
      body: t(
        'Die Lizenz ist bereits abgelaufen. Starte den Checkout direkt aus dem Dashboard, damit Pro- oder Ultimate-Funktionen wieder freigeschaltet werden.',
        'The license has already expired. Start the checkout directly from the dashboard so Pro or Ultimate features become active again.'
      ),
      cta: {
        kind: 'checkout',
        label: t('Jetzt verlaengern', 'Renew now'),
      },
    };
  }

  if (!hasBillingEmail) {
    return {
      key: 'billing-email',
      accent: '#F59E0B',
      eyebrow: t('Naechste Aktion', 'Next action'),
      title: t('Eine gueltige Lizenz-E-Mail hinterlegen', 'Save a valid license email'),
      body: t(
        'Ohne gueltige E-Mail werden Checkout, Rechnungen und Lizenz-Kommunikation unnoetig fragil. Hinterlege sie direkt in diesem Panel.',
        'Without a valid email, checkout, invoices, and license communication become unnecessarily fragile. Save it directly in this panel.'
      ),
      cta: {
        kind: 'edit-email',
        label: t('E-Mail hinterlegen', 'Add email'),
      },
    };
  }

  if (seatsAvailable <= 0) {
    return {
      key: 'seat-capacity',
      accent: '#F59E0B',
      eyebrow: t('Naechste Aktion', 'Next action'),
      title: t('Seat-Kapazitaet fuer weitere Server planen', 'Plan seat capacity for more servers'),
      body: t(
        'Alle Seats dieser Lizenz sind bereits belegt. Fuer weitere Server brauchst du ein groesseres Seat-Bundle oder eine zweite Lizenz ueber die Hauptseite.',
        'All seats of this license are already linked. Additional servers need a larger seat bundle or a second license on the main site.'
      ),
      cta: {
        kind: 'plans',
        label: t('Seat-Optionen oeffnen', 'Open seat options'),
      },
    };
  }

  if (remainingDays > 0 && remainingDays <= 7) {
    return {
      key: 'renew-soon',
      accent: '#F59E0B',
      eyebrow: t('Naechste Aktion', 'Next action'),
      title: t('Die Verlaengerung vor Ablauf vorbereiten', 'Prepare the renewal before expiry'),
      body: t(
        `Die Lizenz laeuft in ${remainingDays} Tagen ab. Verlaengere sie jetzt direkt im Dashboard, damit es zu keiner Unterbrechung kommt.`,
        `The license expires in ${remainingDays} days. Renew it directly in the dashboard now to avoid any interruption.`
      ),
      cta: {
        kind: 'checkout',
        label: t('Verlaengerung starten', 'Start renewal'),
      },
    };
  }

  if (effectiveTier === 'pro' && recommendedUpgrade) {
    const targetTier = String(recommendedUpgrade?.tierName || recommendedUpgrade?.tier || 'ultimate').toUpperCase();
    const highlightText = upgradeHighlights.length > 0
      ? upgradeHighlights.join(', ')
      : t('mehr Operator-Funktionen', 'more operator features');

    return {
      key: 'review-upgrade',
      accent: '#8B5CF6',
      eyebrow: t('Naechste Aktion', 'Next action'),
      title: t(`Upgrade auf ${targetTier} pruefen`, `Review ${targetTier} upgrade`),
      body: t(
        `Fuer diesen Server sprechen aktuell vor allem ${highlightText} fuer den naechsten Schritt Richtung ${targetTier}.`,
        `For this server, ${highlightText} are currently the strongest reasons for the next step toward ${targetTier}.`
      ),
      cta: {
        kind: 'checkout',
        label: t(`Upgrade zu ${targetTier}`, `Upgrade to ${targetTier}`),
      },
    };
  }

  return null;
}

export function buildSubscriptionPromotionNotes(data, t) {
  const notes = [];
  const license = data?.license || null;
  const promotions = data?.promotions || {};

  if (promotions.couponCodesSupported) {
    notes.push({
      key: 'coupons',
      label: t('Rabattcodes', 'Coupon codes'),
      detail: t(
        'Rabattcodes koennen direkt im Dashboard-Checkout geprueft und angewendet werden.',
        'Coupon codes can be checked and applied directly in the dashboard checkout.'
      ),
    });
  }

  if (promotions.proTrialEnabled && !license) {
    notes.push({
      key: 'trial',
      label: t('Pro-Testmonat', 'Pro trial month'),
      detail: t(
        `Aktuell verfuegbar fuer Neukunden: ${Math.max(1, Number(promotions.proTrialMonths || 1) || 1)} Monat Pro.`,
        `Currently available for new customers: ${Math.max(1, Number(promotions.proTrialMonths || 1) || 1)} month of Pro.`
      ),
    });
  }

  if (license && Number(license.seatsAvailable || 0) <= 0) {
    notes.push({
      key: 'seats-full',
      label: t('Seat-Auslastung', 'Seat usage'),
      detail: t(
        'Alle Seats dieser Lizenz sind aktuell verknuepft. Fuer weitere Server brauchst du einen groesseren Seat-Bundle oder eine zweite Lizenz.',
        'All seats of this license are currently linked. Additional servers require a larger seat bundle or a second license.'
      ),
    });
  }

  return notes;
}

export function buildSubscriptionReplayStatus(activity, t) {
  const replay = activity?.replayProtection || {};
  const count = Math.max(0, Number(replay.recentSessionCount || 0) || 0);
  const lastSessionId = String(replay.lastSessionId || '').trim();

  if (count <= 0) {
    return {
      label: t('Noch keine verarbeitete Zahlung', 'No processed payment yet'),
      detail: t(
        'Abgeschlossene Stripe-Sessions werden vor der Lizenzaktivierung gegen Replay geschuetzt.',
        'Completed Stripe sessions are protected against replay before license activation.'
      ),
      accent: '#71717A',
    };
  }

  return {
    label: t('Replay-Schutz aktiv', 'Replay protection active'),
    detail: t(
      `${count} verarbeitete Zahlung${count === 1 ? '' : 'en'}${lastSessionId ? `, zuletzt ${lastSessionId}` : ''}.`,
      `${count} processed payment${count === 1 ? '' : 's'}${lastSessionId ? `, latest ${lastSessionId}` : ''}.`
    ),
    accent: '#10B981',
  };
}

export function buildSubscriptionActivityRows(activity, t) {
  const sessions = Array.isArray(activity?.recentSessions) ? activity.recentSessions : [];
  return sessions.map((entry) => {
    const tierLabel = String(entry?.tierName || entry?.tier || '').trim().toUpperCase() || 'PREMIUM';
    const changeType = entry?.upgraded
      ? t('Upgrade', 'Upgrade')
      : entry?.renewed
        ? t('Verlaengerung', 'Renewal')
        : entry?.created
          ? t('Neukauf', 'New purchase')
          : t('Zahlung', 'Payment');
    const parts = [
      `${tierLabel}`,
      entry?.months ? t(`${entry.months} Monat${entry.months > 1 ? 'e' : ''}`, `${entry.months} month${entry.months > 1 ? 's' : ''}`) : '',
      entry?.seats ? t(`${entry.seats} Seat${entry.seats > 1 ? 's' : ''}`, `${entry.seats} seat${entry.seats > 1 ? 's' : ''}`) : '',
      entry?.appliedOfferCode ? t(`Code ${entry.appliedOfferCode}`, `Code ${entry.appliedOfferCode}`) : '',
    ].filter(Boolean);

    return {
      key: entry?.sessionId || `${tierLabel}-${changeType}`,
      title: changeType,
      detail: parts.join(' • '),
      processedAt: entry?.processedAt || null,
      amountCents: Math.max(0, Number(entry?.finalAmountCents || entry?.amountPaidCents || 0) || 0),
      discountCents: Math.max(0, Number(entry?.discountCents || 0) || 0),
      replayProtected: entry?.replayProtected !== false,
    };
  });
}
