import React, { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Trash2, Power, PowerOff, Plus, ChevronDown, ChevronUp, Repeat, Clock, Hash } from 'lucide-react';
import RichMessageEditor from './RichMessageEditor';

const REPEAT_OPTIONS = [
  { value: 'none', de: 'Keine Wiederholung', en: 'No repeat' },
  { value: 'daily', de: 'Taeglich', en: 'Daily' },
  { value: 'weekdays', de: 'Werktags (Mo-Fr)', en: 'Weekdays (Mon-Fri)' },
  { value: 'weekends', de: 'Wochenende (Sa-So)', en: 'Weekends (Sat-Sun)' },
  { value: 'weekly', de: 'Woechentlich', en: 'Weekly' },
];

const TIMEZONE_OPTIONS = [
  'Europe/Vienna', 'Europe/Berlin', 'Europe/Zurich', 'Europe/London',
  'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'UTC',
];

function InputRow({ label, children, testId }) {
  return (
    <div data-testid={testId}>
      <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</label>
      {children}
    </div>
  );
}

function SelectInput({ value, onChange, options, testId, placeholder }) {
  return (
    <select data-testid={testId} value={value} onChange={onChange} style={{
      width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
    }}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function TextInput({ value, onChange, placeholder, testId, type = 'text' }) {
  return (
    <input data-testid={testId} type={type} value={value} onChange={onChange} placeholder={placeholder} style={{
      width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
    }} />
  );
}

function EventCard({ event, onToggle, onDelete, onEdit, t, formatDate, voiceChannels, textChannels }) {
  const [expanded, setExpanded] = useState(false);
  const isActive = event.enabled !== false;
  const isPast = event.startsAt && new Date(event.startsAt) < new Date();
  const repeatLabel = REPEAT_OPTIONS.find(o => o.value === (event.repeat || 'none'));
  const voiceName = voiceChannels?.find(c => c.id === event.channelId)?.name || event.channelId || '-';
  const textName = textChannels?.find(c => c.id === event.textChannelId)?.name || event.textChannelId || '';

  return (
    <div data-testid={`event-card-${event.id}`} style={{
      border: '1px solid', borderColor: isActive ? '#1A1A2E' : '#27272A',
      background: isActive ? '#0A0A0A' : '#080808', padding: '12px 14px', opacity: isActive ? 1 : 0.7,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <CalendarDays size={16} color={isActive ? '#5865F2' : '#52525B'} style={{ flexShrink: 0 }} />
          <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {event.title || t('Unbenanntes Event', 'Untitled event')}
          </strong>
          {isPast && <span style={{ fontSize: 10, color: '#F59E0B', border: '1px solid rgba(245,158,11,0.3)', padding: '2px 6px', flexShrink: 0 }}>{t('Vergangen', 'Past')}</span>}
          {event.repeat && event.repeat !== 'none' && (
            <span style={{ fontSize: 10, color: '#06B6D4', border: '1px solid rgba(6,182,212,0.3)', padding: '2px 6px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 2 }}>
              <Repeat size={10} /> {repeatLabel?.[t('de','en') === 'de' ? 'de' : 'en'] || event.repeat}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          <button data-testid={`event-expand-${event.id}`} onClick={() => setExpanded(!expanded)} style={{ border: '1px solid #1A1A2E', background: 'transparent', color: '#A1A1AA', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center' }}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button data-testid={`event-toggle-${event.id}`} onClick={() => onToggle(event.id, !isActive)} style={{
            border: '1px solid', borderColor: isActive ? 'rgba(16,185,129,0.4)' : '#27272A',
            background: isActive ? 'rgba(16,185,129,0.1)' : 'transparent', color: isActive ? '#10B981' : '#71717A', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center',
          }}>
            {isActive ? <Power size={14} /> : <PowerOff size={14} />}
          </button>
          <button data-testid={`event-delete-${event.id}`} onClick={() => onDelete(event.id)} style={{
            border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)', color: '#EF4444', width: 30, height: 30, cursor: 'pointer', display: 'grid', placeItems: 'center',
          }}>
            <Trash2 size={14} />
          </button>
        </div>
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: '#71717A' }}>
        <span>Station: <span style={{ color: '#A1A1AA' }}>{event.stationKey || '-'}</span></span>
        <span><Hash size={11} style={{ verticalAlign: '-1px' }} /> <span style={{ color: '#A1A1AA' }}>{voiceName}</span></span>
        <span><Clock size={11} style={{ verticalAlign: '-1px' }} /> <span style={{ color: '#A1A1AA' }}>{event.startsAt ? formatDate(event.startsAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</span></span>
        {event.durationMs > 0 && <span>{t('Dauer', 'Duration')}: <span style={{ color: '#A1A1AA' }}>{Math.round(event.durationMs / 60000)}min</span></span>}
      </div>
      {expanded && (
        <div style={{ marginTop: 10, padding: '10px 0 0', borderTop: '1px solid #1A1A2E', fontSize: 13, display: 'grid', gap: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <div><span style={{ color: '#52525B' }}>ID:</span> <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#A1A1AA', fontSize: 11 }}>{event.id}</span></div>
            <div><span style={{ color: '#52525B' }}>Timezone:</span> <span style={{ color: '#A1A1AA' }}>{event.timezone || '-'}</span></div>
            {textName && <div><span style={{ color: '#52525B' }}>{t('Text-Channel', 'Text channel')}:</span> <span style={{ color: '#A1A1AA' }}>#{textName}</span></div>}
            <div><span style={{ color: '#52525B' }}>Discord-Event:</span> <span style={{ color: event.createDiscordEvent ? '#10B981' : '#71717A' }}>{event.createDiscordEvent ? 'Ja' : 'Nein'}</span></div>
            {event.stageTopic && <div><span style={{ color: '#52525B' }}>Stage Topic:</span> <span style={{ color: '#A1A1AA' }}>{event.stageTopic}</span></div>}
          </div>
          {event.announceMessage && (
            <div>
              <span style={{ color: '#52525B' }}>{t('Nachricht', 'Message')}:</span>
              <div style={{ marginTop: 4, background: '#050505', border: '1px solid #1A1A2E', padding: '8px 10px', color: '#D4D4D8', whiteSpace: 'pre-wrap' }}>
                {event.announceMessage}
              </div>
            </div>
          )}
          {event.description && (
            <div>
              <span style={{ color: '#52525B' }}>{t('Beschreibung', 'Description')}:</span>
              <div style={{ marginTop: 4, color: '#A1A1AA', whiteSpace: 'pre-wrap' }}>{event.description}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DashboardEvents({
  events, eventForm, setEventForm, onCreateEvent, onToggleEvent, onDeleteEvent,
  t, formatDate, apiRequest, selectedGuildId,
}) {
  const [showForm, setShowForm] = useState(false);
  const [voiceChannels, setVoiceChannels] = useState([]);
  const [textChannels, setTextChannels] = useState([]);
  const [stations, setStations] = useState({ free: [], pro: [], custom: [] });

  const loadChannelsAndStations = useCallback(async () => {
    if (!selectedGuildId) return;
    try {
      const [chResult, stResult] = await Promise.all([
        apiRequest(`/api/dashboard/channels?serverId=${encodeURIComponent(selectedGuildId)}`),
        apiRequest(`/api/dashboard/stations?serverId=${encodeURIComponent(selectedGuildId)}`),
      ]);
      setVoiceChannels(chResult.voiceChannels || []);
      setTextChannels(chResult.textChannels || []);
      setStations({ free: stResult.free || [], pro: stResult.pro || [], custom: stResult.custom || [] });
    } catch {}
  }, [selectedGuildId, apiRequest]);

  useEffect(() => { loadChannelsAndStations(); }, [loadChannelsAndStations]);

  const stationOptions = [
    ...(stations.custom.length > 0 ? [{ value: '', label: `--- ${t('Custom Stations', 'Custom Stations')} ---`, disabled: true }] : []),
    ...stations.custom.map(s => ({ value: `custom:${s.key}`, label: `${s.name} (Custom)` })),
    { value: '', label: `--- ${t('Free Stations', 'Free Stations')} ---`, disabled: true },
    ...stations.free.map(s => ({ value: s.key, label: s.name })),
    ...(stations.pro.length > 0 ? [{ value: '', label: `--- ${t('Pro Stations', 'Pro Stations')} ---`, disabled: true }] : []),
    ...stations.pro.map(s => ({ value: s.key, label: `${s.name} (Pro)` })),
  ];

  return (
    <section data-testid="dashboard-events-panel" style={{ display: 'grid', gap: 14 }}>
      <div style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>
            {t('Events', 'Events')} <span style={{ color: '#52525B', fontSize: 14 }}>({events.length})</span>
          </h3>
          <button data-testid="event-toggle-form-btn" onClick={() => setShowForm(!showForm)} style={{
            border: '1px solid #5865F2', background: showForm ? 'rgba(88,101,242,0.15)' : 'transparent',
            color: '#fff', height: 36, padding: '0 14px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13,
          }}>
            <Plus size={14} /> {showForm ? t('Abbrechen', 'Cancel') : t('Neues Event', 'New event')}
          </button>
        </div>

        {showForm && (
          <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <InputRow label={t('Titel', 'Title')}>
                <TextInput testId="event-title-input" value={eventForm.title} onChange={(e) => setEventForm(c => ({ ...c, title: e.target.value }))} placeholder={t('z.B. Abend-Radio', 'e.g. Evening Radio')} />
              </InputRow>

              <InputRow label={t('Station', 'Station')}>
                <select data-testid="event-station-select" value={eventForm.stationKey} onChange={(e) => setEventForm(c => ({ ...c, stationKey: e.target.value }))} style={{
                  width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
                }}>
                  <option value="">{t('Station waehlen...', 'Select station...')}</option>
                  {stationOptions.map((o, i) => o.disabled
                    ? <option key={i} disabled style={{ color: '#52525B' }}>{o.label}</option>
                    : <option key={o.value} value={o.value}>{o.label}</option>
                  )}
                </select>
              </InputRow>

              <InputRow label={t('Voice Channel', 'Voice channel')}>
                <select data-testid="event-voice-select" value={eventForm.channelId} onChange={(e) => setEventForm(c => ({ ...c, channelId: e.target.value }))} style={{
                  width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
                }}>
                  <option value="">{t('Voice Channel waehlen...', 'Select voice channel...')}</option>
                  {voiceChannels.map(ch => (
                    <option key={ch.id} value={ch.id}>{ch.parentName ? `${ch.parentName} / ` : ''}{ch.name} {ch.type === 'stage' ? '(Stage)' : ''}</option>
                  ))}
                </select>
              </InputRow>

              <InputRow label={t('Text Channel (Ankuendigung)', 'Text channel (announcement)')}>
                <select data-testid="event-text-channel-select" value={eventForm.textChannelId || ''} onChange={(e) => setEventForm(c => ({ ...c, textChannelId: e.target.value }))} style={{
                  width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13,
                }}>
                  <option value="">{t('Kein Ankuendigungs-Channel', 'No announcement channel')}</option>
                  {textChannels.map(ch => (
                    <option key={ch.id} value={ch.id}>{ch.parentName ? `${ch.parentName} / ` : ''}#{ch.name}</option>
                  ))}
                </select>
              </InputRow>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <InputRow label={t('Startzeit', 'Start time')}>
                <TextInput testId="event-starts-at-input" type="datetime-local" value={eventForm.startsAt} onChange={(e) => setEventForm(c => ({ ...c, startsAt: e.target.value }))} />
              </InputRow>

              <InputRow label={t('Dauer (Minuten, 0=unbegrenzt)', 'Duration (minutes, 0=unlimited)')}>
                <TextInput testId="event-duration-input" type="number" value={eventForm.durationMinutes || ''} onChange={(e) => setEventForm(c => ({ ...c, durationMinutes: e.target.value }))} placeholder="0" />
              </InputRow>

              <InputRow label={t('Wiederholung', 'Repeat')}>
                <SelectInput testId="event-repeat-select" value={eventForm.repeat || 'none'} onChange={(e) => setEventForm(c => ({ ...c, repeat: e.target.value }))} options={REPEAT_OPTIONS.map(o => ({ value: o.value, label: t(o.de, o.en) }))} />
              </InputRow>

              <InputRow label="Timezone">
                <SelectInput testId="event-timezone-select" value={eventForm.timezone || 'Europe/Vienna'} onChange={(e) => setEventForm(c => ({ ...c, timezone: e.target.value }))} options={TIMEZONE_OPTIONS.map(tz => ({ value: tz, label: tz }))} />
              </InputRow>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
              <InputRow label="Stage Topic">
                <TextInput testId="event-stage-topic-input" value={eventForm.stageTopic || ''} onChange={(e) => setEventForm(c => ({ ...c, stageTopic: e.target.value }))} placeholder={t('Optional', 'Optional')} />
              </InputRow>

              <InputRow label={t('Beschreibung (Discord Event)', 'Description (Discord event)')}>
                <TextInput testId="event-description-input" value={eventForm.description || ''} onChange={(e) => setEventForm(c => ({ ...c, description: e.target.value }))} placeholder={t('Optional', 'Optional')} />
              </InputRow>

              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, padding: '0 0 4px' }}>
                <label data-testid="event-discord-event-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                  <input type="checkbox" checked={eventForm.createDiscordEvent || false} onChange={(e) => setEventForm(c => ({ ...c, createDiscordEvent: e.target.checked }))} style={{ width: 16, height: 16, accentColor: '#5865F2' }} />
                  {t('Discord Server-Event erstellen', 'Create Discord server event')}
                </label>
              </div>
            </div>

            <RichMessageEditor testId="event-message-editor" value={eventForm.announceMessage || ''} onChange={(v) => setEventForm(c => ({ ...c, announceMessage: v }))} t={t} apiRequest={apiRequest} selectedGuildId={selectedGuildId} />

            <button data-testid="event-create-btn" onClick={() => { onCreateEvent(); setShowForm(false); }} style={{
              height: 42, border: 'none', background: '#5865F2', color: '#fff', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.02em', fontSize: 14,
            }}>
              {t('Event speichern', 'Save event')}
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {events.length === 0 && (
          <div data-testid="events-empty" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: '40px 20px', textAlign: 'center' }}>
            <CalendarDays size={32} color="#27272A" style={{ margin: '0 auto' }} />
            <p style={{ color: '#52525B', marginTop: 10 }}>{t('Noch keine Events erstellt.', 'No events created yet.')}</p>
          </div>
        )}
        {events.map((event) => (
          <EventCard key={event.id} event={event} onToggle={onToggleEvent} onDelete={onDeleteEvent} t={t} formatDate={formatDate} voiceChannels={voiceChannels} textChannels={textChannels} />
        ))}
      </div>
    </section>
  );
}
