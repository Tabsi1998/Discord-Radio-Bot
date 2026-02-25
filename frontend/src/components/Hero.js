import React from 'react';
import { Radio, Volume2, Headphones } from 'lucide-react';

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
      {bars.map((h, i) => (
        <div
          key={i}
          style={{
            width: 4,
            borderRadius: '2px 2px 0 0',
            background: `linear-gradient(to top, #00F0FF, #39FF14)`,
            animation: `eq-bounce ${0.6 + Math.random() * 0.8}s ease-in-out infinite`,
            animationDelay: `${i * 0.08}s`,
            height: `${h * 100}%`,
            transformOrigin: 'bottom',
          }}
        />
      ))}
    </div>
  );
}

function Hero({ stats }) {
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

      {/* Glow effects */}
      <div style={{
        position: 'absolute', top: '-20%', left: '-10%',
        width: '50%', height: '60%', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(0,240,255,0.06) 0%, transparent 70%)',
        filter: 'blur(80px)', pointerEvents: 'none', animation: 'glow-pulse 6s ease-in-out infinite',
      }} />
      <div style={{
        position: 'absolute', bottom: '-10%', right: '-5%',
        width: '40%', height: '50%', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(57,255,20,0.04) 0%, transparent 70%)',
        filter: 'blur(80px)', pointerEvents: 'none', animation: 'glow-pulse 8s ease-in-out infinite 2s',
      }} />

      <div className="section-container" style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ maxWidth: 720 }}>
          {/* Equalizer */}
          <div style={{ marginBottom: 32, animation: 'hero-fade-in 0.6s ease-out' }}>
            <Equalizer />
          </div>

          {/* Badge */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '6px 16px', borderRadius: 999,
            background: 'rgba(0, 240, 255, 0.06)', border: '1px solid rgba(0, 240, 255, 0.15)',
            marginBottom: 28,
            animation: 'hero-fade-in 0.6s ease-out 0.1s both',
          }}>
            <Radio size={14} color="#00F0FF" />
            <span style={{
              fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600,
              letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00F0FF',
            }}>
              OmniFM Radio Network
            </span>
          </div>

          {/* Title */}
          <h1
            data-testid="hero-title"
            style={{
              fontFamily: "'Orbitron', sans-serif", fontWeight: 900,
              fontSize: 'clamp(36px, 6vw, 72px)', lineHeight: 1.05,
              letterSpacing: '-0.02em', marginBottom: 20,
              animation: 'hero-fade-in 0.6s ease-out 0.2s both',
            }}
          >
            Dein Discord{' '}
            <span style={{ color: '#00F0FF', textShadow: '0 0 40px rgba(0,240,255,0.3)' }}>Radio.</span>
            <br />
            24/7 Live.
          </h1>

          {/* Description */}
          <p data-testid="hero-subtitle" style={{
            fontSize: 'clamp(16px, 2vw, 19px)', color: '#A1A1AA', maxWidth: 520,
            lineHeight: 1.7, marginBottom: 40,
            animation: 'hero-fade-in 0.6s ease-out 0.3s both',
          }}>
            Ein Commander-Bot steuert, Worker-Bots streamen.
            120+ Radiosender, Opus-Audio, Auto-Reconnect.
            Lade den Bot ein und <span style={{ color: '#fff', fontWeight: 600 }}>/play</span> dr\u00FCcken.
          </p>

          {/* CTAs */}
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 60,
            animation: 'hero-fade-in 0.6s ease-out 0.4s both',
          }}>
            <a
              href="#bots"
              data-testid="hero-cta-invite"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 32px',
                borderRadius: 999, background: '#00F0FF', color: '#050505', fontWeight: 700, fontSize: 15,
                textDecoration: 'none', cursor: 'pointer',
                transition: 'transform 0.2s, box-shadow 0.2s',
                boxShadow: '0 0 30px rgba(0,240,255,0.2)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = '0 0 40px rgba(0,240,255,0.35)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 0 30px rgba(0,240,255,0.2)'; }}
            >
              <Headphones size={18} />
              Bot einladen
            </a>
            <a
              href="#features"
              data-testid="hero-cta-features"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 32px',
                borderRadius: 999, background: 'transparent', color: '#fff', fontWeight: 600, fontSize: 15,
                textDecoration: 'none', border: '1px solid rgba(255,255,255,0.15)', cursor: 'pointer',
                transition: 'background 0.2s, border-color 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'; }}
            >
              <Volume2 size={18} />
              Wie es funktioniert
            </a>
          </div>

          {/* Stats */}
          <div data-testid="hero-quick-stats" style={{
            display: 'flex', gap: 48, flexWrap: 'wrap',
            animation: 'hero-fade-in 0.6s ease-out 0.5s both',
          }}>
            {[
              { label: 'Server', value: stats.servers || 0, color: '#00F0FF' },
              { label: 'Stationen', value: stats.stations || 0, color: '#39FF14' },
              { label: 'Bots', value: stats.bots || 0, color: '#FFB800' },
            ].map((s) => (
              <div key={s.label}>
                <div style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 28, fontWeight: 700, color: s.color,
                  textShadow: `0 0 20px ${s.color}40`,
                }}>
                  {s.value.toLocaleString('de-DE')}
                </div>
                <div style={{
                  fontSize: 12, color: '#52525B', fontWeight: 600,
                  letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4,
                }}>
                  {s.label}
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
