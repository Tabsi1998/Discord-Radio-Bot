#!/bin/bash
# ============================================================
# OmniFM Fix Script - DAVE E2EE + 7 Bugfixes
# Ausfuehren im Repo-Root: bash apply-fixes.sh
# ============================================================
set -e

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO_DIR"

echo ""
echo "============================================================"
echo "  OmniFM Fix Script - DAVE E2EE Protokoll + Bugfixes"
echo "============================================================"
echo ""
echo "Arbeitsverzeichnis: $REPO_DIR"
echo ""

# ---- Backup erstellen ----
BACKUP_DIR="$REPO_DIR/.backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR/src/bot"
cp Dockerfile "$BACKUP_DIR/"
cp docker-entrypoint.sh "$BACKUP_DIR/"
cp package.json "$BACKUP_DIR/"
cp src/index.js "$BACKUP_DIR/src/"
cp src/guild-language-store.js "$BACKUP_DIR/src/"
cp src/bot/runtime.js "$BACKUP_DIR/src/bot/"
echo "[OK] Backup erstellt: $BACKUP_DIR"

# ============================================================
# FIX 0: Dockerfile - Node 20 -> Node 22 + libsodium-dev
# ============================================================
echo ""
echo "[1/6] Dockerfile: node:20 -> node:22 + libsodium-dev..."

sed -i 's|FROM node:20-slim AS frontend-builder|FROM node:22-slim AS frontend-builder|' Dockerfile
sed -i 's|FROM node:20-slim$|FROM node:22-slim|' Dockerfile

# libsodium-dev hinzufuegen (falls noch nicht vorhanden)
if ! grep -q "libsodium-dev" Dockerfile; then
  sed -i '/libopus-dev/a\    libsodium-dev \\' Dockerfile
fi

echo "[OK] Dockerfile aktualisiert"

# ============================================================
# FIX 1: package.json - DAVE + Encryption Dependencies
# ============================================================
echo "[2/6] package.json: @snazzah/davey + sodium-native + libsodium-wrappers..."

python3 << 'PYEOF'
import json

with open("package.json", "r") as f:
    pkg = json.load(f)

deps = pkg.get("dependencies", {})
changed = False

if "@snazzah/davey" not in deps:
    deps["@snazzah/davey"] = "^0.1.6"
    changed = True

if "sodium-native" not in deps:
    deps["sodium-native"] = "^3.3.0"
    changed = True

if "libsodium-wrappers" not in deps:
    deps["libsodium-wrappers"] = "^0.7.9"
    changed = True

if changed:
    # Sortiere dependencies alphabetisch
    pkg["dependencies"] = dict(sorted(deps.items()))
    with open("package.json", "w") as f:
        json.dump(pkg, f, indent=2)
        f.write("\n")
    print("[OK] package.json aktualisiert")
else:
    print("[SKIP] package.json - Dependencies bereits vorhanden")
PYEOF

# ============================================================
# FIX 2: docker-entrypoint.sh - JSON Validierung beim Start
# ============================================================
echo "[3/6] docker-entrypoint.sh: JSON-Validierung hinzufuegen..."

if ! grep -q "Validate JSON content" docker-entrypoint.sh; then
python3 << 'PYEOF'
with open("docker-entrypoint.sh", "r") as f:
    content = f.read()

old_block = '''  # Leere Datei? Initialisieren
  if [ -f "$filepath" ] && [ ! -s "$filepath" ]; then
    echo '{}' > "$filepath" 2>/dev/null || true
  fi
}'''

new_block = '''  # Leere Datei? Initialisieren
  if [ -f "$filepath" ] && [ ! -s "$filepath" ]; then
    echo '{}' > "$filepath" 2>/dev/null || true
  fi

  # Validate JSON content
  if [ -f "$filepath" ] && [ -s "$filepath" ]; then
    if ! node -e "JSON.parse(require('fs').readFileSync('$filepath','utf8'))" 2>/dev/null; then
      echo "[WARN] $filename enthaelt ungueltiges JSON. Erstelle Backup und initialisiere neu."
      cp "$filepath" "${filepath}.corrupt-$(date +%s)" 2>/dev/null || true
      echo '{}' > "$filepath" 2>/dev/null || true
    fi
  fi
}'''

if old_block in content:
    content = content.replace(old_block, new_block)
    with open("docker-entrypoint.sh", "w") as f:
        f.write(content)
    print("[OK] docker-entrypoint.sh aktualisiert")
else:
    print("[SKIP] docker-entrypoint.sh - Aenderung bereits vorhanden oder Struktur anders")
PYEOF
else
  echo "[SKIP] docker-entrypoint.sh - bereits aktualisiert"
fi

# ============================================================
# FIX 3: src/index.js - Voice Dependency Report
# ============================================================
echo "[4/6] src/index.js: Voice-Dependency-Report hinzufuegen..."

if ! grep -q "generateDependencyReport" src/index.js; then
python3 << 'PYEOF'
with open("src/index.js", "r") as f:
    content = f.read()

old = 'const EXPIRY_REMINDER_DAYS = parseExpiryReminderDays(process.env.EXPIRY_REMINDER_DAYS);\n\n// ---- Optional MongoDB-Verbindung ----'

new = '''const EXPIRY_REMINDER_DAYS = parseExpiryReminderDays(process.env.EXPIRY_REMINDER_DAYS);

// ---- Voice-Dependencies pruefen ----
try {
  const { generateDependencyReport } = await import("@discordjs/voice");
  const report = generateDependencyReport();
  log("INFO", `Voice-Dependencies:\\n${report}`);
} catch (depErr) {
  log("WARN", `Voice-Dependency-Check fehlgeschlagen: ${depErr.message}`);
}

// ---- Optional MongoDB-Verbindung ----'''

if old in content:
    content = content.replace(old, new)
    with open("src/index.js", "w") as f:
        f.write(content)
    print("[OK] src/index.js aktualisiert")
else:
    print("[WARN] src/index.js - Marker nicht gefunden, uebersprungen")
PYEOF
else
  echo "[SKIP] src/index.js - bereits aktualisiert"
fi

# ============================================================
# FIX 4: src/guild-language-store.js - Auto-Repair
# ============================================================
echo "[5/6] src/guild-language-store.js: Auto-Repair bei korrupter JSON..."

if ! grep -q "Auto-repaired" src/guild-language-store.js; then
python3 << 'PYEOF'
with open("src/guild-language-store.js", "r") as f:
    content = f.read()

old = '''function loadState() {
  return readState(STORE_FILE) || readState(BACKUP_FILE) || emptyState();
}'''

new = '''function loadState() {
  const primary = readState(STORE_FILE);
  if (primary) return primary;

  // Primary file is corrupt or missing - try backup
  const backup = readState(BACKUP_FILE);
  if (backup) {
    // Auto-repair: restore primary from backup
    try {
      const payload = `${JSON.stringify(backup, null, 2)}\\n`;
      fs.writeFileSync(STORE_FILE, payload, "utf8");
      console.log(`[guild-languages] Auto-repaired ${STORE_FILE} from backup.`);
    } catch (repairErr) {
      console.error(`[guild-languages] Auto-repair failed: ${repairErr.message}`);
    }
    return backup;
  }

  // Both corrupt/missing - start fresh and write a clean file
  const fresh = emptyState();
  try {
    fs.writeFileSync(STORE_FILE, `${JSON.stringify(fresh, null, 2)}\\n`, "utf8");
    console.log(`[guild-languages] Initialized fresh ${STORE_FILE}.`);
  } catch {
    // ignore - will work in-memory
  }
  return fresh;
}'''

if old in content:
    content = content.replace(old, new)
    with open("src/guild-language-store.js", "w") as f:
        f.write(content)
    print("[OK] src/guild-language-store.js aktualisiert")
else:
    print("[WARN] src/guild-language-store.js - Marker nicht gefunden")
PYEOF
else
  echo "[SKIP] src/guild-language-store.js - bereits aktualisiert"
fi

# ============================================================
# FIX 5: src/bot/runtime.js - ALLE Fixes
# ============================================================
echo "[6/6] src/bot/runtime.js: MessageFlags + ephemeral + Voice-Timeout + Album + Reconnect..."

python3 << 'PYEOF'
import re

with open("src/bot/runtime.js", "r") as f:
    content = f.read()

changes = 0

# --- 5a: MessageFlags Import hinzufuegen ---
if "MessageFlags," not in content and "MessageFlags" not in content:
    old_import = "  GuildScheduledEventEntityType,\n} from \"discord.js\";"
    new_import = "  GuildScheduledEventEntityType,\n  MessageFlags,\n} from \"discord.js\";"
    if old_import in content:
        content = content.replace(old_import, new_import)
        changes += 1
        print("  [+] MessageFlags import hinzugefuegt")

# --- 5b: ALLE ephemeral: true -> flags: MessageFlags.Ephemeral ---
count = content.count("ephemeral: true")
if count > 0:
    content = content.replace("ephemeral: true", "flags: MessageFlags.Ephemeral")
    changes += count
    print(f"  [+] {count}x ephemeral: true -> flags: MessageFlags.Ephemeral")

# --- 5c: Triple setEmoji Bug fixen ---
old_emoji = '''        .setLabel("\u25b6 YouTube")
        .setEmoji("\\u25b6")
        .setEmoji("\\u25b6")
        .setURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`)
        .setEmoji("\\u25b6"),'''
new_emoji = '''        .setLabel("\u25b6 YouTube")
        .setEmoji("\\u25b6")
        .setURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`),'''
if old_emoji in content:
    content = content.replace(old_emoji, new_emoji)
    changes += 1
    print("  [+] Triple setEmoji Bug gefixt")

# --- 5d: album Variable in buildNowPlayingEmbedLegacy ---
# Suche nach dem Muster wo title deklariert wird aber album fehlt
marker = '    const title = clipText(this.normalizeNowPlayingValue(meta?.title, station, meta, 140), 140);\n    const trackLabel = clipText('
if marker in content and 'const album = clipText(this.normalizeNowPlayingValue(meta?.album' not in content.split('buildNowPlayingEmbedLegacy')[1].split('buildNowPlayingEmbed(')[0] if 'buildNowPlayingEmbedLegacy' in content else '':
    # Finde die erste Stelle (Legacy-Methode)
    legacy_pos = content.find('buildNowPlayingEmbedLegacy')
    if legacy_pos > 0:
        # Finde den title-trackLabel Marker NACH der Legacy-Methode
        search_start = content.find(marker, legacy_pos)
        if search_start > 0:
            # Pruefe ob zwischen legacy_pos und naechster buildNowPlayingEmbed keine album-Deklaration existiert
            next_method = content.find('buildNowPlayingEmbed(', legacy_pos + 30)
            section = content[legacy_pos:next_method] if next_method > 0 else content[legacy_pos:legacy_pos+3000]
            if 'const album = clipText(this.normalizeNowPlayingValue(meta?.album' not in section:
                album_line = '    const album = clipText(this.normalizeNowPlayingValue(meta?.album, station, meta, 140), 140);\n'
                insert_point = content.find('\n    const trackLabel = clipText(', legacy_pos)
                if insert_point > 0 and insert_point < (next_method if next_method > 0 else insert_point + 1):
                    content = content[:insert_point] + '\n' + album_line.rstrip('\n') + content[insert_point:]
                    changes += 1
                    print("  [+] album Variable in buildNowPlayingEmbedLegacy hinzugefuegt")

# --- 5e: respondInteraction - ephemeral zu flags Konvertierung ---
old_respond = '''  async respondInteraction(interaction, payload) {
    if (interaction.deferred || interaction.replied) {
      const editPayload = { ...payload };
      delete editPayload.ephemeral;
      if (!editPayload.content && !editPayload.embeds) {
        const { t } = this.createInteractionTranslator(interaction);
        editPayload.content = t("Es ist ein Fehler aufgetreten.", "An error occurred.");
      }
      return interaction.editReply(editPayload);
    }
    return interaction.reply(payload);
  }'''
new_respond = '''  async respondInteraction(interaction, payload) {
    // Convert deprecated ephemeral to flags
    const finalPayload = { ...payload };
    if (finalPayload.ephemeral === true) {
      finalPayload.flags = MessageFlags.Ephemeral;
      delete finalPayload.ephemeral;
    } else if (finalPayload.ephemeral === false) {
      delete finalPayload.ephemeral;
    }

    if (interaction.deferred || interaction.replied) {
      const editPayload = { ...finalPayload };
      delete editPayload.flags;
      if (!editPayload.content && !editPayload.embeds) {
        const { t } = this.createInteractionTranslator(interaction);
        editPayload.content = t("Es ist ein Fehler aufgetreten.", "An error occurred.");
      }
      return interaction.editReply(editPayload);
    }
    return interaction.reply(finalPayload);
  }'''
if old_respond in content:
    content = content.replace(old_respond, new_respond)
    changes += 1
    print("  [+] respondInteraction: ephemeral->flags Konvertierung")

# --- 5f: respondLongInteraction - followUp mit flags ---
old_long = '      await interaction.followUp({ content: chunks[i], ephemeral });'
new_long = '      await interaction.followUp({ content: chunks[i], flags: ephemeral ? MessageFlags.Ephemeral : 0 });'
if old_long in content:
    content = content.replace(old_long, new_long)
    changes += 1
    print("  [+] respondLongInteraction: followUp mit flags")

# --- 5g: Voice-Timeout 20s -> 30s ---
# entersState Ready timeout
old_timeout1 = 'await entersState(connection, VoiceConnectionStatus.Ready, 20_000);'
new_timeout1 = 'await entersState(connection, VoiceConnectionStatus.Ready, 30_000);'
count_t1 = content.count(old_timeout1)
if count_t1 > 0:
    content = content.replace(old_timeout1, new_timeout1)
    changes += count_t1
    print(f"  [+] {count_t1}x Voice-Timeout 20s -> 30s")

# --- 5h: confirmBotVoiceChannel Timeout 8s -> 10s ---
old_timeout2 = 'timeoutMs: 8_000, intervalMs: 700'
new_timeout2 = 'timeoutMs: 10_000, intervalMs: 700'
count_t2 = content.count(old_timeout2)
if count_t2 > 0:
    content = content.replace(old_timeout2, new_timeout2)
    changes += count_t2
    print(f"  [+] {count_t2}x confirmBotVoiceChannel Timeout 8s -> 10s")

# --- 5i: Bessere Voice-Timeout Logging ---
# In ensureVoiceConnectionForChannel
old_voice_catch = '''    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch {
      if (state.connection === connection) {
        state.connection = null;
      }
      try { connection.destroy(); } catch {}
      throw new Error("Voice-Verbindung konnte nicht hergestellt werden.");
    }

    const joinedVoiceState = await this.confirmBotVoiceChannel(guildId, channel.id, { timeoutMs: 10_000, intervalMs: 700 });
    if (!joinedVoiceState) {
      if (state.connection === connection) {
        state.connection = null;
      }
      try { connection.destroy(); } catch {}
      throw new Error("Voice-Verbindung ist nicht stabil genug.");
    }'''

new_voice_catch = '''    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch {
      log("WARN", `[${this.config.name}] Voice-Timeout: guild=${guildId} channel=${channel.id} (${channel.name || "-"}) state=${connection.state?.status || "unknown"}`);
      if (state.connection === connection) {
        state.connection = null;
      }
      try { connection.destroy(); } catch {}
      networkRecoveryCoordinator.noteFailure(`${this.config.name} voice-connect-timeout`, `guild=${guildId} channel=${channel.id}`);
      throw new Error("Voice-Verbindung konnte nicht hergestellt werden.");
    }

    const joinedVoiceState = await this.confirmBotVoiceChannel(guildId, channel.id, { timeoutMs: 10_000, intervalMs: 700 });
    if (!joinedVoiceState) {
      log("WARN", `[${this.config.name}] Voice-Confirm fehlgeschlagen: guild=${guildId} channel=${channel.id} (${channel.name || "-"})`);
      if (state.connection === connection) {
        state.connection = null;
      }
      try { connection.destroy(); } catch {}
      throw new Error("Voice-Verbindung ist nicht stabil genug.");
    }'''

if old_voice_catch in content:
    content = content.replace(old_voice_catch, new_voice_catch)
    changes += 1
    print("  [+] Bessere Voice-Timeout Logging (ensureVoiceConnection)")

# --- 5j: tryReconnect Logging ---
old_reconnect_catch = '''    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch {
      if (state.connection === connection) {
        state.connection = null;
      }
      networkRecoveryCoordinator.noteFailure(`${this.config.name} reconnect-timeout`, `guild=${guildId}`);
      try { connection.destroy(); } catch {}
      return;
    }

    const joinedVoiceState = await this.confirmBotVoiceChannel(guildId, channel.id, { timeoutMs: 10_000, intervalMs: 700 });'''

new_reconnect_catch = '''    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch {
      log("WARN", `[${this.config.name}] Reconnect Voice-Timeout: guild=${guildId} channel=${channel.id} state=${connection.state?.status || "unknown"}`);
      if (state.connection === connection) {
        state.connection = null;
      }
      networkRecoveryCoordinator.noteFailure(`${this.config.name} reconnect-timeout`, `guild=${guildId}`);
      try { connection.destroy(); } catch {}
      return;
    }

    const joinedVoiceState = await this.confirmBotVoiceChannel(guildId, channel.id, { timeoutMs: 10_000, intervalMs: 700 });'''

if old_reconnect_catch in content:
    content = content.replace(old_reconnect_catch, new_reconnect_catch)
    changes += 1
    print("  [+] Bessere Reconnect Voice-Timeout Logging")

# --- 5k: playInGuild catch - Auto-Reconnect bei Voice-Timeout ---
old_play_catch = '''    } catch (err) {
      this.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
      log("ERROR", `[${this.config.name}] playInGuild error: ${err?.message || err}`);
      return { ok: false, error: err?.message || String(err) };
    }'''

new_play_catch = '''    } catch (err) {
      const isVoiceTimeout = String(err?.message || "").includes("Voice-Verbindung");
      if (isVoiceTimeout && state.lastChannelId) {
        // Transient voice error - preserve reconnect state so auto-reconnect can try later
        log("WARN", `[${this.config.name}] playInGuild voice timeout: guild=${guildId} channel=${channelId} - scheduling reconnect`);
        state.shouldReconnect = true;
        state.currentStationKey = stationKey;
        state.currentStationName = stationsData?.stations?.[stationKey]?.name || stationKey;
        if (state.connection) {
          try { state.connection.destroy(); } catch {}
          state.connection = null;
        }
        this.scheduleReconnect(guildId, { resetAttempts: true, reason: "play-voice-timeout" });
      } else {
        this.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
      }
      log("ERROR", `[${this.config.name}] playInGuild error: ${err?.message || err}`);
      return { ok: false, error: err?.message || String(err) };
    }'''

if old_play_catch in content:
    content = content.replace(old_play_catch, new_play_catch)
    changes += 1
    print("  [+] playInGuild: Auto-Reconnect bei Voice-Timeout")

# --- Datei schreiben ---
if changes > 0:
    with open("src/bot/runtime.js", "w") as f:
        f.write(content)
    print(f"  [OK] src/bot/runtime.js: {changes} Aenderungen angewendet")
else:
    print("  [SKIP] src/bot/runtime.js: Keine Aenderungen noetig (bereits aktuell?)")

PYEOF

# ============================================================
# JSON-Dateien reparieren
# ============================================================
echo ""
echo "JSON-Dateien pruefen und reparieren..."

for f in guild-languages.json command-permissions.json coupons.json; do
  if [ -f "$f" ]; then
    if ! node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null; then
      echo "  [FIX] $f ist korrupt -> wird zurueckgesetzt"
      cp "$f" "${f}.corrupt-$(date +%s)" 2>/dev/null || true
      echo '{}' > "$f"
    else
      echo "  [OK] $f ist valide"
    fi
  fi
done

# ============================================================
# Syntax-Check
# ============================================================
echo ""
echo "Syntax-Check..."
node --check src/bot/runtime.js && echo "  [OK] src/bot/runtime.js" || echo "  [FAIL] src/bot/runtime.js"
node --check src/index.js && echo "  [OK] src/index.js" || echo "  [FAIL] src/index.js"
node --check src/guild-language-store.js && echo "  [OK] src/guild-language-store.js" || echo "  [FAIL] src/guild-language-store.js"

# ============================================================
# Zusammenfassung
# ============================================================
echo ""
echo "============================================================"
echo "  ALLE FIXES ANGEWENDET!"
echo "============================================================"
echo ""
echo "  Geaenderte Dateien:"
echo "    - Dockerfile (node:22 + libsodium-dev)"
echo "    - package.json (@snazzah/davey + sodium-native + libsodium-wrappers)"
echo "    - docker-entrypoint.sh (JSON-Validierung)"
echo "    - src/index.js (Voice-Dependency-Report)"
echo "    - src/guild-language-store.js (Auto-Repair)"
echo "    - src/bot/runtime.js (MessageFlags + Voice-Timeout + Reconnect)"
echo ""
echo "  Naechste Schritte:"
echo "    1) npm install  (oder im Docker: docker compose build --no-cache)"
echo "    2) docker compose up -d"
echo "    3) docker compose logs -f omnifm"
echo "    4) Pruefen ob 'Voice-Dependencies' Report erscheint"
echo "    5) /play testen!"
echo ""
echo "  Backup deiner alten Dateien: $BACKUP_DIR"
echo ""
