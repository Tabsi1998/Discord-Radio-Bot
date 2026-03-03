# OmniFM Discord Radio Bot - Komplette Fehleranalyse & Fixes

## Datum: 2026-03-03
## Repository: https://github.com/Tabsi1998/Discord-Radio-Bot
## Version: OmniFM v3.0
## Geaenderte Dateien: 6 (222 Einfuegungen, 148 Loeschungen)

---

## ROOT CAUSE: Discord DAVE Protokoll seit 1. Maerz 2026 PFLICHT!

Am 1-2. Maerz 2026 hat Discord das **DAVE End-to-End Encryption Protokoll** fuer ALLE Voice-Verbindungen verpflichtend gemacht. Bots die DAVE nicht unterstuetzen koennen sich NICHT MEHR in Voice-Channels verbinden.

**Der Bot crasht am 3. Maerz 2026 - genau 2 Tage nach dem Enforcement.**

### 3 Kritische fehlende Abhaengigkeiten:
1. **Node.js 20 im Dockerfile** -> `@discordjs/voice@0.18.0` braucht **Node.js 22.12.0+**
2. **`@snazzah/davey` fehlt** -> Pflicht-Library fuer DAVE E2EE Protokoll
3. **Keine Encryption-Library** -> `sodium-native` + `libsodium-wrappers` fehlen komplett

---

## Alle Fixes (Zusammenfassung)

### FIX 0: SHOW-STOPPER - DAVE Protokoll + Node.js Version [BEHOBEN]

**Dateien:** `Dockerfile`, `package.json`, `src/index.js`

**Problem:** Discord erzwingt seit 1. Maerz 2026 das DAVE E2EE-Protokoll. Ohne die richtigen Libraries kann der Bot KEINE Voice-Verbindung mehr herstellen. Das erklaert exakt das Timeout nach 20s - die DAVE-Handshake schlaegt fehl.

**Fixes angewendet:**

| Datei | Aenderung |
|-------|-----------|
| `Dockerfile` | `node:20-slim` -> **`node:22-slim`** (beide Stages) |
| `Dockerfile` | `libsodium-dev` hinzugefuegt (fuer sodium-native Kompilierung) |
| `package.json` | **`@snazzah/davey: ^0.1.6`** hinzugefuegt (DAVE E2EE Protokoll) |
| `package.json` | **`sodium-native: ^3.3.0`** hinzugefuegt (beste Performance) |
| `package.json` | **`libsodium-wrappers: ^0.7.9`** hinzugefuegt (Fallback) |
| `src/index.js` | Voice-Dependency-Report beim Start (zeigt ob alles korrekt geladen) |

---
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
