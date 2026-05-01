[CmdletBinding()]
param(
  [string]$DeviceId = "23091JEGR04484",
  [int]$ProxyPort = 8000,
  [string]$AddonBaseUrl = "http://127.0.0.1:45457",
  [string]$BridgeBaseUrl = "http://127.0.0.1:45458",
  [switch]$ClearJsonl,
  [switch]$SkipSmoke,
  [switch]$NoWatch,
  [int]$StartupTimeoutSeconds = 45,
  [int]$WatchTimeoutSeconds = 90,
  [int]$PollSeconds = 3,
  [string]$Pattern = "qidian.com|druidv6.if.qidian.com",
  [string]$StatePath = ".\runtime\capture\qidian_capture_state.json",
  [string]$ReportPath = ".\runtime\capture\qidian_capture_report.md",
  [string]$OneClickReportPath = ".\runtime\capture\qidian_oneclick_report.md"
)

$ErrorActionPreference = 'Stop'
$startedAt = (Get-Date).ToString('o')
$exitCode = 0
$fatalError = $null

$labRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $labRoot
. "$PSScriptRoot/lib/qidian-capture-common.ps1"
Set-QidianCaptureUtf8

if (-not [System.IO.Path]::IsPathRooted($StatePath)) { $StatePath = Join-Path $labRoot $StatePath }
if (-not [System.IO.Path]::IsPathRooted($ReportPath)) { $ReportPath = Join-Path $labRoot $ReportPath }
if (-not [System.IO.Path]::IsPathRooted($OneClickReportPath)) { $OneClickReportPath = Join-Path $labRoot $OneClickReportPath }

$captureDir = Split-Path -Parent $OneClickReportPath
New-Item -ItemType Directory -Path $captureDir -Force | Out-Null

$labAddonStartedByOneClick = $false
$labAddonPid = $null
$addonHealthOk = $false
$bridgeHealthOk = $false
$jsonlPath = $null
$exportsRoot = $null
$baselineBytes = $null
$startHeadlessResult = 'not-run'
$watchResult = if ($NoWatch) { 'skipped' } else { 'not-run' }
$sampleTargetUrls = @()

try {
  $adbCmd = Get-Command adb -ErrorAction SilentlyContinue
  if (-not $adbCmd) { throw 'adb command not found in PATH.' }

  $adbList = & adb devices
  if ($LASTEXITCODE -ne 0) { throw 'adb devices failed.' }
  if (-not ($adbList | Where-Object { $_ -match "^$([regex]::Escape($DeviceId))\s+device$" })) {
    throw "Device $DeviceId not in adb 'device' state."
  }

  try {
    $addonHealth = Invoke-QidianJson -Method GET -Uri ("{0}/health" -f $AddonBaseUrl.TrimEnd('/'))
    $addonHealthOk = [bool]$addonHealth.ok
  }
  catch {
    $stdoutLog = Join-Path $captureDir 'lab_addon_server.stdout.log'
    $stderrLog = Join-Path $captureDir 'lab_addon_server.stderr.log'
    $serverProcess = Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $labRoot 'scripts/runtime/run-server.ps1')) -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
    $labAddonStartedByOneClick = $true
    $labAddonPid = $serverProcess.Id
  }

  $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $addonHealth = Invoke-QidianJson -Method GET -Uri ("{0}/health" -f $AddonBaseUrl.TrimEnd('/'))
      $addonHealthOk = [bool]$addonHealth.ok
      if ($addonHealthOk) { break }
    }
    catch {}
    Start-Sleep -Seconds 2
  }

  if (-not $addonHealthOk) {
    throw "Addon health check timed out after $StartupTimeoutSeconds seconds. Check runtime/capture/lab_addon_server.stdout.log and runtime/capture/lab_addon_server.stderr.log"
  }

  try {
    $bridgeHealth = Invoke-QidianJson -Method GET -Uri ("{0}/automation/health" -f $BridgeBaseUrl.TrimEnd('/'))
    $bridgeHealthOk = [bool]$bridgeHealth.success
  }
  catch {
    $bridgeHealthOk = $false
  }

  if (-not $bridgeHealthOk) {
    $exitCode = 1
    throw "official Android activation bridge unavailable: $BridgeBaseUrl/automation/health (expected port 45458)."
  }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $labRoot 'scripts/qidian-capture-start.ps1') -AddonBaseUrl $AddonBaseUrl -BridgeBaseUrl $BridgeBaseUrl -DeviceId $DeviceId -ProxyPort $ProxyPort -StatePath $StatePath -ReportPath $ReportPath @($ClearJsonl.IsPresent ? '-ClearJsonl' : @()) @($SkipSmoke.IsPresent ? '-SkipSmoke' : @())
  if ($LASTEXITCODE -ne 0) {
    $startHeadlessResult = "failed($LASTEXITCODE)"
    $exitCode = if ($exitCode -eq 0) { $LASTEXITCODE } else { $exitCode }
    throw "qidian-capture-start.ps1 failed with exit code $LASTEXITCODE"
  }
  $startHeadlessResult = 'ok'

  $status = Get-QidianExportStatus -AddonBaseUrl $AddonBaseUrl
  $jsonlPath = [string]$status.jsonlPath
  $baselineBytes = [int64]$status.sizeBytes
  $exportsRoot = if ($jsonlPath) { Split-Path -Parent $jsonlPath } else { $null }

  Write-Host "AddonBaseUrl: $AddonBaseUrl"
  Write-Host "BridgeBaseUrl: $BridgeBaseUrl"
  Write-Host "DeviceId: $DeviceId"
  Write-Host "jsonlPath: $jsonlPath"
  Write-Host "current sizeBytes: $baselineBytes"
  Write-Host "exportsRoot: $exportsRoot"

  if (-not $NoWatch) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $labRoot 'scripts/qidian-capture-watch.ps1') -StatePath $StatePath -TimeoutSeconds $WatchTimeoutSeconds -PollSeconds $PollSeconds -Pattern $Pattern -ReportPath $ReportPath
    if ($LASTEXITCODE -eq 0) {
      $watchResult = 'ok'
      $watchReport = Get-Content -LiteralPath $ReportPath -Raw -ErrorAction SilentlyContinue
      if ($watchReport) {
        $sampleTargetUrls = @(($watchReport -split "`r?`n") | Where-Object { $_ -match '^\s*-\s+https?://' } | ForEach-Object { $_ -replace '^\s*-\s+', '' } | Select-Object -First 10)
      }
      $exitCode = 0
    }
    else {
      $watchResult = "failed($LASTEXITCODE)"
      $exitCode = 2
      Write-Warning 'watch timeout/no target hit. Open Qidian book detail/catalog/ranking pages to trigger traffic, then rerun watch.'
    }
  }
}
catch {
  $fatalError = $_.Exception.Message
  if ($exitCode -eq 0) { $exitCode = 1 }
}
finally {
  $completedAt = (Get-Date).ToString('o')
  if (-not $jsonlPath) {
    try {
      $status = Get-QidianExportStatus -AddonBaseUrl $AddonBaseUrl
      $jsonlPath = [string]$status.jsonlPath
      $baselineBytes = [int64]$status.sizeBytes
      $exportsRoot = if ($jsonlPath) { Split-Path -Parent $jsonlPath } else { $null }
    }
    catch {}
  }

  $lines = @(
    '# Qidian One-Click Capture Report',
    "- startedAt: $startedAt",
    "- completedAt: $completedAt",
    "- addonBaseUrl: $AddonBaseUrl",
    "- bridgeBaseUrl: $BridgeBaseUrl",
    "- deviceId: $DeviceId",
    "- proxyPort: $ProxyPort",
    "- labAddonStartedByOneClick: $labAddonStartedByOneClick",
    "- labAddonPid: $labAddonPid",
    "- addonHealthOk: $addonHealthOk",
    "- bridgeHealthOk: $bridgeHealthOk",
    "- jsonlPath: $jsonlPath",
    "- exportsRoot: $exportsRoot",
    "- baselineBytes: $baselineBytes",
    "- clearJsonl: $($ClearJsonl.IsPresent)",
    "- startHeadlessResult: $startHeadlessResult",
    "- watchResult: $watchResult"
  )

  if ($sampleTargetUrls.Count -gt 0) {
    $lines += '- sampleTargetUrls:'
    foreach ($url in $sampleTargetUrls) { $lines += "  - $url" }
  }

  if ($fatalError) { $lines += "- error: $fatalError" }

  $lines += @(
    '- recommended Meta args:',
    '  --capture-backend httptoolkit',
    '  --httptoolkit-source exports_file',
    "  --httptoolkit-exports-root \"$exportsRoot\""
  )

  Write-QidianCaptureReport -Path $OneClickReportPath -Lines $lines

  Write-Host ''
  Write-Host '--capture-backend httptoolkit `'
  Write-Host '--httptoolkit-source exports_file `'
  Write-Host "--httptoolkit-exports-root \"$exportsRoot\""

  if ($fatalError) { Write-Error $fatalError }
}

exit $exitCode
