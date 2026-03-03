# PRD - OmniFM Discord Radio Bot Fehleranalyse

## Original Problem Statement
Repo klonen (https://github.com/Tabsi1998/Discord-Radio-Bot) und komplette Fehleranalyse durchfuehren.
Hauptprobleme: /play funktioniert nicht, Reconnect-Timeouts, guild-languages.json Parse-Fehler, ephemeral Deprecation.

## ROOT CAUSE
Discord hat am 1-2. Maerz 2026 das DAVE E2EE-Protokoll fuer alle Voice-Verbindungen verpflichtend gemacht.
Dem Bot fehlten: Node.js 22+, @snazzah/davey, sodium-native, libsodium-wrappers.

## Architektur
- Node.js Discord Bot mit Commander/Worker Pattern (1 Commander + 16 Worker)
- Docker-basiertes Deployment (node:22-slim)
- Datei-basierter State (kein MongoDB)
- @discordjs/voice fuer Audio-Streaming via ffmpeg

## Implementierte Fixes (Session 1 + 2)

### SHOW-STOPPER (Root Cause fuer /play Fehler)
0. **DAVE Protokoll Support** - Node.js 20->22, @snazzah/davey, sodium-native, libsodium-wrappers hinzugefuegt
   - Dockerfile: node:20-slim -> node:22-slim + libsodium-dev
   - package.json: 3 neue Dependencies
   - index.js: Voice-Dependency-Report beim Start

### KRITISCH
1. **album undefined Bug** - buildNowPlayingEmbedLegacy() fehlte album Variable
2. **Voice-Timeout 20s -> 30s** - entersState() und confirmBotVoiceChannel() Timeouts erhoeht
3. **playInGuild Auto-Reconnect** - Bei Voice-Timeout scheduleReconnect() statt harter Reset
4. **ephemeral -> MessageFlags** - 133 Stellen migriert

### MODERAT
5. **guild-language-store Auto-Repair** - Korrupte Hauptdatei wird automatisch repariert
6. **docker-entrypoint.sh JSON-Validierung** - Korrupte JSON wird beim Start erkannt

### MINOR
7. **Triple setEmoji Bug** - YouTube-Button in Legacy-Methode gefixt

## Geaenderte Dateien (6 Dateien, 222 Einfuegungen, 148 Loeschungen)
- Dockerfile (Node 22 + libsodium-dev)
- package.json (3 neue Dependencies)
- src/index.js (Voice-Dependency-Report)
- src/bot/runtime.js (317 Zeilen geaendert)
- src/guild-language-store.js (Auto-Repair)
- docker-entrypoint.sh (JSON-Validierung)

## Naechste Schritte
1. Geaenderte Dateien auf Server uebertragen
2. guild-languages.json reparieren: echo '{}' > guild-languages.json
3. Docker Image neu bauen: docker compose build --no-cache
4. Bot neustarten: docker compose up -d
5. Voice-Dependencies im Log pruefen
6. /play testen

## Backlog
- P2: MIME_TYPES Duplikat in runtime.js entfernen
- P3: Legacy-Methoden entfernen falls nicht mehr genutzt
