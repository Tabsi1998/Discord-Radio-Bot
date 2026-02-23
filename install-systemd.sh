#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="${SERVICE_NAME:-radio-bot.service}"
SERVICE_SRC="$APP_DIR/$SERVICE_NAME"
SERVICE_DST="/etc/systemd/system/$SERVICE_NAME"

if [[ ! -f "$SERVICE_SRC" ]]; then
  echo "$SERVICE_NAME nicht gefunden." >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Bitte mit sudo ausführen: sudo bash ./install-systemd.sh"
  exit 1
fi

sed "s|__APP_DIR__|$APP_DIR|g" "$SERVICE_SRC" > "$SERVICE_DST"

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

systemctl status --no-pager "$SERVICE_NAME" || true

echo "Systemd Service installiert: $SERVICE_NAME"
