# PRD - OmniFM Discord Radio Bot

## Original Problem Statement
Der User moechte den Discord Radio Bot (https://github.com/Tabsi1998/Discord-Radio-Bot) vollstaendig betriebsbereit machen. Initiale Anfrage war eine komplette Fehleranalyse und Behebung aller Probleme.

## Neue Features angefragt:
1. **Erweitertes Statistik-System** (P0) - anonymisiert, DSGVO-konform
2. **Dashboard-Ueberarbeitung** (P1) - Statistik-Visualisierung, Event-Management
3. **Markdown-Editor** fuer Nachrichten im Dashboard (P2)

## Architektur
- **Backend:** Node.js + Express.js + Discord.js
- **Datenbank:** MongoDB (neu, mit JSON-Fallback)
- **Deployment:** Docker (docker-compose.yml mit MongoDB Service)
- **Frontend:** React (Dashboard, unter /frontend)

## Abgeschlossene Arbeiten

### Phase 0: Bot-Reparatur (ABGESCHLOSSEN)
- DAVE E2EE Protocol Kompatibilitaet hergestellt
- Node.js 20 -> 22 Upgrade in Dockerfile
- Voice-Verbindungsprobleme behoben
- Dependency-Updates (discord.js 14.25.1, @discordjs/voice 0.19.0)
- 140+ deprecated ephemeral-Syntax ersetzt
- Repository bereinigt (keine temporaeren Dateien)

### Phase 1: Statistik-System (ABGESCHLOSSEN - 2026-03-03)
**MongoDB-Integration:**
- MongoDB Service zu docker-compose.yml hinzugefuegt (mit persistentem Volume)
- src/lib/db.js komplett ueberarbeitet: Auto-Init, Collections, Indexes, Reconnect
- docker-entrypoint.sh: MongoDB-Readiness-Check vor App-Start
- Automatische JSON->MongoDB Migration bei erster Verbindung
- JSON-Fallback bleibt immer aktiv als Backup

**Neue Dateien/Aenderungen:**
- `src/listening-stats-store.js` - Komplett neugeschrieben fuer MongoDB
- `src/lib/db.js` - Erweitert mit Auto-Init fuer 5 Collections
- `src/bot/runtime.js` - Session-Tracking, Connection-Events
- `src/api/server.js` - 2 neue API-Endpunkte
- `docker-compose.yml` - MongoDB Service hinzugefuegt
- `docker-entrypoint.sh` - MongoDB Readiness-Check
- `update.sh` - MongoDB Status in Doctor/Status, MONGO_URL/DB_NAME Defaults

**Erfasste Statistiken (anonymisiert, DSGVO-konform):**
- Hoerzeit pro Guild (Gesamt, Durchschnitt, Laengste Session)
- Session-Tracking (Start, Ende, Dauer, Peak/Avg Listeners)
- Stations-Popularitaet (nach Starts UND Hoerzeit)
- Stundenverteilung (wann wird am meisten gehoert)
- Wochentag-Verteilung
- Voice-Channel-Nutzung
- Command-Usage-Tracking
- Verbindungsgesundheit (Connects, Reconnects, Errors, Zuverlaessigkeit %)
- Listener-Snapshots (Zeitverlauf)
- Taegliche Aggregate (MongoDB)
- Globale Statistiken (uebergreifend)

**Neue API-Endpunkte:**
- `GET /api/dashboard/stats/detail` - Detaillierte Stats (Ultimate-only, mit daily/session/connection/timeline)
- `GET /api/stats/global` - Oeffentliche globale Statistiken

**MongoDB Collections:**
- `guild_stats` - Aggregierte Stats pro Guild
- `daily_stats` - Taegliche Aggregate (TTL: unbegrenzt)
- `listening_sessions` - Abgeschlossene Sessions (TTL: 180 Tage)
- `connection_events` - Verbindungsereignisse (TTL: 90 Tage)
- `listener_snapshots` - Listener-Zaehlung ueber Zeit (TTL: 30 Tage)

**Tests:** 32/32 bestanden (MongoDB + JSON fallback + Syntax)

## Naechste Aufgaben

### Phase 2: Dashboard-Ueberarbeitung (P1)
1. Dashboard-UI komplett ueberarbeiten
2. Statistik-Visualisierung mit Charts (Hoerzeit, Listener-Verlauf, Station-Ranking)
3. Stundenverteilung und Wochentag-Diagramme
4. Connection-Health Dashboard
5. Live-Status Anzeige

### Phase 3: Event-Management im Dashboard (P2)
1. CRUD-Interface fuer Scheduled Events
2. Kalenderansicht
3. Discord-Server-Sync (Rollen, Channels)

### Phase 4: Nachrichten-Editor (P2)
1. Markdown-Editor fuer Event-Nachrichten
2. Emoji-Picker (Server-Emojis, Standard-Emojis)
3. GIF-Integration
4. Vorschau-Funktion

## Backlog
- Tier-basierte Stats-Anzeige (Pro vs Ultimate) im /stats Command und Dashboard
- Export-Funktion fuer Stats (CSV/JSON)
- Webhook-Benachrichtigungen bei Meilensteinen
