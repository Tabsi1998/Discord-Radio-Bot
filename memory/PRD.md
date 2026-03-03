# PRD - OmniFM Discord Radio Bot Fehleranalyse

## Original Problem Statement
Repo klonen (https://github.com/Tabsi1998/Discord-Radio-Bot) und komplette Fehleranalyse durchfuehren.
Hauptprobleme: /play funktioniert nicht, Reconnect-Timeouts, guild-languages.json Parse-Fehler, ephemeral Deprecation.

## Architektur
- Node.js Discord Bot mit Commander/Worker Pattern (1 Commander + 16 Worker)
- Docker-basiertes Deployment
- Datei-basierter State (kein MongoDB)
- @discordjs/voice fuer Audio-Streaming via ffmpeg

## Implementierte Fixes (Session 1)

### KRITISCH
1. **album undefined Bug** - `buildNowPlayingEmbedLegacy()` fehlte `album` Variable -> hinzugefuegt
2. **Voice-Timeout 20s -> 30s** - `entersState()` und `confirmBotVoiceChannel()` Timeouts erhoeht
3. **playInGuild Auto-Reconnect** - Bei Voice-Timeout wird jetzt `scheduleReconnect()` aufgerufen statt harter Reset
4. **ephemeral -> MessageFlags** - 133 Stellen migriert, `respondInteraction()` mit automatischer Konvertierung

### MODERAT
5. **guild-language-store Auto-Repair** - Korrupte Hauptdatei wird automatisch aus Backup repariert
6. **docker-entrypoint.sh JSON-Validierung** - Korrupte JSON-Dateien werden beim Start erkannt und repariert

### MINOR
7. **Triple setEmoji Bug** - YouTube-Button in Legacy-Methode gefixt

## Geaenderte Dateien
- src/bot/runtime.js (317 Zeilen geaendert)
- src/guild-language-store.js (27 Zeilen hinzugefuegt)
- docker-entrypoint.sh (9 Zeilen hinzugefuegt)

## Backlog / Empfehlungen
- P1: Netzwerk/Firewall pruefen (UDP muss offen sein fuer Discord Voice)
- P1: guild-languages.json auf Host manuell reparieren (echo '{}' > guild-languages.json)
- P2: sodium-native installieren fuer stabilere Voice-Encryption
- P2: MIME_TYPES Duplikat in runtime.js entfernen
- P3: Legacy-Methoden (buildNowPlayingEmbedLegacy/buildTrackLinkComponentsLegacy) entfernen falls nicht mehr genutzt

## Naechste Schritte
- Fixes in das produktive Repository uebernehmen
- Docker-Image neu bauen und deployen
- /play testen und Logs ueberwachen
