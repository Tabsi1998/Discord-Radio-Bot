import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Calendar, Shield, Save } from 'lucide-react';
import { DASHBOARD_CAPABILITY_DEFAULTS } from '../lib/dashboardCapabilities';
import {
  buildFallbackStationSummary,
  buildWeeklyDigestSummary,
} from '../lib/dashboardSettings';

const DAYS = [
  { value: 0, de: 'Sonntag', en: 'Sunday' },
  { value: 1, de: 'Montag', en: 'Monday' },
  { value: 2, de: 'Dienstag', en: 'Tuesday' },
  { value: 3, de: 'Mittwoch', en: 'Wednesday' },
  { value: 4, de: 'Donnerstag', en: 'Thursday' },
  { value: 5, de: 'Freitag', en: 'Friday' },
  { value: 6, de: 'Samstag', en: 'Saturday' },
];

export default function DashboardSettings({
  apiRequest,
  selectedGuildId,
  t,
  capabilities = DASHBOARD_CAPABILITY_DEFAULTS,
  formatDate = null,
}) {
  const [settings, setSettings] = useState(null);
  const [textChannels, setTextChannels] = useState([]);
  const [stations, setStations] = useState({ free: [], pro: [], ultimate: [], custom: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const loadTokenRef = useRef(0);

  const load = useCallback(async () => {
    const loadToken = ++loadTokenRef.current;
    if (!selectedGuildId) {
      setSettings(null);
      setTextChannels([]);
      setStations({ free: [], pro: [], ultimate: [], custom: [] });
      setError('');
      setMessage('');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    setMessage('');
    setSettings(null);
    setTextChannels([]);
    setStations({ free: [], pro: [], ultimate: [], custom: [] });
    try {
      const [settingsResult, channelsResult, stationsResult] = await Promise.all([
        apiRequest(`/api/dashboard/settings?serverId=${encodeURIComponent(selectedGuildId)}`),
        apiRequest(`/api/dashboard/channels?serverId=${encodeURIComponent(selectedGuildId)}`),
        apiRequest(`/api/dashboard/stations?serverId=${encodeURIComponent(selectedGuildId)}`),
      ]);
      if (loadToken !== loadTokenRef.current) return;
      setSettings(settingsResult);
      setTextChannels(channelsResult.textChannels || []);
      setStations({
        free: stationsResult.free || [],
        pro: stationsResult.pro || [],
        ultimate: stationsResult.ultimate || [],
        custom: stationsResult.custom || [],
      });
    } catch (err) {
      if (loadToken !== loadTokenRef.current) return;
      setError(err.message);
    } finally {
      if (loadToken !== loadTokenRef.current) return;
      setLoading(false);
    }
  }, [selectedGuildId, apiRequest]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setError('');
    setMessage('');
    try {
      const body = {};
      if (capabilities.weeklyDigest === true && settings?.weeklyDigest) body.weeklyDigest = settings.weeklyDigest;
      if (capabilities.failoverRules === true && settings?.fallbackStation !== undefined) body.fallbackStation = settings.fallbackStation;
      const result = await apiRequest(`/api/dashboard/settings?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setSettings((current) => ({ ...(current || {}), ...(result || {}) }));
      setMessage(t('Einstellungen gespeichert.', 'Settings saved.'));
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) return <div style={{ color: '#52525B', textAlign: 'center', padding: 40 }}>{t('Lade...', 'Loading...')}</div>;

  const wd = settings?.weeklyDigest || { enabled: false, channelId: '', dayOfWeek: 1, hour: 9, language: 'de' };
  const canManageWeeklyDigest = capabilities.weeklyDigest === true;
  const canManageFallbackStation = capabilities.failoverRules === true;
  const digestSummary = buildWeeklyDigestSummary(settings, t, formatDate);
  const fallbackSummary = buildFallbackStationSummary(settings, t);

  const allStations = [
    ...stations.custom.map((station) => ({ value: `custom:${station.key}`, label: `${station.name} (Custom)` })),
    ...stations.free.map((station) => ({ value: station.key, label: station.name })),
    ...stations.pro.map((station) => ({ value: station.key, label: `${station.name} (Pro)` })),
    ...stations.ultimate.map((station) => ({ value: station.key, label: `${station.name} (Ultimate)` })),
  ];

  return (
    <section data-testid="dashboard-settings-panel" style={{ display: 'grid', gap: 14 }}>
      {error && <div style={{ border: '1px solid rgba(252,165,165,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>{error}</div>}
      {message && <div style={{ border: '1px solid rgba(16,185,129,0.25)', background: 'rgba(6,95,70,0.12)', padding: '10px 12px', color: '#6EE7B7', fontSize: 13 }}>{message}</div>}

      <div data-testid="settings-weekly-digest" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, opacity: canManageWeeklyDigest ? 1 : 0.6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Calendar size={18} color="#5865F2" />
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Wöchentlicher Stats-Digest', 'Weekly stats digest')}</h3>
          {!canManageWeeklyDigest && <span style={{ fontSize: 11, color: '#10B981', border: '1px solid rgba(16,185,129,0.3)', padding: '2px 8px' }}>PRO</span>}
        </div>
        <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
          {t(
            'Automatisch ein Embed mit der Wochen-Zusammenfassung in einen Text-Channel posten.',
            'Automatically post an embed with the weekly summary to a text channel.'
          )}
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
          <div data-testid="digest-status-card" style={{ border: `1px solid ${digestSummary.statusAccent}33`, background: `${digestSummary.statusAccent}14`, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: digestSummary.statusAccent }}>
              {t('Status', 'Status')}
            </div>
            <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#fff' }}>{digestSummary.statusLabel}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>{digestSummary.description}</div>
          </div>

          <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
              {t('Naechster Lauf', 'Next run')}
            </div>
            <div data-testid="digest-next-run" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
              {digestSummary.nextRunLabel}
            </div>
          </div>

          <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
              {t('Letzte Sendung', 'Last delivery')}
            </div>
            <div data-testid="digest-last-sent" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
              {digestSummary.lastSentLabel}
            </div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
              {t('Sprache', 'Language')}: {digestSummary.languageLabel}
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          <label data-testid="digest-enabled-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, padding: '10px 0' }}>
            <input
              type="checkbox"
              disabled={!canManageWeeklyDigest}
              checked={wd.enabled}
              onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, enabled: e.target.checked } }))}
              style={{ width: 16, height: 16, accentColor: '#5865F2' }}
            />
            {t('Aktiviert', 'Enabled')}
          </label>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Channel', 'Channel')}</label>
            <select
              data-testid="digest-channel-select"
              disabled={!canManageWeeklyDigest}
              value={wd.channelId}
              onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, channelId: e.target.value } }))}
              style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
            >
              <option value="">{t('Channel wählen...', 'Select channel...')}</option>
              {textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Wochentag', 'Day')}</label>
            <select
              data-testid="digest-day-select"
              disabled={!canManageWeeklyDigest}
              value={wd.dayOfWeek}
              onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, dayOfWeek: Number(e.target.value) } }))}
              style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
            >
              {DAYS.map((day) => <option key={day.value} value={day.value}>{t(day.de, day.en)}</option>)}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Uhrzeit', 'Hour')}</label>
            <select
              data-testid="digest-hour-select"
              disabled={!canManageWeeklyDigest}
              value={wd.hour}
              onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, hour: Number(e.target.value) } }))}
              style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
            >
              {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Sprache', 'Language')}</label>
            <select
              data-testid="digest-language-select"
              disabled={!canManageWeeklyDigest}
              value={wd.language || 'de'}
              onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, language: e.target.value } }))}
              style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
            >
              <option value="de">Deutsch</option>
              <option value="en">English</option>
            </select>
          </div>
        </div>

        {digestSummary.missingChannel && (
          <div data-testid="digest-channel-warning" style={{ marginTop: 12, border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>
            {t(
              'Der Weekly Digest ist aktiviert, aber es wurde noch kein Text-Channel ausgewaehlt.',
              'The weekly digest is enabled, but no text channel has been selected yet.'
            )}
          </div>
        )}
      </div>

      <div data-testid="settings-fallback-station" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, opacity: canManageFallbackStation ? 1 : 0.5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <Shield size={18} color="#8B5CF6" />
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Fallback-Station', 'Fallback station')}</h3>
          {!canManageFallbackStation && <span style={{ fontSize: 11, color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)', padding: '2px 8px' }}>ULTIMATE</span>}
        </div>
        <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
          {t(
            'Wird automatisch verwendet, wenn eine Station nicht erreichbar ist. Anstatt dass gar nichts läuft, springt der Bot auf diese Station.',
            'Automatically used when a station is unreachable. Instead of silence, the bot switches to this station.'
          )}
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
          <div data-testid="fallback-status-card" style={{ border: `1px solid ${fallbackSummary.statusAccent}33`, background: `${fallbackSummary.statusAccent}14`, padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: fallbackSummary.statusAccent }}>
              {t('Status', 'Status')}
            </div>
            <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#fff' }}>{fallbackSummary.statusLabel}</div>
            <div style={{ marginTop: 6, fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>{fallbackSummary.description}</div>
          </div>

          <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
              {t('Aktuelle Station', 'Current station')}
            </div>
            <div data-testid="fallback-current-station" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
              {fallbackSummary.stationLabel}
            </div>
            {fallbackSummary.badgeLabel && (
              <div style={{ marginTop: 8, display: 'inline-flex', border: '1px solid rgba(139,92,246,0.3)', color: '#C4B5FD', padding: '2px 8px', fontSize: 11, letterSpacing: '0.08em' }}>
                {fallbackSummary.badgeLabel}
              </div>
            )}
          </div>
        </div>
        <select
          data-testid="fallback-station-select"
          disabled={!canManageFallbackStation}
          value={settings?.fallbackStation || ''}
          onChange={(e) => setSettings((current) => ({ ...(current || {}), fallbackStation: e.target.value }))}
          style={{
            width: '100%',
            maxWidth: 400,
            height: 40,
            padding: '0 10px',
            border: '1px solid #1A1A2E',
            background: '#050505',
            color: canManageFallbackStation ? '#fff' : '#3F3F46',
            boxSizing: 'border-box',
            fontSize: 13,
          }}
        >
          <option value="">{t('Keine Fallback-Station', 'No fallback station')}</option>
          {allStations.map((station) => <option key={station.value} value={station.value}>{station.label}</option>)}
        </select>
      </div>

      <button
        data-testid="settings-save-btn"
        onClick={save}
        style={{ height: 42, border: 'none', background: '#10B981', color: '#042f2e', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 14 }}
      >
        <Save size={16} /> {t('Einstellungen speichern', 'Save settings')}
      </button>
    </section>
  );
}
