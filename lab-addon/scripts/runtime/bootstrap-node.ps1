param(
  [string]$Version = "22.20.0"
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$targetDir = Join-Path $repoRoot "runtime/node/win32-x64"
$targetExe = Join-Path $targetDir "node.exe"
if (Test-Path $targetDir) {
  Remove-Item -Path $targetDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

$zipName = "node-v$Version-win-x64.zip"
$downloadUrl = "https://nodejs.org/dist/v$Version/$zipName"
$tempZip = Join-Path $env:TEMP $zipName
$tempExtract = Join-Path $env:TEMP "httptoolkit-node-v$Version"

Write-Host "Downloading $downloadUrl"
Invoke-WebRequest -Uri $downloadUrl -OutFile $tempZip

if (Test-Path $tempExtract) { Remove-Item -Recurse -Force $tempExtract }
Expand-Archive -Path $tempZip -DestinationPath $tempExtract -Force

$sourceRoot = Get-ChildItem -Path $tempExtract -Directory | Select-Object -First 1
if (-not $sourceRoot) {
  throw "Downloaded archive did not contain an extracted node directory"
}

Get-ChildItem -Path $sourceRoot.FullName -Force | ForEach-Object {
  Copy-Item -Path $_.FullName -Destination $targetDir -Recurse -Force
}

if (-not (Test-Path $targetExe)) { throw "node.exe missing after install" }
if (-not (Test-Path (Join-Path $targetDir "npm.cmd"))) { throw "npm.cmd missing after install" }
if (-not (Test-Path (Join-Path $targetDir "npx.cmd"))) { throw "npx.cmd missing after install" }
if (-not (Test-Path (Join-Path $targetDir "node_modules/npm/bin/npm-cli.js"))) { throw "npm CLI missing after install" }

$actualVersion = & $targetExe --version
if ($actualVersion -ne "v$Version") {
  throw "Version mismatch after install. expected=v$Version actual=$actualVersion"
}

Write-Host "Installed embedded node at $targetExe ($actualVersion)"
