# Discord Radio Bot - PRD & Implementation Log

## Original Problem Statement
Der Benutzer hat 16 Discord Radio Bots konfiguriert. Bot 1 und Bot 2 zeigen keine Slash-Commands (/) an, während die anderen 14 Bots korrekt funktionieren.

## Root Cause Analysis
Das Problem liegt höchstwahrscheinlich an einem oder mehreren der folgenden Ursachen:

1. **Missing `applications.commands` Scope**: Bot 1 und 2 wurden möglicherweise vor dem Hinzufügen des Slash-Command-Supports eingeladen und haben nicht den erforderlichen OAuth2 Scope.

2. **CLIENT_ID Mismatch**: Die CLIENT_ID in der .env-Datei stimmt möglicherweise nicht mit der tatsächlichen Application ID des Bots überein.

3. **Guild Command Sync Fehler**: Der Command-Sync beim Bot-Start könnte aufgrund von Rate-Limiting oder Berechtigungsproblemen fehlgeschlagen sein.

4. **Race Condition**: Commands wurden möglicherweise synchronisiert, bevor der Bot vollständig bereit war.

## Implemented Fixes (Jan 2026)

### 1. Verbesserte clientReady Handler (src/index.js)
- Async Handler mit await für sequentielle Ausführung
- 2 Sekunden Verzögerung vor Command-Sync um Guild-Cache zu populieren
- Automatischer Retry nach 10 Sekunden bei fehlgeschlagenem Sync

### 2. Verbesserte syncGuildCommandForGuild Methode (src/index.js)
- Ausführliche Logging mit Application ID und Command-Anzahl
- Spezifische Fehlerbehandlung für häufige Discord-API-Fehler:
  - 50001 (Missing Access): Bot hat keinen applications.commands Scope
  - 50013 (Missing Permissions): Bot hat nicht genug Berechtigungen
  - 10004 (Unknown Guild): Bot ist nicht mehr auf dem Server
- Keine sinnlosen Retries bei Berechtigungsproblemen

### 3. Verbesserte syncGuildCommands Methode (src/index.js)
- Detaillierte Statistiken über erfolgreiche/fehlgeschlagene Syncs
- Liste der fehlgeschlagenen Guilds mit Fehlermeldungen
- Automatische Tipps zur Problemlösung

### 4. Neue Diagnose-Methode diagnoseCommandSync (src/index.js)
- Prüft Application ID und CLIENT_ID Übereinstimmung
- Ruft existierende Commands pro Guild ab
- Identifiziert Missing Access Probleme

### 5. Neue Slash-Commands (src/commands.js)
- `/cmddiag`: Diagnose-Command für Server-Admins
- `/resync`: Manuelles Neu-Synchronisieren der Commands

### 6. Neues Diagnose-Script (src/diagnose-bots.js)
- Standalone-Script zur Überprüfung aller Bots
- Validiert Tokens, CLIENT_IDs, globale Commands
- Generiert korrekte Invite-URLs mit applications.commands Scope

## User Personas
- Discord Server Administratoren mit Multi-Bot-Setups
- Entwickler, die Discord Bots hosten

## Core Requirements (Static)
- 16 Bots müssen parallel laufen können
- Alle Bots müssen Slash-Commands registrieren können
- Fehlerdiagnose muss ohne Programmierkentnisse möglich sein

## What's Been Implemented
| Feature | Status | Date |
|---------|--------|------|
| Verbesserte Guild Command Sync | ✅ Implementiert | Jan 2026 |
| Fehlerbehandlung für Sync-Probleme | ✅ Implementiert | Jan 2026 |
| /cmddiag Diagnose-Command | ✅ Implementiert | Jan 2026 |
| /resync Manual-Sync-Command | ✅ Implementiert | Jan 2026 |
| diagnose-bots.js Script | ✅ Implementiert | Jan 2026 |
| Aktualisierte Dokumentation | ✅ Implementiert | Jan 2026 |

## Prioritized Backlog

### P0 (Kritisch - Für Benutzer zu erledigen)
- [ ] Bot 1 und 2 mit neuem Invite-Link (inkl. applications.commands) neu einladen
- [ ] `npm run diagnose` ausführen um genaue Probleme zu identifizieren

### P1 (Wichtig)
- [ ] Prüfen ob BOT_1_CLIENT_ID und BOT_2_CLIENT_ID in .env korrekt sind
- [ ] Nach Neustart `/cmddiag` auf betroffenen Servern ausführen

### P2 (Nice-to-Have)
- [ ] Web-Dashboard für Bot-Status und Command-Sync
- [ ] Discord Webhook für Sync-Fehler-Benachrichtigungen

## Next Tasks
1. Benutzer sollte `npm run diagnose` auf seinem Server ausführen
2. Invite-Links für Bot 1 und 2 neu generieren lassen
3. Bots neu einladen (ohne vorher zu entfernen)
4. Bot-Dienst neustarten
5. Mit `/cmddiag` auf einem betroffenen Server verifizieren
