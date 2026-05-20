// ============================================================
// OmniFM: Admin-Panel API-Routen
// Zugang: ADMIN_TOKEN, API_ADMIN_TOKEN oder ADMIN_API_TOKEN in .env setzen
// URL:    /admin  (nicht verlinkt, nur für Betreiber)
// Auth:   ?token=xxx  ODER  Authorization: Bearer xxx ODER X-Admin-Token
//
// Endpunkte:
//   GET  /admin                  → Admin-Panel HTML
//   GET  /api/admin/overview     → Bot-Status, Guilds, Lizenzen
//   GET  /api/admin/licenses     → Alle Lizenzen
//   POST /api/admin/licenses/:id → Lizenz patchen (aktivieren, verlängern, sperren)
//   GET  /api/admin/guilds       → Alle Guilds mit Status
//   GET  /api/admin/logs         → Letzte Operator-Incidents
//   GET  /api/admin/stations     → Alle Stationen (inkl. Health-Status)
//   POST /api/admin/stations     → Station hinzufügen/bearbeiten
// ============================================================

export function createAdminRoutesHandler(deps) {
  const {
    ADMIN_TOKEN,
    getStationHealthReport,
    listLicenses,
    patchLicenseById,
    loadStations,
    log,
    methodNotAllowed,
    sendJson,
    runtimes,
    getRecentOperatorIncidents,
    resolveAdminToken,
  } = deps;

  /**
   * Prüft ob der Request einen gültigen Admin-Token hat.
   */
  function isAuthorized(req, requestUrl) {
    const adminToken = String(resolveAdminToken?.() || ADMIN_TOKEN || "").trim();
    if (!adminToken) return false;
    const authHeader = String(req.headers?.authorization || "").trim();
    const bearerToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const headerToken = String(req.headers?.["x-admin-token"] || "").trim();
    const queryToken = String(requestUrl?.searchParams?.get("token") || "").trim();
    return bearerToken === adminToken || headerToken === adminToken || queryToken === adminToken;
  }

  function unauthorized(res) {
    res.writeHead(401, {
      "Content-Type": "text/plain",
      "WWW-Authenticate": 'Bearer realm="OmniFM Admin"',
    });
    res.end("Unauthorized");
  }

  return async function handleAdminRoutes(context) {
    const { req, res, requestUrl } = context;
    const pathname = requestUrl?.pathname || "";

    // ---- Admin-Panel HTML ----
    if (pathname === "/admin" || pathname === "/admin/") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      if (!isAuthorized(req, requestUrl)) { unauthorized(res); return true; }

      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(buildAdminHtml());
      return true;
    }

    // ---- API: Nur /api/admin/* ----
    if (!pathname.startsWith("/api/admin/") && pathname !== "/api/admin") return false;

    if (!isAuthorized(req, requestUrl)) { unauthorized(res); return true; }

    // GET /api/admin/overview
    if (pathname === "/api/admin/overview" || pathname === "/api/admin") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }

      const botStats = (runtimes || []).map((r) => {
        const stats = r.collectStats?.() || {};
        return {
          name: r.config?.name || "?",
          role: r.role || "worker",
          online: Boolean(r.client?.isReady?.()),
          guilds: Number(stats.servers || 0),
          connections: Number(stats.connections || 0),
          listeners: Number(stats.listeners || 0),
          uptime: r.startedAt ? Math.floor((Date.now() - r.startedAt) / 1000) : null,
        };
      });

      const licenses = listLicenses?.() || {};
      const licenseList = Object.values(licenses);
      const activeLicenses = licenseList.filter((l) => l?.active && !l?.expired).length;
      const expiredLicenses = licenseList.filter((l) => l?.expired || (l?.expiresAt && new Date(l.expiresAt) < new Date())).length;

      const stationHealth = getStationHealthReport?.() || [];
      const stationsUp = stationHealth.filter((s) => s.status === "up").length;
      const stationsDown = stationHealth.filter((s) => s.status === "down").length;

      sendJson(res, 200, {
        bots: botStats,
        licenses: { total: licenseList.length, active: activeLicenses, expired: expiredLicenses },
        stations: { total: stationHealth.length, up: stationsUp, down: stationsDown },
        serverTime: new Date().toISOString(),
      });
      return true;
    }

    // GET /api/admin/licenses
    if (pathname === "/api/admin/licenses") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const licenses = listLicenses?.() || {};
      sendJson(res, 200, { licenses });
      return true;
    }

    // POST /api/admin/licenses/:id
    const licenseMatch = pathname.match(/^\/api\/admin\/licenses\/([^/]+)$/);
    if (licenseMatch) {
      if (req.method !== "POST" && req.method !== "PATCH") { methodNotAllowed(res, ["POST", "PATCH"]); return true; }
      const licenseId = decodeURIComponent(licenseMatch[1]);
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const patch = JSON.parse(body || "{}");
          // Sicherheit: Nur erlaubte Felder patchen
          const allowed = ["active", "expired", "expiresAt", "plan", "tier", "seats", "linkedServerIds", "contactEmail", "notes"];
          const safePatch = {};
          for (const key of allowed) {
            if (key in patch) safePatch[key] = patch[key];
          }
          patchLicenseById?.(licenseId, safePatch);
          log?.("INFO", `[Admin] Lizenz ${licenseId} gepatcht: ${JSON.stringify(safePatch)}`);
          sendJson(res, 200, { ok: true, licenseId, patched: safePatch });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err?.message || "Ungültiger Body" });
        }
      });
      return true;
    }

    // GET /api/admin/guilds
    if (pathname === "/api/admin/guilds") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const guilds = [];
      for (const runtime of (runtimes || [])) {
        if (!runtime.client?.isReady?.()) continue;
        for (const [guildId, guild] of (runtime.client.guilds?.cache || new Map()).entries()) {
          const state = runtime.getState?.(guildId) || {};
          guilds.push({
            id: guildId,
            name: guild.name || "?",
            memberCount: guild.memberCount || 0,
            bot: runtime.config?.name || "?",
            playing: Boolean(state.playing),
            station: state.currentStationKey || null,
            volume: state.volume ?? null,
          });
        }
      }
      guilds.sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));
      sendJson(res, 200, { guilds, total: guilds.length });
      return true;
    }

    // GET /api/admin/logs
    if (pathname === "/api/admin/logs") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const incidents = getRecentOperatorIncidents?.() || [];
      sendJson(res, 200, { incidents });
      return true;
    }

    // GET /api/admin/stations
    if (pathname === "/api/admin/stations") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const stationsData = loadStations?.() || {};
      const healthReport = getStationHealthReport?.() || [];
      const healthMap = Object.fromEntries(healthReport.map((h) => [h.key, h]));

      const stations = Object.entries(stationsData?.stations || {}).map(([key, s]) => ({
        key,
        name: s.name || key,
        url: s.url || null,
        tier: s.tier || "free",
        genre: s.genre || null,
        health: healthMap[key] || null,
      }));

      sendJson(res, 200, { stations, total: stations.length });
      return true;
    }

    return false;
  };
}

// ============================================================
// Admin-Panel HTML (Single-Page, inline CSS+JS, kein Framework)
// ============================================================
function buildAdminHtml() {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>OmniFM Admin</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a0a;color:#e4e4e7;min-height:100vh}
    .topbar{background:#111;border-bottom:1px solid #222;padding:12px 24px;display:flex;align-items:center;gap:12px}
    .topbar h1{font-size:16px;font-weight:700;color:#00F0FF;letter-spacing:0.1em}
    .topbar .badge{font-size:10px;background:#FF2A2A;color:#fff;padding:2px 8px;border-radius:20px;font-weight:700}
    .container{max-width:1200px;margin:0 auto;padding:24px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}
    .card{background:#111;border:1px solid #222;border-radius:12px;padding:20px}
    .card h3{font-size:11px;font-weight:700;letter-spacing:0.1em;color:#71717a;text-transform:uppercase;margin-bottom:8px}
    .card .val{font-size:28px;font-weight:800;font-family:monospace}
    .card .sub{font-size:12px;color:#52525b;margin-top:4px}
    .cyan{color:#00F0FF}.green{color:#39FF14}.red{color:#FF2A2A}.amber{color:#FFB800}.purple{color:#BD00FF}
    .section{background:#111;border:1px solid #222;border-radius:12px;margin-bottom:24px;overflow:hidden}
    .section-header{padding:16px 20px;border-bottom:1px solid #222;display:flex;align-items:center;justify-content:space-between}
    .section-header h2{font-size:13px;font-weight:700;letter-spacing:0.05em}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{padding:10px 16px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#71717a;text-transform:uppercase;border-bottom:1px solid #1a1a1a}
    td{padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#d4d4d8}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:#161616}
    .badge-online{display:inline-block;width:8px;height:8px;border-radius:50%;background:#39FF14;margin-right:6px}
    .badge-offline{display:inline-block;width:8px;height:8px;border-radius:50%;background:#FF2A2A;margin-right:6px}
    .badge-up{color:#39FF14;font-size:11px;font-weight:700}
    .badge-down{color:#FF2A2A;font-size:11px;font-weight:700}
    .badge-unknown{color:#71717a;font-size:11px;font-weight:700}
    .btn{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:none}
    .btn-cyan{background:#00F0FF;color:#050505}
    .btn-red{background:#FF2A2A;color:#fff}
    .btn-amber{background:#FFB800;color:#050505}
    .tabs{display:flex;gap:4px;padding:12px 20px;border-bottom:1px solid #222}
    .tab{padding:6px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:none;background:transparent;color:#71717a}
    .tab.active{background:#1a1a1a;color:#fff}
    #content{padding:0}
    .loading{padding:40px;text-align:center;color:#52525b;font-size:13px}
    .error-msg{padding:16px 20px;color:#FF2A2A;font-size:13px}
    .refresh-btn{font-size:11px;color:#52525b;cursor:pointer;background:none;border:none;padding:4px 8px;border-radius:6px}
    .refresh-btn:hover{color:#fff;background:#1a1a1a}
    input[type=text],input[type=email]{background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#fff;padding:8px 12px;font-size:13px;outline:none;width:100%}
    .modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:100;align-items:center;justify-content:center}
    .modal.open{display:flex}
    .modal-box{background:#111;border:1px solid #333;border-radius:16px;padding:28px;max-width:480px;width:100%;max-height:80vh;overflow-y:auto}
    .modal-box h3{font-size:15px;font-weight:700;margin-bottom:16px}
    .form-row{margin-bottom:12px}
    .form-row label{display:block;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px}
    .form-actions{display:flex;gap:8px;margin-top:16px}
  </style>
</head>
<body>
  <div class="topbar">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></svg>
    <h1>OMNIFM ADMIN</h1>
    <span class="badge">INTERN</span>
    <span style="margin-left:auto;font-size:12px;color:#52525b" id="serverTime"></span>
    <button class="refresh-btn" onclick="loadAll()">↻ Aktualisieren</button>
  </div>

  <div class="container">
    <!-- Stats Grid -->
    <div class="grid" id="statsGrid">
      <div class="card"><h3>Bots Online</h3><div class="val cyan" id="statBots">–</div><div class="sub">von gesamt</div></div>
      <div class="card"><h3>Guilds</h3><div class="val green" id="statGuilds">–</div><div class="sub">aktive Server</div></div>
      <div class="card"><h3>Lizenzen</h3><div class="val amber" id="statLicenses">–</div><div class="sub">aktiv / gesamt</div></div>
      <div class="card"><h3>Stationen</h3><div class="val" id="statStations">–</div><div class="sub">UP / DOWN</div></div>
    </div>

    <!-- Tabs -->
    <div class="section">
      <div class="tabs">
        <button class="tab active" onclick="showTab('bots')">🤖 Bots</button>
        <button class="tab" onclick="showTab('guilds')">🏠 Guilds</button>
        <button class="tab" onclick="showTab('licenses')">🔑 Lizenzen</button>
        <button class="tab" onclick="showTab('stations')">📻 Stationen</button>
        <button class="tab" onclick="showTab('logs')">📋 Logs</button>
      </div>
      <div id="content"><div class="loading">Lade Daten...</div></div>
    </div>
  </div>

  <!-- Lizenz-Edit Modal -->
  <div class="modal" id="licenseModal" onclick="if(event.target===this)closeLicenseModal()">
    <div class="modal-box">
      <h3>Lizenz bearbeiten</h3>
      <input type="hidden" id="editLicenseId"/>
      <div class="form-row"><label>Plan</label><input type="text" id="editPlan" placeholder="free / pro / ultimate"/></div>
      <div class="form-row"><label>Aktiv</label><input type="text" id="editActive" placeholder="true / false"/></div>
      <div class="form-row"><label>Abläuft am (ISO)</label><input type="text" id="editExpiresAt" placeholder="2025-12-31T00:00:00.000Z"/></div>
      <div class="form-row"><label>Seats</label><input type="text" id="editSeats" placeholder="1"/></div>
      <div class="form-row"><label>Notizen</label><input type="text" id="editNotes" placeholder="Interne Notiz..."/></div>
      <div class="form-actions">
        <button class="btn btn-cyan" onclick="saveLicense()">Speichern</button>
        <button class="btn" style="background:#1a1a1a;color:#fff" onclick="closeLicenseModal()">Abbrechen</button>
        <button class="btn btn-red" onclick="revokeLicense()">Sperren</button>
      </div>
      <p id="licenseEditStatus" style="margin-top:10px;font-size:12px;color:#52525b"></p>
    </div>
  </div>

  <script>
    const TOKEN = new URLSearchParams(location.search).get('token') || '';
    const AUTH = TOKEN ? '?token=' + encodeURIComponent(TOKEN) : '';

    async function api(path) {
      const r = await fetch('/api/admin/' + path + AUTH);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }

    async function apiPost(path, body) {
      const r = await fetch('/api/admin/' + path + AUTH, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }

    let currentTab = 'bots';
    let cachedData = {};

    function showTab(tab) {
      currentTab = tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      event.target.classList.add('active');
      renderTab(tab);
    }

    function renderTab(tab) {
      const el = document.getElementById('content');
      const d = cachedData;
      if (tab === 'bots') {
        if (!d.overview) { el.innerHTML = '<div class="loading">Lade...</div>'; return; }
        el.innerHTML = '<table><thead><tr><th>Bot</th><th>Rolle</th><th>Status</th><th>Guilds</th><th>Verbindungen</th><th>Zuhörer</th><th>Uptime</th></tr></thead><tbody>' +
          d.overview.bots.map(b => '<tr>' +
            '<td><b>' + esc(b.name) + '</b></td>' +
            '<td style="color:#71717a">' + esc(b.role) + '</td>' +
            '<td>' + (b.online ? '<span class="badge-online"></span><span class="green">Online</span>' : '<span class="badge-offline"></span><span class="red">Offline</span>') + '</td>' +
            '<td>' + b.guilds + '</td>' +
            '<td>' + b.connections + '</td>' +
            '<td>' + b.listeners + '</td>' +
            '<td style="color:#71717a">' + (b.uptime != null ? fmtUptime(b.uptime) : '–') + '</td>' +
          '</tr>').join('') + '</tbody></table>';
      } else if (tab === 'guilds') {
        if (!d.guilds) { el.innerHTML = '<div class="loading">Lade...</div>'; return; }
        el.innerHTML = '<table><thead><tr><th>Server</th><th>ID</th><th>Mitglieder</th><th>Bot</th><th>Spielt</th><th>Station</th></tr></thead><tbody>' +
          d.guilds.guilds.slice(0,200).map(g => '<tr>' +
            '<td><b>' + esc(g.name) + '</b></td>' +
            '<td style="font-family:monospace;color:#71717a;font-size:11px">' + esc(g.id) + '</td>' +
            '<td>' + g.memberCount + '</td>' +
            '<td style="color:#71717a">' + esc(g.bot) + '</td>' +
            '<td>' + (g.playing ? '<span class="green">▶ Ja</span>' : '<span style="color:#52525b">–</span>') + '</td>' +
            '<td style="color:#71717a;font-size:12px">' + esc(g.station || '–') + '</td>' +
          '</tr>').join('') + '</tbody></table>' +
          (d.guilds.total > 200 ? '<div style="padding:12px 16px;font-size:12px;color:#52525b">Zeige 200 von ' + d.guilds.total + ' Guilds</div>' : '');
      } else if (tab === 'licenses') {
        if (!d.licenses) { el.innerHTML = '<div class="loading">Lade...</div>'; return; }
        const lics = Object.entries(d.licenses.licenses || {});
        el.innerHTML = '<table><thead><tr><th>ID</th><th>Plan</th><th>Aktiv</th><th>Läuft ab</th><th>Seats</th><th>E-Mail</th><th>Aktion</th></tr></thead><tbody>' +
          lics.map(([id, l]) => {
            const expired = l.expiresAt && new Date(l.expiresAt) < new Date();
            return '<tr>' +
              '<td style="font-family:monospace;font-size:11px;color:#71717a">' + esc(id.slice(0,16)) + '…</td>' +
              '<td><b style="color:' + planColor(l.plan||l.tier) + '">' + esc(l.plan||l.tier||'free') + '</b></td>' +
              '<td>' + (l.active && !expired ? '<span class="green">✓</span>' : '<span class="red">✗</span>') + '</td>' +
              '<td style="font-size:12px;color:' + (expired?'#FF2A2A':'#71717a') + '">' + (l.expiresAt ? l.expiresAt.slice(0,10) : '–') + '</td>' +
              '<td>' + (l.seats||1) + '</td>' +
              '<td style="font-size:12px;color:#71717a">' + esc(l.contactEmail||'–') + '</td>' +
              '<td><button class="btn btn-amber" style="font-size:11px;padding:4px 10px" onclick="editLicense(' + JSON.stringify(id) + ')">Bearbeiten</button></td>' +
            '</tr>';
          }).join('') + '</tbody></table>';
      } else if (tab === 'stations') {
        if (!d.stations) { el.innerHTML = '<div class="loading">Lade...</div>'; return; }
        el.innerHTML = '<table><thead><tr><th>Key</th><th>Name</th><th>Tier</th><th>Health</th><th>Antwortzeit</th><th>Fehler</th></tr></thead><tbody>' +
          d.stations.stations.map(s => '<tr>' +
            '<td style="font-family:monospace;font-size:11px;color:#71717a">' + esc(s.key) + '</td>' +
            '<td><b>' + esc(s.name) + '</b></td>' +
            '<td style="color:' + planColor(s.tier) + ';font-size:11px;font-weight:700">' + esc(s.tier||'free') + '</td>' +
            '<td>' + healthBadge(s.health) + '</td>' +
            '<td style="font-size:12px;color:#71717a">' + (s.health?.responseTimeMs != null ? s.health.responseTimeMs + 'ms' : '–') + '</td>' +
            '<td style="font-size:12px;color:' + (s.health?.consecutiveFailures > 0 ? '#FF2A2A' : '#52525b') + '">' + (s.health?.consecutiveFailures || 0) + '</td>' +
          '</tr>').join('') + '</tbody></table>';
      } else if (tab === 'logs') {
        if (!d.logs) { el.innerHTML = '<div class="loading">Lade...</div>'; return; }
        const incidents = d.logs.incidents || [];
        if (!incidents.length) { el.innerHTML = '<div class="loading">Keine Incidents.</div>'; return; }
        el.innerHTML = '<table><thead><tr><th>Zeit</th><th>Level</th><th>Nachricht</th></tr></thead><tbody>' +
          incidents.slice(0,100).map(i => '<tr>' +
            '<td style="font-size:11px;color:#71717a;white-space:nowrap">' + esc(i.timestamp||i.time||'') + '</td>' +
            '<td><span style="color:' + levelColor(i.level) + ';font-size:11px;font-weight:700">' + esc(i.level||'INFO') + '</span></td>' +
            '<td style="font-size:12px;max-width:600px;overflow:hidden;text-overflow:ellipsis">' + esc(String(i.message||i.msg||'')) + '</td>' +
          '</tr>').join('') + '</tbody></table>';
      }
    }

    async function loadAll() {
      document.getElementById('serverTime').textContent = 'Lädt...';
      try {
        const [overview, guilds, licenses, stations, logs] = await Promise.allSettled([
          api('overview'), api('guilds'), api('licenses'), api('stations'), api('logs')
        ]);
        if (overview.status === 'fulfilled') {
          cachedData.overview = overview.value;
          const o = overview.value;
          const onlineBots = o.bots.filter(b => b.online).length;
          document.getElementById('statBots').textContent = onlineBots + '/' + o.bots.length;
          document.getElementById('statBots').className = 'val ' + (onlineBots === o.bots.length ? 'green' : onlineBots > 0 ? 'amber' : 'red');
          const totalGuilds = o.bots.reduce((s,b) => s + b.guilds, 0);
          document.getElementById('statGuilds').textContent = totalGuilds;
          document.getElementById('statLicenses').textContent = o.licenses.active + '/' + o.licenses.total;
          document.getElementById('statStations').textContent = o.stations.up + ' UP / ' + o.stations.down + ' DOWN';
          document.getElementById('statStations').className = 'val ' + (o.stations.down > 0 ? 'amber' : 'green');
          document.getElementById('serverTime').textContent = new Date(o.serverTime).toLocaleTimeString('de-AT');
        }
        if (guilds.status === 'fulfilled') cachedData.guilds = guilds.value;
        if (licenses.status === 'fulfilled') cachedData.licenses = licenses.value;
        if (stations.status === 'fulfilled') cachedData.stations = stations.value;
        if (logs.status === 'fulfilled') cachedData.logs = logs.value;
        renderTab(currentTab);
      } catch(e) {
        document.getElementById('content').innerHTML = '<div class="error-msg">Fehler: ' + esc(e.message) + '</div>';
      }
    }

    function editLicense(id) {
      const l = cachedData.licenses?.licenses?.[id];
      if (!l) return;
      document.getElementById('editLicenseId').value = id;
      document.getElementById('editPlan').value = l.plan || l.tier || 'free';
      document.getElementById('editActive').value = String(l.active !== false);
      document.getElementById('editExpiresAt').value = l.expiresAt || '';
      document.getElementById('editSeats').value = l.seats || 1;
      document.getElementById('editNotes').value = l.notes || '';
      document.getElementById('licenseEditStatus').textContent = '';
      document.getElementById('licenseModal').classList.add('open');
    }

    function closeLicenseModal() {
      document.getElementById('licenseModal').classList.remove('open');
    }

    async function saveLicense() {
      const id = document.getElementById('editLicenseId').value;
      const patch = {
        plan: document.getElementById('editPlan').value.trim(),
        active: document.getElementById('editActive').value.trim() === 'true',
        expiresAt: document.getElementById('editExpiresAt').value.trim() || null,
        seats: parseInt(document.getElementById('editSeats').value) || 1,
        notes: document.getElementById('editNotes').value.trim() || null,
      };
      try {
        await apiPost('licenses/' + encodeURIComponent(id), patch);
        document.getElementById('licenseEditStatus').textContent = '✓ Gespeichert';
        document.getElementById('licenseEditStatus').style.color = '#39FF14';
        setTimeout(() => { closeLicenseModal(); loadAll(); }, 800);
      } catch(e) {
        document.getElementById('licenseEditStatus').textContent = '✗ Fehler: ' + e.message;
        document.getElementById('licenseEditStatus').style.color = '#FF2A2A';
      }
    }

    async function revokeLicense() {
      if (!confirm('Lizenz wirklich sperren?')) return;
      const id = document.getElementById('editLicenseId').value;
      try {
        await apiPost('licenses/' + encodeURIComponent(id), { active: false, expired: true });
        closeLicenseModal();
        loadAll();
      } catch(e) {
        document.getElementById('licenseEditStatus').textContent = '✗ ' + e.message;
      }
    }

    function esc(s) {
      return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function planColor(p) {
      if (p === 'ultimate') return '#BD00FF';
      if (p === 'pro') return '#FFB800';
      return '#39FF14';
    }
    function levelColor(l) {
      if (l === 'ERROR') return '#FF2A2A';
      if (l === 'WARN') return '#FFB800';
      return '#71717a';
    }
    function healthBadge(h) {
      if (!h) return '<span class="badge-unknown">–</span>';
      if (h.status === 'up') return '<span class="badge-up">▲ UP</span>';
      if (h.status === 'down') return '<span class="badge-down">▼ DOWN</span>';
      return '<span class="badge-unknown">?</span>';
    }
    function fmtUptime(s) {
      const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
      return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
    }

    // Auto-Refresh alle 30s
    loadAll();
    setInterval(loadAll, 30000);
  </script>
</body>
</html>`;
}
