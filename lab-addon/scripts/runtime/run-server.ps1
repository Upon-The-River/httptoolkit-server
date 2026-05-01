$ErrorActionPreference = "Stop"

$labRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$embeddedNode = Join-Path $labRoot "runtime/node/win32-x64/node.exe"
$npmWrapper = Join-Path $PSScriptRoot "npm22.cmd"
$packageJson = Join-Path $labRoot "package.json"
$serverEntry = Join-Path $labRoot "src/server.ts"
$nodeModules = Join-Path $labRoot "node_modules"

& (Join-Path $PSScriptRoot "doctor-runtime.ps1")

if (-not (Test-Path $embeddedNode)) {
  throw "Embedded node missing at $embeddedNode. Run scripts/runtime/bootstrap-node.ps1 first."
}
if (-not (Test-Path $npmWrapper)) {
  throw "npm wrapper missing at $npmWrapper"
}
if (-not (Test-Path $packageJson)) {
  throw "package.json missing at $packageJson"
}
if (-not (Test-Path $serverEntry)) {
  throw "server entry missing at $serverEntry"
}
if (-not (Test-Path $nodeModules)) {
  throw "node_modules not found. Run scripts/runtime/bootstrap-node.ps1 first."
}

$nodeVersion = & $embeddedNode --version
Write-Host "labRoot: $labRoot"
Write-Host "node path: $embeddedNode"
Write-Host "npm wrapper path: $npmWrapper"
Write-Host "package.json path: $packageJson"
Write-Host "embedded node version: $nodeVersion"
Write-Host "command: npm run start"

Push-Location $labRoot
try {
  & $npmWrapper run start
}
finally {
  Pop-Location
}
