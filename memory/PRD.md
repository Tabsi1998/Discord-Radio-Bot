# Discord Radio Bot - PRD v12 (FINAL)

## Architektur
- Node.js Bot Backend, React + FastAPI Preview, Stripe Payments, JSON-Datenbank

## Alle Features Implementiert

### Audio Zero-Lag v3
- probesize=8192, thread_queue_size=512, analyzeduration=0
- compression_level=5 (statt 10, weniger CPU = weniger Latenz)
- OggOpus Format (-f ogg, StreamType.OggOpus) statt raw Opus
- avioflags=direct, flush_packets=1, max_delay=0
- application=lowdelay, packet_loss=3, cutoff=20000
- Tier-basierte Bitrates: Free=128k, Pro=192k, Ultimate=320k

### Auto-Reconnect nach Restart
- bot-state.js: Speichert Guild/Channel/Station/Volume pro Bot
- Shutdown: persistState() vor stop() fuer alle Bots
- Startup: restoreState() nach Bot-Login, joined automatisch Voice Channels
- docker-compose.yml: bot-state.json als Volume gemountet
- update.sh: bot-state.json in Backup-Liste

### Premium Bot Access
- BOT_{i}_TIER: free/pro/ultimate in .env
- Premium-Bots: Lock-Icon + "Pro/Ultimate erforderlich" statt Invite
- /api/premium/invite-links: Gibt Links nur fuer berechtigte Server
- Crown-Badge auf Premium-Bot-Cards
- install.sh + update.sh: Tier-Auswahl beim Bot-Setup

### Discord Community
- https://discord.gg/UeRkfGS43R: Navbar, Hero, Premium Support-Banner, Footer, Mobile, Bot /premium Command

### Premium System
- 3 Tiers, Stripe Checkout, License Management, CLI, Discord Command

### Bug-Fixes
- resolveStation Duplikat (SyntaxError)
- http.createServer async (await in non-async)
- install.sh local-outside-function

## Testing: Iteration 13, 100% Backend + Frontend, Code Review bestanden
