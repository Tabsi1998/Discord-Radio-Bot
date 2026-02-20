# Discord Radio Bot - PRD v14

## Architektur
- Node.js Bot Backend, React + FastAPI Preview, Stripe Payments, JSON-Datenbank

## Alle Features Implementiert

### Audio Stability v4 (P1 Fix - Feb 2026)
- Balanced Buffer statt Zero-Buffer: probesize=32768, analyzeduration=500000
- Erhoehte Timeouts: rw_timeout=15s, timeout=15s (statt 5s)
- Entfernt: -nobuffer, -avioflags direct, -max_delay 0
- Exponential Backoff bei Stream-Fehlern: 1s, 2s, 4s, 8s, max 15s
- Cooldown bei 10+ konsekutiven Fehlern: 30s Pause
- handleStreamEnd prueft state.connection vor Restart

### Auto-Reconnect v2 (P0 Fix - Feb 2026)
- Race-Condition zwischen voiceStateUpdate und VoiceConnection behoben
- handleBotVoiceStateUpdate: zerstoert connection VOR player.stop()
- Nutzt scheduleReconnect() mit Dedup statt Inline-Reconnect
- Disconnected-Handler: nur Recovery, kein eigener Reconnect
- tryReconnect: startet Station IMMER nach erfolgreichem Rejoin

### Shell Scripts v2 (Feb 2026)
- install.sh: Fragt jetzt BOT_TIER (free/pro/ultimate) bei JEDER Erstinstallation ab
- update.sh: Neues Menue mit 5 Optionen statt 4
- update.sh --edit-bot: Bots nachtraeglich bearbeiten (Name, Tier, Token)
- update.sh --premium: Nutzt docker compose exec statt bare node
- update.sh: bot-state.json in git clean Exclusion-Liste
- Case-Statement Bug behoben (;;& Fallthrough)

### Auto-Reconnect nach Restart
- bot-state.js: Speichert Guild/Channel/Station/Volume pro Bot
- Shutdown: persistState() vor stop()
- Startup: restoreState() nach Bot-Login

### Premium Bot Access
- BOT_{i}_TIER: free/pro/ultimate in .env
- Premium-Bots: Lock-Icon statt Invite auf Web
- /api/premium/invite-links: Nur fuer berechtigte Server

### Discord Community
- https://discord.gg/UeRkfGS43R: Navbar, Hero, Premium, Footer

### Premium System
- 3 Tiers, Stripe Checkout, License Management, CLI, Discord Command

## Testing
- Iteration 15: Shell Script Fixes verifiziert, case-bug gefunden und gefixt
- Iteration 14: P0/P1 100% (40/40 Tests)

## Wichtig fuer den User
- Bot 5 zeigt [FREE] weil BOT_5_TIER nicht in .env gesetzt war
- Fix: ./update.sh --edit-bot → Bot 5 waehlen → Tier auf "pro" setzen → Container neustarten

## Backlog
- P3: Automatisierter Build-Prozess (React → Static Web Sync)
- P4: Refactoring src/index.js in Module
