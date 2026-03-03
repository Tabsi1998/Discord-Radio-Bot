# OmniFM Discord Radio Bot - Komplette Fehleranalyse & Fixes

## Datum: 2026-01-XX
## Repository: https://github.com/Tabsi1998/Discord-Radio-Bot
## Version: OmniFM v3.0
## Geaenderte Dateien: 3 (207 Einfuegungen, 146 Loeschungen)

---

## Zusammenfassung der Symptome (vom Benutzer gemeldet)

1. **`/play` startet keinen Voice-Kanal mehr** - Fehlermeldung: `Voice-Verbindung konnte nicht hergestellt werden.`
2. **Morgens Reconnect-Probleme** - Bot geht immer in Timeout
3. **`guild-languages.json` Parse-Fehler** - `Unexpected non-whitespace character after JSON at position 25`
4. **Deprecation Warning** - `Supplying "ephemeral" for interaction response options is deprecated`

---

## Gefundene Fehler & Angewendete Fixes

### FIX 1: KRITISCH - `album` undefiniert in `buildNowPlayingEmbedLegacy()` [BEHOBEN]
**Datei:** `src/bot/runtime.js`, Zeile 1207
**Problem:** Die Variable `album` wird in Zeile 1207 verwendet, aber nirgends in `buildNowPlayingEmbedLegacy()` deklariert. 
**Impact:** `ReferenceError: album is not defined` wenn Legacy-Embed mit Album-Daten aufgerufen wird.
**Fix:** `const album = clipText(this.normalizeNowPlayingValue(meta?.album, station, meta, 140), 140);` nach `title`-Deklaration eingefuegt.

---

### FIX 2: KRITISCH - Voice-Connection Timeout (`/play` schlaegt fehl) [BEHOBEN]
**Datei:** `src/bot/runtime.js`
**Problem:** 
- `entersState()` Timeout nur 20s - Log zeigt exakt 20s zwischen /play und Fehler
- `confirmBotVoiceChannel()` Timeout nur 8s
- Bei Fehler: `resetVoiceSession(preservePlaybackTarget: false)` -> kein Auto-Reconnect moeglich!

**Fixes angewendet:**
- Voice-Connection Timeout: 20s -> **30s** (ensureVoiceConnection + tryReconnect)
- confirmBotVoiceChannel Timeout: 8s -> **10s**
- Detaillierte Fehlerprotokollierung: Channel-Name, Connection-State, NetworkRecovery-Integration
- `playInGuild()` Error-Handler: Bei Voice-Timeout wird jetzt `scheduleReconnect()` aufgerufen statt harter Reset

---

### FIX 3: MODERAT - `ephemeral` Deprecation Warning [BEHOBEN]
**Datei:** `src/bot/runtime.js`, 133+ Stellen
**Problem:** Discord.js v14.17+ hat `ephemeral: true` als deprecated markiert.
**Fixes angewendet:**
- `MessageFlags` aus `discord.js` importiert
- Alle 133 direkte `ephemeral: true` -> `flags: MessageFlags.Ephemeral` ersetzt
- `respondInteraction()`: Automatische Konvertierung von verbleibendem `ephemeral` zu `flags`
- `respondLongInteraction()`: `followUp` mit `flags` statt `ephemeral`

---

### FIX 4: MINOR - Triple `.setEmoji()` Bug [BEHOBEN]
**Datei:** `src/bot/runtime.js`, `buildTrackLinkComponentsLegacy()`
**Problem:** YouTube-Button hat `.setEmoji()` 3x hintereinander aufgerufen.
**Fix:** Auf einen einzigen `.setEmoji()` Aufruf reduziert, URL-Zuweisung korrekt positioniert.

---

### FIX 5: MODERAT - `guild-languages.json` Parse-Fehler [BEHOBEN]
**Datei:** `src/guild-language-store.js`
**Problem:** Korrupte JSON-Datei, keine automatische Reparatur.
**Fixes angewendet:**
- `loadState()`: Bei korrupter Hauptdatei -> Backup automatisch lesen und Hauptdatei reparieren
- Bei korruptem Backup -> Frische Datei schreiben und sauberen State initialisieren
- Logging fuer alle Auto-Repair-Aktionen

**Datei:** `docker-entrypoint.sh`
**Problem:** Keine JSON-Validierung beim Container-Start.
**Fix:** JSON-Validierung mit `node -e` hinzugefuegt. Korrupte Dateien werden gesichert (.corrupt-TIMESTAMP) und neu initialisiert.

---

### FIX 6: KRITISCH - `playInGuild()` Auto-Reconnect bei Voice-Timeout [BEHOBEN]
**Datei:** `src/bot/runtime.js`, `playInGuild()` catch-Block
**Problem:** Bei JEDEM Fehler wurde `resetVoiceSession(preservePlaybackTarget: false)` aufgerufen -> `shouldReconnect=false`, kein Auto-Reconnect moeglich.
**Fix:** Bei transientem Voice-Timeout:
- `shouldReconnect` wird beibehalten
- Station und Channel werden gespeichert
- `scheduleReconnect()` wird mit `resetAttempts: true` aufgerufen
- Nur bei nicht-transienten Fehlern wird der harte Reset durchgefuehrt

---

## Verbleibende Empfehlungen (nicht im Code gefixt)

### R1: Netzwerk/Infrastruktur pruefen
Das Voice-Timeout-Problem kann auch durch Netzwerk-Infrastruktur verursacht werden:
- Discord Voice nutzt WebSocket + UDP. UDP muss von deinem Server erlaubt sein.
- Firewall-Regeln pruefen: Ausgehende UDP-Ports (1-65535) muessen offen sein.
- Bei Docker: `--network host` oder korrektes Port-Mapping fuer UDP verwenden.

### R2: `guild-languages.json` auf dem Host pruefen
Die korrupte Datei auf dem Host muss einmalig manuell repariert werden:
```bash
# Backup erstellen
cp guild-languages.json guild-languages.json.bak

# Pruefen ob valides JSON
python3 -c "import json; json.load(open('guild-languages.json'))"

# Wenn Fehler: Neu initialisieren
echo '{}' > guild-languages.json
```

### R3: @discordjs/voice Encryption
In der `package.json` fehlt eine explizite Encryption-Library. Neuere Versionen von `@discordjs/voice` (0.18+) bringen diese eingebaut mit, aber fuer Stabilitaet empfohlen:
```bash
npm install sodium-native
```

### R4: MIME_TYPES Duplikat
`MIME_TYPES` ist sowohl in `src/lib/helpers.js` als auch am Ende von `src/bot/runtime.js` definiert. Die Kopie in `runtime.js` (Zeile 6877-6890) kann entfernt werden.

---

## Architektur-Ueberblick

### Bot-Architektur
- **1 Commander** (OmniFM DJ) - empfaengt Slash-Commands, delegiert an Worker
- **16 Worker** (OmniFM 1-16) - streamen Audio in Voice-Channels
- **Tier-System**: Free (2 Worker), Pro (8 Worker), Ultimate (16 Worker)

### Voice-Connection Flow
```
Commander empfaengt /play
  -> findet freien Worker (WorkerManager)
  -> delegiert an worker.playInGuild()
    -> ensureVoiceConnectionForChannel()
      -> joinVoiceChannel()
      -> entersState(Ready, 30s) [vorher: 20s]
      -> confirmBotVoiceChannel(10s) [vorher: 8s]
    -> playStation()
      -> createResource() (ffmpeg spawn)
      -> player.play(resource)
```

### Reconnect Flow (nach Fix)
```
Voice disconnect -> voiceStateUpdate
  -> shouldReconnect=true?
    JA: scheduleReconnect() -> exponentieller Backoff -> tryReconnect()
    NEIN: resetVoiceSession()

playInGuild() Voice-Timeout (NEU):
  -> shouldReconnect beibehalten
  -> scheduleReconnect(resetAttempts=true, reason="play-voice-timeout")
  -> Worker versucht automatisch erneut zu verbinden
```
