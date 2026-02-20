# Discord Radio Bot - PRD v13

## Architektur
- Node.js Bot Backend, React + FastAPI Preview, Stripe Payments, JSON-Datenbank

## Alle Features Implementiert

### Audio Stability v4 (P1 Fix - Feb 2026)
- Balanced Buffer statt Zero-Buffer: probesize=32768, analyzeduration=500000
- Erhoehte Timeouts: rw_timeout=15s, timeout=15s (statt 5s)
- Entfernt: -nobuffer, -avioflags direct, -max_delay 0 (verursachten Instabilitaet)
- thread_queue_size=1024, reconnect_delay_max=5
- Exponential Backoff bei Stream-Fehlern: 1s, 2s, 4s, 8s, max 15s
- Cooldown bei 10+ konsekutiven Fehlern: 30s Pause
- handleStreamEnd prueft state.connection vor Restart
- streamErrorCount wird bei erfolgreichem Restart zurueckgesetzt

### Auto-Reconnect v2 (P0 Fix - Feb 2026)
- Race-Condition zwischen voiceStateUpdate und VoiceConnection behoben
- handleBotVoiceStateUpdate: zerstoert connection VOR player.stop() (verhindert Stream-Restart waehrend Disconnect)
- Nutzt scheduleReconnect() mit Dedup statt Inline-Reconnect
- Disconnected-Handler: nur Recovery, kein eigener Reconnect (voiceStateUpdate uebernimmt)
- tryReconnect: startet Station IMMER nach erfolgreichem Rejoin
- scheduleReconnect: exponential Backoff (2^n Sekunden, max 30s)

### Auto-Reconnect nach Restart
- bot-state.js: Speichert Guild/Channel/Station/Volume pro Bot
- Shutdown: persistState() vor stop() fuer alle Bots
- Startup: restoreState() nach Bot-Login, joined automatisch Voice Channels

### Premium Bot Access
- BOT_{i}_TIER: free/pro/ultimate in .env
- Premium-Bots: Lock-Icon + "Pro/Ultimate erforderlich" statt Invite
- /api/premium/invite-links: Gibt Links nur fuer berechtigte Server

### Discord Community
- https://discord.gg/UeRkfGS43R: Navbar, Hero, Premium Support-Banner, Footer

### Premium System
- 3 Tiers (Free/Pro/Ultimate), Stripe Checkout, License Management, CLI, Discord Command

## Testing
- Iteration 14: 100% Backend (40/40 Tests), Code Review bestanden
- P0 + P1 Fixes verifiziert, keine Race-Conditions

## Backlog
- P3: Automatisierter Build-Prozess (React -> Static Web Sync)
- P4: Refactoring src/index.js in Module (web-server, bot-lifecycle, audio-pipeline, discord-commands)
