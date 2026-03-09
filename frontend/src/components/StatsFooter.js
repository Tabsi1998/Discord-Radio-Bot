import React from 'react';
import { Heart, Radio } from 'lucide-react';
import { useI18n } from '../i18n';

function buildLegalHref(locale, page) {
  const params = new URLSearchParams();
  params.set('page', page);
  if (locale) params.set('lang', locale);
  return `/?${params.toString()}`;
}

function StatsFooter({ stats, bots = [] }) {
  const { copy, locale, formatNumber } = useI18n();
  const readyBots = React.useMemo(
    () => (Array.isArray(bots) ? bots.reduce((count, bot) => count + (bot?.ready ? 1 : 0), 0) : 0),
    [bots],
  );
  const totalBots = Math.max(Number(stats.bots) || 0, Array.isArray(bots) ? bots.length : 0);

  const footerStats = [
    { label: copy.footer.stats.servers, value: stats.servers || 0, color: '#00F0FF' },
    { label: copy.footer.stats.connections, value: stats.connections || 0, color: '#39FF14' },
    { label: copy.footer.stats.listeners, value: stats.listeners || 0, color: '#FFB800' },
    { label: copy.footer.stats.stations, value: stats.stations || 0, color: '#BD00FF' },
  ];

  return (
    <footer
      data-testid="stats-footer"
      style={{
        padding: '56px 0 28px',
        position: 'relative',
        zIndex: 0,
        borderTop: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <div className="section-container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)',
            gap: 24,
            paddingBottom: 22,
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
          className="footer-top-grid"
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <Radio size={16} color="#00F0FF" />
              <span
                style={{
                  fontFamily: "'Orbitron', sans-serif",
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: '0.05em',
                }}
              >
                OMNI<span style={{ color: '#00F0FF' }}>FM</span>
              </span>
            </div>
            <p style={{ margin: '0 0 10px', color: '#A1A1AA', fontSize: 14, lineHeight: 1.75, maxWidth: 620 }}>
              {copy.footer.liveNote}
            </p>
            <div style={{ color: '#71717A', fontSize: 13, lineHeight: 1.7 }}>
              {copy.footer.proofCards.operations.value({ readyBots, totalBots })} · {copy.footer.proofCards.support.value} · {copy.footer.proofCards.languages.value}
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              gap: 0,
              borderLeft: '1px solid rgba(255,255,255,0.08)',
            }}
            className="footer-stats-grid"
          >
            {footerStats.map((item, index) => {
              const rightBorder = index % 2 === 0 ? '1px solid rgba(255,255,255,0.08)' : 'none';
              const topBorder = index >= 2 ? '1px solid rgba(255,255,255,0.08)' : 'none';
              return (
                <div
                  key={item.label}
                  style={{
                    padding: '14px 18px',
                    borderRight: rightBorder,
                    borderTop: topBorder,
                  }}
                >
                  <div
                    data-testid={`stat-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 22,
                      fontWeight: 700,
                      color: item.color,
                    }}
                  >
                    {formatNumber(item.value)}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 11, color: '#71717A', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                    {item.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16,
            paddingTop: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <a href={buildLegalHref(locale, 'imprint')} data-testid="footer-impressum" style={{ color: '#71717A', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {copy.footer.links.imprint}
            </a>
            <a href={buildLegalHref(locale, 'privacy')} data-testid="footer-privacy" style={{ color: '#71717A', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {copy.footer.links.privacy}
            </a>
            <a href="https://discord.gg/UeRkfGS43R" target="_blank" rel="noopener noreferrer" data-testid="footer-discord" style={{ color: '#5865F2', fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {copy.footer.discord}
            </a>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#52525B' }}>
            {copy.footer.builtWith} <Heart size={12} color="#FF2A2A" /> {copy.footer.forDiscord}
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 920px) {
          .footer-top-grid,
          .footer-stats-grid {
            grid-template-columns: 1fr !important;
          }

          .footer-stats-grid {
            border-left: none !important;
          }

          .footer-stats-grid > div {
            border-right: none !important;
          }
        }
      `}</style>
    </footer>
  );
}

export default StatsFooter;
