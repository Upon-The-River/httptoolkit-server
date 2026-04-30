[CmdletBinding()]
param(
    [string]$AddonBaseUrl = 'http://127.0.0.1:45459',
    [string]$BridgeBaseUrl = 'http://127.0.0.1:45458',
    [string]$DeviceId = '23091JEGR04484',
    [int]$ProxyPort = 8000,
    [switch]$ClearJsonl,
    [switch]$SkipSmoke,
    [string]$StatePath = '.\runtime\capture\qidian_capture_state.json',
    [string]$ReportPath = '.\runtime\capture\qidian_capture_report.md'
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/lib/qidian-capture-common.ps1"
Set-QidianCaptureUtf8

$labRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $labRoot

$adbList = & adb devices
if ($LASTEXITCODE -ne 0) { throw 'adb devices failed.' }
if (-not ($adbList | Where-Object { $_ -match "^$([regex]::Escape($DeviceId))\s+device$" })) { throw "Device $DeviceId not in adb 'device' state." }

foreach ($port in 45456,45457,45458,45459) { if (-not (Test-QidianPort -Port $port)) { throw "Required port not reachable: $port" } }

$addonHealth = Invoke-QidianJson -Method GET -Uri ("{0}/health" -f $AddonBaseUrl.TrimEnd('/'))
$bridgeHealth = Invoke-QidianJson -Method GET -Uri ("{0}/automation/health" -f $BridgeBaseUrl.TrimEnd('/'))

if (-not $SkipSmoke) {
    powershell -ExecutionPolicy Bypass -File .\scripts\validate-lab-addon.ps1 -AddonBaseUrl $AddonBaseUrl -SkipNpm -IncludeAndroid -DeviceId $DeviceId -PersistExportTest -ReportPath '.\runtime\validation\addon-android-smoke-45459.md' -WriteMarkdownReport
}

$status = Get-QidianExportStatus -AddonBaseUrl $AddonBaseUrl
$jsonlPath = $status.jsonlPath
if ($ClearJsonl -and (Test-Path -LiteralPath $jsonlPath)) {
    Set-Content -LiteralPath $jsonlPath -Value '' -Encoding utf8
    $status = Get-QidianExportStatus -AddonBaseUrl $AddonBaseUrl
}
$baselineBytes = [int64]$status.sizeBytes
$startedAt = (Get-Date).ToString('o')

$state = [ordered]@{ schemaVersion=1; startedAt=$startedAt; addonBaseUrl=$AddonBaseUrl; bridgeBaseUrl=$BridgeBaseUrl; deviceId=$DeviceId; proxyPort=$ProxyPort; jsonlPath=$jsonlPath; baselineBytes=$baselineBytes; startHeadlessOk=$false; startHeadlessWarning=$null; startHeadlessError=$null; controlPlaneSuccess=$null; sessionActive=$null; effectiveProxyPort=$null; proxySessionSource=$null }

$hardStartError = $false
try {
    $startResp = Invoke-QidianJson -Method POST -Uri ("{0}/automation/android-adb/start-headless" -f $AddonBaseUrl.TrimEnd('/')) -Body @{ deviceId=$DeviceId; proxyPort=$ProxyPort; allowUnsafeStart=$true; enableSocks=$false; waitForTraffic=$false; waitForTargetTraffic=$false }
    $state.startHeadlessOk = [bool]$startResp.success
    $state.controlPlaneSuccess = $startResp.controlPlaneSuccess
    $state.sessionActive = $startResp.session.active
    $state.effectiveProxyPort = $startResp.effectiveProxyPort
    $state.proxySessionSource = $startResp.bridgeResponse.proxySessionSource
}
catch {
    $raw = $_.Exception.Message
    if ($raw -match 'EADDRINUSE') {
        $state.startHeadlessWarning = 'start-headless-eaddrinuse-existing-session-possible'
        $state.startHeadlessError = $raw
    } else {
        $state.startHeadlessError = $raw
        $hardStartError = $true
    }
}

Save-QidianCaptureState -Path $StatePath -State $state

$report = @(
'# Qidian Capture Start Report',
"- startedAt: $startedAt",
"- addonHealth: $($addonHealth.ok)",
"- bridgeHealthSuccess: $($bridgeHealth.success)",
"- jsonlPath: $jsonlPath",
"- baselineBytes: $baselineBytes",
"- startHeadlessOk: $($state.startHeadlessOk)",
"- startHeadlessWarning: $($state.startHeadlessWarning)",
"- startHeadlessError: $($state.startHeadlessError)",
"- controlPlaneSuccess: $($state.controlPlaneSuccess)",
"- sessionActive: $($state.sessionActive)",
"- effectiveProxyPort: $($state.effectiveProxyPort)",
"- proxySessionSource: $($state.proxySessionSource)",
"- next: powershell -ExecutionPolicy Bypass -File .\scripts\qidian-capture-watch.ps1 -StatePath \"$StatePath\""
)
Write-QidianCaptureReport -Path $ReportPath -Lines $report
Write-Host "Next command: powershell -ExecutionPolicy Bypass -File .\scripts\qidian-capture-watch.ps1 -StatePath \"$StatePath\""

if ($hardStartError) { exit 2 }
exit 0
