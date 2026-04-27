param(
  [switch]$UseAddonServer,
  [string]$AddonServerBaseUrl = 'http://127.0.0.1:45457',
  [string]$DeviceId,
  [switch]$DryRun,
  [switch]$Execute,
  [switch]$ClearHttpProxy,
  [switch]$ClearPrivateDns,
  [switch]$ClearAlwaysOnVpn
)

$ErrorActionPreference = 'Stop'

if (-not $UseAddonServer) {
  throw 'This script currently supports addon-server mode only. Pass -UseAddonServer.'
}

$endpoint = "$AddonServerBaseUrl/android/network/rescue"
$effectiveDryRun = $true
if ($Execute) {
  $effectiveDryRun = $false
}
if ($DryRun) {
  $effectiveDryRun = $true
}

$payload = @{
  dryRun = $effectiveDryRun
}

if ($DeviceId) {
  $payload.deviceId = $DeviceId
}

if ($ClearHttpProxy.IsPresent) {
  $payload.clearHttpProxy = $true
}

if ($ClearPrivateDns.IsPresent) {
  $payload.clearPrivateDns = $true
}

if ($ClearAlwaysOnVpn.IsPresent) {
  $payload.clearAlwaysOnVpn = $true
}

$body = $payload | ConvertTo-Json -Depth 8
$result = Invoke-RestMethod -Method Post -Uri $endpoint -ContentType 'application/json' -Body $body

$result | ConvertTo-Json -Depth 12
