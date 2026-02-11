# radio-bot

Discord 24/7 Radio Bot (Webstreams) mit Slash Commands.

## One-Command Installation (Ubuntu Docker)
```bash
bash ./install.sh
```
Das Script fragt nach `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` sowie deinen Stationen (Name + URL) und startet danach automatisch:

```
docker compose up -d --build
```

## Update (Ubuntu)
```bash
bash ./update.sh
```
Das Script holt Updates aus Git, bewahrt lokale Änderungen (z. B. `stations.json`) und baut den Container neu.

## Autostart nach Server-Neustart (Ubuntu)
```bash
sudo bash ./install-systemd.sh
```
Das installiert einen Systemd-Service, der den Bot beim Boot startet.

## One-Command Installation (Windows Docker)
```powershell
.\install.ps1
```

## Manuelle Docker-Installation
1. `.env` befüllen (Token/IDs)
2. `stations.json` anpassen
3. Starten:

```bash
docker compose up -d --build
```

## Lokaler Start (ohne Docker)
1. `npm install`
2. `.env` befüllen
3. `stations.json` anpassen
4. Slash Commands registrieren: `npm run deploy`
5. Starten: `npm start`

## Commands
- `/play [station]`
- `/pause`
- `/resume`
- `/stop`
- `/stations`
- `/list [page]`
- `/now`
- `/addstation name url [key]`
- `/removestation key`
- `/setdefault key`
- `/renamestation key name`
- `/setvolume value`
- `/status`
- `/health`
- `/backupstations`
- `/importstations file`
- `/quality preset`
- `/lock on|off`
- `/audit`

## Hinweise
- Slash-Commands werden beim Container-Start automatisch registriert (wenn ENV gesetzt).
- Manche Streams benötigen FFmpeg. Im Docker-Image ist FFmpeg enthalten.
- Für beste Audioqualität wird nativer Opus genutzt (Dockerfile installiert Build-Dependencies).
- `stations.json` wird bei `/addstation` und `/removestation` geschrieben (im Docker-Setup als RW Volume gemountet).
- Logs liegen unter `./logs` (Docker Volume ist gemountet).

## Audio-Qualität (optional)
Standard: Der Stream wird direkt an Discord gegeben. Optional kannst du **FFmpeg-Transcoding** aktivieren:

```env
TRANSCODE=1
TRANSCODE_MODE=opus   # opus oder pcm
OPUS_BITRATE=192k
OPUS_VBR=on
OPUS_COMPRESSION=10
OPUS_FRAME=20
```

Empfohlen: `TRANSCODE_MODE=opus` mit 48 kHz, Stereo, SOXR-Resampling.

## Admin-Rechte (optional)
In `.env` kannst du Admins festlegen:
```
ADMIN_USER_IDS=123,456
ADMIN_ROLE_IDS=789,012
```
Wenn `ADMIN_ROLE_IDS` leer ist, dürfen alle Admin-Commands nutzen.
