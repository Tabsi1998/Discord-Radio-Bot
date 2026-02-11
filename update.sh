#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$APP_DIR"

echo "== Update Discord Radio Bot =="

CONFIG_DIR="/tmp/discord-radio-bot-config-$$"
mkdir -p "$CONFIG_DIR"

if [[ -f ".env" ]]; then
  cp .env "$CONFIG_DIR/.env"
fi

if [[ -f "stations.json" ]]; then
  cp stations.json "$CONFIG_DIR/stations.json"
fi

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
  git stash push -u -m "auto-update-$(date +%Y%m%d%H%M%S)" -- \
    ":(exclude).env" \
    ":(exclude)stations.json"
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

if [[ -f "$CONFIG_DIR/.env" ]]; then
  cp "$CONFIG_DIR/.env" .env
fi

if [[ -f "$CONFIG_DIR/stations.json" ]]; then
  cp "$CONFIG_DIR/stations.json" stations.json
fi

rm -rf "$CONFIG_DIR"

echo "Starte Docker Compose (Rebuild)..."
docker compose up -d --build

echo "Fertig."
