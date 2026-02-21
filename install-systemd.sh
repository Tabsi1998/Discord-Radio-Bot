#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_SRC="$APP_DIR/omnifm.service"
SERVICE_DST="/etc/systemd/system/omnifm.service"

if [[ ! -f "$SERVICE_SRC" ]]; then
  echo "omnifm.service nicht gefunden." >&2
  exit 1
fi

if [[ $EUID -ne 0 ]]; then
  echo "Bitte mit sudo ausführen: sudo bash ./install-systemd.sh"
  exit 1
fi

sed "s|__APP_DIR__|$APP_DIR|g" "$SERVICE_SRC" > "$SERVICE_DST"

systemctl daemon-reload
systemctl enable omnifm.service
systemctl start omnifm.service

systemctl status --no-pager omnifm.service || true

echo "Systemd Service installiert."
