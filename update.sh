#!/usr/bin/env bash
# ============================================================
# OmniFM - Unified Management Tool v4
# ============================================================

# KEIN set -e! Interaktive Scripts brechen sonst bei jedem grep-Miss ab.
set -uo pipefail
export LANG="${LANG:-C.UTF-8}"
export LC_ALL="${LC_ALL:-C.UTF-8}"

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

prompt_required_default() {
  local label="$1" def="$2" val=""
  while [[ -z "$val" ]]; do
    read -rp "$(echo -e "  ${CYAN}?${NC} ${label} [${def}]: ")" val
    val="$(echo "${val:-$def}" | xargs)"
    if [[ -z "$val" ]]; then
      echo -e "  ${RED}Pflichtfeld!${NC}"
    fi
  done
  printf "%s" "$val"
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
  local web_port domain public_url origin defaults_csv effective_public_url
  local current_cors current_returns new_cors new_returns changed=0

  web_port="$(read_env "WEB_PORT" "8081")"
  domain="$(read_env "WEB_DOMAIN" "")"
  public_url="$(read_env "PUBLIC_WEB_URL" "")"

  origin="$(extract_origin "$public_url" || true)"
  if [[ -z "$origin" ]]; then
    if [[ -n "$domain" ]]; then
      origin="https://${domain}"
      write_env_line "PUBLIC_WEB_URL" "$origin"
      public_url="$origin"
      changed=1
      info "PUBLIC_WEB_URL gesetzt: ${origin}"
    else
      warn "PUBLIC_WEB_URL ist nicht gesetzt. Nutze nur lokale Fallback-Origins, bis die echte Frontend-URL eingetragen ist."
    fi
  fi

  effective_public_url="${public_url:-http://localhost:${web_port}}"
  defaults_csv="$(build_default_origin_candidates "$effective_public_url" "$web_port")"
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

normalize_command_registration_mode() {
  local normalized
  normalized="$(printf "%s" "${1:-}" | tr '[:upper:]' '[:lower:]' | xargs)"
  case "$normalized" in
    global) echo "global" ;;
    hybrid) echo "hybrid" ;;
    *) echo "guild" ;;
  esac
}

resolve_command_registration_mode_shell() {
  local explicit legacy
  explicit="$(read_env "COMMAND_REGISTRATION_MODE" "")"
  if [[ -n "$explicit" ]]; then
    normalize_command_registration_mode "$explicit"
    return
  fi
  legacy="$(read_env "SYNC_GUILD_COMMANDS_ON_BOOT" "1")"
  if [[ "$legacy" == "0" ]]; then
    echo "global"
  else
    echo "guild"
  fi
}

format_minutes_to_ms() {
  local minutes="$1"
  if [[ ! "$minutes" =~ ^[0-9]+$ ]]; then
    echo "0"
    return
  fi
  echo $((minutes * 60 * 1000))
}

format_ms_to_minutes() {
  local raw="$1"
  if [[ ! "$raw" =~ ^[0-9]+$ ]] || (( raw <= 0 )); then
    echo "0"
    return
  fi
  echo $((raw / 60000))
}

format_interval_label() {
  local raw="$1"
  if [[ ! "$raw" =~ ^[0-9]+$ ]] || (( raw <= 0 )); then
    echo "deaktiviert"
    return
  fi
  if (( raw % 3600000 == 0 )); then
    echo "$((raw / 3600000))h"
    return
  fi
  if (( raw % 60000 == 0 )); then
    echo "$((raw / 60000))m"
    return
  fi
  if (( raw % 1000 == 0 )); then
    echo "$((raw / 1000))s"
    return
  fi
  echo "${raw}ms"
}

mode_description_for_admin() {
  case "$(normalize_command_registration_mode "${1:-guild}")" in
    global) echo "globale Commands, langsamer Discord-Rollout" ;;
    hybrid) echo "global sichtbar + schneller Guild-Sync" ;;
    *) echo "nur Guild-Commands, schnellster und sicherster Modus" ;;
  esac
}

show_container_status_table() {
  echo ""
  echo -e "  ${BOLD}Container-Status:${NC}"
  echo ""
  docker compose ps 2>/dev/null || warn "Kein Container aktiv."
}

show_recent_container_logs() {
  local tail_lines="${1:-20}"
  echo ""
  echo -e "  ${BOLD}Letzte ${tail_lines} Log-Zeilen (docker compose / omnifm):${NC}"
  echo ""
  docker compose logs --tail="$tail_lines" omnifm 2>/dev/null || warn "Keine Container-Logs verfuegbar."
}

show_recent_local_logs() {
  local tail_lines="${1:-30}"
  local target=""
  if [[ -f "logs/bot.log" ]]; then
    target="logs/bot.log"
  else
    target="$(ls -1t logs/bot-*.log 2>/dev/null | head -1 || true)"
  fi

  echo ""
  echo -e "  ${BOLD}Lokale Rotations-Logs:${NC}"
  if [[ -z "$target" ]]; then
    warn "Keine lokale Log-Datei gefunden."
    return
  fi
  echo -e "    Quelle: ${DIM}${target}${NC}"
  echo ""
  tail -n "$tail_lines" "$target" 2>/dev/null || warn "Log-Datei konnte nicht gelesen werden."
}

show_mongodb_runtime_status() {
  echo ""
  echo -e "  ${BOLD}MongoDB Status:${NC}"
  if docker compose ps --services --filter status=running 2>/dev/null | grep -q "^mongodb$"; then
    echo -e "    ${GREEN}MongoDB laeuft.${NC}"
    docker compose exec -T mongodb mongosh --eval "db.stats()" --quiet 2>/dev/null | head -10 || true
  else
    echo -e "    ${YELLOW}MongoDB laeuft nicht. JSON-Fallback aktiv.${NC}"
  fi
}

show_admin_health_detail() {
  local web_port admin_token url
  web_port="$(read_env "WEB_PORT" "8081")"
  admin_token="$(read_env "API_ADMIN_TOKEN" "$(read_env "ADMIN_API_TOKEN" "")")"
  url="http://127.0.0.1:${web_port}/api/health/detail"

  echo ""
  echo -e "  ${BOLD}API Health Detail:${NC}"
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl fehlt. /api/health/detail kann lokal nicht abgefragt werden."
    return
  fi
  if [[ -z "$admin_token" ]]; then
    warn "API_ADMIN_TOKEN fehlt. /api/health/detail ist ohne Token nicht abrufbar."
    return
  fi

  local response
  response="$(curl -fsS -H "Authorization: Bearer ${admin_token}" "$url" 2>/dev/null || true)"
  if [[ -z "$response" ]]; then
    warn "Health-Detail konnte nicht geladen werden (${url}). Container/Web-Port pruefen."
    return
  fi

  if command -v python3 >/dev/null 2>&1; then
    printf "%s" "$response" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), indent=2, ensure_ascii=False))' 2>/dev/null || printf "%s\n" "$response"
  else
    printf "%s\n" "$response"
  fi
}

show_admin_runtime_summary() {
  local bot_count commander_idx web_port public_url admin_token
  local command_mode command_periodic cleanup_global cleanup_guild cleanup_worker
  local log_mb log_files log_days auto_prune prune_until
  local stripe dbl_token dbl_enabled dbl_status dash_status mongo_status container_status

  bot_count="$(count_bots)"
  commander_idx="$(read_env "COMMANDER_BOT_INDEX" "1")"
  web_port="$(read_env "WEB_PORT" "8081")"
  public_url="$(read_env "PUBLIC_WEB_URL" "")"
  admin_token="$(read_env "API_ADMIN_TOKEN" "$(read_env "ADMIN_API_TOKEN" "")")"
  command_mode="$(resolve_command_registration_mode_shell)"
  command_periodic="$(format_interval_label "$(read_env "PERIODIC_GUILD_COMMAND_SYNC_MS" "1800000")")"
  cleanup_global="$(read_env "CLEAN_GLOBAL_COMMANDS_ON_BOOT" "1")"
  cleanup_guild="$(read_env "CLEAN_GUILD_COMMANDS_ON_BOOT" "0")"
  cleanup_worker="$(read_env "CLEAN_WORKER_GUILD_COMMANDS_ON_BOOT" "1")"
  log_mb="$(read_env "LOG_MAX_MB" "5")"
  log_files="$(read_env "LOG_MAX_FILES" "30")"
  log_days="$(read_env "LOG_MAX_DAYS" "14")"
  auto_prune="$(read_env "AUTO_DOCKER_PRUNE" "1")"
  prune_until="$(read_env "DOCKER_BUILDER_PRUNE_UNTIL" "168h")"
  stripe="$(read_env "STRIPE_SECRET_KEY" "$(read_env "STRIPE_API_KEY" "")")"
  dbl_token="$(read_env "DISCORDBOTLIST_TOKEN" "")"
  dbl_enabled="$(read_env "DISCORDBOTLIST_ENABLED" "1")"

  if docker compose ps --services --filter status=running 2>/dev/null | grep -q "^omnifm$"; then
    container_status="${GREEN}laeuft${NC}"
  else
    container_status="${YELLOW}gestoppt${NC}"
  fi
  if docker compose ps --services --filter status=running 2>/dev/null | grep -q "^mongodb$"; then
    mongo_status="${GREEN}MongoDB${NC}"
  else
    mongo_status="${YELLOW}JSON-Fallback${NC}"
  fi
  if [[ -n "$(read_env "DISCORD_CLIENT_ID" "")" && -n "$(read_env "DISCORD_CLIENT_SECRET" "")" && "$(read_env "DISCORD_REDIRECT_URI" "")" == *"/api/auth/discord/callback"* ]]; then
    dash_status="${GREEN}ok${NC}"
  else
    dash_status="${YELLOW}unvollstaendig${NC}"
  fi
  if [[ "$dbl_enabled" == "0" ]]; then
    dbl_status="${YELLOW}deaktiviert${NC}"
  elif [[ -n "$dbl_token" ]]; then
    dbl_status="${GREEN}ok${NC}"
  else
    dbl_status="${RED}fehlt${NC}"
  fi

  echo ""
  echo -e "  ${BOLD}Admin-Cockpit${NC}"
  echo "  ------------------------------------"
  echo -e "    Runtime:             ${container_status} / ${mongo_status}"
  echo -e "    Commander/Bots:      ${CYAN}#${commander_idx}${NC} / ${CYAN}${bot_count}${NC}"
  echo -e "    Slash-Commands:      ${CYAN}${command_mode}${NC} (${DIM}$(mode_description_for_admin "$command_mode")${NC})"
  echo -e "    Periodischer Sync:   ${CYAN}${command_periodic}${NC}"
  echo -e "    Cleanup on boot:     global=${cleanup_global}, guild=${cleanup_guild}, worker=${cleanup_worker}"
  echo -e "    Web/API:             ${CYAN}http://localhost:${web_port}${NC}"
  if [[ -n "$public_url" ]]; then
    echo -e "    Public URL:          ${CYAN}${public_url}${NC}"
  else
    echo -e "    Public URL:          ${YELLOW}nicht gesetzt${NC}"
  fi
  echo -e "    Dashboard OAuth:     ${dash_status}"
  echo -e "    Stripe / DBL:        $(if [[ -n "$stripe" ]]; then echo -e "${GREEN}ok${NC}"; else echo -e "${RED}fehlt${NC}"; fi) / ${dbl_status}"
  echo -e "    Admin API Token:     $(if [[ -n "$admin_token" ]]; then echo -e "${GREEN}gesetzt${NC}"; else echo -e "${YELLOW}nicht gesetzt${NC}"; fi)"
  echo -e "    Logs:                ${CYAN}${log_mb}MB${NC}, ${CYAN}${log_files}${NC} Dateien, ${CYAN}${log_days}${NC} Tage"
  echo -e "    Docker Cleanup:      $(if [[ "$auto_prune" == "0" ]]; then echo -e "${YELLOW}aus${NC}"; else echo -e "${GREEN}an${NC}"; fi) (${DIM}${prune_until}${NC})"
}

run_status_menu() {
  local status_choice
  while true; do
    show_admin_runtime_summary
    echo ""
    echo -e "  ${BOLD}Status & Logs${NC}"
    echo -e "    ${GREEN}1${NC}) Container-Status anzeigen"
    echo -e "    ${CYAN}2${NC}) API Health Detail anzeigen"
    echo -e "    ${YELLOW}3${NC}) Docker-Logs (omnifm)"
    echo -e "    ${MAGENTA}4${NC}) Lokale Rotations-Logs"
    echo -e "    ${GREEN}5${NC}) MongoDB Status"
    echo -e "    ${CYAN}6${NC}) Speicher-Uebersicht"
    echo -e "    ${YELLOW}7${NC}) Doctor Check"
    echo -e "    ${RED}8${NC}) Cleanup jetzt ausfuehren"
    echo -e "    ${GREEN}9${NC}) Container starten / rebuild"
    echo -e "    ${CYAN}10${NC}) Slash-Commands jetzt deployen"
    echo -e "    ${YELLOW}11${NC}) Premium verwalten"
    echo -e "    ${MAGENTA}12${NC}) Codes / Offers verwalten"
    echo -e "    ${GREEN}13${NC}) E-Mail (SMTP) konfigurieren"
    echo -e "    ${MAGENTA}14${NC}) Einstellungen oeffnen"
    echo -e "    ${CYAN}15${NC}) Bots verwalten"
    echo -e "    ${DIM}0${NC}) Zurueck / Beenden"
    echo ""
    read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Auswahl [0-15]${NC}: ")" status_choice
    case "${status_choice:-}" in
      1) show_container_status_table ;;
      2) show_admin_health_detail ;;
      3) show_recent_container_logs 40 ;;
      4) show_recent_local_logs 40 ;;
      5) show_mongodb_runtime_status ;;
      6) show_storage_overview ;;
      7) run_system_doctor || true ;;
      8)
        prune_update_backups
        cleanup_rotated_logs
        if [[ "$(read_env "AUTO_DOCKER_PRUNE" "1")" != "0" ]]; then
          cleanup_docker_cache
        fi
        show_storage_overview
        ;;
      9) rebuild_container_now ;;
      10) run_command_deploy_now ;;
      11) run_premium_wizard_now ;;
      12) run_offers_wizard_now ;;
      13)
        MODE="--email"
        MODE_ARG=""
        return 0
        ;;
      14)
        MODE="--settings"
        MODE_ARG=""
        return 0
        ;;
      15)
        MODE="--bots"
        MODE_ARG=""
        return 0
        ;;
      0|q|Q|exit|quit) exit 0 ;;
      *) warn "Ungueltige Auswahl. Bitte 0-15 waehlen." ;;
    esac
    echo ""
  done
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

is_valid_http_url() {
  local value="$1"
  [[ "$value" =~ ^https?://[^/[:space:]]+(/.*)?$ ]]
}

dashboard_oauth_health_report() {
  local cid secret redir scope ttl cookie public_url
  cid="$(read_env "DISCORD_CLIENT_ID" "")"
  secret="$(read_env "DISCORD_CLIENT_SECRET" "")"
  redir="$(read_env "DISCORD_REDIRECT_URI" "")"
  scope="$(read_env "DISCORD_OAUTH_SCOPES" "identify guilds")"
  ttl="$(read_env "DASHBOARD_SESSION_TTL_SECONDS" "86400")"
  cookie="$(read_env "DASHBOARD_SESSION_COOKIE" "omnifm_session")"
  public_url="$(read_env "PUBLIC_WEB_URL" "")"

  local state="ok"
  local details=()

  if [[ -z "$cid" ]]; then
    state="warn"
    details+=("Client ID fehlt")
  fi
  if [[ -z "$secret" ]]; then
    state="warn"
    details+=("Client Secret fehlt")
  fi
  if [[ -z "$redir" ]]; then
    state="warn"
    details+=("Redirect URI fehlt")
  elif ! is_valid_http_url "$redir"; then
    state="warn"
    details+=("Redirect URI ungueltig")
  elif [[ "$redir" != *"/api/auth/discord/callback"* ]]; then
    state="warn"
    details+=("Redirect URI ohne /api/auth/discord/callback")
  fi
  if [[ -z "$public_url" ]]; then
    state="warn"
    details+=("PUBLIC_WEB_URL fehlt")
  elif ! is_valid_http_url "$public_url"; then
    state="warn"
    details+=("PUBLIC_WEB_URL ungueltig")
  fi

  if [[ "$state" == "ok" ]]; then
    ok "Dashboard OAuth: konfiguriert (${scope}, cookie=${cookie}, ttl=${ttl}s, public=${public_url})."
  else
    warn "Dashboard OAuth: unvollstaendig (${details[*]})."
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
    return
  fi
  if ! json_file_is_valid "$fp"; then
    repair_json_file "$fp" "$content"
  fi
}

json_file_is_valid() {
  local fp="$1"
  [[ -f "$fp" ]] || return 1
  python3 - "$fp" <<'PY' >/dev/null 2>&1
import json
import sys

with open(sys.argv[1], "r", encoding="utf-8") as handle:
    json.load(handle)
PY
}

repair_json_file() {
  local fp="$1" content="${2:-{}}"
  local stamp corrupt_copy latest_backup backup_file

  mkdir -p .update-backups
  stamp="$(date +%Y%m%d%H%M%S)"
  corrupt_copy=".update-backups/${fp}.corrupt.${stamp}"
  cp "$fp" "$corrupt_copy" 2>/dev/null || true

  backup_file="${fp}.bak"
  if [[ -s "$backup_file" ]] && json_file_is_valid "$backup_file"; then
    cp "$backup_file" "$fp"
    warn "JSON repariert aus Backup: ${fp}"
    return
  fi

  latest_backup="$(ls -t ".update-backups/${fp}."* 2>/dev/null | head -1 || true)"
  if [[ -n "$latest_backup" ]] && [[ -s "$latest_backup" ]] && json_file_is_valid "$latest_backup"; then
    cp "$latest_backup" "$fp"
    warn "JSON repariert aus Update-Backup: ${fp}"
    return
  fi

  echo "$content" > "$fp"
  warn "JSON zurueckgesetzt: ${fp} (kein gueltiges Backup gefunden)"
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
  ensure_json_file "dashboard.json" '{"version":1,"events":{},"perms":{},"telemetry":{},"authSessions":{},"oauthStates":{}}'
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
  for prefix in ".env" "premium.json" "bot-state.json" "custom-stations.json" "command-permissions.json" "guild-languages.json" "song-history.json" "scheduled-events.json" "coupons.json" "dashboard.json"; do
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

report_runtime_tools_status() {
  if ! docker compose ps --services --filter status=running 2>/dev/null | grep -q "^omnifm$"; then
    return 0
  fi

  if docker compose exec -T omnifm sh -lc 'command -v ffmpeg >/dev/null 2>&1' >/dev/null 2>&1; then
    ok "Container-Tooling: ffmpeg verfuegbar."
  else
    warn "Container-Tooling: ffmpeg fehlt."
  fi

  if docker compose exec -T omnifm sh -lc 'command -v fpcalc >/dev/null 2>&1' >/dev/null 2>&1; then
    ok "Container-Tooling: fpcalc/Chromaprint verfuegbar."
  else
    warn "Container-Tooling: fpcalc/Chromaprint fehlt."
  fi
}

run_system_doctor() {
  local ok_count=0 warn_count=0 fail_count=0

  doctor_ok() {
    ok_count=$((ok_count + 1))
    ok "$1"
  }
  doctor_warn() {
    warn_count=$((warn_count + 1))
    warn "$1"
  }
  doctor_fail() {
    fail_count=$((fail_count + 1))
    fail "$1"
  }

  echo ""
  echo -e "  ${BOLD}OmniFM Doctor Check${NC}"
  echo "  ────────────────────────────────────"

  # 1) Docker/Compose
  if command -v docker >/dev/null 2>&1; then
    doctor_ok "docker gefunden."
  else
    doctor_fail "docker fehlt."
  fi
  if docker compose version >/dev/null 2>&1; then
    doctor_ok "docker compose verfuegbar."
  else
    doctor_fail "docker compose fehlt."
  fi

  # 2) Core env
  local public_url web_port stripe bot_count
  public_url="$(read_env "PUBLIC_WEB_URL" "")"
  web_port="$(read_env "WEB_PORT" "8081")"
  stripe="$(read_env "STRIPE_SECRET_KEY" "$(read_env "STRIPE_API_KEY" "")")"
  bot_count="$(count_bots)"

  if [[ -n "$public_url" ]] && is_valid_http_url "$public_url"; then
    doctor_ok "PUBLIC_WEB_URL gesetzt: ${public_url}"
  else
    doctor_warn "PUBLIC_WEB_URL fehlt oder ungueltig."
  fi

  if [[ "$web_port" =~ ^[0-9]+$ ]]; then
    doctor_ok "WEB_PORT gesetzt: ${web_port}"
  else
    doctor_warn "WEB_PORT ungueltig: ${web_port}"
  fi

  if [[ -n "$stripe" ]]; then
    doctor_ok "Stripe Key gesetzt."
  else
    doctor_warn "Stripe Key fehlt (STRIPE_SECRET_KEY/STRIPE_API_KEY)."
  fi

  if [[ "$bot_count" =~ ^[0-9]+$ ]] && (( bot_count > 0 )); then
    doctor_ok "Bots konfiguriert: ${bot_count}"
  else
    doctor_fail "Keine Bots konfiguriert."
  fi

  # 3) Dashboard OAuth
  local cid secret redir
  cid="$(read_env "DISCORD_CLIENT_ID" "")"
  secret="$(read_env "DISCORD_CLIENT_SECRET" "")"
  redir="$(read_env "DISCORD_REDIRECT_URI" "")"

  if [[ -n "$cid" && -n "$secret" && "$redir" == *"/api/auth/discord/callback"* ]]; then
    doctor_ok "Dashboard OAuth konfiguriert."
  else
    doctor_warn "Dashboard OAuth unvollstaendig (Client ID/Secret/Redirect)."
  fi

  # 4) JSON Files
  ensure_all_json_files
  local json_file
  for json_file in premium.json bot-state.json custom-stations.json command-permissions.json guild-languages.json song-history.json listening-stats.json scheduled-events.json coupons.json dashboard.json stations.json; do
    if [[ ! -f "$json_file" ]]; then
      doctor_fail "Datei fehlt: ${json_file}"
      continue
    fi
    if json_file_is_valid "$json_file"; then
      doctor_ok "JSON ok: ${json_file}"
    else
      doctor_fail "JSON fehlerhaft: ${json_file}"
    fi
  done

  # 5) Runtime status
  if docker compose ps --services --filter status=running 2>/dev/null | grep -q "omnifm"; then
    doctor_ok "Container omnifm laeuft."
  else
    doctor_warn "Container omnifm laeuft aktuell nicht."
  fi

  # 6) MongoDB status
  if docker compose ps --services --filter status=running 2>/dev/null | grep -q "mongodb"; then
    doctor_ok "MongoDB Container laeuft."
  else
    doctor_warn "MongoDB Container laeuft nicht. Listening-Stats nutzen JSON-Fallback."
  fi

  echo ""
  echo -e "  ${BOLD}Doctor Ergebnis:${NC}"
  echo -e "    ${GREEN}OK:${NC} ${ok_count}"
  echo -e "    ${YELLOW}WARN:${NC} ${warn_count}"
  echo -e "    ${RED}FAIL:${NC} ${fail_count}"
  echo ""

  if (( fail_count > 0 )); then
    return 2
  fi
  if (( warn_count > 0 )); then
    return 1
  fi
  return 0
}

run_recognition_test() {
  local target_url="${1:-}"

  if [[ -z "$target_url" ]]; then
    fail "Bitte eine Stream-URL angeben."
    echo -e "  ${DIM}Beispiel: ./update.sh --recognition-test https://tomorrowland.my105.ch/oneworldradio.mp3${NC}"
    return 1
  fi

  if ! docker compose ps --services --filter status=running 2>/dev/null | grep -q "^omnifm$"; then
    fail "Container 'omnifm' laeuft nicht."
    echo -e "  ${DIM}Starte zuerst: docker compose up -d --build${NC}"
    return 1
  fi

  echo ""
  echo -e "  ${BOLD}Recognition-Test${NC}"
  echo "  ------------------------------------"
  echo -e "  URL: ${CYAN}${target_url}${NC}"
  echo ""

  docker compose exec -T \
    -e RECOGNITION_TEST_URL="$target_url" \
    omnifm sh -lc 'cd /app && node --input-type=module - <<'\''EOF'\''
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fetchStreamSnapshot, hasUsableStreamTrack } from "./src/services/now-playing.js";
import { recognizeTrackFromStream } from "./src/services/audio-recognition.js";

const execFileAsync = promisify(execFile);
const url = String(process.env.RECOGNITION_TEST_URL || "").trim();
const sampleSeconds = Math.max(8, Math.min(40, Number.parseInt(process.env.NOW_PLAYING_RECOGNITION_SAMPLE_SECONDS || "22", 10) || 22));
const sampleRate = Math.max(11025, Math.min(48000, Number.parseInt(process.env.NOW_PLAYING_RECOGNITION_CAPTURE_SAMPLE_RATE || "44100", 10) || 44100));
const channels = Math.max(1, Math.min(2, Number.parseInt(process.env.NOW_PLAYING_RECOGNITION_CAPTURE_CHANNELS || "2", 10) || 2));
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-diag-"));
const wav = path.join(tmp, "sample.wav");

const out = {
  url,
  env: {
    keyPresent: Boolean(process.env.ACOUSTID_API_KEY),
    sampleSeconds,
    sampleRate,
    channels,
    timeoutMs: Number.parseInt(process.env.NOW_PLAYING_RECOGNITION_TIMEOUT_MS || "28000", 10) || 28000,
  },
  stream: {
    metadataSource: null,
    metadataStatus: null,
    displayTitle: null,
    artist: null,
    title: null,
    album: null,
    willSkipRecognition: false,
  },
  sample: {
    ok: false,
    duration: null,
    fileSizeBytes: 0,
  },
  fingerprint: {
    ok: false,
    present: false,
    duration: null,
    length: 0,
  },
  acoustid: {
    statusCode: null,
    status: null,
    error: null,
    resultsCount: 0,
    firstResult: null,
  },
  app: {
    ok: false,
    result: null,
  },
};

try {
  const streamSnapshot = await fetchStreamSnapshot(url, { includeCover: false, allowRecognition: false });
  out.stream.metadataSource = streamSnapshot?.metadataSource || null;
  out.stream.metadataStatus = streamSnapshot?.metadataStatus || null;
  out.stream.displayTitle = streamSnapshot?.displayTitle || null;
  out.stream.artist = streamSnapshot?.artist || null;
  out.stream.title = streamSnapshot?.title || null;
  out.stream.album = streamSnapshot?.album || null;
  out.stream.willSkipRecognition = hasUsableStreamTrack(streamSnapshot);

  await execFileAsync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
    "-t", String(sampleSeconds),
    "-i", url,
    "-vn", "-ac", String(channels), "-ar", String(sampleRate), "-c:a", "pcm_s16le", "-f", "wav",
    wav,
  ]);

  const stat = await fs.stat(wav);
  out.sample.ok = stat.size > 44;
  out.sample.fileSizeBytes = stat.size;

  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      wav,
    ]);
    const probed = Number.parseFloat(String(stdout || "").trim());
    out.sample.duration = Number.isFinite(probed) ? probed : null;
  } catch {
    out.sample.duration = null;
  }

  const fpcalcResult = await execFileAsync("fpcalc", [wav]).catch((error) => ({
    stdout: error?.stdout || "",
    stderr: error?.stderr || "",
    code: error?.code ?? null,
  }));

  const fpStdout = String(fpcalcResult?.stdout || "");
  const duration = fpStdout.match(/^DURATION=(.+)$/m)?.[1]?.trim() || null;
  const fingerprint = fpStdout.match(/^FINGERPRINT=(.+)$/m)?.[1]?.trim() || null;

  out.fingerprint.ok = Boolean(duration && fingerprint);
  out.fingerprint.present = Boolean(fingerprint);
  out.fingerprint.duration = duration;
  out.fingerprint.length = fingerprint ? fingerprint.length : 0;

  if (fingerprint && duration && process.env.ACOUSTID_API_KEY) {
    const body = new URLSearchParams({
      client: process.env.ACOUSTID_API_KEY,
      duration,
      fingerprint,
      meta: "recordings+releasegroups+releases+tracks+compress",
      format: "json",
    });

    const response = await fetch("https://api.acoustid.org/v2/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });

    const json = await response.json().catch(() => null);
    out.acoustid.statusCode = response.status;
    out.acoustid.status = json?.status || null;
    out.acoustid.error = json?.error || null;
    out.acoustid.resultsCount = Array.isArray(json?.results) ? json.results.length : 0;
    out.acoustid.firstResult = json?.results?.[0] || null;
  }

  const appResult = await recognizeTrackFromStream(url, { existingTrack: null });
  out.app.ok = Boolean(appResult);
  out.app.result = appResult || null;
} catch (error) {
  out.sample.error = String(error?.message || error);
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}

console.log(JSON.stringify(out, null, 2));
EOF'
}

compose_build() {
  if docker compose build "$@"; then
    return 0
  fi
  fail "Docker-Build fehlgeschlagen."
  return 1
}

compose_up() {
  if docker compose up -d --remove-orphans; then
    return 0
  fi
  fail "Container konnten nicht gestartet werden."
  return 1
}

compose_up_with_build() {
  if docker compose up -d --build --remove-orphans; then
    report_runtime_tools_status
    return 0
  fi
  fail "Container-Rebuild fehlgeschlagen."
  return 1
}

restart_container() {
  echo ""
  if prompt_yes_no "Container jetzt neu starten (noetig fuer Aenderungen)?" "j"; then
    ensure_all_json_files
    info "Starte Container neu..."
    if compose_up_with_build; then
      ok "Container neu gestartet."
    else
      fail "Neustart fehlgeschlagen. Bitte Build-Log oben pruefen."
      return 1
    fi
  else
    warn "Nicht vergessen: ${BOLD}docker compose up -d --build${NC} ausfuehren!"
  fi
}

omnifm_container_running() {
  docker compose ps --services --filter status=running 2>/dev/null | grep -q "^omnifm$"
}

ensure_omnifm_running() {
  if omnifm_container_running; then
    return 0
  fi
  warn "Container nicht aktiv."
  echo ""
  if prompt_yes_no "Container jetzt starten?" "j"; then
    ensure_all_json_files
    if compose_up_with_build; then
      sleep 3
      return 0
    fi
    return 1
  fi
  warn "Aktion abgebrochen."
  return 1
}

run_omnifm_exec() {
  if ! ensure_omnifm_running; then
    return 1
  fi
  docker compose exec omnifm "$@"
}

rebuild_container_now() {
  echo ""
  info "Starte Container mit Build neu..."
  ensure_all_json_files
  if compose_up_with_build; then
    ok "Container aktiv."
    return 0
  fi
  fail "Container-Start fehlgeschlagen."
  return 1
}

run_command_deploy_now() {
  local command_mode
  command_mode="$(resolve_command_registration_mode_shell)"
  echo ""
  info "Slash-Command Deploy gestartet (${command_mode})."
  if [[ "$command_mode" == "guild" ]]; then
    warn "Im Guild-Modus werden globale Commands nicht registriert. Die Guild-Synchronisierung laeuft beim Bot-Start."
  fi
  if run_omnifm_exec node src/deploy-commands.js; then
    ok "Slash-Command Deploy abgeschlossen."
    return 0
  fi
  fail "Slash-Command Deploy fehlgeschlagen."
  return 1
}

run_premium_wizard_now() {
  echo ""
  info "Premium-Verwaltung wird gestartet..."
  if run_omnifm_exec node src/premium-cli.js wizard; then
    ok "Premium-Verwaltung beendet."
    return 0
  fi
  fail "Premium-Verwaltung fehlgeschlagen."
  return 1
}

run_offers_wizard_now() {
  echo ""
  info "Codes / Offers Verwaltung wird gestartet..."
  if run_omnifm_exec node src/premium-cli.js offers; then
    ok "Codes / Offers Verwaltung beendet."
    return 0
  fi
  fail "Codes / Offers Verwaltung fehlgeschlagen."
  return 1
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
ensure_env_default "COMMAND_REGISTRATION_MODE" "guild"
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
ensure_env_default "DEFAULT_LANGUAGE" "en"
ensure_env_default "NOW_PLAYING_RECOGNITION_ENABLED" "0"
ensure_env_default "NOW_PLAYING_RECOGNITION_SAMPLE_SECONDS" "18"
ensure_env_default "NOW_PLAYING_RECOGNITION_MIN_SECONDS" "10"
ensure_env_default "NOW_PLAYING_RECOGNITION_TIMEOUT_MS" "28000"
ensure_env_default "NOW_PLAYING_RECOGNITION_CACHE_TTL_MS" "90000"
ensure_env_default "NOW_PLAYING_RECOGNITION_FAILURE_TTL_MS" "180000"
ensure_env_default "NOW_PLAYING_RECOGNITION_SCORE_THRESHOLD" "0.55"
ensure_env_default "NOW_PLAYING_MUSICBRAINZ_ENABLED" "1"
ensure_env_default "DISCORD_OAUTH_SCOPES" "identify guilds"
ensure_env_default "DASHBOARD_SESSION_COOKIE" "omnifm_session"
ensure_env_default "DASHBOARD_SESSION_TTL_SECONDS" "86400"
ensure_env_default "DISCORD_OAUTH_STATE_TTL_SECONDS" "600"
ensure_env_default "DISCORD_CLIENT_ID" ""
ensure_env_default "DISCORD_CLIENT_SECRET" ""
ensure_env_default "DISCORD_REDIRECT_URI" ""
ensure_env_default "MONGO_URL" "mongodb://mongodb:27017"
ensure_env_default "DB_NAME" "radio_bot"

# Einmalige Migration: fruehere Defaults hatten CLEAN_GUILD_COMMANDS_ON_BOOT=1.
# Das kann bei transienten API-Fehlern Commands entfernen.
if [[ "$(read_env "CLEAN_GUILD_COMMANDS_ON_BOOT_MIGRATED" "0")" != "1" ]]; then
  if [[ "$(read_env "CLEAN_GUILD_COMMANDS_ON_BOOT" "0")" == "1" ]]; then
    warn "Migration: CLEAN_GUILD_COMMANDS_ON_BOOT von 1 auf 0 gesetzt (stabilerer Command-Sync)."
    write_env_line "CLEAN_GUILD_COMMANDS_ON_BOOT" "0"
  fi
  write_env_line "CLEAN_GUILD_COMMANDS_ON_BOOT_MIGRATED" "1"
fi

dashboard_oauth_health_report

# ============================================================
# Mode selection
# ============================================================

MODE="${1:-}"
MODE_ARG="${2:-}"

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
    echo -e "    ${DIM}7${NC})  Status & Logs     - Admin-Cockpit fuer Status, Health und Logs"
    echo -e "    ${DIM}8${NC})  Speicher cleanup  - Logs/Backups/Docker-Cache aufraeumen"
    echo -e "    ${BOLD}9${NC})  Codes verwalten  - Coupon/Referral (Pro/Ultimate Setup)"
    echo -e "    ${CYAN}0${NC})  Doctor Check     - System, OAuth, JSON, Runtime pruefen"
    echo -e "    ${MAGENTA}c${NC})  Slash Commands  - Registrierung & Sync konfigurieren"
    echo -e "    ${MAGENTA}d${NC})  Dashboard OAuth - Pro-Dashboard Login/SSO konfigurieren"
    echo -e "    ${DIM}q${NC})  Beenden"
    echo ""
    read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Auswahl [0-9/c/d/q]${NC}: ")" MODE_CHOICE
    case "${MODE_CHOICE:-}" in
      0) MODE="--doctor"; break ;;
      1) MODE="--update"; break ;;
      2) MODE="--bots"; break ;;
      3) MODE="--stripe"; break ;;
      4) MODE="--premium"; break ;;
      5) MODE="--email"; break ;;
      6) MODE="--settings"; break ;;
      7) MODE="--status"; break ;;
      8) MODE="--cleanup"; break ;;
      9) MODE="--offers"; break ;;
      c|C) MODE="--settings"; MODE_ARG="commands"; break ;;
      d|D) MODE="--settings"; MODE_ARG="dashboard"; break ;;
      q|Q|exit|quit) info "Abbruch."; exit 0 ;;
      *)
        warn "Ungueltige Auswahl '${MODE_CHOICE}'. Bitte 0-9, c, d oder q eingeben."
        echo ""
        ;;
    esac
  done
fi

if [[ "$MODE" == "--dashboard-settings" ]]; then
  MODE="--settings"
  MODE_ARG="dashboard"
fi

case "$MODE" in
  --update|--bots|--show-bots|--add-bot|--edit-bot|--remove-bot|--set-commander|--show-roles|--stripe|--premium|--offers|--email|--settings|--dashboard-settings|--status|--cleanup|--doctor|--recognition-test)
    ;;
  *)
    fail "Unbekannter Modus: ${MODE}"
    echo -e "  ${DIM}Erlaubt: --update, --bots, --stripe, --premium, --offers, --email, --settings, --dashboard-settings, --status, --cleanup, --doctor, --recognition-test${NC}"
    exit 1
    ;;
esac

if [[ "$MODE" == "--recognition-test" ]]; then
  run_recognition_test "$MODE_ARG"
  exit $?
fi

if [[ "$MODE" == "--doctor" ]]; then
  run_system_doctor
  exit $?
fi

# ============================================================
# MODE: Status & Logs
# ============================================================
if [[ "$MODE" == "--status" ]]; then
  if [[ "${MODE_ARG:-}" == "quick" || ! -t 0 ]]; then
    show_admin_runtime_summary
    show_container_status_table
    show_recent_container_logs 20
    show_mongodb_runtime_status
    show_storage_overview
    echo ""
    echo -e "  ${DIM}Tipp: Fuer das interaktive Admin-Cockpit: ./update.sh --status${NC}"
    exit 0
  fi
  run_status_menu
  if [[ "$MODE" == "--status" ]]; then
    exit 0
  fi
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
  settings_changed=0
  settings_restart_needed=0

  mark_settings_dirty() {
    settings_changed=1
    settings_restart_needed=1
    ok "Einstellung gespeichert. Neustart ist vorgemerkt (wird am Ende einmal ausgefuehrt)."
  }

  while true; do
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
  cur_recognition_min=$(read_env "NOW_PLAYING_RECOGNITION_MIN_SECONDS" "10")
  cur_recognition_timeout=$(read_env "NOW_PLAYING_RECOGNITION_TIMEOUT_MS" "28000")
  cur_default_language=$(read_env "DEFAULT_LANGUAGE" "en")
  cur_discord_client_id=$(read_env "DISCORD_CLIENT_ID" "")
  cur_discord_client_secret=$(read_env "DISCORD_CLIENT_SECRET" "")
  cur_discord_redirect_uri=$(read_env "DISCORD_REDIRECT_URI" "")
  cur_discord_oauth_scopes=$(read_env "DISCORD_OAUTH_SCOPES" "identify guilds")
  cur_dash_cookie=$(read_env "DASHBOARD_SESSION_COOKIE" "omnifm_session")
  cur_dash_ttl=$(read_env "DASHBOARD_SESSION_TTL_SECONDS" "86400")
  cur_dash_state_ttl=$(read_env "DISCORD_OAUTH_STATE_TTL_SECONDS" "600")
  cur_command_mode=$(resolve_command_registration_mode_shell)
  cur_sync_guild_legacy=$(read_env "SYNC_GUILD_COMMANDS_ON_BOOT" "1")
  cur_clean_global_commands=$(read_env "CLEAN_GLOBAL_COMMANDS_ON_BOOT" "1")
  cur_clean_guild_commands=$(read_env "CLEAN_GUILD_COMMANDS_ON_BOOT" "0")
  cur_clean_worker_guild_commands=$(read_env "CLEAN_WORKER_GUILD_COMMANDS_ON_BOOT" "1")
  cur_periodic_guild_sync_ms=$(read_env "PERIODIC_GUILD_COMMAND_SYNC_MS" "1800000")
  cur_periodic_guild_sync_minutes=$(format_ms_to_minutes "$cur_periodic_guild_sync_ms")
  cur_guild_sync_retries=$(read_env "GUILD_COMMAND_SYNC_RETRIES" "3")
  cur_guild_sync_retry_ms=$(read_env "GUILD_COMMAND_SYNC_RETRY_MS" "1200")
  cur_dash_status="unvollstaendig"
  if [[ -n "$cur_discord_client_id" && -n "$cur_discord_client_secret" && "$cur_discord_redirect_uri" == *"/api/auth/discord/callback"* ]]; then
    cur_dash_status="konfiguriert"
  fi
  cur_legal_provider_name=$(read_env "LEGAL_PROVIDER_NAME" "")
  cur_legal_street=$(read_env "LEGAL_STREET_ADDRESS" "")
  cur_legal_postal=$(read_env "LEGAL_POSTAL_CODE" "")
  cur_legal_city=$(read_env "LEGAL_CITY" "")
  cur_legal_country=$(read_env "LEGAL_COUNTRY" "")
  cur_legal_email=$(read_env "LEGAL_EMAIL" "")
  cur_legal_status="unvollstaendig"
  if [[ -n "$cur_legal_provider_name" && -n "$cur_legal_street" && -n "$cur_legal_postal" && -n "$cur_legal_city" && -n "$cur_legal_email" ]]; then
    cur_legal_status="konfiguriert"
  fi
  cur_privacy_contact_email=$(read_env "PRIVACY_CONTACT_EMAIL" "$cur_legal_email")
  cur_privacy_hosting_provider=$(read_env "PRIVACY_HOSTING_PROVIDER" "")
  cur_privacy_status="unvollstaendig"
  if [[ "$cur_legal_status" == "konfiguriert" && -n "$cur_privacy_contact_email" && -n "$cur_privacy_hosting_provider" ]]; then
    cur_privacy_status="konfiguriert"
  elif [[ "$cur_legal_status" == "konfiguriert" && -n "$cur_privacy_contact_email" ]]; then
    cur_privacy_status="Basis vorhanden"
  fi
  cur_fpcalc_status="Container gestoppt"
  if docker compose ps --services --filter status=running 2>/dev/null | grep -q "^omnifm$"; then
    if docker compose exec -T omnifm sh -lc 'command -v fpcalc >/dev/null 2>&1' >/dev/null 2>&1; then
      cur_fpcalc_status="verfuegbar"
    else
      cur_fpcalc_status="fehlt"
    fi
  fi
  cur_log_max_mb=$(read_env "LOG_MAX_MB" "5")
  cur_log_max_files=$(read_env "LOG_MAX_FILES" "30")
  cur_log_max_days=$(read_env "LOG_MAX_DAYS" "14")
  cur_auto_docker_prune=$(read_env "AUTO_DOCKER_PRUNE" "1")
  cur_docker_prune_until=$(read_env "DOCKER_BUILDER_PRUNE_UNTIL" "168h")
  cur_admin_api_token=$(read_env "API_ADMIN_TOKEN" "$(read_env "ADMIN_API_TOKEN" "")")

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
  echo -e "  Standardsprache:       ${CYAN}${cur_default_language}${NC}"
  echo -e "  Slash-Commands:        ${CYAN}${cur_command_mode}${NC} (${DIM}$(mode_description_for_admin "$cur_command_mode")${NC})"
  echo -e "  Periodischer Sync:     ${CYAN}$(format_interval_label "$cur_periodic_guild_sync_ms")${NC}"
  echo -e "  Command Cleanup:       ${DIM}global=${cur_clean_global_commands}, guild=${cur_clean_guild_commands}, worker=${cur_clean_worker_guild_commands}${NC}"
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
    echo -e "  Track-Erkennung:       ${GREEN}aktiv${NC} (${cur_recognition_sample}s Sample, min. ${cur_recognition_min}s Audio, ${cur_recognition_timeout}ms Timeout)"
  elif [[ "$cur_recognition_enabled" == "1" ]]; then
    echo -e "  Track-Erkennung:       ${YELLOW}aktiv ohne API-Key${NC}"
  else
    echo -e "  Track-Erkennung:       ${DIM}deaktiviert${NC}"
  fi
  echo -e "  fpcalc/Chromaprint:    ${DIM}${cur_fpcalc_status}${NC}"
  if [[ "$cur_legal_status" == "konfiguriert" ]]; then
    echo -e "  Impressum:             ${GREEN}${cur_legal_status}${NC}"
  else
    echo -e "  Impressum:             ${YELLOW}${cur_legal_status}${NC}"
  fi
  if [[ "$cur_privacy_status" == "konfiguriert" ]]; then
    echo -e "  Datenschutz:           ${GREEN}${cur_privacy_status}${NC}"
  else
    echo -e "  Datenschutz:           ${YELLOW}${cur_privacy_status}${NC}"
  fi
  if [[ "$cur_dash_status" == "konfiguriert" ]]; then
    echo -e "  Dashboard OAuth:       ${GREEN}${cur_dash_status}${NC}"
  else
    echo -e "  Dashboard OAuth:       ${YELLOW}${cur_dash_status}${NC}"
  fi
  if [[ -n "$cur_discord_redirect_uri" ]]; then
    echo -e "  OAuth Redirect URI:    ${DIM}${cur_discord_redirect_uri}${NC}"
  else
    echo -e "  OAuth Redirect URI:    ${RED}nicht gesetzt${NC}"
  fi
  echo -e "  Dashboard Session:     ${DIM}cookie=${cur_dash_cookie}, ttl=${cur_dash_ttl}s, state-ttl=${cur_dash_state_ttl}s${NC}"
  echo -e "  Logs:                  ${CYAN}${cur_log_max_mb}MB${NC}, ${CYAN}${cur_log_max_files}${NC} Dateien, ${CYAN}${cur_log_max_days}${NC} Tage"
  echo -e "  Docker Cleanup:        $(if [[ "$cur_auto_docker_prune" == "0" ]]; then echo -e "${YELLOW}deaktiviert${NC}"; else echo -e "${GREEN}aktiv${NC}"; fi) (${DIM}${cur_docker_prune_until}${NC})"
  echo -e "  Admin API Token:       $(if [[ -n "$cur_admin_api_token" ]]; then echo -e "${GREEN}gesetzt${NC}"; else echo -e "${YELLOW}nicht gesetzt${NC}"; fi)"
  echo ""

  echo -e "  ${BOLD}Was aendern?${NC}"
  echo -e "    ${GREEN}1${NC}) Web-Port (extern)"
  echo -e "    ${CYAN}2${NC}) Domain"
  echo -e "    ${YELLOW}3${NC}) Public Web URL"
  echo -e "    ${BOLD}4${NC}) Web-Origin/CORS automatisch reparieren (empfohlen)"
  echo -e "    ${CYAN}5${NC}) Pro-Testmonat ein/aus"
  echo -e "    ${YELLOW}6${NC}) DiscordBotList konfigurieren"
  echo -e "    ${GREEN}7${NC}) Track-Erkennung (AcoustID/MusicBrainz)"
  echo -e "    ${CYAN}8${NC}) Impressum & Datenschutz"
  echo -e "    ${MAGENTA}9${NC}) Dashboard & Discord OAuth"
  echo -e "    ${GREEN}10${NC}) Slash-Commands & Sync"
  echo -e "    ${CYAN}11${NC}) Betrieb, Logs & Admin-Token"
  echo -e "    ${GREEN}12${NC}) Fertig -> einmal neu starten"
  echo -e "    ${DIM}13${NC}) Fertig ohne Neustart"
  echo -e "    ${CYAN}14${NC}) Doctor Check (ohne Aenderung)"
  echo ""
  if [[ "$MODE_ARG" == "dashboard" && "${_DASHBOARD_SETTINGS_OPENED:-0}" != "1" ]]; then
    _DASHBOARD_SETTINGS_OPENED=1
    SET_CHOICE="9"
    info "Direktmodus: Dashboard & Discord OAuth"
  elif [[ "$MODE_ARG" == "commands" && "${_COMMAND_SETTINGS_OPENED:-0}" != "1" ]]; then
    _COMMAND_SETTINGS_OPENED=1
    SET_CHOICE="10"
    info "Direktmodus: Slash-Commands & Sync"
  else
    read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Auswahl [1-14]${NC}: ")" SET_CHOICE
  fi

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
        mark_settings_dirty
      else
        info "Keine Aenderung."
      fi
      ;;
    3)
      new_public="$(prompt_nonempty "Public Web URL (z.B. https://omnifm.xyz)")"
      normalized_public="$(extract_origin "$new_public" || true)"
      if [[ -z "$normalized_public" ]]; then
        fail "Ungueltige URL. Bitte mit http:// oder https:// eingeben."
        warn "Aenderung verworfen. Script laeuft weiter."
      else
        write_env_line "PUBLIC_WEB_URL" "$normalized_public"
        ok "PUBLIC_WEB_URL gespeichert: ${normalized_public}"
        if prompt_yes_no "CORS/Checkout Origins automatisch synchronisieren?" "j"; then
          auto_fix_web_env
        fi
        mark_settings_dirty
      fi
      ;;
    4)
      auto_fix_web_env
      mark_settings_dirty
      ;;
    5)
      if [[ "$cur_trial" == "0" ]]; then
        write_env_line "PRO_TRIAL_ENABLED" "1"
        ok "Pro-Testmonat aktiviert."
      else
        write_env_line "PRO_TRIAL_ENABLED" "0"
        ok "Pro-Testmonat deaktiviert."
      fi
      mark_settings_dirty
      ;;
    6)
      echo ""
      info "DiscordBotList Doku:"
      echo -e "    ${DIM}https://docs.discordbotlist.com/${NC}"
      echo -e "    ${DIM}https://docs.discordbotlist.com/vote-webhooks${NC}"
      echo -e "    ${DIM}https://docs.discordbotlist.com/bot-statistics${NC}"
      if prompt_yes_no "DiscordBotList aktivieren?" "$(if [[ "$cur_dbl_enabled" == "0" ]]; then echo n; else echo j; fi)"; then
        new_dbl_token="$(prompt_default "DiscordBotList Token" "$cur_dbl_token")"
        new_dbl_secret="$(prompt_default "DiscordBotList Webhook Secret" "$cur_dbl_secret")"
        new_dbl_scope="$(prompt_default "Stats Scope (commander/aggregate)" "$cur_dbl_scope")"
        if [[ "$new_dbl_scope" != "commander" && "$new_dbl_scope" != "aggregate" ]]; then
          new_dbl_scope="aggregate"
        fi
        if [[ -z "$new_dbl_token" || -z "$new_dbl_secret" ]]; then
          fail "Token und Webhook Secret sind erforderlich."
          warn "Aenderung verworfen. Script laeuft weiter."
        else
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
        fi
      else
        write_env_line "DISCORDBOTLIST_ENABLED" "0"
        ok "DiscordBotList deaktiviert."
      fi
      mark_settings_dirty
      ;;
    7)
      echo ""
      warn "Hinweis: Die freie AcoustID-Web-API ist laut offizieller Doku nur fuer nicht-kommerzielle Nutzung gedacht."
      info "Brauchbare Stream-Metadaten werden bevorzugt. AcoustID wird nur als Fallback genutzt."
      info "Chromaprint/fpcalc wird beim Docker-Build automatisch im Container installiert."
      echo -e "    ${DIM}Chromaprint: https://github.com/acoustid/chromaprint${NC}"
      echo -e "    ${DIM}AcoustID: https://acoustid.org/webservice${NC}"
      echo -e "    ${DIM}MusicBrainz: https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting${NC}"
      if prompt_yes_no "Audio-Fingerprint-Erkennung aktivieren?" "$(if [[ "$cur_recognition_enabled" == "1" ]]; then echo j; else echo n; fi)"; then
        new_acoustid_key="$(prompt_default "AcoustID API Key" "$cur_acoustid_key")"
        if [[ -z "$new_acoustid_key" ]]; then
          fail "AcoustID API Key ist erforderlich."
          warn "Aenderung verworfen. Script laeuft weiter."
        else
          new_sample="$(prompt_default "Fingerprint Sample in Sekunden" "$cur_recognition_sample")"
          new_min="$(prompt_default "Minimale brauchbare Audio-Dauer in Sekunden" "$cur_recognition_min")"
          new_timeout="$(prompt_default "Timeout in Millisekunden" "$cur_recognition_timeout")"
          write_env_line "NOW_PLAYING_RECOGNITION_ENABLED" "1"
          write_env_line "ACOUSTID_API_KEY" "$new_acoustid_key"
          write_env_line "NOW_PLAYING_RECOGNITION_SAMPLE_SECONDS" "$new_sample"
          write_env_line "NOW_PLAYING_RECOGNITION_MIN_SECONDS" "$new_min"
          write_env_line "NOW_PLAYING_RECOGNITION_TIMEOUT_MS" "$new_timeout"
          write_env_line "NOW_PLAYING_MUSICBRAINZ_ENABLED" "1"
          ok "Track-Erkennung gespeichert."
        fi
      else
        write_env_line "NOW_PLAYING_RECOGNITION_ENABLED" "0"
        ok "Track-Erkennung deaktiviert."
      fi
      mark_settings_dirty
      ;;
    8)
      echo ""
      info "Pflichtangaben fuer Webseiten in Oesterreich haengen u.a. von ECG, UGB, GewO und MedienG ab."
      echo -e "    ${DIM}WKO: https://www.wko.at/medien/internet-homepage-rechtliche-vorgaben${NC}"
      echo -e "    ${DIM}RIS ECG §5: https://www.ris.bka.gv.at/eli/bgbl/2001/152/P5/NOR40032355${NC}"
      echo -e "    ${DIM}RIS MedienG §25: https://www.ris.bka.gv.at/eli/bgbl/1981/314/P25/NOR40120862${NC}"
      echo ""
      info "Pflichtfelder Impressum:"
      echo -e "    ${DIM}Name, Strasse / Hausnummer, PLZ, Ort und Kontakt-E-Mail${NC}"
      echo -e "    ${DIM}Alle weiteren Felder sind optional oder nur je nach Rechtsform / Gewerbe / Medienbetrieb noetig.${NC}"
      legal_provider_name="$(prompt_required_default "Pflichtfeld: Diensteanbieter / Name" "$cur_legal_provider_name")"
      legal_form="$(prompt_default "Rechtsform (optional)" "$(read_env "LEGAL_LEGAL_FORM" "")")"
      legal_representative="$(prompt_default "Vertretungsbefugte Person" "$(read_env "LEGAL_REPRESENTATIVE" "")")"
      legal_street="$(prompt_required_default "Pflichtfeld: Strasse / Hausnummer" "$cur_legal_street")"
      legal_postal="$(prompt_required_default "Pflichtfeld: PLZ" "$cur_legal_postal")"
      legal_city="$(prompt_required_default "Pflichtfeld: Ort" "$cur_legal_city")"
      legal_country="$(prompt_default "Land" "${cur_legal_country:-Oesterreich}")"
      legal_email="$(prompt_required_default "Pflichtfeld: Kontakt-E-Mail" "$cur_legal_email")"
      legal_phone="$(prompt_default "Telefon (optional)" "$(read_env "LEGAL_PHONE" "")")"
      legal_website="$(prompt_default "Webseite" "$(read_env "LEGAL_WEBSITE" "${cur_public_url:-}")")"
      legal_business_purpose="$(prompt_default "Unternehmensgegenstand / Taetigkeitsbereich" "$(read_env "LEGAL_BUSINESS_PURPOSE" "")")"
      legal_register_number="$(prompt_default "Firmenbuchnummer (optional)" "$(read_env "LEGAL_COMMERCIAL_REGISTER_NUMBER" "")")"
      legal_register_court="$(prompt_default "Firmenbuchgericht (optional)" "$(read_env "LEGAL_COMMERCIAL_REGISTER_COURT" "")")"
      legal_vat_id="$(prompt_default "UID-Nummer (optional)" "$(read_env "LEGAL_VAT_ID" "")")"
      legal_authority="$(prompt_default "Aufsichtsbehoerde (optional)" "$(read_env "LEGAL_SUPERVISORY_AUTHORITY" "")")"
      legal_chamber="$(prompt_default "Kammer / Berufsverband (optional)" "$(read_env "LEGAL_CHAMBER" "")")"
      legal_profession="$(prompt_default "Berufsbezeichnung (optional)" "$(read_env "LEGAL_PROFESSION" "")")"
      legal_rules="$(prompt_default "Berufsrecht / Regelwerk (optional)" "$(read_env "LEGAL_PROFESSION_RULES" "")")"
      legal_editor="$(prompt_default "Redaktionell verantwortlich" "$(read_env "LEGAL_EDITORIAL_RESPONSIBLE" "$legal_representative")")"
      legal_media_owner="$(prompt_default "Medieninhaber" "$(read_env "LEGAL_MEDIA_OWNER" "$legal_provider_name")")"
      legal_media_line="$(prompt_default "Grundlegende Richtung / Blattlinie" "$(read_env "LEGAL_MEDIA_LINE" "Informationen ueber OmniFM, den Discord-Bot und zugehoerige Dienste.")")"
      write_env_line "LEGAL_PROVIDER_NAME" "$legal_provider_name"
      write_env_line "LEGAL_LEGAL_FORM" "$legal_form"
      write_env_line "LEGAL_REPRESENTATIVE" "$legal_representative"
      write_env_line "LEGAL_STREET_ADDRESS" "$legal_street"
      write_env_line "LEGAL_POSTAL_CODE" "$legal_postal"
      write_env_line "LEGAL_CITY" "$legal_city"
      write_env_line "LEGAL_COUNTRY" "$legal_country"
      write_env_line "LEGAL_EMAIL" "$legal_email"
      write_env_line "LEGAL_PHONE" "$legal_phone"
      write_env_line "LEGAL_WEBSITE" "$legal_website"
      write_env_line "LEGAL_BUSINESS_PURPOSE" "$legal_business_purpose"
      write_env_line "LEGAL_COMMERCIAL_REGISTER_NUMBER" "$legal_register_number"
      write_env_line "LEGAL_COMMERCIAL_REGISTER_COURT" "$legal_register_court"
      write_env_line "LEGAL_VAT_ID" "$legal_vat_id"
      write_env_line "LEGAL_SUPERVISORY_AUTHORITY" "$legal_authority"
      write_env_line "LEGAL_CHAMBER" "$legal_chamber"
      write_env_line "LEGAL_PROFESSION" "$legal_profession"
      write_env_line "LEGAL_PROFESSION_RULES" "$legal_rules"
      write_env_line "LEGAL_EDITORIAL_RESPONSIBLE" "$legal_editor"
      write_env_line "LEGAL_MEDIA_OWNER" "$legal_media_owner"
      write_env_line "LEGAL_MEDIA_LINE" "$legal_media_line"
      echo ""
      info "Datenschutzerklaerung:"
      echo -e "    ${DIM}Verantwortlicher und Anschrift werden automatisch aus dem Impressum uebernommen.${NC}"
      echo -e "    ${DIM}Empfohlen: Datenschutz-Kontakt, Hosting-Anbieter / -Standort und weitere Empfaenger.${NC}"
      privacy_contact_email="$(prompt_default "Datenschutz-Kontakt E-Mail (empfohlen, Standard = Kontakt-E-Mail)" "$(read_env "PRIVACY_CONTACT_EMAIL" "$legal_email")")"
      privacy_contact_phone="$(prompt_default "Datenschutz-Kontakt Telefon (optional)" "$(read_env "PRIVACY_CONTACT_PHONE" "$legal_phone")")"
      privacy_dpo_name="$(prompt_default "Datenschutzbeauftragte/r oder Datenschutzkontakt (optional)" "$(read_env "PRIVACY_DPO_NAME" "")")"
      privacy_dpo_email="$(prompt_default "Datenschutz-E-Mail (optional)" "$(read_env "PRIVACY_DPO_EMAIL" "")")"
      privacy_hosting_provider="$(prompt_default "Hosting-Anbieter / Infrastruktur (empfohlen)" "$(read_env "PRIVACY_HOSTING_PROVIDER" "")")"
      privacy_hosting_location="$(prompt_default "Hosting-Standort / Region (empfohlen)" "$(read_env "PRIVACY_HOSTING_LOCATION" "EU / Oesterreich")")"
      privacy_additional_recipients="$(prompt_default "Weitere Empfaenger / Auftragsverarbeiter (optional)" "$(read_env "PRIVACY_ADDITIONAL_RECIPIENTS" "")")"
      privacy_custom_note="$(prompt_default "Zusaetzlicher Datenschutzhinweis (optional)" "$(read_env "PRIVACY_CUSTOM_NOTE" "")")"
      privacy_authority_name="$(prompt_default "Beschwerdebehoerde" "$(read_env "PRIVACY_AUTHORITY_NAME" "Oesterreichische Datenschutzbehoerde")")"
      privacy_authority_website="$(prompt_default "Website der Beschwerdebehoerde" "$(read_env "PRIVACY_AUTHORITY_WEBSITE" "https://www.dsb.gv.at/")")"
      write_env_line "PRIVACY_CONTACT_EMAIL" "$privacy_contact_email"
      write_env_line "PRIVACY_CONTACT_PHONE" "$privacy_contact_phone"
      write_env_line "PRIVACY_DPO_NAME" "$privacy_dpo_name"
      write_env_line "PRIVACY_DPO_EMAIL" "$privacy_dpo_email"
      write_env_line "PRIVACY_HOSTING_PROVIDER" "$privacy_hosting_provider"
      write_env_line "PRIVACY_HOSTING_LOCATION" "$privacy_hosting_location"
      write_env_line "PRIVACY_ADDITIONAL_RECIPIENTS" "$privacy_additional_recipients"
      write_env_line "PRIVACY_CUSTOM_NOTE" "$privacy_custom_note"
      write_env_line "PRIVACY_AUTHORITY_NAME" "$privacy_authority_name"
      write_env_line "PRIVACY_AUTHORITY_WEBSITE" "$privacy_authority_website"
      ok "Impressums- und Datenschutzdaten gespeichert."
      mark_settings_dirty
      ;;
    9)
      echo ""
      info "Discord OAuth Setup fuer Pro-Dashboard"
      echo -e "    ${DIM}Discord Developer Portal -> OAuth2 -> Redirects${NC}"
      echo -e "    ${DIM}Redirect muss auf /api/auth/discord/callback enden.${NC}"

      dash_cid="$(prompt_default "Discord Client ID" "$cur_discord_client_id")"
      dash_secret="$(prompt_default "Discord Client Secret" "$cur_discord_client_secret")"
      dash_redirect="$(prompt_default "Discord Redirect URI" "$cur_discord_redirect_uri")"
      dash_scopes="$(prompt_default "OAuth Scopes" "$cur_discord_oauth_scopes")"
      dash_cookie="$(prompt_default "Dashboard Session Cookie" "$cur_dash_cookie")"
      dash_ttl="$(prompt_default "Dashboard Session TTL (Sekunden)" "$cur_dash_ttl")"
      dash_state_ttl="$(prompt_default "OAuth State TTL (Sekunden)" "$cur_dash_state_ttl")"

      if [[ -z "$dash_cid" || -z "$dash_secret" || -z "$dash_redirect" ]]; then
        fail "Client ID, Client Secret und Redirect URI sind erforderlich."
        warn "Aenderung verworfen. Script laeuft weiter."
      elif ! is_valid_http_url "$dash_redirect"; then
        fail "Redirect URI ungueltig. Bitte mit http:// oder https:// eingeben."
        warn "Aenderung verworfen. Script laeuft weiter."
      elif [[ "$dash_redirect" != *"/api/auth/discord/callback"* ]]; then
        fail "Redirect URI muss auf /api/auth/discord/callback enden."
        warn "Aenderung verworfen. Script laeuft weiter."
      else
        if [[ ! "$dash_ttl" =~ ^[0-9]+$ ]] || (( dash_ttl < 300 )); then
          warn "Session TTL ungueltig (<300). Verwende 86400."
          dash_ttl="86400"
        fi
        if [[ ! "$dash_state_ttl" =~ ^[0-9]+$ ]] || (( dash_state_ttl < 60 )); then
          warn "State TTL ungueltig (<60). Verwende 600."
          dash_state_ttl="600"
        fi

        write_env_line "DISCORD_CLIENT_ID" "$dash_cid"
        write_env_line "DISCORD_CLIENT_SECRET" "$dash_secret"
        write_env_line "DISCORD_REDIRECT_URI" "$dash_redirect"
        write_env_line "DISCORD_OAUTH_SCOPES" "$dash_scopes"
        write_env_line "DASHBOARD_SESSION_COOKIE" "$dash_cookie"
        write_env_line "DASHBOARD_SESSION_TTL_SECONDS" "$dash_ttl"
        write_env_line "DISCORD_OAUTH_STATE_TTL_SECONDS" "$dash_state_ttl"

        if [[ -z "$(read_env "PUBLIC_WEB_URL" "")" ]]; then
          warn "PUBLIC_WEB_URL ist noch leer. Bitte die echte Frontend-URL setzen, besonders wenn Dashboard und API auf unterschiedlichen Origins laufen."
        fi

        auto_fix_web_env
        ok "Dashboard OAuth Einstellungen gespeichert."
        dashboard_oauth_health_report
        mark_settings_dirty
      fi
      ;;
    10)
      echo ""
      info "Slash-Commands & Sync"
      echo -e "    ${DIM}Empfohlen fuer OmniFM: guild als Default, hybrid wenn globale Sichtbarkeit gewuenscht ist.${NC}"
      echo -e "    ${DIM}global ist moeglich, hat aber Discord-seitig den langsamsten Rollout.${NC}"

      new_command_mode="$(prompt_default "Command Registration Mode (guild/global/hybrid)" "$cur_command_mode")"
      new_command_mode="$(normalize_command_registration_mode "$new_command_mode")"
      new_periodic_sync_minutes="$(prompt_default "Periodischer Guild-Sync in Minuten (0 = aus)" "$cur_periodic_guild_sync_minutes")"
      if [[ ! "$new_periodic_sync_minutes" =~ ^[0-9]+$ ]]; then
        warn "Ungueltige Minutenangabe. Verwende aktuellen Wert ${cur_periodic_guild_sync_minutes}."
        new_periodic_sync_minutes="$cur_periodic_guild_sync_minutes"
      fi
      new_guild_sync_retries="$(prompt_default "Guild-Sync Retries" "$cur_guild_sync_retries")"
      if [[ ! "$new_guild_sync_retries" =~ ^[0-9]+$ ]] || (( new_guild_sync_retries < 1 )); then
        warn "Ungueltige Retry-Anzahl. Verwende 3."
        new_guild_sync_retries="3"
      fi
      new_guild_sync_retry_ms="$(prompt_default "Guild-Sync Retry Delay (ms)" "$cur_guild_sync_retry_ms")"
      if [[ ! "$new_guild_sync_retry_ms" =~ ^[0-9]+$ ]] || (( new_guild_sync_retry_ms < 100 )); then
        warn "Ungueltiger Retry-Delay. Verwende 1200."
        new_guild_sync_retry_ms="1200"
      fi

      if prompt_yes_no "Global Commands auf Boot aktiv bereinigen?" "$(if [[ "$cur_clean_global_commands" == "0" ]]; then echo n; else echo j; fi)"; then
        new_clean_global_commands="1"
      else
        new_clean_global_commands="0"
      fi
      if prompt_yes_no "Guild-Commands auf Boot aktiv bereinigen?" "$(if [[ "$cur_clean_guild_commands" == "0" ]]; then echo n; else echo j; fi)"; then
        new_clean_guild_commands="1"
      else
        new_clean_guild_commands="0"
      fi
      if prompt_yes_no "Worker-Guild-Commands auf Boot bereinigen?" "$(if [[ "$cur_clean_worker_guild_commands" == "0" ]]; then echo n; else echo j; fi)"; then
        new_clean_worker_guild_commands="1"
      else
        new_clean_worker_guild_commands="0"
      fi

      write_env_line "COMMAND_REGISTRATION_MODE" "$new_command_mode"
      if [[ "$new_command_mode" == "global" ]]; then
        write_env_line "SYNC_GUILD_COMMANDS_ON_BOOT" "0"
      else
        write_env_line "SYNC_GUILD_COMMANDS_ON_BOOT" "1"
      fi
      write_env_line "PERIODIC_GUILD_COMMAND_SYNC_MS" "$(format_minutes_to_ms "$new_periodic_sync_minutes")"
      write_env_line "GUILD_COMMAND_SYNC_RETRIES" "$new_guild_sync_retries"
      write_env_line "GUILD_COMMAND_SYNC_RETRY_MS" "$new_guild_sync_retry_ms"
      write_env_line "CLEAN_GLOBAL_COMMANDS_ON_BOOT" "$new_clean_global_commands"
      write_env_line "CLEAN_GUILD_COMMANDS_ON_BOOT" "$new_clean_guild_commands"
      write_env_line "CLEAN_WORKER_GUILD_COMMANDS_ON_BOOT" "$new_clean_worker_guild_commands"
      ok "Slash-Command Konfiguration gespeichert (${new_command_mode})."
      mark_settings_dirty
      ;;
    11)
      echo ""
      info "Betrieb, Logs & Admin-Token"
      new_log_max_mb="$(prompt_default "Maximale bot.log Groesse in MB" "$cur_log_max_mb")"
      if [[ ! "$new_log_max_mb" =~ ^[0-9]+$ ]] || (( new_log_max_mb < 1 )); then
        warn "Ungueltiger Wert fuer LOG_MAX_MB. Verwende 5."
        new_log_max_mb="5"
      fi
      new_log_max_files="$(prompt_default "Maximale Anzahl rotierter Log-Dateien" "$cur_log_max_files")"
      if [[ ! "$new_log_max_files" =~ ^[0-9]+$ ]] || (( new_log_max_files < 1 )); then
        warn "Ungueltiger Wert fuer LOG_MAX_FILES. Verwende 30."
        new_log_max_files="30"
      fi
      new_log_max_days="$(prompt_default "Log-Aufbewahrung in Tagen" "$cur_log_max_days")"
      if [[ ! "$new_log_max_days" =~ ^[0-9]+$ ]] || (( new_log_max_days < 1 )); then
        warn "Ungueltiger Wert fuer LOG_MAX_DAYS. Verwende 14."
        new_log_max_days="14"
      fi
      if prompt_yes_no "Docker Cache automatisch bei Cleanup/Update aufraeumen?" "$(if [[ "$cur_auto_docker_prune" == "0" ]]; then echo n; else echo j; fi)"; then
        new_auto_docker_prune="1"
      else
        new_auto_docker_prune="0"
      fi
      new_docker_prune_until="$(prompt_default "Docker Builder prune until" "$cur_docker_prune_until")"
      new_admin_api_token="$(prompt_default "API Admin Token (ENTER = behalten, '-' = leeren)" "$cur_admin_api_token")"
      if [[ "$new_admin_api_token" == "-" ]]; then
        new_admin_api_token=""
      fi

      write_env_line "LOG_MAX_MB" "$new_log_max_mb"
      write_env_line "LOG_MAX_FILES" "$new_log_max_files"
      write_env_line "LOG_MAX_DAYS" "$new_log_max_days"
      write_env_line "AUTO_DOCKER_PRUNE" "$new_auto_docker_prune"
      write_env_line "DOCKER_BUILDER_PRUNE_UNTIL" "$new_docker_prune_until"
      write_env_line "API_ADMIN_TOKEN" "$new_admin_api_token"
      ok "Betriebs- und Log-Einstellungen gespeichert."
      mark_settings_dirty
      ;;
    12)
      if (( settings_restart_needed == 1 )); then
        info "Fuehre einen einzigen Neustart fuer alle geaenderten Einstellungen aus..."
        restart_container
        settings_restart_needed=0
        settings_changed=0
      else
        info "Keine offenen Neustarts erforderlich."
      fi
      break
      ;;
    13)
      if (( settings_restart_needed == 1 )); then
        warn "Es gibt noch offene Aenderungen ohne Neustart."
      fi
      break
      ;;
    14)
      run_system_doctor || true
      continue
      ;;
    *)
      warn "Ungueltige Auswahl. Bitte 1-14 waehlen."
      continue
      ;;
  esac

  if (( settings_changed == 1 )); then
    info "Du kannst weitere Einstellungen bearbeiten oder mit 12/13 beenden."
  fi
done

if (( settings_restart_needed == 1 )); then
  if prompt_yes_no "Offene Aenderungen erkannt. Jetzt einmal neu starten?" "j"; then
    restart_container
  else
    warn "Aenderungen gespeichert, aber Neustart ausstehend."
  fi
fi

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
for pf in premium.json bot-state.json custom-stations.json command-permissions.json guild-languages.json song-history.json listening-stats.json scheduled-events.json coupons.json dashboard.json; do
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
  -e dashboard.json \
  -e docker-compose.override.yml 2>/dev/null || true

# Laufzeitdaten immer aus dem VOR-Update Snapshot wiederherstellen,
# damit git reset keine produktiven JSON-Daten ueberschreibt.
for pf in premium.json bot-state.json custom-stations.json command-permissions.json guild-languages.json song-history.json listening-stats.json scheduled-events.json coupons.json dashboard.json; do
  snapshot=".update-backups/${pf}.${update_stamp}"
  if [[ -s "$snapshot" ]]; then
    if ! cmp -s "$snapshot" "$pf" 2>/dev/null; then
      cp "$snapshot" "$pf"
      info "${pf} aus Pre-Update Snapshot wiederhergestellt."
    fi
  fi
done

# Sicherheitscheck: Premium-Daten duerfen NICHT leer sein nach Update
for pf in premium.json bot-state.json custom-stations.json command-permissions.json guild-languages.json song-history.json listening-stats.json scheduled-events.json coupons.json dashboard.json; do
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
  compose_build --no-cache || exit 1
else
  compose_build || exit 1
fi
compose_up || exit 1
report_runtime_tools_status

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
echo -e "    Slash Commands:   ${GREEN}./update.sh --settings commands${NC}"
echo -e "    Dashboard OAuth:  ${GREEN}./update.sh --dashboard-settings${NC}"
echo -e "    Doctor Check:     ${GREEN}./update.sh --doctor${NC}"
echo -e "    Status & Logs:    ${GREEN}./update.sh --status${NC}"
echo -e "    Status Quick:     ${GREEN}./update.sh --status quick${NC}"
echo -e "    Speicher cleanup: ${GREEN}./update.sh --cleanup${NC}"
echo -e "    Recognition-Test:${GREEN} ./update.sh --recognition-test <URL>${NC}"
echo -e "    Dieses Menue:     ${GREEN}./update.sh${NC}"
echo ""
