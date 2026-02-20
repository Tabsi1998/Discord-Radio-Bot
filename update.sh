#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Discord Radio Bot - Unified Management Tool
# ============================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

info()  { echo -e "  ${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "  ${GREEN}[OK]${NC}   $*"; }
warn()  { echo -e "  ${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "  ${RED}[FAIL]${NC} $*"; }

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
cd "$APP_DIR"

REMOTE="${UPDATE_REMOTE:-origin}"
BRANCH="${UPDATE_BRANCH:-main}"

PRESERVE_FILES=( ".env" "stations.json" "premium.json" "bot-state.json" "docker-compose.override.yml" )

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

write_env_line() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
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
  echo ""
  echo -e "  ${DIM}Tier-Optionen:${NC}"
  echo -e "    ${GREEN}free${NC}     = Jeder kann einladen (Standard)"
  echo -e "    ${YELLOW}pro${NC}      = Nur Pro-Abonnenten"
  echo -e "    ${CYAN}ultimate${NC} = Nur Ultimate-Abonnenten"
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

restart_container() {
  echo ""
  if prompt_yes_no "Container jetzt neu starten (noetig fuer Aenderungen)?" "j"; then
    info "Starte Container neu..."
    docker compose up -d --build --remove-orphans 2>&1 | tail -3
    ok "Container neu gestartet."
  else
    warn "Nicht vergessen: ${BOLD}docker compose up -d --build${NC} ausfuehren!"
  fi
}

# ============================================================
# Header
# ============================================================

echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║                                              ║"
echo "  ║   Discord Radio Bot - Management & Settings  ║"
echo "  ║                                              ║"
echo "  ╚══════════════════════════════════════════════╝"
echo -e "${NC}"

require_cmd git
require_cmd docker
if ! command -v docker compose >/dev/null 2>&1; then
  fail "docker compose fehlt."
  exit 1
fi

# ============================================================
# Mode selection
# ============================================================

MODE="${1:-}"

if [[ -z "$MODE" ]]; then
  echo -e "  ${BOLD}Was moechtest du tun?${NC}"
  echo ""
  echo -e "    ${GREEN}1${NC})  Update           - Code aktualisieren & Container rebuild"
  echo -e "    ${CYAN}2${NC})  Bots verwalten    - Anzeigen, hinzufuegen, bearbeiten, entfernen"
  echo -e "    ${YELLOW}3${NC})  Stripe einrichten - Zahlungs-API konfigurieren"
  echo -e "    ${BOLD}4${NC})  Premium verwalten - Lizenzen aktivieren/entfernen"
  echo -e "    ${DIM}5${NC})  Einstellungen     - Port, Domain und mehr"
  echo -e "    ${DIM}6${NC})  Status & Logs     - Container-Status pruefen"
  echo ""
  read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Auswahl [1-6]${NC}: ")" MODE_CHOICE
  case "$MODE_CHOICE" in
    1) MODE="--update" ;;
    2) MODE="--bots" ;;
    3) MODE="--stripe" ;;
    4) MODE="--premium" ;;
    5) MODE="--settings" ;;
    6) MODE="--status" ;;
    *) MODE="--update" ;;
  esac
fi

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
  docker compose logs --tail=20 radio-bot 2>/dev/null || warn "Keine Logs verfuegbar."
  echo ""
  echo -e "  ${DIM}Tipp: Fuer Live-Logs: docker compose logs -f radio-bot${NC}"
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

  # Aktuellen Status anzeigen
  cur_key=$(grep "^STRIPE_SECRET_KEY=" .env 2>/dev/null | cut -d= -f2- || echo "")
  cur_pub=$(grep "^STRIPE_PUBLIC_KEY=" .env 2>/dev/null | cut -d= -f2- || echo "")
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

  case "$STRIPE_CHOICE" in
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
    4)
      exit 0
      ;;
    *)
      fail "Ungueltige Auswahl."
      exit 1
      ;;
  esac

  # WICHTIG: docker compose up -d (NICHT restart!) damit .env neu geladen wird
  restart_container
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

  cur_port=$(grep "^WEB_PORT=" .env 2>/dev/null | cut -d= -f2- || echo "8081")
  cur_iport=$(grep "^WEB_INTERNAL_PORT=" .env 2>/dev/null | cut -d= -f2- || echo "8080")
  cur_domain=$(grep "^WEB_DOMAIN=" .env 2>/dev/null | cut -d= -f2- || echo "nicht gesetzt")
  bot_count=$(count_bots)
  cur_stripe=$(grep "^STRIPE_SECRET_KEY=" .env 2>/dev/null | cut -d= -f2- || echo "")

  echo -e "  Web-Port (extern):     ${CYAN}${cur_port}${NC}"
  echo -e "  Web-Port (intern):     ${DIM}${cur_iport}${NC}"
  echo -e "  Domain:                ${CYAN}${cur_domain}${NC}"
  echo -e "  Bots konfiguriert:     ${CYAN}${bot_count}${NC}"
  if [[ -n "$cur_stripe" ]]; then
    echo -e "  Stripe:                ${GREEN}konfiguriert${NC}"
  else
    echo -e "  Stripe:                ${RED}nicht konfiguriert${NC}"
  fi
  echo ""

  echo -e "  ${BOLD}Was aendern?${NC}"
  echo -e "    ${GREEN}1${NC}) Web-Port (extern)"
  echo -e "    ${CYAN}2${NC}) Domain"
  echo -e "    ${DIM}3${NC}) Zurueck"
  echo ""
  read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Auswahl [1-3]${NC}: ")" SET_CHOICE

  case "$SET_CHOICE" in
    1)
      new_port="$(prompt_default "Neuer externer Port" "$cur_port")"
      write_env_line "WEB_PORT" "$new_port"
      ok "Port geaendert: ${new_port}"
      restart_container
      ;;
    2)
      new_domain="$(prompt_optional "Domain (z.B. radiobot.example.com)")"
      if [[ -n "$new_domain" ]]; then
        write_env_line "WEB_DOMAIN" "$new_domain"
        ok "Domain gespeichert: ${new_domain}"
      fi
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
  if docker compose ps --services --filter status=running 2>/dev/null | grep -q "radio-bot"; then
    docker compose exec radio-bot node src/premium-cli.js wizard
  else
    warn "Container nicht aktiv."
    echo ""
    if prompt_yes_no "Container jetzt starten?" "j"; then
      docker compose up -d --build --remove-orphans
      sleep 3
      docker compose exec radio-bot node src/premium-cli.js wizard
    else
      echo -e "  ${DIM}Starte manuell: docker compose up -d${NC}"
    fi
  fi
  exit $?
fi

# ============================================================
# MODE: Bots verwalten (Submenu)
# ============================================================
if [[ "$MODE" == "--bots" || "$MODE" == "--show-bots" || "$MODE" == "--add-bot" || "$MODE" == "--edit-bot" ]]; then

  # Sub-menu wenn kein spezifischer Modus
  if [[ "$MODE" == "--bots" ]]; then
    bot_count=$(count_bots)
    echo ""
    echo -e "  ${BOLD}Bot-Verwaltung${NC} (${bot_count} Bots konfiguriert)"
    echo "  ────────────────────────────────────"
    echo ""
    echo -e "    ${CYAN}1${NC}) Bots anzeigen"
    echo -e "    ${GREEN}2${NC}) Bot hinzufuegen"
    echo -e "    ${YELLOW}3${NC}) Bot bearbeiten (Name, Tier, Token)"
    echo -e "    ${RED}4${NC}) Bot entfernen"
    echo -e "    ${DIM}5${NC}) Zurueck"
    echo ""
    read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Auswahl [1-5]${NC}: ")" BOT_CHOICE
    case "$BOT_CHOICE" in
      1) MODE="--show-bots" ;;
      2) MODE="--add-bot" ;;
      3) MODE="--edit-bot" ;;
      4) MODE="--remove-bot" ;;
      *) exit 0 ;;
    esac
  fi

  # --- Show Bots ---
  if [[ "$MODE" == "--show-bots" ]]; then
    bot_count=$(count_bots)
    echo ""
    echo -e "  ${BOLD}Konfigurierte Bots (${bot_count}):${NC}"
    echo ""
    for i in $(seq 1 "$bot_count"); do
      name=$(grep "^BOT_${i}_NAME=" .env 2>/dev/null | cut -d= -f2- || echo "Bot ${i}")
      cid=$(grep "^BOT_${i}_CLIENT_ID=" .env 2>/dev/null | cut -d= -f2- || echo "?")
      tier=$(grep "^BOT_${i}_TIER=" .env 2>/dev/null | cut -d= -f2- || echo "free")
      echo -e "    ${CYAN}${i}.${NC} ${BOLD}${name}${NC} $(tier_badge "$tier")"
      echo -e "       Client ID: ${DIM}${cid}${NC}"
      if [[ "$tier" == "free" ]]; then
        echo -e "       Invite:    ${GREEN}https://discord.com/oauth2/authorize?client_id=${cid}&scope=bot%20applications.commands&permissions=3145728${NC}"
      else
        echo -e "       Invite:    ${DIM}Nur fuer ${tier}-Abonnenten${NC}"
      fi
      echo ""
    done
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

    bot_name="$(prompt_default "Bot Name" "Radio Bot ${new_index}")"
    bot_token="$(prompt_nonempty "Token")"
    bot_client_id="$(prompt_nonempty "Client ID")"
    bot_perms="$(prompt_default "Permissions" "3145728")"
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
      name=$(grep "^BOT_${i}_NAME=" .env 2>/dev/null | cut -d= -f2- || echo "Bot ${i}")
      tier=$(grep "^BOT_${i}_TIER=" .env 2>/dev/null | cut -d= -f2- || echo "free")
      echo -e "    ${CYAN}${i}.${NC} ${name} $(tier_badge "$tier")"
    done
    echo ""

    read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Welchen Bot bearbeiten? [1-${bot_count}]${NC}: ")" EDIT_INDEX
    if [[ ! "$EDIT_INDEX" =~ ^[0-9]+$ ]] || (( EDIT_INDEX < 1 || EDIT_INDEX > bot_count )); then
      fail "Ungueltige Auswahl."
      exit 1
    fi

    cur_name=$(grep "^BOT_${EDIT_INDEX}_NAME=" .env 2>/dev/null | cut -d= -f2- || echo "Bot ${EDIT_INDEX}")
    cur_tier=$(grep "^BOT_${EDIT_INDEX}_TIER=" .env 2>/dev/null | cut -d= -f2- || echo "free")

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

    case "$EDIT_CHOICE" in
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
      name=$(grep "^BOT_${i}_NAME=" .env 2>/dev/null | cut -d= -f2- || echo "Bot ${i}")
      tier=$(grep "^BOT_${i}_TIER=" .env 2>/dev/null | cut -d= -f2- || echo "free")
      echo -e "    ${CYAN}${i}.${NC} ${name} $(tier_badge "$tier")"
    done
    echo ""

    read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Welchen Bot entfernen? [1-${bot_count}]${NC}: ")" RM_INDEX
    if [[ ! "$RM_INDEX" =~ ^[0-9]+$ ]] || (( RM_INDEX < 1 || RM_INDEX > bot_count )); then
      fail "Ungueltige Auswahl."
      exit 1
    fi

    rm_name=$(grep "^BOT_${RM_INDEX}_NAME=" .env 2>/dev/null | cut -d= -f2- || echo "Bot ${RM_INDEX}")
    echo ""
    warn "Bot ${RM_INDEX} (${rm_name}) wird aus der .env entfernt."
    if ! prompt_yes_no "Sicher?" "n"; then
      info "Abgebrochen."
      exit 0
    fi

    # Entferne alle Zeilen fuer diesen Bot
    for field in NAME TOKEN CLIENT_ID PERMISSIONS TIER; do
      sed -i "/^BOT_${RM_INDEX}_${field}=/d" .env 2>/dev/null || true
    done

    # Wenn nicht der letzte Bot: Alle nachfolgenden Bots um eins nach vorne ruecken
    if (( RM_INDEX < bot_count )); then
      for i in $(seq $((RM_INDEX + 1)) "$bot_count"); do
        prev=$((i - 1))
        for field in NAME TOKEN CLIENT_ID PERMISSIONS TIER; do
          val=$(grep "^BOT_${i}_${field}=" .env 2>/dev/null | cut -d= -f2- || echo "")
          if [[ -n "$val" ]]; then
            write_env_line "BOT_${prev}_${field}" "$val"
          fi
          sed -i "/^BOT_${i}_${field}=/d" .env 2>/dev/null || true
        done
      done
    fi

    # BOT_COUNT aktualisieren
    new_count=$((bot_count - 1))
    write_env_line "BOT_COUNT" "$new_count"

    ok "Bot ${rm_name} entfernt. Verbleibend: ${new_count} Bot(s)."
    restart_container
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
  cp .env ".update-backups/.env.$(date +%Y%m%d%H%M%S)"
fi

# Pull latest code
info "Hole neuesten Code von ${REMOTE}/${BRANCH}..."
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
  -e docker-compose.override.yml

if [[ "$old_head" == "$new_head" ]]; then
  info "Keine neuen Commits."
else
  ok "Code aktualisiert: ${old_head:0:8} -> ${new_head:0:8}"
fi

# Container rebuild
echo ""
info "Baue Container neu..."
docker compose build --no-cache 2>&1 | tail -5
docker compose up -d --remove-orphans 2>&1 | tail -3

echo ""
ok "Update abgeschlossen!"
echo ""

# Status anzeigen
bot_count=$(count_bots)
cur_stripe=$(grep "^STRIPE_SECRET_KEY=" .env 2>/dev/null | cut -d= -f2- || echo "")
web_port=$(grep "^WEB_PORT=" .env 2>/dev/null | cut -d= -f2- || echo "8081")

echo -e "  ${BOLD}Zusammenfassung:${NC}"
echo -e "    Bots:      ${CYAN}${bot_count}${NC}"
echo -e "    Stripe:    $(if [[ -n "$cur_stripe" ]]; then echo -e "${GREEN}konfiguriert${NC}"; else echo -e "${RED}nicht gesetzt${NC}"; fi)"
echo -e "    Web:       ${CYAN}http://localhost:${web_port}${NC}"
echo ""
echo -e "  ${BOLD}Befehle:${NC}"
echo -e "    Bots verwalten:   ${GREEN}./update.sh --bots${NC}"
echo -e "    Stripe Setup:     ${GREEN}./update.sh --stripe${NC}"
echo -e "    Premium:          ${GREEN}./update.sh --premium${NC}"
echo -e "    Einstellungen:    ${GREEN}./update.sh --settings${NC}"
echo -e "    Status & Logs:    ${GREEN}./update.sh --status${NC}"
echo -e "    Dieses Menue:     ${GREEN}./update.sh${NC}"
echo ""
