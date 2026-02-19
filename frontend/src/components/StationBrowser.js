import React, { useState, useMemo, useRef } from 'react';
import { Search, Radio, Music, Play, Pause, Volume2 } from 'lucide-react';

const STATION_COLORS = ['#00F0FF', '#39FF14', '#EC4899', '#FFB800', '#BD00FF', '#FF2A2A'];

function StationCard({ station, index, isPlaying, onPlay, onStop }) {
  const [hovered, setHovered] = useState(false);
  const color = STATION_COLORS[index % STATION_COLORS.length];

  return (
    <div
      data-testid={`station-card-${station.key}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 18px', borderRadius: 14,
        background: isPlaying ? `${color}10` : (hovered ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)'),
        border: `1px solid ${isPlaying ? `${color}30` : (hovered ? 'rgba(255,255,255,0.1)' : 'transparent')}`,
        cursor: 'pointer', transition: 'background 0.2s, border-color 0.2s',
      }}
      onClick={() => isPlaying ? onStop() : onPlay(station)}
    >
      {/* Play/Pause Button */}
      <div style={{
        width: 42, height: 42, borderRadius: 10,
        background: isPlaying ? color : `${color}12`,
        border: `1px solid ${isPlaying ? color : `${color}22`}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        transition: 'background 0.2s',
      }}>
        {isPlaying ? (
          <Pause size={18} color="#050505" fill="#050505" />
        ) : (
          hovered ? <Play size={18} color={color} fill={color} /> : <Radio size={18} color={color} />
        )}
      </div>

      {/* Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {station.name}
        </div>
        <div style={{ fontSize: 12, color: '#52525B', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
          {station.key}
        </div>
      </div>

      {/* Genre tag */}
      {station.genre && (
        <span className="genre-tag">{station.genre}</span>
      )}

      {/* Playing indicator */}
      {isPlaying && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16 }}>
          {[0.6, 1, 0.7, 0.9].map((h, i) => (
            <div key={i} className="eq-bar" style={{
              width: 3, borderRadius: 1, height: `${h * 100}%`,
              background: color,
              animationDuration: `${0.4 + Math.random() * 0.6}s`,
              animationDelay: `${i * 0.1}s`,
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

function StationBrowser({ stations, loading }) {
  const [search, setSearch] = useState('');
  const [activeGenre, setActiveGenre] = useState(null);
  const [playingKey, setPlayingKey] = useState(null);
  const audioRef = useRef(null);

  const genres = useMemo(() => {
    const set = new Set();
    stations.forEach((s) => { if (s.genre) set.add(s.genre); });
    return Array.from(set);
  }, [stations]);

  const filtered = useMemo(() => {
    return stations.filter((s) => {
      const q = search.toLowerCase();
      const matchSearch = !q || s.name.toLowerCase().includes(q) || s.key.toLowerCase().includes(q) || (s.genre || '').toLowerCase().includes(q);
      const matchGenre = !activeGenre || s.genre === activeGenre;
      return matchSearch && matchGenre;
    });
  }, [stations, search, activeGenre]);

  const handlePlay = (station) => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.addEventListener('error', () => {
        setPlayingKey(null);
      });
    }
    audioRef.current.src = station.url;
    audioRef.current.play().then(() => {
      setPlayingKey(station.key);
    }).catch(() => {
      setPlayingKey(null);
    });
  };

  const handleStop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = '';
    }
    setPlayingKey(null);
  };

  const playingStation = stations.find(s => s.key === playingKey);

  return (
    <section id="stations" data-testid="station-browser" style={{ padding: '80px 0', position: 'relative', zIndex: 1 }}>
      <div className="section-container">
        <div style={{ marginBottom: 36 }}>
          <span style={{ fontFamily: "'Orbitron', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00F0FF' }}>
            Live Station Directory
          </span>
          <h2 data-testid="stations-title" style={{ fontFamily: "'Orbitron', sans-serif", fontWeight: 800, fontSize: 'clamp(24px, 4vw, 40px)', marginTop: 8, marginBottom: 12 }}>
            Radio Stationen
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 500 }}>
            {stations.length} verfügbare Stationen. Klicke zum Vorhören oder nutze <code style={{ color: '#00F0FF', fontFamily: "'JetBrains Mono', monospace", fontSize: 14 }}>/play</code> im Discord.
          </p>
        </div>

        {/* Now Playing Bar */}
        {playingStation && (
          <div
            data-testid="now-playing-bar"
            style={{
              display: 'flex', alignItems: 'center', gap: 14,
              padding: '12px 20px', borderRadius: 14, marginBottom: 20,
              background: 'rgba(0, 240, 255, 0.06)', border: '1px solid rgba(0, 240, 255, 0.15)',
            }}
          >
            <Volume2 size={18} color="#00F0FF" />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 18 }}>
              {[0.5, 0.8, 0.6, 1, 0.7].map((h, i) => (
                <div key={i} className="eq-bar" style={{
                  width: 3, borderRadius: 1, height: `${h * 100}%`,
                  background: '#00F0FF',
                  animationDuration: `${0.4 + Math.random() * 0.6}s`,
                  animationDelay: `${i * 0.08}s`,
                }} />
              ))}
            </div>
            <span style={{ fontSize: 14, fontWeight: 600, flex: 1 }}>
              {playingStation.name}
            </span>
            <button
              data-testid="stop-playing-btn"
              onClick={handleStop}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 8,
                background: 'rgba(255,255,255,0.1)', border: 'none',
                color: '#fff', cursor: 'pointer',
              }}
            >
              <Pause size={14} />
            </button>
          </div>
        )}

        {/* Search + Filters */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', maxWidth: 400, marginBottom: 16 }}>
            <Search size={18} color="#52525B" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input
              type="text"
              data-testid="station-search"
              className="station-search"
              placeholder="Station suchen..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {genres.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button
                data-testid="genre-filter-all"
                onClick={() => setActiveGenre(null)}
                style={{
                  fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
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
                    fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
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
          <div data-testid="no-stations" style={{ color: '#52525B', padding: 40, textAlign: 'center', borderRadius: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Music size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p>Keine Stationen gefunden.</p>
          </div>
        ) : (
          <div data-testid="station-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 8, maxHeight: 520, overflowY: 'auto', padding: '4px 0' }}>
            {filtered.map((s, i) => (
              <StationCard
                key={s.key}
                station={s}
                index={i}
                isPlaying={playingKey === s.key}
                onPlay={handlePlay}
                onStop={handleStop}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default StationBrowser;
