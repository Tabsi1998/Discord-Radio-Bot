# Discord Radio Bot - PRD v15

## Architektur
- Node.js Bot Backend, React + FastAPI Preview, Stripe Payments, JSON-Datenbank

## Alle Features Implementiert

### Bot Statistiken auf Web-Frontend (Feb 2026)
- Statisches Frontend (web/app.js): BOT STATISTIKEN Sektion hinzugefuegt (Server, Nutzer, Verbindungen, Zuhoerer)
- Statistiken waren nur im React-Frontend, nie ins statische Frontend uebertragen - jetzt synchron
- Guild-Details (welcher Bot spielt was auf welchem Server) gehoeren auf Discord, NICHT auf die Website
- CSS-Klassen korrekt geschachtelt (.bot-stats .stat-label) um Konflikte zu vermeiden

### Audio Stability v4 (P1 Fix - Feb 2026)
- Balanced Buffer statt Zero-Buffer: probesize=32768, analyzeduration=500000
- Erhoehte Timeouts: rw_timeout=15s, timeout=15s (statt 5s)
- Exponential Backoff bei Stream-Fehlern: 1s, 2s, 4s, 8s, max 15s
- Cooldown bei 10+ konsekutiven Fehlern: 30s Pause

### Auto-Reconnect v2 (P0 Fix - Feb 2026)
- Race-Condition zwischen voiceStateUpdate und VoiceConnection behoben
- Disconnected-Handler: nur Recovery, kein eigener Reconnect
- tryReconnect: startet Station IMMER nach erfolgreichem Rejoin

### Shell Scripts v2 (Feb 2026)
- install.sh: Fragt BOT_TIER bei JEDER Erstinstallation ab
- update.sh --edit-bot: Bots nachtraeglich bearbeiten (Name, Tier, Token)
- update.sh --premium: docker compose exec statt bare node

### Auto-Reconnect nach Restart
- bot-state.js persistiert Guild/Channel/Station/Volume

### Premium Bot Access
- BOT_{i}_TIER: free/pro/ultimate, Lock-Icon auf Web, /api/premium/invite-links

### Premium System
- 3 Tiers, Stripe Checkout, License Management, CLI, Discord Command

## Testing
- Iteration 16: Bot Statistiken 100% (19/19)
- Iteration 15: Shell Scripts 100%
- Iteration 14: P0/P1 100% (40/40)

## Backlog
- P3: Automatisierter Build-Prozess (React -> Static Web Sync)
- P4: Refactoring src/index.js in Module
