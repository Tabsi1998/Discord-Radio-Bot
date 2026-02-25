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
  durations: [1, 2, 3, 6, 12],
  tiers: {
    free: {
      name: 'Free',
      pricePerMonth: 0,
      features: [
        'Bis zu 2 Bots',
        '20 Free Stationen',
        'Standard Audio (64k)',
        'Standard Reconnect',
      ],
      durationPricing: {},
    },
    pro: {
      name: 'Pro',
      pricePerMonth: 299,
      startingAt: '2,99',
      features: [
        'Bis zu 8 Bots',
        '120 Stationen (Free + Pro)',
        'HQ Audio (128k Opus)',
        'Priority Reconnect',
        'Rollenbasierte Berechtigungen',
        'Event-Scheduler',
      ],
      durationPricing: { 1: '2.99', 2: '2.79', 3: '2.49', 6: '2.29', 12: '1.99' },
    },
    ultimate: {
      name: 'Ultimate',
      pricePerMonth: 499,
      startingAt: '4,99',
      features: [
        'Bis zu 16 Bots',
        'Alle Stationen + Custom URLs',
        'Ultra HQ Audio (320k)',
        'Instant Reconnect',
        'Rollenbasierte Berechtigungen',
      ],
      durationPricing: { 1: '4.99', 2: '4.49', 3: '3.99', 6: '3.49', 12: '2.99' },
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
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Crown size={16} color="#FFB800" />
            <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, letterSpacing: '0.15em', color: '#FFB800', textTransform: 'uppercase', fontWeight: 700 }}>
              Premium
            </span>
          </div>
          <h2 style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 'clamp(24px, 4vw, 40px)', marginBottom: 12 }}>
            Upgrade dein Setup
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 500 }}>
            Mehr Worker, mehr Stationen, besserer Sound. Waehle deinen Plan.
          </p>
          {pricingError && (
            <p style={{ marginTop: 10, fontSize: 12, color: '#FFB800' }}>
              {pricingError}
            </p>
          )}
        </div>

        {/* Plan Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20, marginBottom: 40 }}>
          {PLAN_ORDER.map((planId) => {
            const tier = pricing.tiers[planId];
            const meta = PLAN_META[planId];
            const Icon = meta.icon;
            const isPro = planId === 'pro';
            const seatEntries = Object.entries(tier.seatPricing || {})
              .sort((a, b) => Number(a[0]) - Number(b[0]));

            return (
              <div
                key={planId}
                data-testid={`plan-card-${planId}`}
                style={{
                  position: 'relative',
                  borderRadius: 18,
                  padding: '28px 24px',
                  background: isPro ? `${meta.color}08` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${meta.color}${isPro ? '35' : '18'}`,
                  transition: 'border-color 0.3s, box-shadow 0.3s',
                  boxShadow: isPro ? `0 0 30px ${meta.color}10` : 'none',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = `${meta.color}50`;
                  if (isPro) e.currentTarget.style.boxShadow = `0 0 40px ${meta.color}18`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = `${meta.color}${isPro ? '35' : '18'}`;
                  e.currentTarget.style.boxShadow = isPro ? `0 0 30px ${meta.color}10` : 'none';
                }}
              >
                {isPro && (
                  <div style={{
                    position: 'absolute', top: -1, right: 20,
                    padding: '4px 12px', borderRadius: '0 0 8px 8px',
                    background: meta.color, color: '#050505',
                    fontFamily: "'Orbitron', sans-serif",
                    fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
                  }}>
                    BELIEBT
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: `${meta.color}12`, border: `1px solid ${meta.color}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon size={18} color={meta.color} />
                  </div>
                  <strong style={{ color: meta.color, fontFamily: "'Orbitron', sans-serif", fontSize: 16 }}>
                    {tier.name}
                  </strong>
                </div>

                <div style={{ fontSize: 32, fontWeight: 800, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace" }}>
                  {buildPriceLabel(planId, tier)}
                  <span style={{ fontSize: 13, color: '#52525B', fontWeight: 400, fontFamily: "'DM Sans', sans-serif" }}>/Monat</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                  {tier.features.map((feature) => (
                    <div key={feature} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 14, color: '#A1A1AA' }}>{feature}</span>
                    </div>
                  ))}
                </div>

                {seatEntries.length > 0 && (
                  <div style={{
                    marginTop: 8, padding: '10px 12px', borderRadius: 10,
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)',
                  }}>
                    <div style={{ fontSize: 10, color: '#52525B', fontWeight: 600, letterSpacing: '0.1em', marginBottom: 6, textTransform: 'uppercase' }}>
                      Seat-Preise
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {seatEntries.map(([seats, value]) => (
                        <span key={seats} style={{
                          padding: '3px 8px', borderRadius: 6,
                          background: `${meta.color}08`, border: `1px solid ${meta.color}15`,
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 11, color: '#A1A1AA',
                        }}>
                          {seats}x = {formatEuro(value)}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Status Checker */}
        <div style={{
          maxWidth: 560, padding: '24px 28px',
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 16,
        }}>
          <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A1A1AA', marginBottom: 12, fontWeight: 600 }}>
            Premium Status pruefen
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              data-testid="premium-server-id-input"
              value={serverId}
              onChange={(e) => setServerId(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') checkStatus(); }}
              placeholder="Discord Server ID"
              style={{
                flex: 1, background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
                color: '#fff', padding: '10px 14px',
                fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
                outline: 'none', transition: 'border-color 0.2s',
              }}
              onFocus={(e) => { e.target.style.borderColor = 'rgba(0,240,255,0.3)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; }}
            />
            <button
              data-testid="premium-check-btn"
              onClick={checkStatus}
              disabled={checkingStatus}
              style={{
                background: checkingStatus ? 'rgba(0,240,255,0.5)' : '#00F0FF',
                border: 'none', color: '#050505', borderRadius: 10,
                fontWeight: 700, padding: '10px 18px', cursor: checkingStatus ? 'default' : 'pointer',
                transition: 'transform 0.15s',
                fontFamily: "'DM Sans', sans-serif",
              }}
              onMouseEnter={(e) => { if (!checkingStatus) e.currentTarget.style.transform = 'scale(1.03)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
            >
              {checkingStatus ? 'Pruefe...' : 'Pruefen'}
            </button>
          </div>
          <div data-testid="premium-check-result" style={{
            marginTop: 10, minHeight: 18, color: resultColor, fontSize: 13,
            fontFamily: "'JetBrains Mono', monospace",
          }}>
            {result}
          </div>
        </div>
      </div>
    </section>
  );
}

export default Premium;
