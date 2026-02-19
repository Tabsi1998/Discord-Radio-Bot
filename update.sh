#!/usr/bin/env bash
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}   $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[FAIL]${NC} $*"; }

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
    fail "$cmd fehlt. Bitte installieren."
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

echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║                                           ║"
echo "  ║     Discord Radio Bot - Auto Update       ║"
echo "  ║                                           ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

require_cmd git
require_cmd docker
if ! command -v docker compose >/dev/null 2>&1; then
  fail "docker compose fehlt. Bitte Docker Compose Plugin installieren."
  exit 1
fi

# ====================================
# Self-update bootstrap
# ====================================
if [[ "${RADIO_BOT_UPDATE_BOOTSTRAP:-0}" != "1" ]]; then
  echo -e "${BOLD}Schritt 1/5: Neueste Update-Logik laden${NC}"
  echo "─────────────────────────────────────────"
  info "Lade Update-Script von $REMOTE/$BRANCH ..."
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
  ok "Update-Script geladen."
fi

# ====================================
# Step 2: Backup
# ====================================
echo ""
echo -e "${BOLD}Schritt 2/5: Backup erstellen${NC}"
echo "─────────────────────────────────────────"

ts="$(date +%Y%m%d-%H%M%S)"
backup_root="$APP_DIR/.update-backups"
backup_dir="$backup_root/$ts"
mkdir -p "$backup_dir"

for file in "${PRESERVE_FILES[@]}"; do
  if [[ -e "$file" ]]; then
    mkdir -p "$backup_dir/$(dirname "$file")"
    cp -a "$file" "$backup_dir/$file"
    ok "Gesichert: $file"
  fi
done

# ====================================
# Step 3: Git sync
# ====================================
echo ""
echo -e "${BOLD}Schritt 3/5: Code synchronisieren${NC}"
echo "─────────────────────────────────────────"

info "Synchronisiere mit $REMOTE/$BRANCH ..."
git fetch --prune "$REMOTE" "$BRANCH"

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git checkout -f "$BRANCH"
else
  git checkout -B "$BRANCH" "$REMOTE/$BRANCH"
fi

old_head="$(git rev-parse HEAD 2>/dev/null || echo "unknown")"
git reset --hard "$REMOTE/$BRANCH"
new_head="$(git rev-parse HEAD 2>/dev/null || echo "unknown")"
git clean -fd \
  -e logs \
  -e .update-backups \
  -e .env \
  -e stations.json \
  -e docker-compose.override.yml

if [[ "$old_head" == "$new_head" ]]; then
  info "Keine neuen Commits."
else
  ok "Code aktualisiert: ${old_head:0:8} -> ${new_head:0:8}"
fi

# ====================================
# Step 4: Restore
# ====================================
echo ""
echo -e "${BOLD}Schritt 4/5: Runtime-Dateien wiederherstellen${NC}"
echo "─────────────────────────────────────────"

for file in "${PRESERVE_FILES[@]}"; do
  if [[ -e "$backup_dir/$file" ]]; then
    mkdir -p "$(dirname "$file")"
    cp -a "$backup_dir/$file" "$file"
    ok "Wiederhergestellt: $file"
  fi
done

chmod +x docker-entrypoint.sh install.sh update.sh install-systemd.sh stations.sh 2>/dev/null || true

# ====================================
# Step 5: Rebuild & Health
# ====================================
echo ""
echo -e "${BOLD}Schritt 5/5: Docker Compose rebuild${NC}"
echo "─────────────────────────────────────────"

info "Baue und starte Container..."
docker compose up -d --build --remove-orphans

web_port="$(read_web_port)"

echo ""
info "Health-Check (max 45 Sekunden, 9 Versuche)..."

health_ok=false
for attempt in 1 2 3 4 5 6 7 8 9; do
  sleep 5
  if command -v curl >/dev/null 2>&1; then
    http_code="$(curl -so /dev/null -w "%{http_code}" --max-time 5 "http://127.0.0.1:${web_port}/api/health" 2>/dev/null || echo "000")"
    if [[ "$http_code" == "200" ]]; then
      health_ok=true
      break
    fi
    echo -e "  ${DIM}Versuch $attempt/9 (HTTP $http_code) - warte...${NC}"
  else
    sleep 5
  fi
done

echo ""
if $health_ok; then
  ok "Health-Check bestanden!"
else
  warn "Health-Check fehlgeschlagen nach 45 Sekunden."
  echo ""
  echo -e "  ${YELLOW}Moegliche Ursachen:${NC}"
  echo -e "    1. Bot-Tokens ungueltig oder abgelaufen"
  echo -e "    2. Container braucht mehr Zeit zum Starten"
  echo -e "    3. Port ${web_port} ist blockiert"
  echo ""
  echo -e "  ${BOLD}Diagnose:${NC}"
  echo -e "    ${CYAN}docker compose logs --tail=50 radio-bot${NC}"
  echo -e "    ${CYAN}docker compose ps${NC}"
  echo ""
  echo -e "  ${BOLD}Rollback zum Backup:${NC}"
  echo -e "    ${YELLOW}cp ${backup_dir}/.env .env && docker compose up -d --build${NC}"
fi

# ====================================
# Summary
# ====================================
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║                                           ║"
echo "  ║          Update abgeschlossen!            ║"
echo "  ║                                           ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "  ${CYAN}Backup:${NC}    ${backup_dir}"
echo -e "  ${CYAN}Webseite:${NC}  http://<server-ip>:${web_port}"
echo ""
