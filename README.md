# Discord Radio Hosting

Eine Web-UI fuer einen Multi-Server Radio/Livestream Bot. Slash-Commands bleiben aktiv;
das Dashboard ist zusaetzlich.

## Einrichtung
1) Abhaengigkeiten installieren:
   `npm install`
2) Konfiguration kopieren:
   `copy config.example.json config.json`
3) `config.json` fuellen:
   - `token`, `clientId`, `clientSecret`
   - `publicBaseUrl` (z.B. `https://radio.example`)
   - `sessionSecret`
   - `dbPath` (bei Docker: `/app/data/data.sqlite`)
   - `maxSlots` (1-3, wie viele Streams pro Server moeglich sind)
4) Discord Developer Portal (einmalig):
   - https://discord.com/developers/applications -> "New Application"
   - Name setzen -> Create
   - "General Information":
     - Application ID = `clientId`
     - (optional) Icon/Name
   - "Bot":
     - "Add Bot" -> bestaetigen
     - Token kopieren = `token`
     - "Public Bot" = ON (wenn externe Server den Bot hinzufuegen sollen)
     - "Privileged Gateway Intents": nichts noetig fuer diesen Bot
   - "OAuth2" -> "General":
     - Redirects (exakt, inkl. https und ohne Slash am Ende):
       - `https://radio.example/auth/callback` (muss 1:1 zu `publicBaseUrl` passen)
   - "OAuth2" -> "General" oder "Client Secret":
     - Client Secret kopieren = `clientSecret`
   - Bot Permissions fuer Invite:
     - Connect + Speak
5) Start:
   `npm start`

## Docker (einfacher Install)
1) `copy config.example.json config.json` und Werte eintragen.
2) Build & Start:
   `docker compose up -d --build`
3) Logs:
   `docker compose logs -f`
4) Falls die DB nicht erstellt werden kann:
   - Stelle sicher, dass ein Ordner `data/` existiert und schreibbar ist.

## Web-Funktionen
- Landing Page mit oeffentlichen Stats.
- Login via Discord OAuth2.
- Dashboard: bis zu 3 Slots pro Server, Kanal/Stream setzen, Start/Stop, Auto-Play.
- Bot laeuft auf allen Servern gleichzeitig, ohne Mehrfach-Install.

## Slash Commands (bleiben aktiv)
- `/help`
- `/setchannel slot:<1-3> kanal:<Sprachkanal>`
- `/setstream slot:<1-3> url:<Stream-URL>`
- `/play slot:<1-3>`
- `/stop slot:<1-3>`
- `/status`

## Hinweise
- Der Bot braucht die Rechte: Verbinden + Sprechen im Ziel-Sprachkanal.
- Direkte Audio-Streams (MP3/AAC/OGG) sind am stabilsten.
- YouTube-Livestreams werden ueber `ytdl-core` versucht.
- Wenn du "restricted uri" siehst: die Redirect URL stimmt nicht exakt mit `publicBaseUrl` ueberein.
- Wenn du die MemoryStore-Warnung siehst: Session-Store ist jetzt SQLite-basiert.
