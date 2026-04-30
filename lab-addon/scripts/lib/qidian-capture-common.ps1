Set-StrictMode -Version Latest

function Set-QidianCaptureUtf8 {
    $utf8 = [Text.UTF8Encoding]::new()
    $script:OutputEncoding = $utf8
    $global:OutputEncoding = $utf8
    [Console]::OutputEncoding = $utf8
}

function Invoke-QidianJson {
    param(
        [ValidateSet('GET', 'POST')][string]$Method,
        [Parameter(Mandatory = $true)][string]$Uri,
        [object]$Body
    )

    try {
        if ($Method -eq 'GET') {
            return Invoke-RestMethod -Method Get -Uri $Uri
        }

        $json = if ($null -ne $Body) { $Body | ConvertTo-Json -Depth 20 } else { '{}' }
        return Invoke-RestMethod -Method Post -Uri $Uri -ContentType 'application/json' -Body $json
    }
    catch {
        $errorText = if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $_.ErrorDetails.Message } else { $_.Exception.Message }
        throw "${Method} ${Uri} failed: ${errorText}"
    }
}

function Test-QidianPort {
    param([int]$Port)
    try {
        $result = Test-NetConnection -ComputerName '127.0.0.1' -Port $Port -WarningAction SilentlyContinue
        return [bool]$result.TcpTestSucceeded
    }
    catch { return $false }
}

function Get-QidianExportStatus {
    param([string]$AddonBaseUrl)
    return Invoke-QidianJson -Method GET -Uri ("{0}/export/output-status" -f $AddonBaseUrl.TrimEnd('/'))
}

function Format-QidianShortLine {
    param([string]$Line)
    if ([string]::IsNullOrWhiteSpace($Line)) { return '' }
    if ($Line.Length -le 240) { return $Line }
    return $Line.Substring(0, 240) + '...'
}

function Get-QidianTargetHitsFromTail {
    param(
        [Parameter(Mandatory = $true)][string]$JsonlPath,
        [string]$Pattern = 'qidian.com|druidv6.if.qidian.com',
        [int]$Tail = 20,
        [int]$MaxSamples = 10
    )

    if (-not (Test-Path -LiteralPath $JsonlPath)) {
        return [pscustomobject]@{ matched = $false; sampleUrls = @(); sampleLines = @() }
    }

    $lines = Get-Content -LiteralPath $JsonlPath -Tail $Tail -ErrorAction Stop
    $sampleUrls = New-Object System.Collections.Generic.List[string]
    $sampleLines = New-Object System.Collections.Generic.List[string]

    foreach ($line in $lines) {
        if ($line -notmatch $Pattern) { continue }
        $sampleLines.Add((Format-QidianShortLine -Line $line)) | Out-Null
        try {
            $obj = $line | ConvertFrom-Json -ErrorAction Stop
            if ($obj.url) { $sampleUrls.Add([string]$obj.url) | Out-Null }
        }
        catch {
            $sampleUrls.Add((Format-QidianShortLine -Line $line)) | Out-Null
        }
        if ($sampleUrls.Count -ge $MaxSamples) { break }
    }

    return [pscustomobject]@{
        matched = $sampleUrls.Count -gt 0
        sampleUrls = @($sampleUrls | Select-Object -First $MaxSamples)
        sampleLines = @($sampleLines | Select-Object -First $MaxSamples)
    }
}

function New-QidianCaptureRuntimeDir {
    param([string]$Path)
    $dir = Split-Path -Parent $Path
    if (-not [string]::IsNullOrWhiteSpace($dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

function Save-QidianCaptureState {
    param([string]$Path, [object]$State)
    New-QidianCaptureRuntimeDir -Path $Path
    $State | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $Path -Encoding utf8
}

function Load-QidianCaptureState {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { throw "State file not found: $Path" }
    return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
}

function Write-QidianCaptureReport {
    param([string]$Path, [string[]]$Lines)
    New-QidianCaptureRuntimeDir -Path $Path
    Set-Content -LiteralPath $Path -Value ($Lines -join "`r`n") -Encoding utf8
}
