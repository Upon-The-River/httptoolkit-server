param(
  [string]$DeviceId,
  [switch]$AllowUnverifiedHttp
)

$ErrorActionPreference = 'Continue'

function Get-OnlineDevices {
  param([string]$Selected)

  $adbDevicesOutput = (& adb devices 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    throw "adb devices failed: $adbDevicesOutput"
  }

  $rows = $adbDevicesOutput -split "`r?`n" | Select-Object -Skip 1 | Where-Object { $_ -match "\S+\s+\S+" }
  $devices = @()
  foreach ($row in $rows) {
    $parts = ($row -replace "^\s+|\s+$", "") -split "\s+"
    if ($parts.Count -lt 2) { continue }
    if ($parts[1] -eq 'device') {
      $devices += $parts[0]
    }
  }

  if ($Selected) {
    return $devices | Where-Object { $_ -eq $Selected }
  }

  return $devices
}

function Test-IsAdbHelpOutput {
  param([string]$Output)

  if (-not $Output) { return $false }

  return (
    $Output -match 'Android Debug Bridge version' -and
    $Output -match 'global options:' -and
    $Output -match 'general commands:'
  )
}

function Invoke-AdbStep {
  param(
    [string]$DeviceId,
    [string]$Action,
    [string[]]$AdbArgs,
    [switch]$Optional
  )

  if ($null -eq $AdbArgs -or $AdbArgs.Count -eq 0) {
    return [PSCustomObject]@{
      deviceId = $DeviceId
      action = $Action
      command = "adb -s $DeviceId"
      stdout = ''
      stderr = ''
      exitCode = -1
      success = $false
      optional = [bool]$Optional
      error = 'missing-adb-args'
    }
  }

  $output = (& adb -s $DeviceId @AdbArgs 2>&1 | Out-String)
  $exitCode = $LASTEXITCODE
  $trimmedOutput = $output.Trim()
  $isInvalidInvocation = (Test-IsAdbHelpOutput -Output $trimmedOutput) -and ($Action -notmatch '(^|[-_])(adb-version|help)([-_]|$)')

  $errorCode = $null
  if ($isInvalidInvocation) {
    $errorCode = 'invalid-adb-invocation'
  } elseif ($exitCode -ne 0) {
    $errorCode = "adb-exit-$exitCode"
  }

  $success = ($exitCode -eq 0 -and -not $isInvalidInvocation)

  return [PSCustomObject]@{
    deviceId = $DeviceId
    action = $Action
    command = "adb -s $DeviceId $($AdbArgs -join ' ')"
    stdout = $trimmedOutput
    stderr = if ($success) { '' } else { $trimmedOutput }
    exitCode = $exitCode
    success = $success
    optional = [bool]$Optional
    error = $errorCode
  }
}

$devices = Get-OnlineDevices -Selected $DeviceId
if ($devices.Count -eq 0) {
  Write-Error 'No online adb devices found'
  exit 1
}

$steps = @()
foreach ($id in $devices) {
  Write-Host "[device:$id] rescue start"

  $steps += Invoke-AdbStep -DeviceId $id -Action 'deactivate-intent' -AdbArgs @('shell', 'am', 'start', '-a', 'tech.httptoolkit.android.DEACTIVATE', '-p', 'tech.httptoolkit.android.v1')
  $steps += Invoke-AdbStep -DeviceId $id -Action 'force-stop' -AdbArgs @('shell', 'am', 'force-stop', 'tech.httptoolkit.android.v1')
  $steps += Invoke-AdbStep -DeviceId $id -Action 'pm-clear' -AdbArgs @('shell', 'pm', 'clear', 'tech.httptoolkit.android.v1')
  $steps += Invoke-AdbStep -DeviceId $id -Action 'reverse-remove-all' -AdbArgs @('reverse', '--remove-all')

  $steps += Invoke-AdbStep -DeviceId $id -Action 'delete-http-proxy' -AdbArgs @('shell', 'settings', 'delete', 'global', 'http_proxy')
  $steps += Invoke-AdbStep -DeviceId $id -Action 'delete-global-http-proxy-host' -AdbArgs @('shell', 'settings', 'delete', 'global', 'global_http_proxy_host')
  $steps += Invoke-AdbStep -DeviceId $id -Action 'delete-global-http-proxy-port' -AdbArgs @('shell', 'settings', 'delete', 'global', 'global_http_proxy_port')
  $steps += Invoke-AdbStep -DeviceId $id -Action 'delete-global-http-proxy-exclusion' -AdbArgs @('shell', 'settings', 'delete', 'global', 'global_http_proxy_exclusion_list')
  $steps += Invoke-AdbStep -DeviceId $id -Action 'put-http-proxy-zero' -AdbArgs @('shell', 'settings', 'put', 'global', 'http_proxy', ':0')

  $steps += Invoke-AdbStep -DeviceId $id -Action 'put-private-dns-off' -AdbArgs @('shell', 'settings', 'put', 'global', 'private_dns_mode', 'off')
  $steps += Invoke-AdbStep -DeviceId $id -Action 'delete-private-dns-specifier' -AdbArgs @('shell', 'settings', 'delete', 'global', 'private_dns_specifier')
  $steps += Invoke-AdbStep -DeviceId $id -Action 'delete-always-on-vpn-app' -AdbArgs @('shell', 'settings', 'delete', 'secure', 'always_on_vpn_app')
  $steps += Invoke-AdbStep -DeviceId $id -Action 'put-lockdown-vpn-zero' -AdbArgs @('shell', 'settings', 'put', 'secure', 'lockdown_vpn', '0')

  $steps += Invoke-AdbStep -DeviceId $id -Action 'airplane-mode-enable' -AdbArgs @('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable')
  Start-Sleep -Seconds 3
  $steps += Invoke-AdbStep -DeviceId $id -Action 'airplane-mode-disable' -AdbArgs @('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable')
  $steps += Invoke-AdbStep -DeviceId $id -Action 'wifi-disable' -AdbArgs @('shell', 'svc', 'wifi', 'disable')
  Start-Sleep -Seconds 3
  $steps += Invoke-AdbStep -DeviceId $id -Action 'wifi-enable' -AdbArgs @('shell', 'svc', 'wifi', 'enable')

  $steps += Invoke-AdbStep -DeviceId $id -Action 'dumpsys-connectivity' -AdbArgs @('shell', 'dumpsys', 'connectivity') -Optional
  $steps += Invoke-AdbStep -DeviceId $id -Action 'dumpsys-vpn' -AdbArgs @('shell', 'dumpsys', 'vpn') -Optional
}

$doctorOutput = (& "$PSScriptRoot/doctor-phone-network.ps1" -DeviceId $DeviceId 2>&1 | Out-String)
$doctorExit = $LASTEXITCODE
$doctorReports = @()
$warnings = @()

try {
  $parsedDoctor = $doctorOutput | ConvertFrom-Json
  if ($parsedDoctor -is [System.Array]) {
    $doctorReports = $parsedDoctor
  } elseif ($null -ne $parsedDoctor) {
    $doctorReports = @($parsedDoctor)
  }
} catch {
  $warnings += 'Unable to parse doctor output as JSON'
}

$criticalFailures = $steps | Where-Object { -not $_.success -and -not $_.optional }
$hardRiskStates = @('proxy-residual', 'private-dns-risk', 'vpn-lockdown-risk', 'vpn-active-proxy-dead', 'dns-broken', 'route-broken', 'partial-connectivity', 'http-broken')
$unverifiedStates = @('unknown', 'unknown-safe', 'http-probe-unavailable')
$hardRisks = @($doctorReports | Where-Object { $hardRiskStates -contains $_.pollutionState })
$unverifiedReports = @($doctorReports | Where-Object { $unverifiedStates -contains $_.pollutionState })
$httpProbeUnavailable = ($doctorReports | Where-Object { $_.httpProbeUnavailable -eq $true }).Count -gt 0
$onlyHttpUnverified = $httpProbeUnavailable -and $hardRisks.Count -eq 0
$allowUnverifiedBypass = $AllowUnverifiedHttp -and $onlyHttpUnverified

if ($httpProbeUnavailable) {
  $warnings += 'HTTP probe unavailable from doctor check'
  if (-not $AllowUnverifiedHttp) {
    $warnings += 'Set -AllowUnverifiedHttp to bypass this unverified HTTP status'
  }
}

if ($allowUnverifiedBypass) {
  $warnings += 'HTTP probe unavailable; treating network as unverified-safe because -AllowUnverifiedHttp was provided.'
}

if ($AllowUnverifiedHttp -and $hardRisks.Count -gt 0) {
  $warnings += '-AllowUnverifiedHttp only bypasses unavailable HTTP probe, not actual network risks.'
}

$finalPollutionState = if ($doctorReports.Count -le 1) { $doctorReports[0].pollutionState } else { @($doctorReports | ForEach-Object { $_.pollutionState }) }
$routeBrokenDetected = @($doctorReports | Where-Object { $_.pollutionState -eq 'route-broken' }).Count -gt 0

$doctorSucceeded = $false
if ($hardRisks.Count -gt 0) {
  $doctorSucceeded = $false
} elseif ($httpProbeUnavailable) {
  $doctorSucceeded = $allowUnverifiedBypass
} else {
  $doctorSucceeded = ($doctorExit -eq 0)
}

if ($routeBrokenDetected) {
  $doctorSucceeded = $false
  $warnings += 'Route connectivity failure detected; rescue cannot mark success.'
}

$result = [PSCustomObject]@{
  success = ($criticalFailures.Count -eq 0 -and $doctorSucceeded)
  doctorExitCode = $doctorExit
  criticalFailureCount = $criticalFailures.Count
  hardRiskCount = $hardRisks.Count
  finalPollutionState = $finalPollutionState
  canHttpConnect = if ($doctorReports.Count -le 1) { $doctorReports[0].canHttpConnect } else { @($doctorReports | ForEach-Object { $_.canHttpConnect }) }
  httpProbeUnavailable = $httpProbeUnavailable
  allowUnverifiedHttp = [bool]$AllowUnverifiedHttp
  allowUnverifiedBypass = [bool]$allowUnverifiedBypass
  warnings = $warnings
  hardRisks = $hardRisks
  unverifiedReports = $unverifiedReports
  doctorReports = $doctorReports
  steps = $steps
}

$result | ConvertTo-Json -Depth 8
if ($result.success) { exit 0 }
exit 1
