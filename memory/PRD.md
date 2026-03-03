# PRD - OmniFM Discord Radio Bot

## Originalanforderung
Discord Radio Bot reparieren, erweitern und ein Dashboard bereitstellen.

## Architektur
- **Backend:** FastAPI (Python) auf Port 8001
- **Frontend:** React auf Port 3000
- **Datenbank:** MongoDB (Statistiken, Lizenzen, Settings, Custom Stations)
- **Bot:** Node.js mit discord.js (Docker-basiert, Commander/Worker)
- **Auth:** Discord OAuth2 SSO

## Abgeschlossene Features

### Phase 1 - Bot Reparatur
- /play Command und Voice-Verbindung repariert
- Auto-Reconnect implementiert

### Phase 2 - MongoDB Integration
- MongoDB Service in docker-compose.yml
- src/lib/db.js fuer DB-Verbindung
- Migration von JSON zu MongoDB

### Phase 3 - Statistik-System
- Listening Stats Store komplett auf MongoDB umgeschrieben
- Detaillierte Sessions, Listener Counts, Command Usage

### Phase 4 - Dashboard Ueberarbeitung
- Tabbed Interface (Uebersicht, Events, Stations, Perms, Stats, Settings, Abo)
- Recharts-basierte Statistik-Visualisierung
- Event-Manager, Custom Stations CRUD, Settings

### Phase 5 - Neue Features (Backend)
- Weekly Stats Digest, Fallback Station, API-Endpunkte

### Phase 6 - Dashboard Polish (03.03.2026)
- Abo-Verwaltung Tab mit Plan-Anzeige, Seats, License-Info
- "Zurueck zur Hauptseite" Button, Plan-Box klickbar

### Phase 7 - Rich Message Editor + Lifetime Stats (03.03.2026)
- Rich Text Editor mit Discord Markdown, Emoji-Picker, Placeholders
- Lifetime Stats Info-Banner in DashboardOverview

### Phase 8 - P0 Critical Bugfixes (03.03.2026)
- Custom Station Leak Fix (nur free+pro oeffentlich)
- License API 404 Fix (Endpoint in Node.js hinzugefuegt)
- Hoerzeit-Berechnung Fix (nur humanListeningMs gezaehlt)

### Phase 9 - Emoji-Picker + Stats-Reset + P1 Haertung (03.03.2026)
- **Emoji-Picker Erweiterung:**
  - 8 Kategorien: Personen, Natur, Essen, Aktivitaeten, Reisen, Objekte, Symbole, Flaggen
  - Hunderte Standard-Unicode-Emojis pro Kategorie
  - Tab-basierte Navigation mit Kategorie-Buttons
  - Server Custom Emojis (animiert + statisch) als eigener Tab
  - Suche ueber Server-Emojis
  - Saubere Trennung: Unicode-Emojis direkt eingefuegt, Custom-Emojis als Discord-Syntax
- **Stats-Reset Button:**
  - Button "Statistiken zuruecksetzen" in DashboardStats
  - Sicherheitsabfrage mit Ja/Nein Bestaetigungsdialog
  - DELETE /api/dashboard/stats/reset Endpoint (beide Backends)
  - Loescht: daily_stats, listening_sessions, listener_snapshots, guild_stats
  - Reset in-memory Stats (Node.js: resetGuildStats Funktion)
- **P1 Backend-Haertung (API Konsistenz):**
  - GET /api/dashboard/stats/detail - Detaillierte Stats (FastAPI hinzugefuegt)
  - GET/PUT /api/dashboard/settings - Guild Settings (FastAPI hinzugefuegt)
  - GET /api/dashboard/channels - Voice/Text Channels (FastAPI hinzugefuegt)
  - GET /api/dashboard/roles - Server Rollen (FastAPI hinzugefuegt)
  - GET /api/dashboard/stations - Alle Stationen fuer Dashboard (FastAPI hinzugefuegt)
  - CRUD /api/dashboard/custom-stations - Custom Stations CRUD (FastAPI hinzugefuegt)
  - Custom Stations: Max 50 pro Server, Limit-Pruefung in Backend
  - Alle Endpoints mit Auth-Check, Rate-Limiting, Input-Validierung

## Offene Tasks

### P1
- TypeScript-Migration Empfehlung evaluieren

### Backlog
- Stats-Export
- Webhook-Benachrichtigungen
- Rollen-Dropdown statt Textfeld bei Berechtigungen

## Schluessel-API-Endpunkte
- GET /api/health
- GET /api/bots, /api/workers
- GET /api/stations (nur free + pro, KEINE custom)
- GET /api/stats (nur offizielle Stationen gezaehlt)
- GET /api/dashboard/guilds
- GET /api/dashboard/stats, /api/dashboard/stats/detail
- DELETE /api/dashboard/stats/reset
- GET /api/dashboard/license
- GET /api/dashboard/emojis
- GET /api/dashboard/channels, /api/dashboard/roles
- GET /api/dashboard/stations
- CRUD /api/dashboard/custom-stations (GET/POST/PUT/DELETE)
- GET/PUT /api/dashboard/settings
- CRUD /api/dashboard/events
- GET/PUT /api/dashboard/perms
- POST /api/dashboard/telemetry
- GET /api/premium/check

## Datenbank-Schema
- **listening_sessions:** guildId, stationKey, startedAt, endedAt, durationMs, humanListeningMs, peakListeners
- **daily_stats:** guildId, date, totalStarts, totalListeningMs, totalSessions, peakListeners
- **guild_stats:** guildId, totalListeningMs, totalSessions, totalStarts, peakListeners, stationListeningMs, commands
- **guild_settings:** guildId, weeklyDigest, fallbackStation
- **custom_stations:** guildId, key, name, url, genre (max 50 pro Server)
- **stations:** key, name, url, tier, genre
- **listener_snapshots:** guildId, timestamp, listeners

## Dateien
- backend/server.py - FastAPI Backend (alle Dashboard-Endpoints)
- frontend/src/components/DashboardPortal.js - Dashboard Container
- frontend/src/components/DashboardSubscription.js - Abo-Verwaltung
- frontend/src/components/DashboardOverview.js - Uebersicht
- frontend/src/components/DashboardStats.js - Statistiken + Reset
- frontend/src/components/DashboardEvents.js - Event-Manager
- frontend/src/components/DashboardCustomStations.js - Custom Stations
- frontend/src/components/DashboardSettings.js - Settings
- frontend/src/components/RichMessageEditor.js - Rich-Text-Editor + Emoji-Picker
- frontend/src/components/emojiData.js - Unicode Emoji-Kategorien
- src/api/server.js - Bot API Server (Node.js)
- src/listening-stats-store.js - Statistik-Store + resetGuildStats
- src/custom-stations.js - Custom Stations Store (JSON-basiert)
- web/app.js - Hauptseite Frontend
- web/index.html - Hauptseite HTML
