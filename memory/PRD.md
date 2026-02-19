# Discord Radio Bot - PRD v7

## Projekt-Ubersicht
Discord Radio Bot - Multi-Bot Radio-Streaming fuer Discord Server mit modernem Web-Interface.
GitHub: https://github.com/Tabsi1998/Discord-Radio-Bot

## Repo-Struktur
```
Discord-Radio-Bot/
├── install.sh              # Interaktiver Installer v3.0 (farbig, Validierung, Audio-Qualitaet)
├── update.sh               # Auto-Update v3.0 (9x Health-Retry, Rollback-Hilfe)
├── stations.sh             # CLI Stationsverwaltung (Wizard)
├── install-systemd.sh      # Autostart Setup
├── radio-bot.service       # Systemd Service Template
├── docker-compose.yml      # Docker Config
├── Dockerfile              # Docker Build
├── docker-entrypoint.sh    # Container Entrypoint
├── package.json            # Node.js Dependencies (v2.1.0)
├── stations.json           # Station-Config (12 Stationen + Genres)
├── .env                    # Bot-Tokens (NICHT im Git)
├── .gitignore
├── README.md
├── src/
│   ├── index.js            # Bot-Hauptprogramm + Web-Server
│   ├── commands.js         # Slash-Command Definitionen
│   ├── bot-config.js       # Bot-Config aus .env
│   ├── deploy-commands.js  # Command-Registrierung
│   ├── stations-store.js   # Stations lesen/schreiben
│   └── stations-cli.js     # CLI-Tool (Wizard)
├── web/
│   ├── index.html          # Web-Interface v3.0 (Dashboard, Premium, Inline-CSS)
│   ├── styles.css          # Responsive CSS + Volume Slider + Dashboard + Premium
│   ├── app.js              # Frontend v3.0 (Dynamic EQ, Volume, Dashboard, Premium)
│   └── img/                # Bot-Avatare
└── logs/                   # Auto-generiert
```

## Completed Features (All Sessions)

### Session 1-5: Foundation
- Cyber-Analog Dark Theme (Orbitron/DM Sans/JetBrains Mono)
- Dynamische Bots aus .env (1-20)
- Kritischer Bug Fix: getChannel() -> getString() fuer /play
- Audio-Player auf Webseite mit Genre-Filter
- Mobile-Responsive mit 3 Breakpoints
- install.sh, update.sh, stations.sh Scripts
- 12 Default-Stationen

### Session 6 (Feb 2026): Stability & Polish
- Volume Control Slider: CSS-Styles (.vol-slider) fuer production site
- Bot-Stabilitaet verbessert: Stream-Restart mit Delay, Fallback-Station, Voice Recovery
- Verbesserte ffmpeg-Args: -reconnect_on_network_error, -rw_timeout, -application audio

### Session 7 (Feb 2026): Major Feature Update v3.0
- **FOUC Fix**: Inline critical CSS im HTML <head> verhindert Flash of Unstyled Content
- **Dynamischer Hero-EQ**: EQ-Bars animieren schneller/bunter wenn Audio spielt (eq-active Animation)
- **Live Dashboard Section**: 4 Metrikkarten (Aktive Streams, Zuhoerer, Uptime, System Health) + Bot-Status-Tabelle mit farbigen Indikatoren
- **Premium Section**: 3-Tier Pricing (Free 0EUR, Pro 4.99EUR, Ultimate 9.99EUR) mit Feature-Vergleich, goldener Featured-Card fuer Pro
- **install.sh v3.0**: Farbige ASCII-Ausgabe, Token-Validierung, Client-ID-Validierung, bestehende .env beibehalten/erweitern, Audio-Qualitaetswahl (Low/Medium/High/Ultra), 6-Retry Health-Check
- **update.sh v3.0**: 9-Retry Health-Check (45 Sek), Rollback-Anweisungen bei Fehler, Commit-Diff-Anzeige, farbige Ausgabe
- **Backend API Fix**: camelCase Feldnamen (clientId, avatarUrl, userTag, uptimeSec) fuer Konsistenz mit Production Express API
- **React Frontend**: LiveDashboard und Premium Komponenten, Auto-Refresh (15s Polling)

## Upcoming Tasks
- Keine ausstehenden Tasks mehr - alle P0-P2 Features implementiert

## Future/Backlog Tasks
- **(P3) Premium Bot System - Backend**: Tatsaechliches Payment-Backend (Stripe), Lizenzschluessel-System, User-Auth
- **(P3) Dual-Frontend-Sync**: Build-Step der React automatisch zu web/ kompiliert
- **(P4) WebSocket Live-Updates**: Echtzeit-Updates statt 15s Polling
- **(P4) Station Metadata**: Aktuelle Song-Infos im Now-Playing anzeigen

## Architecture
- **Bot Backend**: Node.js + discord.js + @discordjs/voice + Express (src/index.js)
- **Production Frontend**: Static HTML/CSS/JS v3.0 (web/) - Dashboard, Premium, Dynamic EQ, Volume Control
- **Preview Frontend**: React (frontend/) + FastAPI (backend/)
- **Data**: stations.json (12 stations mit Genres), .env (bot tokens)
- **Deployment**: Docker + Docker Compose

## Testing: 7 Iterationen, 100% Erfolgsrate (Backend + Frontend)
