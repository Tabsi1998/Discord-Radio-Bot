import React from 'react';
import { Shield, Radio, ArrowRight, Zap, Clock, Volume2, Gauge, Users, RefreshCw } from 'lucide-react';

function HowItWorks() {
  return (
    <div style={{ marginBottom: 80 }}>
      <div style={{ marginBottom: 48 }}>
        <span style={{
          fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600,
          letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00F0FF',
        }}>
          So funktioniert's
        </span>
        <h2 data-testid="how-it-works-title" style={{
          fontFamily: "'Orbitron', sans-serif", fontWeight: 800,
          fontSize: 'clamp(24px, 4vw, 40px)', marginTop: 8, marginBottom: 16,
        }}>
          In 3 Schritten zum Radio
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 24 }}>
        {[
          {
            step: '01',
            title: 'Bot einladen',
            desc: 'Lade den OmniFM DJ-Bot (Commander) auf deinen Discord Server ein. Er steuert alles.',
            icon: Shield,
            color: '#00F0FF',
          },
          {
            step: '02',
            title: 'Station w\u00E4hlen',
            desc: 'Nutze /play und wähle aus 120+ Radiosendern. Der Commander delegiert an einen freien Worker.',
            icon: Radio,
            color: '#39FF14',
          },
          {
            step: '03',
            title: 'Musik genie\u00DFen',
            desc: '24/7 Streaming in deinem Voice-Channel. Brauchst du mehr? Lade weitere Worker-Bots ein.',
            icon: Volume2,
            color: '#FFB800',
          },
        ].map((item, i) => {
          const Icon = item.icon;
          return (
            <div
              key={i}
              data-testid={`step-card-${i}`}
              style={{
                position: 'relative',
                padding: '32px 28px',
                borderRadius: 16,
                background: 'rgba(255,255,255,0.02)',
                border: `1px solid ${item.color}15`,
                transition: 'border-color 0.3s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${item.color}40`; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = `${item.color}15`; }}
            >
              <div style={{
                position: 'absolute', top: 16, right: 20,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 42, fontWeight: 800, color: `${item.color}08`,
                lineHeight: 1,
              }}>
                {item.step}
              </div>
              <div style={{
                width: 48, height: 48, borderRadius: 14,
                background: `${item.color}10`, border: `1px solid ${item.color}25`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: 20,
              }}>
                <Icon size={22} color={item.color} />
              </div>
              <h3 style={{
                fontFamily: "'Orbitron', sans-serif", fontSize: 16, fontWeight: 700,
                marginBottom: 8, letterSpacing: '0.01em',
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

      {/* Commander -> Worker Flow */}
      <div
        data-testid="architecture-flow"
        style={{
          marginTop: 40, padding: '28px 32px', borderRadius: 16,
          background: 'rgba(0,240,255,0.03)',
          border: '1px solid rgba(0,240,255,0.1)',
          display: 'flex', alignItems: 'center', gap: 20,
          flexWrap: 'wrap', justifyContent: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Shield size={20} color="#00F0FF" />
          <div>
            <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 700, color: '#00F0FF' }}>COMMANDER</div>
            <div style={{ fontSize: 11, color: '#52525B' }}>Nimmt Befehle entgegen</div>
          </div>
        </div>
        <ArrowRight size={18} color="#52525B" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Radio size={20} color="#39FF14" />
          <div>
            <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 700, color: '#39FF14' }}>WORKER 1-16</div>
            <div style={{ fontSize: 11, color: '#52525B' }}>Streamen die Musik</div>
          </div>
        </div>
        <ArrowRight size={18} color="#52525B" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Volume2 size={20} color="#FFB800" />
          <div>
            <div style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 12, fontWeight: 700, color: '#FFB800' }}>DEIN CHANNEL</div>
            <div style={{ fontSize: 11, color: '#52525B' }}>24/7 nonstop Musik</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const features = [
  { icon: Clock, title: '24/7 Streaming', desc: 'Nonstop Musik, rund um die Uhr. Dein Server schl\u00E4ft nie.', color: '#00F0FF' },
  { icon: Users, title: 'Multi-Bot System', desc: 'Bis zu 16 Worker-Bots parallel. Jeder in einem eigenen Channel.', color: '#39FF14' },
  { icon: Zap, title: 'Slash-Commands', desc: 'Kein Prefix n\u00F6tig. /play und los gehts. Einfach und schnell.', color: '#FFB800' },
  { icon: Volume2, title: 'HQ Audio', desc: 'Opus-Transcoding mit bis zu 320k Bitrate. Kristallklarer Sound.', color: '#EC4899' },
  { icon: RefreshCw, title: 'Auto-Reconnect', desc: 'F\u00E4llt die Verbindung, verbindet sich der Bot automatisch neu.', color: '#BD00FF' },
  { icon: Gauge, title: 'Skalierbar', desc: 'Beliebig viele Worker hinzuf\u00FCgen. Jeder Bot l\u00E4uft unabhängig.', color: '#FF2A2A' },
];

function FeatureGrid() {
  return (
    <div>
      <div style={{ marginBottom: 40 }}>
        <span style={{
          fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600,
          letterSpacing: '0.15em', textTransform: 'uppercase', color: '#39FF14',
        }}>
          Features
        </span>
        <h2 data-testid="features-title" style={{
          fontFamily: "'Orbitron', sans-serif", fontWeight: 800,
          fontSize: 'clamp(24px, 4vw, 40px)', marginTop: 8,
        }}>
          Gebaut f\u00FCr Qualit\u00E4t
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
        {features.map((f, i) => {
          const Icon = f.icon;
          return (
            <div
              key={i}
              data-testid={`feature-card-${i}`}
              style={{
                padding: 24, display: 'flex', gap: 16, alignItems: 'flex-start',
                borderRadius: 14,
                background: 'rgba(255,255,255,0.02)',
                border: '1px solid rgba(255,255,255,0.06)',
                transition: 'border-color 0.3s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = `${f.color}30`; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'; }}
            >
              <div style={{
                width: 40, height: 40, borderRadius: 10,
                background: `${f.color}10`, border: `1px solid ${f.color}25`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <Icon size={18} color={f.color} />
              </div>
              <div>
                <h3 style={{
                  fontFamily: "'Orbitron', sans-serif", fontSize: 14, fontWeight: 700,
                  marginBottom: 6, letterSpacing: '0.01em',
                }}>
                  {f.title}
                </h3>
                <p style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
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
