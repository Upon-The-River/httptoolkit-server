$ErrorActionPreference = "Stop"

$labRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$embeddedNode = Join-Path $labRoot "runtime/node/win32-x64/node.exe"

& (Join-Path $PSScriptRoot "doctor-runtime.ps1")

if (-not (Test-Path $embeddedNode)) {
  throw "Embedded node missing at $embeddedNode. Run ./scripts/bootstrap-node.ps1"
}

$nodeVersion = & $embeddedNode --version
Write-Host "Starting server with embedded node: $embeddedNode"
Write-Host "Embedded node version: $nodeVersion"

& $embeddedNode (Join-Path $labRoot "bin/run") start
