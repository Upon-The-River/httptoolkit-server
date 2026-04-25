param(
  [string]$BaseUrl = "http://127.0.0.1:45457"
)

$ErrorActionPreference = "Stop"

$recover = Invoke-RestMethod -Method Post -Uri "$BaseUrl/automation/android-adb/recover-headless" -ContentType "application/json" -Body "{}"
$health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/automation/health"

Write-Host "recover result:"
$recover | ConvertTo-Json -Depth 12
Write-Host "health:"
$health | ConvertTo-Json -Depth 12
