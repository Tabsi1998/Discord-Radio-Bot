#!/usr/bin/env bash
set -euo pipefail

prompt_nonempty() {
  local label="$1"
  local val=""
  while [[ -z "$val" ]]; do
    read -r -p "$label: " val
    val="${val//$'\r'/}"
    val="${val//$'\n'/}"
    val="${val//$'\t'/}"
  done
  printf "%s" "$val"
}

prompt_default() {
  local label="$1"
  local def="$2"
  local val
  read -r -p "$label [$def]: " val
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
    echo "Bitte Zahl zwischen $min und $max eingeben."
  done
}

prompt_yes_no() {
  local label="$1"
  local def="${2:-y}"
  local val
  read -r -p "$label [$def]: " val
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

echo ""
echo "============================================"
echo "  Discord Radio Bot - One-Command Installer"
echo "  v2.1.0"
echo "============================================"
echo ""

ensure_sudo() {
  if [[ $EUID -eq 0 ]]; then
    SUDO=""
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "sudo fehlt. Bitte als root ausfuehren." >&2
    exit 1
  fi
}

install_docker() {
  echo "[1/4] Installiere Docker..."
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
  echo "  Docker installiert."
}

ensure_sudo

# Step 1: Docker
echo "[1/4] Pruefe Docker..."
if ! command -v docker >/dev/null 2>&1; then
  install_docker
else
  echo "  Docker gefunden: $(docker --version)"
fi

if ! command -v docker compose >/dev/null 2>&1; then
  echo "docker compose fehlt. Bitte Docker Compose Plugin installieren." >&2
  exit 1
fi

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER="$SUDO docker"
fi

# Step 2: Bot-Konfiguration
echo ""
echo "[2/4] Bot-Konfiguration"
echo "---"

bot_count="$(prompt_int_range "Wie viele Bot-Accounts willst du konfigurieren" "4" 1 20)"
web_port="$(prompt_int_range "Web-Port fuer Invite-Seite" "8081" 1 65535)"
public_url="$(prompt_default "Oeffentliche URL (optional, z.B. https://bot.deinedomain.tld)" "")"

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
  echo "--- Bot $i von $bot_count ---"
  name="$(prompt_default "BOT_${i}_NAME" "Radio Bot $i")"
  token="$(prompt_nonempty "BOT_${i}_TOKEN")"
  client_id="$(prompt_nonempty "BOT_${i}_CLIENT_ID")"
  perms="$(prompt_default "BOT_${i}_PERMISSIONS (leer = 3145728)" "")"

  write_env_line "BOT_${i}_NAME" "$name"
  write_env_line "BOT_${i}_TOKEN" "$token"
  write_env_line "BOT_${i}_CLIENT_ID" "$client_id"
  write_env_line "BOT_${i}_PERMISSIONS" "${perms:-3145728}"
done

# Step 3: Stations
echo ""
echo "[3/4] Stations-Setup"

if [[ ! -f stations.json ]]; then
  echo "  Erstelle stations.json mit Standard-Stationen..."
  cat > stations.json <<'STATIONS_EOF'
{
  "defaultStationKey": "oneworldradio",
  "qualityPreset": "high",
  "locked": false,
  "fallbackKeys": ["lofi", "pop"],
  "stations": {
    "oneworldradio": {
      "name": "Tomorrowland - One World Radio",
      "url": "https://tomorrowland.my105.ch/oneworldradio.mp3"
    },
    "lofi": {
      "name": "Lofi Hip Hop Radio",
      "url": "https://streams.ilovemusic.de/iloveradio17.mp3"
    },
    "classicrock": {
      "name": "Classic Rock Radio",
      "url": "https://streams.ilovemusic.de/iloveradio21.mp3"
    },
    "chillout": {
      "name": "Chillout Lounge",
      "url": "https://streams.ilovemusic.de/iloveradio7.mp3"
    },
    "dance": {
      "name": "Dance Radio",
      "url": "https://streams.ilovemusic.de/iloveradio2.mp3"
    },
    "hiphop": {
      "name": "Hip Hop Channel",
      "url": "https://streams.ilovemusic.de/iloveradio3.mp3"
    },
    "techno": {
      "name": "Techno Bunker",
      "url": "https://streams.ilovemusic.de/iloveradio12.mp3"
    },
    "pop": {
      "name": "Pop Hits",
      "url": "https://streams.ilovemusic.de/iloveradio.mp3"
    },
    "rock": {
      "name": "Rock Nation",
      "url": "https://streams.ilovemusic.de/iloveradio4.mp3"
    },
    "bass": {
      "name": "Bass Boost FM",
      "url": "https://streams.ilovemusic.de/iloveradio16.mp3"
    },
    "deutschrap": {
      "name": "Deutsch Rap",
      "url": "https://streams.ilovemusic.de/iloveradio6.mp3"
    }
  }
}
STATIONS_EOF
  echo "  11 Standard-Stationen erstellt."
else
  echo "  stations.json existiert bereits (wird beibehalten)."
fi

mkdir -p logs

# Step 4: Docker starten
echo ""
echo "[4/4] Starte Docker Compose..."
$DOCKER compose up -d --build

echo ""
echo "Installiere Autostart (systemd)..."
$SUDO bash ./install-systemd.sh 2>/dev/null || echo "  Systemd-Setup uebersprungen (kein systemd oder Rechte fehlen)."

echo ""
echo "============================================"
echo "  Installation abgeschlossen!"
echo "============================================"
echo ""
echo "  Webseite:  http://<server-ip>:$web_port"
if [[ -n "$public_url" ]]; then
  echo "  Public URL: $public_url"
fi
echo ""
echo "  Stationen verwalten:  bash ./stations.sh"
echo "  Update:               bash ./update.sh"
echo "  Logs:                 docker compose logs -f radio-bot"
echo "  Status:               docker compose ps"
echo ""
