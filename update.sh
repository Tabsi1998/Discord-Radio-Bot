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
  # stations.json nur erstellen wenn komplett fehlend
  if [[ -d "stations.json" ]]; then
    rm -rf "stations.json" 2>/dev/null || true
  fi
  if [[ ! -f "stations.json" ]]; then
    echo '{"defaultStationKey":null,"stations":{},"qualityPreset":"custom"}' > stations.json
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
  echo -e "    ${DIM}5${NC})  E-Mail (SMTP)     - E-Mail-Versand konfigurieren"
  echo -e "    ${DIM}6${NC})  Einstellungen     - Port, Domain und mehr"
  echo -e "    ${DIM}7${NC})  Status & Logs     - Container-Status pruefen"
  echo ""
  read -rp "$(echo -e "  ${CYAN}?${NC} ${BOLD}Auswahl [1-7]${NC}: ")" MODE_CHOICE
  case "${MODE_CHOICE:-}" in
    1) MODE="--update" ;;
    2) MODE="--bots" ;;
    3) MODE="--stripe" ;;
    4) MODE="--premium" ;;
    5) MODE="--email" ;;
    6) MODE="--settings" ;;
    7) MODE="--status" ;;
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
  docker compose logs --tail=20 omnifm 2>/dev/null || warn "Keine Logs verfuegbar."
  echo ""
  echo -e "  ${DIM}Tipp: Fuer Live-Logs: docker compose logs -f omnifm${NC}"
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
  cur_tls_verify=$(read_env "SMTP_TLS_REJECT_UNAUTHORIZED" "0")

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
      tls_verify="$(prompt_default "TLS Zertifikat pruefen? (1=ja, 0=nein)" "${cur_tls_verify:-0}")"
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
        const rejectUnauthorized = String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || '0') === '1';
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
  bot_count=$(count_bots)
  cur_stripe=$(read_env "STRIPE_SECRET_KEY")

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

  case "${SET_CHOICE:-}" in
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
# MODE: Bots verwalten (Submenu)
# ============================================================
if [[ "$MODE" == "--bots" || "$MODE" == "--show-bots" || "$MODE" == "--add-bot" || "$MODE" == "--edit-bot" || "$MODE" == "--remove-bot" ]]; then

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
    case "${BOT_CHOICE:-}" in
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
    if [[ "$bot_count" -eq 0 ]]; then
      warn "Keine Bots konfiguriert. Fuege einen hinzu: ./update.sh --add-bot"
    else
      for i in $(seq 1 "$bot_count"); do
        name=$(read_env "BOT_${i}_NAME" "Bot ${i}")
        cid=$(read_env "BOT_${i}_CLIENT_ID" "?")
        tier=$(read_env "BOT_${i}_TIER" "free")
        echo -e "    ${CYAN}${i}.${NC} ${BOLD}${name}${NC} $(tier_badge "$tier")"
        echo -e "       Client ID: ${DIM}${cid}${NC}"
        if [[ "$tier" == "free" ]]; then
          echo -e "       Invite:    ${GREEN}https://discord.com/oauth2/authorize?client_id=${cid}&scope=bot%20applications.commands&permissions=3145728${NC}"
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
  -e custom-stations.json \
  -e docker-compose.override.yml 2>/dev/null || true

if [[ "$old_head" == "$new_head" ]]; then
  info "Keine neuen Commits."
else
  ok "Code aktualisiert: ${old_head:0:8} -> ${new_head:0:8}"
fi

# JSON-Dateien sicherstellen
echo ""
ensure_all_json_files

# Container rebuild
info "Baue Container neu..."
docker compose build --no-cache 2>&1 | tail -5
docker compose up -d --remove-orphans 2>&1 | tail -3

echo ""
ok "Update abgeschlossen!"
echo ""

# Zusammenfassung
bot_count=$(count_bots)
cur_stripe=$(read_env "STRIPE_SECRET_KEY")
web_port=$(read_env "WEB_PORT" "8081")

echo -e "  ${BOLD}Zusammenfassung:${NC}"
echo -e "    Bots:      ${CYAN}${bot_count}${NC}"
echo -e "    Stripe:    $(if [[ -n "$cur_stripe" ]]; then echo -e "${GREEN}konfiguriert${NC}"; else echo -e "${RED}nicht gesetzt${NC}"; fi)"
echo -e "    Web:       ${CYAN}http://localhost:${web_port}${NC}"
echo ""
echo -e "  ${BOLD}Befehle:${NC}"
echo -e "    Bots verwalten:   ${GREEN}./update.sh --bots${NC}"
echo -e "    Stripe Setup:     ${GREEN}./update.sh --stripe${NC}"
echo -e "    Premium:          ${GREEN}./update.sh --premium${NC}"
echo -e "    E-Mail Setup:     ${GREEN}./update.sh --email${NC}"
echo -e "    Einstellungen:    ${GREEN}./update.sh --settings${NC}"
echo -e "    Status & Logs:    ${GREEN}./update.sh --status${NC}"
echo -e "    Dieses Menue:     ${GREEN}./update.sh${NC}"
echo ""
