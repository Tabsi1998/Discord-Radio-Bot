import React from 'react';
import {
  ArrowRight,
  Clock,
  Gauge,
  Radio,
  RefreshCw,
  Shield,
  Users,
  Volume2,
  Zap,
} from 'lucide-react';
import { useI18n } from '../i18n';

const FEATURE_ICONS = [Clock, Users, Zap, Volume2, RefreshCw, Gauge];
const FEATURE_COLORS = ['#00F0FF', '#39FF14', '#FFB800', '#EC4899', '#BD00FF', '#FF2A2A'];
const STEP_ICONS = [Shield, Radio, Volume2];
const STEP_COLORS = ['#00F0FF', '#39FF14', '#FFB800'];

function HowItWorks() {
  const { copy } = useI18n();

  return (
    <div style={{ marginBottom: 80 }}>
      <div style={{ marginBottom: 48 }}>
        <span style={{
          fontFamily: "'Orbitron', sans-serif",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: '#00F0FF',
        }}>
          {copy.features.eyebrow}
        </span>
        <h2
          data-testid="how-it-works-title"
          style={{
            fontFamily: "'Orbitron', sans-serif",
            fontWeight: 800,
            fontSize: 'clamp(24px, 4vw, 40px)',
            marginTop: 8,
            marginBottom: 16,
          }}
        >
          {copy.features.title}
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 24 }}>
        {copy.features.steps.map((item, index) => {
          const Icon = STEP_ICONS[index] || Shield;
          const color = STEP_COLORS[index] || '#00F0FF';

          return (
            <div
              key={item.step}
              data-testid={`step-card-${index}`}
              style={{
                position: 'relative',
                padding: '32px 28px',
                borderRadius: 16,
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${color}15`,
                transition: 'border-color 0.3s',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.borderColor = `${color}40`;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.borderColor = `${color}15`;
              }}
            >
              <div style={{
                position: 'absolute',
                top: 16,
                right: 20,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 42,
                fontWeight: 800,
                color: `${color}08`,
                lineHeight: 1,
              }}>
                {item.step}
              </div>
              <div style={{
                width: 48,
                height: 48,
                borderRadius: 14,
                background: `${color}10`,
                border: `1px solid ${color}25`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: 20,
              }}>
                <Icon size={22} color={color} />
              </div>
              <h3 style={{
                fontFamily: "'Orbitron', sans-serif",
                fontSize: 16,
                fontWeight: 700,
                marginBottom: 8,
                letterSpacing: '0.01em',
              }}>
                {item.title}
              </h3>
              <p style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.7, margin: 0 }}>
                {item.desc}
              </p>
            </div>
          );
        })}
      </div>

      <div
        data-testid="architecture-flow"
        style={{
          marginTop: 40,
          padding: '28px 32px',
          borderRadius: 16,
          background: 'rgba(0,240,255,0.03)',
          border: '1px solid rgba(0,240,255,0.1)',
          display: 'flex',
          alignItems: 'center',
          gap: 20,
          flexWrap: 'wrap',
          justifyContent: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shield size={20} color="#00F0FF" />
          <div>
            <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 700, color: '#00F0FF' }}>
              {copy.features.architecture.commander}
            </div>
            <div style={{ fontSize: 11, color: '#52525B' }}>
              {copy.features.architecture.commanderDesc}
            </div>
          </div>
        </div>
        <ArrowRight size={18} color="#52525B" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Radio size={20} color="#39FF14" />
          <div>
            <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 700, color: '#39FF14' }}>
              {copy.features.architecture.workers}
            </div>
            <div style={{ fontSize: 11, color: '#52525B' }}>
              {copy.features.architecture.workersDesc}
            </div>
          </div>
        </div>
        <ArrowRight size={18} color="#52525B" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Volume2 size={20} color="#FFB800" />
          <div>
            <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 700, color: '#FFB800' }}>
              {copy.features.architecture.channel}
            </div>
            <div style={{ fontSize: 11, color: '#52525B' }}>
              {copy.features.architecture.channelDesc}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureGrid() {
  const { copy } = useI18n();

  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <span style={{
          fontFamily: "'Orbitron', sans-serif",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          color: '#39FF14',
        }}>
          {copy.features.gridEyebrow}
        </span>
        <h2
          data-testid="features-title"
          style={{
            fontFamily: "'Orbitron', sans-serif",
            fontWeight: 800,
            fontSize: 'clamp(24px, 4vw, 40px)',
            marginTop: 8,
          }}
        >
          {copy.features.gridTitle}
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {copy.features.grid.map((feature, index) => {
          const Icon = FEATURE_ICONS[index] || Clock;
          const color = FEATURE_COLORS[index] || '#00F0FF';

          return (
            <div
              key={feature.title}
              data-testid={`feature-card-${index}`}
              style={{
                padding: 24,
                display: 'flex',
                gap: 16,
                alignItems: 'flex-start',
                borderRadius: 14,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                transition: 'border-color 0.3s',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.borderColor = `${color}30`;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
              }}
            >
              <div style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: `${color}10`,
                border: `1px solid ${color}25`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                <Icon size={18} color={color} />
              </div>
              <div>
                <h3 style={{
                  fontFamily: "'Orbitron', sans-serif",
                  fontSize: 14,
                  fontWeight: 700,
                  marginBottom: 6,
                  letterSpacing: '0.01em',
                }}>
                  {feature.title}
                </h3>
                <p style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.6, margin: 0 }}>
                  {feature.desc}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Features() {
  return (
    <section
      id="features"
      data-testid="features-section"
      style={{ padding: '80px 0', position: 'relative', zIndex: 1 }}
    >
      <div className="section-container">
        <HowItWorks />
        <FeatureGrid />
      </div>
    </section>
  );
}

export default Features;
