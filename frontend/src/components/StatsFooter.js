import React from 'react';
import { Radio, Github, Heart } from 'lucide-react';

function StatsFooter({ stats }) {
  return (
    <footer
      data-testid="stats-footer"
      style={{
        padding: '60px 0 32px',
        position: 'relative',
        zIndex: 1,
        borderTop: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <div className="section-container">
        {/* Stats bar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 48,
            flexWrap: 'wrap',
            marginBottom: 48,
            padding: '28px 32px',
            borderRadius: 20,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
          }}
        >
          {[
            { label: 'Server', value: stats.servers || 0, color: '#00F0FF' },
            { label: 'Nutzer', value: stats.users || 0, color: '#39FF14' },
            { label: 'Verbindungen', value: stats.connections || 0, color: '#EC4899' },
            { label: 'Zuhörer', value: stats.listeners || 0, color: '#FFB800' },
            { label: 'Stationen', value: stats.stations || 0, color: '#BD00FF' },
          ].map((s) => (
            <div key={s.label} style={{ textAlign: 'center' }}>
              <div
                data-testid={`stat-${s.label.toLowerCase()}`}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 24,
                  fontWeight: 700,
                  color: s.color,
                  textShadow: `0 0 15px ${s.color}50`,
                }}
              >
                {s.value.toLocaleString('de-DE')}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: '#52525B',
                  fontWeight: 600,
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  marginTop: 4,
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>

        {/* Footer bottom */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Radio size={16} color="#00F0FF" />
            <span
              style={{
                fontFamily: "'Orbitron', sans-serif",
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.05em',
              }}
            >
              RADIO<span style={{ color: '#00F0FF' }}>BOT</span>
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 20,
            }}
          >
            <a
              href="https://github.com/Tabsi1998/Discord-Radio-Bot"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="footer-github"
              style={{
                color: '#52525B',
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#fff')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#52525B')}
            >
              <Github size={18} />
            </a>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: '#52525B',
            }}
          >
            Gebaut mit <Heart size={12} color="#FF2A2A" /> für Discord
          </div>
        </div>
      </div>
    </footer>
  );
}

export default StatsFooter;
