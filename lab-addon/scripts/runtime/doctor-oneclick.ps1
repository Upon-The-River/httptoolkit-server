$ErrorActionPreference = 'Stop'

$labRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$oneclickScript = Join-Path $labRoot 'scripts/qidian-capture-oneclick.ps1'
$cmdLauncher = Join-Path $labRoot 'start-qidian-capture.cmd'
$commonScript = Join-Path $labRoot 'scripts/lib/qidian-capture-common.ps1'
$runServerScript = Join-Path $labRoot 'scripts/runtime/run-server.ps1'
$packageJson = Join-Path $labRoot 'package.json'
$nodeCmd = Join-Path $labRoot 'scripts/runtime/node22.cmd'
$npmCmd = Join-Path $labRoot 'scripts/runtime/npm22.cmd'

if (-not (Test-Path $oneclickScript)) { throw "missing $oneclickScript" }
if (-not (Test-Path $cmdLauncher)) { throw "missing $cmdLauncher" }
if (-not (Test-Path $commonScript)) { throw "missing $commonScript" }
if (-not (Test-Path $runServerScript)) { throw "missing $runServerScript" }
if (-not (Test-Path $packageJson)) { throw "missing $packageJson" }

$runServerText = Get-Content -LiteralPath $runServerScript -Raw
if ($runServerText -notmatch 'Split-Path -Parent \(Split-Path -Parent \$PSScriptRoot\)') {
  throw 'run-server.ps1 does not use two-level labRoot derivation'
}

$nodeCmdText = Get-Content -LiteralPath $nodeCmd -Raw
$npmCmdText = Get-Content -LiteralPath $npmCmd -Raw
if ($nodeCmdText -notmatch 'set ROOT=%~dp0..\\..') { throw 'node22.cmd ROOT is not lab-addon root' }
if ($npmCmdText -notmatch 'set ROOT=%~dp0..\\..') { throw 'npm22.cmd ROOT is not lab-addon root' }

Write-Host 'doctor-oneclick checks passed:'
Write-Host "- oneclick script: $oneclickScript"
Write-Host "- cmd launcher: $cmdLauncher"
Write-Host "- package.json: $packageJson"
Write-Host "- node22.cmd/nmp22.cmd ROOT check: ok"
