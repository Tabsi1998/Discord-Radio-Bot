# Discord Radio Bot - PRD v8

## Projekt-Uebersicht
Discord Radio Bot mit professionellem Web-Interface, Premium-System, und Zero-Lag Audio-Optimierung.

## Original Problem Statement
Full redesign of Discord Radio Bot web interface with premium subscription system and extreme audio optimization.

## Architektur
- **Bot Backend**: Node.js (`src/index.js`) mit discord.js, @discordjs/voice, Express
- **Web Server**: Express.js serving static frontend + API endpoints
- **Preview Stack**: React + FastAPI (Emergent Platform)
- **Payments**: Stripe Integration (benötigt User-Keys via `setup-stripe.sh`)
- **Datenbank**: JSON-Dateien (stations.json, licenses.json)

## Implementiert (Komplett)

### Audio-Optimierung (v2 - Zero-Lag)
- Ultra-low-latency ffmpeg args (probesize=16384, analyzeduration=0)
- `+nobuffer+flush_packets+genpts+discardcorrupt` fflags
- `application=lowdelay` Opus encoding
- `packet_loss=5`, `cutoff=20000` for robust streaming
- `flush_packets=1` output buffer optimization
- `avioflags=direct` für direkten I/O
- Tier-basierte Bitrates: Free=128k, Pro=192k, Ultimate=320k
- Fast reconnect: error=tierReconnectMs, normal=tierReconnectMs/2

### Premium-System (Komplett)
- 3 Tiers: Free, Pro, Ultimate
- Stripe Checkout Integration (Backend-Endpoints)
- License Management (`licenses.json`)
- `/premium` Discord Slash Command
- `setup-stripe.sh` für Key-Konfiguration
- React Frontend: Checkout-Modal mit Server-ID Input
- React Frontend: Premium-Status-Checker
- Production Frontend: Matching Premium UI

### Web-Interface (Professionell)
- Navbar mit Premium-Link
- Hero Section mit animierten EQ-Bars
- Bot Directory mit Invite-Links
- Station Browser mit Genre-Filter & Suche
- Commands Section im Terminal-Style
- Premium Section mit 3 Pricing-Cards
- Checkout-Modal mit Server-ID Validierung
- Premium-Status-Checker
- Footer mit Live-Stats
- Mobile-Responsive Design
- Dark Theme mit Neon-Akzenten

### Scripts
- `install.sh` v4.0: 6-Step Installer mit optionalem Stripe-Setup
- `update.sh`: Auto-Update mit Backup/Restore/Health-Check
- `setup-stripe.sh`: Stripe API-Key Konfiguration

## API Endpoints
- GET /api/health
- GET /api/bots
- GET /api/stations
- GET /api/stats
- GET /api/commands
- GET /api/premium/tiers
- GET /api/premium/check?serverId=
- POST /api/premium/checkout
- POST /api/premium/verify

## Testing
- Iteration 9: 100% Backend (22/22), 100% Frontend
- All Premium features tested and verified
- Mobile responsive tested at 768px and 390px

## Naechste Schritte
- P0: User-Validierung: Stripe mit echten Keys testen
- P1: User-Validierung: Audio-Qualitaet im Discord Voice Channel
- P2: Automatische Dual-Frontend Synchronisation (React → /web Build-Step)
- P3: Weitere Stations hinzufuegen
