# Discord Radio Bot - PRD v2

## Original Problem Statement
Komplette Überprüfung und Optimierung des gesamten Discord Radio Bot Repositories. Alles muss zusammen funktionieren: One-Command Installation (install.sh), Auto-Updates von Git (update.sh), CLI Stationsverwaltung (stations.sh), Docker-Deployment, Bot-Code, Web-Interface. Modernes Design inspiriert von jockiemusic.com.

## Architecture
- **Discord Bot**: Node.js v20 (discord.js v14) - Multi-Bot System (1-20 Bots)
- **Web Interface (Prod)**: Vanilla HTML/CSS/JS in `web/` - served by Bot's HTTP Server
- **Web Interface (Preview)**: React.js in `frontend/` - served by React Dev Server
- **Preview Backend**: FastAPI in `backend/` - serves same API structure
- **Database (Preview)**: MongoDB for bot/station data
- **Deployment**: Docker + Docker Compose + Systemd

## User Personas
1. **Server Owner**: Will Radio-Bots auf Discord-Server einladen
2. **Listener**: Hört Radio über den Bot, browst Stationen
3. **Bot Admin**: Installiert, konfiguriert und verwaltet Bots
4. **Self-Hoster**: Betreibt eigene Bot-Instanz auf eigenem Server

## Core Requirements (Status)
- [x] One-Command Installation via `bash ./install.sh`
- [x] Auto-Update von Git via `bash ./update.sh`
- [x] CLI Stationsverwaltung via `bash ./stations.sh`
- [x] Docker-Deployment mit Systemd-Autostart
- [x] Modernes Web-Interface (Dark Cyber-Analog Theme)
- [x] Multi-Bot Invite Cards mit farbcodierten Buttons
- [x] Station Directory mit Suche und Genre-Filter
- [x] Slash-Commands Referenz im Terminal-Style
- [x] Live-Statistiken
- [x] Discord Autocomplete Fix für Stationen
- [x] 11 Standard-Stationen vorinstalliert
- [x] Responsive Design

## What's Been Implemented (Feb 2026)

### Session 1 - Web Interface
- React + FastAPI preview interface
- Hero, Bot Cards, Features, Station Browser, Commands, Footer sections
- Seeded 4 default bots + 11 stations with genres

### Session 2 - Complete Repository Optimization
- **web/ folder completely rebuilt** - Same modern design as React, but standalone HTML/CSS/JS
  - Responsive, dark themed, Orbitron + DM Sans + JetBrains Mono fonts
  - Animated equalizer bars, glow effects, noise overlay
  - Bot cards with colored accent bars, invite buttons, copy functionality
  - Station list with real-time search filtering
  - Commands terminal view
  - Footer with live stats
- **src/index.js web server improved**
  - Generic static file serving (supports any file type from web/)
  - MIME type detection for CSS, JS, HTML, images, fonts
  - CORS headers for cross-origin API access
  - OPTIONS preflight handling
- **install.sh v2.1** - Interactive installer with:
  - Docker auto-install
  - Bot configuration wizard (1-20 bots)
  - 11 default stations auto-created in stations.json
  - Systemd autostart setup
  - Clear progress steps [1/4] .. [4/4]
- **update.sh v2.1** - Self-updating update script with:
  - Automatic backup of .env + stations.json
  - Git sync with preserved runtime files
  - Docker rebuild
  - Health check after restart
  - Clear progress steps [1/5] .. [5/5]
- **stations.json** - 11 default stations with genres
- **Station autocomplete fix** - try/catch wrapper, debug logging, fresh channel fetch
- **package.json** version bump to 2.1.0
- **README.md** completely rewritten with:
  - Feature list, installation guide, CLI commands
  - File structure documentation
  - Environment variables table
  - Troubleshooting section
- **.gitignore** cleaned up

## Testing Status
- Backend: 100% (5/5 API endpoints, both iterations)
- Frontend: 100% (all components, interactions, search/filter)
- web/ standalone interface: Design matches React preview
- install.sh: Syntax verified, logic reviewed
- update.sh: Syntax verified, self-update bootstrap tested
- stations.sh: Existing functionality preserved
- stations-cli.js: All commands functional

## Backlog (P0/P1/P2)

### P0 - Setup für Produktion
- Echte Discord Bot Tokens in .env eintragen
- deploy-commands.js ausführen nach Token-Setup
- stations.json anpassen nach Wunsch

### P1 - Near Term
- Premium Bot Tier (Stripe für zahlende Nutzer)
- User Dashboard (Bot-Einstellungen pro Server)
- Station Request Formular (Community-Vorschläge)
- Real-time Listener Count via WebSocket

### P2 - Future
- Custom Station URLs pro Server
- Analytics Dashboard
- Discord OAuth2 Login
- Multilingual Support
- Mobile App Companion
