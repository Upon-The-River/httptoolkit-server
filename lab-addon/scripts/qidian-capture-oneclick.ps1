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
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
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
$serverStdoutLog = Join-Path $captureDir 'lab_addon_server.stdout.log'
$serverStderrLog = Join-Path $captureDir 'lab_addon_server.stderr.log'

$labAddonStartedByOneClick = $false
$labAddonPid = $null
$addonHealthOk = $false
$bridgeHealthOk = $false
$jsonlPath = $null
$exportsRoot = $null
$baselineBytes = $null
$startResult = 'not-run'
$watchResult = if ($NoWatch) { 'skipped' } else { 'not-run' }
$failureReason = $null

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
    $runServerScript = Join-Path $labRoot 'scripts/runtime/run-server.ps1'
    $serverProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$runServerScript) -RedirectStandardOutput $serverStdoutLog -RedirectStandardError $serverStderrLog -PassThru -WindowStyle Minimized
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
    $failureReason = "Addon health check timed out after $StartupTimeoutSeconds seconds."
    Write-Host "Check logs: $serverStdoutLog"
    Write-Host "Check logs: $serverStderrLog"
    $exitCode = 1
    throw $failureReason
  }

  try {
    $bridgeHealth = Invoke-QidianJson -Method GET -Uri ("{0}/automation/health" -f $BridgeBaseUrl.TrimEnd('/'))
    $bridgeHealthOk = [bool]$bridgeHealth.success
  }
  catch {
    $bridgeHealthOk = $false
  }

  if (-not $bridgeHealthOk) {
    $failureReason = "official Android activation bridge unavailable at $BridgeBaseUrl/automation/health (expected 45458)."
    $exitCode = 1
    throw $failureReason
  }

  $startScript = Join-Path $labRoot 'scripts/qidian-capture-start.ps1'
  $startArgs = @('-AddonBaseUrl',$AddonBaseUrl,'-BridgeBaseUrl',$BridgeBaseUrl,'-DeviceId',$DeviceId,'-ProxyPort',"$ProxyPort",'-StatePath',$StatePath,'-ReportPath',$ReportPath)
  if ($ClearJsonl.IsPresent) { $startArgs += '-ClearJsonl' }
  if ($SkipSmoke.IsPresent) { $startArgs += '-SkipSmoke' }

  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $startScript @startArgs
  if ($LASTEXITCODE -ne 0) {
    $startResult = "failed($LASTEXITCODE)"
    $failureReason = "qidian-capture-start.ps1 failed with exit code $LASTEXITCODE"
    $exitCode = 1
    throw $failureReason
  }
  $startResult = 'ok'

  $status = Get-QidianExportStatus -AddonBaseUrl $AddonBaseUrl
  $jsonlPath = [string]$status.jsonlPath
  $baselineBytes = [int64]$status.sizeBytes
  $exportsRoot = if ($jsonlPath) { Split-Path -Parent $jsonlPath } else { $null }

  Write-Host "jsonlPath: $jsonlPath"
  Write-Host "exportsRoot: $exportsRoot"

  if (-not $NoWatch) {
    $watchScript = Join-Path $labRoot 'scripts/qidian-capture-watch.ps1'
    $watchArgs = @('-StatePath',$StatePath,'-TimeoutSeconds',"$WatchTimeoutSeconds",'-PollSeconds',"$PollSeconds",'-Pattern',$Pattern,'-ReportPath',$ReportPath)
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $watchScript @watchArgs
    if ($LASTEXITCODE -eq 0) {
      $watchResult = 'ok'
      $exitCode = 0
    }
    else {
      $watchResult = "failed($LASTEXITCODE)"
      $failureReason = 'watch timeout/no target hit'
      $exitCode = 2
      Write-Warning 'Open Qidian app book detail/catalog/ranking pages to trigger traffic, then rerun watch.'
    }
  }
}
catch {
  if (-not $failureReason) { $failureReason = $_.Exception.Message }
  $fatalError = $failureReason
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
    "- startResult: $startResult",
    "- watchResult: $watchResult",
    "- failureReason: $failureReason",
    "- serverStdoutLog: $serverStdoutLog",
    "- serverStderrLog: $serverStderrLog",
    '- recommended Meta args:',
    '  --capture-backend httptoolkit `',
    '  --httptoolkit-source exports_file `',
    ('  --httptoolkit-exports-root "' + $exportsRoot + '"')
  )

  Write-QidianCaptureReport -Path $OneClickReportPath -Lines $lines

  Write-Host ''
  Write-Host '--capture-backend httptoolkit `'
  Write-Host '--httptoolkit-source exports_file `'
  Write-Host ('--httptoolkit-exports-root "' + $exportsRoot + '"')

  if ($fatalError) { Write-Error $fatalError }
}

exit $exitCode
