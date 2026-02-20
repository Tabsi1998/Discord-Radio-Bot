# Discord Radio Bot - PRD v19

## Architektur
- Node.js Bot Backend (Discord, Express), FastAPI Preview Backend, React Frontend, Stripe Payments, JSON-Datenbank

## Alle Features Implementiert

### Auto-Reconnect nach Restart (P0 Fix - Feb 2026)
- Event von deprecated "ready" auf "clientReady" geaendert
- 2 Sekunden Delay nach clientReady fuer Guild-Cache
- Channel wird per API geholt wenn nicht im Cache (guild.channels.fetch)
- Wartet auf VoiceConnectionStatus.Ready vor Wiedergabe
- Periodisches State-Speichern alle 60 Sekunden (Backup)
- **FIX v2**: docker-entrypoint.sh komplett ueberarbeitet:
  - `set -e` entfernt - Script crashed nicht mehr bei Mount-Problemen
  - Kein `rm -rf` auf Docker-Volume-Mounts (verursachte "Device or resource busy" Crash-Loop)
  - Graceful Handling: Warnung statt Crash wenn Datei ein Verzeichnis ist
- **FIX v2**: install.sh + update.sh erstellen JSON-Dateien VOR docker compose up
- **FIX v2**: Alle JSON-Module (bot-state.js, premium-store.js, custom-stations.js, stations-store.js) pruefen auf Directory-Mounts und crashen nicht

### Premium System v3 - Komplett-Ueberholung (Feb 2026)
- 3-Tier Modell: Free, Pro (4.99 EUR/mo), Ultimate (9.99 EUR/mo)
- Monatsauswahl: 1, 3, 6, 12 Monate
- Jahresrabatt: 12 Monate = 10 bezahlen (2 Monate gratis)
- Automatisches Ablaufen mit expiresAt
- Verlaengerung: Neue Monate auf bestehende Laufzeit addiert
- Upgrade Pro -> Ultimate: Aufpreis fuer Restlaufzeit (Tages-Differenz)
- Tier-basierte Stationen: Free, Pro, Ultimate Stationen
- Audio-Qualitaet: Free=128k, Pro=192k, Ultimate=320k
- Reconnect-Prioritaet: Free=3s, Pro=1s, Ultimate=500ms
- Max Bots: Free=4, Pro=10, Ultimate=20

### Custom Stations (Ultimate Feature)
- /addstation <key> <name> <url> - Eigene Station hinzufuegen
- /removestation <key> - Station entfernen
- /mystations - Custom Stationen anzeigen
- Max 50 Custom Stationen pro Guild
- Gespeichert in custom-stations.json

### SMTP E-Mail Integration (Feb 2026)
- Nodemailer-basiert, konfigurierbar via update.sh
- Kauf-E-Mail an Kunden mit Invite-Links
- Admin-Benachrichtigung bei jedem Kauf
- Ablauf-Warnung 7 Tage vor Ablauf

### FastAPI Backend (server.py) - Vollstaendig synchronisiert (Feb 2026)
- Identische Premium-Logik wie Node.js (premium-store.js)
- calculatePrice mit Jahresrabatt
- calculateUpgradePrice (Pro -> Ultimate Aufpreis)
- addLicense mit expiresAt und Verlaengerung
- /api/premium/pricing Endpoint mit Upgrade-Info
- /api/premium/checkout mit months Parameter
- /api/premium/verify mit Upgrade-Handling
- /api/premium/check mit Lizenz-Ablauf-Info
- /api/stations mit Tier-Feld aus stations.json
- /api/commands mit allen 14 Commands

### Frontend Premium UI (Feb 2026)
- 3 Plan-Karten mit korrekten Features pro Tier
- Checkout-Modal mit Monatsauswahl (1, 3, 6, 12)
- Dynamische Preisberechnung mit Jahresrabatt-Anzeige
- "-2 GRATIS" Badge bei 12-Monats-Option
- Upgrade-Erkennung bei Server-ID Eingabe
- Status-Checker zeigt Tier, Bitrate, Reconnect, Max Bots
- Lizenz-Ablauf-Info mit Restlaufzeit in Tagen
- Abgelaufen-Warnung in rot

## Testing
- Iteration 20: FastAPI + Frontend Premium 100% (31/31 backend + frontend)
- Iteration 19: Node.js Premium Modules 100% (56/56)

## Backlog
- P3: Automatisierter Build (React -> Static Web)
- P4: Refactoring src/index.js in Module
