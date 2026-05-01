$ErrorActionPreference = 'Stop'

$labRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$checks = @()

function Add-Check {
  param([string]$Name,[bool]$Ok,[string]$Detail)
  $script:checks += [pscustomobject]@{ Name=$Name; Ok=$Ok; Detail=$Detail }
}

$oneclickScript = Join-Path $labRoot 'scripts/qidian-capture-oneclick.ps1'
$cmdLauncher = Join-Path $labRoot 'start-qidian-capture.cmd'
$runServerScript = Join-Path $labRoot 'scripts/runtime/run-server.ps1'
$startScript = Join-Path $labRoot 'scripts/qidian-capture-start.ps1'
$watchScript = Join-Path $labRoot 'scripts/qidian-capture-watch.ps1'
$commonScript = Join-Path $labRoot 'scripts/lib/qidian-capture-common.ps1'
$nodeCmd = Join-Path $labRoot 'scripts/runtime/node22.cmd'
$npmCmd = Join-Path $labRoot 'scripts/runtime/npm22.cmd'

foreach ($file in @($oneclickScript,$cmdLauncher,$runServerScript,$startScript,$watchScript,$commonScript,$nodeCmd,$npmCmd)) {
  Add-Check -Name "exists: $file" -Ok (Test-Path $file) -Detail ''
}

$runServerText = Get-Content -LiteralPath $runServerScript -Raw
Add-Check -Name 'run-server no bin/run' -Ok ($runServerText -notmatch 'bin/run') -Detail 'must not call bin/run'
Add-Check -Name 'run-server has npm22.cmd' -Ok ($runServerText -match 'npm22\.cmd') -Detail 'must use npm22.cmd'
Add-Check -Name 'run-server has run start' -Ok ($runServerText -match 'run start') -Detail 'must run npm start'

$oneclickText = Get-Content -LiteralPath $oneclickScript -Raw
Add-Check -Name 'oneclick no ternary operator' -Ok ($oneclickText -notmatch '\?\s*''-ClearJsonl''|\?\s*''-SkipSmoke''|\s\?\s') -Detail 'PowerShell 5.1 compatible'
Add-Check -Name 'oneclick no bad quote escape' -Ok ($oneclickText -notmatch '\\"|\$exportsRoot\"') -Detail 'no bash-style quote escape'

$startText = Get-Content -LiteralPath $startScript -Raw
Add-Check -Name 'start no fixed 45456,45457,45458,45459 list' -Ok ($startText -notmatch '45456,45457,45458,45459') -Detail 'must use URL-derived ports'
Add-Check -Name 'start has Get-PortFromUrl' -Ok ($startText -match 'function\s+Get-PortFromUrl') -Detail ''
Add-Check -Name 'start references AddonBaseUrl' -Ok ($startText -match 'AddonBaseUrl') -Detail ''
Add-Check -Name 'start references BridgeBaseUrl' -Ok ($startText -match 'BridgeBaseUrl') -Detail ''

$nodeCmdText = Get-Content -LiteralPath $nodeCmd -Raw
$npmCmdText = Get-Content -LiteralPath $npmCmd -Raw
Add-Check -Name 'node22.cmd ROOT=%~dp0..\..' -Ok ($nodeCmdText -match 'set\s+"?ROOT=%~dp0\.\.\\\.\."?') -Detail ''
Add-Check -Name 'npm22.cmd ROOT=%~dp0..\..' -Ok ($npmCmdText -match 'set\s+"?ROOT=%~dp0\.\.\\\.\."?') -Detail ''

$failed = @($checks | Where-Object { -not $_.Ok })
Write-Host 'doctor-oneclick summary:'
foreach ($c in $checks) {
  $status = if ($c.Ok) { 'PASS' } else { 'FAIL' }
  Write-Host ("[{0}] {1} {2}" -f $status, $c.Name, $c.Detail)
}

if ($failed.Count -gt 0) { exit 1 }
exit 0
