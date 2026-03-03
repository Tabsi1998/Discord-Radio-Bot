# PRD - OmniFM Discord Radio Bot

## Original Problem Statement
Discord Radio Bot: /play funktioniert nicht, Voice-Timeouts, Reconnect-Probleme.

## ROOT CAUSE (2 Probleme)
1. Discord DAVE E2EE Protokoll seit 01.03.2026 Pflicht -> Fehlende Dependencies
2. Voice Connection stuck at "signalling" -> sendPayload/configureNetworking Bug in Multi-Bot Setup

## Implementierte Fixes (finale Version - 1 sauberer Commit)

### Voice Connection (Hauptproblem)
- Custom voiceAdapterCreator Wrapper mit sendPayload-Logging
- configureNetworking() Workaround fuer Signalling->Connecting Transitions
- Debug-Logging fuer alle Voice State-Transitions
- Timeout 20s->30s, Auto-Reconnect bei Timeout statt harter Reset

### DAVE E2EE Support
- Dockerfile: node:20->22 + libsodium-dev
- package.json: @snazzah/davey, sodium-native, libsodium-wrappers, discord.js ^14.18

### Weitere Fixes
- 133x ephemeral->MessageFlags.Ephemeral
- album undefined in buildNowPlayingEmbedLegacy
- guild-language-store Auto-Repair
- docker-entrypoint.sh JSON-Validierung
- Triple setEmoji Bug

## Geaenderte Dateien (6 Dateien, 295+, 153-)
- Dockerfile, package.json, docker-entrypoint.sh
- src/index.js, src/guild-language-store.js, src/bot/runtime.js

## Code-Qualitaet
- 38 JS-Dateien geprueft: ALLE Syntax OK
- Keine offenen TODO/FIXME/BUG Marker
- Frontend App.js: Syntax OK

## Status
- Fixes bereit zum Deployment
- Voice-Debug-Logging aktiviert fuer Diagnose falls "signalling" weiterhin haengt
