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
  if (itemKey === 'network') return formatNumber(stats?.bots || 0);
  if (itemKey === 'dashboard') return copy.trustBar.values.dashboard;
  if (itemKey === 'reliability') return copy.trustBar.values.reliability;
  return '-';
}

export default function TrustBar({ stats }) {
  const { copy, formatNumber } = useI18n();

  return (
    <section
      data-testid="trust-bar"
      style={{
        position: 'relative',
        zIndex: 2,
        padding: '0 0 48px',
      }}
    >
      <div className="section-container">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
          }}
        >
          {ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.key}
                data-testid={`trust-bar-card-${item.key}`}
                style={{
                  padding: '18px 20px',
                  borderRadius: 16,
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${item.color}22`,
                  boxShadow: `0 0 24px ${item.color}08`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 10,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: `${item.color}12`,
                      border: `1px solid ${item.color}28`,
                    }}
                  >
                    <Icon size={16} color={item.color} />
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: '#A1A1AA',
                      textTransform: 'uppercase',
                      letterSpacing: '0.12em',
                      fontWeight: 700,
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
                <p style={{ fontSize: 13, color: '#71717A', lineHeight: 1.6 }}>
                  {copy.trustBar.items[item.key].detail}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
