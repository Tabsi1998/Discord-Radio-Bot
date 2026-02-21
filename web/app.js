/* === OmniFM - Frontend v4.0 === */

var BOT_COLORS = [
  { name: 'cyan',   accent: '#00F0FF', glow: 'rgba(0,240,255,0.15)',  border: 'rgba(0,240,255,0.25)' },
  { name: 'green',  accent: '#39FF14', glow: 'rgba(57,255,20,0.15)',  border: 'rgba(57,255,20,0.25)' },
  { name: 'pink',   accent: '#EC4899', glow: 'rgba(236,72,153,0.15)', border: 'rgba(236,72,153,0.25)' },
  { name: 'amber',  accent: '#FFB800', glow: 'rgba(255,184,0,0.15)',  border: 'rgba(255,184,0,0.25)' },
  { name: 'purple', accent: '#BD00FF', glow: 'rgba(189,0,255,0.15)',  border: 'rgba(189,0,255,0.25)' },
  { name: 'red',    accent: '#FF2A2A', glow: 'rgba(255,42,42,0.15)',  border: 'rgba(255,42,42,0.25)' },
];

var STATION_COLORS = ['#00F0FF', '#39FF14', '#EC4899', '#FFB800', '#BD00FF', '#FF2A2A'];
var BOT_IMAGES = ['/img/bot-1.png', '/img/bot-2.png', '/img/bot-3.png', '/img/bot-4.png'];

var COMMANDS = [
  { name: '/play',          args: '[station] [channel]', desc: 'Startet einen Radio-Stream im Voice-Channel' },
  { name: '/pause',         args: '',                     desc: 'Pausiert die aktuelle Wiedergabe' },
  { name: '/resume',        args: '',                     desc: 'Setzt die Wiedergabe fort' },
  { name: '/stop',          args: '',                     desc: 'Stoppt die Wiedergabe und verlässt den Channel' },
  { name: '/stations',      args: '',                     desc: 'Zeigt alle verfügbaren Radio-Stationen (nach Tier gefiltert)' },
  { name: '/list',          args: '[page]',               desc: 'Listet Stationen paginiert auf' },
  { name: '/now',           args: '',                     desc: 'Zeigt die aktuelle Station und Metadaten' },
  { name: '/setvolume',     args: '<0-100>',              desc: 'Setzt die Lautstärke' },
  { name: '/status',        args: '',                     desc: 'Zeigt Bot-Status, Uptime und Last' },
  { name: '/health',        args: '',                     desc: 'Zeigt Stream-Health und Reconnect-Info' },
  { name: '/premium',       args: '',                     desc: 'Zeigt den Premium-Status dieses Servers' },
  { name: '/addstation',    args: '<key> <name> <url>',   desc: '[Ultimate] Eigene Station hinzufügen' },
  { name: '/removestation', args: '<key>',                desc: '[Ultimate] Eigene Station entfernen' },
  { name: '/mystations',    args: '',                     desc: '[Ultimate] Zeigt deine Custom Stationen' },
  { name: '/license',       args: '<activate|info|remove>', desc: 'Lizenz verwalten: aktivieren, anzeigen oder entfernen' },
];

var fmt = new Intl.NumberFormat('de-DE');
function fmtInt(v) { return fmt.format(Number(v) || 0); }

var allStations = [];
var currentTierFilter = 'all';

function setTierFilter(tier) {
  currentTierFilter = tier;
  stationsDisplayCount = STATIONS_PER_PAGE;
  var buttons = document.querySelectorAll('#tierFilter button');
  buttons.forEach(function(btn) {
    var t = btn.getAttribute('data-tier');
    var isActive = t === tier;
    btn.style.background = isActive ? (
      t === 'free' ? 'rgba(57,255,20,0.12)' :
      t === 'pro' ? 'rgba(255,184,0,0.12)' :
      'rgba(255,255,255,0.08)'
    ) : 'transparent';
    btn.style.borderColor = isActive ? (
      t === 'free' ? 'rgba(57,255,20,0.5)' :
      t === 'pro' ? 'rgba(255,184,0,0.5)' :
      'rgba(255,255,255,0.3)'
    ) : (
      t === 'free' ? 'rgba(57,255,20,0.2)' :
      t === 'pro' ? 'rgba(255,184,0,0.2)' :
      'rgba(255,255,255,0.15)'
    );
  });
  filterStations(document.getElementById('stationSearch').value);
}

// --- Navbar scroll + mobile toggle ---
window.addEventListener('scroll', function() {
  var nav = document.getElementById('navbar');
  if (window.scrollY > 40) { nav.classList.add('scrolled'); }
  else { nav.classList.remove('scrolled'); }
});

(function initMobileNav() {
  var toggle = document.getElementById('navToggle');
  var mobile = document.getElementById('navMobile');
  var icon = document.getElementById('navIcon');
  var isOpen = false;

  toggle.addEventListener('click', function() {
    isOpen = !isOpen;
    if (isOpen) {
      mobile.classList.add('open');
      mobile.style.display = '';
    } else {
      mobile.classList.remove('open');
    }
    icon.innerHTML = isOpen
      ? '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
      : '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
  });

  mobile.querySelectorAll('a').forEach(function(a) {
    a.addEventListener('click', function() {
      isOpen = false;
      mobile.classList.remove('open');
      icon.innerHTML = '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>';
    });
  });
})();

// --- Dynamic Equalizer ---
var eqBars = [];
var eqIsPlaying = false;

(function initEq() {
  var el = document.getElementById('equalizer');
  var heights = [0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.3, 0.7, 0.5, 0.6, 0.8, 0.4];
  heights.forEach(function(h, i) {
    var bar = document.createElement('div');
    bar.className = 'eq-bar';
    bar.style.height = (h * 100) + '%';
    bar.style.animation = 'eq ' + (0.6 + Math.random() * 0.8).toFixed(2) + 's ease-in-out ' + (i * 0.08).toFixed(2) + 's infinite';
    el.appendChild(bar);
    eqBars.push(bar);
  });
})();

function setEqActive(active) {
  var el = document.getElementById('equalizer');
  if (active && !eqIsPlaying) {
    eqIsPlaying = true;
    el.classList.add('active');
    eqBars.forEach(function(bar, i) {
      bar.style.animation = 'eq-active ' + (0.3 + Math.random() * 0.5).toFixed(2) + 's ease-in-out ' + (i * 0.06).toFixed(2) + 's infinite';
      bar.style.background = 'linear-gradient(to top, #00F0FF, #BD00FF, #FF2A2A)';
    });
  } else if (!active && eqIsPlaying) {
    eqIsPlaying = false;
    el.classList.remove('active');
    eqBars.forEach(function(bar, i) {
      bar.style.animation = 'eq ' + (0.6 + Math.random() * 0.8).toFixed(2) + 's ease-in-out ' + (i * 0.08).toFixed(2) + 's infinite';
      bar.style.background = 'linear-gradient(to top, var(--cyan), var(--purple))';
    });
  }
}

// --- Commands ---
(function renderCommands() {
  var list = document.getElementById('commandsList');
  list.innerHTML = '';
  COMMANDS.forEach(function(cmd) {
    var row = document.createElement('div');
    row.className = 'cmd-row';
    var badge = document.createElement('span');
    badge.className = 'cmd-badge';
    badge.textContent = cmd.name;
    if (cmd.args) {
      var argsSpan = document.createElement('span');
      argsSpan.className = 'cmd-args';
      argsSpan.textContent = ' ' + cmd.args;
      badge.appendChild(argsSpan);
    }
    var desc = document.createElement('span');
    desc.className = 'cmd-desc';
    desc.textContent = cmd.desc;
    row.appendChild(badge);
    row.appendChild(desc);
    list.appendChild(row);
  });
})();

// --- Copy helper ---
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(function() {
    btn.classList.add('copied');
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>';
    setTimeout(function() {
      btn.classList.remove('copied');
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    }, 2000);
  }).catch(function() {});
}

// --- Render Bots ---
function renderBots(bots) {
  var grid = document.getElementById('botGrid');
  grid.innerHTML = '';
  if (!bots || bots.length === 0) {
    grid.innerHTML = '<p class="muted">Keine Bots konfiguriert.</p>';
    return;
  }
  bots.forEach(function(bot, i) {
    var c = BOT_COLORS[i % BOT_COLORS.length];
    var url = bot.inviteUrl || ('https://discord.com/oauth2/authorize?client_id=' + bot.clientId + '&scope=bot%20applications.commands&permissions=3145728');
    var botImg = bot.avatarUrl || BOT_IMAGES[i % BOT_IMAGES.length];

    var card = document.createElement('article');
    card.className = 'bot-card';
    card.addEventListener('mouseenter', function() { card.style.borderColor = c.border; card.style.boxShadow = '0 0 40px ' + c.glow; });
    card.addEventListener('mouseleave', function() { card.style.borderColor = ''; card.style.boxShadow = ''; });

    var bar = document.createElement('div');
    bar.className = 'accent-bar';
    bar.style.background = c.accent;
    card.appendChild(bar);

    var head = document.createElement('div');
    head.className = 'bot-head';
    var icon = document.createElement('div');
    icon.className = 'bot-icon';
    icon.style.background = 'linear-gradient(135deg,' + c.accent + '22,' + c.accent + '08)';
    icon.style.border = '1px solid ' + c.accent + '33';
    var img = document.createElement('img');
    img.src = botImg; img.alt = bot.name || 'Bot';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:12px';
    img.onerror = function() { this.style.display = 'none'; icon.innerHTML += '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' + c.accent + '" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>'; };
    icon.appendChild(img);
    var info = document.createElement('div');
    var name = document.createElement('div');
    name.className = 'bot-name';
    name.textContent = bot.name || 'Bot';
    var tag = document.createElement('div');
    tag.className = 'bot-tag';
    tag.textContent = bot.userTag || 'Bereit';
    info.appendChild(name); info.appendChild(tag);
    var status = document.createElement('div');
    status.className = 'bot-status';
    var dot = document.createElement('div');
    dot.className = 'bot-status-dot ' + (bot.ready ? 'online' : 'offline');
    status.appendChild(dot);
    status.appendChild(document.createTextNode(bot.ready ? 'Online' : 'Konfigurierbar'));
    info.appendChild(status);
    head.appendChild(icon); head.appendChild(info);
    card.appendChild(head);

    // === Bot Statistiken ===
    var statsBox = document.createElement('div');
    statsBox.className = 'bot-stats';
    statsBox.style.borderColor = c.accent + '15';

    var statsTitle = document.createElement('div');
    statsTitle.className = 'stats-title';
    statsTitle.style.color = c.accent;
    statsTitle.textContent = 'BOT STATISTIKEN';
    statsBox.appendChild(statsTitle);

    var statsGrid = document.createElement('div');
    statsGrid.className = 'stats-grid';
    var statsData = [
      { label: 'Server', value: bot.servers || bot.guilds || 0 },
      { label: 'Nutzer', value: bot.users || 0 },
      { label: 'Verbindungen', value: bot.connections || 0 },
      { label: 'Zuhoerer', value: bot.listeners || 0 }
    ];
    statsData.forEach(function(s) {
      var item = document.createElement('div');
      var label = document.createElement('div');
      label.className = 'stat-label';
      label.textContent = s.label;
      var val = document.createElement('div');
      val.className = 'stat-value';
      val.textContent = new Intl.NumberFormat('de-DE').format(s.value);
      item.appendChild(label);
      item.appendChild(val);
      statsGrid.appendChild(item);
    });
    statsBox.appendChild(statsGrid);
    card.appendChild(statsBox);

    var isPremiumBot = bot.requiredTier && bot.requiredTier !== 'free';
    var tierColors = { pro: '#FFB800', ultimate: '#BD00FF' };

    // Premium badge neben Name
    if (isPremiumBot) {
      var badge = document.createElement('span');
      badge.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:800;font-family:Orbitron,sans-serif;letter-spacing:0.1em;margin-left:8px;background:' + (tierColors[bot.requiredTier] || '#FFB800') + '15;color:' + (tierColors[bot.requiredTier] || '#FFB800') + ';border:1px solid ' + (tierColors[bot.requiredTier] || '#FFB800') + '30';
      badge.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M2 4l3 12h14l3-12-5 4-5-6-5 6z"/><path d="M5 16l-1 4h16l-1-4"/></svg> ' + (bot.requiredTier === 'ultimate' ? 'ULTIMATE' : 'PRO');
      name.appendChild(badge);
    }

    var actions = document.createElement('div');
    actions.className = 'bot-actions';

    if (isPremiumBot) {
      var lockBtn = document.createElement('a');
      lockBtn.className = 'invite-btn'; lockBtn.href = '#premium';
      lockBtn.style.cssText = 'background:' + (tierColors[bot.requiredTier] || '#FFB800') + '15;color:' + (tierColors[bot.requiredTier] || '#FFB800') + ';border:1px solid ' + (tierColors[bot.requiredTier] || '#FFB800') + '30';
      lockBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg> ' + (bot.requiredTier === 'ultimate' ? 'Ultimate' : 'Pro') + ' erforderlich';
      actions.appendChild(lockBtn);
    } else {
      var invBtn = document.createElement('a');
      invBtn.className = 'invite-btn'; invBtn.href = url; invBtn.target = '_blank'; invBtn.rel = 'noopener noreferrer';
      invBtn.style.background = c.accent;
      invBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg> Einladen';
      actions.appendChild(invBtn);
      var cpBtn = document.createElement('button');
      cpBtn.className = 'copy-btn'; cpBtn.type = 'button';
      cpBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
      cpBtn.addEventListener('click', function() { copyText(url, cpBtn); });
      actions.appendChild(cpBtn);
    }
    card.appendChild(actions);
    grid.appendChild(card);
  });
}

// --- Audio Player ---
var currentAudio = null;
var currentPlayingKey = null;
var currentVolume = 80;
var currentMuted = false;

function playStation(station) {
  stopStation();
  currentAudio = new Audio(station.url);
  currentAudio.volume = currentMuted ? 0 : currentVolume / 100;
  currentAudio.play().then(function() {
    currentPlayingKey = station.key;
    updateNowPlaying(station);
    filterStations(document.getElementById('stationSearch').value);
    setEqActive(true);
  }).catch(function(err) {
    console.error('Audio play failed:', err);
    currentPlayingKey = null;
    updateNowPlaying(null);
    setEqActive(false);
  });
  currentAudio.onerror = function() {
    currentPlayingKey = null; updateNowPlaying(null);
    filterStations(document.getElementById('stationSearch').value);
    setEqActive(false);
  };
}

function stopStation() {
  if (currentAudio) { currentAudio.pause(); currentAudio.src = ''; currentAudio = null; }
  currentPlayingKey = null;
  updateNowPlaying(null);
  setEqActive(false);
  filterStations(document.getElementById('stationSearch').value);
}

function setVolume(val) {
  currentVolume = val; currentMuted = val === 0;
  if (currentAudio) currentAudio.volume = val / 100;
}

function toggleMute() {
  currentMuted = !currentMuted;
  if (currentAudio) currentAudio.volume = currentMuted ? 0 : currentVolume / 100;
  var station = allStations.find(function(s) { return s.key === currentPlayingKey; });
  if (station) updateNowPlaying(station);
}

function updateNowPlaying(station) {
  var container = document.getElementById('nowPlaying');
  if (!station) { container.style.display = 'none'; return; }
  container.style.display = 'flex';
  container.innerHTML = '';

  // Mini EQ
  var eqWrap = document.createElement('div');
  eqWrap.style.cssText = 'display:flex;align-items:flex-end;gap:2px;height:20px;flex-shrink:0';
  [0.5, 0.8, 0.6, 1, 0.7].forEach(function(h, i) {
    var b = document.createElement('div');
    b.className = 'eq-bar';
    b.style.cssText = 'width:3px;border-radius:1px;background:#00F0FF;height:' + (h*100) + '%;animation:eq-active ' + (0.3+Math.random()*0.5).toFixed(2) + 's ease-in-out ' + (i*0.06).toFixed(2) + 's infinite';
    eqWrap.appendChild(b);
  });
  container.appendChild(eqWrap);

  // Name
  var nameEl = document.createElement('span');
  nameEl.style.cssText = 'font-size:14px;font-weight:600;flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  nameEl.textContent = station.name;
  container.appendChild(nameEl);

  // Volume
  var volWrap = document.createElement('div');
  volWrap.style.cssText = 'display:flex;align-items:center;gap:8px;flex-shrink:0';

  var muteBtn = document.createElement('button');
  muteBtn.style.cssText = 'background:none;border:none;color:' + (currentMuted ? '#FF2A2A' : '#A1A1AA') + ';cursor:pointer;padding:4px;line-height:0';
  muteBtn.innerHTML = currentMuted
    ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
    : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
  muteBtn.onclick = toggleMute;
  volWrap.appendChild(muteBtn);

  var volNum = document.createElement('span');
  volNum.style.cssText = 'font-size:11px;font-family:JetBrains Mono,monospace;color:#52525B;width:28px;text-align:right';
  volNum.textContent = currentMuted ? '0' : String(currentVolume);

  var slider = document.createElement('input');
  slider.type = 'range'; slider.min = '0'; slider.max = '100';
  slider.value = currentMuted ? '0' : String(currentVolume);
  slider.className = 'vol-slider';
  var pct = currentMuted ? 0 : currentVolume;
  slider.style.background = 'linear-gradient(to right, #00F0FF ' + pct + '%, rgba(255,255,255,0.1) ' + pct + '%)';
  slider.oninput = function() {
    var v = Number(this.value); setVolume(v);
    this.style.background = 'linear-gradient(to right, #00F0FF ' + v + '%, rgba(255,255,255,0.1) ' + v + '%)';
    volNum.textContent = v;
    muteBtn.style.color = v === 0 ? '#FF2A2A' : '#A1A1AA';
  };
  volWrap.appendChild(slider);
  volWrap.appendChild(volNum);
  container.appendChild(volWrap);

  // Stop
  var stopBtn = document.createElement('button');
  stopBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.1);border:none;color:#fff;cursor:pointer;flex-shrink:0';
  stopBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  stopBtn.onclick = stopStation;
  container.appendChild(stopBtn);
}

// --- Stations ---
var STATIONS_PER_PAGE = 8;
var stationsDisplayCount = STATIONS_PER_PAGE;

function renderStations(stations) {
  allStations = stations || [];
  var freeCount = allStations.filter(function(s) { return (s.tier || 'free') === 'free'; }).length;
  var proCount = allStations.filter(function(s) { return (s.tier || 'free') === 'pro'; }).length;
  document.getElementById('stationCount').textContent = allStations.length + ' Stationen (' + freeCount + ' Free, ' + proCount + ' Pro). Klicke zum Vorhoeren oder nutze /play im Discord.';
  stationsDisplayCount = STATIONS_PER_PAGE;
  filterStations('');
}

function filterStations(query) {
  var list = document.getElementById('stationList');
  var pagination = document.getElementById('stationPagination');
  list.innerHTML = '';
  var q = (query || '').toLowerCase().trim();
  var filtered = allStations.filter(function(s) {
    if (currentTierFilter !== 'all' && (s.tier || 'free') !== currentTierFilter) return false;
    if (!q) return true;
    return s.name.toLowerCase().indexOf(q) !== -1 || s.key.toLowerCase().indexOf(q) !== -1;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<p class="muted" style="padding:40px;text-align:center">Keine Stationen gefunden.</p>';
    if (pagination) pagination.innerHTML = '';
    return;
  }

  var visible = filtered.slice(0, stationsDisplayCount);
  var remaining = filtered.length - visible.length;

  visible.forEach(function(s, i) {
    var color = STATION_COLORS[i % STATION_COLORS.length];
    var isPlaying = currentPlayingKey === s.key;
    var item = document.createElement('div');
    item.className = 'station-item';
    if (isPlaying) { item.style.background = color + '10'; item.style.borderColor = color + '30'; }
    item.onclick = function() { if (isPlaying) { stopStation(); } else { playStation(s); } };

    var icon = document.createElement('div');
    icon.className = 'station-icon';
    icon.style.background = isPlaying ? color : color + '12';
    icon.style.border = '1px solid ' + (isPlaying ? color : color + '22');
    if (isPlaying) {
      icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#050505" stroke="#050505" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    } else {
      icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="' + color + '" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></svg>';
    }

    var info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;display:flex;align-items:center;gap:8px';
    var textWrap = document.createElement('div');
    textWrap.style.cssText = 'flex:1;min-width:0';
    var nm = document.createElement('div');
    nm.className = 'station-name'; nm.textContent = s.name;
    var ky = document.createElement('div');
    ky.className = 'station-key'; ky.textContent = s.key;
    textWrap.appendChild(nm); textWrap.appendChild(ky);
    info.appendChild(textWrap);

    // Tier Badge
    var tier = (s.tier || 'free').toLowerCase();
    var badge = document.createElement('span');
    badge.style.cssText = 'font-size:9px;font-weight:800;letter-spacing:0.08em;padding:3px 8px;border-radius:6px;font-family:Orbitron,sans-serif;white-space:nowrap;flex-shrink:0';
    if (tier === 'pro') {
      badge.textContent = 'PRO';
      badge.style.background = 'rgba(255,184,0,0.12)';
      badge.style.border = '1px solid rgba(255,184,0,0.3)';
      badge.style.color = '#FFB800';
    } else if (tier === 'ultimate') {
      badge.textContent = 'ULTIMATE';
      badge.style.background = 'rgba(189,0,255,0.12)';
      badge.style.border = '1px solid rgba(189,0,255,0.3)';
      badge.style.color = '#BD00FF';
    } else {
      badge.textContent = 'FREE';
      badge.style.background = 'rgba(57,255,20,0.08)';
      badge.style.border = '1px solid rgba(57,255,20,0.2)';
      badge.style.color = '#39FF14';
    }
    info.appendChild(badge);

    item.appendChild(icon); item.appendChild(info);

    if (isPlaying) {
      var eqW = document.createElement('div');
      eqW.style.cssText = 'display:flex;align-items:flex-end;gap:2px;height:16px';
      [0.6, 1, 0.7, 0.9].forEach(function(h, j) {
        var b = document.createElement('div');
        b.className = 'eq-bar';
        b.style.cssText = 'width:3px;border-radius:1px;background:' + color + ';height:' + (h*100) + '%;animation:eq-active ' + (0.3+Math.random()*0.5).toFixed(2) + 's ease-in-out ' + (j*0.06).toFixed(2) + 's infinite';
        eqW.appendChild(b);
      });
      item.appendChild(eqW);
    }
    list.appendChild(item);
  });

  // Pagination
  if (pagination) {
    pagination.innerHTML = '';
    if (remaining > 0) {
      var btn = document.createElement('button');
      btn.style.cssText = 'background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);color:#A1A1AA;padding:14px 40px;border-radius:14px;cursor:pointer;font-size:14px;font-weight:600;transition:all 0.2s';
      btn.textContent = 'Mehr anzeigen (' + remaining + ' weitere)';
      btn.onmouseenter = function() { btn.style.background = 'rgba(255,255,255,0.1)'; btn.style.borderColor = 'rgba(255,255,255,0.2)'; };
      btn.onmouseleave = function() { btn.style.background = 'rgba(255,255,255,0.06)'; btn.style.borderColor = 'rgba(255,255,255,0.12)'; };
      btn.onclick = function() {
        stationsDisplayCount += STATIONS_PER_PAGE;
        filterStations(document.getElementById('stationSearch').value);
      };
      pagination.appendChild(btn);
    }
    var countText = document.createElement('p');
    countText.style.cssText = 'color:#52525B;font-size:12px;margin-top:8px';
    countText.textContent = visible.length + ' von ' + filtered.length + ' Stationen angezeigt';
    pagination.appendChild(countText);
  }
}

document.getElementById('stationSearch').addEventListener('input', function(e) {
  stationsDisplayCount = STATIONS_PER_PAGE;
  filterStations(e.target.value);
});

// --- Premium Checkout (Server-Seat + Month Selector) ---
var MONTH_OPTIONS = [1, 3, 6, 12];
var SEAT_OPTIONS = [1, 2, 3, 5];
var YEARLY_DISCOUNT_MONTHS = 10;
var checkoutUpgradeInfo = null;

// Seat-based pricing in cents per month
var SEAT_PRICING = {
  pro:      { 1: 299, 2: 549, 3: 749, 5: 1149 },
  ultimate: { 1: 499, 2: 799, 3: 1099, 5: 1699 }
};

function calculateCheckoutPrice(pricePerMonth, months) {
  if (months >= 12) {
    var fullYears = Math.floor(months / 12);
    var remaining = months % 12;
    return (fullYears * YEARLY_DISCOUNT_MONTHS * pricePerMonth) + (remaining * pricePerMonth);
  }
  return months * pricePerMonth;
}

function getSeatPricePerMonth(tier, seats) {
  var pricing = SEAT_PRICING[tier];
  if (!pricing) return 0;
  return pricing[seats] || pricing[1] || 0;
}

function renderSeatButtons(tier) {
  var container = document.getElementById('seatButtons');
  if (!container) return;
  container.innerHTML = '';
  var modal = document.getElementById('premiumModal');
  var currentSeats = parseInt(modal.dataset.seats) || 1;
  var tierColors = { pro: '#FFB800', ultimate: '#BD00FF' };
  var color = tierColors[tier] || '#FFB800';

  SEAT_OPTIONS.forEach(function(seats) {
    var pricePerMonth = getSeatPricePerMonth(tier, seats);
    var priceLabel = (pricePerMonth / 100).toFixed(2).replace('.', ',') + '\u20ac';
    var isActive = seats === currentSeats;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'padding:10px 6px;border-radius:10px;cursor:pointer;text-align:center;transition:all 0.2s;' +
      'background:' + (isActive ? color + '12' : 'rgba(255,255,255,0.03)') + ';' +
      'border:1px solid ' + (isActive ? color + '40' : 'rgba(255,255,255,0.08)') + ';' +
      'color:' + (isActive ? color : '#A1A1AA');
    btn.innerHTML = '<div style="font-size:15px;font-weight:700;font-family:JetBrains Mono,monospace">' + seats + '</div>' +
      '<div style="font-size:10px;opacity:0.7">Server</div>' +
      '<div style="font-size:9px;margin-top:2px;color:' + (isActive ? color : '#52525B') + '">' + priceLabel + '/mo</div>';
    if (seats >= 5) {
      btn.innerHTML += '<div style="position:absolute;top:-8px;right:-4px;background:#39FF14;color:#050505;font-size:7px;font-weight:800;padding:2px 4px;border-radius:4px;font-family:Orbitron,sans-serif">BEST</div>';
      btn.style.position = 'relative';
    }
    btn.onclick = function() {
      modal.dataset.seats = String(seats);
      renderSeatButtons(tier);
      updatePriceDisplay();
    };
    container.appendChild(btn);
  });
}

function startCheckout(tier) {
  var modal = document.getElementById('premiumModal');
  var input = document.getElementById('premiumEmail');
  var statusEl = document.getElementById('premiumStatus');

  modal.style.display = 'flex';
  input.value = '';
  statusEl.textContent = '';
  modal.dataset.tier = tier;
  modal.dataset.months = '1';
  modal.dataset.seats = '1';
  modal.dataset.isUpgrade = 'false';
  checkoutUpgradeInfo = null;

  var tierColors = { pro: '#FFB800', ultimate: '#BD00FF' };
  var tierNames = { pro: 'Pro', ultimate: 'Ultimate' };
  var color = tierColors[tier] || '#FFB800';

  var icon = document.getElementById('premiumModalIcon');
  icon.style.background = color + '12';
  icon.style.border = '1px solid ' + color + '30';
  icon.style.color = color;

  var title = document.getElementById('premiumModalTitle');
  title.textContent = 'OmniFM ' + tierNames[tier];

  var submitBtn = document.getElementById('premiumSubmit');
  submitBtn.style.background = color;
  submitBtn.style.color = tier === 'ultimate' ? '#fff' : '#050505';
  submitBtn.disabled = false;

  var priceEl = document.getElementById('premiumPrice');
  priceEl.style.color = color;

  document.getElementById('premiumUpgradeBadge').style.display = 'none';
  document.getElementById('premiumMonthsRow').style.display = 'block';
  var seatRow = document.getElementById('seatSelectorRow');
  if (seatRow) seatRow.style.display = 'block';

  renderSeatButtons(tier);
  renderMonthButtons(tier);
  updatePriceDisplay();
}

function renderMonthButtons(tier) {
  var container = document.getElementById('monthButtons');
  container.innerHTML = '';
  var tierColors = { pro: '#FFB800', ultimate: '#BD00FF' };
  var color = tierColors[tier] || '#FFB800';
  var modal = document.getElementById('premiumModal');
  var selectedMonths = parseInt(modal.dataset.months) || 1;

  MONTH_OPTIONS.forEach(function(m) {
    var isActive = selectedMonths === m;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.style.cssText = 'padding:10px 4px;border-radius:10px;cursor:pointer;text-align:center;position:relative;transition:all 0.2s;' +
      'background:' + (isActive ? color + '12' : 'rgba(255,255,255,0.03)') + ';' +
      'border:1px solid ' + (isActive ? color + '40' : 'rgba(255,255,255,0.08)') + ';' +
      'color:' + (isActive ? color : '#A1A1AA');
    btn.innerHTML = '<div style="font-size:15px;font-weight:700;font-family:JetBrains Mono,monospace">' + m + '</div>' +
      '<div style="font-size:10px;opacity:0.7">Monat' + (m > 1 ? 'e' : '') + '</div>';
    if (m >= 12) {
      btn.innerHTML += '<div style="position:absolute;top:-8px;right:-4px;background:#39FF14;color:#050505;font-size:8px;font-weight:800;padding:2px 5px;border-radius:4px;font-family:Orbitron,sans-serif">-2 GRATIS</div>';
    }
    btn.onclick = function() {
      modal.dataset.months = String(m);
      renderMonthButtons(tier);
      updatePriceDisplay();
    };
    container.appendChild(btn);
  });
}

function updatePriceDisplay() {
  var modal = document.getElementById('premiumModal');
  var tier = modal.dataset.tier;
  var months = parseInt(modal.dataset.months) || 1;
  var seats = parseInt(modal.dataset.seats) || 1;

  var pricePerMonth = getSeatPricePerMonth(tier, seats);
  var totalCents, regularCents, hasDiscount;

  if (checkoutUpgradeInfo) {
    totalCents = checkoutUpgradeInfo.cost;
    regularCents = totalCents;
    hasDiscount = false;
  } else {
    totalCents = calculateCheckoutPrice(pricePerMonth, months);
    regularCents = months * pricePerMonth;
    hasDiscount = months >= 12 && regularCents > totalCents;
  }

  var priceStr = (totalCents / 100).toFixed(2).replace('.', ',');
  var priceEl = document.getElementById('premiumPrice');
  priceEl.textContent = priceStr + '\u20ac';

  var priceLabel = document.getElementById('premiumPriceLabel');
  var seatsLabel = seats > 1 ? ' (' + seats + ' Server)' : '';
  priceLabel.textContent = checkoutUpgradeInfo ? 'Upgrade-Preis' : months + ' Monat' + (months > 1 ? 'e' : '') + seatsLabel;

  var oldPriceEl = document.getElementById('premiumPriceOld');
  if (hasDiscount) {
    oldPriceEl.textContent = (regularCents / 100).toFixed(2).replace('.', ',') + '\u20ac';
    oldPriceEl.style.display = 'inline';
  } else {
    oldPriceEl.style.display = 'none';
  }

  var discountEl = document.getElementById('premiumDiscount');
  if (hasDiscount) {
    var saved = ((regularCents - totalCents) / 100).toFixed(2).replace('.', ',');
    discountEl.textContent = '2 Monate gratis! Du sparst ' + saved + '\u20ac';
    discountEl.style.display = 'block';
  } else {
    discountEl.style.display = 'none';
  }

  var perMonthEl = document.getElementById('premiumPerMonth');
  if (!checkoutUpgradeInfo && months > 1) {
    perMonthEl.textContent = '= ' + (totalCents / months / 100).toFixed(2).replace('.', ',') + '\u20ac/Monat' + seatsLabel;
    perMonthEl.style.display = 'block';
  } else {
    perMonthEl.style.display = 'none';
  }

  var submitBtn = document.getElementById('premiumSubmit');
  submitBtn.textContent = priceStr + '\u20ac bezahlen';
}

function checkExistingLicense() {
  // Email-based checkout - no pre-check needed
}

function closePremiumModal() {
  document.getElementById('premiumModal').style.display = 'none';
  checkoutUpgradeInfo = null;
}

function submitPremiumCheckout() {
  var modal = document.getElementById('premiumModal');
  var input = document.getElementById('premiumEmail');
  var submitBtn = document.getElementById('premiumSubmit');
  var statusEl = document.getElementById('premiumStatus');
  var tier = modal.dataset.tier;
  var months = parseInt(modal.dataset.months) || 1;
  var seats = parseInt(modal.dataset.seats) || 1;
  var email = input.value.trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    statusEl.textContent = 'Bitte eine gueltige E-Mail-Adresse eingeben!';
    statusEl.style.color = '#FF2A2A';
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Wird geladen...';

  fetch('/api/premium/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tier: tier, email: email, months: months, seats: seats, returnUrl: window.location.origin })
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.url) {
      window.location.href = data.url;
    } else {
      statusEl.textContent = data.error || 'Fehler beim Erstellen der Zahlung.';
      statusEl.style.color = '#FF2A2A';
      submitBtn.disabled = false;
      updatePriceDisplay();
    }
  })
  .catch(function(err) {
    statusEl.textContent = 'Verbindungsfehler: ' + err.message;
    statusEl.style.color = '#FF2A2A';
    submitBtn.disabled = false;
    updatePriceDisplay();
  });
}

// --- Check for payment success on page load ---
(function checkPaymentReturn() {
  var params = new URLSearchParams(window.location.search);
  var payment = params.get('payment');
  var sessionId = params.get('session_id');

  if (payment === 'success' && sessionId) {
    fetch('/api/premium/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: sessionId })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      var banner = document.getElementById('paymentBanner');
      if (data.success) {
        banner.style.display = 'flex';
        banner.style.background = 'rgba(57,255,20,0.1)';
        banner.style.borderColor = 'rgba(57,255,20,0.3)';
        var msg = data.message || 'Premium aktiviert!';
        if (data.licenseKey) {
          msg += ' Dein Lizenz-Key: ' + data.licenseKey;
        }
        banner.querySelector('span').textContent = msg;
        banner.querySelector('span').style.color = '#39FF14';
      } else {
        banner.style.display = 'flex';
        banner.style.background = 'rgba(255,42,42,0.1)';
        banner.style.borderColor = 'rgba(255,42,42,0.3)';
        banner.querySelector('span').textContent = data.message || 'Zahlung fehlgeschlagen.';
        banner.querySelector('span').style.color = '#FF2A2A';
      }
    }).catch(function() {});

    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
  }

  if (payment === 'cancelled') {
    var banner = document.getElementById('paymentBanner');
    banner.style.display = 'flex';
    banner.style.background = 'rgba(255,184,0,0.1)';
    banner.style.borderColor = 'rgba(255,184,0,0.3)';
    banner.querySelector('span').textContent = 'Zahlung abgebrochen.';
    banner.querySelector('span').style.color = '#FFB800';
    window.history.replaceState({}, '', window.location.pathname);
  }
})();

// --- Premium Status Check ---
function checkPremiumStatus() {
  var input = document.getElementById('premiumCheckInput');
  var result = document.getElementById('premiumCheckResult');
  var serverId = input.value.trim();

  if (!/^\d{17,22}$/.test(serverId)) {
    result.textContent = 'Server ID muss 17-22 Ziffern sein!';
    result.style.color = '#FF2A2A';
    return;
  }

  result.textContent = 'Pruefe...';
  result.style.color = '#A1A1AA';

  fetch('/api/premium/check?serverId=' + serverId)
  .then(function(r) { return r.json(); })
  .then(function(data) {
    var tierColors = { free: '#A1A1AA', pro: '#FFB800', ultimate: '#BD00FF' };
    result.style.color = tierColors[data.tier] || '#A1A1AA';

    if (data.license && !data.license.expired) {
      var expires = new Date(data.license.expiresAt);
      var expStr = expires.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      result.innerHTML = '<strong>' + data.name + '</strong> | ' +
        'Bitrate: ' + data.bitrate + ' | ' +
        'Reconnect: ' + data.reconnectMs + 'ms | ' +
        'Max Bots: ' + (data.maxBots || 0) + '<br>' +
        '<span style="font-size:12px;color:#A1A1AA">Laeuft ab: ' + expStr +
        ' (' + data.license.remainingDays + ' Tage uebrig), servergebunden auf diese Server-ID.</span>';
    } else if (data.license && data.license.expired) {
      result.innerHTML = '<strong style="color:#FF2A2A">Abgelaufen!</strong> ' +
        '<span style="font-size:12px;color:#A1A1AA">Ehemals: ' + (data.license.tier || 'unbekannt') + '</span>';
    } else {
      result.textContent = 'Tier: ' + data.name + ' | Bitrate: ' + data.bitrate + ' | Max Bots: ' + (data.maxBots || 0);
    }
  })
  .catch(function() {
    result.textContent = 'Fehler beim Pruefen.';
    result.style.color = '#FF2A2A';
  });
}

// --- Footer Stats ---
function renderFooterStats(data) {
  var el = document.getElementById('footerStats');
  var items = [
    { label: 'Server', value: data.servers || 0, color: '#00F0FF' },
    { label: 'Nutzer', value: data.users || 0, color: '#39FF14' },
    { label: 'Bots', value: data.bots || 0, color: '#EC4899' },
    { label: 'Stationen', value: data.stations || 0, color: '#FFB800' },
  ];
  el.innerHTML = '';
  items.forEach(function(s) {
    var div = document.createElement('div'); div.className = 'footer-stat';
    var num = document.createElement('span'); num.className = 'footer-stat-num';
    num.style.color = s.color; num.style.textShadow = '0 0 15px ' + s.color + '50';
    num.textContent = fmtInt(s.value);
    var lbl = document.createElement('span'); lbl.className = 'footer-stat-label'; lbl.textContent = s.label;
    div.appendChild(num); div.appendChild(lbl);
    el.appendChild(div);
  });
}

// --- Fetch & Refresh ---
async function fetchJson(url) {
  var res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(url + ' -> ' + res.status);
  return res.json();
}

async function refresh() {
  try {
    var results = await Promise.all([
      fetchJson('/api/bots'),
      fetchJson('/api/stations'),
    ]);

    var botsRes = results[0];
    var stationsRes = results[1];
    var bots = botsRes.bots || [];
    var totals = botsRes.totals || {};
    var stations = stationsRes.stations || [];

    renderBots(bots);
    renderStations(stations);
    renderFooterStats({ ...totals, bots: bots.length, stations: stationsRes.total || stations.length });

    document.getElementById('statServers').textContent = fmtInt(totals.servers);
    document.getElementById('statStations').textContent = fmtInt(stationsRes.total || stations.length);
    document.getElementById('statBots').textContent = fmtInt(bots.length);
  } catch (e) {
    console.error('API Fehler:', e);
  }
}

refresh();
setInterval(refresh, 15000);
