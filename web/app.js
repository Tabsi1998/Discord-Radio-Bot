/* === Discord Radio Bot - Frontend v2.1 === */

var BOT_COLORS = [
  { name: 'cyan',   accent: '#00F0FF', glow: 'rgba(0,240,255,0.15)',  border: 'rgba(0,240,255,0.25)' },
  { name: 'green',  accent: '#39FF14', glow: 'rgba(57,255,20,0.15)',  border: 'rgba(57,255,20,0.25)' },
  { name: 'pink',   accent: '#EC4899', glow: 'rgba(236,72,153,0.15)', border: 'rgba(236,72,153,0.25)' },
  { name: 'amber',  accent: '#FFB800', glow: 'rgba(255,184,0,0.15)',  border: 'rgba(255,184,0,0.25)' },
  { name: 'purple', accent: '#BD00FF', glow: 'rgba(189,0,255,0.15)',  border: 'rgba(189,0,255,0.25)' },
  { name: 'red',    accent: '#FF2A2A', glow: 'rgba(255,42,42,0.15)',  border: 'rgba(255,42,42,0.25)' },
];

var STATION_COLORS = ['#00F0FF', '#39FF14', '#EC4899', '#FFB800', '#BD00FF', '#FF2A2A'];

// Bot-Bilder - die 4 Custom-Avatare cyclen
var BOT_IMAGES = ['/img/bot-1.png', '/img/bot-2.png', '/img/bot-3.png', '/img/bot-4.png'];

var COMMANDS = [
  { name: '/play',      args: '[station] [channel]', desc: 'Startet einen Radio-Stream im Voice-Channel' },
  { name: '/pause',     args: '',                     desc: 'Pausiert die aktuelle Wiedergabe' },
  { name: '/resume',    args: '',                     desc: 'Setzt die Wiedergabe fort' },
  { name: '/stop',      args: '',                     desc: 'Stoppt die Wiedergabe und verlässt den Channel' },
  { name: '/stations',  args: '',                     desc: 'Zeigt alle verfügbaren Radio-Stationen' },
  { name: '/list',      args: '[page]',               desc: 'Listet Stationen paginiert auf' },
  { name: '/now',       args: '',                     desc: 'Zeigt die aktuelle Station und Metadaten' },
  { name: '/setvolume', args: '<0-100>',              desc: 'Setzt die Lautstärke' },
  { name: '/status',    args: '',                     desc: 'Zeigt Bot-Status, Uptime und Last' },
  { name: '/health',    args: '',                     desc: 'Zeigt Stream-Health und Reconnect-Info' },
];

var fmt = new Intl.NumberFormat('de-DE');
function fmtInt(v) { return fmt.format(Number(v) || 0); }

var allStations = [];

// --- Navbar scroll ---
window.addEventListener('scroll', function() {
  var nav = document.getElementById('navbar');
  if (window.scrollY > 40) { nav.classList.add('scrolled'); }
  else { nav.classList.remove('scrolled'); }
});

// --- Equalizer bars ---
(function initEq() {
  var el = document.getElementById('equalizer');
  var heights = [0.4, 0.7, 0.5, 0.9, 0.6, 0.8, 0.3, 0.7, 0.5, 0.6, 0.8, 0.4];
  heights.forEach(function(h, i) {
    var bar = document.createElement('div');
    bar.className = 'eq-bar';
    bar.style.height = (h * 100) + '%';
    bar.style.animation = 'eq ' + (0.6 + Math.random() * 0.8).toFixed(2) + 's ease-in-out ' + (i * 0.08).toFixed(2) + 's infinite';
    el.appendChild(bar);
  });
})();

// --- Commands (static) ---
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
      argsSpan.textContent = cmd.args;
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

// --- Render Bots (dynamisch - beliebig viele) ---
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
    card.addEventListener('mouseenter', function() {
      card.style.borderColor = c.border;
      card.style.boxShadow = '0 0 40px ' + c.glow;
    });
    card.addEventListener('mouseleave', function() {
      card.style.borderColor = '';
      card.style.boxShadow = '';
    });

    // Akzent-Balken
    var bar = document.createElement('div');
    bar.className = 'accent-bar';
    bar.style.background = c.accent;
    card.appendChild(bar);

    // Bot-Avatar + Name
    var head = document.createElement('div');
    head.className = 'bot-head';

    var icon = document.createElement('div');
    icon.className = 'bot-icon';
    icon.style.background = 'linear-gradient(135deg,' + c.accent + '22,' + c.accent + '08)';
    icon.style.border = '1px solid ' + c.accent + '33';
    icon.style.overflow = 'hidden';

    var img = document.createElement('img');
    img.src = botImg;
    img.alt = bot.name || 'Bot';
    img.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:12px';
    img.onerror = function() {
      // Fallback auf SVG-Icon
      this.style.display = 'none';
      icon.innerHTML += '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' + c.accent + '" stroke-width="2"><path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/></svg>';
    };
    icon.appendChild(img);

    var info = document.createElement('div');
    var name = document.createElement('div');
    name.className = 'bot-name';
    name.textContent = bot.name || 'Bot';
    var tag = document.createElement('div');
    tag.className = 'bot-tag';
    tag.textContent = bot.userTag || 'Bereit';
    info.appendChild(name);
    info.appendChild(tag);
    head.appendChild(icon);
    head.appendChild(info);
    card.appendChild(head);

    // Status
    var status = document.createElement('div');
    status.className = 'bot-status';
    var dot = document.createElement('div');
    dot.className = 'bot-status-dot ' + (bot.ready ? 'online' : 'offline');
    status.appendChild(dot);
    status.appendChild(document.createTextNode(bot.ready ? 'Online' : 'Konfigurierbar'));
    if (bot.servers > 0) {
      var srvSpan = document.createElement('span');
      srvSpan.style.cssText = 'margin-left:8px;color:#A1A1AA';
      srvSpan.textContent = fmtInt(bot.servers) + ' Server';
      status.appendChild(srvSpan);
    }
    card.appendChild(status);

    // Actions
    var actions = document.createElement('div');
    actions.className = 'bot-actions';

    var invBtn = document.createElement('a');
    invBtn.className = 'invite-btn';
    invBtn.href = url;
    invBtn.target = '_blank';
    invBtn.rel = 'noopener noreferrer';
    invBtn.style.background = c.accent;
    invBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3"/></svg> Einladen';
    actions.appendChild(invBtn);

    var cpBtn = document.createElement('button');
    cpBtn.className = 'copy-btn';
    cpBtn.type = 'button';
    cpBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    cpBtn.addEventListener('click', function() { copyText(url, cpBtn); });
    actions.appendChild(cpBtn);

    card.appendChild(actions);
    grid.appendChild(card);
  });
}

// --- Audio Player ---
var currentAudio = null;
var currentPlayingKey = null;

function playStation(station) {
  stopStation();
  currentAudio = new Audio(station.url);
  currentAudio.play().then(function() {
    currentPlayingKey = station.key;
    updateNowPlaying(station);
    filterStations(document.getElementById('stationSearch').value);
  }).catch(function() {
    currentPlayingKey = null;
    updateNowPlaying(null);
  });
  currentAudio.onerror = function() {
    currentPlayingKey = null;
    updateNowPlaying(null);
    filterStations(document.getElementById('stationSearch').value);
  };
}

function stopStation() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  currentPlayingKey = null;
  updateNowPlaying(null);
  filterStations(document.getElementById('stationSearch').value);
}

function updateNowPlaying(station) {
  var container = document.getElementById('nowPlaying');
  if (!station) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'flex';
  container.innerHTML = '';

  // EQ icon
  var eqWrap = document.createElement('div');
  eqWrap.style.cssText = 'display:flex;align-items:flex-end;gap:2px;height:18px';
  [0.5, 0.8, 0.6, 1, 0.7].forEach(function(h, i) {
    var b = document.createElement('div');
    b.className = 'eq-bar';
    b.style.cssText = 'width:3px;border-radius:1px;background:#00F0FF;height:' + (h*100) + '%;animation-duration:' + (0.4+Math.random()*0.6).toFixed(2) + 's;animation-delay:' + (i*0.08).toFixed(2) + 's';
    eqWrap.appendChild(b);
  });
  container.appendChild(eqWrap);

  var name = document.createElement('span');
  name.style.cssText = 'font-size:14px;font-weight:600;flex:1';
  name.textContent = station.name;
  container.appendChild(name);

  var stopBtn = document.createElement('button');
  stopBtn.style.cssText = 'display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:rgba(255,255,255,0.1);border:none;color:#fff;cursor:pointer';
  stopBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  stopBtn.onclick = stopStation;
  container.appendChild(stopBtn);
}

// --- Render Stations with Play button ---
function renderStations(stations) {
  allStations = stations || [];
  document.getElementById('stationCount').textContent = allStations.length + ' verfügbare Stationen. Klicke zum Vorhören oder nutze /play im Discord.';
  filterStations('');
}

function filterStations(query) {
  var list = document.getElementById('stationList');
  list.innerHTML = '';
  var q = (query || '').toLowerCase().trim();
  var filtered = allStations.filter(function(s) {
    if (!q) return true;
    return s.name.toLowerCase().indexOf(q) !== -1 || s.key.toLowerCase().indexOf(q) !== -1;
  });

  if (filtered.length === 0) {
    list.innerHTML = '<p class="muted" style="padding:40px;text-align:center">Keine Stationen gefunden.</p>';
    return;
  }

  filtered.forEach(function(s, i) {
    var color = STATION_COLORS[i % STATION_COLORS.length];
    var isPlaying = currentPlayingKey === s.key;
    var item = document.createElement('div');
    item.className = 'station-item';
    item.style.cursor = 'pointer';
    if (isPlaying) {
      item.style.background = color + '10';
      item.style.borderColor = color + '30';
    }

    item.onclick = function() {
      if (isPlaying) { stopStation(); } else { playStation(s); }
    };

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
    info.style.cssText = 'flex:1;min-width:0';
    var nm = document.createElement('div');
    nm.className = 'station-name';
    nm.textContent = s.name;
    var ky = document.createElement('div');
    ky.className = 'station-key';
    ky.textContent = s.key;
    info.appendChild(nm);
    info.appendChild(ky);

    item.appendChild(icon);
    item.appendChild(info);

    if (isPlaying) {
      var eqWrap = document.createElement('div');
      eqWrap.style.cssText = 'display:flex;align-items:flex-end;gap:2px;height:16px';
      [0.6, 1, 0.7, 0.9].forEach(function(h, j) {
        var b = document.createElement('div');
        b.className = 'eq-bar';
        b.style.cssText = 'width:3px;border-radius:1px;background:' + color + ';height:' + (h*100) + '%;animation-duration:' + (0.4+Math.random()*0.6).toFixed(2) + 's;animation-delay:' + (j*0.1).toFixed(2) + 's';
        eqWrap.appendChild(b);
      });
      item.appendChild(eqWrap);
    }

    list.appendChild(item);
  });
}

// --- Station search ---
document.getElementById('stationSearch').addEventListener('input', function(e) {
  filterStations(e.target.value);
});

// --- Footer Stats ---
function renderFooterStats(data) {
  var el = document.getElementById('footerStats');
  var items = [
    { label: 'Server', value: data.servers || 0, color: '#00F0FF' },
    { label: 'Nutzer', value: data.users || 0, color: '#39FF14' },
    { label: 'Verbindungen', value: data.connections || 0, color: '#EC4899' },
    { label: 'Zuhörer', value: data.listeners || 0, color: '#FFB800' },
  ];
  el.innerHTML = '';
  items.forEach(function(s) {
    var div = document.createElement('div');
    div.className = 'footer-stat';
    var num = document.createElement('span');
    num.className = 'footer-stat-num';
    num.style.color = s.color;
    num.style.textShadow = '0 0 15px ' + s.color + '50';
    num.textContent = fmtInt(s.value);
    var lbl = document.createElement('span');
    lbl.className = 'footer-stat-label';
    lbl.textContent = s.label;
    div.appendChild(num);
    div.appendChild(lbl);
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
    renderFooterStats(totals);

    // Hero stats
    document.getElementById('statServers').textContent = fmtInt(totals.servers);
    document.getElementById('statStations').textContent = fmtInt(stationsRes.total || stations.length);
    document.getElementById('statBots').textContent = fmtInt(bots.length);
  } catch (e) {
    console.error('API Fehler:', e);
  }
}

refresh();
setInterval(refresh, 15000);
