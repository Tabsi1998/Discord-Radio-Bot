import React, { useState, useEffect } from 'react';
import { Crown, Shield, Zap } from 'lucide-react';

const API_BASE = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
const PLAN_ORDER = ['free', 'pro', 'ultimate'];
const PLAN_META = {
  free: { color: '#A1A1AA', icon: Shield },
  pro: { color: '#FFB800', icon: Zap },
  ultimate: { color: '#BD00FF', icon: Crown },
};

const FALLBACK_PRICING = {
  seatOptions: [1, 2, 3, 5],
  tiers: {
    free: {
      name: 'Free',
      pricePerMonth: 0,
      features: [
        'Bis zu 2 Bots',
        '20 Free Stationen',
        'Standard Audio (64k)',
      ],
      seatPricing: {},
    },
    pro: {
      name: 'Pro',
      pricePerMonth: 299,
      startingAt: '2,99',
      features: [
        'Bis zu 8 Bots',
        '120 Stationen (Free + Pro)',
        'HQ Audio (128k Opus)',
      ],
      seatPricing: { 1: 2.99, 2: 5.49, 3: 7.49, 5: 11.49 },
    },
    ultimate: {
      name: 'Ultimate',
      pricePerMonth: 499,
      startingAt: '4,99',
      features: [
        'Bis zu 16 Bots',
        'Alle Stationen + Custom URLs',
        'Ultra HQ Audio (320k)',
      ],
      seatPricing: { 1: 4.99, 2: 7.99, 3: 10.99, 5: 16.99 },
    },
  },
};

function buildApiUrl(path) {
  return `${API_BASE}${path}`;
}

function formatEuro(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return `${amount.toFixed(2).replace('.', ',')} EUR`;
}

function centsToEuro(cents) {
  const amount = Number(cents);
  if (!Number.isFinite(amount)) return '0,00 EUR';
  return `${(amount / 100).toFixed(2).replace('.', ',')} EUR`;
}

function normalizeTier(rawTier, fallbackTier) {
  const tier = rawTier && typeof rawTier === 'object' ? rawTier : {};
  const fallback = fallbackTier || {};
  const rawSeatPricing = tier.seatPricing && typeof tier.seatPricing === 'object'
    ? tier.seatPricing
    : (fallback.seatPricing || {});

  return {
    name: String(tier.name || fallback.name || 'Plan'),
    pricePerMonth: Number.isFinite(Number(tier.pricePerMonth))
      ? Number(tier.pricePerMonth)
      : Number(fallback.pricePerMonth || 0),
    startingAt: String(tier.startingAt || fallback.startingAt || '').trim(),
    features: Array.isArray(tier.features) && tier.features.length > 0
      ? tier.features
      : (Array.isArray(fallback.features) ? fallback.features : []),
    seatPricing: rawSeatPricing,
  };
}

function normalizePricing(rawPricing) {
  const raw = rawPricing && typeof rawPricing === 'object' ? rawPricing : {};
  const rawTiers = raw.tiers && typeof raw.tiers === 'object' ? raw.tiers : {};
  const seatOptions = Array.isArray(raw.seatOptions) && raw.seatOptions.length > 0
    ? raw.seatOptions
    : FALLBACK_PRICING.seatOptions;

  return {
    seatOptions,
    tiers: {
      free: normalizeTier(rawTiers.free, FALLBACK_PRICING.tiers.free),
      pro: normalizeTier(rawTiers.pro, FALLBACK_PRICING.tiers.pro),
      ultimate: normalizeTier(rawTiers.ultimate, FALLBACK_PRICING.tiers.ultimate),
    },
  };
}

function buildPriceLabel(planId, tier) {
  if (planId === 'free') return '0 EUR';
  if (tier.startingAt) return `ab ${tier.startingAt} EUR`;
  return `ab ${centsToEuro(tier.pricePerMonth)}`;
}

function mapTierToColor(tier) {
  if (tier === 'ultimate') return '#BD00FF';
  if (tier === 'pro') return '#FFB800';
  return '#A1A1AA';
}

function Premium() {
  const [pricing, setPricing] = useState(FALLBACK_PRICING);
  const [pricingError, setPricingError] = useState('');
  const [serverId, setServerId] = useState('');
  const [result, setResult] = useState('');
  const [resultColor, setResultColor] = useState('#52525B');
  const [checkingStatus, setCheckingStatus] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const loadPricing = async () => {
      try {
        const res = await fetch(buildApiUrl('/api/premium/pricing'), {
          cache: 'no-store',
          signal: controller.signal,
        });
        const data = await res.json();
        if (!res.ok || data?.error) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        setPricing(normalizePricing(data));
        setPricingError('');
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setPricing(FALLBACK_PRICING);
        setPricingError('Pricing-API nicht erreichbar, Fallback-Daten aktiv.');
      }
    };

    loadPricing();
    return () => controller.abort();
  }, []);

  const checkStatus = async () => {
    const normalizedServerId = serverId.trim();
    if (!/^\d{17,22}$/.test(normalizedServerId)) {
      setResult('Server ID muss 17-22 Ziffern haben.');
      setResultColor('#FF2A2A');
      return;
    }

    setCheckingStatus(true);
    try {
      const res = await fetch(
        `${buildApiUrl('/api/premium/check')}?serverId=${encodeURIComponent(normalizedServerId)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (!res.ok || data?.error) {
        setResult(data?.error || 'Premium-Status konnte nicht geladen werden.');
        setResultColor('#FF2A2A');
        return;
      }

      const tier = String(data?.tier || 'free').toLowerCase();
      const days = Number(data?.license?.remainingDays ?? 0);
      const expiresAt = data?.license?.expiresAt
        ? new Date(data.license.expiresAt).toLocaleDateString('de-DE')
        : '-';
      const bitrate = String(data?.bitrate || '-');

      setResult(
        `Tier: ${tier.toUpperCase()} | Bitrate: ${bitrate} | Resttage: ${days} | Ablauf: ${expiresAt}`
      );
      setResultColor(mapTierToColor(tier));
    } catch {
      setResult('Premium-Status konnte nicht geladen werden.');
      setResultColor('#FF2A2A');
    } finally {
      setCheckingStatus(false);
    }
  };

  return (
    <section id="premium" data-testid="premium-section" style={{ padding: '80px 0', position: 'relative', zIndex: 1 }}>
      <div className="section-container">
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, letterSpacing: '0.15em', color: '#FFB800', textTransform: 'uppercase', fontWeight: 700 }}>
            Premium
          </span>
          <h2 style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 'clamp(24px, 4vw, 40px)', marginTop: 8 }}>
            Upgrade Dein Setup
          </h2>
          {pricingError && (
            <p style={{ marginTop: 10, fontSize: 12, color: '#FFB800' }}>
              {pricingError}
            </p>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16, marginBottom: 28 }}>
          {PLAN_ORDER.map((planId) => {
            const tier = pricing.tiers[planId];
            const meta = PLAN_META[planId];
            const Icon = meta.icon;
            const seatEntries = Object.entries(tier.seatPricing || {})
              .sort((a, b) => Number(a[0]) - Number(b[0]));

            return (
              <div
                key={planId}
                style={{
                  border: `1px solid ${meta.color}30`,
                  background: `${meta.color}08`,
                  borderRadius: 16,
                  padding: 20,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Icon size={16} color={meta.color} />
                  <strong style={{ color: meta.color, fontFamily: "'Orbitron', sans-serif" }}>
                    {tier.name}
                  </strong>
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, marginBottom: 10 }}>
                  {buildPriceLabel(planId, tier)}
                  <span style={{ fontSize: 13, color: '#A1A1AA' }}>/Monat</span>
                </div>
                <div style={{ color: '#A1A1AA', fontSize: 13, lineHeight: 1.6 }}>
                  {tier.features.map((feature) => (
                    <div key={feature}>{feature}</div>
                  ))}
                  {seatEntries.length > 0 && (
                    <div style={{ marginTop: 8, color: '#737373', fontSize: 12 }}>
                      Seats:{' '}
                      {seatEntries.map(([seats, value]) => `${seats}=${formatEuro(value)}`).join(' | ')}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
          {[
            'Bot-Limits und Features folgen strikt dem aktiven Lizenz-Tier.',
            'Premium-Bots werden serverbezogen per Lizenz freigeschaltet.',
            'Lizenz-Status kann jederzeit mit Server-ID geprueft werden.',
            'Seat-Preise werden zentral ueber die Backend-API gesteuert.',
            'Nach Zahlung: Aktivierungsmail + Kaufbeleg per E-Mail.',
          ].map((text) => (
            <div key={text} style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, padding: '10px 12px', color: '#A1A1AA', fontSize: 12, lineHeight: 1.6 }}>
              {text}
            </div>
          ))}
        </div>

        <div style={{ maxWidth: 560, margin: '0 auto', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 14, padding: 16 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A1A1AA', marginBottom: 10 }}>
            Premium Status Pruefen
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  checkStatus();
                }
              }}
              placeholder="Discord Server ID"
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10,
                color: '#fff',
                padding: '10px 12px',
                fontFamily: "'JetBrains Mono', monospace",
              }}
            />
            <button
              onClick={checkStatus}
              disabled={checkingStatus}
              style={{
                background: checkingStatus ? 'rgba(0,240,255,0.5)' : '#00F0FF',
                border: 'none',
                color: '#050505',
                borderRadius: 10,
                fontWeight: 700,
                padding: '10px 14px',
                cursor: checkingStatus ? 'default' : 'pointer',
              }}
            >
              {checkingStatus ? 'Pruefe...' : 'Pruefen'}
            </button>
          </div>
          <div style={{ marginTop: 10, minHeight: 18, color: resultColor, fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }}>
            {result}
          </div>
        </div>
      </div>
    </section>
  );
}

export default Premium;
