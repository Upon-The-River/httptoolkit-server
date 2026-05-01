[CmdletBinding()]
param(
    [string]$AddonBaseUrl = 'http://127.0.0.1:45459',
    [string]$BridgeBaseUrl = 'http://127.0.0.1:45458',
    [string]$DeviceId = '23091JEGR04484',
    [int]$ProxyPort = 8000,
    [string]$ExportDir = $(if ($env:HTK_LAB_ADDON_EXPORT_DIR) { $env:HTK_LAB_ADDON_EXPORT_DIR } else { 'C:\Users\Card\Desktop\DataBase\httptoolkit_exports\qidian' }),
    [int]$TimeoutSec = 5,
    [string]$ReportPath,
    [string]$LogPath,
    [bool]$Repair = $true,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/lib/qidian-capture-common.ps1"
Set-QidianCaptureUtf8

if (-not [System.IO.Path]::IsPathRooted($ExportDir)) {
    $ExportDir = (Resolve-Path -LiteralPath $ExportDir -ErrorAction SilentlyContinue)?.Path ?? (Join-Path (Get-Location).Path $ExportDir)
}
New-Item -ItemType Directory -Path $ExportDir -Force | Out-Null
if (-not $ReportPath) { $ReportPath = Join-Path $ExportDir 'repair_report.json' }
if (-not $LogPath) { $LogPath = Join-Path $ExportDir 'repair_actions.log' }

$addonBase = $AddonBaseUrl.TrimEnd('/')
$bridgeBase = $BridgeBaseUrl.TrimEnd('/')

$portsToCheck = @(45456, 45457, 45458, 45459, $ProxyPort) | Select-Object -Unique
$ports = @{}
foreach ($p in $portsToCheck) { $ports["$p"] = Test-QidianPort -Port $p }

$checkedAt = (Get-Date).ToString('o')
$adbOk = $false
try {
    $adbState = (& adb -s $DeviceId get-state 2>$null)
    $adbOk = (($adbState -join "`n") -match 'device')
} catch { $adbOk = $false }

$addonHealthOk = $false
$bridgeHealthOk = $false
$exportStatusOk = $false
$exportStatus = $null
$jsonlPath = Join-Path $ExportDir 'session_hits.jsonl'
$jsonlSizeBytes = if (Test-Path -LiteralPath $jsonlPath) { [int64](Get-Item -LiteralPath $jsonlPath).Length } else { 0 }

try {
    $addonHealth = Invoke-QidianJson -Method GET -Uri "$addonBase/health" -TimeoutSec $TimeoutSec
    $addonHealthOk = ($addonHealth.ok -eq $true)
} catch {}
try {
    $bridgeHealth = Invoke-QidianJson -Method GET -Uri "$bridgeBase/automation/health" -TimeoutSec $TimeoutSec
    $bridgeHealthOk = ($bridgeHealth.success -eq $true)
} catch {}
try {
    $exportStatus = Get-QidianExportStatus -AddonBaseUrl $addonBase -TimeoutSec $TimeoutSec
    $exportStatusOk = $true
    if ($exportStatus.jsonlPath) { $jsonlPath = [string]$exportStatus.jsonlPath }
    if ($null -ne $exportStatus.sizeBytes) { $jsonlSizeBytes = [int64]$exportStatus.sizeBytes }
} catch {}

$proxyPortOpenBefore = [bool]$ports["$ProxyPort"]
$prereqs = @($adbOk, $addonHealthOk, $bridgeHealthOk, $exportStatusOk)
$prereqsHealthy = ($prereqs -notcontains $false)
$repairNeeded = $false
$repairReason = 'none'

if (-not $adbOk) { $repairReason = 'adb-unhealthy' }
elseif (-not $addonHealthOk) { $repairReason = 'addon-unhealthy' }
elseif (-not $bridgeHealthOk) { $repairReason = 'bridge-unhealthy' }
elseif (-not $exportStatusOk) { $repairReason = 'export-unhealthy' }
elseif ($Force.IsPresent -and $prereqsHealthy) { $repairNeeded = $true; $repairReason = 'force-with-healthy-prerequisites' }
elseif (-not $proxyPortOpenBefore) { $repairNeeded = $true; $repairReason = 'proxy-port-closed' }

$result = [ordered]@{
    checkedAt = $checkedAt
    deviceId = $DeviceId
    proxyPort = $ProxyPort
    adbOk = $adbOk
    ports = $ports
    addonHealthOk = $addonHealthOk
    bridgeHealthOk = $bridgeHealthOk
    exportStatusOk = $exportStatusOk
    jsonlPath = $jsonlPath
    jsonlSizeBytes = $jsonlSizeBytes
    proxyPortOpenBefore = $proxyPortOpenBefore
    repairNeeded = $repairNeeded
    repairReason = $repairReason
    repairAttempted = $false
    repairOk = $false
    repairWarning = $null
    repairFailedReason = $null
    startHeadlessResponseSummary = $null
    proxyPortOpenAfter = $proxyPortOpenBefore
    exportStatusAfter = $null
    verdict = $null
}

if ($Repair -and $repairNeeded) {
    $result.repairAttempted = $true
    $startResult = Invoke-QidianStartHeadlessOnce -AddonBaseUrl $addonBase -DeviceId $DeviceId -ProxyPort $ProxyPort -TimeoutSec $TimeoutSec
    $result.startHeadlessResponseSummary = $startResult.responseSummary
    if ($startResult.warning) { $result.repairWarning = $startResult.warning }
    if ($startResult.errorReason) { $result.repairFailedReason = $startResult.errorReason }
}

$result.proxyPortOpenAfter = Test-QidianPort -Port $ProxyPort
try {
    $exportStatusAfter = Get-QidianExportStatus -AddonBaseUrl $addonBase -TimeoutSec $TimeoutSec
    $result.exportStatusAfter = [ordered]@{ ok = $true; sizeBytes = $exportStatusAfter.sizeBytes; jsonlPath = $exportStatusAfter.jsonlPath }
} catch {
    $result.exportStatusAfter = [ordered]@{ ok = $false }
}

if (-not $repairNeeded) {
    if (-not $adbOk) { $result.verdict = 'cannot-repair-adb-unhealthy' }
    elseif (-not $addonHealthOk) { $result.verdict = 'cannot-repair-addon-unhealthy' }
    elseif (-not $bridgeHealthOk) { $result.verdict = 'cannot-repair-bridge-unhealthy' }
    elseif (-not $exportStatusOk) { $result.verdict = 'cannot-repair-export-unhealthy' }
    else { $result.verdict = 'healthy-no-repair-needed' }
} elseif (-not $Repair) {
    $result.verdict = 'repair-attempted-but-proxy-still-closed'
} elseif ($result.repairFailedReason -eq 'official-admin-server-unreachable') {
    $result.verdict = 'cannot-repair-official-admin-unreachable'
} elseif ($result.repairWarning -eq 'eaddrinuse-existing-session-possible') {
    $result.verdict = 'existing-session-possible'
    $result.repairOk = [bool]$result.proxyPortOpenAfter
} elseif ($result.proxyPortOpenAfter) {
    $result.verdict = 'repaired-proxy-activation'
    $result.repairOk = $true
} else {
    $result.verdict = 'repair-attempted-but-proxy-still-closed'
}

$result | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ReportPath -Encoding utf8
Write-QidianRepairLog -LogPath $LogPath -Result $result
Write-Host ("verdict={0} repairNeeded={1} repairAttempted={2} proxyBefore={3} proxyAfter={4}" -f $result.verdict, $result.repairNeeded, $result.repairAttempted, $result.proxyPortOpenBefore, $result.proxyPortOpenAfter)
if ($result.repairFailedReason -eq 'official-admin-server-unreachable') {
    Write-Host 'advice=restart official server to restore admin bridge path (http://127.0.0.1:45456).'
}

if ($result.verdict -in @('healthy-no-repair-needed', 'repaired-proxy-activation', 'existing-session-possible')) { exit 0 }
exit 2
