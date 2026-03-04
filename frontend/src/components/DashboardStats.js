import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area,
} from 'recharts';
import { RotateCcw } from 'lucide-react';

const DAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatMs(ms) {
  if (!ms || ms <= 0) return '0m';
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#18181B', border: '1px solid #27272A', padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: '#A1A1AA', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#fff' }}>{p.name}: <strong>{p.value}</strong></div>
      ))}
    </div>
  );
}

function Section({ title, testId, children }) {
  return (
    <div data-testid={testId} style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
      <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, color: '#D4D4D8', marginBottom: 12 }}>{title}</h4>
      {children}
    </div>
  );
}

export default function DashboardStatsPanel({ stats, detailStats, t, formatDate, onResetStats }) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const basic = stats?.basic || {};
  const detail = detailStats || {};
  const isDE = t('de', 'en') === 'de';
  const dayNames = isDE ? DAYS_DE : DAYS_EN;

  const handleReset = async () => {
    setResetting(true);
    try {
      if (onResetStats) await onResetStats();
    } finally {
      setResetting(false);
      setShowResetConfirm(false);
    }
  };

  const ls = detail.listeningStats || {};

  // Station listening time ranking
  const stationTimeData = Object.entries(ls.stationListeningMs || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, ms]) => ({
      name: (ls.stationNames?.[key] || key).length > 22 ? (ls.stationNames?.[key] || key).slice(0, 20) + '..' : (ls.stationNames?.[key] || key),
      hours: Math.round(ms / 3600000 * 10) / 10,
    }));

  // Command usage ranking
  const commandData = Object.entries(ls.commands || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([cmd, count]) => ({ name: `/${cmd}`, count }));

  // Daily stats trend
  const dailyData = (detail.dailyStats || []).slice().reverse().map(d => ({
    date: d.date?.slice(5) || '',
    starts: d.totalStarts || 0,
    sessions: d.totalSessions || 0,
    hours: Math.round((d.totalListeningMs || 0) / 3600000 * 10) / 10,
    peak: d.peakListeners || 0,
  }));

  // Listener timeline
  const timelineData = (detail.listenerTimeline || []).map(s => ({
    time: new Date(s.timestamp).toLocaleTimeString(isDE ? 'de-DE' : 'en-US', { hour: '2-digit', minute: '2-digit' }),
    listeners: s.listeners || 0,
  }));

  // Session history
  const sessionHistory = (detail.sessionHistory || []).slice(0, 15);

  // Connection health
  const connHealth = detail.connectionHealth || {};

  // Voice channel usage
  const channelData = Object.entries(ls.voiceChannels || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([id, count]) => ({ id, count }));

  // Hourly heatmap data
  const hoursMap = ls.hours || {};
  const dowMap = ls.daysOfWeek || {};

  return (
    <section data-testid="dashboard-stats-detail-panel" style={{ display: 'grid', gap: 12 }}>
      {/* Stats Reset */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        {!showResetConfirm ? (
          <button
            data-testid="stats-reset-btn"
            onClick={() => setShowResetConfirm(true)}
            style={{
              border: '1px solid #27272A', background: 'transparent', color: '#71717A',
              padding: '6px 14px', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#EF4444'; e.currentTarget.style.color = '#EF4444'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#27272A'; e.currentTarget.style.color = '#71717A'; }}
          >
            <RotateCcw size={13} />
            {t('Statistiken zurücksetzen', 'Reset statistics')}
          </button>
        ) : (
          <div data-testid="stats-reset-confirm" style={{
            display: 'flex', alignItems: 'center', gap: 10, background: '#1A0505', border: '1px solid #7F1D1D',
            padding: '8px 14px',
          }}>
            <span style={{ fontSize: 12, color: '#FCA5A5' }}>
              {t('Alle Statistiken für diesen Server unwiderruflich löschen?', 'Permanently delete all statistics for this server?')}
            </span>
            <button
              data-testid="stats-reset-confirm-yes"
              onClick={handleReset}
              disabled={resetting}
              style={{
                border: '1px solid #EF4444', background: '#EF4444', color: '#fff',
                padding: '4px 12px', cursor: resetting ? 'wait' : 'pointer', fontSize: 12, fontWeight: 600,
                opacity: resetting ? 0.6 : 1,
              }}
            >
              {resetting ? t('Lösche...', 'Deleting...') : t('Ja, löschen', 'Yes, delete')}
            </button>
            <button
              data-testid="stats-reset-confirm-no"
              onClick={() => setShowResetConfirm(false)}
              style={{
                border: '1px solid #27272A', background: 'transparent', color: '#A1A1AA',
                padding: '4px 12px', cursor: 'pointer', fontSize: 12,
              }}
            >
              {t('Abbrechen', 'Cancel')}
            </button>
          </div>
        )}
      </div>

      {/* Daily listening hours trend */}
      {dailyData.length > 0 && (
        <Section title={t('Hörzeit-Verlauf (Tage)', 'Listening hours trend (days)')} testId="stats-daily-hours">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="gradHours" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: '#52525B', fontSize: 10 }} />
              <YAxis tick={{ fill: '#52525B', fontSize: 10 }} width={35} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="hours" stroke="#10B981" fill="url(#gradHours)" name={t('Stunden', 'Hours')} />
              <Line type="monotone" dataKey="peak" stroke="#8B5CF6" strokeWidth={1.5} dot={false} name="Peak" />
            </AreaChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* Station listening time ranking */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10 }}>
        {stationTimeData.length > 0 && (
          <Section title={t('Hörzeit pro Station', 'Listening time per station')} testId="stats-station-time">
            <ResponsiveContainer width="100%" height={Math.max(180, stationTimeData.length * 30)}>
              <BarChart data={stationTimeData} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" tick={{ fill: '#52525B', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#A1A1AA', fontSize: 11 }} width={120} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="hours" fill="#F59E0B" radius={[0, 2, 2, 0]} name={t('Stunden', 'Hours')} />
              </BarChart>
            </ResponsiveContainer>
          </Section>
        )}

        {/* Command usage */}
        {commandData.length > 0 && (
          <Section title={t('Command-Nutzung', 'Command usage')} testId="stats-command-usage">
            <ResponsiveContainer width="100%" height={Math.max(180, commandData.length * 30)}>
              <BarChart data={commandData} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" tick={{ fill: '#52525B', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#A1A1AA', fontSize: 11 }} width={80} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" fill="#06B6D4" radius={[0, 2, 2, 0]} name={t('Aufrufe', 'Calls')} />
              </BarChart>
            </ResponsiveContainer>
          </Section>
        )}
      </div>

      {/* Listener timeline (24h) */}
      {timelineData.length > 0 && (
        <Section title={t('Zuhörer-Verlauf (24h)', 'Listener timeline (24h)')} testId="stats-listener-timeline">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={timelineData}>
              <XAxis dataKey="time" tick={{ fill: '#52525B', fontSize: 10 }} interval={Math.max(1, Math.floor(timelineData.length / 12))} />
              <YAxis tick={{ fill: '#52525B', fontSize: 10 }} width={30} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="listeners" stroke="#00F0FF" strokeWidth={2} dot={false} name={t('Zuhörer', 'Listeners')} />
            </LineChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* Session history table */}
      {sessionHistory.length > 0 && (
        <Section title={t('Letzte Sessions', 'Recent sessions')} testId="stats-session-history">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1A1A2E' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', color: '#71717A', fontWeight: 500 }}>{t('Station', 'Station')}</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px', color: '#71717A', fontWeight: 500 }}>{t('Start', 'Start')}</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: '#71717A', fontWeight: 500 }}>{t('Hörzeit', 'Listening')}</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: '#71717A', fontWeight: 500 }}>{t('Dauer', 'Runtime')}</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: '#71717A', fontWeight: 500 }}>Peak</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: '#71717A', fontWeight: 500 }}>Avg</th>
                </tr>
              </thead>
              <tbody>
                {sessionHistory.map((s, i) => (
                  <tr key={i} data-testid={`session-row-${i}`} style={{ borderBottom: '1px solid #0F0F1A' }}>
                    <td style={{ padding: '8px 6px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.stationName || s.stationKey || '-'}
                    </td>
                    <td style={{ padding: '8px 6px', color: '#A1A1AA' }}>
                      {s.startedAt ? formatDate(s.startedAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                      {formatMs(s.humanListeningMs)}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                      {formatMs(s.durationMs)}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: '#8B5CF6' }}>{s.peakListeners ?? '-'}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: '#71717A' }}>{s.avgListeners ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Connection health */}
      <Section title={t('Verbindungsgesundheit (7 Tage)', 'Connection health (7 days)')} testId="stats-connection-health">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
          <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px', textAlign: 'center' }}>
            <div style={{ color: '#71717A', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('Verbindungen', 'Connects')}</div>
            <strong style={{ fontSize: 24, color: '#10B981' }}>{connHealth.connects || 0}</strong>
          </div>
          <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px', textAlign: 'center' }}>
            <div style={{ color: '#71717A', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Reconnects</div>
            <strong style={{ fontSize: 24, color: '#F59E0B' }}>{connHealth.reconnects || 0}</strong>
          </div>
          <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px', textAlign: 'center' }}>
            <div style={{ color: '#71717A', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('Fehler', 'Errors')}</div>
            <strong style={{ fontSize: 24, color: '#EF4444' }}>{connHealth.errors || 0}</strong>
          </div>
        </div>
        {(connHealth.events || []).length > 0 && (
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {connHealth.events.slice(0, 20).map((ev, i) => (
              <div key={i} data-testid={`conn-event-${i}`} style={{
                padding: '6px 8px', borderBottom: '1px solid #0F0F1A', fontSize: 12, display: 'flex', gap: 10,
              }}>
                <span style={{
                  color: ev.eventType === 'connect' ? '#10B981' : ev.eventType === 'error' ? '#EF4444' : '#F59E0B',
                  minWidth: 70, fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {ev.eventType}
                </span>
                <span style={{ color: '#71717A' }}>
                  {ev.timestamp ? new Date(ev.timestamp).toLocaleString(isDE ? 'de-DE' : 'en-US') : '-'}
                </span>
                {ev.details && <span style={{ color: '#52525B' }}>{ev.details}</span>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Voice channel usage */}
      {channelData.length > 0 && (
        <Section title={t('Voice-Channel Nutzung', 'Voice channel usage')} testId="stats-channel-usage">
          <div style={{ display: 'grid', gap: 4 }}>
            {channelData.map((ch, i) => {
              const maxCount = channelData[0]?.count || 1;
              const pct = Math.round((ch.count / maxCount) * 100);
              return (
                <div key={ch.id} data-testid={`channel-row-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ minWidth: 180, fontSize: 13, color: '#A1A1AA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ch.id}
                  </span>
                  <div style={{ flex: 1, height: 16, background: '#0F0F1A', position: 'relative' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#5865F2', transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ minWidth: 40, textAlign: 'right', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{ch.count}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <style>{`
        @media (max-width: 768px) {
          [data-testid='dashboard-stats-detail-panel'] > div { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
