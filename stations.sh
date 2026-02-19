#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker fehlt. Bitte installieren." >&2
  exit 1
fi

if ! command -v docker compose >/dev/null 2>&1; then
  echo "docker compose fehlt. Bitte installieren." >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  set -- wizard
fi

running_services="$(docker compose ps --services --status running 2>/dev/null || true)"
if printf "%s\n" "$running_services" | grep -q "^radio-bot$"; then
  docker compose exec -T radio-bot node /app/src/stations-cli.js "$@"
else
  docker compose run --rm --no-deps --build radio-bot node /app/src/stations-cli.js "$@"
fi
