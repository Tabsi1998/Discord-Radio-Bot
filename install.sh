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

write_env_line() {
  local key="$1"
  local value="$2"
  value="${value//$'\r'/}"
  value="${value//$'\n'/}"
  printf '%s=%s\n' "$key" "$value" >> .env
}

echo "== Discord Radio Bot Installer (Ubuntu/Linux) =="

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
  echo "Installiere Docker..."
  $SUDO apt-get update
  $SUDO apt-get install -y ca-certificates curl gnupg
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

  local arch
  arch="$(dpkg --print-architecture)"
  echo "deb [arch=$arch signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
    $SUDO tee /etc/apt/sources.list.d/docker.list >/dev/null

  $SUDO apt-get update
  $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  $SUDO systemctl enable --now docker
}

ensure_sudo

if ! command -v docker >/dev/null 2>&1; then
  install_docker
fi

if ! command -v docker compose >/dev/null 2>&1; then
  echo "docker compose fehlt. Bitte Docker Compose Plugin installieren." >&2
  exit 1
fi

DOCKER="docker"
if ! docker info >/dev/null 2>&1; then
  DOCKER="$SUDO docker"
fi

bot_count="$(prompt_int_range "Wie viele Bot-Accounts willst du konfigurieren" "4" 1 8)"
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
  echo "--- Bot $i ---"
  name="$(prompt_default "BOT_${i}_NAME" "Radio Bot $i")"
  token="$(prompt_nonempty "BOT_${i}_TOKEN")"
  client_id="$(prompt_nonempty "BOT_${i}_CLIENT_ID")"
  perms="$(prompt_default "BOT_${i}_PERMISSIONS (leer = Discord Standard)" "")"

  write_env_line "BOT_${i}_NAME" "$name"
  write_env_line "BOT_${i}_TOKEN" "$token"
  write_env_line "BOT_${i}_CLIENT_ID" "$client_id"
  write_env_line "BOT_${i}_PERMISSIONS" "$perms"

done

if [[ ! -f stations.json ]]; then
  cat > stations.json <<'EOF'
{
  "defaultStationKey": null,
  "stations": {},
  "qualityPreset": "custom",
  "locked": false,
  "fallbackKeys": []
}
EOF
fi

mkdir -p logs

echo "Starte Docker Compose..."
$DOCKER compose up -d --build

echo "Installiere Autostart (systemd)..."
$SUDO bash ./install-systemd.sh

echo ""
echo "Fertig."
echo "Webseite: http://<server-ip>:$web_port"
if [[ -n "$public_url" ]]; then
  echo "Public URL (gesetzt): $public_url"
fi
echo ""
echo "Stationsverwaltung (gefuhrt):"
echo "  bash ./stations.sh"
echo "Oder direkt:"
echo "  bash ./stations.sh wizard"
