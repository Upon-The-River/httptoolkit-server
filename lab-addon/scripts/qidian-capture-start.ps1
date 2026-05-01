[CmdletBinding()]
param(
    [string]$AddonBaseUrl = 'http://127.0.0.1:45457',
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
if (-not [System.IO.Path]::IsPathRooted($StatePath)) { $StatePath = Join-Path $labRoot $StatePath }
if (-not [System.IO.Path]::IsPathRooted($ReportPath)) { $ReportPath = Join-Path $labRoot $ReportPath }
Set-Location $labRoot

$adbList = & adb devices
if ($LASTEXITCODE -ne 0) { throw 'adb devices failed.' }
if (-not ($adbList | Where-Object { $_ -match "^$([regex]::Escape($DeviceId))\s+device$" })) { throw "Device $DeviceId not in adb 'device' state." }


function Get-PortFromUrl {
    param([string]$Url)
    try {
        $uri = [Uri]$Url
        if ($uri.Port -gt 0) { return $uri.Port }
        if ($uri.Scheme -eq 'https') { return 443 }
        return 80
    }
    catch {
        throw "Invalid URL: $Url"
    }
}
$addonPort = Get-PortFromUrl $AddonBaseUrl
$bridgePort = Get-PortFromUrl $BridgeBaseUrl

foreach ($port in @($addonPort, $bridgePort) | Select-Object -Unique) {
    if (-not (Test-QidianPort -Port $port)) {
        throw "Required port not reachable: $port"
    }
}

Write-Host "Optional diagnostic port 45456: $(Test-QidianPort -Port 45456)"
Write-Host "Optional diagnostic port 45459: $(Test-QidianPort -Port 45459)"

$addonHealth = Invoke-QidianJson -Method GET -Uri ("{0}/health" -f $AddonBaseUrl.TrimEnd('/'))
$bridgeHealth = Invoke-QidianJson -Method GET -Uri ("{0}/automation/health" -f $BridgeBaseUrl.TrimEnd('/'))

if (-not $SkipSmoke) {
    powershell -ExecutionPolicy Bypass -File .\scripts\validate-lab-addon.ps1 -AddonBaseUrl $AddonBaseUrl -SkipNpm -IncludeAndroid -DeviceId $DeviceId -PersistExportTest -ReportPath '.\runtime\validation\addon-android-smoke-45459.md' -WriteMarkdownReport
}

$status = Get-QidianExportStatus -AddonBaseUrl $AddonBaseUrl
$jsonlPath = $status.jsonlPath
if ($ClearJsonl -and (Test-Path -LiteralPath $jsonlPath)) {
    Clear-Content -LiteralPath $jsonlPath
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
    $state.proxySessionSource = if ($startResp.activationResult -and $startResp.activationResult.bridgeResponse) { $startResp.activationResult.bridgeResponse.proxySessionSource } elseif ($startResp.bridgeResponse) { $startResp.bridgeResponse.proxySessionSource } else { $null }
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
"- next: powershell -ExecutionPolicy Bypass -File .\scripts\qidian-capture-watch.ps1 -StatePath `"$StatePath`""
)
Write-QidianCaptureReport -Path $ReportPath -Lines $report
Write-Host "Next command: powershell -ExecutionPolicy Bypass -File .\scripts\qidian-capture-watch.ps1 -StatePath `"$StatePath`""

if ($hardStartError) { exit 2 }
exit 0
