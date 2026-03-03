## So wendest du die Fixes an (3 Schritte)

### Schritt 1: Script auf Server kopieren
Lade `apply-fixes.sh` herunter und kopiere es in dein Repo-Verzeichnis:

```bash
# Auf deinem Server:
cd /opt/Discord-Radio-Bot
# Script hierhin kopieren (per SCP, wget, oder einfach Inhalt einfuegen)
```

### Schritt 2: Script ausfuehren
```bash
bash apply-fixes.sh
```

### Schritt 3: Docker neu bauen und starten
```bash
docker compose build --no-cache
docker compose up -d
docker compose logs -f omnifm
```

### Was das Script macht:
- Erstellt Backup aller Dateien
- Dockerfile: node:20 -> node:22 + libsodium-dev
- package.json: @snazzah/davey + sodium-native + libsodium-wrappers
- docker-entrypoint.sh: JSON-Validierung
- src/index.js: Voice-Dependency-Report
- src/guild-language-store.js: Auto-Repair
- src/bot/runtime.js: 147 Aenderungen (MessageFlags, Voice-Timeout, Reconnect, etc.)
- Repariert korrupte JSON-Dateien
- Macht Syntax-Check am Ende
