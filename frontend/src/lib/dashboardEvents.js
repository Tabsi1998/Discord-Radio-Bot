export const EVENT_PLACEHOLDERS = ['{event}', '{station}', '{voice}', '{time}', '{end}', '{timezone}'];

export const DASHBOARD_EVENT_REPEAT_OPTIONS = [
  { value: 'none', de: 'Keine Wiederholung', en: 'No repeat' },
  { value: 'daily', de: 'Täglich', en: 'Daily' },
  { value: 'weekly', de: 'Wöchentlich', en: 'Weekly' },
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

export function renderDiscordMarkdown(text) {
  if (!text) return '';
  const emojiTokens = [];
  let rendered = String(text || '').replace(/<(a?):([a-zA-Z0-9_]+):(\d+)>/g, (_, anim, name, id) => {
    const token = `@@DISCORD_EMOJI_${emojiTokens.length}@@`;
    const ext = anim === 'a' ? 'gif' : 'webp';
    emojiTokens.push({
      token,
      html: `<img src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=48" alt=":${name}:" title=":${name}:" style="width:22px;height:22px;vertical-align:middle;margin:0 1px" />`,
    });
    return token;
  });

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
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#5865F2;text-decoration:none" target="_blank" rel="noreferrer">$1</a>')
    .replace(/\n/g, '<br/>');

  for (const { token, html } of emojiTokens) {
    rendered = rendered.replaceAll(token, html);
  }

  return rendered;
}

export function buildDiscordEventDescriptionPreview(description, stationName) {
  const base = String(description || '').trim();
  const details = `OmniFM Auto-Event | Station: ${String(stationName || '-').trim() || '-'}`;
  return base ? `${base}\n\n${details}` : details;
}
