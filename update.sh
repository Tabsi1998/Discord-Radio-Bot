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

STASHED=0
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Lokale Änderungen gefunden. Erstelle Stash..."
  git stash push -u -m "auto-update-$(date +%Y%m%d%H%M%S)"
  STASHED=1
fi

echo "Hole Updates..."
git fetch --all --prune

git pull --rebase

if [[ $STASHED -eq 1 ]]; then
  echo "Wende lokale Änderungen wieder an..."
  if ! git stash pop; then
    echo "Konflikt beim Wiederherstellen der Änderungen. Bitte manuell lösen." >&2
    exit 1
  fi
fi

echo "Starte Docker Compose (Rebuild)..."
docker compose up -d --build

echo "Fertig."
