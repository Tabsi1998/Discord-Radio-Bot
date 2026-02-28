#!/usr/bin/env sh

# KEIN set -e hier! Wir behandeln Fehler selbst.
export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"

# === JSON-Dateien sicherstellen ===
# Docker bind-mount erstellt ein VERZEICHNIS wenn die Datei auf dem Host fehlt.
# Ein Verzeichnis-Mount kann NICHT geloescht werden (Device or resource busy).
# Loesung: Wenn es ein Verzeichnis ist, pruefen ob darin geschrieben werden kann,
# ansonsten eine Warnung ausgeben und trotzdem starten.

init_json_file() {
  local filepath="$1"
  local filename=$(basename "$filepath")

  if [ -d "$filepath" ]; then
    # Es ist ein Verzeichnis (Docker hat es erstellt weil die Datei fehlte)
    echo "[WARN] $filepath ist ein Verzeichnis statt einer Datei!"
    echo "[WARN] Erstelle $filename auf dem Host und starte neu:"
    echo "[WARN]   echo '{}' > ./$filename"
    echo "[WARN]   docker compose up -d"
    # Versuche NICHT zu loeschen - das schlaegt fehl bei Docker-Mounts
    # Statt dessen starten wir trotzdem - der Code nutzt In-Memory-Fallback
    return 0
  fi

  if [ ! -f "$filepath" ]; then
    echo '{}' > "$filepath" 2>/dev/null || true
  fi

  # Leere Datei? Initialisieren
  if [ -f "$filepath" ] && [ ! -s "$filepath" ]; then
    echo '{}' > "$filepath" 2>/dev/null || true
  fi
}

init_json_file "/app/bot-state.json"
init_json_file "/app/custom-stations.json"
init_json_file "/app/command-permissions.json"
init_json_file "/app/guild-languages.json"
init_json_file "/app/song-history.json"
init_json_file "/app/scheduled-events.json"
init_json_file "/app/coupons.json"
init_json_file "/app/premium.json"
init_json_file "/app/stations.json"

if command -v ffmpeg >/dev/null 2>&1; then
  echo "[INFO] ffmpeg verfuegbar: $(ffmpeg -version | head -n 1)"
else
  echo "[WARN] ffmpeg fehlt im Container."
fi

if [ "${NOW_PLAYING_RECOGNITION_ENABLED:-0}" != "0" ]; then
  if command -v fpcalc >/dev/null 2>&1; then
    echo "[INFO] Audio-Erkennung bereit: $(fpcalc -version 2>/dev/null | head -n 1)"
  else
    echo "[WARN] Audio-Erkennung ist aktiviert, aber fpcalc/Chromaprint fehlt im Container."
    echo "[WARN] Bitte Docker-Image neu bauen oder die Build-Logs auf Paketfehler pruefen."
  fi
fi

# === Commands registrieren ===
if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ "${REGISTER_COMMANDS_ON_BOOT:-1}" = "1" ]; then
  echo "[INFO] Registriere Discord-Commands..."
  node /app/src/deploy-commands.js || echo "[WARN] Command-Registrierung fehlgeschlagen (ueberspringe)"
fi

echo "[INFO] Starte OmniFM..."
exec node /app/src/index.js
