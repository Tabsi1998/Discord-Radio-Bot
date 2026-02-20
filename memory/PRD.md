# Discord Radio Bot - PRD v21

## Architektur
- Node.js Bot Backend (Discord, Express), FastAPI Preview Backend, React Frontend, Stripe Payments, JSON-Datenbank

## Alle Features Implementiert

### update.sh v4 - Komplett ueberarbeitet (Feb 2026)
- **Self-Exec Trick**: Script kopiert sich in /tmp und fuehrt sich von dort aus
  - Verhindert dass git reset --hard das laufende Script zerstoert
  - tmp-File wird automatisch aufgeraeumt bei Exit
- **set -e entfernt**: Kein unkontrollierter Abbruch bei grep-Fehlern
- **read_env() Helper**: Sichere .env-Lesefunktion (kein Crash bei fehlenden Keys)
- **ensure_json_file()**: Erkennt/fixt Directory-Mounts und erstellt fehlende Dateien
- **ensure_all_json_files()**: Zentrale Funktion vor jedem Docker-Start
- **E-Mail Test** (Option 3): SMTP-Verbindungstest mit Fehlerdiagnose
- **Robustere Variable-Handhabung**: ${VAR:-} Pattern ueberall

### Docker Crash-Loop Fix (Feb 2026)
- docker-entrypoint.sh: set -e entfernt, kein rm -rf auf Volume-Mounts
- install.sh + update.sh: JSON-Dateien VOR docker compose up erstellen
- Alle JSON-Module: Pruefen auf Directory-Mounts

### Premium System v3 (3-Tier)
- Free (0 EUR), Pro (4.99 EUR/mo), Ultimate (9.99 EUR/mo)
- Monatsauswahl: 1, 3, 6, 12 Monate (Button-Style)
- Jahresrabatt: 12 Monate = 10 bezahlen (2 gratis)
- Upgrade Pro→Ultimate mit Restlaufzeit-Aufpreis

### Custom Stations (Ultimate)
- /addstation, /removestation, /mystations Commands
- Max 50 pro Guild, gespeichert in custom-stations.json

### SMTP E-Mail
- Kauf-Email + Admin-Benachrichtigung
- Test-Email Versand via update.sh

### Bot Presence Rotation
- Rotiert alle 30s zwischen Station-Namen bei mehreren Guilds

### Static Web (/web/) - Synchronisiert
- Button-Style Checkout-Modal, Preis-Berechnung, 14 Commands

## Testing
- Iteration 21: Static Web + Checkout + Commands 100%
- Iteration 20: FastAPI + Frontend Premium 100%
- Iteration 19: Node.js Premium Modules 100%

## Backlog
- P3: Automatisierter Build (React -> Static Web)
- P4: Refactoring src/index.js in Module
