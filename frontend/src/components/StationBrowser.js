import React, { useState, useMemo } from 'react';
import { Search, Radio, Music, Globe } from 'lucide-react';

function StationCard({ station, index }) {
  const [hovered, setHovered] = useState(false);
  const colors = ['#00F0FF', '#39FF14', '#EC4899', '#FFB800', '#BD00FF', '#FF2A2A'];
  const color = colors[index % colors.length];

  return (
    <div
      data-testid={`station-card-${station.key}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 18px',
        borderRadius: 14,
        background: hovered ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${hovered ? 'rgba(255,255,255,0.1)' : 'transparent'}`,
        cursor: 'pointer',
        transition: 'background 0.2s, border-color 0.2s',
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 10,
          background: `${color}12`,
          border: `1px solid ${color}22`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          position: 'relative',
        }}
      >
        <Radio size={18} color={color} />
        {station.is_default && (
          <div
            style={{
              position: 'absolute',
              top: -3,
              right: -3,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: '#39FF14',
              boxShadow: '0 0 6px rgba(57,255,20,0.6)',
            }}
          />
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {station.name}
        </div>
        <div
          style={{
            fontSize: 12,
            color: '#52525B',
            fontFamily: "'JetBrains Mono', monospace",
            marginTop: 2,
          }}
        >
          {station.key}
        </div>
      </div>

      {/* Genre tag */}
      {station.genre && (
        <span className="genre-tag">{station.genre}</span>
      )}

      {/* External icon */}
      <Globe
        size={14}
        color="#52525B"
        style={{
          opacity: hovered ? 1 : 0,
          transition: 'opacity 0.2s',
          flexShrink: 0,
        }}
      />
    </div>
  );
}

function StationBrowser({ stations, loading }) {
  const [search, setSearch] = useState('');
  const [activeGenre, setActiveGenre] = useState(null);

  const genres = useMemo(() => {
    const set = new Set();
    stations.forEach((s) => {
      if (s.genre) set.add(s.genre);
    });
    return Array.from(set);
  }, [stations]);

  const filtered = useMemo(() => {
    return stations.filter((s) => {
      const q = search.toLowerCase();
      const matchSearch =
        !q ||
        s.name.toLowerCase().includes(q) ||
        s.key.toLowerCase().includes(q) ||
        (s.genre || '').toLowerCase().includes(q);
      const matchGenre = !activeGenre || s.genre === activeGenre;
      return matchSearch && matchGenre;
    });
  }, [stations, search, activeGenre]);

  return (
    <section
      id="stations"
      data-testid="station-browser"
      style={{
        padding: '80px 0',
        position: 'relative',
        zIndex: 1,
      }}
    >
      <div className="section-container">
        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <span
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              color: '#00F0FF',
            }}
          >
            Live Station Directory
          </span>
          <h2
            data-testid="stations-title"
            style={{
              fontFamily: "'Orbitron', sans-serif",
              fontWeight: 800,
              fontSize: 'clamp(24px, 4vw, 40px)',
              marginTop: 8,
              marginBottom: 12,
            }}
          >
            Radio Stationen
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 500 }}>
            {stations.length} verfügbare Stationen. Nutze <code style={{ color: '#00F0FF', fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>/play station</code> im Discord.
          </p>
        </div>

        {/* Search + Filters */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', maxWidth: 400, marginBottom: 16 }}>
            <Search
              size={18}
              color="#52525B"
              style={{
                position: 'absolute',
                left: 14,
                top: '50%',
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              data-testid="station-search"
              className="station-search"
              placeholder="Station suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Genre filters */}
          {genres.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                data-testid="genre-filter-all"
                onClick={() => setActiveGenre(null)}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  padding: '6px 14px',
                  borderRadius: 8,
                  border: 'none',
                  cursor: 'pointer',
                  background: !activeGenre ? 'rgba(0,240,255,0.15)' : 'rgba(255,255,255,0.05)',
                  color: !activeGenre ? '#00F0FF' : '#A1A1AA',
                  transition: 'background 0.2s, color 0.2s',
                }}
              >
                Alle
              </button>
              {genres.map((g) => (
                <button
                  key={g}
                  data-testid={`genre-filter-${g.replace(/\s+/g, '-').toLowerCase()}`}
                  onClick={() => setActiveGenre(activeGenre === g ? null : g)}
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '6px 14px',
                    borderRadius: 8,
                    border: 'none',
                    cursor: 'pointer',
                    background: activeGenre === g ? 'rgba(0,240,255,0.15)' : 'rgba(255,255,255,0.05)',
                    color: activeGenre === g ? '#00F0FF' : '#A1A1AA',
                    transition: 'background 0.2s, color 0.2s',
                  }}
                >
                  {g}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Station list */}
        {loading ? (
          <div style={{ color: '#52525B', padding: 40 }}>Lade Stationen...</div>
        ) : filtered.length === 0 ? (
          <div
            data-testid="no-stations"
            style={{
              color: '#52525B',
              padding: 40,
              textAlign: 'center',
              borderRadius: 16,
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
            }}
          >
            <Music size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p>Keine Stationen gefunden.</p>
          </div>
        ) : (
          <div
            data-testid="station-list"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
              gap: 8,
              maxHeight: 520,
              overflowY: 'auto',
              padding: '4px 0',
            }}
          >
            {filtered.map((s, i) => (
              <StationCard key={s.key} station={s} index={i} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default StationBrowser;
