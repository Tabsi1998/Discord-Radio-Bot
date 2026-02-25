import React, { useState, useEffect, useCallback } from 'react';
import { Crown, Shield, Zap, X } from 'lucide-react';

const API_BASE = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
const PLAN_ORDER = ['free', 'pro', 'ultimate'];
const PLAN_META = {
  free: { color: '#A1A1AA', icon: Shield },
  pro: { color: '#FFB800', icon: Zap },
  ultimate: { color: '#BD00FF', icon: Crown },
};

const FALLBACK_PRICING = {
  durations: [1, 3, 6, 12],
  seatOptions: [1, 2, 3, 5],
  tiers: {
    free: {
      name: 'Free', pricePerMonth: 0,
      features: ['Bis zu 2 Bots', '20 Free Stationen', 'Standard Audio (64k)', 'Standard Reconnect'],
      durationPricing: {}, seatPricing: {},
    },
    pro: {
      name: 'Pro', pricePerMonth: 299, startingAt: '2,99',
      features: ['Bis zu 8 Bots', '120 Stationen (Free + Pro)', 'HQ Audio (128k Opus)', 'Priority Reconnect', 'Rollenbasierte Berechtigungen', 'Event-Scheduler'],
      durationPricing: { 1: '2.99', 3: '2.49', 6: '2.29', 12: '1.99' },
      seatPricing: { 1: '2.99', 2: '5.49', 3: '7.49', 5: '11.49' },
    },
    ultimate: {
      name: 'Ultimate', pricePerMonth: 499, startingAt: '4,99',
      features: ['Bis zu 16 Bots', 'Alle Stationen + Custom URLs', 'Ultra HQ Audio (320k)', 'Instant Reconnect', 'Rollenbasierte Berechtigungen'],
      durationPricing: { 1: '4.99', 3: '3.99', 6: '3.49', 12: '2.99' },
      seatPricing: { 1: '4.99', 2: '9.19', 3: '12.49', 5: '19.19' },
    },
  },
};

function buildApiUrl(path) { return `${API_BASE}${path}`; }

function formatEuro(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '-';
  return `${amount.toFixed(2).replace('.', ',')}`;
}

function normalizeTier(rawTier, fallbackTier) {
  const tier = rawTier && typeof rawTier === 'object' ? rawTier : {};
  const fallback = fallbackTier || {};
  const pick = (field) => {
    const raw = tier[field] && typeof tier[field] === 'object' ? tier[field] : null;
    return raw || (fallback[field] && typeof fallback[field] === 'object' ? fallback[field] : {});
  };
  return {
    name: String(tier.name || fallback.name || 'Plan'),
    pricePerMonth: Number.isFinite(Number(tier.pricePerMonth)) ? Number(tier.pricePerMonth) : Number(fallback.pricePerMonth || 0),
    startingAt: String(tier.startingAt || fallback.startingAt || '').trim(),
    features: Array.isArray(tier.features) && tier.features.length > 0 ? tier.features : (Array.isArray(fallback.features) ? fallback.features : []),
    durationPricing: pick('durationPricing'),
    seatPricing: pick('seatPricing'),
  };
}

function normalizePricing(rawPricing) {
  const raw = rawPricing && typeof rawPricing === 'object' ? rawPricing : {};
  const rawTiers = raw.tiers && typeof raw.tiers === 'object' ? raw.tiers : {};
  const durations = Array.isArray(raw.durations) && raw.durations.length > 0 ? raw.durations : FALLBACK_PRICING.durations;
  const seatOptions = Array.isArray(raw.seatOptions) && raw.seatOptions.length > 0 ? raw.seatOptions : FALLBACK_PRICING.seatOptions;
  return {
    durations, seatOptions,
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
  return `ab ${formatEuro(tier.pricePerMonth / 100)} EUR`;
}

function mapTierToColor(tier) {
  if (tier === 'ultimate') return '#BD00FF';
  if (tier === 'pro') return '#FFB800';
  return '#A1A1AA';
}

/* ── Checkout Popup Modal ── */
function CheckoutModal({ planId, tier, meta, durations, seatOptions, onClose }) {
  const [email, setEmail] = useState('');
  const [coupon, setCoupon] = useState('');
  const [referral, setReferral] = useState('');
  const [selectedSeats, setSelectedSeats] = useState(1);
  const [selectedDuration, setSelectedDuration] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const Icon = meta.icon;

  // Seat pricing
  const seatEntries = Object.entries(tier.seatPricing || {})
    .map(([s, v]) => [Number(s), Number(v)])
    .filter(([s]) => seatOptions.includes(s))
    .sort((a, b) => a[0] - b[0]);

  // Duration pricing
  const durationEntries = Object.entries(tier.durationPricing || {})
    .map(([m, v]) => [Number(m), Number(v)])
    .filter(([m]) => durations.includes(m))
    .sort((a, b) => a[0] - b[0]);

  // Calculate price
  const base1mo = durationEntries.find(([m]) => m === 1)?.[1] || 0;
  const selectedDurPrice = durationEntries.find(([m]) => m === selectedDuration)?.[1] || base1mo;
  const seatTotal1mo = seatEntries.find(([s]) => s === selectedSeats)?.[1] || base1mo;
  const discountRatio = base1mo > 0 ? selectedDurPrice / base1mo : 1;
  const pricePerMonth = seatTotal1mo * discountRatio;
  const totalPrice = pricePerMonth * selectedDuration;
  const durationLabel = selectedDuration === 1 ? '1 Monat' : `${selectedDuration} Monate`;
  const seatsLabel = selectedSeats === 1 ? '1 Server' : `${selectedSeats} Server`;

  const handlePay = async () => {
    const trimmedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Bitte eine gueltige E-Mail-Adresse eingeben.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(buildApiUrl('/api/premium/checkout'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tier: planId, email: trimmedEmail,
          months: selectedDuration, seats: selectedSeats,
          coupon: coupon.trim() || undefined,
          referral: referral.trim() || undefined,
          returnUrl: window.location.origin,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) { setError(data?.error || 'Checkout fehlgeschlagen.'); return; }
      if (data?.url) { window.location.href = data.url; }
      else { setError('Keine Checkout-URL erhalten.'); }
    } catch { setError('Checkout fehlgeschlagen. Bitte spaeter erneut versuchen.'); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', handleEsc); document.body.style.overflow = ''; };
  }, [onClose]);

  const inputStyle = {
    width: '100%', boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 10, color: '#fff', padding: '12px 14px',
    fontFamily: "'JetBrains Mono', monospace", fontSize: 13,
    outline: 'none', transition: 'border-color 0.2s',
  };
  const labelStyle = {
    display: 'block', fontSize: 11, color: '#A1A1AA', fontWeight: 700,
    letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6,
    fontFamily: "'Orbitron', sans-serif",
  };

  return (
    <div
      data-testid="checkout-modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 20px', overflowY: 'auto',
      }}
    >
      <div
        data-testid={`checkout-modal-${planId}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative', width: '100%', maxWidth: 480,
          background: '#0c0c0e', border: `1px solid ${meta.color}30`,
          borderRadius: 20, padding: '36px 32px',
          boxShadow: `0 0 60px ${meta.color}15`,
        }}
      >
        {/* Close */}
        <button data-testid="checkout-modal-close" onClick={onClose} style={{
          position: 'absolute', top: 14, right: 14,
          background: 'none', border: 'none', color: '#52525B', cursor: 'pointer', padding: 4,
        }}><X size={18} /></button>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 14, margin: '0 auto 12px',
            background: `${meta.color}15`, border: `2px solid ${meta.color}50`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={26} color={meta.color} />
          </div>
          <h3 style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 22, color: '#fff', margin: 0 }}>
            OmniFM {tier.name}
          </h3>
        </div>

        {/* E-Mail */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>E-Mail Adresse</label>
          <input data-testid="checkout-email-input" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="deine@email.de" style={inputStyle}
            onFocus={(e) => { e.target.style.borderColor = `${meta.color}60`; }}
            onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; }} />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#52525B' }}>
            Dein Lizenz-Key und die Rechnung werden an diese Adresse gesendet.
          </p>
        </div>

        {/* Rabattcode */}
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Rabattcode (Optional)</label>
          <input data-testid="checkout-coupon-input" value={coupon}
            onChange={(e) => setCoupon(e.target.value)} placeholder="Z.B. PRO10" style={inputStyle}
            onFocus={(e) => { e.target.style.borderColor = `${meta.color}60`; }}
            onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; }} />
        </div>

        {/* Referral-Code */}
        <div style={{ marginBottom: 22 }}>
          <label style={labelStyle}>Referral-Code (Optional)</label>
          <input data-testid="checkout-referral-input" value={referral}
            onChange={(e) => setReferral(e.target.value)} placeholder="Z.B. CREATOR10" style={inputStyle}
            onFocus={(e) => { e.target.style.borderColor = `${meta.color}60`; }}
            onBlur={(e) => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; }} />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#52525B' }}>
            Referral-Links koennen den Code automatisch vorbefuellen.
          </p>
        </div>

        {/* Anzahl Server */}
        {seatEntries.length > 0 && (
          <div style={{ marginBottom: 22 }}>
            <label style={labelStyle}>Anzahl Server</label>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(seatEntries.length, 4)}, 1fr)`, gap: 8 }}>
              {seatEntries.map(([seats, monthlyTotal]) => {
                const isSelected = selectedSeats === seats;
                const isBest = seats === Math.max(...seatEntries.map(([s]) => s));
                return (
                  <button key={seats} data-testid={`checkout-seats-${seats}`}
                    onClick={() => setSelectedSeats(seats)}
                    style={{
                      position: 'relative', padding: '14px 8px', borderRadius: 12,
                      border: `2px solid ${isSelected ? meta.color : 'rgba(255,255,255,0.1)'}`,
                      background: isSelected ? `${meta.color}18` : 'rgba(255,255,255,0.03)',
                      color: isSelected ? '#fff' : '#A1A1AA',
                      cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s', outline: 'none',
                    }}
                  >
                    {isBest && (
                      <span style={{
                        position: 'absolute', top: -8, right: -4,
                        padding: '2px 6px', borderRadius: 6, background: '#00FF66', color: '#050505',
                        fontSize: 8, fontWeight: 800, letterSpacing: '0.05em', fontFamily: "'Orbitron', sans-serif",
                      }}>BEST</span>
                    )}
                    <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: isSelected ? meta.color : '#fff' }}>
                      {seats}
                    </div>
                    <div style={{ fontSize: 11, marginTop: 2 }}>Server</div>
                    <div style={{ fontSize: 10, marginTop: 2, color: '#52525B' }}>
                      {formatEuro(monthlyTotal)}€/Monat
                    </div>
                  </button>
                );
              })}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 11, color: '#52525B' }}>
              Lizenziere mehrere Server mit einem Abo – je mehr Server, desto guenstiger pro Server.
            </p>
          </div>
        )}

        {/* Laufzeit Waehlen */}
        <div style={{ marginBottom: 22 }}>
          <label style={labelStyle}>Laufzeit waehlen</label>
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(durationEntries.length, 4)}, 1fr)`, gap: 8 }}>
            {durationEntries.map(([months]) => {
              const isSelected = selectedDuration === months;
              const isYearly = months === 12;
              return (
                <button key={months} data-testid={`checkout-duration-${months}`}
                  onClick={() => setSelectedDuration(months)}
                  style={{
                    position: 'relative', padding: '14px 8px', borderRadius: 12,
                    border: `2px solid ${isSelected ? meta.color : 'rgba(255,255,255,0.1)'}`,
                    background: isSelected ? `${meta.color}18` : 'rgba(255,255,255,0.03)',
                    color: isSelected ? '#fff' : '#A1A1AA',
                    cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s', outline: 'none',
                  }}
                >
                  {isYearly && (
                    <span style={{
                      position: 'absolute', top: -8, right: -4,
                      padding: '2px 6px', borderRadius: 6, background: '#00FF66', color: '#050505',
                      fontSize: 8, fontWeight: 800, letterSpacing: '0.05em', fontFamily: "'Orbitron', sans-serif",
                    }}>+2 GRATIS</span>
                  )}
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "'JetBrains Mono', monospace", color: isSelected ? meta.color : '#fff' }}>
                    {months}
                  </div>
                  <div style={{ fontSize: 11, marginTop: 2 }}>{months === 1 ? 'Monat' : 'Monate'}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Preis-Zusammenfassung */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '14px 16px', borderRadius: 12,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          marginBottom: 16,
        }}>
          <span style={{ fontSize: 14, color: '#A1A1AA', fontFamily: "'DM Sans', sans-serif" }}>
            {durationLabel}{selectedSeats > 1 ? ` · ${seatsLabel}` : ''}
          </span>
          <span style={{ fontSize: 26, fontWeight: 800, color: meta.color, fontFamily: "'JetBrains Mono', monospace" }}>
            {formatEuro(totalPrice)}€
          </span>
        </div>

        {/* Info-Box */}
        <div style={{
          padding: '12px 16px', borderRadius: 12, marginBottom: 20,
          background: `${meta.color}08`, border: `1px solid ${meta.color}18`,
        }}>
          <p style={{ margin: 0, fontSize: 12, color: '#A1A1AA', lineHeight: 1.5 }}>
            Nach dem Kauf erhaeltst du deinen <strong style={{ color: meta.color }}>Lizenz-Key</strong> per E-Mail. Nutze{' '}
            <strong style={{ color: '#00F0FF' }}>/license activate</strong> im Discord um deinen Server zu verknuepfen.
          </p>
        </div>

        {/* Error */}
        {error && (
          <p data-testid="checkout-error-msg" style={{ margin: '0 0 12px', fontSize: 12, color: '#FF2A2A', textAlign: 'center' }}>
            {error}
          </p>
        )}

        {/* Bezahlen-Button */}
        <button data-testid={`checkout-pay-btn-${planId}`} onClick={handlePay} disabled={loading}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 12, border: 'none',
            background: loading ? `${meta.color}80` : meta.color, color: '#050505',
            fontWeight: 800, fontSize: 16, fontFamily: "'DM Sans', sans-serif",
            cursor: loading ? 'default' : 'pointer',
            transition: 'transform 0.15s, box-shadow 0.2s',
            boxShadow: `0 0 25px ${meta.color}30`,
          }}
          onMouseEnter={(e) => { if (!loading) { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = `0 0 35px ${meta.color}50`; }}}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = `0 0 25px ${meta.color}30`; }}
        >
          {loading ? 'Weiterleitung...' : `${formatEuro(totalPrice)}€ bezahlen`}
        </button>

        {/* Abbrechen */}
        <button data-testid="checkout-cancel-btn" onClick={onClose}
          style={{
            display: 'block', width: '100%', marginTop: 12, padding: '8px 0',
            background: 'none', border: 'none', color: '#52525B',
            fontSize: 13, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif", transition: 'color 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = '#A1A1AA'; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = '#52525B'; }}
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

/* ── Main Premium Component ── */
function Premium() {
  const [pricing, setPricing] = useState(FALLBACK_PRICING);
  const [pricingError, setPricingError] = useState('');
  const [serverId, setServerId] = useState('');
  const [result, setResult] = useState('');
  const [resultColor, setResultColor] = useState('#52525B');
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [checkoutPlan, setCheckoutPlan] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    const loadPricing = async () => {
      try {
        const res = await fetch(buildApiUrl('/api/premium/pricing'), { cache: 'no-store', signal: controller.signal });
        const data = await res.json();
        if (!res.ok || data?.error) throw new Error(data?.error || `HTTP ${res.status}`);
        setPricing(normalizePricing(data));
        setPricingError('');
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setPricing(normalizePricing(FALLBACK_PRICING));
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
      if (!res.ok || data?.error) { setResult(data?.error || 'Premium-Status konnte nicht geladen werden.'); setResultColor('#FF2A2A'); return; }
      const tier = String(data?.tier || 'free').toLowerCase();
      const days = Number(data?.license?.remainingDays ?? 0);
      const expiresAt = data?.license?.expiresAt ? new Date(data.license.expiresAt).toLocaleDateString('de-DE') : '-';
      const bitrate = String(data?.bitrate || '-');
      setResult(`Tier: ${tier.toUpperCase()} | Bitrate: ${bitrate} | Resttage: ${days} | Ablauf: ${expiresAt}`);
      setResultColor(mapTierToColor(tier));
    } catch { setResult('Premium-Status konnte nicht geladen werden.'); setResultColor('#FF2A2A'); }
    finally { setCheckingStatus(false); }
  };

  const closeCheckout = useCallback(() => setCheckoutPlan(null), []);

  return (
    <section id="premium" data-testid="premium-section" style={{ padding: '80px 0', position: 'relative', zIndex: 1 }}>
      <div className="section-container">
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Crown size={16} color="#FFB800" />
            <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, letterSpacing: '0.15em', color: '#FFB800', textTransform: 'uppercase', fontWeight: 700 }}>Premium</span>
          </div>
          <h2 style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 'clamp(24px, 4vw, 40px)', marginBottom: 12 }}>
            Upgrade dein Setup
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 500 }}>
            Mehr Worker, mehr Stationen, besserer Sound. Waehle deinen Plan.
          </p>
          {pricingError && <p style={{ marginTop: 10, fontSize: 12, color: '#FFB800' }}>{pricingError}</p>}
        </div>

        {/* Plan Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20, marginBottom: 40 }}>
          {PLAN_ORDER.map((planId) => {
            const tier = pricing.tiers[planId];
            const meta = PLAN_META[planId];
            const Icon = meta.icon;
            const isPro = planId === 'pro';

            return (
              <div key={planId} data-testid={`plan-card-${planId}`}
                style={{
                  position: 'relative', borderRadius: 18, padding: '28px 24px',
                  background: isPro ? `${meta.color}08` : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${meta.color}${isPro ? '35' : '18'}`,
                  transition: 'border-color 0.3s, box-shadow 0.3s',
                  boxShadow: isPro ? `0 0 30px ${meta.color}10` : 'none',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${meta.color}50`; if (isPro) e.currentTarget.style.boxShadow = `0 0 40px ${meta.color}18`; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${meta.color}${isPro ? '35' : '18'}`; e.currentTarget.style.boxShadow = isPro ? `0 0 30px ${meta.color}10` : 'none'; }}
              >
                {isPro && (
                  <div style={{
                    position: 'absolute', top: -1, right: 20, padding: '4px 12px', borderRadius: '0 0 8px 8px',
                    background: meta.color, color: '#050505', fontFamily: "'Orbitron', sans-serif",
                    fontSize: 9, fontWeight: 800, letterSpacing: '0.1em',
                  }}>BELIEBT</div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 10,
                    background: `${meta.color}12`, border: `1px solid ${meta.color}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}><Icon size={18} color={meta.color} /></div>
                  <strong style={{ color: meta.color, fontFamily: "'Orbitron', sans-serif", fontSize: 16 }}>{tier.name}</strong>
                </div>

                <div style={{ fontSize: 32, fontWeight: 800, marginBottom: 16, fontFamily: "'JetBrains Mono', monospace" }}>
                  {buildPriceLabel(planId, tier)}
                  <span style={{ fontSize: 13, color: '#52525B', fontWeight: 400, fontFamily: "'DM Sans', sans-serif" }}>/Monat</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
                  {tier.features.map((feature) => (
                    <div key={feature} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 14, color: '#A1A1AA' }}>{feature}</span>
                    </div>
                  ))}
                </div>

                {/* Buy Button */}
                {planId !== 'free' && (
                  <button data-testid={`buy-btn-${planId}`} onClick={() => setCheckoutPlan(planId)}
                    style={{
                      width: '100%', padding: '12px 0', borderRadius: 10, border: 'none',
                      background: meta.color, color: '#050505', fontWeight: 700, fontSize: 14,
                      fontFamily: "'DM Sans', sans-serif", cursor: 'pointer',
                      transition: 'transform 0.15s, box-shadow 0.2s',
                      boxShadow: `0 0 20px ${meta.color}30`,
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.boxShadow = `0 0 30px ${meta.color}50`; }}
                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = `0 0 20px ${meta.color}30`; }}
                  >
                    {tier.name} kaufen
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {/* Status Checker */}
        <div style={{
          maxWidth: 560, padding: '24px 28px',
          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16,
        }}>
          <div style={{ fontSize: 12, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#A1A1AA', marginBottom: 12, fontWeight: 600 }}>
            Premium Status pruefen
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input data-testid="premium-server-id-input" value={serverId}
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
            <button data-testid="premium-check-btn" onClick={checkStatus} disabled={checkingStatus}
              style={{
                background: checkingStatus ? 'rgba(0,240,255,0.5)' : '#00F0FF',
                border: 'none', color: '#050505', borderRadius: 10,
                fontWeight: 700, padding: '10px 18px',
                cursor: checkingStatus ? 'default' : 'pointer',
                transition: 'transform 0.15s', fontFamily: "'DM Sans', sans-serif",
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
          }}>{result}</div>
        </div>
      </div>

      {/* Checkout Modal */}
      {checkoutPlan && (
        <CheckoutModal
          planId={checkoutPlan}
          tier={pricing.tiers[checkoutPlan]}
          meta={PLAN_META[checkoutPlan]}
          durations={pricing.durations}
          seatOptions={pricing.seatOptions}
          onClose={closeCheckout}
        />
      )}
    </section>
  );
}

export default Premium;
