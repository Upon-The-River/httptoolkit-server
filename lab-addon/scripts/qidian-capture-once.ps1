[CmdletBinding()]
param(
    [string]$AddonBaseUrl = 'http://127.0.0.1:45459',
    [string]$BridgeBaseUrl = 'http://127.0.0.1:45458',
    [string]$DeviceId = '23091JEGR04484',
    [int]$ProxyPort = 8000,
    [int]$TimeoutSeconds = 90,
    [int]$PollSeconds = 3,
    [switch]$ClearJsonl,
    [switch]$SkipSmoke,
    [string]$StatePath = '.\runtime\capture\qidian_capture_state.json',
    [string]$ReportPath = '.\runtime\capture\qidian_capture_report.md'
)
$ErrorActionPreference = 'Stop'

$startArgs = @('-ExecutionPolicy','Bypass','-File',"$PSScriptRoot/qidian-capture-start.ps1",'-AddonBaseUrl',$AddonBaseUrl,'-BridgeBaseUrl',$BridgeBaseUrl,'-DeviceId',$DeviceId,'-ProxyPort',$ProxyPort,'-StatePath',$StatePath,'-ReportPath',$ReportPath)
if ($ClearJsonl) { $startArgs += '-ClearJsonl' }
if ($SkipSmoke) { $startArgs += '-SkipSmoke' }
powershell @startArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host 'Now operate Qidian app: open book detail / role page / chapter page / refresh.'

powershell -ExecutionPolicy Bypass -File "$PSScriptRoot/qidian-capture-watch.ps1" -StatePath $StatePath -TimeoutSeconds $TimeoutSeconds -PollSeconds $PollSeconds -ReportPath $ReportPath
exit $LASTEXITCODE
