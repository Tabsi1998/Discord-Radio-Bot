# PRD - OmniFM Discord Radio Bot

## Original Problem Statement
Discord Radio Bot vollstaendig betriebsbereit machen und mit erweiterten Features ausstatten.

## Architektur
- **Backend:** Node.js + Express.js + Discord.js
- **Datenbank:** MongoDB 7 (Docker-Service, mit JSON-Fallback)
- **Frontend:** React 18 + Recharts (Dashboard)
- **Deployment:** Docker Compose (MongoDB + OmniFM)
- **Pattern:** Commander/Worker (1 Commander + 16 Worker Bots)

## Abgeschlossen

### Phase 0: Bot-Reparatur
DAVE E2EE, Node.js 22, Voice-Fixes, Dependencies

### Phase 1: Statistik-System (2026-03-03)
- MongoDB mit Auto-Init, JSON-Fallback, Migration
- 32 anonymisierte Metriken, 5 Collections
- Session-Tracking, Connection-Events, Daily Aggregates
- API: /api/dashboard/stats/detail, /api/stats/global

### Phase 2: Dashboard-Ueberarbeitung (2026-03-03)
- DashboardOverview: 6 Metriken + 4 Charts + Active Sessions
- DashboardStats: Ultimate-Analytics mit 7 Visualisierungen
- recharts Bibliothek integriert

### Phase 3: Erweiterte Features (2026-03-03)

**Events-Formular komplett ueberarbeitet:**
- Station-Dropdown (Free/Pro/Custom gruppiert, 140+ Stations)
- Voice-Channel-Dropdown (automatisch vom Discord-Server gesynct)
- Text-Channel-Dropdown (fuer Ankuendigungen)
- Start + Dauer + Timezone + Repeat (Taeglich/Werktags/WE/Woechentlich)
- Discord-Server-Event Toggle, Stage Topic, Description
- Message-Editor mit Markdown-Vorschau + Platzhalter ({event},{station},{voice},{time})
- Expandierbare Event-Cards mit allen Details

**Custom Stations Management (Neuer Tab):**
- Alle Custom Stations einsehen/bearbeiten/hinzufuegen/loeschen
- Inline-Editing mit Sofort-Speicherung
- Key/Name/URL/Genre Felder

**Woechentlicher Stats-Digest:**
- Konfigurierbar pro Guild: Channel, Wochentag, Uhrzeit
- Embed mit Wochen-Zusammenfassung (Hoerzeit, Sessions, Starts, Peak, Top 5 Stations)
- Automatische Ausfuehrung per Intervall-Check

**Fallback-Station (Ultimate):**
- User-konfigurierbarer Fallback statt nur automatischer Stations-Fallback
- Wenn eine Station nicht erreichbar ist, springt der Bot auf die Fallback-Station
- In Einstellungen-Tab konfigurierbar

**Discord-Server-Sync:**
- API: /api/dashboard/channels (Voice + Text + Stage)
- API: /api/dashboard/roles (sortiert nach Position)
- Dropdowns statt manuelle ID-Eingabe

**Neue API-Endpunkte:**
- GET /api/dashboard/channels
- GET /api/dashboard/stations
- GET/POST/PUT/DELETE /api/dashboard/custom-stations
- GET /api/dashboard/roles
- GET/PUT /api/dashboard/settings

**MongoDB Collections (neu):**
- guild_settings (weekly digest, fallback station)

## Dashboard-Tabs
1. Uebersicht (Stats-Cards + Charts)
2. Events (Vollstaendiges Event-Management)
3. Custom Stations (CRUD)
4. Berechtigungen (Rollenrechte pro Command)
5. Statistiken (Ultimate-Analytics)
6. Einstellungen (Digest + Fallback)

## Geaenderte Dateien (Phase 3)
- src/api/server.js - 6 neue Endpunkte + erweiterte Event-Felder
- src/bot/runtime.js - User-Fallback-Station
- src/index.js - Weekly Digest Cron
- src/lib/db.js - guild_settings Collection
- frontend/src/components/DashboardPortal.js - 2 neue Tabs
- frontend/src/components/DashboardEvents.js - Komplett neugeschrieben
- frontend/src/components/DashboardCustomStations.js - NEU
- frontend/src/components/DashboardSettings.js - NEU

## Backlog
- Tier-basierte Stats im /stats Slash-Command (Pro vs Ultimate)
- Stats-Export (CSV/JSON)
- Webhook-Benachrichtigungen bei Meilensteinen
- Rollen-Dropdown statt Textfeld bei Berechtigungen
