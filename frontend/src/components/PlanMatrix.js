import React from 'react';
import { Check, Crown } from 'lucide-react';
import { useI18n } from '../i18n.js';

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
      {enabled ? <Check size={13} /> : '-'}
    </span>
  );
}

export default function PlanMatrix() {
  const { copy } = useI18n();
  const matrix = copy.planMatrix;

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
          <div style={{ fontSize: 12, letterSpacing: '0.12em', color: '#A1A1AA', textTransform: 'uppercase' }}>{matrix.eyebrow}</div>
          <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 'clamp(2rem, 5vw, 4rem)', marginTop: 8, lineHeight: 1.05 }}>
            {matrix.title}
          </h2>
          <p style={{ marginTop: 10, color: '#A1A1AA', maxWidth: 760, lineHeight: 1.7 }}>
            {matrix.subtitle}
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
              <div style={{ padding: 16, color: '#A1A1AA', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{matrix.featureHeader}</div>
              <div style={{ padding: 16, fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{matrix.tiers.free}</div>
              <div style={{ padding: 16, fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{matrix.tiers.pro}</div>
              <div style={{ padding: 16, fontFamily: "'Outfit', sans-serif", fontSize: 20, color: '#8B5CF6', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Crown size={18} /> {matrix.tiers.ultimate}
              </div>
            </div>

            {matrix.rows.map((row) => (
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
