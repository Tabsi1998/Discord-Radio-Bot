import React from 'react';
import { Activity, ArrowRight, CalendarClock, CheckCircle2, LayoutDashboard, Shield, Webhook } from 'lucide-react';
import { useI18n } from '../i18n';

const CARD_META = [
  { key: 'events', icon: CalendarClock, color: '#00F0FF', tier: 'pro' },
  { key: 'permissions', icon: Shield, color: '#FFB800', tier: 'pro' },
  { key: 'health', icon: Activity, color: '#39FF14', tier: 'pro' },
  { key: 'automation', icon: Webhook, color: '#BD00FF', tier: 'ultimate' },
];
const TIER_COLORS = {
  pro: '#FFB800',
  ultimate: '#BD00FF',
};

function buildDashboardHref(locale) {
  const params = new URLSearchParams();
  if (locale) params.set('lang', locale);
  params.set('page', 'dashboard');
  return `/?${params.toString()}`;
}

export default function DashboardShowcase() {
  const { copy, locale } = useI18n();

  return (
    <section
      id="dashboard-showcase"
      data-testid="dashboard-showcase-section"
      style={{ padding: '0 0 80px', position: 'relative', zIndex: 1 }}
    >
      <div className="section-container">
        <div
          style={{
            borderRadius: 24,
            overflow: 'hidden',
            border: '1px solid rgba(0,240,255,0.14)',
            background: 'linear-gradient(180deg, rgba(0,240,255,0.08) 0%, rgba(255,255,255,0.02) 100%)',
          }}
        >
          <div style={{ padding: '28px 28px 16px' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1.05fr) minmax(280px, 0.95fr)',
                gap: 18,
                alignItems: 'start',
              }}
              className="dashboard-showcase-top-grid"
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <LayoutDashboard size={18} color="#00F0FF" />
                  <span
                    style={{
                      fontFamily: "'Orbitron', sans-serif",
                      fontSize: 11,
                      letterSpacing: '0.15em',
                      textTransform: 'uppercase',
                      fontWeight: 700,
                      color: '#00F0FF',
                    }}
                  >
                    {copy.dashboardShowcase.eyebrow}
                  </span>
                </div>
                <h2
                  data-testid="dashboard-showcase-title"
                  style={{
                    fontFamily: "'Orbitron', sans-serif",
                    fontWeight: 800,
                    fontSize: 'clamp(24px, 4vw, 40px)',
                    marginBottom: 12,
                  }}
                >
                  {copy.dashboardShowcase.title}
                </h2>
                <p style={{ color: '#D4D4D8', fontSize: 16, maxWidth: 760, lineHeight: 1.7 }}>
                  {copy.dashboardShowcase.subtitle}
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
                  {copy.dashboardShowcase.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '7px 12px',
                        borderRadius: 999,
                        background: 'rgba(255,255,255,0.05)',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#E4E4E7',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div
                data-testid="dashboard-showcase-proof-panel"
                style={{
                  borderRadius: 18,
                  padding: 20,
                  background: 'rgba(5,5,5,0.34)',
                  border: '1px solid rgba(0,240,255,0.14)',
                  boxShadow: '0 0 35px rgba(0,240,255,0.08)',
                }}
              >
                <div style={{ fontSize: 11, color: '#00F0FF', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 8, fontWeight: 800 }}>
                  {copy.dashboardShowcase.proofPanel.eyebrow}
                </div>
                <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 20, fontWeight: 800, marginBottom: 14 }}>
                  {copy.dashboardShowcase.proofPanel.title}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
                  {copy.dashboardShowcase.proofPanel.items.map((item) => (
                    <div
                      key={item.label}
                      data-testid={`dashboard-showcase-proof-item-${item.label}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto minmax(0, 1fr)',
                        gap: 12,
                        alignItems: 'start',
                        padding: '10px 12px',
                        borderRadius: 12,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.07)',
                      }}
                    >
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 800, color: '#00F0FF', whiteSpace: 'nowrap' }}>
                        {item.value}
                      </div>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>
                          {item.label}
                        </div>
                        <div style={{ fontSize: 12, color: '#A1A1AA', lineHeight: 1.55 }}>
                          {item.desc}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <p style={{ margin: 0, color: '#71717A', fontSize: 12, lineHeight: 1.6 }}>
                  {copy.dashboardShowcase.proofPanel.note}
                </p>
              </div>
            </div>
          </div>

          <div style={{ padding: '0 28px 28px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 20 }}>
              {CARD_META.map((card) => {
                const Icon = card.icon;
                const content = copy.dashboardShowcase.cards[card.key];
                return (
                  <div
                    key={card.key}
                    data-testid={`dashboard-showcase-card-${card.key}`}
                    style={{
                      padding: 20,
                      borderRadius: 16,
                      background: 'rgba(5,5,5,0.36)',
                      border: `1px solid ${card.color}20`,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                      <div
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 12,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: `${card.color}12`,
                          border: `1px solid ${card.color}28`,
                        }}
                      >
                        <Icon size={18} color={card.color} />
                      </div>
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 800,
                          letterSpacing: '0.1em',
                          textTransform: 'uppercase',
                          color: card.tier === 'ultimate' ? '#BD00FF' : '#FFB800',
                        }}
                      >
                        {card.tier === 'ultimate' ? 'Ultimate' : 'Pro'}
                      </span>
                    </div>
                    <h3
                      style={{
                        fontFamily: "'Orbitron', sans-serif",
                        fontSize: 14,
                        fontWeight: 700,
                        marginBottom: 8,
                      }}
                    >
                      {content.title}
                    </h3>
                    <p style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.6 }}>
                      {content.desc}
                    </p>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, marginBottom: 20 }}>
              {copy.dashboardShowcase.workflow.steps.map((step, index) => (
                <div
                  key={step.title}
                  data-testid={`dashboard-showcase-workflow-step-${index + 1}`}
                  style={{
                    padding: '16px 18px',
                    borderRadius: 16,
                    background: 'rgba(5,5,5,0.28)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <div style={{
                      width: 28,
                      height: 28,
                      borderRadius: 9,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: 'rgba(0,240,255,0.12)',
                      border: '1px solid rgba(0,240,255,0.24)',
                      color: '#00F0FF',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 800,
                      fontSize: 12,
                    }}>
                      {index + 1}
                    </div>
                    <span style={{ fontSize: 10, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                      {copy.dashboardShowcase.workflow.eyebrow}
                    </span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
                    {step.title}
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: '#A1A1AA', lineHeight: 1.65 }}>
                    {step.desc}
                  </p>
                </div>
              ))}
            </div>

            <div
              data-testid="dashboard-showcase-preview"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(220px, 0.85fr) minmax(0, 1.15fr)',
                gap: 16,
                marginBottom: 22,
              }}
              className="dashboard-showcase-preview-grid"
            >
              <div
                style={{
                  borderRadius: 18,
                  padding: 20,
                  background: 'rgba(5,5,5,0.34)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                  {copy.dashboardShowcase.preview.eyebrow}
                </div>
                <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 18, fontWeight: 800, marginBottom: 16 }}>
                  {copy.dashboardShowcase.preview.title}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {copy.dashboardShowcase.preview.metrics.map((item) => (
                    <div
                      key={item.label}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 12px',
                        borderRadius: 12,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      <span style={{ color: '#A1A1AA', fontSize: 12 }}>{item.label}</span>
                      <span style={{ color: '#00F0FF', fontFamily: "'JetBrains Mono', monospace", fontWeight: 800 }}>{item.value}</span>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div style={{ fontSize: 10, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>
                    {copy.dashboardShowcase.preview.proofLabel}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {copy.dashboardShowcase.preview.proofItems.map((item) => (
                      <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#D4D4D8', fontSize: 12, lineHeight: 1.55 }}>
                        <CheckCircle2 size={13} color="#39FF14" style={{ flexShrink: 0, marginTop: 2 }} />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div
                style={{
                  borderRadius: 18,
                  padding: 20,
                  background: 'rgba(5,5,5,0.34)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                      {copy.dashboardShowcase.preview.serverLabel}
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 800 }}>
                      {copy.dashboardShowcase.preview.serverValue}
                    </div>
                  </div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '6px 10px',
                      borderRadius: 999,
                      background: 'rgba(57,255,20,0.12)',
                      border: '1px solid rgba(57,255,20,0.24)',
                      color: '#39FF14',
                      fontSize: 11,
                      fontWeight: 800,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                    }}
                  >
                    {copy.dashboardShowcase.preview.status}
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {copy.dashboardShowcase.preview.rows.map((row) => (
                    <div
                      key={row.label}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) auto',
                        gap: 12,
                        alignItems: 'center',
                        padding: '11px 12px',
                        borderRadius: 12,
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}
                    >
                      <span style={{ fontSize: 13, color: '#D4D4D8' }}>{row.label}</span>
                      <span style={{ fontSize: 12, color: '#A1A1AA', fontWeight: 700 }}>{row.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14, marginBottom: 20 }}>
              {copy.dashboardShowcase.tiers.map((tier) => (
                <div
                  key={tier.key}
                  data-testid={`dashboard-showcase-tier-${tier.key}`}
                  style={{
                    padding: '16px 18px',
                    borderRadius: 16,
                    background: 'rgba(255,255,255,0.03)',
                    border: `1px solid ${(TIER_COLORS[tier.key] || '#FFB800')}25`,
                  }}
                >
                  <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '5px 10px', borderRadius: 999, background: `${(TIER_COLORS[tier.key] || '#FFB800')}14`, border: `1px solid ${(TIER_COLORS[tier.key] || '#FFB800')}28`, color: TIER_COLORS[tier.key] || '#FFB800', fontSize: 10, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                    {tier.badge}
                  </div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>
                    {tier.title}
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: '#A1A1AA', lineHeight: 1.65 }}>
                    {tier.desc}
                  </p>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <a
                href={buildDashboardHref(locale)}
                data-testid="dashboard-showcase-primary-cta"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '13px 22px',
                  borderRadius: 999,
                  background: '#00F0FF',
                  color: '#050505',
                  fontWeight: 800,
                  textDecoration: 'none',
                }}
              >
                {copy.dashboardShowcase.primaryCta}
                <ArrowRight size={16} />
              </a>
              <a
                href="#premium"
                data-testid="dashboard-showcase-secondary-cta"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '13px 22px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.14)',
                  color: '#fff',
                  fontWeight: 700,
                  textDecoration: 'none',
                }}
              >
                {copy.dashboardShowcase.secondaryCta}
              </a>
              <span data-testid="dashboard-showcase-cta-note" style={{ color: '#71717A', fontSize: 13, lineHeight: 1.6 }}>
                {copy.dashboardShowcase.ctaNote}
              </span>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .dashboard-showcase-top-grid,
          .dashboard-showcase-preview-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
