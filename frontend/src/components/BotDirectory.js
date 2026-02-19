import React from 'react';
import { ExternalLink, Copy, Check } from 'lucide-react';

const BOT_COLORS = {
  cyan: { accent: '#00F0FF', bg: 'rgba(0, 240, 255, 0.08)', glow: 'rgba(0, 240, 255, 0.15)', border: 'rgba(0, 240, 255, 0.25)' },
  green: { accent: '#39FF14', bg: 'rgba(57, 255, 20, 0.08)', glow: 'rgba(57, 255, 20, 0.15)', border: 'rgba(57, 255, 20, 0.25)' },
  pink: { accent: '#EC4899', bg: 'rgba(236, 72, 153, 0.08)', glow: 'rgba(236, 72, 153, 0.15)', border: 'rgba(236, 72, 153, 0.25)' },
  amber: { accent: '#FFB800', bg: 'rgba(255, 184, 0, 0.08)', glow: 'rgba(255, 184, 0, 0.15)', border: 'rgba(255, 184, 0, 0.25)' },
  purple: { accent: '#BD00FF', bg: 'rgba(189, 0, 255, 0.08)', glow: 'rgba(189, 0, 255, 0.15)', border: 'rgba(189, 0, 255, 0.25)' },
  red: { accent: '#FF2A2A', bg: 'rgba(255, 42, 42, 0.08)', glow: 'rgba(255, 42, 42, 0.15)', border: 'rgba(255, 42, 42, 0.25)' },
};

const fmt = new Intl.NumberFormat('de-DE');

function BotCard({ bot, index }) {
  const [copied, setCopied] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);

  const colorKey = bot.color || Object.keys(BOT_COLORS)[index % Object.keys(BOT_COLORS).length];
  const colors = BOT_COLORS[colorKey] || BOT_COLORS.cyan;
  const inviteUrl = bot.inviteUrl || bot.invite_url || `https://discord.com/oauth2/authorize?client_id=${bot.clientId || bot.client_id || ''}&scope=bot%20applications.commands&permissions=3145728`;
  const botImage = bot.avatarUrl || bot.avatar_url || `/img/bot-${(index % 4) + 1}.png`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div
      data-testid={`bot-card-${index}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative', display: 'flex', flexDirection: 'column', padding: 28, borderRadius: 20,
        background: hovered
          ? `linear-gradient(180deg, ${colors.bg} 0%, rgba(0,0,0,0.5) 100%)`
          : 'rgba(255, 255, 255, 0.02)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${hovered ? colors.border : 'rgba(255,255,255,0.06)'}`,
        transition: 'border-color 0.4s, background 0.4s, box-shadow 0.4s',
        boxShadow: hovered ? `0 0 40px ${colors.glow}` : 'none',
        overflow: 'hidden',
      }}
    >
      {/* Farbiger Akzent-Balken */}
      <div style={{ position: 'absolute', top: 0, left: 28, right: 28, height: 2, background: colors.accent, opacity: hovered ? 1 : 0.3, transition: 'opacity 0.3s' }} />

      {/* Bot-Avatar + Name */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
        <div style={{
          width: 56, height: 56, borderRadius: 14, overflow: 'hidden', flexShrink: 0,
          background: `linear-gradient(135deg, ${colors.accent}22, ${colors.accent}08)`,
          border: `1px solid ${colors.accent}33`,
        }}>
          <img src={botImage} alt={bot.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { e.target.style.display = 'none'; }} />
        </div>
        <div>
          <h3 style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 16, fontWeight: 700, letterSpacing: '0.02em', margin: 0 }}>
            {bot.name}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: bot.ready ? '#39FF14' : '#52525B',
              boxShadow: bot.ready ? '0 0 8px rgba(57,255,20,0.5)' : 'none',
            }} />
            <span style={{ fontSize: 12, color: bot.ready ? '#39FF14' : '#52525B', fontWeight: 600 }}>
              {bot.ready ? 'Online' : 'Konfigurierbar'}
            </span>
          </div>
        </div>
      </div>

      {/* Bot Statistics - wie Jockie Music */}
      <div style={{
        padding: '14px 0', marginBottom: 16,
        borderTop: `1px solid ${colors.accent}15`,
        borderBottom: `1px solid ${colors.accent}15`,
      }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: colors.accent, marginBottom: 10, fontFamily: "'Orbitron', sans-serif" }}>
          BOT STATISTIKEN
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
          {[
            { label: 'Server', value: bot.servers || 0 },
            { label: 'Nutzer', value: bot.users || 0 },
            { label: 'Verbindungen', value: bot.connections || 0 },
            { label: 'Zuhörer', value: bot.listeners || 0 },
          ].map((s) => (
            <div key={s.label}>
              <div style={{ fontSize: 11, color: '#52525B', fontWeight: 600, letterSpacing: '0.05em' }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: '#fff' }}>
                {fmt.format(s.value)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 10, marginTop: 'auto' }}>
        <a
          href={inviteUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`invite-btn-${index}`}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            padding: '12px 20px', borderRadius: 12, background: colors.accent, color: '#050505',
            fontWeight: 700, fontSize: 13, textDecoration: 'none', textTransform: 'uppercase',
            letterSpacing: '0.05em', cursor: 'pointer', transition: 'transform 0.15s, opacity 0.15s',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9'; e.currentTarget.style.transform = 'scale(1.02)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.transform = 'scale(1)'; }}
        >
          <ExternalLink size={14} />
          Einladen
        </a>
        <button
          onClick={handleCopy}
          data-testid={`copy-btn-${index}`}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 44, height: 44, borderRadius: 12,
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: copied ? '#39FF14' : '#A1A1AA', cursor: 'pointer', transition: 'color 0.2s',
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
    </div>
  );
}

function BotDirectory({ bots, loading }) {
  return (
    <section id="bots" data-testid="bot-directory" style={{ padding: '80px 0', position: 'relative', zIndex: 1 }}>
      <div className="section-container">
        <div style={{ marginBottom: 48 }}>
          <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00F0FF' }}>
            Wähle deine Frequenz
          </span>
          <h2 data-testid="bot-directory-title" style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 'clamp(24px, 4vw, 40px)', marginTop: 8, marginBottom: 12 }}>
            Unsere Radio Bots
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 500 }}>
            Jeder Bot ist ein eigener Worker. Lade so viele ein wie du möchtest für maximale Abdeckung.
          </p>
        </div>

        {loading ? (
          <div style={{ color: '#52525B', padding: 40 }}>Lade Bots...</div>
        ) : bots.length === 0 ? (
          <div style={{ color: '#52525B', padding: 40 }}>Noch keine Bots konfiguriert.</div>
        ) : (
          <div data-testid="bot-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 20 }}>
            {bots.map((bot, i) => (
              <BotCard key={bot.bot_id || i} bot={bot} index={i} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default BotDirectory;
