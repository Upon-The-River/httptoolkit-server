[CmdletBinding()]
param(
    [string]$InputPath = '.\runtime\exports\session_hits.jsonl',
    [string]$OutputPath = '.\runtime\exports\normalized_network_events.jsonl',
    [string]$QidianOutputPath = '.\runtime\exports\qidian_endpoint_events.jsonl',
    [Nullable[int]]$MaxRecords = $null,
    [Nullable[long]]$SinceBytes = $null,
    [switch]$Append,
    [switch]$IncludeSamples
)
$ErrorActionPreference = 'Stop'

$labRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $labRoot

if (-not [System.IO.Path]::IsPathRooted($InputPath)) { $InputPath = Join-Path $labRoot $InputPath }
if (-not [System.IO.Path]::IsPathRooted($OutputPath)) { $OutputPath = Join-Path $labRoot $OutputPath }
if (-not [System.IO.Path]::IsPathRooted($QidianOutputPath)) { $QidianOutputPath = Join-Path $labRoot $QidianOutputPath }

$args = @('src/export/normalize-network-jsonl-cli.ts', '--inputPath', $InputPath, '--outputPath', $OutputPath, '--qidianOutputPath', $QidianOutputPath)
if ($MaxRecords -ne $null) { $args += @('--maxRecords', "$MaxRecords") }
if ($SinceBytes -ne $null) { $args += @('--sinceBytes', "$SinceBytes") }
if ($Append) { $args += '--append' }
if ($IncludeSamples) { $args += '--includeSamples' }

& .\node_modules\.bin\tsx.cmd @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
exit 0
