import React from 'react';
import { Activity, CalendarClock, LayoutDashboard, Shield, Webhook } from 'lucide-react';
import { useI18n } from '../i18n';

const CARD_META = [
  { key: 'events', icon: CalendarClock, color: '#00F0FF', tier: 'pro' },
  { key: 'permissions', icon: Shield, color: '#FFB800', tier: 'pro' },
  { key: 'health', icon: Activity, color: '#39FF14', tier: 'pro' },
  { key: 'automation', icon: Webhook, color: '#BD00FF', tier: 'ultimate' },
];

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

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <a
                href={buildDashboardHref(locale)}
                data-testid="dashboard-showcase-primary-cta"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '13px 22px',
                  borderRadius: 999,
                  background: '#00F0FF',
                  color: '#050505',
                  fontWeight: 800,
                }}
              >
                {copy.dashboardShowcase.primaryCta}
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
                }}
              >
                {copy.dashboardShowcase.secondaryCta}
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
