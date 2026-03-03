import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts';

const COLORS = ['#5865F2', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#F97316'];
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

function formatMsShort(ms) {
  if (!ms || ms <= 0) return '0h';
  const hours = Math.round(ms / 3600000 * 10) / 10;
  return hours >= 1 ? `${hours}h` : `${Math.round(ms / 60000)}m`;
}

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

export default function DashboardOverview({ stats, detailStats, t, isUltimate }) {
  const basic = stats?.basic || {};
  const isDE = t('de', 'en') === 'de';
  const dayNames = isDE ? DAYS_DE : DAYS_EN;

  const totalListeningMs = basic.totalListeningMs || 0;
  const totalSessions = basic.totalSessions || 0;
  const avgSession = basic.avgSessionMs || 0;
  const longestSession = basic.longestSessionMs || 0;
  const totalConnections = basic.totalConnections || 0;
  const totalErrors = basic.totalConnectionErrors || 0;
  const reliability = totalConnections > 0 ? Math.round(((totalConnections - totalErrors) / totalConnections) * 100) : 100;

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

  // Top stations pie chart
  const stationStarts = detailStats?.listeningStats?.stationStarts || basic.topStation ? {} : {};
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

  return (
    <section data-testid="dashboard-overview-panel" style={{ display: 'grid', gap: 14 }}>
      {/* Row 1: Key metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <StatCard testId="metric-listeners" label={t('Live Zuhoerer', 'Live listeners')} value={basic.listenersNow ?? 0} accent="#00F0FF" />
        <StatCard testId="metric-streams" label={t('Aktive Streams', 'Active streams')} value={basic.activeStreams ?? 0} accent="#10B981" />
        <StatCard testId="metric-peak" label={t('Peak Zuhoerer', 'Peak listeners')} value={basic.peakListeners ?? 0} accent="#8B5CF6" />
        <StatCard testId="metric-total-time" label={t('Gesamte Hoerzeit', 'Total listening')} value={formatMsShort(totalListeningMs)} accent="#F59E0B" sub={formatMs(totalListeningMs)} />
        <StatCard testId="metric-sessions" label={t('Sessions gesamt', 'Total sessions')} value={totalSessions} accent="#06B6D4" />
        <StatCard testId="metric-reliability" label={t('Zuverlaessigkeit', 'Reliability')} value={`${reliability}%`} accent={reliability >= 95 ? '#10B981' : reliability >= 80 ? '#F59E0B' : '#EF4444'} sub={`${totalConnections} ${t('Verbindungen', 'connections')}`} />
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
                  {s.currentListeners} {t('Zuhoerer', 'listeners')} | {formatMs(s.currentDurationMs)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Row 3: Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10 }}>
        {/* Hourly distribution */}
        <ChartCard title={t('Aktivitaet nach Stunde', 'Activity by hour')} testId="chart-hourly">
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
        <ChartCard title={t('Aktivitaet nach Wochentag', 'Activity by weekday')} testId="chart-dow">
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
          <ChartCard title={t('Station-Verteilung', 'Station breakdown')} testId="chart-stations">
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
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
              <span style={{ color: '#71717A' }}>{t('Durchschn. Session', 'Avg session')}</span>
              <strong>{formatMs(avgSession)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
              <span style={{ color: '#71717A' }}>{t('Laengste Session', 'Longest session')}</span>
              <strong>{formatMs(longestSession)}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
              <span style={{ color: '#71717A' }}>{t('Gesamt Starts', 'Total starts')}</span>
              <strong>{basic.totalStarts || 0}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
              <span style={{ color: '#71717A' }}>{t('Reconnects', 'Reconnects')}</span>
              <strong>{basic.totalReconnects || 0}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#71717A' }}>{t('Top Station', 'Top station')}</span>
              <strong style={{ maxWidth: 180, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{basic.topStation?.name || '-'}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* Row 5: Daily trend (only with MongoDB detail data) */}
      {dailyData.length > 0 && (
        <ChartCard title={t('Taegl. Trend (letzte 30 Tage)', 'Daily trend (last 30 days)')} testId="chart-daily-trend">
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
