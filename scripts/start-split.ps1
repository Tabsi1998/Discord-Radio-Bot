param(
  [switch]$Build
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $repoRoot ".env"
$composeFile = Join-Path $repoRoot "docker-compose.split.yml"

if (-not (Test-Path $envFile)) {
  throw ".env wurde nicht gefunden: $envFile"
}

if (-not (Test-Path $composeFile)) {
  throw "docker-compose.split.yml wurde nicht gefunden: $composeFile"
}

$envMap = @{}
Get-Content $envFile | ForEach-Object {
  $line = $_.Trim()
  if (-not $line -or $line.StartsWith("#")) { return }
  $parts = $line -split "=", 2
  if ($parts.Count -ne 2) { return }
  $key = $parts[0].Trim()
  $value = $parts[1]
  $envMap[$key] = $value
}

$configuredBots = @()
for ($i = 1; $i -le 20; $i++) {
  $tokenKey = "BOT_${i}_TOKEN"
  $clientIdKey = "BOT_${i}_CLIENT_ID"
  $token = [string]($envMap[$tokenKey])
  $clientId = [string]($envMap[$clientIdKey])
  if (-not [string]::IsNullOrWhiteSpace($token) -and -not [string]::IsNullOrWhiteSpace($clientId)) {
    $configuredBots += $i
  }
}

if ($configuredBots.Count -eq 0) {
  throw "Keine BOT_N Konfiguration in .env gefunden."
}

$commanderIndex = 1
if ($envMap.ContainsKey("COMMANDER_BOT_INDEX")) {
  $parsedCommander = 0
  if ([int]::TryParse([string]$envMap["COMMANDER_BOT_INDEX"], [ref]$parsedCommander) -and $parsedCommander -ge 1) {
    $commanderIndex = $parsedCommander
  }
}

$profiles = @()
foreach ($botIndex in $configuredBots) {
  if ($botIndex -eq $commanderIndex) { continue }
  $profiles += "--profile"
  $profiles += "worker-$botIndex"
}

$command = @("compose", "-f", $composeFile)
$command += $profiles
$command += @("up", "-d")
if ($Build) {
  $command += "--build"
}

Write-Host "Commander-Bot: BOT_$commanderIndex"
$workerNames = ($configuredBots | Where-Object { $_ -ne $commanderIndex } | ForEach-Object { "BOT_$_" }) -join ", "
Write-Host "Worker-Bots: $workerNames"
Write-Host "Starte Split-Setup..."

& docker @command
