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
- `/now`
- `/addstation name url [key]`
- `/removestation key`

## Hinweise
- Slash-Commands werden beim Container-Start automatisch registriert (wenn ENV gesetzt).
- Manche Streams benötigen FFmpeg. Im Docker-Image ist FFmpeg enthalten.
- `stations.json` wird bei `/addstation` und `/removestation` geschrieben (im Docker-Setup als RW Volume gemountet).
