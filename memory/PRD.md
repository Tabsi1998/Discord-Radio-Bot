# Discord Radio Bot - PRD v16

## Architektur
- Node.js Bot Backend, React + FastAPI Preview, Stripe Payments, JSON-Datenbank

## Alle Features Implementiert

### Unified Management Tool (Feb 2026)
- update.sh komplett neu geschrieben als EINZIGES Management-Tool
- 6 Hauptoptionen: Update, Bots verwalten, Stripe, Premium, Einstellungen, Status
- Bots Sub-Menue: Anzeigen, Hinzufuegen, Bearbeiten, Entfernen (mit Reindexing)
- Stripe Setup integriert (Secret Key + Public Key)
- Einstellungen: Port, Domain
- Status: Container-Status + Logs
- KRITISCHER FIX: docker compose restart -> docker compose up -d --build (.env wird neu geladen!)

### Bot Statistiken auf Web (Feb 2026)
- Server, Nutzer, Verbindungen, Zuhoerer pro Bot-Karte
- Guild-Details (was laeuft wo) gehoert auf Discord, nicht Website

### Audio Stability v4 (P1 Fix)
- Balanced Buffer, erhoehte Timeouts, Exponential Backoff

### Auto-Reconnect v2 (P0 Fix)
- Race-Condition behoben, voiceStateUpdate als einziger Reconnect-Trigger

### Shell Scripts v2
- install.sh: BOT_TIER bei Erstinstallation
- setup-stripe.sh: docker compose up -d statt restart

### Premium System
- BOT_TIER, Lock-Icon, Stripe Checkout, CLI, Discord Command

## Testing
- Iteration 17: update.sh 100% (29/29)
- Iteration 16: Bot Stats 100% (19/19)
- Iteration 15: Shell Scripts 100%
- Iteration 14: P0/P1 100% (40/40)

## Backlog
- P3: Automatisierter Build (React -> Static Web Sync)
- P4: Refactoring src/index.js in Module
