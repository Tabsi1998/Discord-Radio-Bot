# Discord Radio Bot - PRD v3

## Original Problem Statement
Komplette Überprüfung und Optimierung des Discord Radio Bot Repositories. Alles muss zusammen funktionieren. Dynamische Bots (beliebig viele), Bot-Bilder als Avatare, richtige Umlaute überall, irrelevante Features entfernt/ersetzt, geführte Installation und Updates.

## Architecture
- **Discord Bot**: Node.js v20 (discord.js v14) - Multi-Bot System (1-20 Bots, dynamisch)
- **Web Interface (Prod)**: Vanilla HTML/CSS/JS in `web/` - served by Bot's HTTP Server
- **Web Interface (Preview)**: React.js in `frontend/` - served by React Dev Server
- **Preview Backend**: FastAPI in `backend/` - served dynamisch aus .env
- **Deployment**: Docker + Docker Compose + Systemd

## What's Been Implemented

### Session 1 - Web Interface Redesign
- React + FastAPI preview interface, Cyber-Analog dark theme

### Session 2 - Repository Optimization
- web/ komplett neu gebaut, install.sh v2.1, update.sh v2.1, README.md neu, 11 Stationen

### Session 3 - Aufräumen & Dynamisierung
- **Dynamische Bots**: Backend liest Bots direkt aus .env (beliebig viele, 1-20)
  - Keine hartcodierten Bots mehr in MongoDB
  - Farben und Bilder cyclen automatisch
- **Bot-Bilder**: 4 Custom-Avatare integriert (web/img/bot-1..4.png)
  - Werden in Bot-Cards angezeigt statt SVG-Icons
  - Cyclen bei mehr als 4 Bots
- **Umlaute korrigiert**: Alle ä, ö, ü richtig in beiden Interfaces (React + web/)
  - Lautstärke, für, Wähle, genieße, verfügbare, verlässt, Zuhörer, etc.
- **Feature-Text ersetzt**: "Flexibel konfigurierbar" → "Unbegrenzt skalierbar"
  - Alter Text war irrelevant (Stationen nur per CLI verwaltbar)
- **Code aufgeräumt**:
  - MongoDB seed für Bots entfernt (dynamisch aus .env)
  - Unnötige Duplikate entfernt
  - Web-Server generisch gemacht (beliebige Dateien aus web/)

## Testing Status (3 Iterationen, alle 100%)
- Iteration 1: Backend 5/5, Frontend alle Komponenten
- Iteration 2: + Genre-Filter, Station-Suche, Bot-Links
- Iteration 3: + Dynamische Bots, Bot-Bilder, Umlaute, Feature-Text

## Backlog
### P0 - Echte Bot-Tokens eintragen
### P1 - Premium Bot Tier, Station Request Form, Echtzeit-Listener
### P2 - Analytics, OAuth2, Mobile App
