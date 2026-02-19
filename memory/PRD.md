# Discord Radio Bot - PRD v10

## Projekt-Uebersicht
Discord Radio Bot mit professionellem Web-Interface, Premium-System, Zero-Lag Audio, und umfassendem Management.

## Architektur
- **Bot Backend**: Node.js (`src/index.js`) mit discord.js, @discordjs/voice, Express
- **Preview Stack**: React + FastAPI (Emergent Platform)
- **Payments**: Stripe (benötigt User-Keys via `setup-stripe.sh`)
- **Datenbank**: JSON-Dateien (stations.json, premium.json)

## Implementiert

### Kritische Bug-Fixes (v10)
- **resolveStation Duplikat-Bug**: Lokale Kopien entfernt, korrekte Exports in stations-store.js
- **http.createServer async Bug**: Callback war nicht async, await in non-async Funktion
- **install.sh local-Bug**: `local` Keyword ausserhalb einer Funktion

### Discord Community Integration
- Navbar: Discord-Icon Button (lila, SVG)
- Hero: "Discord" CTA-Button
- Premium: "Fragen zum Abo? Melde dich auf unserem Discord" Support-Banner
- Footer: Discord-Icon Link
- Mobile Nav: Discord Community Link
- Bot /premium Command: Discord Support-URL
- Production /web: Alle Links synchron
- URL: https://discord.gg/UeRkfGS43R

### Audio-Optimierung (v2 - Zero-Lag)
- Ultra-low-latency ffmpeg: probesize=16384, analyzeduration=0, avioflags=direct
- application=lowdelay Opus, packet_loss=5, cutoff=20000, flush_packets=1
- Tier-basierte Bitrates: Free=128k, Pro=192k, Ultimate=320k

### Premium-System
- 3 Tiers: Free, Pro, Ultimate
- Stripe Checkout + License Management
- React: Checkout-Modal + Status-Checker + Discord Support
- Premium CLI: add, remove, list, check, tiers, invite, wizard

### Server-Spezifische Anzeige
- Bot API: guildDetails Array pro Bot
- Web UI: "AKTIVE SERVER" Section pro Bot-Card
- Bot Presence: "X Server | /now" statt alles gemischt

### Management-Tools
- Premium CLI (`node src/premium-cli.js wizard`)
- update.sh: Interaktives Menu (Update/Bot hinzufuegen/Bots anzeigen/Premium)
- install.sh v4.0: 6-Step Installer

## Testing: Iteration 11, 100% Backend + Frontend

## Naechste Schritte
- P0: User deployt und testet Bug-Fixes
- P1: User testet Stripe mit echten Keys
- P2: User testet Audio im Discord Voice Channel
- P3: Automatische React → /web Build-Synchronisation
