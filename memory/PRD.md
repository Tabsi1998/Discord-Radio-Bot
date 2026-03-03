# PRD - OmniFM Discord Radio Bot Fehleranalyse

## Original Problem Statement
Repo klonen (https://github.com/Tabsi1998/Discord-Radio-Bot) und komplette Fehleranalyse durchfuehren.
Hauptprobleme: /play funktioniert nicht, Reconnect-Timeouts, guild-languages.json Parse-Fehler, ephemeral Deprecation.

## ROOT CAUSE
Discord hat am 1-2. Maerz 2026 das DAVE E2EE-Protokoll fuer alle Voice-Verbindungen verpflichtend gemacht.
Dem Bot fehlten: Node.js 22+, @snazzah/davey, sodium-native, libsodium-wrappers.

## Implementierte Fixes
- FIX 0: DAVE Protokoll Support (Node.js 22, @snazzah/davey, sodium-native, libsodium-wrappers)
- FIX 1-7: album Bug, ephemeral->MessageFlags (133x), Voice-Timeout, Auto-Reconnect, guild-language Auto-Repair, JSON-Validierung, setEmoji Bug

## Delivery
- apply-fixes.sh Script erstellt und getestet gegen frischen Klon
- 147 Aenderungen in 6 Dateien, alle Syntax-Checks bestanden
- Script liegt unter /app/fixes/apply-fixes.sh

## Naechste Schritte
1. User muss apply-fixes.sh auf Server kopieren und ausfuehren
2. docker compose build --no-cache && docker compose up -d
3. Voice-Dependencies Report im Log pruefen
4. /play testen
