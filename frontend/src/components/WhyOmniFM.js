import React from 'react';
import { AudioLines, Gauge, LayoutDashboard, Users } from 'lucide-react';
import { useI18n } from '../i18n';

const CARD_META = [
  { key: 'radio', icon: AudioLines, color: '#00F0FF' },
  { key: 'workers', icon: Users, color: '#39FF14' },
  { key: 'control', icon: LayoutDashboard, color: '#FFB800' },
  { key: 'growth', icon: Gauge, color: '#BD00FF' },
];

export default function WhyOmniFM() {
  const { copy } = useI18n();

  return (
    <section
      id="why-omnifm"
      data-testid="why-omnifm-section"
      style={{ padding: '32px 0 80px', position: 'relative', zIndex: 1 }}
    >
      <div className="section-container">
        <div style={{ marginBottom: 40 }}>
          <span
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#39FF14',
            }}
          >
            {copy.whyOmniFM.eyebrow}
          </span>
          <h2
            data-testid="why-omnifm-title"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 800,
              fontSize: 'clamp(24px, 4vw, 40px)',
              marginTop: 8,
              marginBottom: 12,
            }}
          >
            {copy.whyOmniFM.title}
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 720, lineHeight: 1.7 }}>
            {copy.whyOmniFM.subtitle}
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
          {CARD_META.map((card) => {
            const Icon = card.icon;
            const content = copy.whyOmniFM.cards[card.key];
            return (
              <div
                key={card.key}
                data-testid={`why-omnifm-card-${card.key}`}
                className="ui-lift"
                style={{
                  padding: 24,
                  borderRadius: 16,
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${card.color}18`,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: `${card.color}12`,
                    border: `1px solid ${card.color}30`,
                    marginBottom: 16,
                  }}
                >
                  <Icon size={20} color={card.color} />
                </div>
                <h3
                  style={{
                    fontFamily: "'Orbitron', sans-serif",
                    fontSize: 15,
                    fontWeight: 700,
                    marginBottom: 8,
                  }}
                >
                  {content.title}
                </h3>
                <p style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.65 }}>
                  {content.desc}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
