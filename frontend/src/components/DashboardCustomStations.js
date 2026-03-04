import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Radio, Plus, Trash2, Pencil, Save, X, ExternalLink } from 'lucide-react';

function StationRow({ station, onDelete, onEdit, t, testId }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: station.name, url: station.url, genre: station.genre || '' });

  return (
    <div data-testid={testId} style={{ border: '1px solid #1A1A2E', background: '#0A0A0A', padding: '10px 14px' }}>
      {editing ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'center' }}>
          <input value={form.name} onChange={(e) => setForm(c => ({ ...c, name: e.target.value }))} placeholder={t('Name', 'Name')} style={{
            height: 34, border: '1px solid #1A1A2E', background: '#050505', color: '#fff', padding: '0 8px', fontSize: 13,
          }} />
          <input value={form.url} onChange={(e) => setForm(c => ({ ...c, url: e.target.value }))} placeholder={t('Stream-URL', 'Stream URL')} style={{
            height: 34, border: '1px solid #1A1A2E', background: '#050505', color: '#fff', padding: '0 8px', fontSize: 13,
          }} />
          <input value={form.genre} onChange={(e) => setForm(c => ({ ...c, genre: e.target.value }))} placeholder={t('Genre', 'Genre')} style={{
            height: 34, border: '1px solid #1A1A2E', background: '#050505', color: '#fff', padding: '0 8px', fontSize: 13,
          }} />
          <div style={{ display: 'flex', gap: 4 }}>
            <button data-testid={`${testId}-save`} onClick={() => { onEdit(station.key, form); setEditing(false); }} style={{
              border: '1px solid rgba(16,185,129,0.4)', background: 'rgba(16,185,129,0.1)', color: '#10B981', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center',
            }}><Save size={14} /></button>
            <button onClick={() => setEditing(false)} style={{
              border: '1px solid #27272A', background: 'transparent', color: '#71717A', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center',
            }}><X size={14} /></button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Radio size={14} color="#5865F2" />
              <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{station.name}</strong>
              {station.genre && <span style={{ fontSize: 11, color: '#52525B', border: '1px solid #1A1A2E', padding: '1px 6px' }}>{station.genre}</span>}
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: '#52525B', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{station.key}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>{station.url}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button data-testid={`${testId}-edit`} onClick={() => setEditing(true)} style={{
              border: '1px solid #1A1A2E', background: 'transparent', color: '#A1A1AA', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center',
            }}><Pencil size={13} /></button>
            <button data-testid={`${testId}-delete`} onClick={() => onDelete(station.key)} style={{
              border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#EF4444', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center',
            }}><Trash2 size={13} /></button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DashboardCustomStations({ apiRequest, selectedGuildId, t }) {
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ key: '', name: '', url: '', genre: '' });
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const loadTokenRef = useRef(0);

  const load = useCallback(async () => {
    const loadToken = ++loadTokenRef.current;
    if (!selectedGuildId) {
      setStations([]);
      setError('');
      setMessage('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    setStations([]);
    try {
      const result = await apiRequest(`/api/dashboard/custom-stations?serverId=${encodeURIComponent(selectedGuildId)}`);
      if (loadToken !== loadTokenRef.current) return;
      setStations(result.stations || []);
    } catch (err) {
      if (loadToken !== loadTokenRef.current) return;
      setError(err.message);
    } finally {
      if (loadToken !== loadTokenRef.current) return;
      setLoading(false);
    }
  }, [selectedGuildId, apiRequest]);

  useEffect(() => { load(); }, [load]);

  const addStation = async () => {
    setError(''); setMessage('');
    const key = addForm.key.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!key || !addForm.name.trim() || !addForm.url.trim()) {
      setError(t('Key, Name und URL sind erforderlich.', 'Key, name and URL are required.'));
      return;
    }
    try {
      await apiRequest(`/api/dashboard/custom-stations?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'POST', body: JSON.stringify({ key, name: addForm.name.trim(), url: addForm.url.trim(), genre: addForm.genre.trim() }),
      });
      setMessage(t('Station hinzugefügt.', 'Station added.'));
      setAddForm({ key: '', name: '', url: '', genre: '' });
      setShowAdd(false);
      await load();
    } catch (err) { setError(err.message); }
  };

  const editStation = async (key, updates) => {
    setError(''); setMessage('');
    try {
      await apiRequest(`/api/dashboard/custom-stations?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'PUT', body: JSON.stringify({ key, ...updates }),
      });
      setMessage(t('Station aktualisiert.', 'Station updated.'));
      await load();
    } catch (err) { setError(err.message); }
  };

  const deleteStation = async (key) => {
    setError(''); setMessage('');
    try {
      await apiRequest(`/api/dashboard/custom-stations?serverId=${encodeURIComponent(selectedGuildId)}&key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      setMessage(t('Station gelöscht.', 'Station deleted.'));
      await load();
    } catch (err) { setError(err.message); }
  };

  return (
    <section data-testid="dashboard-custom-stations" style={{ display: 'grid', gap: 14 }}>
      <div style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>
            {t('Custom-Stationen', 'Custom stations')} <span style={{ color: '#52525B', fontSize: 14 }}>({stations.length})</span>
          </h3>
          <button data-testid="custom-station-add-btn" onClick={() => setShowAdd(!showAdd)} style={{
            border: '1px solid #5865F2', background: showAdd ? 'rgba(88,101,242,0.15)' : 'transparent',
            color: '#fff', height: 36, padding: '0 14px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13,
          }}>
            <Plus size={14} /> {showAdd ? t('Abbrechen', 'Cancel') : t('Neue Station', 'New station')}
          </button>
        </div>

        {showAdd && (
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Key', 'Key')}</label>
              <input data-testid="custom-station-key-input" value={addForm.key} onChange={(e) => setAddForm(c => ({ ...c, key: e.target.value }))} placeholder="mein-radio" style={{
                width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
              }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Name', 'Name')}</label>
              <input data-testid="custom-station-name-input" value={addForm.name} onChange={(e) => setAddForm(c => ({ ...c, name: e.target.value }))} placeholder="Mein Radio" style={{
                width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
              }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Stream-URL', 'Stream URL')}</label>
              <input data-testid="custom-station-url-input" value={addForm.url} onChange={(e) => setAddForm(c => ({ ...c, url: e.target.value }))} placeholder="https://..." style={{
                width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
              }} />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Genre', 'Genre')}</label>
              <input data-testid="custom-station-genre-input" value={addForm.genre} onChange={(e) => setAddForm(c => ({ ...c, genre: e.target.value }))} placeholder={t('Optional', 'Optional')} style={{
                width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
              }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button data-testid="custom-station-save-btn" onClick={addStation} style={{
                width: '100%', height: 40, border: 'none', background: '#5865F2', color: '#fff', fontWeight: 700, cursor: 'pointer',
              }}>
                {t('Hinzufügen', 'Add')}
              </button>
            </div>
          </div>
        )}
      </div>

      {error && <div data-testid="custom-stations-error" style={{ border: '1px solid rgba(252,165,165,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>{error}</div>}
      {message && <div data-testid="custom-stations-message" style={{ border: '1px solid rgba(16,185,129,0.25)', background: 'rgba(6,95,70,0.12)', padding: '10px 12px', color: '#6EE7B7', fontSize: 13 }}>{message}</div>}

      {loading && <div style={{ color: '#52525B', textAlign: 'center', padding: 20 }}>{t('Lade...', 'Loading...')}</div>}

      <div style={{ display: 'grid', gap: 6 }}>
        {!loading && stations.length === 0 && (
          <div data-testid="custom-stations-empty" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: '40px 20px', textAlign: 'center' }}>
            <Radio size={32} color="#27272A" style={{ margin: '0 auto' }} />
            <p style={{ color: '#52525B', marginTop: 10 }}>{t('Keine Custom-Stationen vorhanden.', 'No custom stations yet.')}</p>
            <p style={{ color: '#3F3F46', marginTop: 4, fontSize: 13 }}>{t('Nutze /addstation auf Discord oder füge hier eine hinzu.', 'Use /addstation on Discord or add one here.')}</p>
          </div>
        )}
        {stations.map((station, i) => (
          <StationRow key={station.key} station={station} onDelete={deleteStation} onEdit={editStation} t={t} testId={`custom-station-${i}`} />
        ))}
      </div>
    </section>
  );
}
