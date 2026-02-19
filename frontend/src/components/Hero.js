import React from 'react';
import { Radio, Volume2, Headphones } from 'lucide-react';

function Equalizer() {
  const bars = [0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.3, 0.7, 0.5, 0.6, 0.8, 0.4];
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 48, padding: '0 8px' }}>
      {bars.map((h, i) => (
        <div
          key={i}
          className="eq-bar"
          style={{
            width: 4,
            borderRadius: '2px 2px 0 0',
            background: 'linear-gradient(to top, #00F0FF, #BD00FF)',
            animationDuration: `${0.6 + Math.random() * 0.8}s`,
            animationDelay: `${i * 0.08}s`,
            height: `${h * 100}%`,
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
        minHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '120px 24px 80px',
        overflow: 'hidden',
      }}
    >
      <div className="hero-glow hero-glow-cyan" />
      <div className="hero-glow hero-glow-purple" />

      <div style={{ marginBottom: 32 }}><Equalizer /></div>

      <div
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 8,
          padding: '6px 16px', borderRadius: 999,
          background: 'rgba(0, 240, 255, 0.06)', border: '1px solid rgba(0, 240, 255, 0.15)',
          marginBottom: 28,
        }}
      >
        <Radio size={14} color="#00F0FF" />
        <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00F0FF' }}>
          Discord Radio Network
        </span>
      </div>

      <h1
        data-testid="hero-title"
        style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 'clamp(32px, 6vw, 72px)', lineHeight: 1.05, letterSpacing: '-0.02em', maxWidth: 800, marginBottom: 20 }}
      >
        Dreh die{' '}
        <span style={{ color: '#00F0FF' }} className="glow-text-cyan">Lautstärke</span>{' '}
        auf
      </h1>

      <p data-testid="hero-subtitle" style={{ fontSize: 'clamp(16px, 2vw, 20px)', color: '#A1A1AA', maxWidth: 560, lineHeight: 1.6, marginBottom: 40 }}>
        24/7 Radio-Bots für deinen Discord Server.
        Wähle deine Station, lade den Bot ein und genieße nonstop Musik.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, justifyContent: 'center', marginBottom: 60 }}>
        <a
          href="#bots"
          data-testid="hero-cta-invite"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 32px',
            borderRadius: 999, background: '#fff', color: '#050505', fontWeight: 700, fontSize: 15,
            textDecoration: 'none', cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s',
            boxShadow: '0 0 30px rgba(255,255,255,0.15)',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.05)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
        >
          <Headphones size={18} />
          Bot einladen
        </a>
        <a
          href="#stations"
          data-testid="hero-cta-stations"
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
          Stationen ansehen
        </a>
        <a
          href="https://discord.gg/UeRkfGS43R"
          target="_blank"
          rel="noopener noreferrer"
          data-testid="hero-cta-discord"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 32px',
            borderRadius: 999, background: 'transparent', color: '#5865F2', fontWeight: 600, fontSize: 15,
            textDecoration: 'none', border: '1px solid rgba(88, 101, 242, 0.3)', cursor: 'pointer',
            transition: 'background 0.2s, border-color 0.2s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(88, 101, 242, 0.1)'; e.currentTarget.style.borderColor = 'rgba(88, 101, 242, 0.5)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(88, 101, 242, 0.3)'; }}
        >
          <svg width="18" height="14" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.3 37.3 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 5 59.6 59.6 0 00.4 45a.3.3 0 00.1.2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.7 38.7 0 01-5.5-2.6.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.3 0l1 .9a.2.2 0 010 .3 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.8.2.2 0 00.3.1A58.5 58.5 0 0070 45.2a.3.3 0 00.1-.2c1.6-16.4-2.6-30.6-11-43.2zM23.7 37c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7zm25.2 0c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7z"/></svg>
          Discord
        </a>
      </div>

      <div data-testid="hero-quick-stats" style={{ display: 'flex', gap: 48, flexWrap: 'wrap', justifyContent: 'center' }}>
        {[
          { label: 'Server', value: stats.servers || 0 },
          { label: 'Stationen', value: stats.stations || 0 },
          { label: 'Bots', value: stats.bots || 0 },
        ].map((s) => (
          <div key={s.label} style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 28, fontWeight: 700, color: '#00F0FF' }} className="glow-text-cyan">
              {s.value.toLocaleString('de-DE')}
            </div>
            <div style={{ fontSize: 12, color: '#52525B', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default Hero;
