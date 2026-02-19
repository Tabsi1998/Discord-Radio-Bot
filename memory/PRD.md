# Discord Radio Bot - PRD v6

## Projekt-Übersicht
Discord Radio Bot - Multi-Bot Radio-Streaming für Discord Server mit modernem Web-Interface.
GitHub: https://github.com/Tabsi1998/Discord-Radio-Bot

## Repo-Struktur
```
Discord-Radio-Bot/
├── install.sh              # One-Command Installer
├── update.sh               # Auto-Update von Git
├── stations.sh             # CLI Stationsverwaltung (Wizard)
├── install-systemd.sh      # Autostart Setup
├── radio-bot.service       # Systemd Service Template
├── docker-compose.yml      # Docker Config
├── Dockerfile              # Docker Build
├── docker-entrypoint.sh    # Container Entrypoint
├── package.json            # Node.js Dependencies (v2.1.0)
├── stations.json           # Station-Config (12 Stationen)
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
│   ├── index.html          # Web-Interface
│   ├── styles.css          # Responsive CSS + Volume Slider
│   ├── app.js              # Frontend-Logik + Audio-Player + Volume
│   └── img/                # Bot-Avatare
└── logs/                   # Auto-generiert
```

## Completed Features (All Sessions)

### Session 1-5: Foundation
- Cyber-Analog Dark Theme (Orbitron/DM Sans/JetBrains Mono)
- Dynamische Bots aus .env (1-20)
- Kritischer Bug Fix: getChannel() → getString() für /play
- Audio-Player auf Webseite mit Genre-Filter
- Mobile-Responsive mit 3 Breakpoints
- install.sh, update.sh, stations.sh Scripts
- 12 Default-Stationen

### Session 6 (Feb 2026): Stability & Polish
- Volume Control Slider: CSS-Styles (.vol-slider) für production site, flex-wrap auf nowPlaying
- Bot-Stabilität verbessert:
  - Stream-Restart mit Delay (1s idle, 3s error) statt sofort
  - Fallback-Station bei Auto-Restart-Fehler
  - Voice Connection Recovery (try Signalling/Connecting before full reconnect)
  - Verbesserte ffmpeg-Args: -reconnect_on_network_error, -reconnect_on_http_error, -rw_timeout, -application audio
  - ffmpeg process error handling & stderr buffering
  - Robustere process cleanup (try/catch um kill)
  - streamRestartTimer im Guild-State für saubere Timer-Verwaltung
- stations.sh CLI: War bereits vollständig (Wizard-Modus mit add/remove/rename/set-default/quality/fallback)

## Upcoming Tasks
- **(P2) Geführte Installation/Update**: install.sh und update.sh interaktiver gestalten
- **(P3) Premium Bot System**: Authentifizierung, Bezahlung, Feature-Differenzierung

## Architecture
- **Bot Backend**: Node.js + discord.js + @discordjs/voice + Express (src/index.js)
- **Production Frontend**: Static HTML/CSS/JS (web/)
- **Preview Frontend**: React (frontend/) + FastAPI (backend/)
- **Data**: stations.json (12 stations), .env (bot tokens)
- **Deployment**: Docker + Docker Compose
