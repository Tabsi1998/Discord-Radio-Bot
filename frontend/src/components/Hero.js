import React from 'react';
import { Headphones, Radio, Volume2 } from 'lucide-react';
import { useI18n } from '../i18n';
import { resolvePrimaryInviteUrl } from '../lib/invite';

const eqStyle = `
@keyframes eq-bounce {
  0%, 100% { transform: scaleY(0.3); }
  50% { transform: scaleY(1); }
}
@keyframes hero-fade-in {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes glow-pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.7; }
}
`;

function Equalizer() {
  const bars = [0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.3, 0.7, 0.5, 0.6, 0.8, 0.4];

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 48, padding: '0 8px' }}>
      {bars.map((height, index) => (
        <div
          key={index}
          style={{
            width: 4,
            borderRadius: '2px 2px 0 0',
            background: 'linear-gradient(to top, #00F0FF, #39FF14)',
            animationName: 'eq-bounce',
            animationDuration: `${0.6 + Math.random() * 0.8}s`,
            animationTimingFunction: 'ease-in-out',
            animationIterationCount: 'infinite',
            animationDelay: `${index * 0.08}s`,
            height: `${height * 100}%`,
            transformOrigin: 'bottom',
          }}
        />
      ))}
    </div>
  );
}

function Hero({ stats, bots }) {
  const { copy, formatNumber } = useI18n();
  const inviteUrl = resolvePrimaryInviteUrl(bots);
  const subtitleTail = String(copy.hero.subtitleTail || '').trim();
  const subtitleSpacer = subtitleTail && !/^[.,!?;:]/.test(subtitleTail) ? ' ' : '';
  const heroStats = [
    { label: copy.hero.stats.servers, value: stats.servers || 0, color: '#00F0FF' },
    { label: copy.hero.stats.stations, value: stats.stations || 0, color: '#39FF14' },
    { label: copy.hero.stats.bots, value: stats.bots || 0, color: '#FFB800' },
  ];

  return (
    <section
      id="top"
      data-testid="hero-section"
      style={{
        position: 'relative',
        minHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '140px 24px 100px',
        overflow: 'hidden',
      }}
    >
      <style>{eqStyle}</style>

      <div style={{
        position: 'absolute',
        top: '-20%',
        left: '-10%',
        width: '50%',
        height: '60%',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0,240,255,0.06) 0%, transparent 70%)',
        filter: 'blur(80px)',
        pointerEvents: 'none',
        animation: 'glow-pulse 6s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute',
        bottom: '-10%',
        right: '-5%',
        width: '40%',
        height: '50%',
        borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(57,255,20,0.04) 0%, transparent 70%)',
        filter: 'blur(80px)',
        pointerEvents: 'none',
        animation: 'glow-pulse 8s ease-in-out infinite 2s',
      }} />

      <div className="section-container" style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ maxWidth: 760 }}>
          <div style={{ marginBottom: 32, animation: 'hero-fade-in 0.6s ease-out' }}>
            <Equalizer />
          </div>

          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 16px',
            borderRadius: 999,
            background: 'rgba(0, 240, 255, 0.06)',
            border: '1px solid rgba(0, 240, 255, 0.15)',
            marginBottom: 28,
            animation: 'hero-fade-in 0.6s ease-out 0.1s both',
          }}>
            <Radio size={14} color="#00F0FF" />
            <span style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#00F0FF',
            }}>
              {copy.hero.badge}
            </span>
          </div>

          <h1
            data-testid="hero-title"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 900,
              fontSize: 'clamp(36px, 6vw, 72px)',
              lineHeight: 1.05,
              letterSpacing: '-0.02em',
              marginBottom: 20,
              animation: 'hero-fade-in 0.6s ease-out 0.2s both',
            }}
          >
            {copy.hero.titleLead}{' '}
            <span style={{ color: '#00F0FF', textShadow: '0 0 40px rgba(0,240,255,0.3)' }}>
              {copy.hero.titleAccent}
            </span>
            <br />
            {copy.hero.titleTail}
          </h1>

          <p
            data-testid="hero-subtitle"
            style={{
              fontSize: 'clamp(16px, 2vw, 19px)',
              color: '#A1A1AA',
              maxWidth: 560,
              lineHeight: 1.7,
              marginBottom: 40,
              animation: 'hero-fade-in 0.6s ease-out 0.3s both',
            }}
          >
            {copy.hero.subtitleLead}{' '}
            <span style={{ color: '#fff', fontWeight: 600 }}>/play</span>
            {subtitleTail ? `${subtitleSpacer}${subtitleTail}` : ''}
          </p>

          <div style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 14,
            marginBottom: 52,
            animation: 'hero-fade-in 0.6s ease-out 0.4s both',
          }}>
            <a
              href={inviteUrl}
              data-testid="hero-cta-invite"
              target={inviteUrl.startsWith('http') ? '_blank' : undefined}
              rel={inviteUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 32px',
                borderRadius: 999,
                background: '#00F0FF',
                color: '#050505',
                fontWeight: 700,
                fontSize: 15,
                textDecoration: 'none',
                cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
                boxShadow: '0 0 30px rgba(0,240,255,0.2)',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.transform = 'scale(1.05)';
                event.currentTarget.style.boxShadow = '0 0 40px rgba(0,240,255,0.35)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.transform = 'scale(1)';
                event.currentTarget.style.boxShadow = '0 0 30px rgba(0,240,255,0.2)';
              }}
            >
              <Headphones size={18} />
              {copy.hero.ctaInvite}
            </a>
            <a
              href="#features"
              data-testid="hero-cta-features"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '14px 32px',
                borderRadius: 999,
                background: 'transparent',
                color: '#fff',
                fontWeight: 600,
                fontSize: 15,
                textDecoration: 'none',
                border: '1px solid rgba(255,255,255,0.15)',
                cursor: 'pointer',
                transition: 'background 0.2s, border-color 0.2s',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = 'rgba(255,255,255,0.06)';
                event.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = 'transparent';
                event.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)';
              }}
            >
              <Volume2 size={18} />
              {copy.hero.ctaFlow}
            </a>
          </div>

          <div
            data-testid="hero-quick-stats"
            style={{
              display: 'flex',
              gap: 48,
              flexWrap: 'wrap',
              animation: 'hero-fade-in 0.6s ease-out 0.5s both',
            }}
          >
            {heroStats.map((item) => (
              <div key={item.label}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 28,
                  fontWeight: 700,
                  color: item.color,
                  textShadow: `0 0 20px ${item.color}40`,
                }}>
                  {formatNumber(item.value)}
                </div>
                <div style={{
                  fontSize: 12,
                  color: '#52525B',
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  marginTop: 4,
                }}>
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default Hero;
