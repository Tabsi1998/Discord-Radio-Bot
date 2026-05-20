#!/usr/bin/env sh
# ============================================================
# OmniFM - Host-seitiges Daten-Init-Script
# Erstellt alle benoetigten JSON-Dateien BEVOR docker compose up
# ausgefuehrt wird, damit Docker keine Verzeichnisse statt Dateien anlegt.
#
# Aufruf: ./init-data.sh
# ============================================================

set -e

echo "[INFO] Initialisiere OmniFM Datendateien..."

# Alle JSON-Dateien die als Docker-Volumes gemountet werden
JSON_FILES="
  bot-state.json
  custom-stations.json
  command-permissions.json
  guild-languages.json
  song-history.json
  listening-stats.json
  dashboard.json
  scheduled-events.json
  coupons.json
  premium.json
  discordbotlist.json
  botsgg.json
  topgg.json
  vote-events.json
"

for f in $JSON_FILES; do
  f=$(echo "$f" | tr -d ' ')
  if [ -z "$f" ]; then continue; fi

  if [ -d "./$f" ]; then
    echo "[WARN] ./$f ist ein Verzeichnis (Docker-Bug). Bitte manuell loeschen:"
    echo "[WARN]   rm -rf ./$f && echo '{}' > ./$f"
  elif [ ! -f "./$f" ]; then
    echo '{}' > "./$f"
    echo "[OK]   ./$f erstellt"
  else
    echo "[SKIP] ./$f existiert bereits"
  fi
done

# stations.json braucht ein gueltiges Stationen-Objekt als Default
if [ ! -f "./stations.json" ]; then
  printf '{"stations":{},"qualityPreset":"custom"}\n' > ./stations.json
  echo "[OK]   ./stations.json erstellt (leer)"
else
  echo "[SKIP] ./stations.json existiert bereits"
fi

# Log-Verzeichnis anlegen
mkdir -p ./logs
echo "[OK]   ./logs/ Verzeichnis sichergestellt"

echo ""
echo "[INFO] Fertig! Du kannst jetzt 'docker compose up -d' ausfuehren."
