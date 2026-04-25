$ErrorActionPreference = "Continue"

$repoRoot = Split-Path -Parent $PSScriptRoot
$embeddedNode = Join-Path $repoRoot "runtime/node/win32-x64/node.exe"
$packageJson = Join-Path $repoRoot "package.json"
$nvmrcPath = Join-Path $repoRoot ".nvmrc"

$enginesNode = (Get-Content $packageJson -Raw | ConvertFrom-Json).engines.node
$nvmrc = if (Test-Path $nvmrcPath) { (Get-Content $nvmrcPath -Raw).Trim() } else { "<missing>" }

$embeddedNodeVersion = "<missing>"
$npmVersion = "<unknown>"
if (Test-Path $embeddedNode) {
  $embeddedNodeVersion = & $embeddedNode --version
  $npmCmd = Join-Path (Split-Path $embeddedNode -Parent) "npm.cmd"
  if (Test-Path $npmCmd) {
    $npmVersion = & $npmCmd --version
  } else {
    $npmVersion = "<npm-cmd-missing>"
  }
}

$adbCmd = Get-Command adb -ErrorAction SilentlyContinue
$adbPath = if ($adbCmd) { $adbCmd.Source } else { "<missing>" }
$adbVersion = if ($adbCmd) { (& adb version | Select-Object -First 1) } else { "<missing>" }

function Get-PortStatus([int]$port) {
  try {
    $connections = Get-NetTCPConnection -LocalPort $port -ErrorAction Stop
    if ($connections) {
      return ($connections | Select-Object -First 5 | ForEach-Object {
        "{0}/{1}/{2}" -f $_.LocalAddress, $_.State, $_.OwningProcess
      }) -join ", "
    }
  } catch {
    $line = (netstat -ano | Select-String ":$port\s" | Select-Object -First 1)
    if ($line) { return $line.Line.Trim() }
  }
  return "free"
}

Write-Host "embedded node path: $embeddedNode"
Write-Host "embedded node version: $embeddedNodeVersion"
Write-Host "npm version: $npmVersion"
Write-Host "package engines.node: $enginesNode"
Write-Host ".nvmrc: $nvmrc"
Write-Host "adb path: $adbPath"
Write-Host "adb version: $adbVersion"
Write-Host "port 45456: $(Get-PortStatus 45456)"
Write-Host "port 45457: $(Get-PortStatus 45457)"
