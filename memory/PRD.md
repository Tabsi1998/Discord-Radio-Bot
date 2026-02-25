# OmniFM v3.0 - Project Requirements Document

## Original Problem Statement
Vollständige Analyse des GitHub-Repositories "Discord-Radio-Bot" (OmniFM v3.0) zur Vorbereitung auf zukünftige Optimierungen, Verbesserungen und Erweiterungen.

## Projekt-Übersicht
**OmniFM v3.0** ist ein professioneller 24/7 Discord Radio Streaming Bot mit einem 3-Tier Premium-System und seat-basierter Lizenzierung.

## Architektur

### Tech Stack
- **Runtime:** Node.js 20 (ES Modules)
- **Discord Library:** discord.js v14.17.3
- **Audio:** @discordjs/voice v0.18.0, @discordjs/opus v0.10.0, FFmpeg
- **Payment:** Stripe v17.0.0
- **Email:** Nodemailer v8.0.1
- **Deployment:** Docker (docker-compose)
- **Datenbank:** JSON-Datei-basiert (kein SQL/NoSQL DB)
- **Backend API:** Node.js HTTP Server (in src/index.js eingebaut)
- **Web Frontend:** Vanilla HTML/CSS/JS (web/)
- **Emergent Backend:** FastAPI (Python) für Preview-Zwecke

### Verzeichnisstruktur
```
/app/
├── src/                          # Discord Bot Kernlogik
│   ├── index.js                  # Haupt-Applikation (~3000+ Zeilen)
│   ├── commands.js               # Slash-Command Definitionen
│   ├── deploy-commands.js        # Command-Registrierung bei Discord
│   ├── bot-config.js             # Multi-Bot Konfiguration
│   ├── bot-state.js              # Bot-State Persistenz (JSON)
│   ├── premium-store.js          # Lizenz-Verwaltung (JSON)
│   ├── stations-store.js         # Station-Verwaltung (JSON)
│   ├── custom-stations.js        # Custom Stations (Ultimate)
│   ├── coupon-store.js           # Coupon/Referral System
│   ├── scheduled-events-store.js # Event Scheduler Persistenz
│   ├── song-history-store.js     # Song History Persistenz
│   ├── guild-language-store.js   # Server-Sprache (DE/EN)
│   ├── command-permissions-store.js # Rollenbasierte Berechtigungen
│   ├── email.js                  # SMTP/Email Service
│   ├── i18n.js                   # Internationalisierung (DE/EN)
│   ├── premium-cli.js            # CLI für Lizenz-Management
│   ├── stations-cli.js           # CLI für Station-Management
│   ├── config/
│   │   ├── plans.js              # Plan-Konfiguration (SSOT)
│   │   └── command-permissions.js # Permission-Command-Liste
│   ├── core/
│   │   └── entitlements.js       # Zentraler Permission-Check
│   ├── services/
│   │   ├── pricing.js            # Seat-basiertes Pricing
│   │   └── stations.js           # Station Service
│   ├── ui/
│   │   └── upgradeEmbeds.js      # Discord Upgrade-Embeds
│   ├── discord/
│   │   └── syncGuildCommandsSafe.js # Guild Command Sync
│   └── utils/
│       └── commandSyncGuard.js   # Exclusive Queue
├── web/                          # Original Website
│   ├── index.html                # Landing Page (~390 Zeilen)
│   ├── app.js                    # Frontend Logik (~2000+ Zeilen)
│   └── styles.css                # Styles (~277 Zeilen)
├── data/                         # Station-Daten
│   ├── stations.free.json        # 20 Free Stationen
│   └── stations.pro.json         # 100 Pro Stationen
├── backend/                      # Emergent FastAPI Backend
│   └── server.py                 # API Server (~1094 Zeilen)
├── frontend/                     # Emergent React Frontend
│   └── public/                   # Serviert Original web/ Files
├── stations.json                 # Haupt-Stations-Konfiguration
├── docker-compose.yml            # Docker Deployment
├── docker-entrypoint.sh          # Container Startup
├── Dockerfile                    # Container Build
└── package.json                  # Dependencies
```

## Kernfunktionalitäten

### 1. Multi-Bot System
- Unterstützt bis zu 20 Bots (BOT_1 bis BOT_20)
- Jeder Bot: eigener Token, Client ID, Name, Tier-Anforderung
- BotRuntime Klasse: Verwaltet Client, State, Player pro Bot
- Fallback auf Legacy-Single-Bot-Config (DISCORD_TOKEN/CLIENT_ID)

### 2. 3-Tier Premium System
| Feature | Free | Pro | Ultimate |
|---------|------|-----|----------|
| Stationen | 20 | 120 | 120+ Custom |
| Audio-Qualität | 64k | 128k Opus | 320k Opus |
| Reconnect | 5s | 1.5s | 0.4s |
| Max Bots | 2 | 8 | 16 |
| Custom URLs | Nein | Nein | Ja (50/Server) |
| Command Permissions | Nein | Ja | Ja |
| Event Scheduler | Nein | Ja | Ja |

### 3. Seat-basierte Lizenzierung
- Lizenzen pro E-Mail (nicht pro Server)
- Seat-Optionen: 1, 2, 3, 5 Server
- Preise (EUR/Monat): Pro 2.99-11.49, Ultimate 4.99-16.99
- Jahresrabatt: 10 Monate zahlen für 12
- Pro-Testmonat: 1x pro E-Mail, 1 Seat

### 4. Discord Slash Commands
`/play`, `/pause`, `/resume`, `/stop`, `/stations`, `/list`, `/now`, `/history`, `/setvolume`, `/status`, `/health`, `/diag`, `/premium`, `/language`, `/addstation`, `/removestation`, `/mystations`, `/event`, `/permission`

### 5. Audio-Streaming
- FFmpeg Transcoding mit Opus/PCM
- Netzwerk-Recovery mit Backoff + Jitter
- Now-Playing mit ICY-Metadata + Album-Cover (iTunes)
- Song History mit Dedupe

### 6. Event Scheduler
- Zeitpläne: einmalig, täglich, wöchentlich, monatlich
- Zeitzonen-Support, Discord Server-Event Integration
- Stage Channel Support

### 7. Stripe Payment Integration
- Checkout Sessions, Webhook Handling, Coupons/Referrals

### 8. Web Interface
- Landing Page, Bot-Verzeichnis, Station-Browser, Commands, Premium Pricing

## Daten-Persistenz (JSON-Dateien)
premium.json, bot-state.json, stations.json, custom-stations.json, scheduled-events.json, song-history.json, guild-languages.json, command-permissions.json, coupons.json

## Was wurde implementiert
- [2026-02-25] Komplettes Repo geklont und analysiert
- [2026-02-25] Original web/ Interface im Emergent Preview lauffähig gemacht
- [2026-02-25] FastAPI Backend mit allen API-Endpoints aktiv

## Identifizierte Verbesserungsbereiche
1. Datenbank-Migration: JSON → MongoDB/PostgreSQL
2. src/index.js Aufspaltung: ~3000+ Zeilen → modulare Architektur
3. Test-Suite erstellen
4. Error Handling vereinheitlichen
5. Strukturiertes Logging
6. CI/CD Pipeline
7. Monitoring/Health-Checks

## Backlog
- P1: Optimierungsplan mit User erstellen
- P2: Implementierung vereinbarter Änderungen
