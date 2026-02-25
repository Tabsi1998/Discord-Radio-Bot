import React, { useState } from 'react';
import { Terminal, Shield, Zap, Crown, ChevronDown, ChevronUp } from 'lucide-react';

const COMMAND_TIERS = {
  free: {
    label: 'Free',
    color: '#39FF14',
    icon: Shield,
    commands: ['play', 'stop', 'pause', 'resume', 'now', 'stations', 'list', 'setvolume', 'history', 'status', 'health', 'diag', 'help', 'premium', 'language', 'license'],
  },
  pro: {
    label: 'Pro',
    color: '#FFB800',
    icon: Zap,
    commands: ['event', 'perm', 'invite', 'workers'],
  },
  ultimate: {
    label: 'Ultimate',
    color: '#BD00FF',
    icon: Crown,
    commands: ['addstation', 'removestation', 'mystations'],
  },
};

function classifyCommand(cmdName) {
  const name = cmdName.replace(/^\//, '').toLowerCase();
  for (const [tier, cfg] of Object.entries(COMMAND_TIERS)) {
    if (cfg.commands.includes(name)) return tier;
  }
  return 'free';
}

function TierColumn({ tier, config, commands, expanded, onToggle }) {
  const Icon = config.icon;
  const tierCommands = commands.filter((cmd) => classifyCommand(cmd.name) === tier);
  const isCollapsed = !expanded;

  return (
    <div
      data-testid={`commands-tier-${tier}`}
      style={{
        flex: 1,
        minWidth: 280,
        borderRadius: 16,
        border: `1px solid ${config.color}20`,
        background: `${config.color}04`,
        overflow: 'hidden',
      }}
    >
      {/* Tier Header */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px',
          background: `${config.color}08`,
          borderBottom: `1px solid ${config.color}15`,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: `${config.color}12`,
            border: `1px solid ${config.color}30`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon size={18} color={config.color} />
          </div>
          <div>
            <div style={{
              fontFamily: "'Orbitron', sans-serif", fontSize: 13, fontWeight: 700,
              color: config.color, letterSpacing: '0.08em',
            }}>
              {config.label}
            </div>
            <div style={{ fontSize: 11, color: '#52525B', fontWeight: 600 }}>
              {tierCommands.length} Commands
            </div>
          </div>
        </div>
        {isCollapsed ? <ChevronDown size={16} color="#52525B" /> : <ChevronUp size={16} color="#52525B" />}
      </div>

      {/* Commands */}
      {!isCollapsed && (
        <div style={{ padding: '8px 0' }}>
          {tierCommands.map((cmd, i) => (
            <div
              key={`${cmd.name}-${i}`}
              data-testid={`command-${tier}-${i}`}
              style={{
                padding: '10px 20px',
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = `${config.color}06`; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  fontFamily: "'JetBrains Mono', monospace",
                  fontSize: 13, fontWeight: 600, color: config.color,
                }}>
                  {cmd.name}
                </span>
                {cmd.args && (
                  <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: '#52525B' }}>
                    {cmd.args}
                  </span>
                )}
              </div>
              <p style={{ fontSize: 13, color: '#A1A1AA', lineHeight: 1.5, margin: 0 }}>
                {cmd.description}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Commands({ commands, loading }) {
  const items = Array.isArray(commands) ? commands : [];
  const [expanded, setExpanded] = useState({ free: false, pro: false, ultimate: false });

  const toggleTier = (tier) => {
    setExpanded((prev) => ({ ...prev, [tier]: !prev[tier] }));
  };

  return (
    <section
      id="commands"
      data-testid="commands-section"
      style={{ padding: '80px 0', position: 'relative', zIndex: 1 }}
    >
      <div className="section-container">
        <div style={{ marginBottom: 48 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Terminal size={16} color="#BD00FF" />
            <span style={{
              fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600,
              letterSpacing: '0.15em', textTransform: 'uppercase', color: '#BD00FF',
            }}>
              Slash Commands
            </span>
          </div>
          <h2
            data-testid="commands-title"
            style={{
              fontFamily: "'Orbitron', sans-serif", fontWeight: 800,
              fontSize: 'clamp(24px, 4vw, 40px)', marginBottom: 12,
            }}
          >
            Alle Befehle nach Tier
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 600 }}>
            Jeder Tier schaltet zusaetzliche Commands frei.
            Free-Commands sind immer verfuegbar.
          </p>
        </div>

        {loading && (
          <div style={{ padding: 40, color: '#52525B', fontSize: 14, textAlign: 'center' }}>
            Lade Commands...
          </div>
        )}

        {!loading && items.length === 0 && (
          <div style={{ padding: 40, color: '#52525B', fontSize: 14, textAlign: 'center' }}>
            Keine Commands verfuegbar.
          </div>
        )}

        {!loading && items.length > 0 && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {Object.entries(COMMAND_TIERS).map(([tier, config]) => (
              <TierColumn
                key={tier}
                tier={tier}
                config={config}
                commands={items}
                expanded={expanded[tier]}
                onToggle={() => toggleTier(tier)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default Commands;
