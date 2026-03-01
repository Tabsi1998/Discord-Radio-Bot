import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, BarChart3, CalendarDays, Crown, Lock, LogOut, ShieldCheck, Users } from 'lucide-react';
import { useI18n } from '../i18n';

const API_BASE = (process.env.REACT_APP_BACKEND_URL || '').replace(/\/+$/, '');
const PERMISSION_COMMANDS = [
  'play', 'pause', 'resume', 'stop', 'stations', 'stats', 'event', 'perm', 'addstation', 'removestation', 'mystations',
];

function buildApiUrl(path) {
  return `${API_BASE}${path}`;
}

async function apiRequest(path, options = {}) {
  const response = await fetch(buildApiUrl(path), {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });
  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(payload?.error || `HTTP ${response.status}`);
  }
  return payload;
}

function resolveAuthError() {
  try {
    const url = new URL(window.location.href);
    return String(url.searchParams.get('authError') || '').trim();
  } catch {
    return '';
  }
}

function DashboardShell({ children, sidebar, topbar }) {
  return (
    <div
      data-testid="dashboard-shell"
      style={{
        minHeight: '100vh',
        background: '#050505',
        color: '#fff',
        display: 'grid',
        gridTemplateColumns: '280px 1fr',
      }}
    >
      <aside
        data-testid="dashboard-sidebar"
        style={{
          borderRight: '1px solid #27272A',
          background: '#0A0A0A',
          padding: 20,
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflowY: 'auto',
        }}
      >
        {sidebar}
      </aside>

      <main data-testid="dashboard-main" style={{ minWidth: 0 }}>
        <div
          data-testid="dashboard-topbar"
          style={{
            height: 68,
            borderBottom: '1px solid #27272A',
            background: 'rgba(10,10,10,0.94)',
            backdropFilter: 'blur(16px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 24px',
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
        >
          {topbar}
        </div>

        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>{children}</div>
      </main>

      <style>{`
        @media (max-width: 1024px) {
          [data-testid='dashboard-shell'] {
            grid-template-columns: 1fr !important;
          }
          [data-testid='dashboard-sidebar'] {
            position: static !important;
            height: auto !important;
            border-right: none !important;
            border-bottom: 1px solid #27272A;
          }
        }
      `}</style>
    </div>
  );
}

function MetricCard({ label, value, accent = '#00F0FF', testId }) {
  return (
    <div
      data-testid={testId}
      style={{
        background: '#0A0A0A',
        border: '1px solid #27272A',
        padding: 16,
        minHeight: 130,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}
    >
      <span style={{ fontSize: 11, color: '#A1A1AA', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</span>
      <strong
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 32,
          lineHeight: 1.1,
          color: accent,
          wordBreak: 'break-word',
        }}
      >
        {value}
      </strong>
    </div>
  );
}

export default function DashboardPortal() {
  const { locale } = useI18n();
  const t = useCallback((de, en) => (String(locale || 'de').startsWith('de') ? de : en), [locale]);

  const [loadingSession, setLoadingSession] = useState(true);
  const [session, setSession] = useState({ authenticated: false, oauthConfigured: false, user: null, guilds: [] });
  const [selectedGuildId, setSelectedGuildId] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [loadingData, setLoadingData] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(resolveAuthError());

  const [events, setEvents] = useState([]);
  const [eventForm, setEventForm] = useState({
    title: '',
    stationKey: '',
    fallbackStationKey: '',
    startsAt: '',
    timezone: 'Europe/Vienna',
    channelId: '',
    enabled: true,
  });

  const [permsDraft, setPermsDraft] = useState(() => {
    const base = {};
    PERMISSION_COMMANDS.forEach((command) => { base[command] = ''; });
    return base;
  });

  const [stats, setStats] = useState({ basic: null, advanced: null, tier: 'free' });

  const selectedGuild = useMemo(
    () => (session.guilds || []).find((guild) => guild.id === selectedGuildId) || null,
    [session.guilds, selectedGuildId],
  );

  const dashboardEnabled = Boolean(selectedGuild?.dashboardEnabled);
  const isUltimate = selectedGuild?.tier === 'ultimate';

  const refreshSession = useCallback(async () => {
    setLoadingSession(true);
    setError('');
    try {
      const payload = await apiRequest('/api/auth/session', { method: 'GET' });
      setSession({
        authenticated: payload.authenticated === true,
        oauthConfigured: payload.oauthConfigured === true,
        user: payload.user || null,
        guilds: Array.isArray(payload.guilds) ? payload.guilds : [],
      });

      const savedGuildId = window.localStorage.getItem('omnifm.dashboard.guildId') || '';
      const guilds = Array.isArray(payload.guilds) ? payload.guilds : [];
      const fallbackGuild = guilds.find((guild) => guild.dashboardEnabled) || guilds[0] || null;
      const selected = guilds.find((guild) => guild.id === savedGuildId) || fallbackGuild;
      setSelectedGuildId(selected?.id || '');
    } catch (err) {
      setError(err.message || 'Session konnte nicht geladen werden.');
      setSession({ authenticated: false, oauthConfigured: false, user: null, guilds: [] });
    } finally {
      setLoadingSession(false);
    }
  }, []);

  const refreshDashboardData = useCallback(async () => {
    if (!selectedGuildId || !dashboardEnabled) return;
    setLoadingData(true);
    setMessage('');
    setError('');
    try {
      const [statsPayload, eventsPayload, permsPayload] = await Promise.all([
        apiRequest(`/api/dashboard/stats?serverId=${encodeURIComponent(selectedGuildId)}`),
        apiRequest(`/api/dashboard/events?serverId=${encodeURIComponent(selectedGuildId)}`),
        apiRequest(`/api/dashboard/perms?serverId=${encodeURIComponent(selectedGuildId)}`),
      ]);

      setStats({
        tier: statsPayload.tier || selectedGuild?.tier || 'free',
        basic: statsPayload.basic || null,
        advanced: statsPayload.advanced || null,
      });
      setEvents(Array.isArray(eventsPayload.events) ? eventsPayload.events : []);

      const nextDraft = {};
      PERMISSION_COMMANDS.forEach((command) => {
        const roles = permsPayload.commandRoleMap?.[command] || [];
        nextDraft[command] = Array.isArray(roles) ? roles.join(', ') : '';
      });
      setPermsDraft(nextDraft);
    } catch (err) {
      setError(err.message || 'Dashboard-Daten konnten nicht geladen werden.');
    } finally {
      setLoadingData(false);
    }
  }, [selectedGuildId, dashboardEnabled, selectedGuild?.tier]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!selectedGuildId) return;
    window.localStorage.setItem('omnifm.dashboard.guildId', selectedGuildId);
  }, [selectedGuildId]);

  useEffect(() => {
    if (session.authenticated && selectedGuildId && dashboardEnabled) {
      refreshDashboardData();
    }
  }, [session.authenticated, selectedGuildId, dashboardEnabled, refreshDashboardData]);

  const startDiscordLogin = async () => {
    setError('');
    try {
      const payload = await apiRequest('/api/auth/discord/login?nextPage=dashboard', { method: 'GET' });
      if (payload?.authUrl) {
        window.location.href = payload.authUrl;
      }
    } catch (err) {
      setError(err.message || 'Discord Login konnte nicht gestartet werden.');
    }
  };

  const logout = async () => {
    setError('');
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      await refreshSession();
      setMessage(t('Erfolgreich ausgeloggt.', 'Logged out successfully.'));
    } catch (err) {
      setError(err.message || 'Logout fehlgeschlagen.');
    }
  };

  const createEvent = async () => {
    if (!selectedGuildId) return;
    setError('');
    setMessage('');
    try {
      const payload = await apiRequest(`/api/dashboard/events?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'POST',
        body: JSON.stringify(eventForm),
      });
      setEvents((current) => [payload.event, ...current]);
      setEventForm({
        title: '',
        stationKey: '',
        fallbackStationKey: '',
        startsAt: '',
        timezone: 'Europe/Vienna',
        channelId: '',
        enabled: true,
      });
      setMessage(t('Event gespeichert.', 'Event saved.'));
      refreshDashboardData();
    } catch (err) {
      setError(err.message || 'Event konnte nicht gespeichert werden.');
    }
  };

  const toggleEvent = async (eventId, enabled) => {
    if (!selectedGuildId) return;
    setError('');
    try {
      await apiRequest(`/api/dashboard/events/${encodeURIComponent(eventId)}?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
      setEvents((current) => current.map((eventItem) => (
        eventItem.id === eventId ? { ...eventItem, enabled } : eventItem
      )));
    } catch (err) {
      setError(err.message || 'Event konnte nicht aktualisiert werden.');
    }
  };

  const deleteEvent = async (eventId) => {
    if (!selectedGuildId) return;
    setError('');
    try {
      await apiRequest(`/api/dashboard/events/${encodeURIComponent(eventId)}?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'DELETE',
      });
      setEvents((current) => current.filter((eventItem) => eventItem.id !== eventId));
    } catch (err) {
      setError(err.message || 'Event konnte nicht gelöscht werden.');
    }
  };

  const savePerms = async () => {
    if (!selectedGuildId) return;
    setError('');
    setMessage('');
    const commandRoleMap = {};
    Object.entries(permsDraft).forEach(([command, rawRoles]) => {
      const normalized = String(rawRoles || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      commandRoleMap[command] = [...new Set(normalized)];
    });

    try {
      await apiRequest(`/api/dashboard/perms?serverId=${encodeURIComponent(selectedGuildId)}`, {
        method: 'PUT',
        body: JSON.stringify({ commandRoleMap }),
      });
      setMessage(t('Berechtigungen gespeichert.', 'Permissions saved.'));
      refreshDashboardData();
    } catch (err) {
      setError(err.message || 'Berechtigungen konnten nicht gespeichert werden.');
    }
  };

  if (loadingSession) {
    return (
      <section
        data-testid="dashboard-loading-view"
        style={{ minHeight: '70vh', display: 'grid', placeItems: 'center', textAlign: 'center' }}
      >
        <div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 44 }}>{t('Dashboard lädt…', 'Loading dashboard…')}</h1>
          <p style={{ color: '#A1A1AA', marginTop: 10 }}>{t('Bitte kurz warten.', 'Please wait a moment.')}</p>
        </div>
      </section>
    );
  }

  if (!session.authenticated) {
    return (
      <section
        data-testid="dashboard-login-view"
        style={{
          minHeight: '100vh',
          background: '#050505',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
        }}
      >
        <div
          data-testid="dashboard-login-card"
          style={{
            width: 'min(740px, 100%)',
            background: '#0A0A0A',
            border: '1px solid #27272A',
            padding: 28,
            boxShadow: '0 0 20px rgba(88,101,242,0.15)',
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#A1A1AA' }}>OmniFM Dashboard</div>
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 48, lineHeight: 1.05, marginTop: 10 }} data-testid="dashboard-login-title">
            {t('Discord SSO Login', 'Discord SSO Login')}
          </h1>
          <p style={{ color: '#A1A1AA', marginTop: 12, lineHeight: 1.7 }} data-testid="dashboard-login-description">
            {t(
              'Melde dich mit deinem Discord Account an. Danach kannst du deine Server auswählen und Events, Rollenrechte und Stats zentral steuern. Dashboard ist ab PRO freigeschaltet.',
              'Sign in with your Discord account. Then select your servers and manage events, permissions, and stats centrally. Dashboard access is unlocked from PRO.',
            )}
          </p>

          {error && (
            <div
              data-testid="dashboard-login-error"
              style={{ marginTop: 14, color: '#FCA5A5', border: '1px solid rgba(252,165,165,0.35)', padding: '10px 12px', background: 'rgba(127,29,29,0.25)' }}
            >
              {error}
            </div>
          )}

          {!session.oauthConfigured && (
            <div
              data-testid="dashboard-oauth-not-configured"
              style={{ marginTop: 14, color: '#FDE68A', border: '1px solid rgba(253,230,138,0.35)', padding: '10px 12px', background: 'rgba(120,53,15,0.2)' }}
            >
              {t('Discord OAuth ist noch nicht vollständig konfiguriert.', 'Discord OAuth is not fully configured yet.')}
            </div>
          )}

          <button
            data-testid="dashboard-discord-login-button"
            onClick={startDiscordLogin}
            style={{
              marginTop: 20,
              height: 48,
              width: '100%',
              border: 'none',
              background: '#5865F2',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
              letterSpacing: '0.03em',
            }}
          >
            {t('Mit Discord einloggen', 'Continue with Discord')}
          </button>
        </div>
      </section>
    );
  }

  const sidebar = (
    <>
      <div data-testid="dashboard-brand" style={{ marginBottom: 20 }}>
        <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 26, fontWeight: 700 }}>OmniFM</div>
        <div style={{ color: '#A1A1AA', fontSize: 13 }}>{t('Server Control Console', 'Server Control Console')}</div>
      </div>

      <label htmlFor="dashboard-guild-select" style={{ display: 'block', color: '#A1A1AA', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
        {t('Server auswählen', 'Select server')}
      </label>
      <select
        id="dashboard-guild-select"
        data-testid="dashboard-guild-select"
        value={selectedGuildId}
        onChange={(event) => setSelectedGuildId(event.target.value)}
        style={{
          width: '100%',
          background: '#050505',
          color: '#fff',
          border: '1px solid #27272A',
          height: 42,
          padding: '0 12px',
          marginBottom: 16,
        }}
      >
        {(session.guilds || []).map((guild) => (
          <option key={guild.id} value={guild.id}>
            {guild.name} · {String(guild.tier || 'free').toUpperCase()}
          </option>
        ))}
      </select>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { key: 'overview', label: t('Übersicht', 'Overview'), icon: BarChart3 },
          { key: 'events', label: t('Events', 'Events'), icon: CalendarDays },
          { key: 'perms', label: t('Permissions', 'Permissions'), icon: ShieldCheck },
          { key: 'stats', label: t('Stats', 'Stats'), icon: Users },
        ].map((entry) => {
          const Icon = entry.icon;
          const active = activeTab === entry.key;
          return (
            <button
              key={entry.key}
              data-testid={`dashboard-tab-${entry.key}`}
              onClick={() => setActiveTab(entry.key)}
              style={{
                border: '1px solid',
                borderColor: active ? '#5865F2' : '#27272A',
                background: active ? 'rgba(88,101,242,0.12)' : '#0A0A0A',
                color: '#fff',
                height: 42,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '0 12px',
                cursor: 'pointer',
              }}
            >
              <Icon size={16} color={active ? '#5865F2' : '#A1A1AA'} />
              {entry.label}
            </button>
          );
        })}
      </div>

      <div style={{ marginTop: 22, padding: 14, border: '1px solid #27272A', background: '#050505' }} data-testid="dashboard-ultimate-promo-box">
        <div style={{ fontSize: 11, color: '#A1A1AA', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Ultimate Highlight</div>
        <div style={{ marginTop: 6, fontFamily: "'Outfit', sans-serif", fontSize: 18 }}>YouTube Livestream Playback</div>
        <div style={{ marginTop: 8, color: '#A1A1AA', fontSize: 13, lineHeight: 1.6 }}>
          {t('In Ultimate kannst du Livestream-Quellen direkt nutzen und mit Reliability-Mode absichern.', 'Ultimate unlocks YouTube live source playback and reliability mode support.')}
        </div>
      </div>
    </>
  );

  const topbar = (
    <>
      <div data-testid="dashboard-current-guild-name" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 22 }}>
        {selectedGuild?.name || t('Kein Server gewählt', 'No server selected')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div data-testid="dashboard-user-chip" style={{ color: '#A1A1AA', fontSize: 13 }}>
          {session.user?.username || 'Discord User'}
        </div>
        <button
          data-testid="dashboard-logout-button"
          onClick={logout}
          style={{
            border: '1px solid #27272A',
            background: '#0A0A0A',
            color: '#fff',
            height: 38,
            padding: '0 12px',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
          }}
        >
          <LogOut size={14} />
          {t('Logout', 'Logout')}
        </button>
      </div>
    </>
  );

  return (
    <DashboardShell sidebar={sidebar} topbar={topbar}>
      {error && (
        <div data-testid="dashboard-global-error" style={{ border: '1px solid rgba(252,165,165,0.35)', background: 'rgba(127,29,29,0.2)', padding: '10px 12px', color: '#FCA5A5' }}>
          {error}
        </div>
      )}
      {message && (
        <div data-testid="dashboard-global-message" style={{ border: '1px solid rgba(16,185,129,0.35)', background: 'rgba(6,95,70,0.2)', padding: '10px 12px', color: '#6EE7B7' }}>
          {message}
        </div>
      )}

      {!dashboardEnabled && (
        <div data-testid="dashboard-pro-gate" style={{ border: '1px solid #27272A', background: '#0A0A0A', padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <Lock size={22} color="#F59E0B" />
            <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 30 }}>
              {t('Dashboard ab PRO freigeschaltet', 'Dashboard unlocked from PRO')}
            </h2>
          </div>
          <p style={{ marginTop: 10, color: '#A1A1AA', lineHeight: 1.7 }}>
            {t(
              'Dieser Server ist aktuell im Free-Plan. Upgrade auf PRO, um Events, Rollenrechte und private Server-Stats im Dashboard zu verwalten.',
              'This server is currently on the Free plan. Upgrade to PRO to manage events, permissions, and private server stats in the dashboard.',
            )}
          </p>
          <a
            href="/?page=home#premium"
            data-testid="dashboard-upgrade-link"
            style={{
              marginTop: 14,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              border: '1px solid #8B5CF6',
              background: 'rgba(139,92,246,0.2)',
              color: '#fff',
              padding: '10px 14px',
            }}
          >
            <Crown size={14} />
            {t('Zu PRO / Ultimate wechseln', 'Upgrade to PRO / Ultimate')}
          </a>
        </div>
      )}

      {dashboardEnabled && (
        <>
          {activeTab === 'overview' && (
            <section data-testid="dashboard-overview-panel">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <MetricCard testId="dashboard-metric-listeners" label={t('Live Zuhörer', 'Live listeners')} value={stats.basic?.listenersNow ?? 0} />
                <MetricCard testId="dashboard-metric-streams" label={t('Aktive Streams', 'Active streams')} value={stats.basic?.activeStreams ?? 0} accent="#10B981" />
                <MetricCard testId="dashboard-metric-peak" label={t('Peak Zuhörer', 'Peak listeners')} value={stats.basic?.peakListeners ?? 0} accent="#8B5CF6" />
                <MetricCard testId="dashboard-metric-top-station" label={t('Top Station', 'Top station')} value={stats.basic?.topStation?.name || '-'} accent="#FFFFFF" />
              </div>
            </section>
          )}

          {activeTab === 'events' && (
            <section data-testid="dashboard-events-panel" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 420px) 1fr', gap: 14 }}>
              <div style={{ border: '1px solid #27272A', background: '#0A0A0A', padding: 16 }}>
                <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 24 }}>{t('Neues Event', 'Create event')}</h3>
                <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                  <input data-testid="dashboard-event-title-input" value={eventForm.title} onChange={(event) => setEventForm((current) => ({ ...current, title: event.target.value }))} placeholder={t('Titel', 'Title')} style={{ height: 40, padding: '0 10px', border: '1px solid #27272A', background: '#050505', color: '#fff' }} />
                  <input data-testid="dashboard-event-station-input" value={eventForm.stationKey} onChange={(event) => setEventForm((current) => ({ ...current, stationKey: event.target.value }))} placeholder={t('Station Key', 'Station key')} style={{ height: 40, padding: '0 10px', border: '1px solid #27272A', background: '#050505', color: '#fff' }} />
                  <input data-testid="dashboard-event-fallback-input" value={eventForm.fallbackStationKey} onChange={(event) => setEventForm((current) => ({ ...current, fallbackStationKey: event.target.value }))} placeholder={t('Fallback (Ultimate optional)', 'Fallback (Ultimate optional)')} style={{ height: 40, padding: '0 10px', border: '1px solid #27272A', background: '#050505', color: '#fff' }} />
                  <input data-testid="dashboard-event-starts-at-input" value={eventForm.startsAt} onChange={(event) => setEventForm((current) => ({ ...current, startsAt: event.target.value }))} placeholder={t('Startzeit (z. B. Fr 20:00)', 'Start time (e.g. Fri 20:00)')} style={{ height: 40, padding: '0 10px', border: '1px solid #27272A', background: '#050505', color: '#fff' }} />
                  <button data-testid="dashboard-event-create-button" onClick={createEvent} style={{ height: 42, border: 'none', background: '#5865F2', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>{t('Event speichern', 'Save event')}</button>
                </div>
              </div>

              <div style={{ border: '1px solid #27272A', background: '#0A0A0A', padding: 16 }}>
                <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 24 }}>{t('Aktive Events', 'Active events')}</h3>
                <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                  {events.length === 0 && <div data-testid="dashboard-events-empty" style={{ color: '#A1A1AA' }}>{t('Keine Events vorhanden.', 'No events yet.')}</div>}
                  {events.map((eventItem) => (
                    <div key={eventItem.id} data-testid={`dashboard-event-item-${eventItem.id}`} style={{ border: '1px solid #27272A', padding: 12, background: '#050505' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                        <strong>{eventItem.title || '-'}</strong>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button data-testid={`dashboard-event-toggle-${eventItem.id}`} onClick={() => toggleEvent(eventItem.id, !eventItem.enabled)} style={{ border: '1px solid #27272A', background: eventItem.enabled ? 'rgba(16,185,129,0.15)' : '#0A0A0A', color: '#fff', height: 30, padding: '0 10px', cursor: 'pointer' }}>{eventItem.enabled ? t('Aktiv', 'Enabled') : t('Inaktiv', 'Disabled')}</button>
                          <button data-testid={`dashboard-event-delete-${eventItem.id}`} onClick={() => deleteEvent(eventItem.id)} style={{ border: '1px solid rgba(248,113,113,0.45)', background: 'rgba(127,29,29,0.2)', color: '#fff', height: 30, padding: '0 10px', cursor: 'pointer' }}>{t('Löschen', 'Delete')}</button>
                        </div>
                      </div>
                      <div style={{ color: '#A1A1AA', marginTop: 6, fontSize: 13 }}>
                        {t('Station', 'Station')}: {eventItem.stationKey || '-'} · {t('Start', 'Start')}: {eventItem.startsAt || '-'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <style>{`
                @media (max-width: 980px) {
                  [data-testid='dashboard-events-panel'] { grid-template-columns: 1fr !important; }
                }
              `}</style>
            </section>
          )}

          {activeTab === 'perms' && (
            <section data-testid="dashboard-perms-panel" style={{ border: '1px solid #27272A', background: '#0A0A0A', padding: 16 }}>
              <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 24 }}>{t('Rollenrechte pro Command', 'Role permissions by command')}</h3>
              <p style={{ color: '#A1A1AA', marginTop: 8, lineHeight: 1.7 }}>
                {t('Trenne mehrere Rollen mit Komma, z. B. DJ, Moderator, Admin', 'Use comma-separated role names, e.g. DJ, Moderator, Admin')}
              </p>

              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                {PERMISSION_COMMANDS.map((command) => (
                  <label key={command} data-testid={`dashboard-perm-row-${command}`} style={{ display: 'grid', gap: 6 }}>
                    <span style={{ color: '#A1A1AA', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>/{command}</span>
                    <input
                      data-testid={`dashboard-perm-input-${command}`}
                      value={permsDraft[command] || ''}
                      onChange={(event) => setPermsDraft((current) => ({ ...current, [command]: event.target.value }))}
                      placeholder={t('Rollen', 'Roles')}
                      style={{ height: 38, border: '1px solid #27272A', background: '#050505', color: '#fff', padding: '0 10px' }}
                    />
                  </label>
                ))}
              </div>

              <button
                data-testid="dashboard-perms-save-button"
                onClick={savePerms}
                style={{ marginTop: 14, height: 42, border: 'none', background: '#10B981', color: '#042f2e', fontWeight: 700, padding: '0 14px', cursor: 'pointer' }}
              >
                {t('Berechtigungen speichern', 'Save permissions')}
              </button>
            </section>
          )}

          {activeTab === 'stats' && (
            <section data-testid="dashboard-stats-panel" style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <MetricCard testId="dashboard-stats-listeners-now" label={t('Live Zuhörer', 'Live listeners')} value={stats.basic?.listenersNow ?? 0} />
                <MetricCard testId="dashboard-stats-active-streams" label={t('Aktive Streams', 'Active streams')} value={stats.basic?.activeStreams ?? 0} accent="#10B981" />
                <MetricCard testId="dashboard-stats-peak-time" label={t('Peak Zeit', 'Peak time')} value={stats.basic?.peakTime || '-'} accent="#8B5CF6" />
                <MetricCard testId="dashboard-stats-top-station" label={t('Top Station', 'Top station')} value={stats.basic?.topStation?.name || '-'} accent="#FFFFFF" />
              </div>

              {!isUltimate && (
                <div data-testid="dashboard-stats-ultimate-upsell" style={{ border: '1px solid #27272A', background: '#0A0A0A', padding: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Crown size={18} color="#8B5CF6" />
                    <strong>{t('Ultimate Analytics', 'Ultimate analytics')}</strong>
                  </div>
                  <p style={{ color: '#A1A1AA', marginTop: 8, lineHeight: 1.7 }}>
                    {t('Mit Ultimate siehst du Channel-Breakdowns, Tagesreports und detaillierte Station-Auswertungen.', 'Ultimate unlocks channel breakdowns, daily reports, and detailed station analytics.')}
                  </p>
                </div>
              )}

              {isUltimate && (
                <div data-testid="dashboard-stats-advanced" style={{ border: '1px solid #27272A', background: '#0A0A0A', padding: 16, display: 'grid', gap: 12 }}>
                  <div>
                    <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Listener pro Channel', 'Listeners by channel')}</h4>
                    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                      {(stats.advanced?.listenersByChannel || []).length === 0 && <div data-testid="dashboard-advanced-channels-empty" style={{ color: '#A1A1AA' }}>{t('Keine Channel-Daten.', 'No channel data yet.')}</div>}
                      {(stats.advanced?.listenersByChannel || []).map((item, index) => (
                        <div key={`${item.name}-${index}`} data-testid={`dashboard-advanced-channel-row-${index}`} style={{ border: '1px solid #27272A', background: '#050505', padding: '8px 10px', display: 'flex', justifyContent: 'space-between' }}>
                          <span>{item.name}</span>
                          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{item.listeners}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Tagesreport', 'Daily report')}</h4>
                    <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                      {(stats.advanced?.dailyReport || []).length === 0 && <div data-testid="dashboard-advanced-daily-empty" style={{ color: '#A1A1AA' }}>{t('Keine Tagesdaten.', 'No daily data yet.')}</div>}
                      {(stats.advanced?.dailyReport || []).map((item, index) => (
                        <div key={`${item.day}-${index}`} data-testid={`dashboard-advanced-daily-row-${index}`} style={{ border: '1px solid #27272A', background: '#050505', padding: '8px 10px', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <span style={{ minWidth: 90 }}>{item.day}</span>
                          <span>{t('Starts', 'Starts')}: <strong>{item.starts}</strong></span>
                          <span>{t('Peak', 'Peak')}: <strong>{item.peakListeners}</strong></span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {loadingData && (
            <div data-testid="dashboard-loading-state" style={{ color: '#A1A1AA' }}>
              {t('Daten werden aktualisiert…', 'Refreshing dashboard data…')}
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}
