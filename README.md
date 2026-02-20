# Discord Radio Bot v2.1.0

24/7 Radio-Streaming fuer Discord Server. Multi-Bot-System mit bis zu 20 parallelen Bots, modernem Web-Interface und CLI-Stationsverwaltung.

## Features

- **Multi-Bot**: Bis zu 20 Bots parallel, jeder in eigenem Voice-Channel
- **Slash-Commands**: `/play`, `/pause`, `/resume`, `/stop`, `/stations`, `/now`, `/setvolume`, `/status`, `/health`, `/list`
- **HQ Audio**: Opus-Transcoding mit konfigurierbarer Bitrate (low/medium/high/custom)
- **Auto-Reconnect**: Automatische Wiederverbindung bei Verbindungsabbruch
- **Fallback-Stationen**: Bei Stream-Fehler automatisch auf Alternative wechseln
- **Web-Interface**: Modernes Invite-Dashboard mit Bot-Cards, Station-Directory und Live-Stats
- **CLI-Verwaltung**: Stations-Wizard und Kommandozeilen-Tools
- **Docker**: One-Command Installation und Updates
- **Systemd**: Autostart nach Server-Neustart

## Schnellstart

### One-Command Installation

```bash
git clone https://github.com/Tabsi1998/Discord-Radio-Bot.git
cd Discord-Radio-Bot
bash ./install.sh
```

Der Installer fragt interaktiv nach:
- Anzahl der Bots (1-20)
- Bot-Tokens und Client-IDs pro Bot
- Web-Port (Standard: 8081)
- Optionale Public-URL

### Was du brauchst

1. **Discord Bot erstellen**: https://discord.com/developers/applications
2. **Bot-Token** und **Client-ID** pro Bot-Account
3. **Server mit Docker** (Ubuntu empfohlen)

## Stationsverwaltung

### Wizard (interaktiv)
```bash
bash ./stations.sh
```

### Direkte Befehle
```bash
bash ./stations.sh list                          # Alle Stationen anzeigen
bash ./stations.sh add "Mein Radio" "https://..."  # Station hinzufuegen
bash ./stations.sh remove meinradio              # Station entfernen
bash ./stations.sh rename meinradio "Neuer Name" # Umbenennen
bash ./stations.sh set-default lofi              # Default setzen
bash ./stations.sh quality high                  # Quality Preset (low/medium/high/custom)
bash ./stations.sh fallback lofi,pop             # Fallback-Liste
bash ./stations.sh fallback clear                # Fallback leeren
```

### Standard-Stationen (11 Stationen vorinstalliert)
- Tomorrowland - One World Radio
- Lofi Hip Hop Radio
- Classic Rock Radio
- Chillout Lounge
- Dance Radio
- Hip Hop Channel
- Techno Bunker
- Pop Hits
- Rock Nation
- Bass Boost FM
- Deutsch Rap

## Update

```bash
bash ./update.sh
```

Das Update-Script:
1. Sichert `.env` und `stations.json` automatisch
2. Holt neuesten Code von GitHub
3. Stellt deine Konfiguration wieder her
4. Baut Docker neu und startet den Bot

## Checks

```bash
npm run test
```

Fuehrt einen schnellen Syntax-Smoke-Check fuer die wichtigsten `src/*.js` Dateien aus.

## Web-Interface

Nach der Installation erreichbar unter `http://<server-ip>:<port>`

Features:
- Modernes Dark-Theme Design
- Bot-Cards mit Invite-Links (pro Bot)
- Station-Directory mit Live-Suche
- Slash-Command Referenz
- Live-Statistiken (Server, Nutzer, Verbindungen)
- Auto-Refresh alle 15 Sekunden

## Dateistruktur

```
Discord-Radio-Bot/
  install.sh          # One-Command Installer
  update.sh           # Auto-Update von Git
  stations.sh         # CLI Stationsverwaltung
  install-systemd.sh  # Autostart Setup
  radio-bot.service   # Systemd Service Template
  docker-compose.yml  # Docker Compose Config
  Dockerfile          # Docker Build
  docker-entrypoint.sh
  package.json
  stations.json       # Station-Konfiguration (wird NICHT ueberschrieben)
  .env                # Bot-Tokens (wird NICHT ueberschrieben)
  src/
    index.js          # Bot-Hauptprogramm + Web-Server
    commands.js       # Slash-Command Definitionen
    bot-config.js     # Bot-Konfiguration aus .env
    deploy-commands.js # Command-Registrierung bei Discord
    stations-store.js  # Stations lesen/schreiben
    stations-cli.js    # CLI-Tool
  web/
    index.html        # Web-Interface
    styles.css        # Styling
    app.js            # Frontend-Logik
  logs/               # Bot-Logs (automatisch)
```

## Umgebungsvariablen (.env)

| Variable | Beschreibung | Standard |
|---|---|---|
| `BOT_N_TOKEN` | Discord Bot Token (N=1..20) | - |
| `BOT_N_CLIENT_ID` | Discord Client ID | - |
| `BOT_N_NAME` | Bot-Anzeigename | Radio Bot N |
| `BOT_N_PERMISSIONS` | Bot-Permissions | 3145728 |
| `WEB_PORT` | Host-Port fuer Web-Interface | 8081 |
| `WEB_INTERNAL_PORT` | Container-interner Port | 8080 |
| `WEB_BIND` | Bind-Adresse | 0.0.0.0 |
| `PUBLIC_WEB_URL` | Oeffentliche URL | - |
| `CHECKOUT_RETURN_ORIGINS` | Erlaubte Origins fuer Stripe `returnUrl` (CSV) | - |
| `STRIPE_SECRET_KEY` | Stripe Secret Key (Checkout/Verify/Webhook) | - |
| `STRIPE_WEBHOOK_SECRET` | Stripe Webhook Signing Secret | - |
| `REGISTER_COMMANDS_ON_BOOT` | Slash-Commands registrieren | 1 |
| `CLEAN_GUILD_COMMANDS_ON_BOOT` | Guild-Commands bereinigen | 1 |
| `SMTP_TLS_MODE` | SMTP TLS Modus (`auto/plain/starttls/smtps`) | auto |
| `SMTP_TLS_REJECT_UNAUTHORIZED` | SMTP Zertifikat pruefen (`1`/`0`) | 0 |
| `TRANSCODE` | FFmpeg Transcoding aktiv | 0 |
| `LOG_MAX_MB` | Max Log-Groesse in MB | 5 |

## Troubleshooting

### Bot startet nicht
```bash
docker compose logs --tail=100 radio-bot
```

### Stationen laden nicht im Discord
- Pruefe ob `stations.json` Stationen enthaelt: `bash ./stations.sh list`
- Discord-Autocomplete braucht bis zu 1 Minute nach Bot-Neustart
- Mindestens 1 Station muss konfiguriert sein

### Kein Sound
- Bot braucht `Connect` + `Speak` Permissions im Voice-Channel
- Stream-URL muss erreichbar sein (teste mit `curl <url>`)
- Quality Preset testen: `bash ./stations.sh quality high`

## Lizenz

MIT
