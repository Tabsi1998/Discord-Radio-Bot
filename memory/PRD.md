# PRD – OmniFM Web Dashboard (Phase A/B/C)

## Original Problem Statement (aktueller Scope)
- Erstes Fix: Premium-Preisbereich soll korrekt "ab Preis" anzeigen.
- Danach komplette Umsetzung:
  - **Phase A**: Discord OAuth + Session + Guild Picker + Plan Gating (Dashboard ab PRO) + Protected Routes
  - **Phase B**: Events UI, Permissions UI, Stats UI (guild-spezifisch, datenschutzkonform)
  - **Phase C**: Pricing/Plan-Matrix + Command-Matrix + Ultimate Promo (YouTube Live) + UX-Polish
- User-Wahlen:
  - 1a Discord OAuth only
  - 2a Dashboard ab PRO
  - 3a Modules: Server Selection + Events + Perms + Stats
  - 4b Ultimate im Dashboard vorerst als Promo (keine volle Runtime-Konfiguration im UI)
  - 5a starke Website-Kommunikation Free/Pro/Ultimate
  - keine öffentlichen Top-Server/Top-Station/Peak Daten

## Architecture Decisions
- Bestehender React + FastAPI Stack beibehalten und erweitert.
- OAuth-Session über sichere Cookie-Session (`omnifm_session`) im Backend.
- Dashboard APIs strikt auth-geschützt; Guild-Zugriff nur mit Discord "Manage Server" Permission.
- Plan-Gating serverseitig via Lizenz/Tier (`free`, `pro`, `ultimate`).
- Guild-spezifische Dashboard-Daten in `dashboard.json`/Mongo (`events`, `perms`, `telemetry`).

## Implemented
### UI/Website
- Premium-Karten korrigiert: **"ab Preis"** + numerisch sauber (`2.99 EUR`, `4.99 EUR`).
- Neues Dashboard-Portal (`?page=dashboard`) mit:
  - Discord SSO Login View
  - Dashboard Shell (Sidebar + Topbar)
  - Guild Picker
  - Tabs: Übersicht, Events, Permissions, Stats
  - PRO-Gate für Free-Server
  - Ultimate Promo-Block (YouTube Live)
- Landing erweitert um:
  - Plan-Matrix (Free/Pro/Ultimate)
  - Command-Matrix
  - Ultimate YouTube Livestream Promo in Hero/Matrix
- Navbar erweitert um Dashboard-Zugang.

### Backend/API
- Discord OAuth Endpoints:
  - `GET /api/auth/discord/login`
  - `GET /api/auth/discord/callback`
  - `GET /api/auth/session`
  - `POST /api/auth/logout`
- Dashboard Endpoints (auth + guild-scope):
  - `GET /api/dashboard/guilds`
  - `GET /api/dashboard/stats`
  - `GET/POST/PATCH/DELETE /api/dashboard/events`
  - `GET/PUT /api/dashboard/perms`
  - `POST /api/dashboard/telemetry` (admin ingest)
- CORS Methoden erweitert (GET/POST/PUT/PATCH/DELETE/OPTIONS).

### Configuration
- Backend `.env` erweitert um Discord OAuth Werte:
  - `DISCORD_CLIENT_ID`
  - `DISCORD_CLIENT_SECRET`
  - `DISCORD_REDIRECT_URI`
  - `DISCORD_OAUTH_SCOPES`

## Validation
- Frontend Build: ✅
- Python Lint: ✅
- JS Lint (geänderte Dateien): ✅
- Backend Tests: ✅ (`21 passed, 13 skipped` inkl. Legacy-Skips)
- Testing Agent Iteration 7: ✅ (Auth/API/UI Regression geprüft)
- Bugfix nach Testreport: ✅ Casing fix von `AB PREIS` -> `ab Preis`

## Prioritized Backlog
### P0
- Discord OAuth in produktiver Domain final umstellen (`omnifm.xyz` Redirect + PUBLIC_WEB_URL).
- Optional: Session Store persistent/redis statt In-Memory für Multi-Instance.

### P1
- Dashboard UX vertiefen: Event-Zeitplan mit Wochentagen + Repeat-Builder + Validation.
- Permission-UI mit Rollen-Autocomplete aus Discord API.

### P2
- Ultimate Runtime-Controls im Dashboard (Fallback/YouTube-Reconnect) direkt per UI.
- Telemetry-Pipeline vom Bot live in `/api/dashboard/telemetry` integrieren.

## Next Tasks
1. Produktionsumstellung für `omnifm.xyz` OAuth Redirect + DNS/SSL validieren.
2. Discord Rollen-/Channel-Daten in Dashboard automatisch laden.
3. Event-Builder + Analytics Visuals (Charts) ausbauen.


## Incremental Update – Station Browser Polish
- Search input im Station-Verzeichnis visuell an Dark-Theme angepasst (kein weißes Feld mehr, klare Focus-State).
- Tier-Filter bereinigt: `Ultimate`-Tab im Station-Browser entfernt.
- Summary/Filter-Texte bereinigt: kein `0 ultimate` mehr in der Anzeige.
- Verifiziert im Preview: Suchfeld passt optisch, Filter zeigt nur All/Free/Pro.


## Incremental Update – update.sh Hardening & Dashboard Settings
- `update.sh` um Dashboard-spezifische Defaults erweitert (`DISCORD_*`, Session TTL/Cookie, State TTL).
- Neue Health-Checks eingebaut: Dashboard OAuth-Status wird beim Start und in `--settings` sichtbar geprüft.
- `--settings` erweitert um Punkt **Dashboard & Discord OAuth** (Client ID/Secret/Redirect/Scopes/TTL/Cookie, Auto-Fix CORS/Public URL).
- Fehlerpfade entschärft: bei ungültigen Eingaben (`Public URL`, `DBL`, `AcoustID`, OAuth) bricht das Script nicht mehr hart mit `exit 1` ab, sondern warnt und läuft sauber weiter.
- Wartbarkeit verbessert: `dashboard.json` wird automatisch erzeugt/gesichert und in Backup-Pruning berücksichtigt.


## Incremental Update – update.sh UX Loop (Batch Settings)
- `--settings` ist jetzt als **intuitiver Mehrfach-Loop** umgesetzt: mehrere Punkte nacheinander aenderbar ohne rauszufliegen.
- Neuer Abschlussfluss:
  - `10) Fertig -> einmal neu starten`
  - `11) Fertig ohne Neustart`
- Aenderungen werden gesammelt und als **einmaliger Neustart am Ende** ausgefuehrt (statt nach jeder Einzelaktion).
- Ungueltige Eingaben fuehren nicht mehr zum harten Abbruch, sondern geben Warnung aus und bleiben im Setup-Menue.
