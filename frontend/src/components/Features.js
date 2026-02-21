import React from 'react';
import { Zap, Shield, Clock, Users, Volume2, Gauge } from 'lucide-react';

const features = [
  {
    icon: Clock,
    title: '24/7 Streaming',
    desc: 'Nonstop Radio, rund um die Uhr. Dein Server schläft nie.',
    color: '#00F0FF',
  },
  {
    icon: Users,
    title: 'Multi-Bot System',
    desc: 'Bis zu 20 Bots parallel. Jeder Bot kann in einem eigenen Channel spielen.',
    color: '#39FF14',
  },
  {
    icon: Zap,
    title: 'Sofort bereit',
    desc: 'Slash-Commands. Kein Prefix nötig. /play und los gehts.',
    color: '#FFB800',
  },
  {
    icon: Volume2,
    title: 'HQ Audio',
    desc: 'Opus-Transcoding mit konfigurierbarer Bitrate. Kristallklarer Sound.',
    color: '#EC4899',
  },
  {
    icon: Shield,
    title: 'Auto-Reconnect',
    desc: 'Fällt die Verbindung, verbindet sich der Bot automatisch neu.',
    color: '#BD00FF',
  },
  {
    icon: Gauge,
    title: 'Unbegrenzt skalierbar',
    desc: 'Beliebig viele Bots hinzufügen. Jeder Bot läuft unabhängig und stabil.',
    color: '#FF2A2A',
  },
];

function Features() {
  return (
    <section
      id="features"
      data-testid="features-section"
      style={{
        padding: '80px 0', position: 'relative', zIndex: 1,
        background: 'linear-gradient(180deg, transparent 0%, rgba(0,240,255,0.015) 50%, transparent 100%)',
      }}
    >
      <div className="section-container">
        <div style={{ textAlign: 'center', marginBottom: 56 }}>
          <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00F0FF' }}>
            Warum OmniFM?
          </span>
          <h2 data-testid="features-title" style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 'clamp(24px, 4vw, 40px)', marginTop: 8 }}>
            Gebaut für Qualität
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
          {features.map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={i}
                data-testid={`feature-card-${i}`}
                className="glass-card"
                style={{ padding: 28, display: 'flex', gap: 16, alignItems: 'flex-start', transition: 'border-color 0.3s' }}
              >
                <div style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: `${f.color}10`, border: `1px solid ${f.color}25`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}>
                  <Icon size={20} color={f.color} />
                </div>
                <div>
                  <h3 style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 15, fontWeight: 700, marginBottom: 6, letterSpacing: '0.01em' }}>
                    {f.title}
                  </h3>
                  <p style={{ fontSize: 14, color: '#A1A1AA', lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default Features;
