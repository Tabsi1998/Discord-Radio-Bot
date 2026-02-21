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
            { label: 'Bots', value: stats.bots || 0, color: '#BD00FF' },
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
              OMNI<span style={{ color: '#00F0FF' }}>FM</span>
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
              href="https://discord.gg/UeRkfGS43R"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="footer-discord"
              title="Discord Community"
              style={{
                color: '#52525B',
                transition: 'color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#5865F2')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#52525B')}
            >
              <svg width="18" height="14" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.3 37.3 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 5 59.6 59.6 0 00.4 45a.3.3 0 00.1.2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.7 38.7 0 01-5.5-2.6.2.2 0 01 0-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.3 0l1 .9a.2.2 0 010 .3 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.8.2.2 0 00.3.1A58.5 58.5 0 0070 45.2a.3.3 0 00.1-.2c1.6-16.4-2.6-30.6-11-43.2zM23.7 37c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7zm25.2 0c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7z"/></svg>
            </a>
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
