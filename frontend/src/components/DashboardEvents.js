import React, { useState } from 'react';
import { CalendarDays, Trash2, Power, PowerOff, Plus, ChevronDown, ChevronUp } from 'lucide-react';

function EventCard({ event, onToggle, onDelete, t, formatDate }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = event.enabled !== false;
  const isPast = event.startsAt && new Date(event.startsAt) < new Date();

  return (
    <div data-testid={`event-card-${event.id}`} style={{
      border: '1px solid', borderColor: isActive ? '#1A1A2E' : '#27272A',
      background: isActive ? '#0A0A0A' : '#080808', padding: '12px 14px',
      opacity: isActive ? 1 : 0.7,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <CalendarDays size={16} color={isActive ? '#5865F2' : '#52525B'} style={{ flexShrink: 0 }} />
          <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {event.title || t('Unbenanntes Event', 'Untitled event')}
          </strong>
          {isPast && (
            <span style={{ fontSize: 10, color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)', padding: '2px 6px', flexShrink: 0 }}>
              {t('Vergangen', 'Past')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button
            data-testid={`event-expand-${event.id}`}
            onClick={() => setExpanded(!expanded)}
            style={{ border: '1px solid #1A1A2E', background: 'transparent', color: '#A1A1AA', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center' }}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            data-testid={`event-toggle-${event.id}`}
            onClick={() => onToggle(event.id, !isActive)}
            title={isActive ? t('Deaktivieren', 'Disable') : t('Aktivieren', 'Enable')}
            style={{
              border: '1px solid', borderColor: isActive ? 'rgba(16,185,129,0.4)' : '#27272A',
              background: isActive ? 'rgba(16,185,129,0.1)' : 'transparent',
              color: isActive ? '#10B981' : '#71717A', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center',
            }}
          >
            {isActive ? <Power size={14} /> : <PowerOff size={14} />}
          </button>
          <button
            data-testid={`event-delete-${event.id}`}
            onClick={() => onDelete(event.id)}
            title={t('Loeschen', 'Delete')}
            style={{
              border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)',
              color: '#EF4444', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center',
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: '#71717A' }}>
        <span>{t('Station', 'Station')}: <span style={{ color: '#A1A1AA' }}>{event.stationKey || '-'}</span></span>
        <span>{t('Start', 'Start')}: <span style={{ color: '#A1A1AA' }}>{event.startsAt ? formatDate(event.startsAt, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</span></span>
      </div>

      {expanded && (
        <div style={{ marginTop: 10, padding: '10px 0 0', borderTop: '1px solid #1A1A2E', fontSize: 13 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><span style={{ color: '#52525B' }}>ID:</span> <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#A1A1AA' }}>{event.id}</span></div>
            <div><span style={{ color: '#52525B' }}>Channel:</span> <span style={{ color: '#A1A1AA' }}>{event.channelId || '-'}</span></div>
            <div><span style={{ color: '#52525B' }}>Timezone:</span> <span style={{ color: '#A1A1AA' }}>{event.timezone || '-'}</span></div>
            <div><span style={{ color: '#52525B' }}>Status:</span> <span style={{ color: isActive ? '#10B981' : '#EF4444' }}>{isActive ? t('Aktiv', 'Active') : t('Inaktiv', 'Inactive')}</span></div>
          </div>
          {event.message && (
            <div style={{ marginTop: 8 }}>
              <span style={{ color: '#52525B' }}>{t('Nachricht', 'Message')}:</span>
              <div style={{ marginTop: 4, background: '#050505', border: '1px solid #1A1A2E', padding: '8px 10px', color: '#D4D4D8', whiteSpace: 'pre-wrap', fontSize: 13 }}>
                {event.message}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DashboardEvents({ events, eventForm, setEventForm, onCreateEvent, onToggleEvent, onDeleteEvent, t, formatDate }) {
  const [showForm, setShowForm] = useState(false);

  return (
    <section data-testid="dashboard-events-panel" style={{ display: 'grid', gap: 14 }}>
      {/* Create event card */}
      <div style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>
            {t('Events', 'Events')} <span style={{ color: '#52525B', fontSize: 14 }}>({events.length})</span>
          </h3>
          <button
            data-testid="event-toggle-form-btn"
            onClick={() => setShowForm(!showForm)}
            style={{
              border: '1px solid #5865F2', background: showForm ? 'rgba(88,101,242,0.15)' : 'transparent',
              color: '#fff', height: 36, padding: '0 14px', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13,
            }}
          >
            <Plus size={14} />
            {showForm ? t('Abbrechen', 'Cancel') : t('Neues Event', 'New event')}
          </button>
        </div>

        {showForm && (
          <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Titel', 'Title')}</label>
              <input
                data-testid="event-title-input"
                value={eventForm.title}
                onChange={(e) => setEventForm((c) => ({ ...c, title: e.target.value }))}
                placeholder={t('z.B. Abend-Radio', 'e.g. Evening Radio')}
                style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Station Key', 'Station key')}</label>
              <input
                data-testid="event-station-input"
                value={eventForm.stationKey}
                onChange={(e) => setEventForm((c) => ({ ...c, stationKey: e.target.value }))}
                placeholder="tomorrowland"
                style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Voice Channel ID', 'Voice channel ID')}</label>
              <input
                data-testid="event-channel-input"
                value={eventForm.channelId}
                onChange={(e) => setEventForm((c) => ({ ...c, channelId: e.target.value }))}
                placeholder="123456789012345678"
                style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Startzeit', 'Start time')}</label>
              <input
                data-testid="event-starts-at-input"
                type="datetime-local"
                value={eventForm.startsAt}
                onChange={(e) => setEventForm((c) => ({ ...c, startsAt: e.target.value }))}
                style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <button
                data-testid="event-create-btn"
                onClick={() => { onCreateEvent(); setShowForm(false); }}
                style={{
                  width: '100%', height: 40, border: 'none', background: '#5865F2', color: '#fff',
                  fontWeight: 700, cursor: 'pointer', letterSpacing: '0.02em',
                }}
              >
                {t('Event speichern', 'Save event')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Events list */}
      <div style={{ display: 'grid', gap: 8 }}>
        {events.length === 0 && (
          <div data-testid="events-empty" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: '40px 20px', textAlign: 'center' }}>
            <CalendarDays size={32} color="#27272A" style={{ margin: '0 auto' }} />
            <p style={{ color: '#52525B', marginTop: 10 }}>{t('Noch keine Events erstellt.', 'No events created yet.')}</p>
          </div>
        )}
        {events.map((event) => (
          <EventCard
            key={event.id}
            event={event}
            onToggle={onToggleEvent}
            onDelete={onDeleteEvent}
            t={t}
            formatDate={formatDate}
          />
        ))}
      </div>
    </section>
  );
}
