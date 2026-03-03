# PRD - OmniFM Discord Radio Bot

## Originalanforderung
Discord Radio Bot reparieren, erweitern und ein Dashboard bereitstellen.

## Architektur
- **Backend:** FastAPI (Python) auf Port 8001
- **Frontend:** React auf Port 3000
- **Datenbank:** MongoDB (Statistiken, Lizenzen, Settings)
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
- Update-Script (update.sh) mit MongoDB Health Checks

### Phase 3 - Statistik-System
- Listening Stats Store komplett auf MongoDB umgeschrieben
- Detaillierte Sessions, Listener Counts, Command Usage
- 31/31 Unit Tests bestanden

### Phase 4 - Dashboard Ueberarbeitung
- Tabbed Interface (Uebersicht, Events, Stations, Perms, Stats, Settings)
- DashboardOverview, DashboardStats (Charts mit Recharts)
- DashboardEvents - Vollstaendiger Event-Manager mit allen Slash-Command-Optionen
- DashboardCustomStations - CRUD fuer Custom Stations
- DashboardSettings - Weekly Digest und Fallback Station

### Phase 5 - Neue Features (Backend)
- Weekly Stats Digest (Cron Job in runtime.js)
- Fallback Station fuer Ultimate-Tier
- API-Endpunkte fuer Events, Custom Stations, Settings, Guild-Daten

### Phase 6 - P0 Dashboard Polish (03.03.2026)
- **Abo-Verwaltung (Subscription Management):**
  - Neuer Tab "Abo" im Dashboard mit CreditCard Icon
  - DashboardSubscription.js: Plan-Anzeige, Ablaufdatum, Tage verbleibend, Server-Slots, Lizenz-E-Mail
  - Warnungen bei bald ablaufendem oder abgelaufenem Abo
  - Upgrade/Verlaengerungs-Links zur Hauptseite
  - Plan-Feature-Uebersicht je Tier
  - API: GET /api/dashboard/license (Session-geschuetzt)
- **UI/UX Polish:**
  - "Zurueck zur Hauptseite" Button in der Dashboard-Sidebar
  - Plan-Box im Sidebar klickbar (oeffnet Abo-Tab)
  - Abo-Tab auch fuer Free-User zugaenglich

### Phase 7 - P1 Nachrichten-Editor + P2 Lifetime Stats (03.03.2026)
- **P1 Rich Message Editor (RichMessageEditor.js):**
  - Formatting Toolbar: Fett, Kursiv, Unterstrichen, Durchgestrichen, Code, Codeblock, Link
  - Discord Markdown Live-Vorschau (rendert alle Formatierungen inkl. Emojis)
  - Emoji-Picker mit Discord Server-Emojis (inkl. animierte)
  - Emoji-Suche im Picker
  - Placeholder-Buttons ({event}, {station}, {voice}, {time})
  - Cursor-basiertes Einfuegen und Selektion-Wrapping
  - API: GET /api/dashboard/emojis (Node.js + FastAPI, Session-geschuetzt)
  - Ersetzt den alten MessageEditor in DashboardEvents.js
- **P2 Lifetime Stats Verifizierung:**
  - Info-Banner in DashboardOverview mit Erklaerung der dauerhaften MongoDB-Speicherung
  - data-testid="lifetime-stats-info"

### Phase 8 - P0 Critical Bugfixes (03.03.2026)
- **Custom Station Leak Fix:**
  - /api/stations filtert jetzt NUR free + pro Stationen (keine custom: Prefix, kein Ultimate)
  - /api/stats zaehlt nur offizielle Stationen
  - Frontend filtert zusaetzlich client-seitig als Defense-in-Depth
  - Fix in: backend/server.py, src/api/server.js, web/app.js
- **License API 404 Fix:**
  - /api/dashboard/license Endpoint in Node.js Production Server (src/api/server.js) hinzugefuegt
  - Gibt Tier, License-Info, maskierte E-Mail, Seats etc. zurueck
  - Konsistent mit FastAPI-Implementation in backend/server.py
- **Hoerzeit-Berechnung Fix:**
  - endListeningSession() berechnet jetzt nur humanListeningMs (Zeit mit mind. 1 menschl. Zuhoerer)
  - getActiveSessionsForGuild() gibt currentHumanListeningMs zurueck
  - Aggregate stats (totalListeningMs, daily_stats) nutzen humanListeningMs statt durationMs
  - Bot-allein-Zeit wird nicht mehr gezaehlt
- **Log-Review:**
  - AcoustID no matches: Erwartetes Verhalten (Song-Erkennung)
  - Stream idle restart: Auto-Reconnect funktioniert korrekt
  - EBUSY atomic rename: Fallback auf direkten Write, nicht kritisch

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
- GET /api/dashboard/stats?serverId=X
- GET /api/dashboard/license?serverId=X
- GET /api/dashboard/emojis?serverId=X
- GET/POST/PATCH/DELETE /api/dashboard/events
- GET/POST/PUT/DELETE /api/dashboard/custom-stations
- GET/PUT /api/dashboard/settings
- GET/PUT /api/dashboard/perms
- GET /api/premium/check

## Datenbank-Schema
- **listening_stats:** guildId, dailyStats, listeningSessions, commandUsage, connectionEvents
- **guild_settings:** guildId, weeklyStats, fallbackStation
- **licenses:** _licenseId, tier, plan, seats, email, expiresAt, linkedServerIds
- **server_entitlements:** _serverId, licenseId
- **dashboard_state:** events, perms, telemetry
- **stations:** key, name, url, tier, genre

## Dateien
- backend/server.py - FastAPI Backend
- frontend/src/components/DashboardPortal.js - Dashboard Container
- frontend/src/components/DashboardSubscription.js - Abo-Verwaltung
- frontend/src/components/DashboardOverview.js - Uebersicht + Lifetime Stats
- frontend/src/components/DashboardStats.js - Detaillierte Statistiken
- frontend/src/components/DashboardEvents.js - Event-Manager
- frontend/src/components/DashboardCustomStations.js - Custom Stations
- frontend/src/components/DashboardSettings.js - Settings
- frontend/src/components/RichMessageEditor.js - Rich-Text-Editor
- frontend/src/lib/api.js - API Helper
- src/api/server.js - Bot API Server (Node.js)
- src/lib/db.js - MongoDB Verbindung
- src/listening-stats-store.js - Statistik-Store
- src/bot/runtime.js - Bot Runtime
- web/app.js - Hauptseite Frontend
- web/index.html - Hauptseite HTML
