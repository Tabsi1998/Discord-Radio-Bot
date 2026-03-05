export const EVENT_PLACEHOLDERS = ['{event}', '{station}', '{voice}', '{time}', '{end}', '{timezone}'];

export const DASHBOARD_EVENT_REPEAT_OPTIONS = [
  { value: 'none', de: 'Keine Wiederholung', en: 'No repeat' },
  { value: 'daily', de: 'Täglich', en: 'Daily' },
  { value: 'weekdays', de: 'Werktags (Mo-Fr)', en: 'Weekdays (Mon-Fri)' },
  { value: 'weekly', de: 'Wöchentlich', en: 'Weekly' },
  { value: 'biweekly', de: 'Alle 2 Wochen', en: 'Every 2 weeks' },
  { value: 'yearly', de: 'Jährlich', en: 'Yearly' },
  { value: 'monthly_first_weekday', de: 'Monatlich (1. Wochentag)', en: 'Monthly (1st weekday)' },
  { value: 'monthly_second_weekday', de: 'Monatlich (2. Wochentag)', en: 'Monthly (2nd weekday)' },
  { value: 'monthly_third_weekday', de: 'Monatlich (3. Wochentag)', en: 'Monthly (3rd weekday)' },
  { value: 'monthly_fourth_weekday', de: 'Monatlich (4. Wochentag)', en: 'Monthly (4th weekday)' },
  { value: 'monthly_last_weekday', de: 'Monatlich (letzter Wochentag)', en: 'Monthly (last weekday)' },
];

export const DASHBOARD_EVENT_TIMEZONE_OPTIONS = [
  'Europe/Vienna',
  'Europe/Berlin',
  'Europe/Zurich',
  'Europe/London',
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Toronto',
  'Asia/Tokyo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Australia/Sydney',
];

export function renderEventTemplate(template, values = {}) {
  return String(template || '')
    .replace(/\{event\}/gi, String(values.event || '-'))
    .replace(/\{station\}/gi, String(values.station || '-'))
    .replace(/\{voice\}/gi, String(values.voice || '-'))
    .replace(/\{time\}/gi, String(values.time || '-'))
    .replace(/\{end\}/gi, String(values.end || '-'))
    .replace(/\{timezone\}/gi, String(values.timeZone || values.timezone || '-'))
    .trim();
}

function formatOrdinal(value, language = 'de') {
  const number = Number.parseInt(String(value || 0), 10);
  if (!Number.isFinite(number) || number <= 0) return String(value || '');
  if (String(language || 'de').startsWith('de')) return `${number}.`;
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return `${number}st`;
  if (mod10 === 2 && mod100 !== 12) return `${number}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${number}rd`;
  return `${number}th`;
}

function resolveCalendarSource(startsAt) {
  const text = String(startsAt || '').trim();
  if (!text) return null;

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return {
      year: Number.parseInt(isoMatch[1], 10),
      month: Number.parseInt(isoMatch[2], 10),
      day: Number.parseInt(isoMatch[3], 10),
    };
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getUTCFullYear(),
    month: parsed.getUTCMonth() + 1,
    day: parsed.getUTCDate(),
  };
}

function getCalendarDate(startsAt) {
  const parts = resolveCalendarSource(startsAt);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0));
}

function getWeekdayLabel(startsAt, language = 'de') {
  const date = getCalendarDate(startsAt);
  if (!date) return null;
  const locale = String(language || 'de').startsWith('de') ? 'de-DE' : 'en-US';
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', weekday: 'long' }).format(date);
}

function getMonthDayLabel(startsAt, language = 'de') {
  const date = getCalendarDate(startsAt);
  if (!date) return null;
  const locale = String(language || 'de').startsWith('de') ? 'de-DE' : 'en-US';
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(date);
}

export function getDashboardRepeatLabel(raw, language = 'de', { startsAt = '' } = {}) {
  const repeat = String(raw || 'none').trim().toLowerCase();
  const isDe = String(language || 'de').startsWith('de');
  const weekday = getWeekdayLabel(startsAt, language);
  const monthDay = getMonthDayLabel(startsAt, language);

  if (repeat === 'none') return isDe ? 'Keine Wiederholung' : 'No repeat';
  if (repeat === 'daily') return isDe ? 'Jeden Tag' : 'Every day';
  if (repeat === 'weekdays') return isDe ? 'Werktäglich (Montag bis Freitag)' : 'Weekdays (Monday to Friday)';
  if (repeat === 'weekly') return weekday ? (isDe ? `Jeden ${weekday}` : `Every ${weekday}`) : (isDe ? 'Wöchentlich' : 'Weekly');
  if (repeat === 'biweekly') return weekday ? (isDe ? `Alle 2 Wochen (${weekday})` : `Every 2 weeks (${weekday})`) : (isDe ? 'Alle 2 Wochen' : 'Every 2 weeks');
  if (repeat === 'yearly') return monthDay ? (isDe ? `Jährlich am ${monthDay}` : `Yearly on ${monthDay}`) : (isDe ? 'Jährlich' : 'Yearly');
  if (repeat === 'monthly_first_weekday') return isDe ? `Jeden ${formatOrdinal(1, language)} ${weekday || 'Wochentag'} im Monat` : `Every ${formatOrdinal(1, language)} ${weekday || 'weekday'} of the month`;
  if (repeat === 'monthly_second_weekday') return isDe ? `Jeden ${formatOrdinal(2, language)} ${weekday || 'Wochentag'} im Monat` : `Every ${formatOrdinal(2, language)} ${weekday || 'weekday'} of the month`;
  if (repeat === 'monthly_third_weekday') return isDe ? `Jeden ${formatOrdinal(3, language)} ${weekday || 'Wochentag'} im Monat` : `Every ${formatOrdinal(3, language)} ${weekday || 'weekday'} of the month`;
  if (repeat === 'monthly_fourth_weekday') return isDe ? `Jeden ${formatOrdinal(4, language)} ${weekday || 'Wochentag'} im Monat` : `Every ${formatOrdinal(4, language)} ${weekday || 'weekday'} of the month`;
  if (repeat === 'monthly_last_weekday') return isDe ? `Jeden letzten ${weekday || 'Wochentag'} im Monat` : `Every last ${weekday || 'weekday'} of the month`;
  return isDe ? 'Keine Wiederholung' : 'No repeat';
}

export function buildDiscordCustomEmojiToken(emoji) {
  const name = String(emoji?.name || '').trim();
  const id = String(emoji?.id || '').trim();
  if (!name || !/^\d{2,32}$/.test(id)) return '';
  return emoji?.animated
    ? `<a:${name}:${id}>`
    : `<:${name}:${id}>`;
}

export function expandDiscordEmojiAliases(text, serverEmojis = []) {
  const source = String(text || '');
  if (!source) return '';

  const emojiTokensByName = new Map();
  for (const emoji of Array.isArray(serverEmojis) ? serverEmojis : []) {
    const name = String(emoji?.name || '').trim();
    const token = buildDiscordCustomEmojiToken(emoji);
    if (!name || !token || emojiTokensByName.has(name)) continue;
    emojiTokensByName.set(name, token);
  }
  if (!emojiTokensByName.size) return source;

  const protectedFullTokens = [];
  let normalized = source.replace(/<(a?):([a-zA-Z0-9_]+):(\d+)>/g, (match) => {
    const token = `@@DISCORD_FULL_EMOJI_${protectedFullTokens.length}@@`;
    protectedFullTokens.push({ token, match });
    return token;
  });

  normalized = normalized.replace(/(^|[^<\w]):([A-Za-z0-9_]{2,32}):(?!\d+>)/g, (match, prefix, name) => {
    const token = emojiTokensByName.get(name);
    if (!token) return match;
    return `${prefix}${token}`;
  });

  for (const { token, match } of protectedFullTokens) {
    normalized = normalized.replaceAll(token, match);
  }

  return normalized;
}

export function renderDiscordMarkdown(text, options = {}) {
  if (!text) return '';
  const normalizedText = expandDiscordEmojiAliases(text, options.serverEmojis || []);
  const emojiTokens = [];
  let rendered = String(normalizedText || '').replace(/<(a?):([a-zA-Z0-9_]+):(\d+)>/g, (_, anim, name, id) => {
    const token = `@@DISCORD_EMOJI_${emojiTokens.length}@@`;
    const ext = anim === 'a' ? 'gif' : 'webp';
    emojiTokens.push({
      token,
      html: `<img src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=48" alt=":${name}:" title=":${name}:" style="width:22px;height:22px;vertical-align:middle;margin:0 1px" />`,
    });
    return token;
  });

  const escapeHtmlAttribute = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const decodeBasicEntities = (value) => String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const sanitizeLinkHref = (rawHref) => {
    const decoded = decodeBasicEntities(rawHref).trim();
    if (!decoded || /[\u0000-\u001F\u007F\s]/.test(decoded)) return '';
    try {
      const parsed = new URL(decoded);
      const protocol = String(parsed.protocol || '').toLowerCase();
      if (protocol !== 'http:' && protocol !== 'https:') return '';
      return parsed.toString();
    } catch {
      return '';
    }
  };

  rendered = rendered
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/```([^`]*?)```/gs, '<pre style="background:#1a1a2e;padding:8px;border-radius:4px;overflow-x:auto;margin:4px 0"><code>$1</code></pre>')
    .replace(/`([^`\n]+?)`/g, '<code style="background:#1a1a2e;padding:1px 6px;border-radius:3px;font-size:0.9em">$1</code>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/^> (.+)$/gm, '<div style="border-left:3px solid #4f545c;padding-left:10px;color:#a1a1aa">$1</div>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
      const safeHref = sanitizeLinkHref(href);
      if (!safeHref) return `<span style="color:#a1a1aa">${label}</span>`;
      return `<a href="${escapeHtmlAttribute(safeHref)}" style="color:#5865F2;text-decoration:none" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .replace(/\n/g, '<br/>');

  for (const { token, html } of emojiTokens) {
    rendered = rendered.replaceAll(token, html);
  }

  return rendered;
}

export function buildDiscordEventDescriptionPreview(description, stationName, options = {}) {
  const base = String(description || '').trim();
  const details = String(
    options.detailsLine
      || `${String(options.detailsPrefix || 'OmniFM Auto-Event | Station').trim()}: ${String(stationName || '-').trim() || '-'}`
  ).trim();
  return base ? `${base}\n\n${details}` : details;
}
