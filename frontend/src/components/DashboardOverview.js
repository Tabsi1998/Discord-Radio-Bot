import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts';
import { RotateCcw } from 'lucide-react';
import { buildReliabilitySummary, formatDashboardDuration } from '../lib/dashboardStats';

const COLORS = ['#5865F2', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#F97316'];
const DAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function StatCard({ label, value, sub, accent = '#00F0FF', testId }) {
  return (
    <div data-testid={testId} style={{
      background: '#0A0A0A', border: '1px solid #1A1A2E', padding: '18px 16px',
      display: 'flex', flexDirection: 'column', gap: 6, minHeight: 110,
    }}>
      <span style={{ fontSize: 11, color: '#71717A', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</span>
      <strong style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 28, lineHeight: 1.1, color: accent }}>{value}</strong>
      {sub && <span style={{ fontSize: 12, color: '#52525B' }}>{sub}</span>}
    </div>
  );
}

function ChartCard({ title, children, testId }) {
  return (
    <div data-testid={testId} style={{
      background: '#0A0A0A', border: '1px solid #1A1A2E', padding: '16px',
    }}>
      <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, marginBottom: 14, color: '#D4D4D8' }}>{title}</h4>
      {children}
    </div>
  );
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

export default function DashboardOverview({ stats, detailStats, t, isUltimate, onResetStats }) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const basic = stats?.basic || {};
  const isDE = t('de', 'en') === 'de';
  const dayNames = isDE ? DAYS_DE : DAYS_EN;

  const totalListeningMs = basic.totalListeningMs || 0;
  const totalSessions = basic.totalSessions || 0;
  const avgSession = basic.avgSessionMs || 0;
  const longestSession = basic.longestSessionMs || 0;
  const topStationByStarts = basic.topStationByStarts || null;
  const topStationByListening = basic.topStationByListening || null;
  const connectionHealth = detailStats?.connectionHealth || null;
  const connectionWindowDays = Number(detailStats?.connectionWindowDays || detailStats?.days || 0) || 0;
  const reliabilitySummary = buildReliabilitySummary({
    connects: connectionHealth?.connects ?? basic.totalConnections ?? 0,
    errors: connectionHealth?.errors ?? basic.totalConnectionErrors ?? 0,
    t,
  });
  const totalListeningShort = formatDashboardDuration(totalListeningMs, { short: true });
  const totalListeningLong = formatDashboardDuration(totalListeningMs);
  const reliabilityLabel = connectionHealth
    ? t(`Zuverlässigkeit (${connectionWindowDays || 7} Tage)`, `Reliability (${connectionWindowDays || 7} days)`)
    : t('Zuverlässigkeit', 'Reliability');

  // Hourly distribution chart data
  const hoursData = [];
  const hoursMap = detailStats?.listeningStats?.hours || stats?.advanced?.hours || {};
  for (let h = 0; h < 24; h++) {
    hoursData.push({ hour: `${String(h).padStart(2, '0')}:00`, starts: Number(hoursMap[String(h)] || 0) });
  }

  // Day of week distribution
  const dowData = [];
  const dowMap = detailStats?.listeningStats?.daysOfWeek || stats?.advanced?.daysOfWeek || {};
  for (let d = 0; d < 7; d++) {
    dowData.push({ day: dayNames[d], starts: Number(dowMap[String(d)] || 0) });
  }

  const stationData = Object.entries(
    detailStats?.listeningStats?.stationStarts || stats?.advanced?.stationBreakdown?.reduce((acc, s) => { acc[s.name || s.key] = s.starts || 0; return acc; }, {}) || {}
  ).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name: name.length > 20 ? name.slice(0, 18) + '..' : name, value }));

  // Daily trend from detail stats
  const dailyData = (detailStats?.dailyStats || []).slice().reverse().map(d => ({
    date: d.date?.slice(5) || '',
    starts: d.totalStarts || 0,
    hours: Math.round((d.totalListeningMs || 0) / 3600000 * 10) / 10,
    peak: d.peakListeners || 0,
  }));

  // Active sessions
  const activeSessions = detailStats?.activeSessions || [];

  const handleReset = async () => {
    if (!onResetStats) return;
    setResetting(true);
    try {
      await onResetStats();
    } finally {
      setResetting(false);
      setShowResetConfirm(false);
    }
  };

  return (
    <section data-testid="dashboard-overview-panel" style={{ display: 'grid', gap: 14 }}>
      {/* Lifetime Stats Info */}
      <div data-testid="lifetime-stats-info" style={{
        background: '#0A0A0A', border: '1px solid rgba(16,185,129,0.2)', padding: '12px 16px',
        display: 'grid', gap: 12, fontSize: 13, color: '#A1A1AA',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <div style={{ display: 'grid', gap: 6 }}>
              <strong style={{ color: '#D4D4D8', fontSize: 14 }}>
                {t('Lifetime-Statistiken', 'Lifetime statistics')}
              </strong>
              <span>
                {t(
                  'Die Werte werden über alle Sessions und Tage akkumuliert. Du kannst sie direkt hier zurücksetzen, ohne den Bot vom Server entfernen zu müssen.',
                  'Values are accumulated across all sessions and days. You can reset them directly here without removing the bot from the server.'
                )}
              </span>
            </div>
          </div>
          {!showResetConfirm ? (
            <button
              data-testid="overview-stats-reset-btn"
              onClick={() => setShowResetConfirm(true)}
              style={{
                border: '1px solid #27272A',
                background: 'transparent',
                color: '#A1A1AA',
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
              }}
            >
              <RotateCcw size={13} />
              {t('Statistiken zurücksetzen', 'Reset statistics')}
            </button>
          ) : (
            <div
              data-testid="overview-stats-reset-confirm"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
              }}
            >
              <span style={{ color: '#FCA5A5', fontSize: 12 }}>
                {t('Wirklich alles für diesen Server löschen?', 'Really delete everything for this server?')}
              </span>
              <button
                data-testid="overview-stats-reset-confirm-yes"
                onClick={handleReset}
                disabled={resetting}
                style={{
                  border: '1px solid #EF4444',
                  background: '#EF4444',
                  color: '#fff',
                  padding: '8px 12px',
                  cursor: resetting ? 'wait' : 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  opacity: resetting ? 0.6 : 1,
                }}
              >
                {resetting ? t('Lösche...', 'Deleting...') : t('Ja, löschen', 'Yes, delete')}
              </button>
              <button
                data-testid="overview-stats-reset-confirm-no"
                onClick={() => setShowResetConfirm(false)}
                disabled={resetting}
                style={{
                  border: '1px solid #27272A',
                  background: 'transparent',
                  color: '#A1A1AA',
                  padding: '8px 12px',
                  cursor: resetting ? 'wait' : 'pointer',
                  fontSize: 12,
                }}
              >
                {t('Abbrechen', 'Cancel')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Row 1: Key metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <StatCard testId="metric-listeners" label={t('Live-Zuhörer', 'Live listeners')} value={basic.listenersNow ?? 0} accent="#00F0FF" />
        <StatCard testId="metric-streams" label={t('Aktive Streams', 'Active streams')} value={basic.activeStreams ?? 0} accent="#10B981" />
        <StatCard testId="metric-peak" label={t('Peak-Zuhörer', 'Peak listeners')} value={basic.peakListeners ?? 0} accent="#8B5CF6" />
        <StatCard
          testId="metric-total-time"
          label={t('Gesamte Hörzeit', 'Total listening')}
          value={totalListeningShort}
          accent="#F59E0B"
          sub={totalListeningLong !== totalListeningShort ? totalListeningLong : undefined}
        />
        <StatCard testId="metric-sessions" label={t('Abgeschlossene Sessions', 'Completed sessions')} value={totalSessions} accent="#06B6D4" />
        <StatCard testId="metric-reliability" label={reliabilityLabel} value={reliabilitySummary.value} accent={reliabilitySummary.accent} sub={reliabilitySummary.sub} />
      </div>

      {/* Row 2: Active sessions */}
      {activeSessions.length > 0 && (
        <div data-testid="active-sessions-panel" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
          <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, color: '#D4D4D8', marginBottom: 10 }}>
            {t('Aktive Sessions', 'Active sessions')} ({activeSessions.length})
          </h4>
          <div style={{ display: 'grid', gap: 6 }}>
            {activeSessions.map((s, i) => (
              <div key={i} data-testid={`active-session-${i}`} style={{
                border: '1px solid #1A1A2E', background: '#050505', padding: '10px 12px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <span style={{ fontWeight: 600 }}>{s.stationName || s.stationKey || '-'}</span>
                <span style={{ color: '#71717A', fontSize: 13 }}>
                  {s.currentListeners} {t('Zuhörer', 'listeners')} | {t('Durchschn.', 'Avg')} {s.currentAvgListeners ?? 0} | {t('Hörzeit', 'Listening')}: {formatDashboardDuration(s.currentHumanListeningMs)} | {t('Dauer', 'Runtime')}: {formatDashboardDuration(s.currentDurationMs)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Row 3: Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10 }}>
        {/* Hourly distribution */}
        <ChartCard title={t('Starts nach Stunde', 'Starts by hour')} testId="chart-hourly">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={hoursData}>
              <XAxis dataKey="hour" tick={{ fill: '#52525B', fontSize: 10 }} interval={2} />
              <YAxis tick={{ fill: '#52525B', fontSize: 10 }} width={30} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="starts" fill="#5865F2" radius={[2, 2, 0, 0]} name={t('Starts', 'Starts')} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Day of week distribution */}
        <ChartCard title={t('Starts nach Wochentag', 'Starts by weekday')} testId="chart-dow">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dowData}>
              <XAxis dataKey="day" tick={{ fill: '#52525B', fontSize: 11 }} />
              <YAxis tick={{ fill: '#52525B', fontSize: 10 }} width={30} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="starts" fill="#8B5CF6" radius={[2, 2, 0, 0]} name={t('Starts', 'Starts')} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 4: Station breakdown + session info */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10 }}>
        {stationData.length > 0 && (
          <ChartCard title={t('Meist gestartete Stationen (Starts)', 'Most started stations (starts)')} testId="chart-stations">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={stationData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name }) => name}>
                  {stationData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        <div style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
          <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, color: '#D4D4D8', marginBottom: 14 }}>
            {t('Session-Details', 'Session details')}
          </h4>
          <p style={{ color: '#71717A', fontSize: 12, marginTop: -6, marginBottom: 12 }}>
            {t(
              'Eine Session ist ein abgeschlossener Stream-Lauf pro Bot (Start bis Stop/Neustart).',
              'A session is one completed stream run per bot (start until stop/restart).'
            )}
          </p>
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
              <span style={{ color: '#71717A' }}>{t('Durchschn. Hörzeit / Session', 'Avg listening time / session')}</span>
              <strong>{formatDashboardDuration(avgSession)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
              <span style={{ color: '#71717A' }}>{t('Längste Hörzeit / Session', 'Longest listening time / session')}</span>
              <strong>{formatDashboardDuration(longestSession)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
              <span style={{ color: '#71717A' }}>{t('Starts gesamt', 'Lifetime starts')}</span>
              <strong>{basic.totalStarts || 0}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
              <span style={{ color: '#71717A' }}>{t('Reconnects gesamt', 'Lifetime reconnects')}</span>
              <strong>{basic.totalReconnects || 0}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
              <span style={{ color: '#71717A' }}>{t('Top Station (Hörzeit)', 'Top station (listening time)')}</span>
              <strong style={{ maxWidth: 180, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {topStationByListening?.name || basic.topStation?.name || '-'}
              </strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#71717A' }}>{t('Meist gestartet', 'Most started')}</span>
              <strong style={{ maxWidth: 180, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {topStationByStarts?.name || '-'}
              </strong>
            </div>
          </div>
        </div>
      </div>

      {/* Row 5: Daily trend (only with MongoDB detail data) */}
      {dailyData.length > 0 && (
        <ChartCard title={t('Tägl. Trend (letzte 30 Tage)', 'Daily trend (last 30 days)')} testId="chart-daily-trend">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="gradStarts" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#5865F2" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#5865F2" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: '#52525B', fontSize: 10 }} />
              <YAxis tick={{ fill: '#52525B', fontSize: 10 }} width={30} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="starts" stroke="#5865F2" fill="url(#gradStarts)" name={t('Starts', 'Starts')} />
              <Area type="monotone" dataKey="peak" stroke="#8B5CF6" fill="none" name={t('Peak', 'Peak')} strokeDasharray="3 3" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <style>{`
        @media (max-width: 768px) {
          [data-testid='dashboard-overview-panel'] > div { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
