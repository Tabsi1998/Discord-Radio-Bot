import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Clock,
  Crown,
  ExternalLink,
  RefreshCw,
  Users,
  X,
} from 'lucide-react';
import { useI18n } from '../i18n';

const TIER_COLORS = { free: '#71717A', pro: '#10B981', ultimate: '#8B5CF6' };
const TIER_LABELS = { free: 'Free', pro: 'Pro', ultimate: 'Ultimate' };
const RENEWAL_OPTIONS = [1, 3, 6, 12];

function formatLicenseDate(isoStr, formatDate) {
  if (!isoStr) return '-';
  try {
    return formatDate(isoStr, { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '-';
  }
}

function formatEuroCents(cents, locale = 'de-AT') {
  const amount = Math.max(0, Number(cents || 0) || 0) / 100;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amount);
}

function CheckoutChoiceButton({ active, label, subLabel, onClick, accent }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: '1px solid',
        borderColor: active ? accent : '#1A1A2E',
        background: active ? `${accent}1A` : '#050505',
        color: '#fff',
        padding: '12px 14px',
        cursor: 'pointer',
        textAlign: 'left',
        display: 'grid',
        gap: 4,
        minWidth: 0,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <strong style={{ fontSize: 14 }}>{label}</strong>
        {active && <Check size={15} color={accent} />}
      </span>
      {subLabel ? <span style={{ fontSize: 12, color: '#A1A1AA' }}>{subLabel}</span> : null}
    </button>
  );
}

function DashboardCheckoutModal({
  open,
  onClose,
  loading,
  submitError,
  initialTier,
  seats,
  t,
  locale,
  onSubmit,
  allowUpgrade,
  hasBillingEmail,
}) {
  const [months, setMonths] = useState(3);
  const [tier, setTier] = useState(initialTier);
  const [billingEmail, setBillingEmail] = useState('');
  const accent = TIER_COLORS[tier] || '#8B5CF6';
  const requiresBillingEmail = hasBillingEmail === false;
  const normalizedBillingEmail = String(billingEmail || '').trim().toLowerCase();
  const hasValidBillingEmailInput = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedBillingEmail);

  useEffect(() => {
    if (!open) return;
    setTier(initialTier);
    setMonths(initialTier === 'ultimate' ? 1 : 3);
    setBillingEmail('');
  }, [initialTier, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !loading) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = '';
    };
  }, [loading, onClose, open]);

  if (!open) return null;

  const seatBasePrice = {
    pro: seats === 5 ? 1149 : seats === 3 ? 749 : seats === 2 ? 549 : 299,
    ultimate: seats === 5 ? 1699 : seats === 3 ? 1099 : seats === 2 ? 799 : 499,
  };
  const durationMultiplier = tier === 'pro'
    ? { 1: 1, 3: (2.49 / 2.99) * 3, 6: (2.29 / 2.99) * 6, 12: (1.99 / 2.99) * 12 }
    : { 1: 1, 3: (3.99 / 4.99) * 3, 6: (3.49 / 4.99) * 6, 12: (2.99 / 4.99) * 12 };
  const prices = {
    pro: Object.fromEntries(RENEWAL_OPTIONS.map((option) => [option, Math.round(seatBasePrice.pro * (durationMultiplier[option] || option))])),
    ultimate: Object.fromEntries(RENEWAL_OPTIONS.map((option) => [option, Math.round(seatBasePrice.ultimate * (durationMultiplier[option] || option))])),
  };

  const currentPrice = prices?.[tier]?.[months] || 0;

  return (
    <div
      data-testid="dashboard-subscription-checkout-modal"
      onClick={() => { if (!loading) onClose(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: 'rgba(0,0,0,0.78)',
        backdropFilter: 'blur(8px)',
        display: 'grid',
        placeItems: 'center',
        padding: 20,
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          background: '#0A0A0A',
          border: `1px solid ${accent}55`,
          boxShadow: `0 0 60px ${accent}18`,
          padding: 24,
          display: 'grid',
          gap: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('Dashboard Checkout', 'Dashboard checkout')}
            </div>
            <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, color: '#fff', marginTop: 6 }}>
              {t('Abo direkt verlängern', 'Renew subscription directly')}
            </h3>
            <p style={{ color: '#A1A1AA', marginTop: 8, lineHeight: 1.6, fontSize: 14 }}>
              {t(
                'Stripe öffnet sich direkt mit der hinterlegten Lizenz-E-Mail. Du wählst nur Laufzeit und bei Pro optional das Upgrade auf Ultimate.',
                'Stripe opens directly with the stored license email. You only choose the duration and, for Pro, optionally an upgrade to Ultimate.'
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={loading}
            style={{ border: 'none', background: 'transparent', color: '#71717A', cursor: loading ? 'wait' : 'pointer', padding: 0 }}
          >
            <X size={18} />
          </button>
        </div>

        {allowUpgrade && (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('Plan', 'Plan')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <CheckoutChoiceButton
                active={tier === 'pro'}
                accent={TIER_COLORS.pro}
                label={t('Pro verlängern', 'Renew Pro')}
                subLabel={t('Bestehenden Pro-Plan beibehalten', 'Keep the current Pro plan')}
                onClick={() => setTier('pro')}
              />
              <CheckoutChoiceButton
                active={tier === 'ultimate'}
                accent={TIER_COLORS.ultimate}
                label={t('Zu Ultimate wechseln', 'Switch to Ultimate')}
                subLabel={t('Upgrade und direkt weiter verlängern', 'Upgrade and extend immediately')}
                onClick={() => setTier('ultimate')}
              />
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {t('Laufzeit', 'Duration')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10 }}>
            {RENEWAL_OPTIONS.map((option) => (
              <CheckoutChoiceButton
                key={option}
                active={months === option}
                accent={accent}
                label={t(
                  `${option} Monat${option > 1 ? 'e' : ''}`,
                  `${option} month${option > 1 ? 's' : ''}`
                )}
                subLabel={formatEuroCents(prices?.[tier]?.[option] || 0, locale)}
                onClick={() => setMonths(option)}
              />
            ))}
          </div>
        </div>

        {requiresBillingEmail ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {t('Abrechnungs-E-Mail', 'Billing email')}
            </div>
            <input
              type="email"
              value={billingEmail}
              onChange={(event) => setBillingEmail(event.target.value)}
              placeholder={t('name@beispiel.de', 'name@example.com')}
              style={{
                height: 42,
                border: `1px solid ${hasValidBillingEmailInput || !normalizedBillingEmail ? '#1A1A2E' : 'rgba(252,165,165,0.4)'}`,
                background: '#050505',
                color: '#fff',
                padding: '0 12px',
                outline: 'none',
              }}
            />
            <div style={{ fontSize: 12, color: '#A1A1AA' }}>
              {t(
                'Für diese Lizenz ist keine gültige E-Mail gespeichert. Bitte hier eingeben, damit Stripe geöffnet werden kann.',
                'No valid email is stored for this license. Enter one here so Stripe can open.'
              )}
            </div>
          </div>
        ) : null}

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 16, display: 'grid', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
            <span style={{ color: '#71717A' }}>{t('Zielplan', 'Target plan')}</span>
            <strong style={{ color: accent }}>{TIER_LABELS[tier]}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
            <span style={{ color: '#71717A' }}>{t('Server-Slots', 'Server slots')}</span>
            <strong>{seats}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 13 }}>
            <span style={{ color: '#71717A' }}>{t('Preis', 'Price')}</span>
            <strong>{formatEuroCents(currentPrice, locale)}</strong>
          </div>
        </div>

        {submitError ? (
          <div style={{ border: '1px solid rgba(252,165,165,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>
            {submitError}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            onClick={() => onSubmit({ months, tier, email: normalizedBillingEmail || undefined })}
            disabled={loading || (requiresBillingEmail && !hasValidBillingEmailInput)}
            style={{
              border: 'none',
              background: accent,
              color: '#fff',
              padding: '12px 16px',
              fontWeight: 700,
              cursor: (loading || (requiresBillingEmail && !hasValidBillingEmailInput)) ? 'not-allowed' : 'pointer',
              opacity: (loading || (requiresBillingEmail && !hasValidBillingEmailInput)) ? 0.65 : 1,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {loading ? <RefreshCw size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRight size={15} />}
            {loading ? t('Stripe wird geöffnet...', 'Opening Stripe...') : t('Weiter zu Stripe', 'Continue to Stripe')}
          </button>
          <button
            onClick={onClose}
            disabled={loading}
            style={{
              border: '1px solid #1A1A2E',
              background: 'transparent',
              color: '#A1A1AA',
              padding: '12px 16px',
              cursor: loading ? 'wait' : 'pointer',
            }}
          >
            {t('Abbrechen', 'Cancel')}
          </button>
        </div>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

export default function DashboardSubscription({ apiRequest, selectedGuildId, t }) {
  const { locale, localeMeta, formatDate } = useI18n();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');

  const load = useCallback(async () => {
    if (!selectedGuildId) return;
    setLoading(true);
    setError('');
    try {
      const result = await apiRequest(`/api/dashboard/license?serverId=${encodeURIComponent(selectedGuildId)}`);
      setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedGuildId, apiRequest]);

  useEffect(() => { load(); }, [load]);

  const lic = data?.license || null;
  const effectiveTier = data?.effectiveTier || lic?.plan || data?.tier || 'free';
  const tierColor = TIER_COLORS[effectiveTier] || '#71717A';
  const isExpired = lic?.expired;
  const isExpiringSoon = !isExpired && lic?.remainingDays != null && lic.remainingDays <= 7;
  const canManagePaidPlan = lic && ['pro', 'ultimate'].includes(String(lic.plan || effectiveTier || '').toLowerCase());
  const canUpgradeToUltimate = String(lic?.plan || effectiveTier || '').toLowerCase() === 'pro';

  const planFeatures = useMemo(() => {
    if (effectiveTier === 'ultimate') {
      return [
        '320k Bitrate (Ultra HQ)',
        t('Bis zu 16 Bots', 'Up to 16 bots'),
        t('Alle Stationen + Custom-URLs', 'All stations + custom URLs'),
        t('Dashboard + Events + Analytics', 'Dashboard + events + analytics'),
        t('Fallback-Station', 'Fallback station'),
      ];
    }
    if (effectiveTier === 'pro') {
      return [
        '128k Bitrate (HQ Opus)',
        t('Bis zu 8 Bots', 'Up to 8 bots'),
        t('120 Stationen (Free + Pro)', '120 stations (free + pro)'),
        t('Dashboard + Events', 'Dashboard + events'),
        t('Priorisierter Reconnect', 'Priority reconnect'),
      ];
    }
    return [
      '64k Bitrate',
      t('Bis zu 2 Bots', 'Up to 2 bots'),
      t('20 Free-Stationen', '20 free stations'),
      t('Automatischer Reconnect', 'Automatic reconnect'),
      t('Dashboard ab Pro', 'Dashboard from Pro'),
    ];
  }, [effectiveTier, t]);

  const openCheckout = useCallback(() => {
    setCheckoutError('');
    setCheckoutOpen(true);
  }, []);

  const startCheckout = useCallback(async ({ months, tier, email }) => {
    if (!selectedGuildId) return;
    setCheckoutLoading(true);
    setCheckoutError('');
    try {
      const result = await apiRequest(`/api/dashboard/license/checkout?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'POST',
        body: JSON.stringify({
          months,
          tier,
          email,
          language: locale,
          returnUrl: `${window.location.origin}/?page=dashboard&lang=${encodeURIComponent(locale)}`,
        }),
      });
      if (result?.url) {
        window.location.href = result.url;
        return;
      }
      setCheckoutError(t('Stripe-URL fehlt in der Antwort.', 'Stripe URL is missing in the response.'));
    } catch (err) {
      setCheckoutError(err.message || t('Checkout konnte nicht gestartet werden.', 'Could not start checkout.'));
    } finally {
      setCheckoutLoading(false);
    }
  }, [apiRequest, locale, selectedGuildId, t]);

  if (loading) {
    return (
      <div style={{ color: '#52525B', textAlign: 'center', padding: 40 }}>
        {t('Lade...', 'Loading...')}
      </div>
    );
  }

  return (
    <section data-testid="dashboard-subscription-panel" style={{ display: 'grid', gap: 14 }}>
      {error ? (
        <div style={{ border: '1px solid rgba(252,165,165,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      <div
        data-testid="subscription-plan-card"
        style={{
          background: '#0A0A0A',
          border: `1px solid ${tierColor}33`,
          padding: 24,
          display: 'grid',
          gap: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Crown size={24} color={tierColor} />
            <div>
              <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, fontWeight: 700, color: tierColor }}>
                {TIER_LABELS[effectiveTier] || 'Free'}
              </div>
              <div style={{ color: '#71717A', fontSize: 12 }}>{t('Aktueller Lizenzstatus', 'Current license status')}</div>
            </div>
          </div>
          <button
            data-testid="subscription-refresh-btn"
            onClick={load}
            style={{
              border: '1px solid #1A1A2E',
              background: 'transparent',
              color: '#71717A',
              height: 34,
              padding: '0 10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            <RefreshCw size={13} /> {t('Aktualisieren', 'Refresh')}
          </button>
        </div>

        {effectiveTier === 'free' && !lic ? (
          <div
            data-testid="subscription-free-info"
            style={{
              border: '1px solid #1A1A2E',
              background: '#050505',
              padding: 16,
              display: 'grid',
              gap: 8,
            }}
          >
            <p style={{ color: '#A1A1AA', fontSize: 13, lineHeight: 1.7 }}>
              {t(
                'Für diesen Server ist aktuell kein kostenpflichtiges Abo hinterlegt. Upgrades auf Pro oder Ultimate startest du weiterhin über die Hauptseite.',
                'There is currently no paid subscription stored for this server. Upgrades to Pro or Ultimate are still started from the main website.'
              )}
            </p>
            <a
              href={`/?page=home&lang=${encodeURIComponent(locale)}#premium`}
              data-testid="subscription-upgrade-link"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                marginTop: 4,
                border: '1px solid #8B5CF6',
                background: 'rgba(139,92,246,0.12)',
                color: '#fff',
                padding: '10px 16px',
                textDecoration: 'none',
                fontWeight: 600,
                fontSize: 14,
                width: 'fit-content',
              }}
            >
              <ExternalLink size={15} /> {t('Pläne öffnen', 'Open plans')}
            </a>
          </div>
        ) : null}

        {lic ? (
          <div
            data-testid="subscription-details"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: 10,
            }}
          >
            <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Clock size={14} color="#71717A" />
                <span style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {t('Gültig bis', 'Valid until')}
                </span>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 600, color: isExpired ? '#EF4444' : isExpiringSoon ? '#F59E0B' : '#fff' }}>
                {formatLicenseDate(lic.expiresAt, formatDate)}
              </div>
              {lic.remainingDays != null && !isExpired ? (
                <div style={{ fontSize: 12, color: isExpiringSoon ? '#F59E0B' : '#52525B', marginTop: 4 }}>
                  {lic.remainingDays} {t('Tage verbleibend', 'days remaining')}
                </div>
              ) : null}
              {isExpired ? (
                <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>{t('Abgelaufen', 'Expired')}</div>
              ) : null}
            </div>

            <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Users size={14} color="#71717A" />
                <span style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {t('Server-Slots', 'Server slots')}
                </span>
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, fontWeight: 600 }}>
                {lic.seatsUsed || 0} / {lic.seats || 1}
              </div>
              <div style={{ fontSize: 12, color: '#52525B', marginTop: 4 }}>
                {t('verknüpft', 'linked')}
              </div>
            </div>

            {lic.emailMasked ? (
              <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
                <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                  {t('Lizenz-E-Mail', 'License email')}
                </div>
                <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 14, color: '#A1A1AA' }}>
                  {lic.emailMasked}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {isExpired && canManagePaidPlan ? (
          <div
            data-testid="subscription-expired-warning"
            style={{
              border: '1px solid rgba(239,68,68,0.3)',
              background: 'rgba(127,29,29,0.12)',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <AlertTriangle size={18} color="#EF4444" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#FCA5A5' }}>{t('Lizenz abgelaufen', 'License expired')}</div>
              <div style={{ fontSize: 12, color: '#A1A1AA', marginTop: 2 }}>
                {t(
                  'Deine Lizenz ist abgelaufen. Verlängere sie direkt im Dashboard, damit alle Funktionen wieder aktiv sind.',
                  'Your license has expired. Renew it directly in the dashboard to reactivate all features.'
                )}
              </div>
            </div>
          </div>
        ) : null}

        {isExpiringSoon && !isExpired ? (
          <div
            data-testid="subscription-expiring-warning"
            style={{
              border: '1px solid rgba(245,158,11,0.3)',
              background: 'rgba(120,53,15,0.12)',
              padding: '14px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <AlertTriangle size={18} color="#F59E0B" />
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#FDE68A' }}>{t('Läuft bald ab', 'Expiring soon')}</div>
              <div style={{ fontSize: 12, color: '#A1A1AA', marginTop: 2 }}>
                {t(
                  `Deine Lizenz läuft in ${lic.remainingDays} Tagen ab. Du kannst sie direkt hier um 1, 3, 6 oder 12 Monate verlängern.`,
                  `Your license expires in ${lic.remainingDays} days. You can renew it right here for 1, 3, 6 or 12 months.`
                )}
              </div>
            </div>
          </div>
        ) : null}

        {canManagePaidPlan ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              data-testid="subscription-extend-link"
              onClick={openCheckout}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                border: `1px solid ${tierColor}`,
                background: `${tierColor}1A`,
                color: '#fff',
                padding: '10px 16px',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
              }}
            >
              <ArrowRight size={15} />
              {isExpired ? t('Jetzt verlängern', 'Renew now') : t('Abo verlängern', 'Extend subscription')}
            </button>
            {canUpgradeToUltimate ? (
              <button
                data-testid="subscription-upgrade-ultimate-link"
                onClick={openCheckout}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  border: '1px solid #8B5CF6',
                  background: 'rgba(139,92,246,0.12)',
                  color: '#fff',
                  padding: '10px 16px',
                  fontWeight: 600,
                  fontSize: 14,
                  cursor: 'pointer',
                }}
              >
                <Crown size={15} /> {t('Ultimate prüfen', 'Review Ultimate')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      <div data-testid="subscription-features-card" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
        <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, marginBottom: 14, color: '#D4D4D8' }}>
          {t('Plan-Highlights', 'Plan highlights')}
        </h4>
        <div style={{ display: 'grid', gap: 8 }}>
          {planFeatures.map((feature) => (
            <FeatureRow key={feature} label={feature} />
          ))}
        </div>
      </div>

      <DashboardCheckoutModal
        open={checkoutOpen}
        onClose={() => setCheckoutOpen(false)}
        loading={checkoutLoading}
        submitError={checkoutError}
        initialTier={String(lic?.plan || effectiveTier || 'pro').toLowerCase() === 'ultimate' ? 'ultimate' : 'pro'}
        seats={Math.max(1, Number(lic?.seats || 1) || 1)}
        t={t}
        locale={localeMeta.intl}
        onSubmit={startCheckout}
        allowUpgrade={canUpgradeToUltimate}
        hasBillingEmail={lic ? Boolean(lic.hasBillingEmail || lic.emailMasked) : true}
      />
    </section>
  );
}

function FeatureRow({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2">
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span style={{ fontSize: 13, color: '#D4D4D8' }}>{label}</span>
    </div>
  );
}
