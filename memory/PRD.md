# Discord Radio Bot - PRD v4

## Original Problem Statement
1. Kritischer Bug: `/play` Command crasht wegen `getChannel()` auf String-Option (Type 3 vs Type 7)
2. Bot-Presence in Discord professionell gestalten mit Webseiten-Link
3. Audio-Player auf der Webseite zum Vorhören von Stationen
4. Bot-Statistik-Cards wie Jockie Music (Server, Nutzer, Verbindungen, Zuhörer pro Bot)
5. Richtige Umlaute überall
6. Feature-Text korrigiert

## Critical Bug Fix
**`Option "channel" is of type: 3; expected 7`**
- Ursache: `interaction.options.getChannel("channel")` auf einem `addStringOption` Feld
- Fix: Ersetzt durch `interaction.options.getString("channel")` + `resolveVoiceChannelFromInput()`
- Datei: `/app/src/index.js` Zeile 962

## What's Been Implemented

### Session 4 - Bug Fix + Features
- **KRITISCHER BUG GEFIXT**: getChannel() → getString() für Channel-Option im /play Command
- **Audio-Player**: Stationen klickbar zum Vorhören auf der Webseite (React + web/)
  - Now-Playing-Bar mit animierten EQ-Balken
  - Play/Pause Toggle pro Station
  - Stop-Button in der Now-Playing-Bar
- **Bot-Statistik-Cards**: Farbcodierte Cards mit:
  - Server, Nutzer, Verbindungen, Zuhörer pro Bot
  - "BOT STATISTIKEN" Label in Bot-Akzentfarbe
  - 2x2 Grid-Layout
- **Genre-Filter**: Filter-Buttons für alle 11 Genres sichtbar
- **Genre-Tags**: Auf jeder Station-Card angezeigt
- **Bot-Presence verbessert**: Zeigt "Bereit für /play | <website-url>" statt "Bereit fuer /play"

## Testing (4 Iterationen)
- Iteration 1: 100% Backend + Frontend
- Iteration 2: 100% + Genres, Links, Search
- Iteration 3: 100% + Dynamische Bots, Bilder, Umlaute
- Iteration 4: 98% (nur Browser-Autoplay-Policy als minor)

## Backlog
### P0 - Docker rebuild auf Server und testen
### P1 - Premium Bot Tier, Echtzeit-Listener via WebSocket
### P2 - Analytics Dashboard, Discord OAuth2
