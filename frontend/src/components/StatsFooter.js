import React from 'react';
import { Heart, Radio } from 'lucide-react';
import { useI18n } from '../i18n';

function StatsFooter({ stats }) {
  const { copy, formatNumber } = useI18n();

  const footerStats = [
    { label: copy.footer.stats.servers, value: stats.servers || 0, color: '#00F0FF' },
    { label: copy.footer.stats.users, value: stats.users || 0, color: '#39FF14' },
    { label: copy.footer.stats.connections, value: stats.connections || 0, color: '#EC4899' },
    { label: copy.footer.stats.listeners, value: stats.listeners || 0, color: '#FFB800' },
    { label: copy.footer.stats.bots, value: stats.bots || 0, color: '#BD00FF' },
    { label: copy.footer.stats.stations, value: stats.stations || 0, color: '#00F0FF' },
  ];

  const footerTextLinkStyle = {
    color: '#71717A',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    textDecoration: 'none',
    transition: 'color 0.2s',
  };

  return (
    <footer
      data-testid="stats-footer"
      style={{
        padding: '60px 0 32px',
        position: 'relative',
        zIndex: 0,
        borderTop: '1px solid rgba(255,255,255,0.04)',
      }}
    >
      <div className="section-container">
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
          {footerStats.map((item) => (
            <div key={item.label} style={{ textAlign: 'center' }}>
              <div
                data-testid={`stat-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 24,
                  fontWeight: 700,
                  color: item.color,
                  textShadow: `0 0 15px ${item.color}50`,
                }}
              >
                {formatNumber(item.value)}
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
                {item.label}
              </div>
            </div>
          ))}
        </div>

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
              href="#impressum"
              data-testid="footer-impressum"
              style={footerTextLinkStyle}
              onMouseEnter={(event) => {
                event.currentTarget.style.color = '#F4F4F5';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = '#71717A';
              }}
            >
              {copy.footer.links.imprint}
            </a>
            <a
              href="https://discord.gg/UeRkfGS43R"
              target="_blank"
              rel="noopener noreferrer"
              data-testid="footer-discord"
              title={copy.footer.discord}
              style={{
                color: '#52525B',
                transition: 'color 0.2s',
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.color = '#5865F2';
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.color = '#52525B';
              }}
            >
              <svg width="18" height="14" viewBox="0 0 71 55" fill="currentColor"><path d="M60.1 4.9A58.5 58.5 0 0045.4.2a.2.2 0 00-.2.1 40.8 40.8 0 00-1.8 3.7 54 54 0 00-16.2 0A37.3 37.3 0 0025.4.3a.2.2 0 00-.2-.1A58.4 58.4 0 0010.5 5 59.6 59.6 0 00.4 45a.3.3 0 00.1.2 58.7 58.7 0 0017.7 9 .2.2 0 00.3-.1 42 42 0 003.6-5.9.2.2 0 00-.1-.3 38.7 38.7 0 01-5.5-2.6.2.2 0 010-.4l1.1-.9a.2.2 0 01.2 0 41.9 41.9 0 0035.6 0 .2.2 0 01.3 0l1 .9a.2.2 0 010 .3 36.4 36.4 0 01-5.5 2.7.2.2 0 00-.1.3 47.2 47.2 0 003.6 5.8.2.2 0 00.3.1A58.5 58.5 0 0070 45.2a.3.3 0 00.1-.2c1.6-16.4-2.6-30.6-11-43.2zM23.7 37c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7zm25.2 0c-3.7 0-6.8-3.4-6.8-7.7s3-7.6 6.8-7.6 6.9 3.4 6.8 7.6c0 4.3-3 7.7-6.8 7.7z" /></svg>
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
            {copy.footer.builtWith} <Heart size={12} color="#FF2A2A" /> {copy.footer.forDiscord}
          </div>
        </div>
      </div>
    </footer>
  );
}

export default StatsFooter;
