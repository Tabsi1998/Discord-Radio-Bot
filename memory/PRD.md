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
  - DashboardSubscription.js Komponente: Plan-Anzeige, Ablaufdatum, verbleibende Tage, Server-Slots, Lizenz-E-Mail
  - Warnungen bei bald ablaufendem oder abgelaufenem Abo
  - Upgrade/Verlaengerungs-Links zur Hauptseite
  - Plan-Feature-Uebersicht je Tier
  - API-Endpunkt: GET /api/dashboard/license (Session-geschuetzt)
- **UI/UX Polish:**
  - "Zurueck zur Hauptseite" Button in der Dashboard-Sidebar
  - Plan-Box im Sidebar klickbar (oeffnet Abo-Tab)
  - Abo-Tab auch fuer Free-User zugaenglich (zeigt Upgrade-Info)

## Offene Tasks

### P1 - Nachrichten-Editor
- Rich-Text-Editor mit Markdown, Emojis, GIFs und Live-Vorschau
- Fuer Bot-Nachrichten im Event-Creator

### P2 - Lifetime Stats Verifizierung
- Bestaetigung der dauerhaften Statistik-Speicherung kommunizieren

### Backlog
- Stats-Export
- Webhook-Benachrichtigungen
- Rollen-Dropdown statt Textfeld bei Berechtigungen

## Schluessel-API-Endpunkte
- GET /api/health
- GET /api/bots, /api/workers
- GET /api/dashboard/guilds
- GET /api/dashboard/stats?serverId=X
- GET /api/dashboard/license?serverId=X
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
- frontend/src/components/DashboardOverview.js
- frontend/src/components/DashboardStats.js
- frontend/src/components/DashboardEvents.js
- frontend/src/components/DashboardCustomStations.js
- frontend/src/components/DashboardSettings.js
- frontend/src/lib/api.js - API Helper
- src/api/server.js - Bot API Server (Node.js)
- src/lib/db.js - MongoDB Verbindung
- src/listening-stats-store.js - Statistik-Store
- src/bot/runtime.js - Bot Runtime
