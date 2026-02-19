#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
cd "$APP_DIR"

REMOTE="${UPDATE_REMOTE:-origin}"
BRANCH="${UPDATE_BRANCH:-main}"

PRESERVE_FILES=(
  ".env"
  "stations.json"
  "docker-compose.override.yml"
)

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd fehlt. Bitte installieren." >&2
    exit 1
  fi
}

read_web_port() {
  local value="${WEB_PORT:-}"
  if [[ -z "$value" && -f .env ]]; then
    value="$(grep -E '^WEB_PORT=' .env | tail -n1 | cut -d= -f2- || true)"
  fi
  if [[ -z "$value" ]]; then
    value="8081"
  fi
  printf "%s" "$value"
}

echo "== Update Discord Radio Bot =="

require_cmd git
require_cmd docker
if ! command -v docker compose >/dev/null 2>&1; then
  echo "docker compose fehlt. Bitte Docker Compose Plugin installieren." >&2
  exit 1
fi

if [[ "${RADIO_BOT_UPDATE_BOOTSTRAP:-0}" != "1" ]]; then
  echo "Lade neueste Update-Logik von $REMOTE/$BRANCH ..."
  git fetch --prune "$REMOTE" "$BRANCH"

  if git cat-file -e "$REMOTE/$BRANCH:update.sh" 2>/dev/null; then
    tmp_script="$(mktemp)"
    git show "$REMOTE/$BRANCH:update.sh" > "$tmp_script"
    chmod +x "$tmp_script"

    RADIO_BOT_UPDATE_BOOTSTRAP=1 \
    APP_DIR="$APP_DIR" \
    UPDATE_REMOTE="$REMOTE" \
    UPDATE_BRANCH="$BRANCH" \
    "$tmp_script" "$@"

    rc=$?
    rm -f "$tmp_script"
    exit "$rc"
  fi
fi

echo "Erstelle Backup lokaler Runtime-Dateien ..."
ts="$(date +%Y%m%d-%H%M%S)"
backup_root="$APP_DIR/.update-backups"
backup_dir="$backup_root/$ts"
mkdir -p "$backup_dir"

for file in "${PRESERVE_FILES[@]}"; do
  if [[ -e "$file" ]]; then
    mkdir -p "$backup_dir/$(dirname "$file")"
    cp -a "$file" "$backup_dir/$file"
    echo "  gesichert: $file"
  fi
done

echo "Synchronisiere Code mit $REMOTE/$BRANCH ..."
git fetch --prune "$REMOTE" "$BRANCH"

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git checkout -f "$BRANCH"
else
  git checkout -B "$BRANCH" "$REMOTE/$BRANCH"
fi

git reset --hard "$REMOTE/$BRANCH"
git clean -fd \
  -e logs \
  -e .update-backups \
  -e .env \
  -e stations.json \
  -e docker-compose.override.yml

echo "Stelle Runtime-Dateien wieder her ..."
for file in "${PRESERVE_FILES[@]}"; do
  if [[ -e "$backup_dir/$file" ]]; then
    mkdir -p "$(dirname "$file")"
    cp -a "$backup_dir/$file" "$file"
    echo "  restored: $file"
  fi
done

echo "Setze Script-Rechte ..."
chmod +x docker-entrypoint.sh install.sh update.sh install-systemd.sh stations.sh 2>/dev/null || true

echo "Starte Docker Compose (Rebuild) ..."
docker compose up -d --build --remove-orphans

web_port="$(read_web_port)"
if command -v curl >/dev/null 2>&1; then
  echo "Pruefe Health unter http://127.0.0.1:${web_port}/api/health ..."
  if curl -fsS --max-time 8 "http://127.0.0.1:${web_port}/api/health" >/dev/null; then
    echo "Health-Check OK."
  else
    echo "WARN: Health-Check fehlgeschlagen. Bitte Logs pruefen:" >&2
    echo "      docker compose logs --tail=200 radio-bot" >&2
  fi
fi

echo ""
echo "Update fertig."
echo "Backup: $backup_dir"
echo "Webseite: http://<server-ip>:${web_port}"
