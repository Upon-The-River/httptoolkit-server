[CmdletBinding()]
param(
    [string]$StatePath = '.\runtime\capture\qidian_capture_state.json',
    [int]$TimeoutSeconds = 60,
    [int]$PollSeconds = 3,
    [string]$Pattern = 'qidian.com|druidv6.if.qidian.com',
    [int]$MinGrowthBytes = 1,
    [int]$Tail = 20,
    [string]$ReportPath = '.\runtime\capture\qidian_capture_report.md'
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/lib/qidian-capture-common.ps1"
Set-QidianCaptureUtf8

$labRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
if (-not [System.IO.Path]::IsPathRooted($StatePath)) { $StatePath = Join-Path $labRoot $StatePath }
if (-not [System.IO.Path]::IsPathRooted($ReportPath)) { $ReportPath = Join-Path $labRoot $ReportPath }

$state = Load-QidianCaptureState -Path $StatePath
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$hitSamples = @()
$success = $false
$currentBytes = [int64]$state.baselineBytes

while ((Get-Date) -lt $deadline) {
    $status = Get-QidianExportStatus -AddonBaseUrl $state.addonBaseUrl
    $currentBytes = [int64]$status.sizeBytes
    $delta = $currentBytes - [int64]$state.baselineBytes
    $hits = Get-QidianTargetHitsSinceOffset -JsonlPath $state.jsonlPath -OffsetBytes ([int64]$state.baselineBytes) -Pattern $Pattern -MaxSamples 10
    $hitSeen = [bool]$hits.matched
    if ($hitSeen) { $hitSamples = @($hits.sampleUrls | Select-Object -First 10) }

    Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] baseline=$($state.baselineBytes) current=$currentBytes delta=$delta targetHitSinceBaseline=$hitSeen"
    if ($currentBytes -gt ([int64]$state.baselineBytes + $MinGrowthBytes) -and $hitSeen) { $success = $true; break }
    Start-Sleep -Seconds $PollSeconds
}

$deltaBytes = $currentBytes - [int64]$state.baselineBytes
if ($success) {
    $lines = @('# Qidian Capture Watch Report',"- captureConnected: true","- completedAt: $((Get-Date).ToString('o'))","- finalSizeBytes: $currentBytes","- deltaBytes: $deltaBytes",'- verdict: connected-and-receiving-qidian-traffic','- sampleTargetUrls:')
    foreach ($u in ($hitSamples | Select-Object -First 10)) { $lines += "  - $u" }
    Write-QidianCaptureReport -Path $ReportPath -Lines $lines
    exit 0
}

$reason = if ($deltaBytes -le 0) { 'no new JSONL records' } else { 'traffic observed but target not matched' }
$timeoutLines = @(
'# Qidian Capture Watch Report',
'- captureConnected: false',
"- completedAt: $((Get-Date).ToString('o'))",
"- finalSizeBytes: $currentBytes",
"- deltaBytes: $deltaBytes",
"- status: $reason",
'- troubleshooting:',
'  - operate Qidian app: open book detail / role page / chapter / refresh',
'  - do not repeatedly rerun start-headless unless restarting services',
'  - check /export/output-status',
'  - check whether official server and lab-addon are still running'
)
Write-QidianCaptureReport -Path $ReportPath -Lines $timeoutLines
exit 2
