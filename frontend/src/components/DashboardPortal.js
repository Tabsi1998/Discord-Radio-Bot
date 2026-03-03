import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  BarChart3,
  CalendarDays,
  ChevronDown,
  Crown,
  LayoutDashboard,
  Lock,
  LogOut,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { useI18n } from '../i18n';
import { buildApiUrl } from '../lib/api';

const PERMISSION_COMMANDS = [
  'play', 'pause', 'resume', 'stop', 'setvolume', 'stations', 'list', 'now', 'stats', 'history', 'status', 'health', 'diag', 'addstation', 'removestation', 'mystations', 'event',
];
const EMPTY_SESSION = {
  authenticated: false,
  oauthConfigured: null,
  user: null,
  guilds: [],
};
const DEFAULT_TIMEZONE = 'Europe/Vienna';
const EMPTY_EVENT_CATALOG = {
  defaultTimeZone: DEFAULT_TIMEZONE,
  stations: [],
  voiceChannels: [],
  textChannels: [],
  repeatModes: [],
  timeZones: [],
};
const DASHBOARD_CONTROL_STYLE = {
  height: 46,
  padding: '0 14px',
  borderRadius: 16,
  border: '1px solid rgba(148,163,184,0.18)',
  background: 'rgba(2,6,23,0.72)',
  color: '#fff',
  outline: 'none',
};
const DASHBOARD_TEXTAREA_STYLE = {
  padding: '12px 14px',
  borderRadius: 16,
  border: '1px solid rgba(148,163,184,0.18)',
  background: 'rgba(2,6,23,0.72)',
  color: '#fff',
  resize: 'vertical',
  outline: 'none',
};

function createEventForm(defaultTimeZone = DEFAULT_TIMEZONE) {
  return {
    title: '',
    stationKey: '',
    channelId: '',
    textChannelId: '',
    startsAt: '',
    endsAt: '',
    timezone: defaultTimeZone,
    repeat: 'none',
    createDiscordEvent: false,
    stageTopic: '',
    announceMessage: '',
    description: '',
    enabled: true,
  };
}

function createPermsDraft() {
  const base = {};
  PERMISSION_COMMANDS.forEach((command) => {
    base[command] = { allowRoleIds: [], denyRoleIds: [] };
  });
  return base;
}

function uniqueIds(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
}

function toDateTimeLocal(rawValue) {
  if (!rawValue) return '';
  const value = new Date(rawValue);
  if (Number.isNaN(value.getTime())) return '';
  const pad = (input) => String(input).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

function normalizePermRule(rawRule) {
  if (Array.isArray(rawRule)) {
    return { allowRoleIds: uniqueIds(rawRule), denyRoleIds: [] };
  }
  return {
    allowRoleIds: uniqueIds(rawRule?.allowRoleIds),
    denyRoleIds: uniqueIds(rawRule?.denyRoleIds),
  };
}

function buildEventFormFromEvent(eventItem, fallbackTimeZone = DEFAULT_TIMEZONE) {
  const form = createEventForm(eventItem?.timezone || fallbackTimeZone);
  return {
    ...form,
    title: eventItem?.title || '',
    stationKey: eventItem?.stationKey || '',
    channelId: eventItem?.channelId || '',
    textChannelId: eventItem?.textChannelId || '',
    startsAt: toDateTimeLocal(eventItem?.startsAt),
    endsAt: toDateTimeLocal(eventItem?.endsAt),
    timezone: eventItem?.timezone || fallbackTimeZone,
    repeat: eventItem?.repeat || 'none',
    createDiscordEvent: eventItem?.createDiscordEvent === true,
    stageTopic: eventItem?.stageTopic || '',
    announceMessage: eventItem?.announceMessage || '',
    description: eventItem?.description || '',
    enabled: eventItem?.enabled !== false,
  };
}

function resolveRoleNames(roleIds, roles) {
  const roleMap = new Map((Array.isArray(roles) ? roles : []).map((role) => [role.id, role.name]));
  const names = uniqueIds(roleIds).map((roleId) => roleMap.get(roleId) || roleId);
  return names.join(', ') || '-';
}

function normalizeEventCatalog(rawCatalog) {
  return {
    defaultTimeZone: rawCatalog?.defaultTimeZone || DEFAULT_TIMEZONE,
    stations: Array.isArray(rawCatalog?.stations) ? rawCatalog.stations : [],
    voiceChannels: Array.isArray(rawCatalog?.voiceChannels) ? rawCatalog.voiceChannels : [],
    textChannels: Array.isArray(rawCatalog?.textChannels) ? rawCatalog.textChannels : [],
    repeatModes: Array.isArray(rawCatalog?.repeatModes) ? rawCatalog.repeatModes : [],
    timeZones: Array.isArray(rawCatalog?.timeZones) ? rawCatalog.timeZones : [],
  };
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

function resolveAuthErrorMessage(authError, t) {
  switch (String(authError || '').trim()) {
    case 'oauth_not_configured':
      return t('Discord OAuth ist noch nicht vollstaendig konfiguriert.', 'Discord OAuth is not configured yet.');
    case 'invalid_state':
      return t('Der Discord-Login ist abgelaufen oder ungueltig. Bitte erneut versuchen.', 'The Discord login expired or is invalid. Please try again.');
    case 'missing_code':
      return t('Discord hat keinen gueltigen Login-Code geliefert.', 'Discord did not return a valid login code.');
    case 'oauth_exchange_failed':
      return t('Discord-Login konnte nicht abgeschlossen werden. Bitte erneut versuchen.', 'Discord login could not be completed. Please try again.');
    default:
      return String(authError || '').trim();
  }
}

function normalizeOauthConfigured(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function resolveSessionLoadErrorMessage(err, t) {
  const message = String(err?.message || '').trim();
  if (!message) {
    return t('Session konnte nicht geladen werden.', 'Session could not be loaded.');
  }
  if (/api route not found/i.test(message) || message === 'HTTP 404') {
    return t(
      'Dashboard-API auf diesem Host nicht gefunden. Pruefe, ob das Node-Webbackend laeuft und ob das Frontend auf die richtige API-URL zeigt.',
      'Dashboard API was not found on this host. Check that the Node web backend is running and that the frontend points to the correct API URL.',
    );
  }
  if (/failed to fetch/i.test(message)) {
    return t(
      'Dashboard-API ist nicht erreichbar. Pruefe Backend-URL, Port und CORS/Proxy-Konfiguration.',
      'Dashboard API is unreachable. Check backend URL, port, and CORS/proxy configuration.',
    );
  }
  return message;
}

function buildDiscordAvatarUrl(user, size = 160) {
  const userId = String(user?.id || '').trim();
  const avatar = String(user?.avatar || '').trim();
  if (!userId || !avatar) return '';
  const extension = avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${userId}/${avatar}.${extension}?size=${size}`;
}

function buildDiscordGuildIconUrl(guild, size = 160) {
  const guildId = String(guild?.id || '').trim();
  const icon = String(guild?.icon || '').trim();
  if (!guildId || !icon) return '';
  const extension = icon.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.${extension}?size=${size}`;
}

function resolveUserDisplayName(user) {
  return user?.globalName || user?.username || 'Discord User';
}

function StatusPill({ icon: Icon, label, tone = 'neutral', testId }) {
  const tones = {
    neutral: {
      border: 'rgba(148,163,184,0.22)',
      background: 'rgba(15,23,42,0.72)',
      color: '#dbe4ff',
      icon: '#94a3b8',
    },
    brand: {
      border: 'rgba(56,189,248,0.26)',
      background: 'rgba(8,47,73,0.58)',
      color: '#e0f2fe',
      icon: '#38bdf8',
    },
    success: {
      border: 'rgba(52,211,153,0.26)',
      background: 'rgba(6,78,59,0.46)',
      color: '#d1fae5',
      icon: '#34d399',
    },
    premium: {
      border: 'rgba(250,204,21,0.28)',
      background: 'rgba(113,63,18,0.42)',
      color: '#fef3c7',
      icon: '#facc15',
    },
    danger: {
      border: 'rgba(248,113,113,0.28)',
      background: 'rgba(127,29,29,0.32)',
      color: '#fecaca',
      icon: '#f87171',
    },
  };

  const activeTone = tones[tone] || tones.neutral;

  return (
    <span
      data-testid={testId}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        height: 34,
        padding: '0 12px',
        borderRadius: 999,
        border: `1px solid ${activeTone.border}`,
        background: activeTone.background,
        color: activeTone.color,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.03em',
      }}
    >
      {Icon && <Icon size={14} color={activeTone.icon} />}
      {label}
    </span>
  );
}

function DashboardCard({ children, testId, style = {} }) {
  return (
    <div
      data-testid={testId}
      style={{
        border: '1px solid rgba(148,163,184,0.16)',
        background: 'linear-gradient(180deg, rgba(15,23,42,0.88) 0%, rgba(7,10,18,0.96) 100%)',
        boxShadow: '0 26px 70px rgba(2,6,23,0.36)',
        borderRadius: 28,
        overflow: 'hidden',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  variant = 'secondary',
  disabled = false,
  fullWidth = false,
  testId,
  type = 'button',
  style = {},
}) {
  const variants = {
    primary: {
      background: 'linear-gradient(135deg, #5865F2 0%, #22d3ee 130%)',
      color: '#f8fafc',
      border: '1px solid rgba(125,211,252,0.32)',
      boxShadow: '0 18px 50px rgba(59,130,246,0.28)',
    },
    secondary: {
      background: 'rgba(15,23,42,0.84)',
      color: '#f8fafc',
      border: '1px solid rgba(148,163,184,0.22)',
      boxShadow: 'none',
    },
    danger: {
      background: 'rgba(127,29,29,0.38)',
      color: '#fee2e2',
      border: '1px solid rgba(248,113,113,0.28)',
      boxShadow: 'none',
    },
  };

  const activeVariant = variants[variant] || variants.secondary;

  return (
    <button
      type={type}
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      style={{
        height: 46,
        width: fullWidth ? '100%' : 'auto',
        padding: '0 16px',
        borderRadius: 16,
        fontSize: 13,
        fontWeight: 700,
        letterSpacing: '0.03em',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'transform 0.18s ease, border-color 0.18s ease, opacity 0.18s ease',
        ...activeVariant,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

function DashboardShell({ children, sidebar, topbar }) {
  return (
    <div
      data-testid="dashboard-shell"
      style={{
        minHeight: '100vh',
        background: '#030712',
        color: '#fff',
        display: 'grid',
        gridTemplateColumns: '320px 1fr',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          position: 'fixed',
          inset: 0,
          pointerEvents: 'none',
          background: [
            'radial-gradient(circle at top left, rgba(34,211,238,0.12), transparent 30%)',
            'radial-gradient(circle at top right, rgba(88,101,242,0.16), transparent 34%)',
            'radial-gradient(circle at bottom left, rgba(249,115,22,0.10), transparent 28%)',
          ].join(','),
        }}
      />
      <aside
        data-testid="dashboard-sidebar"
        style={{
          borderRight: '1px solid rgba(148,163,184,0.1)',
          background: 'linear-gradient(180deg, rgba(2,6,23,0.96) 0%, rgba(7,10,18,0.94) 100%)',
          padding: 24,
          position: 'sticky',
          top: 0,
          height: '100vh',
          overflowY: 'auto',
          zIndex: 2,
        }}
      >
        {sidebar}
      </aside>

      <main data-testid="dashboard-main" style={{ minWidth: 0, position: 'relative', zIndex: 1 }}>
        <div
          data-testid="dashboard-topbar"
          style={{
            minHeight: 76,
            borderBottom: '1px solid rgba(148,163,184,0.1)',
            background: 'rgba(3,7,18,0.74)',
            backdropFilter: 'blur(18px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '16px 28px',
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
        >
          {topbar}
        </div>

        <div style={{ padding: '28px', display: 'flex', flexDirection: 'column', gap: 20 }}>{children}</div>
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
            border-bottom: 1px solid rgba(148,163,184,0.1);
          }
        }
        @media (max-width: 680px) {
          [data-testid='dashboard-topbar'] {
            padding: 14px 18px !important;
          }
          [data-testid='dashboard-main'] > div:last-child {
            padding: 18px !important;
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
        background: 'linear-gradient(180deg, rgba(15,23,42,0.86) 0%, rgba(7,10,18,0.96) 100%)',
        border: '1px solid rgba(148,163,184,0.16)',
        borderRadius: 24,
        padding: 18,
        minHeight: 144,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        boxShadow: '0 20px 60px rgba(2,6,23,0.28)',
      }}
    >
      <span style={{ fontSize: 11, color: '#94a3b8', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</span>
      <strong
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 34,
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
  const { locale, formatDate } = useI18n();
  const t = useCallback((de, en) => (String(locale || 'de').startsWith('de') ? de : en), [locale]);
  const authError = resolveAuthError();
  const authErrorMessage = useMemo(() => resolveAuthErrorMessage(authError, t), [authError, t]);

  const [loadingSession, setLoadingSession] = useState(true);
  const [session, setSession] = useState(EMPTY_SESSION);
  const [selectedGuildId, setSelectedGuildId] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [loadingData, setLoadingData] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(authErrorMessage);

  const [events, setEvents] = useState([]);
  const [eventCatalog, setEventCatalog] = useState(EMPTY_EVENT_CATALOG);
  const [editingEventId, setEditingEventId] = useState('');
  const [eventForm, setEventForm] = useState(() => createEventForm());

  const [permRoles, setPermRoles] = useState([]);
  const [permsDraft, setPermsDraft] = useState(() => createPermsDraft());

  const [stats, setStats] = useState({ basic: null, advanced: null, tier: 'free' });

  const selectedGuild = useMemo(
    () => (session.guilds || []).find((guild) => guild.id === selectedGuildId) || null,
    [session.guilds, selectedGuildId],
  );
  const enabledGuilds = useMemo(
    () => (session.guilds || []).filter((guild) => guild.dashboardEnabled),
    [session.guilds],
  );
  const lockedGuilds = useMemo(
    () => (session.guilds || []).filter((guild) => !guild.dashboardEnabled),
    [session.guilds],
  );
  const userDisplayName = useMemo(() => resolveUserDisplayName(session.user), [session.user]);
  const userAvatarUrl = useMemo(() => buildDiscordAvatarUrl(session.user, 160), [session.user]);
  const selectedGuildIconUrl = useMemo(() => buildDiscordGuildIconUrl(selectedGuild, 160), [selectedGuild]);

  const dashboardEnabled = Boolean(selectedGuild?.dashboardEnabled);
  const isUltimate = selectedGuild?.tier === 'ultimate';

  const resetEventEditor = useCallback((catalog = null) => {
    setEditingEventId('');
    setEventForm(createEventForm(catalog?.defaultTimeZone || DEFAULT_TIMEZONE));
  }, []);

  const refreshSession = useCallback(async () => {
    setLoadingSession(true);
    try {
      const payload = await apiRequest('/api/auth/session', { method: 'GET' });
      setSession({
        authenticated: payload.authenticated === true,
        oauthConfigured: normalizeOauthConfigured(payload.oauthConfigured),
        user: payload.user || null,
        guilds: Array.isArray(payload.guilds) ? payload.guilds : [],
      });

      const savedGuildId = window.localStorage.getItem('omnifm.dashboard.guildId') || '';
      const guilds = Array.isArray(payload.guilds) ? payload.guilds : [];
      const fallbackGuild = guilds.find((guild) => guild.dashboardEnabled) || guilds[0] || null;
      const selected = guilds.find((guild) => guild.id === savedGuildId) || fallbackGuild;
      setSelectedGuildId(selected?.id || '');
      setError(payload.authenticated === true ? '' : authErrorMessage);
    } catch (err) {
      setError(resolveSessionLoadErrorMessage(err, t));
      setSession(EMPTY_SESSION);
    } finally {
      setLoadingSession(false);
    }
  }, [authErrorMessage, t]);

  useEffect(() => {
    if (!session.authenticated) {
      setError((current) => current || authErrorMessage);
    }
  }, [authErrorMessage, session.authenticated]);

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
      const nextCatalog = normalizeEventCatalog(eventsPayload.catalog);
      setEventCatalog(nextCatalog);
      setPermRoles(Array.isArray(permsPayload.roles) ? permsPayload.roles : []);

      const nextDraft = createPermsDraft();
      PERMISSION_COMMANDS.forEach((command) => {
        nextDraft[command] = normalizePermRule(permsPayload.commandRoleMap?.[command]);
      });
      setPermsDraft(nextDraft);

      setEventForm((current) => (
        editingEventId
          ? current
          : {
            ...current,
            timezone: current.timezone && current.timezone !== DEFAULT_TIMEZONE
              ? current.timezone
              : (nextCatalog.defaultTimeZone || DEFAULT_TIMEZONE),
          }
      ));
    } catch (err) {
      setError(err.message || 'Dashboard-Daten konnten nicht geladen werden.');
    } finally {
      setLoadingData(false);
    }
  }, [selectedGuildId, dashboardEnabled, selectedGuild?.tier, editingEventId]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!selectedGuildId) return;
    window.localStorage.setItem('omnifm.dashboard.guildId', selectedGuildId);
  }, [selectedGuildId]);

  useEffect(() => {
    setEventCatalog(EMPTY_EVENT_CATALOG);
    setPermRoles([]);
    setPermsDraft(createPermsDraft());
    resetEventEditor(EMPTY_EVENT_CATALOG);
  }, [selectedGuildId, resetEventEditor]);

  useEffect(() => {
    if (session.authenticated && selectedGuildId && dashboardEnabled) {
      refreshDashboardData();
    }
  }, [session.authenticated, selectedGuildId, dashboardEnabled, refreshDashboardData]);

  const startDiscordLogin = async () => {
    setError('');
    try {
      const params = new URLSearchParams({ nextPage: 'dashboard' });
      if (typeof window !== 'undefined') {
        params.set('origin', window.location.origin);
        params.set('returnUrl', window.location.href);
      }
      const payload = await apiRequest(`/api/auth/discord/login?${params.toString()}`, { method: 'GET' });
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

  const startEditingEvent = (eventItem) => {
    setEditingEventId(eventItem.id);
    setEventForm(buildEventFormFromEvent(eventItem, eventCatalog.defaultTimeZone || DEFAULT_TIMEZONE));
  };

  const saveEvent = async () => {
    if (!selectedGuildId) return;
    setError('');
    setMessage('');
    try {
      const requestBody = {
        title: eventForm.title,
        stationKey: eventForm.stationKey,
        channelId: eventForm.channelId,
        textChannelId: eventForm.textChannelId,
        startsAt: eventForm.startsAt,
        endsAt: eventForm.endsAt,
        clearEndAt: !eventForm.endsAt,
        clearTextChannel: !eventForm.textChannelId,
        timezone: eventForm.timezone,
        repeat: eventForm.repeat,
        createDiscordEvent: eventForm.createDiscordEvent,
        stageTopic: eventForm.stageTopic,
        message: eventForm.announceMessage,
        description: eventForm.description,
        enabled: eventForm.enabled,
      };
      const path = editingEventId
        ? `/api/dashboard/events/${encodeURIComponent(editingEventId)}?serverId=${encodeURIComponent(selectedGuildId)}`
        : `/api/dashboard/events?serverId=${encodeURIComponent(selectedGuildId)}`;
      const payload = await apiRequest(path, {
        method: editingEventId ? 'PATCH' : 'POST',
        body: JSON.stringify({
          ...requestBody,
        }),
      });
      resetEventEditor(eventCatalog);
      setMessage(payload?.warning
        ? `${t('Event gespeichert.', 'Event saved.')} ${payload.warning}`
        : t(editingEventId ? 'Event aktualisiert.' : 'Event gespeichert.', editingEventId ? 'Event updated.' : 'Event saved.'));
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
      if (editingEventId === eventId) {
        resetEventEditor(eventCatalog);
      }
      setEvents((current) => current.filter((eventItem) => eventItem.id !== eventId));
    } catch (err) {
      setError(err.message || 'Event konnte nicht geloescht werden.');
    }
  };

  const updatePermDraft = (command, field, selectedOptions) => {
    const values = uniqueIds([...selectedOptions].map((option) => option.value));
    setPermsDraft((current) => {
      const currentRule = current[command] || { allowRoleIds: [], denyRoleIds: [] };
      const nextRule = {
        ...currentRule,
        [field]: values,
      };
      if (field === 'allowRoleIds') {
        nextRule.denyRoleIds = nextRule.denyRoleIds.filter((roleId) => !values.includes(roleId));
      }
      if (field === 'denyRoleIds') {
        nextRule.allowRoleIds = nextRule.allowRoleIds.filter((roleId) => !values.includes(roleId));
      }
      return {
        ...current,
        [command]: nextRule,
      };
    });
  };

  const savePerms = async () => {
    if (!selectedGuildId) return;
    setError('');
    setMessage('');
    const commandRoleMap = {};
    Object.entries(permsDraft).forEach(([command, rawRule]) => {
      const allowRoleIds = uniqueIds(rawRule?.allowRoleIds);
      const denyRoleIds = uniqueIds(rawRule?.denyRoleIds).filter((roleId) => !allowRoleIds.includes(roleId));
      commandRoleMap[command] = { allowRoleIds, denyRoleIds };
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
        style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          background: '#030712',
          padding: 24,
        }}
      >
        <DashboardCard
          style={{
            width: 'min(640px, 100%)',
            padding: 32,
            textAlign: 'left',
          }}
        >
          <StatusPill icon={RefreshCw} tone="brand" label={t('Dashboard wird vorbereitet', 'Preparing dashboard')} />
          <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 44, lineHeight: 1.02, marginTop: 18 }}>
            {t('Dashboard laedt...', 'Loading dashboard...')}
          </h1>
          <p style={{ color: '#94a3b8', marginTop: 12, lineHeight: 1.8 }}>
            {t('Session, Server und Berechtigungen werden gerade synchronisiert.', 'Session, guilds, and permissions are being synchronized right now.')}
          </p>
        </DashboardCard>
      </section>
    );
  }

  if (!session.authenticated) {
    const loginHighlights = [
      {
        icon: Radio,
        title: t('Live-Steuerung ohne Chaos', 'Live control without chaos'),
        body: t('Events, Rollenrechte und private Analytics liegen in einer sauberen Steuerzentrale.', 'Events, permissions, and private analytics live in one clean control center.'),
      },
      {
        icon: Activity,
        title: t('Ghost-Bots schneller erkennen', 'Spot ghost bots faster'),
        body: t('Dashboard und Runtime arbeiten auf denselben Serverdaten und Zustaenden.', 'Dashboard and runtime work from the same server state and telemetry.'),
      },
      {
        icon: Sparkles,
        title: t('PRO / Ultimate Fokus', 'Built for PRO / Ultimate'),
        body: t('Nur Server mit passendem Plan sehen die geschuetzten Steuerbereiche.', 'Only eligible servers unlock the protected control areas.'),
      },
    ];

    return (
      <section
        data-testid="dashboard-login-view"
        style={{
          minHeight: '100vh',
          background: '#030712',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
        }}
      >
        <div
          style={{
            width: 'min(1180px, 100%)',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.1fr) minmax(320px, 460px)',
            gap: 20,
            alignItems: 'stretch',
          }}
        >
          <DashboardCard
            style={{
              padding: 36,
              display: 'grid',
              alignContent: 'space-between',
              gap: 24,
              minHeight: 620,
              background: 'linear-gradient(180deg, rgba(15,23,42,0.92) 0%, rgba(8,15,30,0.98) 100%)',
            }}
          >
            <div>
              <StatusPill icon={LayoutDashboard} tone="brand" label="OmniFM Dashboard" />
              <h1 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 58, lineHeight: 0.96, marginTop: 20 }} data-testid="dashboard-login-title">
                {t('Discord Login fuer echte Server-Kontrolle.', 'Discord login for real server control.')}
              </h1>
              <p style={{ color: '#94a3b8', marginTop: 18, lineHeight: 1.85, fontSize: 15 }} data-testid="dashboard-login-description">
                {t(
                  'Melde dich mit deinem Discord-Account an und oeffne das Control-Center fuer Events, Rollenrechte, private Analytics und Server-Status. Zugriff ist fuer PRO und Ultimate freigeschaltet.',
                  'Sign in with your Discord account to open the control center for events, permissions, private analytics, and server health. Access is unlocked for PRO and Ultimate.',
                )}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
              {loginHighlights.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    style={{
                      borderRadius: 22,
                      border: '1px solid rgba(148,163,184,0.16)',
                      background: 'rgba(15,23,42,0.62)',
                      padding: 18,
                      display: 'grid',
                      gap: 10,
                    }}
                  >
                    <div style={{ width: 42, height: 42, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'rgba(34,211,238,0.12)', border: '1px solid rgba(34,211,238,0.18)' }}>
                      <Icon size={18} color="#22d3ee" />
                    </div>
                    <strong style={{ fontSize: 15 }}>{item.title}</strong>
                    <span style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.7 }}>{item.body}</span>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <StatusPill icon={ShieldCheck} tone="success" label={t('Discord OAuth', 'Discord OAuth')} />
              <StatusPill icon={Crown} tone="premium" label={t('PRO / Ultimate Bereiche', 'PRO / Ultimate areas')} />
              <StatusPill icon={Users} tone="neutral" label={t('Server-Auswahl nach Login', 'Server selection after login')} />
            </div>
          </DashboardCard>

          <DashboardCard
            testId="dashboard-login-card"
            style={{
              padding: 28,
              display: 'grid',
              gap: 18,
              alignContent: 'start',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div>
                <div style={{ fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#94a3b8' }}>
                  {t('Sichere Anmeldung', 'Secure sign-in')}
                </div>
                <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 34, lineHeight: 1.02, marginTop: 10 }}>
                  {t('Discord SSO Login', 'Discord SSO Login')}
                </h2>
              </div>
              <div style={{ width: 52, height: 52, borderRadius: 18, display: 'grid', placeItems: 'center', background: 'rgba(88,101,242,0.16)', border: '1px solid rgba(129,140,248,0.28)' }}>
                <Lock size={22} color="#c7d2fe" />
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <StatusPill
                icon={session.oauthConfigured === false ? AlertCircle : ShieldCheck}
                tone={session.oauthConfigured === false ? 'danger' : 'success'}
                label={session.oauthConfigured === false
                  ? t('OAuth fehlt', 'OAuth missing')
                  : t('OAuth bereit', 'OAuth ready')}
              />
              <StatusPill icon={Sparkles} tone="brand" label={t('Events / Stats / Permissions', 'Events / Stats / Permissions')} />
            </div>

            {error && (
              <div
                data-testid="dashboard-login-error"
                style={{
                  color: '#fecaca',
                  border: '1px solid rgba(248,113,113,0.26)',
                  padding: '12px 14px',
                  borderRadius: 18,
                  background: 'rgba(127,29,29,0.28)',
                  lineHeight: 1.7,
                }}
              >
                {error}
              </div>
            )}

            {session.oauthConfigured === false && (
              <div
                data-testid="dashboard-oauth-not-configured"
                style={{
                  color: '#fef3c7',
                  border: '1px solid rgba(250,204,21,0.24)',
                  padding: '12px 14px',
                  borderRadius: 18,
                  background: 'rgba(113,63,18,0.28)',
                  lineHeight: 1.7,
                }}
              >
                {t('Discord OAuth ist noch nicht vollstaendig konfiguriert.', 'Discord OAuth is not fully configured yet.')}
              </div>
            )}

            <div style={{ borderRadius: 22, border: '1px solid rgba(148,163,184,0.14)', background: 'rgba(2,6,23,0.42)', padding: 18, color: '#cbd5e1', lineHeight: 1.75 }}>
              <strong style={{ display: 'block', color: '#f8fafc', marginBottom: 8 }}>{t('Nach dem Login', 'After sign-in')}</strong>
              {t(
                'Du waehlst deinen Discord-Server aus, oeffnest die passenden Tabs und steuerst alles ohne Slash-Command-Chaos direkt im Browser.',
                'Pick your Discord server, open the right tabs, and manage everything from the browser without slash-command chaos.',
              )}
            </div>

            <ActionButton
              testId="dashboard-discord-login-button"
              onClick={startDiscordLogin}
              disabled={session.oauthConfigured === false}
              variant="primary"
              fullWidth
              style={{ marginTop: 4 }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                <Radio size={16} />
                {t('Mit Discord einloggen', 'Continue with Discord')}
              </span>
            </ActionButton>
          </DashboardCard>
        </div>
        <style>{`
          @media (max-width: 980px) {
            [data-testid='dashboard-login-view'] > div {
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>
      </section>
    );
  }

  const sidebar = (
    <>
      <DashboardCard
        testId="dashboard-brand"
        style={{
          padding: 18,
          marginBottom: 18,
          background: 'linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(8,47,73,0.84) 48%, rgba(88,101,242,0.9) 120%)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 46, height: 46, borderRadius: 16, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.15)' }}>
                <Radio size={20} color="#e0f2fe" />
              </div>
              <div>
                <div style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, fontWeight: 700 }}>OmniFM</div>
                <div style={{ color: 'rgba(224,242,254,0.78)', fontSize: 13 }}>{t('Server Control Console', 'Server Control Console')}</div>
              </div>
            </div>
          </div>
          <StatusPill icon={Sparkles} tone="brand" label={t('Control', 'Control')} />
        </div>
      </DashboardCard>

      <DashboardCard
        style={{
          padding: 18,
          marginBottom: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ color: '#94a3b8', fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {t('Server-Zentrale', 'Guild control')}
            </div>
            <strong style={{ display: 'block', marginTop: 8, fontSize: 18 }}>{t('Server auswaehlen', 'Select your guild')}</strong>
          </div>
          <div style={{ position: 'relative', width: 44, height: 44, borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(148,163,184,0.16)', background: 'rgba(15,23,42,0.74)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            {selectedGuildIconUrl ? (
              <img src={selectedGuildIconUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <LayoutDashboard size={18} color="#cbd5e1" />
            )}
          </div>
        </div>

        <label htmlFor="dashboard-guild-select" style={{ display: 'block', color: '#94a3b8', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 8 }}>
          {t('Server auswaehlen', 'Select server')}
        </label>
        <div style={{ position: 'relative' }}>
          <select
            id="dashboard-guild-select"
            data-testid="dashboard-guild-select"
            value={selectedGuildId}
            onChange={(event) => setSelectedGuildId(event.target.value)}
            style={{
              width: '100%',
              background: 'rgba(2,6,23,0.72)',
              color: '#fff',
              border: '1px solid rgba(148,163,184,0.18)',
              height: 52,
              padding: '0 44px 0 14px',
              borderRadius: 16,
              appearance: 'none',
              WebkitAppearance: 'none',
              MozAppearance: 'none',
              fontWeight: 600,
            }}
          >
            {enabledGuilds.length > 0 && (
              <optgroup label={t('Dashboard aktiviert', 'Dashboard enabled')}>
                {enabledGuilds.map((guild) => (
                  <option key={guild.id} value={guild.id}>
                    {guild.name} | {String(guild.tier || 'free').toUpperCase()}
                  </option>
                ))}
              </optgroup>
            )}
            {lockedGuilds.length > 0 && (
              <optgroup label={t('Upgrade erforderlich', 'Upgrade required')}>
                {lockedGuilds.map((guild) => (
                  <option key={guild.id} value={guild.id}>
                    {guild.name} | {String(guild.tier || 'free').toUpperCase()}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          <ChevronDown size={16} color="#94a3b8" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          <StatusPill icon={Crown} tone={selectedGuild?.tier === 'ultimate' ? 'premium' : 'brand'} label={String(selectedGuild?.tier || 'free').toUpperCase()} />
          <StatusPill
            icon={selectedGuild?.dashboardEnabled ? ShieldCheck : Lock}
            tone={selectedGuild?.dashboardEnabled ? 'success' : 'danger'}
            label={selectedGuild?.dashboardEnabled ? t('Dashboard aktiv', 'Dashboard enabled') : t('Upgrade noetig', 'Upgrade required')}
          />
        </div>
      </DashboardCard>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {[
          { key: 'overview', label: t('Uebersicht', 'Overview'), icon: BarChart3 },
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
                borderColor: active ? 'rgba(96,165,250,0.42)' : 'rgba(148,163,184,0.16)',
                background: active
                  ? 'linear-gradient(135deg, rgba(37,99,235,0.26) 0%, rgba(34,211,238,0.18) 100%)'
                  : 'rgba(15,23,42,0.68)',
                color: '#fff',
                minHeight: 54,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '0 14px',
                cursor: 'pointer',
                borderRadius: 18,
                justifyContent: 'space-between',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                <Icon size={16} color={active ? '#7dd3fc' : '#94a3b8'} />
                {entry.label}
              </span>
              {active && <StatusPill icon={Sparkles} tone="brand" label={t('aktiv', 'live')} />}
            </button>
          );
        })}
      </div>

      <DashboardCard
        testId="dashboard-ultimate-promo-box"
        style={{
          marginTop: 22,
          padding: 16,
          background: selectedGuild?.tier === 'ultimate'
            ? 'linear-gradient(135deg, rgba(113,63,18,0.78) 0%, rgba(76,29,149,0.82) 100%)'
            : 'linear-gradient(135deg, rgba(15,23,42,0.9) 0%, rgba(30,41,59,0.88) 100%)',
        }}
      >
        <div style={{ fontSize: 11, color: '#cbd5e1', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          {selectedGuild?.tier === 'ultimate' ? 'Ultimate Active' : 'Ultimate Highlight'}
        </div>
        <div style={{ marginTop: 8, fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>
          {t('YouTube Livestream Playback', 'YouTube livestream playback')}
        </div>
        <div style={{ marginTop: 8, color: '#cbd5e1', fontSize: 13, lineHeight: 1.75 }}>
          {t('In Ultimate kannst du Livestream-Quellen direkt nutzen und mit Reliability-Mode absichern.', 'Ultimate unlocks YouTube live source playback and reliability mode support.')}
        </div>
      </DashboardCard>
    </>
  );

  const topbar = (
    <>
      <div>
        <div data-testid="dashboard-current-guild-name" style={{ fontFamily: "'Outfit', sans-serif", fontSize: 28, lineHeight: 1 }}>
          {selectedGuild?.name || t('Kein Server gewaehlt', 'No server selected')}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
          <StatusPill icon={Crown} tone={selectedGuild?.tier === 'ultimate' ? 'premium' : 'brand'} label={String(selectedGuild?.tier || 'free').toUpperCase()} />
          <StatusPill icon={selectedGuild?.dashboardEnabled ? ShieldCheck : Lock} tone={selectedGuild?.dashboardEnabled ? 'success' : 'danger'} label={selectedGuild?.dashboardEnabled ? t('Dashboard freigeschaltet', 'Dashboard unlocked') : t('Upgrade erforderlich', 'Upgrade required')} />
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <ActionButton
          onClick={refreshDashboardData}
          disabled={!selectedGuildId || !dashboardEnabled || loadingData}
          style={{ minWidth: 118 }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <RefreshCw size={14} />
            {t('Aktualisieren', 'Refresh')}
          </span>
        </ActionButton>
        <div
          data-testid="dashboard-user-chip"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 12,
            padding: '8px 12px 8px 8px',
            borderRadius: 18,
            border: '1px solid rgba(148,163,184,0.16)',
            background: 'rgba(15,23,42,0.72)',
            minWidth: 0,
          }}
        >
          <div style={{ width: 38, height: 38, borderRadius: 14, overflow: 'hidden', flexShrink: 0, background: 'linear-gradient(135deg, rgba(88,101,242,0.55), rgba(34,211,238,0.4))', display: 'grid', placeItems: 'center' }}>
            {userAvatarUrl ? (
              <img src={userAvatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <Users size={16} color="#f8fafc" />
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
              {userDisplayName}
            </div>
            <div style={{ color: '#94a3b8', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
              {session.user?.username || 'discord'}
            </div>
          </div>
        </div>
        <ActionButton
          testId="dashboard-logout-button"
          onClick={logout}
          variant="danger"
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <LogOut size={14} />
            {t('Logout', 'Logout')}
          </span>
        </ActionButton>
      </div>
    </>
  );

  return (
    <DashboardShell sidebar={sidebar} topbar={topbar}>
      {error && (
        <DashboardCard
          testId="dashboard-global-error"
          style={{
            borderRadius: 22,
            border: '1px solid rgba(248,113,113,0.24)',
            background: 'rgba(127,29,29,0.24)',
            padding: '12px 14px',
            color: '#fecaca',
          }}
        >
          {error}
        </DashboardCard>
      )}
      {message && (
        <DashboardCard
          testId="dashboard-global-message"
          style={{
            borderRadius: 22,
            border: '1px solid rgba(52,211,153,0.24)',
            background: 'rgba(6,95,70,0.22)',
            padding: '12px 14px',
            color: '#a7f3d0',
          }}
        >
          {message}
        </DashboardCard>
      )}

      {!dashboardEnabled && (
        <DashboardCard data-testid="dashboard-pro-gate" style={{ padding: 24 }}>
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
              height: 46,
              padding: '0 16px',
              borderRadius: 16,
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.03em',
              background: 'linear-gradient(135deg, #5865F2 0%, #22d3ee 130%)',
              color: '#f8fafc',
              border: '1px solid rgba(125,211,252,0.32)',
              boxShadow: '0 18px 50px rgba(59,130,246,0.28)',
            }}
          >
            <Crown size={14} />
            {t('Zu PRO / Ultimate wechseln', 'Upgrade to PRO / Ultimate')}
          </a>
        </DashboardCard>
      )}

      {dashboardEnabled && (
        <>
          {activeTab === 'overview' && (
            <section data-testid="dashboard-overview-panel" style={{ display: 'grid', gap: 16 }}>
              <DashboardCard style={{ padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                  <div style={{ maxWidth: 720 }}>
                    <StatusPill icon={LayoutDashboard} tone="brand" label={t('Server Overview', 'Server overview')} />
                    <h2 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 36, lineHeight: 1.02, marginTop: 16 }}>
                      {t('Alles Wichtige fuer deinen Radio-Server auf einen Blick.', 'Everything important for your radio server at a glance.')}
                    </h2>
                    <p style={{ color: '#94a3b8', marginTop: 14, lineHeight: 1.8 }}>
                      {t(
                        'Hier siehst du Live-Nutzung, Planstatus und die staerkste Station sofort. Wechsle dann direkt in Events, Rechte oder Analytics.',
                        'See live usage, plan status, and the strongest station instantly, then jump straight into events, permissions, or analytics.',
                      )}
                    </p>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <StatusPill icon={Crown} tone={isUltimate ? 'premium' : 'brand'} label={String(selectedGuild?.tier || 'free').toUpperCase()} />
                    <StatusPill icon={Activity} tone="success" label={`${stats.basic?.activeStreams ?? 0} ${t('aktive Streams', 'active streams')}`} />
                    <StatusPill icon={Users} tone="neutral" label={`${stats.basic?.listenersNow ?? 0} ${t('live', 'live')}`} />
                  </div>
                </div>
              </DashboardCard>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
                <MetricCard testId="dashboard-metric-listeners" label={t('Live Zuhoerer', 'Live listeners')} value={stats.basic?.listenersNow ?? 0} />
                <MetricCard testId="dashboard-metric-streams" label={t('Aktive Streams', 'Active streams')} value={stats.basic?.activeStreams ?? 0} accent="#10B981" />
                <MetricCard testId="dashboard-metric-peak" label={t('Peak Zuhoerer', 'Peak listeners')} value={stats.basic?.peakListeners ?? 0} accent="#8B5CF6" />
                <MetricCard testId="dashboard-metric-top-station" label={t('Top Station', 'Top station')} value={stats.basic?.topStation?.name || '-'} accent="#FFFFFF" />
              </div>
            </section>
          )}

          {activeTab === 'events' && (
            <section data-testid="dashboard-events-panel" style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 420px) 1fr', gap: 14 }}>
              <DashboardCard style={{ padding: 24 }}>
                <StatusPill icon={CalendarDays} tone="brand" label={t('Event Control', 'Event control')} />
                <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 24 }}>
                  {editingEventId ? t('Event bearbeiten', 'Edit event') : t('Neues Event', 'Create event')}
                </h3>
                <p style={{ color: '#94a3b8', marginTop: 10, lineHeight: 1.8 }}>
                  {t(
                    'Dashboard nutzt jetzt dieselben Kernoptionen wie `/event`: Station, Voice/Stage-Channel, Start, Ende, Repeat, Text-Ankuendigung, Discord-Server-Event, Stage-Topic und Nachricht.',
                    'The dashboard now exposes the same core event options as `/event`: station, voice/stage channel, start, end, repeat, text announcement, Discord server event, stage topic, and message.',
                  )}
                </p>
                <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
                  <input
                    data-testid="dashboard-event-title-input"
                    value={eventForm.title}
                    onChange={(event) => setEventForm((current) => ({ ...current, title: event.target.value }))}
                    placeholder={t('Titel', 'Title')}
                    style={DASHBOARD_CONTROL_STYLE}
                  />

                  <select
                    data-testid="dashboard-event-station-input"
                    value={eventForm.stationKey}
                    onChange={(event) => setEventForm((current) => ({ ...current, stationKey: event.target.value }))}
                    style={DASHBOARD_CONTROL_STYLE}
                  >
                    <option value="">{t('Station auswaehlen', 'Select station')}</option>
                    {(eventCatalog.stations || []).map((station) => (
                      <option key={station.key} value={station.key}>{station.label || station.name || station.key}</option>
                    ))}
                  </select>

                  <select
                    data-testid="dashboard-event-channel-input"
                    value={eventForm.channelId}
                    onChange={(event) => setEventForm((current) => ({ ...current, channelId: event.target.value }))}
                    style={DASHBOARD_CONTROL_STYLE}
                  >
                    <option value="">{t('Voice/Stage-Channel auswaehlen', 'Select voice/stage channel')}</option>
                    {(eventCatalog.voiceChannels || []).map((channel) => (
                      <option key={channel.id} value={channel.id}>{channel.label || channel.name || channel.id}</option>
                    ))}
                  </select>

                  <select
                    data-testid="dashboard-event-text-channel-select"
                    value={eventForm.textChannelId}
                    onChange={(event) => setEventForm((current) => ({ ...current, textChannelId: event.target.value }))}
                    style={DASHBOARD_CONTROL_STYLE}
                  >
                    <option value="">{t('Kein Text-Channel', 'No text channel')}</option>
                    {(eventCatalog.textChannels || []).map((channel) => (
                      <option key={channel.id} value={channel.id}>{channel.label || channel.name || channel.id}</option>
                    ))}
                  </select>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <input
                      data-testid="dashboard-event-starts-at-input"
                      type="datetime-local"
                      value={eventForm.startsAt}
                      onChange={(event) => setEventForm((current) => ({ ...current, startsAt: event.target.value }))}
                      style={DASHBOARD_CONTROL_STYLE}
                    />
                    <input
                      data-testid="dashboard-event-ends-at-input"
                      type="datetime-local"
                      value={eventForm.endsAt}
                      onChange={(event) => setEventForm((current) => ({ ...current, endsAt: event.target.value }))}
                      style={DASHBOARD_CONTROL_STYLE}
                    />
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <select
                      data-testid="dashboard-event-timezone-select"
                      value={eventForm.timezone}
                      onChange={(event) => setEventForm((current) => ({ ...current, timezone: event.target.value }))}
                      style={DASHBOARD_CONTROL_STYLE}
                    >
                      {(eventCatalog.timeZones || []).map((item) => (
                        <option key={item.value} value={item.value}>{item.label || item.value}</option>
                      ))}
                    </select>

                    <select
                      data-testid="dashboard-event-repeat-select"
                      value={eventForm.repeat}
                      onChange={(event) => setEventForm((current) => ({ ...current, repeat: event.target.value }))}
                      style={DASHBOARD_CONTROL_STYLE}
                    >
                      {(eventCatalog.repeatModes || []).map((item) => (
                        <option key={item.value} value={item.value}>
                          {String(locale || 'de').startsWith('de') ? (item.label || item.value) : (item.labelEn || item.label || item.value)}
                        </option>
                      ))}
                    </select>
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#E4E4E7' }}>
                    <input
                      data-testid="dashboard-event-serverevent-toggle"
                      type="checkbox"
                      checked={eventForm.createDiscordEvent}
                      onChange={(event) => setEventForm((current) => ({ ...current, createDiscordEvent: event.target.checked }))}
                    />
                    {t('Discord-Server-Event automatisch anlegen', 'Create Discord server event automatically')}
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#E4E4E7' }}>
                    <input
                      data-testid="dashboard-event-enabled-toggle"
                      type="checkbox"
                      checked={eventForm.enabled}
                      onChange={(event) => setEventForm((current) => ({ ...current, enabled: event.target.checked }))}
                    />
                    {t('Event aktiviert', 'Event enabled')}
                  </label>

                  <input
                    data-testid="dashboard-event-stage-topic-input"
                    value={eventForm.stageTopic}
                    onChange={(event) => setEventForm((current) => ({ ...current, stageTopic: event.target.value }))}
                    placeholder={t('Stage-Thema (nur Stage-Channel)', 'Stage topic (stage channels only)')}
                    style={DASHBOARD_CONTROL_STYLE}
                  />

                  <textarea
                    data-testid="dashboard-event-message-input"
                    value={eventForm.announceMessage}
                    onChange={(event) => setEventForm((current) => ({ ...current, announceMessage: event.target.value }))}
                    placeholder={t('Ankuendigungsnachricht', 'Announcement message')}
                    rows={4}
                    style={DASHBOARD_TEXTAREA_STYLE}
                  />

                  <textarea
                    data-testid="dashboard-event-description-input"
                    value={eventForm.description}
                    onChange={(event) => setEventForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder={t('Beschreibung fuer Discord-Server-Event', 'Description for Discord server event')}
                    rows={4}
                    style={DASHBOARD_TEXTAREA_STYLE}
                  />

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <ActionButton
                      data-testid="dashboard-event-create-button"
                      onClick={saveEvent}
                      variant="primary"
                    >
                      {editingEventId ? t('Event aktualisieren', 'Update event') : t('Event speichern', 'Save event')}
                    </ActionButton>
                    {editingEventId && (
                      <ActionButton
                        data-testid="dashboard-event-cancel-button"
                        onClick={() => resetEventEditor(eventCatalog)}
                        variant="secondary"
                      >
                        {t('Abbrechen', 'Cancel')}
                      </ActionButton>
                    )}
                  </div>

                  {(eventCatalog.voiceChannels || []).length === 0 && (
                    <div style={{ color: '#fef3c7', fontSize: 13, borderRadius: 18, border: '1px solid rgba(250,204,21,0.24)', background: 'rgba(113,63,18,0.24)', padding: '12px 14px' }}>
                      {t('Noch keine Voice- oder Stage-Channels vom Server geladen.', 'No voice or stage channels could be loaded from the server yet.')}
                    </div>
                  )}
                </div>
              </DashboardCard>

              <DashboardCard style={{ padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div>
                    <StatusPill icon={Activity} tone="neutral" label={t('Aktive Events', 'Active events')} />
                    <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 24, marginTop: 12 }}>{t('Aktive Events', 'Active events')}</h3>
                  </div>
                  <StatusPill icon={Sparkles} tone="brand" label={`${events.length} ${t('Eintraege', 'entries')}`} />
                </div>
                <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
                  {events.length === 0 && (
                    <div
                      data-testid="dashboard-events-empty"
                      style={{ color: '#94a3b8', borderRadius: 22, border: '1px solid rgba(148,163,184,0.16)', background: 'rgba(2,6,23,0.46)', padding: 18 }}
                    >
                      {t('Keine Events vorhanden.', 'No events yet.')}
                    </div>
                  )}
                  {events.map((eventItem) => (
                    <div
                      key={eventItem.id}
                      data-testid={`dashboard-event-item-${eventItem.id}`}
                      style={{
                        border: '1px solid rgba(148,163,184,0.14)',
                        borderRadius: 24,
                        padding: 16,
                        background: 'rgba(2,6,23,0.5)',
                        display: 'grid',
                        gap: 12,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                        <div>
                          <strong>{eventItem.title || '-'}</strong>
                          <div style={{ color: '#64748b', fontSize: 12, marginTop: 4, fontFamily: "'JetBrains Mono', monospace" }}>{eventItem.id}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          <ActionButton
                            data-testid={`dashboard-event-edit-${eventItem.id}`}
                            onClick={() => startEditingEvent(eventItem)}
                            variant="secondary"
                            style={{ height: 34, padding: '0 12px', borderRadius: 12, fontSize: 12 }}
                          >
                            {t('Bearbeiten', 'Edit')}
                          </ActionButton>
                          <ActionButton
                            data-testid={`dashboard-event-toggle-${eventItem.id}`}
                            onClick={() => toggleEvent(eventItem.id, !eventItem.enabled)}
                            variant="secondary"
                            style={{
                              height: 34,
                              padding: '0 12px',
                              borderRadius: 12,
                              fontSize: 12,
                              border: eventItem.enabled ? '1px solid rgba(52,211,153,0.28)' : '1px solid rgba(148,163,184,0.18)',
                              background: eventItem.enabled ? 'rgba(6,78,59,0.42)' : 'rgba(15,23,42,0.84)',
                              color: eventItem.enabled ? '#d1fae5' : '#f8fafc',
                            }}
                          >
                            {eventItem.enabled ? t('Aktiv', 'Enabled') : t('Inaktiv', 'Disabled')}
                          </ActionButton>
                          <ActionButton
                            data-testid={`dashboard-event-delete-${eventItem.id}`}
                            onClick={() => deleteEvent(eventItem.id)}
                            variant="danger"
                            style={{ height: 34, padding: '0 12px', borderRadius: 12, fontSize: 12 }}
                          >
                            {t('Loeschen', 'Delete')}
                          </ActionButton>
                        </div>
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: 13, display: 'grid', gap: 6, lineHeight: 1.7 }}>
                        <div>{t('Station', 'Station')}: <strong>{eventItem.stationName || eventItem.stationKey || '-'}</strong></div>
                        <div>{t('Voice/Stage', 'Voice/stage')}: {eventItem.channelName || eventItem.channelId || '-'}</div>
                        <div>{t('Text-Channel', 'Text channel')}: {eventItem.textChannelName || eventItem.textChannelId || '-'}</div>
                        <div>
                          {t('Start', 'Start')}: {eventItem.startsAt ? formatDate(eventItem.startsAt, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                          {' | '}
                          {t('Ende', 'End')}: {eventItem.endsAt ? formatDate(eventItem.endsAt, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                        </div>
                        <div>
                          {t('Repeat', 'Repeat')}: {eventItem.repeatLabel || eventItem.repeat || 'none'}
                          {' | '}
                          {t('Discord-Server-Event', 'Discord server event')}: {eventItem.createDiscordEvent ? t('Ja', 'Yes') : t('Nein', 'No')}
                        </div>
                        {(eventItem.stageTopic || eventItem.announceMessage || eventItem.description) && (
                          <div style={{ color: '#e2e8f0' }}>
                            {eventItem.stageTopic && <span>{t('Stage-Thema', 'Stage topic')}: {eventItem.stageTopic} </span>}
                            {eventItem.announceMessage && <span>{t('Nachricht', 'Message')}: {eventItem.announceMessage} </span>}
                            {eventItem.description && <span>{t('Beschreibung', 'Description')}: {eventItem.description}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </DashboardCard>
              <style>{`
                @media (max-width: 980px) {
                  [data-testid='dashboard-events-panel'] { grid-template-columns: 1fr !important; }
                }
              `}</style>
            </section>
          )}

          {activeTab === 'perms' && (
            <DashboardCard testId="dashboard-perms-panel" style={{ padding: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ maxWidth: 760 }}>
                  <StatusPill icon={ShieldCheck} tone="brand" label={t('Permissions Matrix', 'Permissions matrix')} />
                  <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 24, marginTop: 12 }}>{t('Rollenrechte pro Command', 'Role permissions by command')}</h3>
                  <p style={{ color: '#94a3b8', marginTop: 10, lineHeight: 1.8 }}>
                    {t('Die Rollen werden direkt vom Discord-Server geladen. Allow gibt Zugriff, Deny sperrt den Command explizit und ueberschreibt Allow.', 'Roles are loaded directly from the Discord server. Allow grants access, Deny blocks the command explicitly and overrides Allow.')}
                  </p>
                </div>
                <StatusPill icon={Users} tone="neutral" label={`${permRoles.length} ${t('Rollen', 'roles')}`} />
              </div>

              <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
                {PERMISSION_COMMANDS.map((command) => (
                  <div
                    key={command}
                    data-testid={`dashboard-perm-row-${command}`}
                    style={{
                      display: 'grid',
                      gap: 10,
                      border: '1px solid rgba(148,163,184,0.14)',
                      borderRadius: 22,
                      background: 'rgba(2,6,23,0.46)',
                      padding: 14,
                    }}
                  >
                    <span style={{ color: '#94a3b8', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>/{command}</span>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span style={{ color: '#e2e8f0', fontSize: 12 }}>{t('Allow', 'Allow')}</span>
                      <select
                        multiple
                        size={Math.min(Math.max(4, permRoles.length || 4), 8)}
                        data-testid={`dashboard-perm-allow-${command}`}
                        value={permsDraft[command]?.allowRoleIds || []}
                        onChange={(event) => updatePermDraft(command, 'allowRoleIds', event.target.selectedOptions)}
                        style={{ ...DASHBOARD_TEXTAREA_STYLE, padding: 10, minHeight: 132 }}
                      >
                        {permRoles.map((role) => (
                          <option key={`${command}-allow-${role.id}`} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label style={{ display: 'grid', gap: 6 }}>
                      <span style={{ color: '#e2e8f0', fontSize: 12 }}>{t('Deny', 'Deny')}</span>
                      <select
                        multiple
                        size={Math.min(Math.max(4, permRoles.length || 4), 8)}
                        data-testid={`dashboard-perm-deny-${command}`}
                        value={permsDraft[command]?.denyRoleIds || []}
                        onChange={(event) => updatePermDraft(command, 'denyRoleIds', event.target.selectedOptions)}
                        style={{ ...DASHBOARD_TEXTAREA_STYLE, padding: 10, minHeight: 132 }}
                      >
                        {permRoles.map((role) => (
                          <option key={`${command}-deny-${role.id}`} value={role.id}>
                            {role.name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.7 }}>
                      {t('Allow', 'Allow')}: {resolveRoleNames(permsDraft[command]?.allowRoleIds, permRoles)}
                      <br />
                      {t('Deny', 'Deny')}: {resolveRoleNames(permsDraft[command]?.denyRoleIds, permRoles)}
                    </div>
                  </div>
                ))}
              </div>

              {permRoles.length === 0 && (
                <div style={{ marginTop: 12, color: '#fef3c7', borderRadius: 18, border: '1px solid rgba(250,204,21,0.24)', background: 'rgba(113,63,18,0.24)', padding: '12px 14px' }}>
                  {t('Es konnten noch keine Rollen vom Server geladen werden.', 'No guild roles could be loaded yet.')}
                </div>
              )}

              <ActionButton
                data-testid="dashboard-perms-save-button"
                onClick={savePerms}
                variant="primary"
                style={{ marginTop: 18 }}
              >
                {t('Berechtigungen speichern', 'Save permissions')}
              </ActionButton>
            </DashboardCard>
          )}

          {activeTab === 'stats' && (
            <section data-testid="dashboard-stats-panel" style={{ display: 'grid', gap: 12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <MetricCard testId="dashboard-stats-listeners-now" label={t('Live Zuhoerer', 'Live listeners')} value={stats.basic?.listenersNow ?? 0} />
                <MetricCard testId="dashboard-stats-active-streams" label={t('Aktive Streams', 'Active streams')} value={stats.basic?.activeStreams ?? 0} accent="#10B981" />
                <MetricCard testId="dashboard-stats-listener-hours" label={t('Hoerstunden gesamt', 'Total listener hours')} value={stats.basic?.listenerHours ?? 0} accent="#F59E0B" />
                <MetricCard testId="dashboard-stats-active-hours" label={t('Voice aktiv', 'Voice active')} value={stats.basic?.activeHours ?? 0} accent="#14B8A6" />
                <MetricCard testId="dashboard-stats-stations-ever" label={t('Sender jemals', 'Stations ever')} value={stats.basic?.uniqueStations ?? 0} accent="#FFFFFF" />
                <MetricCard testId="dashboard-stats-peak-time" label={t('Peak Zeit', 'Peak time')} value={stats.basic?.peakTime || '-'} accent="#8B5CF6" />
                <MetricCard testId="dashboard-stats-top-station" label={t('Top Station', 'Top station')} value={stats.basic?.topStation?.name || '-'} accent="#FFFFFF" />
              </div>

              <DashboardCard style={{ padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <StatusPill icon={Activity} tone="brand" label={t('Analysefenster', 'Analytics window')} />
                    <strong style={{ display: 'block', marginTop: 12, fontSize: 20 }}>{t('Analysefenster', 'Analytics window')}</strong>
                  </div>
                  <span style={{ color: '#94a3b8' }}>{stats.basic?.retentionDays || 0} {t('Tage', 'days')}</span>
                </div>
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                  <div style={{ border: '1px solid rgba(148,163,184,0.14)', borderRadius: 20, background: 'rgba(2,6,23,0.46)', padding: 14 }}>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Starts im Fenster', 'Starts in window')}</div>
                    <strong>{stats.basic?.windowSummary?.starts ?? 0}</strong>
                  </div>
                  <div style={{ border: '1px solid rgba(148,163,184,0.14)', borderRadius: 20, background: 'rgba(2,6,23,0.46)', padding: 14 }}>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Hoerstunden im Fenster', 'Listener hours in window')}</div>
                    <strong>{stats.basic?.windowSummary?.listenerHours ?? 0}</strong>
                  </div>
                  <div style={{ border: '1px solid rgba(148,163,184,0.14)', borderRadius: 20, background: 'rgba(2,6,23,0.46)', padding: 14 }}>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Voice aktiv im Fenster', 'Voice active in window')}</div>
                    <strong>{stats.basic?.windowSummary?.activeHours ?? 0}</strong>
                  </div>
                  <div style={{ border: '1px solid rgba(148,163,184,0.14)', borderRadius: 20, background: 'rgba(2,6,23,0.46)', padding: 14 }}>
                    <div style={{ color: '#94a3b8', fontSize: 12 }}>{t('Peak im Fenster', 'Peak in window')}</div>
                    <strong>{stats.basic?.windowSummary?.peakListeners ?? 0}</strong>
                  </div>
                </div>
              </DashboardCard>

              {!isUltimate && (
                <DashboardCard
                  testId="dashboard-stats-ultimate-upsell"
                  style={{ padding: 22, background: 'linear-gradient(135deg, rgba(15,23,42,0.95) 0%, rgba(88,28,135,0.72) 120%)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Crown size={18} color="#8B5CF6" />
                    <strong>{t('Ultimate Analytics', 'Ultimate analytics')}</strong>
                  </div>
                  <p style={{ color: '#e9d5ff', marginTop: 8, lineHeight: 1.8 }}>
                    {t('PRO zeigt jetzt bereits Hoerstunden, Trendfenster und Top-Sender. Ultimate schaltet das komplette Sender-Archiv und die staerksten Tage frei.', 'PRO already shows listener hours, trend windows, and top stations. Ultimate unlocks the complete station archive and strongest days.')}
                  </p>
                </DashboardCard>
              )}

              <DashboardCard testId="dashboard-stats-advanced" style={{ padding: 24, display: 'grid', gap: 12 }}>
                <div style={{ border: '1px solid rgba(148,163,184,0.14)', borderRadius: 22, background: 'rgba(2,6,23,0.46)', padding: 18 }}>
                  <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Listener pro Channel', 'Listeners by channel')}</h4>
                  <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                    {(stats.advanced?.listenersByChannel || []).length === 0 && <div data-testid="dashboard-advanced-channels-empty" style={{ color: '#94a3b8' }}>{t('Keine Channel-Daten.', 'No channel data yet.')}</div>}
                    {(stats.advanced?.listenersByChannel || []).map((item, index) => (
                      <div key={`${item.name}-${index}`} data-testid={`dashboard-advanced-channel-row-${index}`} style={{ border: '1px solid rgba(148,163,184,0.12)', borderRadius: 18, background: 'rgba(15,23,42,0.82)', padding: '10px 12px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                        <span>{item.name}</span>
                        <span style={{ color: '#94a3b8' }}>{t('Jetzt', 'Now')}: <strong>{item.listenersCurrent ?? item.listeners ?? 0}</strong></span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{item.listenerHours ?? 0}h</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ border: '1px solid rgba(148,163,184,0.14)', borderRadius: 22, background: 'rgba(2,6,23,0.46)', padding: 18 }}>
                  <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Top Stationen', 'Top stations')}</h4>
                  <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                    {(stats.advanced?.stationBreakdown || []).length === 0 && <div data-testid="dashboard-advanced-stations-empty" style={{ color: '#94a3b8' }}>{t('Keine Stationsdaten.', 'No station data yet.')}</div>}
                    {(stats.advanced?.stationBreakdown || []).map((item, index) => (
                      <div key={`${item.name}-${index}`} data-testid={`dashboard-advanced-station-row-${index}`} style={{ border: '1px solid rgba(148,163,184,0.12)', borderRadius: 18, background: 'rgba(15,23,42,0.82)', padding: '10px 12px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                        <span>{item.name}</span>
                        <span>{t('Starts', 'Starts')}: <strong>{item.starts ?? 0}</strong></span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{item.listenerHours ?? 0}h</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div style={{ border: '1px solid rgba(148,163,184,0.14)', borderRadius: 22, background: 'rgba(2,6,23,0.46)', padding: 18 }}>
                  <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Tagesreport', 'Daily report')}</h4>
                  <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                    {(stats.advanced?.dailyReport || []).length === 0 && <div data-testid="dashboard-advanced-daily-empty" style={{ color: '#94a3b8' }}>{t('Keine Tagesdaten.', 'No daily data yet.')}</div>}
                    {(stats.advanced?.dailyReport || []).map((item, index) => (
                      <div key={`${item.day}-${index}`} data-testid={`dashboard-advanced-daily-row-${index}`} style={{ border: '1px solid rgba(148,163,184,0.12)', borderRadius: 18, background: 'rgba(15,23,42,0.82)', padding: '10px 12px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
                        <span>{item.day}</span>
                        <span>{t('Starts', 'Starts')}: <strong>{item.starts}</strong></span>
                        <span>{t('Peak', 'Peak')}: <strong>{item.peakListeners}</strong></span>
                        <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{item.listenerHours ?? 0}h</span>
                      </div>
                    ))}
                  </div>
                </div>

                {isUltimate && (
                  <>
                    <div style={{ border: '1px solid rgba(148,163,184,0.14)', borderRadius: 22, background: 'rgba(2,6,23,0.46)', padding: 18 }}>
                      <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Staerkste Tage', 'Strongest days')}</h4>
                      <div style={{ marginTop: 8, display: 'grid', gap: 6 }}>
                        {(stats.advanced?.topDays || []).length === 0 && <div data-testid="dashboard-advanced-topdays-empty" style={{ color: '#94a3b8' }}>{t('Keine Tages-Peaks.', 'No top days yet.')}</div>}
                        {(stats.advanced?.topDays || []).map((item, index) => (
                          <div key={`${item.day}-top-${index}`} data-testid={`dashboard-advanced-topday-row-${index}`} style={{ border: '1px solid rgba(148,163,184,0.12)', borderRadius: 18, background: 'rgba(15,23,42,0.82)', padding: '10px 12px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12 }}>
                            <span>{item.day}</span>
                            <span>{t('Starts', 'Starts')}: <strong>{item.starts}</strong></span>
                            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{item.listenerHours ?? 0}h</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div style={{ border: '1px solid rgba(148,163,184,0.14)', borderRadius: 22, background: 'rgba(2,6,23,0.46)', padding: 18 }}>
                      <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Alle Sender jemals', 'All stations ever')}</h4>
                      <div style={{ marginTop: 8, display: 'grid', gap: 6, maxHeight: 420, overflowY: 'auto' }}>
                        {(stats.advanced?.allStations || []).length === 0 && <div data-testid="dashboard-advanced-allstations-empty" style={{ color: '#94a3b8' }}>{t('Noch keine Lifetime-Stationen.', 'No lifetime stations yet.')}</div>}
                        {(stats.advanced?.allStations || []).map((item, index) => (
                          <div key={`${item.name}-all-${index}`} data-testid={`dashboard-advanced-allstation-row-${index}`} style={{ border: '1px solid rgba(148,163,184,0.12)', borderRadius: 18, background: 'rgba(15,23,42,0.82)', padding: '10px 12px', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                            <span>{item.name}</span>
                            <span>{t('Starts', 'Starts')}: <strong>{item.starts}</strong></span>
                            <span>{t('Peak', 'Peak')}: <strong>{item.peakListeners}</strong></span>
                            <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{item.listenerHours ?? 0}h</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </DashboardCard>
            </section>
          )}

          {loadingData && (
            <div data-testid="dashboard-loading-state" style={{ color: '#A1A1AA' }}>
              {t('Daten werden aktualisiert...', 'Refreshing dashboard data...')}
            </div>
          )}
        </>
      )}
    </DashboardShell>
  );
}
