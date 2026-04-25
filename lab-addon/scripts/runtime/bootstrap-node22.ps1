param(
    [string]$Version = "22.20.0"
)

$ErrorActionPreference = "Stop"

& (Join-Path $PSScriptRoot "bootstrap-node.ps1") -Version $Version
