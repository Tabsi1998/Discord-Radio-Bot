param(
  [string]$StationsFile = "stations.json",
  [string]$EnvFile = ".env"
)

function Prompt-NonEmpty($label) {
  while ($true) {
    $val = Read-Host $label
    if ($val -and $val.Trim().Length -gt 0) { return $val.Trim() }
  }
}

function Prompt-YesNo($label) {
  while ($true) {
    $val = (Read-Host $label).Trim().ToLower()
    if ($val -in @("y","yes")) { return $true }
    if ($val -in @("n","no")) { return $false }
  }
}

Write-Host "== Discord Radio Bot Installer =="

$token = Prompt-NonEmpty "DISCORD_TOKEN"
$clientId = Prompt-NonEmpty "CLIENT_ID"
$guildId = Prompt-NonEmpty "GUILD_ID"

@"
DISCORD_TOKEN=$token
CLIENT_ID=$clientId
GUILD_ID=$guildId
"@ | Set-Content -Encoding UTF8 $EnvFile

$stations = @{}
$defaultKey = $null

$idx = 1
while ($true) {
  $name = Prompt-NonEmpty "Station $idx - Name"
  $url = Prompt-NonEmpty "Station $idx - URL"
  $key = ($name.ToLower() -replace '[^a-z0-9]','')
  if (-not $key) { $key = "station$idx" }

  $stations[$key] = @{ name = $name; url = $url }

  if (-not $defaultKey) { $defaultKey = $key }

  $more = Prompt-YesNo "Weitere Station hinzufügen? (y/n)"
  if (-not $more) { break }
  $idx++
}

$stationsObj = @{
  defaultStationKey = $defaultKey
  stations = $stations
}

$stationsObj | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $StationsFile

Write-Host "Starte Docker Compose..."
& docker compose up -d --build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "Fertig. Bot läuft in Docker."
