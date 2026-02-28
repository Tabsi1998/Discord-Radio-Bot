#!/usr/bin/env bash
# ============================================================
# OmniFM - Unified Management Tool v4
# ============================================================

# KEIN set -e! Interaktive Scripts brechen sonst bei jedem grep-Miss ab.
set -uo pipefail

# --- Self-Exec Trick ---
# Wenn update.sh sich selbst via git reset ersetzt,
# liest bash Muell weil der File-Descriptor auf die alte Datei zeigt.
# Loesung: Script in tmp kopieren und von dort ausfuehren.
if [[ -z "${_UPDATE_SELF_EXEC:-}" ]]; then
  _tmpscript=$(mktemp /tmp/update-sh-XXXXXX.sh)
  cp "$0" "$_tmpscript"
  chmod +x "$_tmpscript"
  export _UPDATE_SELF_EXEC=1
  # APP_DIR jetzt setzen BEVOR wir in die Temp-Kopie wechseln!
  export APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  exec bash "$_tmpscript" "$@"
fi
# Temp-File aufraeumen wenn Script fertig ist
trap 'rm -f "${BASH_SOURCE[0]}" 2>/dev/null' EXIT

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()  { echo -e "  ${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "  ${GREEN}[OK]${NC}   $*"; }
warn()  { echo -e "  ${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "  ${RED}[FAIL]${NC} $*"; }

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
cd "$APP_DIR"

# .env sanitizer: ANSI-Codes entfernen falls vorhanden
if [[ -f .env ]] && grep -qP '\x1b\[' .env 2>/dev/null; then
  warn ".env enthaelt ANSI-Codes - wird bereinigt..."
  sed -i 's/\x1b\[[0-9;]*m//g; s/\x1b\[[0-9;]*[a-zA-Z]//g' .env
  ok ".env bereinigt."
fi

REMOTE="${UPDATE_REMOTE:-origin}"
BRANCH="${UPDATE_BRANCH:-main}"

# ============================================================
# Helper functions
# ============================================================

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "$1 fehlt. Bitte installieren."
    exit 1
  fi
}

prompt_yes_no() {
  local label="$1" def="${2:-j}" val
  read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}${label}${NC} [${def}]: ")" val
  val="${val:-$def}"
  [[ "$val" == "j" || "$val" == "J" || "$val" == "y" || "$val" == "Y" ]]
}

prompt_nonempty() {
  local label="$1" val=""
  while [[ -z "$val" ]]; do
    read -rp "$(echo -e "  ${CYAN}?${NC} ${label}: ")" val
    val=$(echo "$val" | xargs)
    if [[ -z "$val" ]]; then echo -e "  ${RED}Pflichtfeld!${NC}"; fi
  done
  printf "%s" "$val"
}

prompt_default() {
  local label="$1" def="$2" val
  read -rp "$(echo -e "  ${CYAN}?${NC} ${label} [${def}]: ")" val
  printf "%s" "${val:-$def}"
}

prompt_optional() {
  local label="$1" val
  read -rp "$(echo -e "  ${CYAN}?${NC} ${label}: ")" val
  printf "%s" "$(echo "$val" | xargs)"
}

extract_origin() {
  local raw trimmed
  raw="${1:-}"
  trimmed="$(echo "$raw" | xargs)"
  if [[ "$trimmed" =~ ^https?://[^/[:space:]]+ ]]; then
    printf "%s" "${BASH_REMATCH[0]}"
    return 0
  fi
  return 1
}

join_unique_csv() {
  local -a vals=("$@")
  local -a out=()
  local -A seen=()
  local item
  for item in "${vals[@]}"; do
    item="$(echo "$item" | xargs)"
    [[ -z "$item" ]] && continue
    if [[ -z "${seen[$item]+x}" ]]; then
      seen["$item"]=1
      out+=("$item")
    fi
  done
  local IFS=","
  printf "%s" "${out[*]}"
}

merge_csv_values() {
  local current="$1"; shift
  local -a merged=()
  local -a current_items=()
  local item
  IFS=',' read -r -a current_items <<< "${current:-}"
  for item in "${current_items[@]}"; do
    item="$(echo "$item" | xargs)"
    [[ -n "$item" ]] && merged+=("$item")
  done
  merged+=("$@")
  join_unique_csv "${merged[@]}"
}

build_default_origin_candidates() {
  local public_url="$1"
  local web_port="$2"
  local origin scheme hostport host port
  local -a out=()

  origin="$(extract_origin "$public_url" || true)"
  if [[ -n "$origin" ]]; then
    out+=("$origin")

    scheme="${origin%%://*}"
    hostport="${origin#*://}"
    host="${hostport%%:*}"
    port=""
    if [[ "$hostport" == *:* ]]; then
      port=":${hostport##*:}"
    fi

    if [[ "$host" =~ ^www\. ]]; then
      out+=("${scheme}://${host#www.}${port}")
    elif [[ "$host" =~ [A-Za-z] && "$host" == *.* ]]; then
      out+=("${scheme}://www.${host}${port}")
    fi
  fi

  out+=("http://localhost" "http://127.0.0.1")
  if [[ -n "$web_port" && "$web_port" != "80" ]]; then
    out+=("http://localhost:${web_port}" "http://127.0.0.1:${web_port}")
  fi

  join_unique_csv "${out[@]}"
}

auto_fix_web_env() {
  local web_port domain public_url origin defaults_csv
  local current_cors current_returns new_cors new_returns changed=0

  web_port="$(read_env "WEB_PORT" "8081")"
  domain="$(read_env "WEB_DOMAIN" "")"
  public_url="$(read_env "PUBLIC_WEB_URL" "")"

  origin="$(extract_origin "$public_url" || true)"
  if [[ -z "$origin" ]]; then
    if [[ -n "$domain" ]]; then
      origin="https://${domain}"
    else
      origin="http://localhost:${web_port}"
    fi
    write_env_line "PUBLIC_WEB_URL" "$origin"
    public_url="$origin"
    changed=1
    info "PUBLIC_WEB_URL gesetzt: ${origin}"
  fi

  defaults_csv="$(build_default_origin_candidates "$public_url" "$web_port")"
  current_cors="$(read_env "CORS_ALLOWED_ORIGINS" "")"
  current_returns="$(read_env "CHECKOUT_RETURN_ORIGINS" "")"
  IFS=',' read -r -a default_items <<< "$defaults_csv"

  new_cors="$(merge_csv_values "$current_cors" "${default_items[@]}")"
  new_returns="$(merge_csv_values "$current_returns" "${default_items[@]}")"

  if [[ "$new_cors" != "$current_cors" ]]; then
    write_env_line "CORS_ALLOWED_ORIGINS" "$new_cors"
    changed=1
    info "CORS_ALLOWED_ORIGINS aktualisiert."
  fi
  if [[ "$new_returns" != "$current_returns" ]]; then
    write_env_line "CHECKOUT_RETURN_ORIGINS" "$new_returns"
    changed=1
    info "CHECKOUT_RETURN_ORIGINS aktualisiert."
  fi

  if [[ "$(read_env "TRUST_PROXY_HEADERS" "")" == "" ]]; then
    write_env_line "TRUST_PROXY_HEADERS" "1"
    changed=1
    info "TRUST_PROXY_HEADERS=1 gesetzt."
  fi

  if (( changed == 0 )); then
    ok "Web-Origin Konfiguration war bereits konsistent."
  else
    ok "Web-Origin Konfiguration repariert."
  fi
}

strip_ansi() {
  # Entfernt alle ANSI Escape-Codes aus einem String
  printf "%s" "$1" | sed 's/\x1b\[[0-9;]*m//g; s/\x1b\[[0-9;]*[a-zA-Z]//g; s/\033\[[0-9;]*m//g'
}

write_env_line() {
  local key="$1" value
  # ANSI-Codes aus dem Wert entfernen bevor er geschrieben wird
  value="$(strip_ansi "$2")"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

sanitize_env_structure() {
  [[ -f .env ]] || touch .env

  local tmp invalid_count line normalized changed=0
  tmp="$(mktemp /tmp/omnifm-env-sanitize-XXXXXX)"
  invalid_count=0

  while IFS= read -r line || [[ -n "$line" ]]; do
    normalized="$(strip_ansi "$line")"
    if [[ "$normalized" =~ ^[[:space:]]*$ || "$normalized" =~ ^[[:space:]]*# ]]; then
      echo "$normalized" >> "$tmp"
      continue
    fi
    if [[ "$normalized" =~ ^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*= ]]; then
      echo "$normalized" >> "$tmp"
      continue
    fi

    echo "# INVALID_ENV_LINE: $normalized" >> "$tmp"
    invalid_count=$((invalid_count + 1))
    changed=1
  done < .env

  if (( changed == 1 )); then
    mkdir -p .update-backups
    cp .env ".update-backups/.env.invalid-lines.$(date +%Y%m%d%H%M%S)" 2>/dev/null || true
    mv "$tmp" .env
    warn ".env enthielt ${invalid_count} ungueltige Zeile(n). Diese wurden auskommentiert."
  else
    rm -f "$tmp"
  fi
}

read_env() {
  # Sicher einen Wert aus .env lesen (kein Fehler wenn nicht vorhanden)
  local key="$1" default="${2:-}"
  local val
  val=$(grep "^${key}=" .env 2>/dev/null | head -1 | cut -d= -f2- || true)
  printf "%s" "${val:-$default}"
}

ensure_env_default() {
  local key="$1" value="$2"
  if [[ ! -f .env ]]; then
    echo "${key}=${value}" >> .env
    return
  fi
  if ! grep -q "^${key}=" .env 2>/dev/null; then
    echo "${key}=${value}" >> .env
  fi
}

count_bots() {
  local c=0
  while grep -q "^BOT_$((c+1))_TOKEN=" .env 2>/dev/null; do
    c=$((c+1))
  done
  echo "$c"
}

prompt_tier() {
  echo "" >&2
  echo -e "  ${DIM}Tier-Optionen:${NC}" >&2
  echo -e "    ${GREEN}free${NC}     = Jeder kann einladen (Standard)" >&2
  echo -e "    ${YELLOW}pro${NC}      = Nur Pro-Abonnenten" >&2
  echo -e "    ${CYAN}ultimate${NC} = Nur Ultimate-Abonnenten" >&2
  local tier
  tier="$(prompt_default "Tier (free/pro/ultimate)" "${1:-free}")"
  case "$tier" in
    pro|ultimate|free) ;;
    *) tier="free" ;;
  esac
  printf "%s" "$tier"
}

tier_badge() {
  case "$1" in
    pro)      echo -e "${YELLOW}[PRO]${NC}" ;;
    ultimate) echo -e "${CYAN}[ULTIMATE]${NC}" ;;
    *)        echo -e "${GREEN}[FREE]${NC}" ;;
  esac
}

ensure_json_file() {
  local fp="$1" content="${2:-{}}"
  if [[ -d "$fp" ]]; then
    info "Korrigiere $fp (war Verzeichnis statt Datei)..."
    rm -rf "$fp" 2>/dev/null || true
  fi
  if [[ ! -f "$fp" ]]; then
    echo "$content" > "$fp"
  fi
}

ensure_all_json_files() {
  ensure_json_file "premium.json"         '{"licenses":{}}'
  ensure_json_file "bot-state.json"       '{}'
  ensure_json_file "custom-stations.json" '{}'
  ensure_json_file "command-permissions.json" '{"guilds":{}}'
  ensure_json_file "guild-languages.json" '{"version":1,"guilds":{}}'
  ensure_json_file "song-history.json" '{"guilds":{}}'
  ensure_json_file "listening-stats.json" '{"version":1,"guilds":{}}'
  ensure_json_file "scheduled-events.json" '{"version":1,"events":[]}'
  ensure_json_file "coupons.json" '{"offers":{},"redemptions":{}}'
  # stations.json nur erstellen wenn komplett fehlend
  if [[ -d "stations.json" ]]; then
    rm -rf "stations.json" 2>/dev/null || true
  fi
  if [[ ! -f "stations.json" ]]; then
    echo '{"defaultStationKey":null,"stations":{},"qualityPreset":"custom"}' > stations.json
  fi
}

count_license_entries() {
  local fp="$1"
  if [[ ! -s "$fp" ]]; then
    echo 0
    return
  fi
  # Jede Lizenz hat genau ein "plan"-Feld im licenses-Block.
  # Das reicht als robuster Guard ohne zusaetzliche Tools wie jq.
  grep -c '"plan"[[:space:]]*:' "$fp" 2>/dev/null || echo 0
}

prune_update_backups() {
  local keep="${UPDATE_BACKUP_KEEP:-20}"
  if [[ ! "$keep" =~ ^[0-9]+$ ]] || (( keep < 5 )); then
    keep=20
  fi

  local prefix
  for prefix in ".env" "premium.json" "bot-state.json" "custom-stations.json" "command-permissions.json" "guild-languages.json" "song-history.json" "scheduled-events.json" "coupons.json"; do
    mapfile -t files < <(ls -1t ".update-backups/${prefix}."* 2>/dev/null || true)
    if (( ${#files[@]} <= keep )); then
      continue
    fi
    local i
    for (( i=keep; i<${#files[@]}; i++ )); do
      rm -f "${files[$i]}" 2>/dev/null || true
    done
  done
}

cleanup_rotated_logs() {
  local keep days
  keep="$(read_env "LOG_MAX_FILES" "30")"
  days="$(read_env "LOG_MAX_DAYS" "14")"

  if [[ ! "$keep" =~ ^[0-9]+$ ]] || (( keep < 1 )); then
    keep=30
  fi
  if [[ ! "$days" =~ ^[0-9]+$ ]] || (( days < 1 )); then
    days=14
  fi

  mkdir -p logs

  mapfile -t files < <(ls -1t logs/bot-*.log 2>/dev/null || true)
  if (( ${#files[@]} > keep )); then
    local i
    for (( i=keep; i<${#files[@]}; i++ )); do
      rm -f "${files[$i]}" 2>/dev/null || true
    done
  fi

  find logs -maxdepth 1 -type f -name "bot-*.log" -mtime +"$days" -delete 2>/dev/null || true
}

cleanup_docker_cache() {
  local until
  until="$(read_env "DOCKER_BUILDER_PRUNE_UNTIL" "168h")"
  info "Raeume Docker Build-Cache auf (older than ${until})..."
  docker builder prune -f --filter "until=${until}" >/dev/null 2>&1 || warn "docker builder prune fehlgeschlagen."

  info "Entferne ungenutzte Docker-Images (dangling)..."
  docker image prune -f >/dev/null 2>&1 || warn "docker image prune fehlgeschlagen."
}

show_storage_overview() {
  echo ""
  echo -e "  ${BOLD}Speicher-Check:${NC}"
  if command -v df >/dev/null 2>&1; then
    df -h . 2>/dev/null | tail -1 | awk '{printf("    RootFS: %s genutzt (%s / %s)\n", $5, $3, $2)}'
  fi

  if command -v du >/dev/null 2>&1; then
    local logs_size backups_size
    logs_size="$(du -sh logs 2>/dev/null | awk '{print $1}')"
    backups_size="$(du -sh .update-backups 2>/dev/null | awk '{print $1}')"
    echo -e "    logs/:           ${CYAN}${logs_size:-0}${NC}"
    echo -e "    .update-backups: ${CYAN}${backups_size:-0}${NC}"
  fi

  if docker system df >/dev/null 2>&1; then
    echo ""
    docker system df 2>/dev/null | sed 's/^/    /'
  fi
}

restart_container() {
  echo ""
  if prompt_yes_no "Container jetzt neu starten (noetig fuer Aenderungen)?" "j"; then
    ensure_all_json_files
    info "Starte Container neu..."
    docker compose up -d --build --remove-orphans 2>&1 | tail -3
    ok "Container neu gestartet."
  else
    warn "Nicht vergessen: ${BOLD}docker compose up -d --build${NC} ausfuehren!"
  fi
}

sanitize_env_structure

# ============================================================
# Header
# ============================================================

echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║                                              ║"
echo "  ║   OmniFM - Management & Settings            ║"
echo "  ║                                              ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${NC}"

require_cmd git
require_cmd docker
if ! docker compose version >/dev/null 2>&1; then
  fail "docker compose fehlt."
  exit 1
fi

ensure_env_default "SYNC_GUILD_COMMANDS_ON_BOOT" "1"
ensure_env_default "CLEAN_GLOBAL_COMMANDS_ON_BOOT" "1"
ensure_env_default "CLEAN_GUILD_COMMANDS_ON_BOOT" "0"
ensure_env_default "CLEAN_WORKER_GUILD_COMMANDS_ON_BOOT" "1"
ensure_env_default "GUILD_COMMAND_SYNC_RETRIES" "3"
ensure_env_default "GUILD_COMMAND_SYNC_RETRY_MS" "1200"
ensure_env_default "PERIODIC_GUILD_COMMAND_SYNC_MS" "1800000"
ensure_env_default "LOG_MAX_MB" "5"
ensure_env_default "LOG_MAX_FILES" "30"
ensure_env_default "LOG_MAX_DAYS" "14"
ensure_env_default "LOG_PRUNE_CHECK_MS" "600000"
ensure_env_default "UPDATE_BUILD_NO_CACHE" "0"
ensure_env_default "AUTO_DOCKER_PRUNE" "1"
ensure_env_default "DOCKER_BUILDER_PRUNE_UNTIL" "168h"
ensure_env_default "NOW_PLAYING_RECOGNITION_ENABLED" "0"
ensure_env_default "NOW_PLAYING_RECOGNITION_SAMPLE_SECONDS" "18"
ensure_env_default "NOW_PLAYING_RECOGNITION_TIMEOUT_MS" "28000"
ensure_env_default "NOW_PLAYING_RECOGNITION_CACHE_TTL_MS" "90000"
ensure_env_default "NOW_PLAYING_RECOGNITION_FAILURE_TTL_MS" "180000"
ensure_env_default "NOW_PLAYING_RECOGNITION_SCORE_THRESHOLD" "0.55"
ensure_env_default "NOW_PLAYING_MUSICBRAINZ_ENABLED" "1"

# Einmalige Migration: fruehere Defaults hatten CLEAN_GUILD_COMMANDS_ON_BOOT=1.
# Das kann bei transienten API-Fehlern Commands entfernen.
if [[ "$(read_env "CLEAN_GUILD_COMMANDS_ON_BOOT_MIGRATED" "0")" != "1" ]]; then
  if [[ "$(read_env "CLEAN_GUILD_COMMANDS_ON_BOOT" "0")" == "1" ]]; then
    warn "Migration: CLEAN_GUILD_COMMANDS_ON_BOOT von 1 auf 0 gesetzt (stabilerer Command-Sync)."
    write_env_line "CLEAN_GUILD_COMMANDS_ON_BOOT" "0"
  fi
  write_env_line "CLEAN_GUILD_COMMANDS_ON_BOOT_MIGRATED" "1"
fi

# ============================================================
# Mode selection
# ============================================================

MODE="${1:-}"

if [[ -z "$MODE" ]]; then
  while true; do
    echo -e "  ${BOLD}Was moechtest du tun?${NC}"
    echo ""
    echo -e "    ${GREEN}1${NC})  Update           - Code aktualisieren & Container rebuild"
    echo -e "    ${CYAN}2${NC})  Bots verwalten    - Anzeigen, hinzufuegen, bearbeiten, entfernen"
    echo -e "    ${YELLOW}3${NC})  Stripe einrichten - Zahlungs-API konfigurieren"
    echo -e "    ${BOLD}4${NC})  Premium verwalten - Lizenzen, Coupons, Referrals"
    echo -e "    ${DIM}5${NC})  E-Mail (SMTP)     - E-Mail-Versand konfigurieren"
    echo -e "    ${DIM}6${NC})  Einstellungen     - Port, Domain und mehr"
    echo -e "    ${DIM}7${NC})  Status & Logs     - Container-Status pruefen"
    echo -e "    ${DIM}8${NC})  Speicher cleanup  - Logs/Backups/Docker-Cache aufraeumen"
    echo -e "    ${BOLD}9${NC})  Codes verwalten  - Coupon/Referral (Pro/Ultimate Setup)"
    echo -e "    ${DIM}q${NC})  Beenden"
    echo ""
    read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Auswahl [1-9/q]${NC}: ")" MODE_CHOICE
    case "${MODE_CHOICE:-}" in
      1) MODE="--update"; break ;;
      2) MODE="--bots"; break ;;
      3) MODE="--stripe"; break ;;
      4) MODE="--premium"; break ;;
      5) MODE="--email"; break ;;
      6) MODE="--settings"; break ;;
      7) MODE="--status"; break ;;
      8) MODE="--cleanup"; break ;;
      9) MODE="--offers"; break ;;
      q|Q|exit|quit) info "Abbruch."; exit 0 ;;
      *)
        warn "Ungueltige Auswahl '${MODE_CHOICE}'. Bitte 1-9 oder q eingeben."
        echo ""
        ;;
    esac
  done
fi

case "$MODE" in
  --update|--bots|--show-bots|--add-bot|--edit-bot|--remove-bot|--set-commander|--show-roles|--stripe|--premium|--offers|--email|--settings|--status|--cleanup)
    ;;
  *)
    fail "Unbekannter Modus: ${MODE}"
    echo -e "  ${DIM}Erlaubt: --update, --bots, --stripe, --premium, --offers, --email, --settings, --status, --cleanup${NC}"
    exit 1
    ;;
esac

# ============================================================
# MODE: Status & Logs
# ============================================================
if [[ "$MODE" == "--status" ]]; then
  echo ""
  echo -e "  ${BOLD}Container-Status:${NC}"
  echo ""
  docker compose ps 2>/dev/null || warn "Kein Container aktiv."
  echo ""
  echo -e "  ${BOLD}Letzte 20 Log-Zeilen:${NC}"
  echo ""
  docker compose logs --tail=20 omnifm 2>/dev/null || warn "Keine Logs verfuegbar."
  show_storage_overview
  echo ""
  echo -e "  ${DIM}Tipp: Fuer Live-Logs: docker compose logs -f omnifm${NC}"
  echo -e "  ${DIM}Tipp: Speicher aufraeumen: ./update.sh --cleanup${NC}"
  exit 0
fi

# ============================================================
# MODE: Speicher cleanup
# ============================================================
if [[ "$MODE" == "--cleanup" ]]; then
  echo ""
  echo -e "  ${BOLD}Speicher cleanup${NC}"
  echo "  ------------------------------------"

  prune_update_backups
  cleanup_rotated_logs
  if [[ "$(read_env "AUTO_DOCKER_PRUNE" "1")" != "0" ]]; then
    cleanup_docker_cache
  else
    warn "AUTO_DOCKER_PRUNE=0 - Docker cleanup uebersprungen."
  fi
  show_storage_overview
  ok "Cleanup abgeschlossen."
  exit 0
fi

# ============================================================
# MODE: Stripe einrichten
# ============================================================
if [[ "$MODE" == "--stripe" ]]; then
  echo ""
  echo -e "  ${BOLD}Stripe API-Key Einrichtung${NC}"
  echo "  ────────────────────────────────────"
  echo ""

  cur_key=$(read_env "STRIPE_SECRET_KEY")
  cur_pub=$(read_env "STRIPE_PUBLIC_KEY")
  if [[ -n "$cur_key" ]]; then
    masked="${cur_key:0:12}...${cur_key: -4}"
    echo -e "  Aktueller Secret Key: ${GREEN}${masked}${NC}"
  else
    echo -e "  Aktueller Secret Key: ${RED}nicht gesetzt${NC}"
  fi
  if [[ -n "$cur_pub" ]]; then
    masked_pub="${cur_pub:0:12}...${cur_pub: -4}"
    echo -e "  Aktueller Public Key: ${GREEN}${masked_pub}${NC}"
  else
    echo -e "  Aktueller Public Key: ${RED}nicht gesetzt${NC}"
  fi
  echo ""

  echo -e "  Hol dir deine Keys unter: ${CYAN}https://dashboard.stripe.com/apikeys${NC}"
  echo -e "  ${YELLOW}Tipp:${NC} Nutze erst ${BOLD}Test-Keys${NC} (sk_test_... / pk_test_...) zum Testen!"
  echo ""

  echo -e "  ${BOLD}Was tun?${NC}"
  echo -e "    ${GREEN}1${NC}) Secret Key setzen/aendern"
  echo -e "    ${CYAN}2${NC}) Public Key setzen/aendern"
  echo -e "    ${YELLOW}3${NC}) Beide Keys setzen"
  echo -e "    ${DIM}4${NC}) Zurueck"
  echo ""
  read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Auswahl [1-4]${NC}: ")" STRIPE_CHOICE

  case "${STRIPE_CHOICE:-}" in
    1)
      read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Stripe Secret Key${NC}: ")" new_sk
      if [[ -z "$new_sk" ]]; then fail "Kein Key eingegeben."; exit 1; fi
      if [[ ! "$new_sk" =~ ^sk_(test|live)_ ]]; then
        warn "Key sieht ungewoehnlich aus. Erwartet: sk_test_... oder sk_live_..."
      fi
      write_env_line "STRIPE_SECRET_KEY" "$new_sk"
      ok "Secret Key gespeichert."
      ;;
    2)
      read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Stripe Public Key${NC}: ")" new_pk
      if [[ -z "$new_pk" ]]; then fail "Kein Key eingegeben."; exit 1; fi
      write_env_line "STRIPE_PUBLIC_KEY" "$new_pk"
      ok "Public Key gespeichert."
      ;;
    3)
      read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Stripe Secret Key${NC}: ")" new_sk
      if [[ -z "$new_sk" ]]; then fail "Kein Key eingegeben."; exit 1; fi
      if [[ ! "$new_sk" =~ ^sk_(test|live)_ ]]; then
        warn "Key sieht ungewoehnlich aus."
      fi
      write_env_line "STRIPE_SECRET_KEY" "$new_sk"
      ok "Secret Key gespeichert."

      read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Stripe Public Key${NC}: ")" new_pk
      if [[ -n "$new_pk" ]]; then
        write_env_line "STRIPE_PUBLIC_KEY" "$new_pk"
        ok "Public Key gespeichert."
      fi
      ;;
    *)
      exit 0
      ;;
  esac

  restart_container
  exit 0
fi

# ============================================================
# MODE: E-Mail (SMTP) einrichten
# ============================================================
if [[ "$MODE" == "--email" ]]; then
  echo ""
  echo -e "  ${BOLD}E-Mail (SMTP) Konfiguration${NC}"
  echo "  ────────────────────────────────────"
  echo ""

  cur_host=$(read_env "SMTP_HOST")
  cur_port=$(read_env "SMTP_PORT" "587")
  cur_user=$(read_env "SMTP_USER")
  cur_from=$(read_env "SMTP_FROM")
  cur_admin=$(read_env "ADMIN_EMAIL")
  cur_tls_mode=$(read_env "SMTP_TLS_MODE" "auto")
  cur_tls_verify=$(read_env "SMTP_TLS_REJECT_UNAUTHORIZED" "1")

  if [[ -n "$cur_host" ]]; then
    echo -e "  SMTP Host:     ${GREEN}${cur_host}${NC}"
    echo -e "  SMTP Port:     ${DIM}${cur_port}${NC}"
    echo -e "  SMTP User:     ${GREEN}${cur_user}${NC}"
    echo -e "  Absender:      ${DIM}${cur_from:-$cur_user}${NC}"
    echo -e "  Admin-Email:   ${CYAN}${cur_admin:-nicht gesetzt}${NC}"
    echo -e "  TLS Modus:     ${DIM}${cur_tls_mode}${NC}"
    echo -e "  TLS Verify:    ${DIM}${cur_tls_verify}${NC}"
    echo ""
    echo -e "  Status:        ${GREEN}konfiguriert${NC}"
  else
    echo -e "  Status:        ${RED}nicht konfiguriert${NC}"
  fi
  echo ""

  echo -e "  ${BOLD}Was tun?${NC}"
  echo -e "    ${GREEN}1${NC}) SMTP komplett einrichten"
  echo -e "    ${CYAN}2${NC}) Nur Admin-Email aendern"
  echo -e "    ${YELLOW}3${NC}) Test-Email senden"
  echo -e "    ${DIM}4${NC}) Zurueck"
  echo ""
  read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Auswahl [1-4]${NC}: ")" EMAIL_CHOICE

  case "${EMAIL_CHOICE:-}" in
    1)
      smtp_host="$(prompt_nonempty "SMTP Host (z.B. mail.example.com)")"
      smtp_port="$(prompt_default "SMTP Port" "587")"
      smtp_user="$(prompt_nonempty "SMTP Benutzername (oft die E-Mail)")"
      read -rsp "$(echo -e "  ${CYAN}?${NC} SMTP Passwort: ")" smtp_pass
      echo ""
      if [[ -z "$smtp_pass" ]]; then fail "Passwort darf nicht leer sein."; exit 1; fi
      smtp_from="$(prompt_default "Absender-Adresse" "$smtp_user")"
      admin_email="$(prompt_optional "Admin-Email (fuer Kauf-Benachrichtigungen)")"
      tls_mode="$(prompt_default "TLS Modus (auto/plain/starttls/smtps)" "${cur_tls_mode:-auto}")"
      case "$tls_mode" in
        auto|plain|starttls|smtps) ;;
        *) tls_mode="auto" ;;
      esac
      tls_verify="$(prompt_default "TLS Zertifikat pruefen? (1=ja, 0=nein)" "${cur_tls_verify:-1}")"
      [[ "$tls_verify" == "1" ]] || tls_verify="0"

      write_env_line "SMTP_HOST" "$smtp_host"
      write_env_line "SMTP_PORT" "$smtp_port"
      write_env_line "SMTP_USER" "$smtp_user"
      write_env_line "SMTP_PASS" "$smtp_pass"
      write_env_line "SMTP_FROM" "$smtp_from"
      write_env_line "SMTP_TLS_MODE" "$tls_mode"
      write_env_line "SMTP_TLS_REJECT_UNAUTHORIZED" "$tls_verify"
      if [[ -n "$admin_email" ]]; then
        write_env_line "ADMIN_EMAIL" "$admin_email"
      fi
      ok "SMTP konfiguriert."
      restart_container
      ;;
    2)
      admin_email="$(prompt_nonempty "Admin-Email")"
      write_env_line "ADMIN_EMAIL" "$admin_email"
      ok "Admin-Email gespeichert: ${admin_email}"
      restart_container
      ;;
    3)
      if [[ -z "$cur_host" ]]; then
        fail "SMTP nicht konfiguriert! Bitte zuerst Option 1 ausfuehren."
        exit 1
      fi

      # Pruefen ob Container laeuft
      if ! docker compose ps --services --filter status=running 2>/dev/null | grep -q "omnifm"; then
        fail "Container nicht aktiv. Bitte zuerst starten: docker compose up -d"
        exit 1
      fi

      test_to="$(prompt_nonempty "An welche E-Mail soll die Test-Mail gesendet werden?")"
      echo ""
      info "Sende Test-Email an ${test_to}..."

      # Test-Email via Node.js im Container senden
      RESULT=$(docker compose exec -T omnifm node -e "
        const nm = require('nodemailer');
        const port = Number(process.env.SMTP_PORT) || 587;
        const modeRaw = String(process.env.SMTP_TLS_MODE || 'auto').toLowerCase();
        const mode =
          ['plain', 'starttls', 'smtps'].includes(modeRaw)
            ? modeRaw
            : (port === 465 ? 'smtps' : (port === 25 ? 'plain' : 'starttls'));
        const rejectUnauthorized = String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || '1') === '1';
        const opts = {
          host: process.env.SMTP_HOST,
          port,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
          tls: { rejectUnauthorized }
        };
        if (mode === 'smtps') {
          opts.secure = true;
        } else if (mode === 'starttls') {
          opts.secure = false;
          opts.requireTLS = true;
        } else {
          opts.secure = false;
          opts.ignoreTLS = true;
        }
        const t = nm.createTransport({
          ...opts
        });
        t.sendMail({
          from: process.env.SMTP_FROM || process.env.SMTP_USER,
          to: '${test_to}',
          subject: 'OmniFM - SMTP Test',
          html: '<div style=\"font-family:sans-serif;padding:24px;background:#121212;color:#fff;border-radius:16px;max-width:440px\">' +
            '<h2 style=\"color:#00F0FF;margin:0 0 12px\">SMTP Test erfolgreich!</h2>' +
            '<p style=\"color:#A1A1AA\">Dein SMTP-Server ist korrekt konfiguriert. E-Mails fuer Premium-Kaeufe und Benachrichtigungen funktionieren.</p>' +
            '<hr style=\"border:1px solid #333;margin:16px 0\">' +
            '<p style=\"font-size:12px;color:#52525B\">Host: ' + (process.env.SMTP_HOST || '') + '</p></div>'
        }).then(function(info) {
          console.log('OK:' + info.messageId);
        }).catch(function(err) {
          console.log('FAIL:' + err.message);
        });
      " 2>&1)

      if [[ "$RESULT" == OK:* ]]; then
        ok "Test-Email gesendet! Message-ID: ${RESULT#OK:}"
      elif [[ "$RESULT" == FAIL:* ]]; then
        fail "E-Mail fehlgeschlagen: ${RESULT#FAIL:}"
        echo ""
        echo -e "  ${DIM}Haeufige Ursachen:${NC}"
        echo -e "    - Falsches Passwort oder Benutzername"
        echo -e "    - Port falsch (587=STARTTLS, 465=SSL)"
        echo -e "    - SMTP-Server erfordert App-Passwort (z.B. Gmail)"
        echo -e "    - Self-signed Zertifikat: TLS Verify auf 0 setzen oder eigene CA hinterlegen"
      else
        warn "Unerwartete Antwort: ${RESULT}"
      fi
      ;;
    *)
      exit 0
      ;;
  esac
  exit 0
fi

# ============================================================
# MODE: Einstellungen
# ============================================================
if [[ "$MODE" == "--settings" ]]; then
  echo ""
  echo -e "  ${BOLD}Aktuelle Einstellungen${NC}"
  echo "  ────────────────────────────────────"
  echo ""

  cur_port=$(read_env "WEB_PORT" "8081")
  cur_iport=$(read_env "WEB_INTERNAL_PORT" "8080")
  cur_domain=$(read_env "WEB_DOMAIN" "nicht gesetzt")
  cur_public_url=$(read_env "PUBLIC_WEB_URL" "")
  cur_cors=$(read_env "CORS_ALLOWED_ORIGINS" "")
  cur_returns=$(read_env "CHECKOUT_RETURN_ORIGINS" "")
  cur_trial=$(read_env "PRO_TRIAL_ENABLED" "1")
  bot_count=$(count_bots)
  cur_stripe=$(read_env "STRIPE_SECRET_KEY")
  cur_dbl_enabled=$(read_env "DISCORDBOTLIST_ENABLED" "1")
  cur_dbl_token=$(read_env "DISCORDBOTLIST_TOKEN" "")
  cur_dbl_secret=$(read_env "DISCORDBOTLIST_WEBHOOK_SECRET" "")
  cur_dbl_scope=$(read_env "DISCORDBOTLIST_STATS_SCOPE" "aggregate")
  cur_recognition_enabled=$(read_env "NOW_PLAYING_RECOGNITION_ENABLED" "0")
  cur_acoustid_key=$(read_env "ACOUSTID_API_KEY" "")
  cur_recognition_sample=$(read_env "NOW_PLAYING_RECOGNITION_SAMPLE_SECONDS" "18")
  cur_recognition_timeout=$(read_env "NOW_PLAYING_RECOGNITION_TIMEOUT_MS" "28000")

  echo -e "  Web-Port (extern):     ${CYAN}${cur_port}${NC}"
  echo -e "  Web-Port (intern):     ${DIM}${cur_iport}${NC}"
  echo -e "  Domain:                ${CYAN}${cur_domain}${NC}"
  if [[ -n "$cur_public_url" ]]; then
    echo -e "  Public URL:            ${CYAN}${cur_public_url}${NC}"
  else
    echo -e "  Public URL:            ${RED}nicht gesetzt${NC}"
  fi
  if [[ -n "$cur_cors" ]]; then
    echo -e "  CORS Origins:          ${DIM}${cur_cors}${NC}"
  else
    echo -e "  CORS Origins:          ${RED}nicht gesetzt${NC}"
  fi
  if [[ -n "$cur_returns" ]]; then
    echo -e "  Checkout Origins:      ${DIM}${cur_returns}${NC}"
  else
    echo -e "  Checkout Origins:      ${RED}nicht gesetzt${NC}"
  fi
  if [[ "$cur_trial" == "0" ]]; then
    echo -e "  Pro-Testmonat:         ${RED}deaktiviert${NC}"
  else
    echo -e "  Pro-Testmonat:         ${GREEN}aktiv${NC}"
  fi
  echo -e "  Bots konfiguriert:     ${CYAN}${bot_count}${NC}"
  if [[ -n "$cur_stripe" ]]; then
    echo -e "  Stripe:                ${GREEN}konfiguriert${NC}"
  else
    echo -e "  Stripe:                ${RED}nicht konfiguriert${NC}"
  fi
  if [[ "$cur_dbl_enabled" == "0" ]]; then
    echo -e "  DiscordBotList:        ${YELLOW}deaktiviert${NC}"
  elif [[ -n "$cur_dbl_token" && -n "$cur_dbl_secret" ]]; then
    echo -e "  DiscordBotList:        ${GREEN}konfiguriert${NC} (${cur_dbl_scope})"
  else
    echo -e "  DiscordBotList:        ${RED}nicht konfiguriert${NC}"
  fi
  if [[ -n "$cur_public_url" ]]; then
    echo -e "  DBL Webhook:           ${DIM}${cur_public_url}/api/discordbotlist/vote${NC}"
  fi
  if [[ "$cur_recognition_enabled" == "1" && -n "$cur_acoustid_key" ]]; then
    echo -e "  Track-Erkennung:       ${GREEN}aktiv${NC} (${cur_recognition_sample}s Sample, ${cur_recognition_timeout}ms Timeout)"
  elif [[ "$cur_recognition_enabled" == "1" ]]; then
    echo -e "  Track-Erkennung:       ${YELLOW}aktiv ohne API-Key${NC}"
  else
    echo -e "  Track-Erkennung:       ${DIM}deaktiviert${NC}"
  fi
  echo ""

  echo -e "  ${BOLD}Was aendern?${NC}"
  echo -e "    ${GREEN}1${NC}) Web-Port (extern)"
  echo -e "    ${CYAN}2${NC}) Domain"
  echo -e "    ${YELLOW}3${NC}) Public Web URL"
  echo -e "    ${BOLD}4${NC}) Web-Origin/CORS automatisch reparieren (empfohlen)"
  echo -e "    ${CYAN}5${NC}) Pro-Testmonat ein/aus"
  echo -e "    ${YELLOW}6${NC}) DiscordBotList konfigurieren"
  echo -e "    ${GREEN}7${NC}) Track-Erkennung (AcoustID/MusicBrainz)"
  echo -e "    ${DIM}8${NC}) Zurueck"
  echo ""
  read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Auswahl [1-8]${NC}: ")" SET_CHOICE

  case "${SET_CHOICE:-}" in
    1)
      new_port="$(prompt_default "Neuer externer Port" "$cur_port")"
      write_env_line "WEB_PORT" "$new_port"
      ok "Port geaendert: ${new_port}"
      if prompt_yes_no "Web-Origin Einstellungen automatisch mit anpassen?" "j"; then
        auto_fix_web_env
      fi
      restart_container
      ;;
    2)
      new_domain="$(prompt_optional "Domain (z.B. radiobot.example.com)")"
      if [[ -n "$new_domain" ]]; then
        write_env_line "WEB_DOMAIN" "$new_domain"
        ok "Domain gespeichert: ${new_domain}"
        if prompt_yes_no "PUBLIC_WEB_URL und Origin-Listen automatisch aus Domain setzen?" "j"; then
          write_env_line "PUBLIC_WEB_URL" "https://${new_domain}"
          auto_fix_web_env
        fi
        restart_container
      else
        info "Keine Aenderung."
      fi
      ;;
    3)
      new_public="$(prompt_nonempty "Public Web URL (z.B. https://omnifm.xyz)")"
      normalized_public="$(extract_origin "$new_public" || true)"
      if [[ -z "$normalized_public" ]]; then
        fail "Ungueltige URL. Bitte mit http:// oder https:// eingeben."
        exit 1
      fi
      write_env_line "PUBLIC_WEB_URL" "$normalized_public"
      ok "PUBLIC_WEB_URL gespeichert: ${normalized_public}"
      if prompt_yes_no "CORS/Checkout Origins automatisch synchronisieren?" "j"; then
        auto_fix_web_env
      fi
      restart_container
      ;;
    4)
      auto_fix_web_env
      restart_container
      ;;
    5)
      if [[ "$cur_trial" == "0" ]]; then
        write_env_line "PRO_TRIAL_ENABLED" "1"
        ok "Pro-Testmonat aktiviert."
      else
        write_env_line "PRO_TRIAL_ENABLED" "0"
        ok "Pro-Testmonat deaktiviert."
      fi
      restart_container
      ;;
    6)
      if prompt_yes_no "DiscordBotList aktivieren?" "$(if [[ "$cur_dbl_enabled" == "0" ]]; then echo n; else echo j; fi)"; then
        new_dbl_token="$(prompt_default "DiscordBotList Token" "$cur_dbl_token")"
        new_dbl_secret="$(prompt_default "DiscordBotList Webhook Secret" "$cur_dbl_secret")"
        new_dbl_scope="$(prompt_default "Stats Scope (commander/aggregate)" "$cur_dbl_scope")"
        if [[ "$new_dbl_scope" != "commander" && "$new_dbl_scope" != "aggregate" ]]; then
          new_dbl_scope="aggregate"
        fi
        if [[ -z "$new_dbl_token" || -z "$new_dbl_secret" ]]; then
          fail "Token und Webhook Secret sind erforderlich."
          exit 1
        fi
        write_env_line "DISCORDBOTLIST_ENABLED" "1"
        write_env_line "DISCORDBOTLIST_TOKEN" "$new_dbl_token"
        write_env_line "DISCORDBOTLIST_WEBHOOK_SECRET" "$new_dbl_secret"
        write_env_line "DISCORDBOTLIST_STATS_SCOPE" "$new_dbl_scope"
        ok "DiscordBotList gespeichert."
        if [[ -n "$cur_public_url" ]]; then
          info "Webhook URL: ${cur_public_url}/api/discordbotlist/vote"
        else
          warn "PUBLIC_WEB_URL ist noch leer. Setze zuerst die Public Web URL fuer den Vote-Webhook."
        fi
      else
        write_env_line "DISCORDBOTLIST_ENABLED" "0"
        ok "DiscordBotList deaktiviert."
      fi
      restart_container
      ;;
    7)
      echo ""
      warn "Hinweis: Die freie AcoustID-Web-API ist laut offizieller Doku nur fuer nicht-kommerzielle Nutzung gedacht."
      if prompt_yes_no "Audio-Fingerprint-Erkennung aktivieren?" "$(if [[ "$cur_recognition_enabled" == "1" ]]; then echo j; else echo n; fi)"; then
        new_acoustid_key="$(prompt_default "AcoustID API Key" "$cur_acoustid_key")"
        if [[ -z "$new_acoustid_key" ]]; then
          fail "AcoustID API Key ist erforderlich."
          exit 1
        fi
        new_sample="$(prompt_default "Fingerprint Sample in Sekunden" "$cur_recognition_sample")"
        new_timeout="$(prompt_default "Timeout in Millisekunden" "$cur_recognition_timeout")"
        write_env_line "NOW_PLAYING_RECOGNITION_ENABLED" "1"
        write_env_line "ACOUSTID_API_KEY" "$new_acoustid_key"
        write_env_line "NOW_PLAYING_RECOGNITION_SAMPLE_SECONDS" "$new_sample"
        write_env_line "NOW_PLAYING_RECOGNITION_TIMEOUT_MS" "$new_timeout"
        write_env_line "NOW_PLAYING_MUSICBRAINZ_ENABLED" "1"
        ok "Track-Erkennung gespeichert."
      else
        write_env_line "NOW_PLAYING_RECOGNITION_ENABLED" "0"
        ok "Track-Erkennung deaktiviert."
      fi
      restart_container
      ;;
    *)
      exit 0
      ;;
  esac
  exit 0
fi

# ============================================================
# MODE: Premium verwalten (via Docker)
# ============================================================
if [[ "$MODE" == "--premium" ]]; then
  if docker compose ps --services --filter status=running 2>/dev/null | grep -q "omnifm"; then
    docker compose exec omnifm node src/premium-cli.js wizard
  else
    warn "Container nicht aktiv."
    echo ""
    if prompt_yes_no "Container jetzt starten?" "j"; then
      ensure_all_json_files
      docker compose up -d --build --remove-orphans
      sleep 3
      docker compose exec omnifm node src/premium-cli.js wizard
    else
      echo -e "  ${DIM}Starte manuell: docker compose up -d${NC}"
    fi
  fi
  exit 0
fi

# ============================================================
# MODE: Coupon/Referral Codes verwalten (via Docker)
# ============================================================
if [[ "$MODE" == "--offers" ]]; then
  if docker compose ps --services --filter status=running 2>/dev/null | grep -q "omnifm"; then
    docker compose exec omnifm node src/premium-cli.js offers
  else
    warn "Container nicht aktiv."
    echo ""
    if prompt_yes_no "Container jetzt starten?" "j"; then
      ensure_all_json_files
      docker compose up -d --build --remove-orphans
      sleep 3
      docker compose exec omnifm node src/premium-cli.js offers
    else
      echo -e "  ${DIM}Starte manuell: docker compose up -d${NC}"
    fi
  fi
  exit 0
fi

# ============================================================
# MODE: Bots verwalten (Submenu)
# ============================================================
if [[ "$MODE" == "--bots" || "$MODE" == "--show-bots" || "$MODE" == "--add-bot" || "$MODE" == "--edit-bot" || "$MODE" == "--remove-bot" || "$MODE" == "--set-commander" || "$MODE" == "--show-roles" ]]; then

  if [[ "$MODE" == "--bots" ]]; then
    bot_count=$(count_bots)
    commander_idx=$(read_env "COMMANDER_BOT_INDEX" "1")
    echo ""
    echo -e "  ${BOLD}Bot-Verwaltung${NC} (${bot_count} Bots konfiguriert, Commander: Bot #${commander_idx})"
    echo "  ────────────────────────────────────"
    echo ""
    echo -e "    ${CYAN}1${NC}) Bots anzeigen"
    echo -e "    ${GREEN}2${NC}) Bot hinzufuegen"
    echo -e "    ${YELLOW}3${NC}) Bot bearbeiten (Name, Tier, Token)"
    echo -e "    ${RED}4${NC}) Bot entfernen"
    echo -e "    ${MAGENTA}5${NC}) Commander festlegen"
    echo -e "    ${CYAN}6${NC}) Rollen-Uebersicht (Commander/Worker)"
    echo -e "    ${DIM}7${NC}) Zurueck"
    echo ""
    read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Auswahl [1-7]${NC}: ")" BOT_CHOICE
    case "${BOT_CHOICE:-}" in
      1) MODE="--show-bots" ;;
      2) MODE="--add-bot" ;;
      3) MODE="--edit-bot" ;;
      4) MODE="--remove-bot" ;;
      5) MODE="--set-commander" ;;
      6) MODE="--show-roles" ;;
      *) exit 0 ;;
    esac
  fi

  # --- Show Bots ---
  if [[ "$MODE" == "--show-bots" ]]; then
    bot_count=$(count_bots)
    commander_idx=$(read_env "COMMANDER_BOT_INDEX" "1")
    echo ""
    echo -e "  ${BOLD}Konfigurierte Bots (${bot_count}):${NC}"
    echo ""
    if [[ "$bot_count" -eq 0 ]]; then
      warn "Keine Bots konfiguriert. Fuege einen hinzu: ./update.sh --add-bot"
    else
      for i in $(seq 1 "$bot_count"); do
        name=$(read_env "BOT_${i}_NAME" "Bot ${i}")
        cid=$(read_env "BOT_${i}_CLIENT_ID" "?")
        tier=$(read_env "BOT_${i}_TIER" "free")
        role="Worker"
        role_color="$GREEN"
        if [[ "$i" == "$commander_idx" ]]; then
          role="COMMANDER"
          role_color="$CYAN"
        fi
        echo -e "    ${CYAN}${i}.${NC} ${BOLD}${name}${NC} $(tier_badge "$tier") ${role_color}[${role}]${NC}"
        echo -e "       Client ID: ${DIM}${cid}${NC}"
        if [[ "$tier" == "free" ]]; then
          echo -e "       Invite:    ${GREEN}https://discord.com/oauth2/authorize?client_id=${cid}&permissions=35186522836032&integration_type=0&scope=bot%20applications.commands${NC}"
        else
          echo -e "       Invite:    ${DIM}Nur fuer ${tier}-Abonnenten${NC}"
        fi
        echo ""
      done
    fi
    exit 0
  fi

  # --- Add Bot ---
  if [[ "$MODE" == "--add-bot" ]]; then
    bot_count=$(count_bots)
    new_index=$((bot_count + 1))

    echo ""
    echo -e "  ${BOLD}Neuen Bot hinzufuegen (Bot #${new_index})${NC}"
    echo "  ────────────────────────────────────"
    echo ""

    bot_name="$(prompt_default "Bot Name" "OmniFM Bot ${new_index}")"
    bot_token="$(prompt_nonempty "Token")"
    bot_client_id="$(prompt_nonempty "Client ID")"
    bot_perms="$(prompt_default "Permissions" "35186522836032")"
    bot_tier="$(prompt_tier "free")"

    write_env_line "BOT_${new_index}_NAME" "$bot_name"
    write_env_line "BOT_${new_index}_TOKEN" "$bot_token"
    write_env_line "BOT_${new_index}_CLIENT_ID" "$bot_client_id"
    write_env_line "BOT_${new_index}_PERMISSIONS" "$bot_perms"
    write_env_line "BOT_${new_index}_TIER" "$bot_tier"
    write_env_line "BOT_COUNT" "$new_index"

    ok "Bot ${new_index} konfiguriert: ${bot_name} (${bot_tier})"
    restart_container
    exit 0
  fi

  # --- Edit Bot ---
  if [[ "$MODE" == "--edit-bot" ]]; then
    bot_count=$(count_bots)
    if [[ "$bot_count" -eq 0 ]]; then
      fail "Keine Bots konfiguriert."
      exit 1
    fi

    echo ""
    echo -e "  ${BOLD}Bot bearbeiten${NC}"
    echo "  ────────────────────────────────────"
    echo ""
    for i in $(seq 1 "$bot_count"); do
      name=$(read_env "BOT_${i}_NAME" "Bot ${i}")
      tier=$(read_env "BOT_${i}_TIER" "free")
      echo -e "    ${CYAN}${i}.${NC} ${name} $(tier_badge "$tier")"
    done
    echo ""

    read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Welchen Bot bearbeiten? [1-${bot_count}]${NC}: ")" EDIT_INDEX
    if [[ ! "${EDIT_INDEX:-}" =~ ^[0-9]+$ ]] || (( EDIT_INDEX < 1 || EDIT_INDEX > bot_count )); then
      fail "Ungueltige Auswahl."
      exit 1
    fi

    cur_name=$(read_env "BOT_${EDIT_INDEX}_NAME" "Bot ${EDIT_INDEX}")
    cur_tier=$(read_env "BOT_${EDIT_INDEX}_TIER" "free")

    echo ""
    echo -e "  ${BOLD}${cur_name}${NC} $(tier_badge "$cur_tier")"
    echo ""
    echo -e "    ${GREEN}1${NC}) Name aendern      (aktuell: ${cur_name})"
    echo -e "    ${YELLOW}2${NC}) Tier aendern       (aktuell: ${cur_tier})"
    echo -e "    ${CYAN}3${NC}) Beides aendern"
    echo -e "    ${RED}4${NC}) Token & Client ID"
    echo -e "    ${DIM}5${NC}) Zurueck"
    echo ""
    read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Auswahl [1-5]${NC}: ")" EDIT_CHOICE

    case "${EDIT_CHOICE:-}" in
      1)
        new_name="$(prompt_default "Neuer Name" "$cur_name")"
        write_env_line "BOT_${EDIT_INDEX}_NAME" "$new_name"
        ok "Name geaendert: ${new_name}"
        ;;
      2)
        new_tier="$(prompt_tier "$cur_tier")"
        write_env_line "BOT_${EDIT_INDEX}_TIER" "$new_tier"
        ok "Tier geaendert: ${new_tier}"
        ;;
      3)
        new_name="$(prompt_default "Neuer Name" "$cur_name")"
        write_env_line "BOT_${EDIT_INDEX}_NAME" "$new_name"
        ok "Name geaendert: ${new_name}"
        new_tier="$(prompt_tier "$cur_tier")"
        write_env_line "BOT_${EDIT_INDEX}_TIER" "$new_tier"
        ok "Tier geaendert: ${new_tier}"
        ;;
      4)
        new_token="$(prompt_nonempty "Neuer Token")"
        new_cid="$(prompt_nonempty "Neue Client ID")"
        write_env_line "BOT_${EDIT_INDEX}_TOKEN" "$new_token"
        write_env_line "BOT_${EDIT_INDEX}_CLIENT_ID" "$new_cid"
        ok "Token & Client ID geaendert."
        ;;
      *)
        exit 0
        ;;
    esac

    restart_container
    exit 0
  fi

  # --- Remove Bot ---
  if [[ "$MODE" == "--remove-bot" ]]; then
    bot_count=$(count_bots)
    if [[ "$bot_count" -eq 0 ]]; then
      fail "Keine Bots konfiguriert."
      exit 1
    fi

    echo ""
    echo -e "  ${BOLD}Bot entfernen${NC}"
    echo "  ────────────────────────────────────"
    echo ""
    for i in $(seq 1 "$bot_count"); do
      name=$(read_env "BOT_${i}_NAME" "Bot ${i}")
      tier=$(read_env "BOT_${i}_TIER" "free")
      echo -e "    ${CYAN}${i}.${NC} ${name} $(tier_badge "$tier")"
    done
    echo ""

    read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Welchen Bot entfernen? [1-${bot_count}]${NC}: ")" RM_INDEX
    if [[ ! "${RM_INDEX:-}" =~ ^[0-9]+$ ]] || (( RM_INDEX < 1 || RM_INDEX > bot_count )); then
      fail "Ungueltige Auswahl."
      exit 1
    fi

    rm_name=$(read_env "BOT_${RM_INDEX}_NAME" "Bot ${RM_INDEX}")
    echo ""
    warn "Bot ${RM_INDEX} (${rm_name}) wird aus der .env entfernt."
    if ! prompt_yes_no "Sicher?" "n"; then
      info "Abgebrochen."
      exit 0
    fi

    for field in NAME TOKEN CLIENT_ID PERMISSIONS TIER; do
      sed -i "/^BOT_${RM_INDEX}_${field}=/d" .env 2>/dev/null || true
    done

    if (( RM_INDEX < bot_count )); then
      for i in $(seq $((RM_INDEX + 1)) "$bot_count"); do
        prev=$((i - 1))
        for field in NAME TOKEN CLIENT_ID PERMISSIONS TIER; do
          val=$(read_env "BOT_${i}_${field}")
          if [[ -n "$val" ]]; then
            write_env_line "BOT_${prev}_${field}" "$val"
          fi
          sed -i "/^BOT_${i}_${field}=/d" .env 2>/dev/null || true
        done
      done
    fi

    new_count=$((bot_count - 1))
    write_env_line "BOT_COUNT" "$new_count"

    ok "Bot ${rm_name} entfernt. Verbleibend: ${new_count} Bot(s)."
    restart_container
    exit 0
  fi

  # --- Set Commander ---
  if [[ "$MODE" == "--set-commander" ]]; then
    bot_count=$(count_bots)
    commander_idx=$(read_env "COMMANDER_BOT_INDEX" "1")
    echo ""
    echo -e "  ${BOLD}Commander festlegen${NC}"
    echo "  ────────────────────────────────────"
    echo ""
    echo -e "  Der Commander-Bot nimmt alle Slash-Commands entgegen"
    echo -e "  und delegiert Audio-Streaming an die Worker-Bots."
    echo ""
    echo -e "  ${DIM}Aktueller Commander: Bot #${commander_idx}${NC}"
    echo ""

    if [[ "$bot_count" -eq 0 ]]; then
      fail "Keine Bots konfiguriert."
      exit 1
    fi

    for i in $(seq 1 "$bot_count"); do
      name=$(read_env "BOT_${i}_NAME" "Bot ${i}")
      marker=""
      if [[ "$i" == "$commander_idx" ]]; then
        marker=" ${CYAN}(aktueller Commander)${NC}"
      fi
      echo -e "    ${CYAN}${i}${NC}) ${name}${marker}"
    done
    echo ""

    read -rp "$(echo -e "  ${CYAN}?${NC} Welcher Bot soll Commander sein? [1-${bot_count}]: ")" NEW_COMMANDER
    if [[ "$NEW_COMMANDER" =~ ^[0-9]+$ ]] && (( NEW_COMMANDER >= 1 && NEW_COMMANDER <= bot_count )); then
      write_env_line "COMMANDER_BOT_INDEX" "$NEW_COMMANDER"
      new_name=$(read_env "BOT_${NEW_COMMANDER}_NAME" "Bot ${NEW_COMMANDER}")
      ok "Commander gesetzt: Bot #${NEW_COMMANDER} (${new_name})"
      echo -e "  ${DIM}Alle anderen Bots werden automatisch als Worker gestartet.${NC}"
      restart_container
    else
      fail "Ungueltige Auswahl."
    fi
    exit 0
  fi

  # --- Show Roles ---
  if [[ "$MODE" == "--show-roles" ]]; then
    bot_count=$(count_bots)
    commander_idx=$(read_env "COMMANDER_BOT_INDEX" "1")
    echo ""
    echo -e "  ${BOLD}Commander/Worker Architektur${NC}"
    echo "  ────────────────────────────────────"
    echo ""
    echo -e "  ${DIM}Der Commander (OmniFM DJ) nimmt alle /slash-commands entgegen.${NC}"
    echo -e "  ${DIM}Worker-Bots streamen die Musik in den Voice-Channels.${NC}"
    echo -e "  ${DIM}Nutzer laden Worker per /invite ein, Commander delegiert per /play.${NC}"
    echo ""

    if [[ "$bot_count" -eq 0 ]]; then
      warn "Keine Bots konfiguriert."
      exit 0
    fi

    echo -e "  ${CYAN}COMMANDER:${NC}"
    cmd_name=$(read_env "BOT_${commander_idx}_NAME" "Bot ${commander_idx}")
    cmd_cid=$(read_env "BOT_${commander_idx}_CLIENT_ID" "?")
    echo -e "    ${CYAN}#${commander_idx}${NC} ${BOLD}${cmd_name}${NC} (Client: ${DIM}${cmd_cid}${NC})"
    echo ""

    echo -e "  ${GREEN}WORKER:${NC}"
    worker_count=0
    for i in $(seq 1 "$bot_count"); do
      if [[ "$i" != "$commander_idx" ]]; then
        w_name=$(read_env "BOT_${i}_NAME" "Bot ${i}")
        w_tier=$(read_env "BOT_${i}_TIER" "free")
        w_cid=$(read_env "BOT_${i}_CLIENT_ID" "?")
        echo -e "    ${GREEN}#${i}${NC} ${w_name} $(tier_badge "$w_tier") (Client: ${DIM}${w_cid}${NC})"
        worker_count=$((worker_count + 1))
      fi
    done

    if [[ "$worker_count" -eq 0 ]]; then
      echo -e "    ${DIM}Keine Worker konfiguriert. Fuege Bots hinzu mit: ./update.sh --add-bot${NC}"
    fi
    echo ""

    echo -e "  ${BOLD}Tier-Limits:${NC}"
    echo -e "    Free:     Max. 2 Worker"
    echo -e "    Pro:      Max. 8 Worker"
    echo -e "    Ultimate: Max. 16 Worker"
    echo ""
    exit 0
  fi

fi

# ============================================================
# MODE: Update (default)
# ============================================================

echo ""
echo -e "  ${BOLD}Code-Update & Container Rebuild${NC}"
echo "  ────────────────────────────────────"
echo ""

# Backup .env
if [[ -f .env ]]; then
  mkdir -p .update-backups
  prune_update_backups
  cp .env ".update-backups/.env.$(date +%Y%m%d%H%M%S)"
fi

# Pull latest code
info "Hole neuesten Code von ${REMOTE}/${BRANCH}..."
update_stamp="$(date +%Y%m%d%H%M%S)"
licenses_before_update="$(count_license_entries premium.json)"

# WICHTIG: Premium-Daten IMMER sichern vor Update!
for pf in premium.json bot-state.json custom-stations.json command-permissions.json guild-languages.json song-history.json listening-stats.json scheduled-events.json coupons.json; do
  if [[ -f "$pf" ]]; then
    cp "$pf" ".update-backups/${pf}.${update_stamp}" 2>/dev/null || true
  fi
done
prune_update_backups

git fetch "$REMOTE" "$BRANCH" 2>&1 | tail -3

old_head="$(git rev-parse HEAD 2>/dev/null || echo "unknown")"
git reset --hard "$REMOTE/$BRANCH"
new_head="$(git rev-parse HEAD 2>/dev/null || echo "unknown")"
git clean -fd \
  -e logs \
  -e .update-backups \
  -e .env \
  -e stations.json \
  -e premium.json \
  -e bot-state.json \
  -e custom-stations.json \
  -e command-permissions.json \
  -e guild-languages.json \
  -e song-history.json \
  -e listening-stats.json \
  -e scheduled-events.json \
  -e coupons.json \
  -e docker-compose.override.yml 2>/dev/null || true

# Laufzeitdaten immer aus dem VOR-Update Snapshot wiederherstellen,
# damit git reset keine produktiven JSON-Daten ueberschreibt.
for pf in premium.json bot-state.json custom-stations.json command-permissions.json guild-languages.json song-history.json listening-stats.json scheduled-events.json coupons.json; do
  snapshot=".update-backups/${pf}.${update_stamp}"
  if [[ -s "$snapshot" ]]; then
    if ! cmp -s "$snapshot" "$pf" 2>/dev/null; then
      cp "$snapshot" "$pf"
      info "${pf} aus Pre-Update Snapshot wiederhergestellt."
    fi
  fi
done

# Sicherheitscheck: Premium-Daten duerfen NICHT leer sein nach Update
for pf in premium.json bot-state.json custom-stations.json command-permissions.json guild-languages.json song-history.json listening-stats.json scheduled-events.json coupons.json; do
  if [[ -f "$pf" ]] && [[ ! -s "$pf" ]]; then
    latest_backup=$(ls -t ".update-backups/${pf}."* 2>/dev/null | head -1)
    if [[ -n "$latest_backup" ]] && [[ -s "$latest_backup" ]]; then
      warn "${pf} ist leer nach Update - stelle Backup wieder her..."
      cp "$latest_backup" "$pf"
      ok "${pf} aus Backup wiederhergestellt."
    fi
  fi
done

# Zusätzlicher Guard: Wenn vor dem Update Lizenzen da waren, nach dem Update aber nicht mehr,
# stelle sofort das letzte Backup wieder her.
licenses_after_update="$(count_license_entries premium.json)"
if [[ "${licenses_before_update:-0}" -gt 0 && "${licenses_after_update:-0}" -lt "${licenses_before_update:-0}" ]]; then
  latest_premium_backup="$(ls -t .update-backups/premium.json.* 2>/dev/null | head -1)"
  if [[ -n "$latest_premium_backup" && -s "$latest_premium_backup" ]]; then
    warn "Lizenzanzahl kleiner nach Update (${licenses_before_update} -> ${licenses_after_update}) - stelle premium.json aus Backup wieder her..."
    cp "$latest_premium_backup" premium.json
    licenses_after_update="$(count_license_entries premium.json)"
    ok "premium.json wiederhergestellt (Lizenzen: ${licenses_after_update})."
  fi
fi

if [[ "$old_head" == "$new_head" ]]; then
  info "Keine neuen Commits."
else
  ok "Code aktualisiert: ${old_head:0:8} -> ${new_head:0:8}"
fi

info "Lizenz-Check: vor Update=${licenses_before_update}, nach Update=${licenses_after_update}"

# JSON-Dateien sicherstellen
echo ""
ensure_all_json_files

# Container rebuild
info "Baue Container neu..."
build_no_cache="$(read_env "UPDATE_BUILD_NO_CACHE" "0")"
if [[ "$build_no_cache" == "1" ]]; then
  warn "UPDATE_BUILD_NO_CACHE=1 - baue ohne Cache (langsamer, mehr Speicherverbrauch)."
  docker compose build --no-cache 2>&1 | tail -5
else
  docker compose build 2>&1 | tail -5
fi
docker compose up -d --remove-orphans 2>&1 | tail -3

# Housekeeping nach Update
prune_update_backups
cleanup_rotated_logs
if [[ "$(read_env "AUTO_DOCKER_PRUNE" "1")" != "0" ]]; then
  cleanup_docker_cache
fi

echo ""
ok "Update abgeschlossen!"
show_storage_overview
echo ""

# Zusammenfassung
bot_count=$(count_bots)
cur_stripe=$(read_env "STRIPE_SECRET_KEY")
cur_dbl_token=$(read_env "DISCORDBOTLIST_TOKEN")
web_port=$(read_env "WEB_PORT" "8081")

echo -e "  ${BOLD}Zusammenfassung:${NC}"
echo -e "    Bots:      ${CYAN}${bot_count}${NC}"
echo -e "    Stripe:    $(if [[ -n "$cur_stripe" ]]; then echo -e "${GREEN}konfiguriert${NC}"; else echo -e "${RED}nicht gesetzt${NC}"; fi)"
echo -e "    DBL:       $(if [[ -n "$cur_dbl_token" ]]; then echo -e "${GREEN}konfiguriert${NC}"; else echo -e "${RED}nicht gesetzt${NC}"; fi)"
echo -e "    Web:       ${CYAN}http://localhost:${web_port}${NC}"
echo ""
echo -e "  ${BOLD}Befehle:${NC}"
echo -e "    Bots verwalten:   ${GREEN}./update.sh --bots${NC}"
echo -e "    Stripe Setup:     ${GREEN}./update.sh --stripe${NC}"
echo -e "    Premium:          ${GREEN}./update.sh --premium${NC}"
echo -e "    Codes:            ${GREEN}./update.sh --offers${NC}"
echo -e "    E-Mail Setup:     ${GREEN}./update.sh --email${NC}"
echo -e "    Einstellungen:    ${GREEN}./update.sh --settings${NC}"
echo -e "    Status & Logs:    ${GREEN}./update.sh --status${NC}"
echo -e "    Speicher cleanup: ${GREEN}./update.sh --cleanup${NC}"
echo -e "    Dieses Menue:     ${GREEN}./update.sh${NC}"
echo ""
