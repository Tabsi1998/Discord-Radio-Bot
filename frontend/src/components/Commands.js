import React from 'react';
import { Terminal } from 'lucide-react';

function Commands({ commands }) {
  if (!commands || commands.length === 0) return null;

  return (
    <section
      id="commands"
      data-testid="commands-section"
      style={{
        padding: '80px 0',
        position: 'relative',
        zIndex: 1,
        background: 'linear-gradient(180deg, transparent 0%, rgba(189,0,255,0.01) 50%, transparent 100%)',
      }}
    >
      <div className="section-container">
        <div style={{ textAlign: 'center', marginBottom: 48 }}>
          <span
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#BD00FF',
            }}
          >
            Slash Commands
          </span>
          <h2
            data-testid="commands-title"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 800,
              fontSize: 'clamp(24px, 4vw, 40px)',
              marginTop: 8,
            }}
          >
            Steuerung
          </h2>
        </div>

        <div
          style={{
            maxWidth: 700,
            margin: '0 auto',
            borderRadius: 20,
            background: 'rgba(255,255,255,0.02)',
            border: '1px solid rgba(255,255,255,0.06)',
            overflow: 'hidden',
          }}
        >
          {/* Terminal header */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '14px 20px',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              background: 'rgba(255,255,255,0.02)',
            }}
          >
            <Terminal size={14} color="#52525B" />
            <span
              style={{
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 12,
                color: '#52525B',
              }}
            >
              discord-commands
            </span>
          </div>

          {/* Commands list */}
          <div style={{ padding: '8px 0' }}>
            {commands.map((cmd, i) => (
              <div
                key={cmd.name}
                data-testid={`command-item-${i}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 16,
                  padding: '14px 20px',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ flexShrink: 0 }}>
                  <span className="command-badge">
                    {cmd.name}
                    {cmd.args && (
                      <span style={{ color: '#52525B', marginLeft: 6 }}>{cmd.args}</span>
                    )}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: 14,
                    color: '#A1A1AA',
                    lineHeight: 1.5,
                    margin: 0,
                    paddingTop: 3,
                  }}
                >
                  {cmd.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export default Commands;
