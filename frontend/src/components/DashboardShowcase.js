import React from 'react';
import { ArrowRight, LayoutDashboard } from 'lucide-react';
import { useI18n } from '../i18n';

const CAPABILITY_META = [
  { key: 'events', color: '#00F0FF', tier: 'pro' },
  { key: 'permissions', color: '#FFB800', tier: 'pro' },
  { key: 'health', color: '#39FF14', tier: 'pro' },
  { key: 'automation', color: '#BD00FF', tier: 'ultimate' },
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
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 0.95fr) minmax(0, 1.05fr)',
            gap: 32,
            alignItems: 'start',
            borderTop: '1px solid rgba(0,240,255,0.16)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            padding: '28px 0',
          }}
          className="dashboard-showcase-shell"
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
            <p style={{ color: '#D4D4D8', fontSize: 17, maxWidth: 640, lineHeight: 1.75, marginBottom: 22 }}>
              {copy.dashboardShowcase.subtitle}
            </p>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {copy.dashboardShowcase.workflow.steps.map((step, index) => (
                <div
                  key={step.title}
                  data-testid={`dashboard-showcase-workflow-step-${index + 1}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '32px minmax(0, 1fr)',
                    gap: 14,
                    padding: '16px 0',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      border: '1px solid rgba(0,240,255,0.3)',
                      color: '#00F0FF',
                      fontFamily: "'JetBrains Mono', monospace",
                      fontWeight: 800,
                      fontSize: 12,
                    }}
                  >
                    {index + 1}
                  </div>
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
                      {step.title}
                    </div>
                    <div style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.7 }}>
                      {step.desc}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', marginTop: 22 }}>
              <a
                href={buildDashboardHref(locale)}
                data-testid="dashboard-showcase-primary-cta"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '13px 20px',
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
                  padding: '13px 20px',
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

          <div>
            <div
              data-testid="dashboard-showcase-preview"
              style={{
                padding: '18px 0 20px',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
                <div>
                  <div style={{ fontSize: 10, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 800, marginBottom: 6 }}>
                    {copy.dashboardShowcase.preview.serverLabel}
                  </div>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>
                    {copy.dashboardShowcase.preview.serverValue}
                  </div>
                </div>
                <div style={{ color: '#39FF14', fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  {copy.dashboardShowcase.preview.status}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12, marginBottom: 18 }} className="dashboard-preview-metrics">
                {copy.dashboardShowcase.preview.metrics.map((item) => (
                  <div key={item.label} style={{ paddingBottom: 10, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                    <div style={{ fontSize: 11, color: '#71717A', marginBottom: 6 }}>{item.label}</div>
                    <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, fontWeight: 800, color: '#00F0FF' }}>
                      {item.value}
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'grid', gap: 0, marginBottom: 18 }}>
                {copy.dashboardShowcase.preview.rows.map((row) => (
                  <div
                    key={row.label}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto',
                      gap: 12,
                      padding: '12px 0',
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <span style={{ fontSize: 14, color: '#D4D4D8' }}>{row.label}</span>
                    <span style={{ fontSize: 13, color: '#A1A1AA', fontWeight: 700 }}>{row.value}</span>
                  </div>
                ))}
              </div>

              <div data-testid="dashboard-showcase-proof-panel">
                <div style={{ fontSize: 10, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 800, marginBottom: 10 }}>
                  {copy.dashboardShowcase.preview.proofLabel}
                </div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {copy.dashboardShowcase.preview.proofItems.map((item) => (
                    <div key={item} style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.65 }}>
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 18, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {CAPABILITY_META.map((entry) => {
                const content = copy.dashboardShowcase.cards[entry.key];
                return (
                  <div
                    key={entry.key}
                    data-testid={`dashboard-showcase-card-${entry.key}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '90px minmax(0, 1fr)',
                      gap: 14,
                      padding: '16px 0',
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                    }}
                    className="dashboard-capability-row"
                  >
                    <div style={{ fontSize: 10, color: entry.color, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                      {entry.tier}
                    </div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>
                        {content.title}
                      </div>
                      <div style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.7 }}>
                        {content.desc}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 18, marginTop: 18 }} className="dashboard-tier-grid">
              {copy.dashboardShowcase.tiers.map((tier) => (
                <div
                  key={tier.key}
                  data-testid={`dashboard-showcase-tier-${tier.key}`}
                  style={{
                    paddingTop: 14,
                    borderTop: `2px solid ${TIER_COLORS[tier.key] || '#FFB800'}`,
                  }}
                >
                  <div style={{ color: TIER_COLORS[tier.key] || '#FFB800', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 8 }}>
                    {tier.badge}
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
                    {tier.title}
                  </div>
                  <div style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.7 }}>
                    {tier.desc}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 920px) {
          .dashboard-showcase-shell,
          .dashboard-tier-grid,
          .dashboard-preview-metrics,
          .dashboard-capability-row {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
