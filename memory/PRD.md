# Discord Radio Bot - PRD v20

## Architektur
- Node.js Bot Backend (Discord, Express), FastAPI Preview Backend, React Frontend, Stripe Payments, JSON-Datenbank

## Alle Features Implementiert

### Docker Crash-Loop Fix (Feb 2026)
- docker-entrypoint.sh: `set -e` entfernt, kein rm -rf auf Volume-Mounts
- install.sh + update.sh: JSON-Dateien VOR docker compose up erstellen
- Alle JSON-Module: Pruefen auf Directory-Mounts, crashen nicht

### Auto-Reconnect nach Restart
- clientReady Event, 2s Delay, Channel-Fetch via API
- Periodisches State-Speichern alle 60s, Graceful Shutdown

### Premium System v3 (3-Tier)
- Free (0 EUR), Pro (4.99 EUR/mo), Ultimate (9.99 EUR/mo)
- Monatsauswahl: 1, 3, 6, 12 Monate
- Jahresrabatt: 12 Monate = 10 bezahlen (2 gratis)
- Upgrade Pro→Ultimate mit Restlaufzeit-Aufpreis
- Verlaengerung: Monate auf bestehende Laufzeit addiert

### Custom Stations (Ultimate)
- /addstation, /removestation, /mystations
- Max 50 pro Guild, gespeichert in custom-stations.json
- Directory-Mount Schutz in save/load

### SMTP E-Mail Integration
- Nodemailer, konfigurierbar via update.sh
- Kauf-Email + Admin-Benachrichtigung
- **NEU**: Test-Email Versand via update.sh (Option 3 im E-Mail Menu)

### Static Web (Production /web/) - Synchronisiert (Feb 2026)
- Checkout-Modal: Button-Style Monatsauswahl (1/3/6/12)
- -2 GRATIS Badge bei 12-Monats-Option
- Dynamische Preisberechnung mit Jahresrabatt
- Pro Karte: OHNE "Custom Stationen" (nur Ultimate)
- Ultimate Karte: MIT "Eigene Station-URLs"
- 14 Commands inkl. /addstation, /removestation, /mystations
- Upgrade-Erkennung bei Server-ID Eingabe

### Bot Presence Rotation (Feb 2026)
- Bei 1 Guild: Zeigt Station-Name
- Bei mehreren Guilds: Rotiert alle 30s zwischen Stations
- Format: "Station-Name (+X)" statt "X Server | /now"

### FastAPI Backend - Vollstaendig synchronisiert
- calculatePrice, calculateUpgradePrice, addLicense mit Verlaengerung
- /api/premium/pricing, /api/premium/checkout (months), /api/premium/verify (upgrade)
- /api/stations mit Tier, /api/commands mit 14 Commands

## Testing
- Iteration 21: Static Web + Checkout + Commands 100% (19/19 + Frontend)
- Iteration 20: FastAPI + Frontend Premium 100% (31/31)
- Iteration 19: Node.js Premium Modules 100% (56/56)

## Backlog
- P3: Automatisierter Build (React -> Static Web)
- P4: Refactoring src/index.js in Module
