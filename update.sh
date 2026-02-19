#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

echo "== Update Discord Radio Bot =="

if ! command -v git >/dev/null 2>&1; then
  echo "git fehlt. Bitte installieren." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker fehlt. Bitte installieren." >&2
  exit 1
fi

if ! command -v docker compose >/dev/null 2>&1; then
  echo "docker compose fehlt. Bitte installieren." >&2
  exit 1
fi

echo "Hole Updates..."
git pull --rebase --autostash

echo "Starte Docker Compose (Rebuild)..."
docker compose up -d --build

echo "Fertig."
