import React from 'react';
import { Check, Crown } from 'lucide-react';

const PLAN_ROWS = [
  {
    key: 'dashboard',
    label: 'Web Dashboard (SSO + Guild Picker)',
    free: false,
    pro: true,
    ultimate: true,
  },
  {
    key: 'events',
    label: 'Event-Scheduler im Web',
    free: false,
    pro: true,
    ultimate: true,
  },
  {
    key: 'perms',
    label: 'Rollenrechte pro Command',
    free: false,
    pro: true,
    ultimate: true,
  },
  {
    key: 'basicStats',
    label: 'Server-spezifische Basis-Stats',
    free: false,
    pro: true,
    ultimate: true,
  },
  {
    key: 'fallback',
    label: '/play mit optionalem Fallback',
    free: false,
    pro: false,
    ultimate: true,
  },
  {
    key: 'advancedStats',
    label: 'Erweiterte Analytics (Channel + Tagesreport)',
    free: false,
    pro: false,
    ultimate: true,
  },
];

function FeatureDot({ enabled, testId }) {
  return (
    <span
      data-testid={testId}
      style={{
        width: 24,
        height: 24,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid',
        borderColor: enabled ? 'rgba(16,185,129,0.4)' : '#27272A',
        background: enabled ? 'rgba(16,185,129,0.18)' : 'transparent',
        color: enabled ? '#6EE7B7' : '#52525B',
      }}
    >
      {enabled ? <Check size={13} /> : '–'}
    </span>
  );
}

export default function PlanMatrix() {
  return (
    <section
      id="plan-matrix"
      data-testid="plan-matrix-section"
      style={{
        position: 'relative',
        zIndex: 2,
        padding: '90px 24px',
      }}
    >
      <div className="section-container" style={{ maxWidth: 1200 }}>
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, letterSpacing: '0.12em', color: '#A1A1AA', textTransform: 'uppercase' }}>Free vs Pro vs Ultimate</div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 'clamp(2rem, 5vw, 4rem)', marginTop: 8, lineHeight: 1.05 }}>
            Klarer Vergleich, keine offenen Fragen
          </h2>
          <p style={{ marginTop: 10, color: '#A1A1AA', maxWidth: 760, lineHeight: 1.7 }}>
            Die Matrix zeigt transparent, was in welchem Plan enthalten ist. Ultimate hebt Reliability-Features, mehr Bot-Slots und erweiterte Analytics sichtbar hervor.
          </p>
        </div>

        <div
          data-testid="plan-matrix-grid"
          style={{
            border: '1px solid #27272A',
            background: '#0A0A0A',
            overflowX: 'auto',
          }}
        >
          <div style={{ minWidth: 860 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(280px, 1fr) 160px 160px 220px',
                borderBottom: '1px solid #27272A',
              }}
            >
              <div style={{ padding: 16, color: '#A1A1AA', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Feature</div>
              <div style={{ padding: 16, fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>Free</div>
              <div style={{ padding: 16, fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>Pro</div>
              <div style={{ padding: 16, fontFamily: "'Outfit', sans-serif", fontSize: 20, color: '#8B5CF6', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Crown size={18} /> Ultimate
              </div>
            </div>

            {PLAN_ROWS.map((row) => (
              <div
                key={row.key}
                data-testid={`plan-matrix-row-${row.key}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(280px, 1fr) 160px 160px 220px',
                  borderBottom: '1px solid #27272A',
                }}
              >
                <div style={{ padding: 16, color: '#fff', lineHeight: 1.5 }}>{row.label}</div>
                <div style={{ padding: 16 }}><FeatureDot enabled={row.free} testId={`plan-free-${row.key}`} /></div>
                <div style={{ padding: 16 }}><FeatureDot enabled={row.pro} testId={`plan-pro-${row.key}`} /></div>
                <div style={{ padding: 16 }}><FeatureDot enabled={row.ultimate} testId={`plan-ultimate-${row.key}`} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
