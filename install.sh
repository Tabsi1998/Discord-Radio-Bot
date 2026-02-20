#!/usr/bin/env bash
set -uo pipefail

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

prompt_nonempty() {
  local label="$1"
  local val=""
  while [[ -z "$val" ]]; do
    read -r -p "$(echo -e "${CYAN}?${NC} ${BOLD}${label}${NC}: ")" val
    val="${val//$'\r'/}"
    val="${val//$'\n'/}"
    val="${val//$'\t'/}"
    if [[ -z "$val" ]]; then
      echo -e "  ${RED}Dieses Feld ist erforderlich.${NC}"
    fi
  done
  printf "%s" "$val"
}

prompt_default() {
  local label="$1"
  local def="$2"
  local val
  read -r -p "$(echo -e "${CYAN}?${NC} ${BOLD}${label}${NC} ${DIM}[${def}]${NC}: ")" val
  val="${val//$'\r'/}"
  val="${val//$'\n'/}"
  val="${val//$'\t'/}"
  if [[ -z "$val" ]]; then
    printf "%s" "$def"
  else
    printf "%s" "$val"
  fi
}

prompt_int_range() {
  local label="$1"
  local def="$2"
  local min="$3"
  local max="$4"
  local val
  while true; do
    val="$(prompt_default "$label" "$def")"
    if [[ "$val" =~ ^[0-9]+$ ]] && (( val >= min && val <= max )); then
      printf "%s" "$val"
      return
    fi
    echo -e "  ${RED}Bitte Zahl zwischen $min und $max eingeben.${NC}"
  done
}

prompt_yes_no() {
  local label="$1"
  local def="${2:-j}"
  local val
  read -r -p "$(echo -e "${CYAN}?${NC} ${BOLD}${label}${NC} ${DIM}[${def}]${NC}: ")" val
  val="${val,,}"
  if [[ -z "$val" ]]; then
    val="$def"
  fi
  [[ "$val" == "y" || "$val" == "yes" || "$val" == "j" || "$val" == "ja" ]]
}

write_env_line() {
  local key="$1"
  local value="$2"
  value="${value//$'\r'/}"
  value="${value//$'\n'/}"
  printf '%s=%s\n' "$key" "$value" >> .env
}

validate_token() {
  local token="$1"
  if [[ ${#token} -lt 50 ]]; then
    return 1
  fi
  if [[ ! "$token" =~ \. ]]; then
    return 1
  fi
  return 0
}

validate_client_id() {
  local cid="$1"
  if [[ ! "$cid" =~ ^[0-9]{17,22}$ ]]; then
    return 1
  fi
  return 0
}

clear
echo ""
echo -e "${CYAN}${BOLD}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║                                           ║"
echo "  ║    Discord Radio Bot - Installer v4.0     ║"
echo "  ║    Zero-Lag Audio + Premium System         ║"
echo "  ║                                           ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"
echo ""

ensure_sudo() {
  if [[ $EUID -eq 0 ]]; then
    SUDO=""
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    fail "sudo fehlt. Bitte als root ausfuehren."
    exit 1
  fi
}

install_docker() {
  info "Installiere Docker..."
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq ca-certificates curl gnupg
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg 2>/dev/null
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

  local arch
  arch="$(dpkg --print-architecture)"
  echo "deb [arch=$arch signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
    $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null

  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO systemctl enable --now docker
  ok "Docker installiert."
}

ensure_sudo

# ====================================
# Step 1: Docker pruefen
# ====================================
echo -e "${BOLD}Schritt 1/6: Docker pruefen${NC}"
echo "─────────────────────────────────────"

if ! command -v docker >/dev/null 2>&1; then
  warn "Docker nicht gefunden."
  if prompt_yes_no "Docker jetzt automatisch installieren?" "j"; then
    install_docker
  else
    fail "Docker wird benoetigt. Bitte manuell installieren."
    exit 1
  fi
else
  ok "Docker gefunden: $(docker --version | head -1)"
fi

if ! command -v docker compose >/dev/null 2>&1; then
  fail "docker compose Plugin fehlt."
  echo "  Installiere es mit: sudo apt-get install docker-compose-plugin"
  exit 1
fi
ok "Docker Compose verfuegbar."

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER="$SUDO docker"
fi

echo ""

# ====================================
# Step 2: Bestehende .env pruefen
# ====================================
echo -e "${BOLD}Schritt 2/6: Bot-Konfiguration${NC}"
echo "─────────────────────────────────────"

existing_bots=0
if [[ -f .env ]]; then
  # Count existing bots
  while true; do
    local_n=$((existing_bots + 1))
    if grep -q "^BOT_${local_n}_TOKEN=" .env 2>/dev/null; then
      existing_bots=$local_n
    else
      break
    fi
  done
fi

if [[ $existing_bots -gt 0 ]]; then
  ok "Bestehende Konfiguration gefunden ($existing_bots Bots)."
  if prompt_yes_no "Bestehende .env beibehalten und erweitern?" "j"; then
    echo ""
    if prompt_yes_no "Weitere Bots hinzufuegen?" "n"; then
      add_count="$(prompt_int_range "Wie viele neue Bots hinzufuegen" "1" 1 16)"
      for ((i=1; i<=add_count; i++)); do
        idx=$((existing_bots + i))
        echo ""
        echo -e "${YELLOW}--- Neuer Bot $idx ---${NC}"
        name="$(prompt_default "Name" "Radio Bot $idx")"
        while true; do
          token="$(prompt_nonempty "Token")"
          if validate_token "$token"; then break; fi
          echo -e "  ${RED}Token sieht ungueltig aus (mind. 50 Zeichen mit Punkt). Bitte pruefen.${NC}"
        done
        while true; do
          client_id="$(prompt_nonempty "Client ID")"
          if validate_client_id "$client_id"; then break; fi
          echo -e "  ${RED}Client ID muss 17-22 Ziffern sein. Bitte pruefen.${NC}"
        done
        perms="$(prompt_default "Permissions" "3145728")"
        echo ""
        echo -e "  ${DIM}Bot-Tier bestimmt ob dieser Bot frei oder Premium ist:${NC}"
        echo -e "    ${DIM}free${NC}     = Jeder kann einladen (Standard)"
        echo -e "    ${YELLOW}pro${NC}      = Nur Pro-Abonnenten"
        echo -e "    ${CYAN}ultimate${NC} = Nur Ultimate-Abonnenten"
        bot_tier="$(prompt_default "Tier (free/pro/ultimate)" "free")"
        write_env_line "BOT_${idx}_NAME" "$name"
        write_env_line "BOT_${idx}_TOKEN" "$token"
        write_env_line "BOT_${idx}_CLIENT_ID" "$client_id"
        write_env_line "BOT_${idx}_PERMISSIONS" "${perms:-3145728}"
        write_env_line "BOT_${idx}_TIER" "${bot_tier:-free}"
        ok "Bot $idx konfiguriert (Tier: ${bot_tier:-free})."
      done
    fi
    echo ""
    # Skip to stations
  else
    info "Erstelle neue Konfiguration..."
    cp .env ".env.backup-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || true
    # Fall through to full config
    existing_bots=0
  fi
fi

if [[ $existing_bots -eq 0 ]]; then
  bot_count="$(prompt_int_range "Wie viele Bot-Accounts konfigurieren" "4" 1 20)"
  web_port="$(prompt_int_range "Web-Port" "8081" 1 65535)"
  public_url="$(prompt_default "Oeffentliche URL (optional)" "")"

  if [[ -n "$public_url" ]]; then
    public_url="${public_url%%/}"
  fi

  : > .env
  write_env_line "REGISTER_COMMANDS_ON_BOOT" "1"
  write_env_line "CLEAN_GUILD_COMMANDS_ON_BOOT" "1"
  write_env_line "WEB_PORT" "$web_port"
  write_env_line "WEB_INTERNAL_PORT" "8080"
  write_env_line "WEB_BIND" "0.0.0.0"
  write_env_line "PUBLIC_WEB_URL" "$public_url"

  for ((i=1; i<=bot_count; i++)); do
    echo ""
    echo -e "${YELLOW}--- Bot $i von $bot_count ---${NC}"
    echo -e "${DIM}Erstelle einen Bot unter https://discord.com/developers/applications${NC}"
    echo ""
    name="$(prompt_default "Name" "Radio Bot $i")"

    while true; do
      token="$(prompt_nonempty "Token (aus Bot-Sektion im Dev-Portal)")"
      if validate_token "$token"; then
        ok "Token Format ok."
        break
      fi
      warn "Token sieht ungueltig aus (mind. 50 Zeichen mit Punkt). Nochmal versuchen."
    done

    while true; do
      client_id="$(prompt_nonempty "Client ID (Application ID)")"
      if validate_client_id "$client_id"; then
        ok "Client ID Format ok."
        break
      fi
      warn "Client ID muss 17-22 Ziffern sein. Nochmal versuchen."
    done

    perms="$(prompt_default "Permissions (Standard: 3145728)" "3145728")"

    echo ""
    echo -e "  ${DIM}Bot-Tier bestimmt ob dieser Bot frei oder Premium ist:${NC}"
    echo -e "    ${DIM}free${NC}     = Jeder kann einladen (Standard)"
    echo -e "    ${YELLOW}pro${NC}      = Nur Pro-Abonnenten"
    echo -e "    ${CYAN}ultimate${NC} = Nur Ultimate-Abonnenten"
    bot_tier="$(prompt_default "Tier (free/pro/ultimate)" "free")"

    write_env_line "BOT_${i}_NAME" "$name"
    write_env_line "BOT_${i}_TOKEN" "$token"
    write_env_line "BOT_${i}_CLIENT_ID" "$client_id"
    write_env_line "BOT_${i}_PERMISSIONS" "${perms}"
    write_env_line "BOT_${i}_TIER" "${bot_tier:-free}"
    ok "Bot $i konfiguriert (Tier: ${bot_tier:-free})."
  done
fi

echo ""

# ====================================
# Step 3: Stations
# ====================================
echo -e "${BOLD}Schritt 3/6: Radio-Stationen${NC}"
echo "─────────────────────────────────────"

if [[ ! -f stations.json ]]; then
  info "Erstelle stations.json mit Standard-Stationen..."
  cat > stations.json <<'STATIONS_EOF'
{
  "defaultStationKey": "oneworldradio",
  "qualityPreset": "high",
  "locked": false,
  "fallbackKeys": ["lofi", "pop"],
  "stations": {
    "oneworldradio": {
      "name": "Tomorrowland - One World Radio",
      "url": "https://tomorrowland.my105.ch/oneworldradio.mp3",
      "genre": "Electronic / Festival"
    },
    "lofi": {
      "name": "Lofi Hip Hop Radio",
      "url": "https://streams.ilovemusic.de/iloveradio17.mp3",
      "genre": "Lo-Fi / Chill"
    },
    "classicrock": {
      "name": "Classic Rock Radio",
      "url": "https://streams.ilovemusic.de/iloveradio21.mp3",
      "genre": "Rock / Classic"
    },
    "chillout": {
      "name": "Chillout Lounge",
      "url": "https://streams.ilovemusic.de/iloveradio7.mp3",
      "genre": "Chill / Ambient"
    },
    "dance": {
      "name": "Dance Radio",
      "url": "https://streams.ilovemusic.de/iloveradio2.mp3",
      "genre": "Dance / EDM"
    },
    "hiphop": {
      "name": "Hip Hop Channel",
      "url": "https://streams.ilovemusic.de/iloveradio3.mp3",
      "genre": "Hip Hop / Rap"
    },
    "techno": {
      "name": "Techno Bunker",
      "url": "https://streams.ilovemusic.de/iloveradio12.mp3",
      "genre": "Techno / House"
    },
    "pop": {
      "name": "Pop Hits",
      "url": "https://streams.ilovemusic.de/iloveradio.mp3",
      "genre": "Pop / Charts"
    },
    "rock": {
      "name": "Rock Nation",
      "url": "https://streams.ilovemusic.de/iloveradio4.mp3",
      "genre": "Rock / Alternative"
    },
    "bass": {
      "name": "Bass Boost FM",
      "url": "https://streams.ilovemusic.de/iloveradio16.mp3",
      "genre": "Bass / Dubstep"
    },
    "deutschrap": {
      "name": "Deutsch Rap",
      "url": "https://streams.ilovemusic.de/iloveradio6.mp3",
      "genre": "Deutsch Rap"
    }
  }
}
STATIONS_EOF
  ok "11 Standard-Stationen erstellt."
else
  ok "stations.json vorhanden (wird beibehalten)."
  count=$(python3 -c "import json;d=json.load(open('stations.json'));print(len(d.get('stations',{})))" 2>/dev/null || echo "?")
  info "Stationen: $count"
fi

mkdir -p logs

echo ""

# ====================================
# Step 4: Audio-Qualitaet
# ====================================
echo -e "${BOLD}Schritt 4/6: Audio-Qualitaet${NC}"
echo "─────────────────────────────────────"

if ! grep -q "^TRANSCODE=" .env 2>/dev/null; then
  if prompt_yes_no "Opus-Transcoding aktivieren? (Bessere Qualitaet, braucht mehr CPU)" "j"; then
    write_env_line "TRANSCODE" "1"
    write_env_line "TRANSCODE_MODE" "opus"
    echo ""
    echo -e "  ${CYAN}Qualitaets-Stufen:${NC}"
    echo -e "    ${GREEN}1${NC}) Low    (96k)  - Wenig CPU"
    echo -e "    ${YELLOW}2${NC}) Medium (128k) - Ausgewogen"
    echo -e "    ${CYAN}3${NC}) High   (192k) - Empfohlen"
    echo -e "    ${BOLD}4${NC}) Ultra  (320k) - Maximum"
    echo ""
    quality_choice="$(prompt_default "Qualitaet waehlen" "3")"
    case "$quality_choice" in
      1) write_env_line "OPUS_BITRATE" "96k" ;;
      2) write_env_line "OPUS_BITRATE" "128k" ;;
      4) write_env_line "OPUS_BITRATE" "320k" ;;
      *) write_env_line "OPUS_BITRATE" "192k" ;;
    esac
    ok "Opus-Transcoding konfiguriert."
  else
    info "Transcoding deaktiviert (Standard-Qualitaet)."
  fi
else
  ok "Audio-Einstellungen bereits konfiguriert."
fi

echo ""

# ====================================
# Step 5: Premium / Stripe (Optional)
# ====================================
echo -e "${BOLD}Schritt 5/6: Premium / Stripe (Optional)${NC}"
echo "─────────────────────────────────────"

if ! grep -q "^STRIPE_SECRET_KEY=" .env 2>/dev/null; then
  if prompt_yes_no "Premium-Zahlungen mit Stripe einrichten? (Optional)" "n"; then
    echo ""
    echo -e "  ${CYAN}Erstelle einen Stripe-Account unter https://stripe.com${NC}"
    echo -e "  ${DIM}Du findest deine Keys unter: Dashboard > Developers > API keys${NC}"
    echo ""
    stripe_key="$(prompt_nonempty "Stripe Secret Key (sk_test_... oder sk_live_...)")"
    write_env_line "STRIPE_SECRET_KEY" "$stripe_key"
    stripe_pub="$(prompt_default "Stripe Public Key (pk_test_... optional)" "")"
    if [[ -n "$stripe_pub" ]]; then
      write_env_line "STRIPE_PUBLIC_KEY" "$stripe_pub"
    fi
    ok "Stripe konfiguriert."
  else
    info "Stripe uebersprungen. Kann spaeter mit setup-stripe.sh eingerichtet werden."
  fi
else
  ok "Stripe bereits konfiguriert."
fi

echo ""

# ====================================
# Step 6: Docker starten
# ====================================
echo -e "${BOLD}Schritt 6/6: Docker Compose starten${NC}"
echo "─────────────────────────────────────"

info "Baue und starte Container..."
# Sicherstellen dass gemountete JSON-Dateien VOR Docker-Start existieren
# Docker bind-mount erstellt sonst ein VERZEICHNIS statt einer Datei!
for jf in premium.json bot-state.json custom-stations.json; do
  if [[ -d "$jf" ]]; then rm -rf "$jf" 2>/dev/null || true; fi
done
[[ -f premium.json ]]         || echo '{"licenses":{}}' > premium.json
[[ -f bot-state.json ]]       || echo '{}' > bot-state.json
[[ -f custom-stations.json ]] || echo '{}' > custom-stations.json

$DOCKER compose up -d --build

echo ""
info "Warte auf Health-Check (max 30 Sekunden)..."

web_port="${web_port:-$(grep -E '^WEB_PORT=' .env 2>/dev/null | tail -1 | cut -d= -f2- || echo "8081")}"
health_ok=false

for attempt in 1 2 3 4 5 6; do
  sleep 5
  if command -v curl >/dev/null 2>&1; then
    if curl -fsS --max-time 5 "http://127.0.0.1:${web_port}/api/health" >/dev/null 2>&1; then
      health_ok=true
      break
    fi
  fi
  echo -e "  ${DIM}Versuch $attempt/6 - warte...${NC}"
done

echo ""
if $health_ok; then
  ok "Health-Check bestanden!"
else
  warn "Health-Check nicht bestanden. Das kann normal sein wenn Bot-Tokens noch nicht verifiziert sind."
  echo -e "  ${DIM}Pruefe Logs:  docker compose logs --tail=100 radio-bot${NC}"
fi

# ====================================
# Zusammenfassung
# ====================================
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔═══════════════════════════════════════════╗"
echo "  ║                                           ║"
echo "  ║    Installation abgeschlossen!            ║"
echo "  ║                                           ║"
echo "  ╚═══════════════════════════════════════════╝"
echo -e "${NC}"
echo ""
echo -e "  ${CYAN}Webseite:${NC}           http://<server-ip>:${web_port}"
public_url_display="$(grep -E '^PUBLIC_WEB_URL=' .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
if [[ -n "$public_url_display" ]]; then
  echo -e "  ${CYAN}Public URL:${NC}         ${public_url_display}"
fi
echo ""
echo -e "  ${BOLD}Nuetzliche Befehle:${NC}"
echo -e "    Stationen:        ${GREEN}bash ./stations.sh${NC}"
echo -e "    Bot bearbeiten:   ${GREEN}bash ./update.sh --edit-bot${NC}"
echo -e "    Premium:          ${GREEN}bash ./update.sh --premium${NC}"
echo -e "    Stripe Setup:     ${GREEN}bash ./setup-stripe.sh${NC}"
echo -e "    Update:           ${GREEN}bash ./update.sh${NC}"
echo -e "    Logs:             ${GREEN}docker compose logs -f radio-bot${NC}"
echo -e "    Status:           ${GREEN}docker compose ps${NC}"
echo -e "    Neustart:         ${GREEN}docker compose restart${NC}"
echo ""
