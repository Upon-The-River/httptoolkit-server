param(
  [string]$BaseUrl = "http://127.0.0.1:45457",
  [string]$DeviceId,
  [switch]$AllowUnsafeStart,
  [switch]$EnableSocks,
  [switch]$WaitForTraffic,
  [switch]$WaitForTargetTraffic
)

$ErrorActionPreference = "Stop"

if (-not $DeviceId) {
  throw "DeviceId is required."
}

$body = @{
  deviceId = $DeviceId
  allowUnsafeStart = [bool]$AllowUnsafeStart
  enableSocks = [bool]$EnableSocks
  waitForTraffic = [bool]$WaitForTraffic
  waitForTargetTraffic = [bool]$WaitForTargetTraffic
}

$result = Invoke-RestMethod -Method Post -Uri "$BaseUrl/automation/android-adb/start-headless" -ContentType "application/json" -Body ($body | ConvertTo-Json -Compress)
$result | ConvertTo-Json -Depth 16
