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
  \"defaultStationKey\": \"$default_key\",
  \"stations\": {
$stations_json
  }
}
EOF

echo "Starte Docker Compose..."
docker compose up -d --build

echo "Fertig. Bot läuft in Docker."
