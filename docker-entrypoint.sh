#!/usr/bin/env sh
set -e

# Sicherstellen dass bot-state.json als Datei existiert
# (Docker Volume-Mount erstellt ein Verzeichnis wenn die Datei nicht existiert)
STATE_FILE="/app/bot-state.json"
if [ -d "$STATE_FILE" ]; then
  rm -rf "$STATE_FILE"
fi
if [ ! -f "$STATE_FILE" ]; then
  echo '{}' > "$STATE_FILE"
fi

CUSTOM_FILE="/app/custom-stations.json"
if [ -d "$CUSTOM_FILE" ]; then
  rm -rf "$CUSTOM_FILE"
fi
if [ ! -f "$CUSTOM_FILE" ]; then
  echo '{}' > "$CUSTOM_FILE"
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

if [ "${REGISTER_COMMANDS_ON_BOOT:-1}" = "1" ]; then
  node /app/src/deploy-commands.js
fi

exec node /app/src/index.js
