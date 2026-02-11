#!/usr/bin/env bash
set -euo pipefail

prompt_nonempty() {
  local label="$1"
  local val=""
  while [[ -z "$val" ]]; do
    read -r -p "$label: " val
    val="${val//[$'\t\r\n']}"
  done
  printf "%s" "$val"
}

prompt_yesno() {
  local label="$1"
  while true; do
    read -r -p "$label (y/n): " ans
    ans="${ans,,}"
    if [[ "$ans" == "y" || "$ans" == "yes" ]]; then return 0; fi
    if [[ "$ans" == "n" || "$ans" == "no" ]]; then return 1; fi
  done
}

echo "== Discord Radio Bot Installer (Ubuntu) =="

ensure_sudo() {
  if [[ $EUID -eq 0 ]]; then
    return 0
  fi
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "sudo fehlt. Bitte als root ausführen." >&2
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
  echo "deb [arch=$arch signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
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

token=$(prompt_nonempty "DISCORD_TOKEN")
client_id=$(prompt_nonempty "CLIENT_ID")
guild_id=$(prompt_nonempty "GUILD_ID")

cat > .env <<EOF
DISCORD_TOKEN=$token
CLIENT_ID=$client_id
GUILD_ID=$guild_id
EOF

stations_file="stations.json"

stations_json=""

default_key=""
idx=1

while true; do
  name=$(prompt_nonempty "Station $idx - Name")
  url=$(prompt_nonempty "Station $idx - URL")
  key=$(echo "$name" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')
  if [[ -z "$key" ]]; then key="station$idx"; fi

  if [[ -z "$default_key" ]]; then default_key="$key"; fi

  stations_json+="    \"$key\": { \"name\": \"$name\", \"url\": \"$url\" },\n"

  if ! prompt_yesno "Weitere Station hinzufügen"; then
    break
  fi
  idx=$((idx+1))

done

stations_json=$(printf "%b" "$stations_json")
# remove trailing comma
stations_json=$(echo "$stations_json" | sed '$s/},/}/')

cat > "$stations_file" <<EOF
{
  "defaultStationKey": "$default_key",
  "stations": {
$stations_json
  }
}
EOF

echo "Starte Docker Compose..."
$DOCKER compose up -d --build

echo "Installiere Autostart (systemd)..."
$SUDO bash ./install-systemd.sh

echo "Fertig. Bot läuft in Docker und startet automatisch mit dem System."
