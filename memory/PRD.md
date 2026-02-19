# Discord Radio Bot - PRD v9

## Projekt-Uebersicht
Discord Radio Bot mit professionellem Web-Interface, Premium-System, Zero-Lag Audio, und umfassendem Management.

## Original Problem Statement
Full redesign of Discord Radio Bot web interface with premium subscription system and extreme audio optimization. User wants everything professional with server-specific bot display, management CLI, and zero lag audio.

## Architektur
- **Bot Backend**: Node.js (`src/index.js`) mit discord.js, @discordjs/voice, Express
- **Web Server**: Express.js serving static frontend + API endpoints
- **Preview Stack**: React + FastAPI (Emergent Platform)
- **Payments**: Stripe Integration (benötigt User-Keys via `setup-stripe.sh`)
- **Datenbank**: JSON-Dateien (stations.json, premium.json)

## Implementiert (Komplett)

### Kritische Bug-Fixes
- **resolveStation/getFallbackKey Duplikat-Bug**: Bot crashte mit SyntaxError weil diese Funktionen sowohl importiert als auch lokal definiert waren. Lokale Kopien entfernt, korrekte Exports in stations-store.js hinzugefuegt.
- **install.sh local-Bug**: `local` Keyword ausserhalb einer Funktion auf Zeile 369 verursachte Fehler. Entfernt.

### Audio-Optimierung (v2 - Zero-Lag)
- Ultra-low-latency ffmpeg: probesize=16384, analyzeduration=0, avioflags=direct
- +nobuffer+flush_packets+genpts+discardcorrupt fflags
- application=lowdelay Opus, packet_loss=5, cutoff=20000, flush_packets=1
- Tier-basierte Bitrates: Free=128k, Pro=192k, Ultimate=320k
- Fast reconnect: error=tierReconnectMs, normal=tierReconnectMs/2

### Server-Spezifische Anzeige
- Bot API gibt jetzt `guildDetails` Array pro Bot zurueck (guildId, guildName, stationKey, stationName, channelName, playing, volume, meta)
- Web UI zeigt "AKTIVE SERVER" Section pro Bot-Card wenn Guilds aktiv sind
- Bot Presence verbessert: Zeigt "X Server | /now" statt alle Stations gemischt
- `/now` Command ist bereits guild-spezifisch

### Premium-System (Komplett)
- 3 Tiers: Free, Pro, Ultimate
- Stripe Checkout + License Management
- `/premium` Discord Slash Command
- `setup-stripe.sh` fuer Key-Konfiguration
- React: Checkout-Modal mit Server-ID Validierung + Status-Checker
- Premium CLI: add, remove, list, check, tiers, invite, wizard

### Management-Tools
- **Premium CLI** (`node src/premium-cli.js`): Vollstaendiges CLI mit Wizard, Invite-Links, Tier-Info
- **update.sh**: Interaktives Menu (1=Update, 2=Bot hinzufuegen, 3=Bots anzeigen, 4=Premium CLI)
- **install.sh v4.0**: 6-Step Installer mit optionalem Stripe-Setup

### Web-Interface
- Navbar mit Premium-Link
- Hero Section mit animierten EQ-Bars
- Bot Directory mit Invite-Links + Guild Details
- Station Browser mit Genre-Filter & Suche
- Commands Section im Terminal-Style
- Premium Section: 3 Cards + Checkout-Modal + Status-Checker
- Footer mit Live-Stats
- Mobile-Responsive Design

## API Endpoints
- GET /api/health, /api/bots (mit guildDetails), /api/stations, /api/stats, /api/commands
- GET /api/premium/tiers, /api/premium/check?serverId=
- POST /api/premium/checkout, /api/premium/verify

## Testing
- Iteration 10: 100% Backend (22/22), 100% Frontend
- All critical bug fixes verified
- Mobile responsive tested at 768px

## Naechste Schritte
- P0: User validiert Bug-Fixes auf Production-Server
- P1: User testet Stripe mit echten Keys
- P2: User testet Audio-Qualitaet im Discord Voice Channel
- P3: Automatische Dual-Frontend Synchronisation
