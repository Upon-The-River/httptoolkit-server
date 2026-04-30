[CmdletBinding()]
param(
    [string]$InputPath,
    [string]$OutputPath,
    [string]$QidianOutputPath,
    [Nullable[int]]$MaxRecords = $null,
    [Nullable[long]]$SinceBytes = $null,
    [switch]$Append,
    [switch]$IncludeSamples
)
$ErrorActionPreference = 'Stop'

$labRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $labRoot


$exportDirEnv = $env:HTK_LAB_ADDON_EXPORT_DIR
if ([string]::IsNullOrWhiteSpace($InputPath)) {
    if (-not [string]::IsNullOrWhiteSpace($exportDirEnv)) {
        $InputPath = Join-Path $exportDirEnv 'session_hits.jsonl'
    } else {
        $InputPath = '.\runtime\exports\session_hits.jsonl'
    }
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    if (-not [string]::IsNullOrWhiteSpace($exportDirEnv)) {
        $OutputPath = Join-Path $exportDirEnv 'normalized_network_events.jsonl'
    } else {
        $OutputPath = '.\runtime\exports\normalized_network_events.jsonl'
    }
}
if ([string]::IsNullOrWhiteSpace($QidianOutputPath)) {
    if (-not [string]::IsNullOrWhiteSpace($exportDirEnv)) {
        $QidianOutputPath = Join-Path $exportDirEnv 'qidian_endpoint_events.jsonl'
    } else {
        $QidianOutputPath = '.\runtime\exports\qidian_endpoint_events.jsonl'
    }
}

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
