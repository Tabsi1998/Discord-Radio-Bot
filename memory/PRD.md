# PRD - OmniFM Discord Radio Bot

## Original Problem Statement
Der User moechte den Discord Radio Bot (https://github.com/Tabsi1998/Discord-Radio-Bot) vollstaendig betriebsbereit machen und mit erweiterten Features ausstatten.

## Architektur
- **Backend:** Node.js + Express.js + Discord.js
- **Datenbank:** MongoDB 7 (Docker-Service, mit JSON-Fallback)
- **Frontend:** React 18 + Recharts (Dashboard)
- **Deployment:** Docker Compose mit MongoDB + OmniFM Services
- **Pattern:** Commander/Worker (1 Commander + 16 Worker Bots)

## Abgeschlossene Arbeiten

### Phase 0: Bot-Reparatur (ABGESCHLOSSEN)
- DAVE E2EE Protocol, Node.js 22, Voice-Fixes, Dependency-Updates

### Phase 1: Statistik-System mit MongoDB (ABGESCHLOSSEN - 2026-03-03)
**MongoDB-Integration:**
- MongoDB Service in docker-compose.yml mit persistentem Volume
- Auto-Init aller Collections/Indizes bei Startup
- JSON-Fallback bleibt immer aktiv als Backup
- Automatische JSON->MongoDB Migration

**Erfasste Metriken (32, DSGVO-konform):**
- Hoerzeit (Gesamt/Durchschnitt/Laengste Session)
- Session-Tracking (Start/Ende/Dauer/Peak/Avg Listeners)
- Station-Popularitaet (Starts + Hoerzeit)
- Stunden/Wochentag-Verteilung
- Voice-Channel-Nutzung, Command-Usage
- Verbindungsgesundheit (Connects/Reconnects/Errors/%)
- Listener-Snapshots, Taegliche Aggregate, Globale Stats

**MongoDB Collections:** guild_stats, daily_stats, listening_sessions (TTL 180d), connection_events (TTL 90d), listener_snapshots (TTL 30d)

### Phase 2: Dashboard-Ueberarbeitung (ABGESCHLOSSEN - 2026-03-03)
**Neue Dashboard-Komponenten:**
- `DashboardOverview.js` - 6 Metrikkarten + 4 Charts (Stunde, Wochentag, Station-Pie, Daily-Trend) + Active Sessions + Session-Details
- `DashboardStats.js` - Ultimate-only: Hoerzeit-Verlauf, Station-Ranking, Command-Usage, Listener-Timeline, Session-History-Tabelle, Connection-Health, Channel-Usage
- `DashboardEvents.js` - Verbesserte Event-Verwaltung mit Toggle-Form, expandierbare Event-Cards, Status-Badges
- `DashboardPortal.js` - Schlankerer Shell mit neuen Tab-Routing

**Installierte Pakete:** recharts (Charts)

**Neue API-Endpunkte:**
- `GET /api/dashboard/stats/detail` - Ultimate: daily/session/connection/timeline
- `GET /api/stats/global` - Oeffentliche globale Stats

## Naechste Aufgaben

### Phase 3: Nachrichten-Editor (P2)
1. Markdown-Editor fuer Event-Nachrichten
2. Emoji-Picker (Server-Emojis, Standard-Emojis)
3. GIF-Integration
4. Vorschau-Funktion

### Backlog
- Tier-basierte Stats im /stats Slash-Command (Pro vs Ultimate)
- Stats-Export (CSV/JSON)
- Webhook-Benachrichtigungen bei Meilensteinen
- Woechentlicher Auto-Report als Discord-Embed
- Discord-Server-Sync (Rollen/Channels im Dashboard anzeigen)

## Geaenderte Dateien
- `docker-compose.yml` - MongoDB Service + Volume
- `docker-entrypoint.sh` - MongoDB Readiness-Check
- `src/lib/db.js` - Auto-Init Collections/Indizes
- `src/listening-stats-store.js` - MongoDB + Session-Tracking
- `src/bot/runtime.js` - Session/Connection-Events
- `src/api/server.js` - Neue Stats-Endpunkte
- `src/index.js` - Migration JSON->MongoDB
- `update.sh` - MongoDB Status/Doctor/Defaults
- `frontend/src/components/DashboardPortal.js` - Neugeschrieben
- `frontend/src/components/DashboardOverview.js` - NEU
- `frontend/src/components/DashboardStats.js` - NEU
- `frontend/src/components/DashboardEvents.js` - NEU
- `frontend/package.json` - recharts hinzugefuegt
