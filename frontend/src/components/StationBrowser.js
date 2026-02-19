import React, { useState, useMemo, useRef, useCallback } from 'react';
import { Search, Radio, Music, Play, Pause, Volume2, VolumeX } from 'lucide-react';

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
        WebkitTapHighlightColor: 'transparent',
      }}
      onClick={() => isPlaying ? onStop() : onPlay(station)}
    >
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {station.name}
        </div>
        <div style={{ fontSize: 12, color: '#52525B', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
          {station.key}
        </div>
      </div>
      {station.genre && <span className="genre-tag">{station.genre}</span>}
      {isPlaying && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16 }}>
          {[0.6, 1, 0.7, 0.9].map((h, i) => (
            <div key={i} className="eq-bar" style={{
              width: 3, borderRadius: 1, height: `${h * 100}%`, background: color,
              animationDuration: `${0.4 + Math.random() * 0.6}s`, animationDelay: `${i * 0.1}s`,
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
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
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

  const getAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
      audioRef.current.volume = volume / 100;
      audioRef.current.addEventListener('error', () => setPlayingKey(null));
    }
    return audioRef.current;
  }, [volume]);

  const handlePlay = useCallback((station) => {
    const audio = getAudio();
    audio.src = station.url;
    audio.volume = muted ? 0 : volume / 100;
    audio.play().then(() => setPlayingKey(station.key)).catch(() => setPlayingKey(null));
  }, [getAudio, volume, muted]);

  const handleStop = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    setPlayingKey(null);
  }, []);

  const handleVolume = useCallback((e) => {
    const v = Number(e.target.value);
    setVolume(v);
    setMuted(v === 0);
    if (audioRef.current) audioRef.current.volume = v / 100;
  }, []);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    if (audioRef.current) audioRef.current.volume = next ? 0 : volume / 100;
  }, [muted, volume]);

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

        {/* Now Playing Bar mit Lautstärke */}
        {playingStation && (
          <div
            data-testid="now-playing-bar"
            style={{
              display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
              padding: '14px 20px', borderRadius: 14, marginBottom: 20,
              background: 'rgba(0, 240, 255, 0.06)', border: '1px solid rgba(0, 240, 255, 0.15)',
            }}
          >
            {/* EQ Animation */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 20, flexShrink: 0 }}>
              {[0.5, 0.8, 0.6, 1, 0.7].map((h, i) => (
                <div key={i} className="eq-bar" style={{
                  width: 3, borderRadius: 1, height: `${h * 100}%`, background: '#00F0FF',
                  animationDuration: `${0.4 + Math.random() * 0.6}s`, animationDelay: `${i * 0.08}s`,
                }} />
              ))}
            </div>

            {/* Station Name */}
            <span style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {playingStation.name}
            </span>

            {/* Volume Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <button
                data-testid="mute-btn"
                onClick={toggleMute}
                style={{
                  background: 'none', border: 'none', color: muted ? '#FF2A2A' : '#A1A1AA',
                  cursor: 'pointer', padding: 4, lineHeight: 0,
                }}
              >
                {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                data-testid="volume-slider"
                min="0"
                max="100"
                value={muted ? 0 : volume}
                onChange={handleVolume}
                style={{
                  width: 100, height: 4, appearance: 'none', WebkitAppearance: 'none',
                  background: `linear-gradient(to right, #00F0FF ${muted ? 0 : volume}%, rgba(255,255,255,0.1) ${muted ? 0 : volume}%)`,
                  borderRadius: 2, outline: 'none', cursor: 'pointer',
                }}
              />
              <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#52525B', width: 28, textAlign: 'right' }}>
                {muted ? 0 : volume}
              </span>
            </div>

            {/* Stop Button */}
            <button
              data-testid="stop-playing-btn"
              onClick={handleStop}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', cursor: 'pointer',
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
            <input type="text" data-testid="station-search" className="station-search" placeholder="Station suchen..."
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {genres.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button data-testid="genre-filter-all" onClick={() => setActiveGenre(null)}
                style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: !activeGenre ? 'rgba(0,240,255,0.15)' : 'rgba(255,255,255,0.05)', color: !activeGenre ? '#00F0FF' : '#A1A1AA' }}>
                Alle
              </button>
              {genres.map((g) => (
                <button key={g} data-testid={`genre-filter-${g.replace(/\s+/g, '-').toLowerCase()}`}
                  onClick={() => setActiveGenre(activeGenre === g ? null : g)}
                  style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                    background: activeGenre === g ? 'rgba(0,240,255,0.15)' : 'rgba(255,255,255,0.05)', color: activeGenre === g ? '#00F0FF' : '#A1A1AA' }}>
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
              <StationCard key={s.key} station={s} index={i} isPlaying={playingKey === s.key} onPlay={handlePlay} onStop={handleStop} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default StationBrowser;
