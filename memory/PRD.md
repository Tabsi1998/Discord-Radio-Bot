# Discord Radio Bot - PRD v11

## Architektur
- Node.js Bot Backend, React + FastAPI Preview, Stripe Payments, JSON-Datenbank

## Alle Implementierten Features

### Kritische Bug-Fixes
- resolveStation/getFallbackKey Duplikat → SyntaxError
- http.createServer async → await in non-async
- install.sh local-outside-function

### Premium Bot Access System (NEU)
- BOT_{i}_TIER in .env: free/pro/ultimate
- Premium-Bots: Invite-Link VERSTECKT, Lock-Icon + "Pro/Ultimate erforderlich"
- Free-Bots: Invite-Link öffentlich sichtbar
- API /api/premium/invite-links: Gibt Invite-Links nur fuer berechtigte Server
- Crown-Badge auf Premium-Bot-Cards
- install.sh & update.sh: Tier-Auswahl beim Bot-Setup

### Discord Community
- https://discord.gg/UeRkfGS43R überall: Navbar, Hero, Premium Support-Banner, Footer, Mobile Menu, Bot /premium Command
- Production /web synchron

### Audio Zero-Lag v2
- probesize=16384, analyzeduration=0, avioflags=direct, application=lowdelay
- Tier-basierte Bitrates: Free=128k, Pro=192k, Ultimate=320k

### Premium System
- 3 Tiers mit Stripe Checkout, License Management, Discord Command
- Checkout-Modal, Status-Checker, Discord Support

### Server-Spezifische Anzeige
- guildDetails pro Bot, "AKTIVE SERVER" Section, Presence "X Server | /now"

### Management
- Premium CLI (wizard, invite, tiers)
- update.sh Menu (Update/Bot/Bots/Premium)
- install.sh v4.0 mit Stripe + Tier Setup

## Testing: Iteration 12, 100% Backend + Frontend
## User muss: BOT_5_TIER=pro in .env setzen und deployen
