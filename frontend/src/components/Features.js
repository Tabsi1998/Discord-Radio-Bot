import React from 'react';
import { ArrowRight, Radio, Shield, Volume2 } from 'lucide-react';
import { useI18n } from '../i18n';

const STEP_ICONS = [Shield, Radio, Volume2];
const STEP_COLORS = ['#00F0FF', '#39FF14', '#FFB800'];

function FlowColumn() {
  const { copy } = useI18n();

  return (
    <div>
      <span
        style={{
          fontFamily: "'Orbitron', sans-serif",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: '#00F0FF',
        }}
      >
        {copy.features.eyebrow}
      </span>
      <h2
        data-testid="how-it-works-title"
        style={{
          fontFamily: "'Orbitron', sans-serif",
          fontWeight: 800,
          fontSize: 'clamp(24px, 4vw, 40px)',
          marginTop: 8,
          marginBottom: 14,
        }}
      >
        {copy.features.title}
      </h2>

      <div style={{ display: 'grid', gap: 0, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        {copy.features.steps.map((item, index) => {
          const Icon = STEP_ICONS[index] || Shield;
          const color = STEP_COLORS[index] || '#00F0FF';
          return (
            <div
              key={item.step}
              data-testid={`step-card-${index}`}
              style={{
                display: 'grid',
                gridTemplateColumns: '56px minmax(0, 1fr) auto',
                gap: 14,
                alignItems: 'start',
                padding: '18px 0',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
              }}
              className="features-step-row"
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: `1px solid ${color}45`,
                  color,
                }}
              >
                <Icon size={18} />
              </div>
              <div>
                <div
                  style={{
                    fontSize: 10,
                    color,
                    fontWeight: 800,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}
                >
                  {item.step}
                </div>
                <h3
                  style={{
                    fontFamily: "'Orbitron', sans-serif",
                    fontSize: 15,
                    fontWeight: 700,
                    marginBottom: 6,
                  }}
                >
                  {item.title}
                </h3>
                <p style={{ margin: 0, fontSize: 14, color: '#A1A1AA', lineHeight: 1.7 }}>
                  {item.desc}
                </p>
              </div>
              {index < copy.features.steps.length - 1 ? <ArrowRight size={16} color="#3F3F46" style={{ marginTop: 12 }} /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CapabilityColumn() {
  const { copy } = useI18n();

  return (
    <div>
      <div
        style={{
          fontFamily: "'Orbitron', sans-serif",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: '#39FF14',
          marginBottom: 10,
        }}
      >
        {copy.features.gridEyebrow}
      </div>
      <h3
        data-testid="features-title"
        style={{
          fontFamily: "'Orbitron', sans-serif",
          fontWeight: 800,
          fontSize: 'clamp(22px, 3vw, 30px)',
          marginBottom: 20,
        }}
      >
        {copy.features.gridTitle}
      </h3>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
        {copy.features.grid.map((feature, index) => (
          <div
            key={feature.title}
            data-testid={`feature-card-${index}`}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0, 0.9fr) minmax(0, 1.1fr)',
              gap: 14,
              padding: '16px 0',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
            }}
            className="feature-line-row"
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#F4F4F5' }}>
              {feature.title}
            </div>
            <div style={{ fontSize: 13, color: '#71717A', lineHeight: 1.7 }}>
              {feature.desc}
            </div>
          </div>
        ))}
      </div>

      <div
        data-testid="architecture-flow"
        style={{
          marginTop: 20,
          paddingTop: 18,
          borderTop: '1px solid rgba(255,255,255,0.08)',
          display: 'grid',
          gap: 10,
        }}
      >
        <div style={{ fontSize: 10, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 800 }}>
          System Flow
        </div>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, color: '#D4D4D8', fontSize: 14 }}>
          <span>{copy.features.architecture.commander}</span>
          <ArrowRight size={14} color="#3F3F46" />
          <span>{copy.features.architecture.workers}</span>
          <ArrowRight size={14} color="#3F3F46" />
          <span>{copy.features.architecture.channel}</span>
        </div>
        <div style={{ fontSize: 13, color: '#71717A', lineHeight: 1.7 }}>
          {copy.features.architecture.commanderDesc}. {copy.features.architecture.workersDesc}. {copy.features.architecture.channelDesc}.
        </div>
      </div>
    </div>
  );
}

function Features() {
  return (
    <section
      id="features"
      data-testid="features-section"
      style={{ padding: '72px 0 80px', position: 'relative', zIndex: 1 }}
    >
      <div className="section-container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 0.95fr) minmax(0, 1.05fr)',
            gap: 32,
            alignItems: 'start',
          }}
          className="features-main-grid"
        >
          <FlowColumn />
          <CapabilityColumn />
        </div>
      </div>

      <style>{`
        @media (max-width: 920px) {
          .features-main-grid,
          .features-step-row,
          .feature-line-row {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </section>
  );
}

export default Features;
