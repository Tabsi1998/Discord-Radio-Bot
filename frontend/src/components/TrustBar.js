import React from 'react';
import { Layers3, LayoutDashboard, Radio, ShieldCheck } from 'lucide-react';
import { useI18n } from '../i18n';

const ITEMS = [
  { key: 'stations', icon: Radio, color: '#00F0FF' },
  { key: 'network', icon: Layers3, color: '#39FF14' },
  { key: 'dashboard', icon: LayoutDashboard, color: '#FFB800' },
  { key: 'reliability', icon: ShieldCheck, color: '#BD00FF' },
];

function resolveValue(itemKey, stats, copy, formatNumber) {
  if (itemKey === 'stations') return formatNumber(stats?.stations || 0);
  if (itemKey === 'network') return formatNumber(stats?.connections || 0);
  if (itemKey === 'dashboard') return copy.trustBar.values.dashboard;
  if (itemKey === 'reliability') return copy.trustBar.values.reliability;
  return '-';
}

function resolveSupport(itemKey, stats, copy, formatNumber) {
  if (itemKey === 'stations') {
    return copy.trustBar.support.stations({
      free: formatNumber(stats?.freeStations || 0),
      pro: formatNumber(stats?.proStations || 0),
    });
  }
  if (itemKey === 'network') {
    return copy.trustBar.support.network({
      bots: formatNumber(stats?.bots || 0),
      servers: formatNumber(stats?.servers || 0),
    });
  }
  if (itemKey === 'dashboard') return copy.trustBar.support.dashboard;
  if (itemKey === 'reliability') return copy.trustBar.support.reliability;
  return '';
}

export default function TrustBar({ stats }) {
  const { copy, formatNumber } = useI18n();

  return (
    <section
      data-testid="trust-bar"
      style={{
        position: 'relative',
        zIndex: 2,
        padding: '0 0 56px',
      }}
    >
      <div className="section-container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 0.95fr) minmax(0, 1.05fr)',
            gap: 24,
            padding: '24px 0',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
          className="trust-bar-layout"
        >
          <div style={{ paddingRight: 12 }}>
            <div
              style={{
                fontSize: 11,
                color: '#71717A',
                textTransform: 'uppercase',
                letterSpacing: '0.18em',
                fontWeight: 800,
                fontFamily: "'Orbitron', sans-serif",
                marginBottom: 10,
              }}
            >
              {copy.trustBar.introEyebrow}
            </div>
            <p style={{ margin: 0, color: '#D4D4D8', fontSize: 18, lineHeight: 1.7, maxWidth: 560 }}>
              {copy.trustBar.introBody}
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              borderLeft: '1px solid rgba(255,255,255,0.08)',
            }}
            className="trust-bar-metrics"
          >
            {ITEMS.map((item, index) => {
              const Icon = item.icon;
              const rightBorder = index % 2 === 0 ? '1px solid rgba(255,255,255,0.08)' : 'none';
              const topBorder = index >= 2 ? '1px solid rgba(255,255,255,0.08)' : 'none';
              return (
                <div
                  key={item.key}
                  data-testid={`trust-bar-card-${item.key}`}
                  style={{
                    padding: '18px 18px 16px',
                    borderRight: rightBorder,
                    borderTop: topBorder,
                    minHeight: 126,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                    <Icon size={16} color={item.color} />
                    <span
                      style={{
                        fontSize: 10,
                        color: item.color,
                        textTransform: 'uppercase',
                        letterSpacing: '0.14em',
                        fontWeight: 800,
                      }}
                    >
                      {copy.trustBar.items[item.key].label}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 24,
                      fontWeight: 800,
                      color: '#fff',
                      marginBottom: 6,
                    }}
                  >
                    {resolveValue(item.key, stats, copy, formatNumber)}
                  </div>
                  <div style={{ fontSize: 11, color: '#71717A', fontWeight: 700, marginBottom: 8 }}>
                    {resolveSupport(item.key, stats, copy, formatNumber)}
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: '#A1A1AA', lineHeight: 1.6 }}>
                    {copy.trustBar.items[item.key].detail}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div
          data-testid="trust-bar-proof-checks"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 0,
            marginTop: 10,
            borderTop: '1px solid rgba(255,255,255,0.06)',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}
          className="trust-bar-checks"
        >
          {copy.trustBar.proofChecks.map((item, index) => (
            <div
              key={item}
              style={{
                padding: '12px 0',
                paddingRight: 16,
                borderRight: index < copy.trustBar.proofChecks.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                color: '#71717A',
                fontSize: 12,
                lineHeight: 1.7,
              }}
            >
              {item}
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 920px) {
          .trust-bar-layout,
          .trust-bar-metrics,
          .trust-bar-checks {
            grid-template-columns: 1fr !important;
          }

          .trust-bar-metrics {
            border-left: none !important;
          }

          .trust-bar-checks > div,
          .trust-bar-metrics > div {
            border-right: none !important;
          }
        }
      `}</style>
    </section>
  );
}
