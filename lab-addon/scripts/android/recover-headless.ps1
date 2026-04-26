param(
  [string]$BaseUrl = "http://127.0.0.1:45457",
  [string]$DeviceId,
  [switch]$UseAddonServer
)

$ErrorActionPreference = "Stop"

if ($UseAddonServer) {
  $body = if ($DeviceId) { @{ deviceId = $DeviceId } } else { @{} }
  $recover = Invoke-RestMethod -Method Post -Uri "$BaseUrl/headless/recover" -ContentType "application/json" -Body ($body | ConvertTo-Json -Compress)
  $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/headless/health"

  Write-Host "recover result (addon mode):"
  $recover | ConvertTo-Json -Depth 12
  Write-Host "headless health (addon mode):"
  $health | ConvertTo-Json -Depth 12

  if ($recover.ok -eq $true) {
    exit 0
  }

  exit 1
}

$recover = Invoke-RestMethod -Method Post -Uri "$BaseUrl/automation/android-adb/recover-headless" -ContentType "application/json" -Body "{}"
$health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/automation/health"

Write-Host "recover result:"
$recover | ConvertTo-Json -Depth 12
Write-Host "health:"
$health | ConvertTo-Json -Depth 12
