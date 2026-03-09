import React from 'react';
import { useI18n } from '../i18n';

const LINE_COLORS = {
  radio: '#00F0FF',
  workers: '#39FF14',
  control: '#FFB800',
  growth: '#BD00FF',
};

export default function WhyOmniFM() {
  const { copy } = useI18n();
  const narrativeOrder = ['radio', 'workers', 'control', 'growth'];

  return (
    <section
      id="why-omnifm"
      data-testid="why-omnifm-section"
      style={{ padding: '8px 0 80px', position: 'relative', zIndex: 1 }}
    >
      <div className="section-container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)',
            gap: 32,
            alignItems: 'start',
          }}
          className="why-omnifm-grid"
        >
          <div>
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
                marginBottom: 14,
              }}
            >
              {copy.whyOmniFM.title}
            </h2>
            <p style={{ color: '#D4D4D8', fontSize: 17, maxWidth: 560, lineHeight: 1.75, marginBottom: 24 }}>
              {copy.whyOmniFM.subtitle}
            </p>

            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
              {narrativeOrder.map((key) => {
                const item = copy.whyOmniFM.cards[key];
                return (
                  <div
                    key={key}
                    data-testid={`why-omnifm-card-${key}`}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '12px minmax(0, 1fr)',
                      gap: 14,
                      padding: '18px 0',
                      borderBottom: '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    <div style={{ width: 12, height: 12, marginTop: 5, background: LINE_COLORS[key] || '#00F0FF' }} />
                    <div>
                      <div
                        style={{
                          fontFamily: "'Orbitron', sans-serif",
                          fontSize: 14,
                          fontWeight: 700,
                          marginBottom: 6,
                        }}
                      >
                        {item.title}
                      </div>
                      <div style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.7 }}>
                        {item.desc}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            data-testid="why-omnifm-comparison"
            style={{
              borderTop: '1px solid rgba(255,255,255,0.08)',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <div style={{ padding: '0 0 18px' }}>
              <div
                style={{
                  fontSize: 11,
                  color: '#BD00FF',
                  textTransform: 'uppercase',
                  letterSpacing: '0.15em',
                  fontWeight: 800,
                  fontFamily: "'Orbitron', sans-serif",
                  marginBottom: 8,
                }}
              >
                {copy.whyOmniFM.comparisonEyebrow}
              </div>
              <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 20, fontWeight: 800 }}>
                {copy.whyOmniFM.comparisonTitle}
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '140px minmax(0, 1fr) minmax(0, 1fr)',
                gap: 16,
                padding: '10px 0 14px',
                borderTop: '1px solid rgba(255,255,255,0.08)',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}
              className="why-omnifm-comparison-head"
            >
              <div />
              <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 800 }}>
                {copy.whyOmniFM.comparisonHeaders.basic}
              </div>
              <div style={{ fontSize: 11, color: '#39FF14', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 800 }}>
                {copy.whyOmniFM.comparisonHeaders.omnifm}
              </div>
            </div>

            {copy.whyOmniFM.comparisonRows.map((row) => (
              <div
                key={row.label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px minmax(0, 1fr) minmax(0, 1fr)',
                  gap: 16,
                  padding: '16px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}
                className="why-omnifm-comparison-row"
              >
                <div style={{ fontSize: 12, color: '#fff', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  {row.label}
                </div>
                <div style={{ fontSize: 14, color: '#71717A', lineHeight: 1.7 }}>
                  {row.basic}
                </div>
                <div style={{ fontSize: 14, color: '#D4D4D8', lineHeight: 1.7 }}>
                  {row.omnifm}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 920px) {
          .why-omnifm-grid,
          .why-omnifm-comparison-head,
          .why-omnifm-comparison-row {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}
