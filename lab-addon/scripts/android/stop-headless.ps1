param(
  [string]$BaseUrl = "http://127.0.0.1:45457",
  [string]$DeviceId
)

$ErrorActionPreference = "Continue"
$Headers = @{ Origin = "https://app.httptoolkit.tech" }
$apiReachable = $false

try {
  $body = if ($DeviceId) { @{ deviceId = $DeviceId } } else { @{} }
  $result = Invoke-RestMethod -Method Post -Uri "$BaseUrl/automation/android-adb/stop-headless" -Headers $Headers -ContentType "application/json" -Body ($body | ConvertTo-Json -Compress)
  $apiReachable = $true
  $result | ConvertTo-Json -Depth 12

  if ($result.success -eq $true -and $result.networkRiskCleared -eq $true) {
    exit 0
  }

  if ($result.success -eq $false -and $result.networkRiskCleared -eq $true) {
    Write-Warning "stop-headless overall failure, but phone network risk appears cleared"
    exit 1
  }

  if ($result.networkRiskCleared -eq $false) {
    Write-Error "stop-headless did not clear phone network risk"
    exit 1
  }

  exit 1
} catch {
  if ($apiReachable) {
    Write-Error "stop-headless API call failed after response handling: $($_.Exception.Message)"
    exit 1
  }

  Write-Warning "stop-headless API unavailable, running local adb rescue-phone-network fallback"
  $fallbackArgs = @()
  if ($DeviceId) { $fallbackArgs += @('-DeviceId', $DeviceId) }
  & "$PSScriptRoot/rescue-phone-network.ps1" @fallbackArgs
  exit $LASTEXITCODE
}
