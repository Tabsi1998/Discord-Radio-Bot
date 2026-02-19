# radio-bot

Discord Radio Bot fuer Ubuntu/Linux mit:
- Multi-Bot Backend (z. B. 4 Bots in einem Prozess)
- Invite-Webseite (`/`) fuer alle konfigurierten Bots
- Stationsverwaltung nur ueber CLI (inkl. gefuehrtem Wizard)

## Architektur
- 1 gemeinsames Backend (`src/index.js`)
- N Bot-Accounts (`BOT_1_*`, `BOT_2_*`, ...)
- 1 gemeinsame Webseite (`web/`) mit Invite-Links
- 1 gemeinsame Stationsdatei (`stations.json`)

Damit kannst du in einem Discord-Server mehrere deiner Bots parallel einladen.

## Schnellstart (Ubuntu/Linux)
```bash
bash ./install.sh
```

Das Setup fragt dich u. a. nach:
- Anzahl Bot-Accounts
- pro Bot: Name, Token, Client ID
- Web-Port

Danach:
- startet Docker Compose
- registriert globale Slash-Commands fuer alle Bots
- installiert den Systemd-Autostart

## Domain / Webseite
Die Invite-Seite liegt auf `http://<server-ip>:<WEB_PORT>`.

Mit Reverse-Proxy (z. B. Nginx/Caddy) kannst du sie auf eine Domain legen,
z. B. `https://bot.deinedomain.tld`.

Compose published standardmaessig:
- `${WEB_PORT:-8081}:${WEB_INTERNAL_PORT:-8080}`

## Bot-Konfiguration (.env)
Beispiel:
```env
REGISTER_COMMANDS_ON_BOOT=1
CLEAN_GUILD_COMMANDS_ON_BOOT=1
WEB_PORT=8081
WEB_INTERNAL_PORT=8080
WEB_BIND=0.0.0.0

BOT_1_NAME=Radio Bot 1
BOT_1_TOKEN=...
BOT_1_CLIENT_ID=...
BOT_1_PERMISSIONS=

BOT_2_NAME=Radio Bot 2
BOT_2_TOKEN=...
BOT_2_CLIENT_ID=...
BOT_2_PERMISSIONS=
```

Legacy (Single-Bot) wird weiterhin unterstuetzt:
- `DISCORD_TOKEN`
- `CLIENT_ID`
- optional `BOT_NAME`

## Stationsverwaltung (CLI)
Einfachster Weg (Docker-Wrapper):
```bash
bash ./stations.sh
```
Ohne Argument startet automatisch ein Wizard.

Direkt:
```bash
bash ./stations.sh wizard
bash ./stations.sh list
bash ./stations.sh add "One World Radio" "https://tomorrowland.my105.ch/oneworldradio.mp3" oneworldradio
bash ./stations.sh remove oneworldradio
bash ./stations.sh rename oneworldradio "OWR"
bash ./stations.sh set-default oneworldradio
bash ./stations.sh quality high
bash ./stations.sh fallback oneworldradio,lofi
bash ./stations.sh fallback clear
```

Alternative ohne Docker-Wrapper:
```bash
npm run stations -- wizard
```

## Discord Commands (Playback only)
- `/play [station] [channel]`
- `/pause`
- `/resume`
- `/stop`
- `/stations`
- `/list [page]`
- `/now`
- `/setvolume value`
- `/status`
- `/health`

## Multi-Bot Invite Workflow
1. Erstelle mehrere Discord Applications (eine pro Bot).
2. Trage jede Kombination aus Token + Client ID in `.env` ein.
3. Starte den Stack neu: `docker compose up -d --build`.
4. Oeffne die Webseite und nutze pro Bot den Invite-Button.

## Docker
```bash
docker compose up -d --build
```

## Update
```bash
bash ./update.sh
```

`update.sh` fuehrt einen robusten One-Command-Update-Flow aus:
- holt zuerst die neueste `update.sh`-Logik von `origin/main`
- sichert lokale Runtime-Dateien (`.env`, `stations.json`, `docker-compose.override.yml`)
- synchronisiert den Code hart auf `origin/main`
- stellt die Runtime-Dateien wieder her
- fuehrt `docker compose up -d --build --remove-orphans` aus
- macht einen lokalen Health-Check

## Hinweise
- `stations.json` und `logs/` sind als Volumes gemountet.
- Globale Slash-Commands koennen bis zu ~1 Stunde brauchen, bis sie ueberall sichtbar sind.
- FFmpeg ist im Docker-Image enthalten.
- Jeder Bot nutzt eine eigene Voice-Connection-Gruppe (mehrere Bots koennen im selben Server parallel in unterschiedlichen Channels laufen).
- Wird ein Bot manuell aus dem Voice-Channel gekickt, deaktiviert er Auto-Reconnect. Starte ihn dann gezielt neu mit `/play`.
- `CLEAN_GUILD_COMMANDS_ON_BOOT=1` entfernt veraltete Guild-Commands beim Start (verhindert doppelte `/play`-Eintraege).
