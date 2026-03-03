import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Bold, Italic, Underline, Strikethrough, Code, List, Link2, Eye, PenLine, Smile, X, Search } from 'lucide-react';

const PLACEHOLDERS = ['{event}', '{station}', '{voice}', '{time}'];

function renderDiscordMarkdown(text) {
  if (!text) return '';
  let html = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/```([^`]*?)```/gs, '<pre style="background:#1a1a2e;padding:8px;border-radius:4px;overflow-x:auto;margin:4px 0"><code>$1</code></pre>')
    .replace(/`([^`\n]+?)`/g, '<code style="background:#1a1a2e;padding:1px 6px;border-radius:3px;font-size:0.9em">$1</code>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/^> (.+)$/gm, '<div style="border-left:3px solid #4f545c;padding-left:10px;color:#a1a1aa">$1</div>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" style="color:#5865F2;text-decoration:none" target="_blank">$1</a>')
    .replace(/<(a?):(\w+):(\d+)>/g, (_, anim, name, id) => {
      const ext = anim === 'a' ? 'gif' : 'webp';
      return `<img src="https://cdn.discordapp.com/emojis/${id}.${ext}?size=48" alt=":${name}:" title=":${name}:" style="width:22px;height:22px;vertical-align:middle;margin:0 1px" />`;
    })
    .replace(/\n/g, '<br/>');
  return html;
}

function ToolbarButton({ icon: Icon, label, onClick, active, testId }) {
  return (
    <button
      data-testid={testId} title={label} onClick={onClick}
      style={{
        border: '1px solid', borderColor: active ? '#5865F2' : '#1A1A2E',
        background: active ? 'rgba(88,101,242,0.15)' : 'transparent',
        color: '#A1A1AA', width: 32, height: 32, cursor: 'pointer',
        display: 'grid', placeItems: 'center', transition: 'all 0.12s',
      }}
      onMouseEnter={(e) => { if (!active) e.currentTarget.style.borderColor = '#5865F2'; }}
      onMouseLeave={(e) => { if (!active) e.currentTarget.style.borderColor = '#1A1A2E'; }}
    >
      <Icon size={14} />
    </button>
  );
}

function EmojiPicker({ emojis, loading, onSelect, onClose, t }) {
  const [search, setSearch] = useState('');
  const filtered = search
    ? emojis.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))
    : emojis;

  return (
    <div data-testid="emoji-picker-panel" style={{
      position: 'absolute', top: '100%', right: 0, zIndex: 50, marginTop: 4,
      width: 320, maxHeight: 340, background: '#0A0A0A', border: '1px solid #1A1A2E',
      display: 'flex', flexDirection: 'column', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: '1px solid #1A1A2E' }}>
        <span style={{ fontSize: 12, color: '#71717A', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {t('Server Emojis', 'Server emojis')}
        </span>
        <button data-testid="emoji-picker-close" onClick={onClose} style={{ border: 'none', background: 'transparent', color: '#71717A', cursor: 'pointer', padding: 2 }}>
          <X size={14} />
        </button>
      </div>
      <div style={{ padding: '6px 10px', borderBottom: '1px solid #1A1A2E' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid #1A1A2E', background: '#050505', padding: '0 8px', height: 32 }}>
          <Search size={12} color="#52525B" />
          <input
            data-testid="emoji-search-input" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={t('Emoji suchen...', 'Search emoji...')}
            style={{ flex: 1, border: 'none', background: 'transparent', color: '#fff', fontSize: 12, outline: 'none' }}
          />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 8 }}>
        {loading && <div style={{ color: '#52525B', fontSize: 12, textAlign: 'center', padding: 20 }}>{t('Lade Emojis...', 'Loading emojis...')}</div>}
        {!loading && filtered.length === 0 && (
          <div style={{ color: '#52525B', fontSize: 12, textAlign: 'center', padding: 20 }}>
            {emojis.length === 0
              ? t('Keine Server-Emojis gefunden. Emojis werden vom Discord-Server geladen.', 'No server emojis found. Emojis are loaded from the Discord server.')
              : t('Kein Emoji passt zur Suche.', 'No emoji matches your search.')}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {filtered.map((emoji) => (
            <button
              key={emoji.id} data-testid={`emoji-btn-${emoji.name}`}
              onClick={() => onSelect(emoji)}
              title={`:${emoji.name}:`}
              style={{
                border: '1px solid transparent', background: 'transparent', cursor: 'pointer',
                width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 4,
                transition: 'all 0.1s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#1A1A2E'; e.currentTarget.style.borderColor = '#5865F2'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}
            >
              <img
                src={emoji.url} alt={`:${emoji.name}:`}
                style={{ width: 24, height: 24, objectFit: 'contain' }}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function RichMessageEditor({ value, onChange, t, testId, apiRequest, selectedGuildId }) {
  const [mode, setMode] = useState('edit');
  const [showEmojis, setShowEmojis] = useState(false);
  const [emojis, setEmojis] = useState([]);
  const [emojisLoading, setEmojisLoading] = useState(false);
  const [emojisLoaded, setEmojisLoaded] = useState(false);
  const textareaRef = useRef(null);
  const containerRef = useRef(null);

  const loadEmojis = useCallback(async () => {
    if (emojisLoaded || !apiRequest || !selectedGuildId) return;
    setEmojisLoading(true);
    try {
      const result = await apiRequest(`/api/dashboard/emojis?serverId=${encodeURIComponent(selectedGuildId)}`);
      setEmojis(result.emojis || []);
    } catch {
      setEmojis([]);
    } finally {
      setEmojisLoading(false);
      setEmojisLoaded(true);
    }
  }, [apiRequest, selectedGuildId, emojisLoaded]);

  const toggleEmojis = () => {
    if (!showEmojis) loadEmojis();
    setShowEmojis(!showEmojis);
  };

  useEffect(() => {
    if (!showEmojis) return;
    const handleClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setShowEmojis(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showEmojis]);

  const insertAtCursor = (before, after = '') => {
    const ta = textareaRef.current;
    if (!ta) { onChange(value + before + after); return; }
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.substring(start, end);
    const newText = value.substring(0, start) + before + selected + after + value.substring(end);
    onChange(newText);
    setTimeout(() => {
      ta.focus();
      const cursor = start + before.length + selected.length;
      ta.setSelectionRange(cursor, cursor);
    }, 0);
  };

  const wrapSelection = (wrapper) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    if (start === end) {
      insertAtCursor(wrapper, wrapper);
    } else {
      const selected = value.substring(start, end);
      const newText = value.substring(0, start) + wrapper + selected + wrapper + value.substring(end);
      onChange(newText);
      setTimeout(() => { ta.focus(); ta.setSelectionRange(start + wrapper.length, end + wrapper.length); }, 0);
    }
  };

  const insertEmoji = (emoji) => {
    const prefix = emoji.animated ? 'a' : '';
    const emojiText = `<${prefix}:${emoji.name}:${emoji.id}>`;
    insertAtCursor(emojiText);
    setShowEmojis(false);
  };

  const toolbarActions = [
    { icon: Bold, label: t('Fett', 'Bold'), action: () => wrapSelection('**'), testId: 'fmt-bold' },
    { icon: Italic, label: t('Kursiv', 'Italic'), action: () => wrapSelection('*'), testId: 'fmt-italic' },
    { icon: Underline, label: t('Unterstrichen', 'Underline'), action: () => wrapSelection('__'), testId: 'fmt-underline' },
    { icon: Strikethrough, label: t('Durchgestrichen', 'Strikethrough'), action: () => wrapSelection('~~'), testId: 'fmt-strike' },
    { icon: Code, label: t('Code', 'Code'), action: () => wrapSelection('`'), testId: 'fmt-code' },
    { icon: List, label: t('Codeblock', 'Code block'), action: () => insertAtCursor('```\n', '\n```'), testId: 'fmt-codeblock' },
    { icon: Link2, label: t('Link', 'Link'), action: () => insertAtCursor('[', '](url)'), testId: 'fmt-link' },
  ];

  return (
    <div data-testid={testId} ref={containerRef}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <label style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {t('Nachricht (Discord Markdown)', 'Message (Discord Markdown)')}
        </label>
        <div style={{ display: 'flex', gap: 4 }}>
          <button data-testid="editor-mode-edit" onClick={() => setMode('edit')} style={{
            border: '1px solid', borderColor: mode === 'edit' ? '#5865F2' : '#1A1A2E',
            background: mode === 'edit' ? 'rgba(88,101,242,0.15)' : 'transparent',
            color: '#A1A1AA', height: 26, padding: '0 10px', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <PenLine size={11} /> {t('Editor', 'Editor')}
          </button>
          <button data-testid="editor-mode-preview" onClick={() => setMode('preview')} style={{
            border: '1px solid', borderColor: mode === 'preview' ? '#5865F2' : '#1A1A2E',
            background: mode === 'preview' ? 'rgba(88,101,242,0.15)' : 'transparent',
            color: '#A1A1AA', height: 26, padding: '0 10px', cursor: 'pointer', fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
          }}>
            <Eye size={11} /> {t('Vorschau', 'Preview')}
          </button>
        </div>
      </div>

      {mode === 'edit' && (
        <>
          <div style={{ display: 'flex', gap: 3, marginBottom: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {toolbarActions.map((btn) => (
              <ToolbarButton key={btn.testId} icon={btn.icon} label={btn.label} onClick={btn.action} testId={btn.testId} />
            ))}
            <div style={{ width: 1, height: 20, background: '#1A1A2E', margin: '0 4px' }} />
            <div style={{ position: 'relative' }}>
              <ToolbarButton icon={Smile} label={t('Emoji', 'Emoji')} onClick={toggleEmojis} active={showEmojis} testId="fmt-emoji" />
              {showEmojis && (
                <EmojiPicker
                  emojis={emojis} loading={emojisLoading}
                  onSelect={insertEmoji} onClose={() => setShowEmojis(false)} t={t}
                />
              )}
            </div>
            <div style={{ width: 1, height: 20, background: '#1A1A2E', margin: '0 4px' }} />
            {PLACEHOLDERS.map(p => (
              <button key={p} data-testid={`placeholder-${p}`} onClick={() => insertAtCursor(p)} style={{
                border: '1px solid #1A1A2E', background: '#080808', color: '#8B5CF6', padding: '4px 8px',
                cursor: 'pointer', fontSize: 11, fontFamily: "'JetBrains Mono', monospace", height: 32,
              }}>{p}</button>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            data-testid="message-editor-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            rows={5}
            placeholder={t(
              'z.B. **{event}** startet jetzt auf {voice} mit {station}!\n\nMarkdown: **fett** *kursiv* __unterstrichen__ ~~durchgestrichen~~ `code`',
              'e.g. **{event}** is starting now on {voice} with {station}!\n\nMarkdown: **bold** *italic* __underline__ ~~strikethrough~~ `code`'
            )}
            style={{
              width: '100%', padding: 10, border: '1px solid #1A1A2E', background: '#050505',
              color: '#fff', resize: 'vertical', fontSize: 13, boxSizing: 'border-box',
              fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6, minHeight: 100,
            }}
          />
        </>
      )}

      {mode === 'preview' && (
        <div data-testid="message-preview" style={{
          minHeight: 100, border: '1px solid #1A1A2E', background: '#050505', padding: 12,
          color: '#D4D4D8', fontSize: 13, lineHeight: 1.7,
        }}>
          {value ? (
            <div dangerouslySetInnerHTML={{ __html: renderDiscordMarkdown(value) }} />
          ) : (
            <span style={{ color: '#3F3F46' }}>{t('Keine Nachricht', 'No message')}</span>
          )}
        </div>
      )}
    </div>
  );
}
