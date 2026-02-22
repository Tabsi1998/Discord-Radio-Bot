#!/usr/bin/env sh

# KEIN set -e hier! Wir behandeln Fehler selbst.

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
init_json_file "/app/premium.json"
init_json_file "/app/stations.json"

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
