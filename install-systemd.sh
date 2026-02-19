#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_SRC="$APP_DIR/radio-bot.service"
SERVICE_DST="/etc/systemd/system/radio-bot.service"

if [[ ! -f "$SERVICE_SRC" ]]; then
  echo "radio-bot.service nicht gefunden." >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Bitte mit sudo ausführen: sudo bash ./install-systemd.sh"
  exit 1
fi

sed "s|__APP_DIR__|$APP_DIR|g" "$SERVICE_SRC" > "$SERVICE_DST"

systemctl daemon-reload
systemctl enable radio-bot.service
systemctl start radio-bot.service

systemctl status --no-pager radio-bot.service || true

echo "Systemd Service installiert."
