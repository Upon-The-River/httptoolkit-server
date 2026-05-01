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
        [object]$Body,
        [int]$TimeoutSec = 5
    )

    try {
        if ($Method -eq 'GET') {
            return Invoke-RestMethod -Method Get -Uri $Uri -TimeoutSec $TimeoutSec
        }

        $json = if ($null -ne $Body) { $Body | ConvertTo-Json -Depth 20 } else { '{}' }
        return Invoke-RestMethod -Method Post -Uri $Uri -ContentType 'application/json' -Body $json -TimeoutSec $TimeoutSec
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
    param([string]$AddonBaseUrl, [int]$TimeoutSec = 5)
    return Invoke-QidianJson -Method GET -Uri ("{0}/export/output-status" -f $AddonBaseUrl.TrimEnd('/')) -TimeoutSec $TimeoutSec
}

function Invoke-QidianStartHeadlessOnce {
    param(
        [string]$AddonBaseUrl,
        [string]$DeviceId,
        [int]$ProxyPort = 8000,
        [int]$TimeoutSec = 5
    )

    $uri = "{0}/automation/android-adb/start-headless" -f $AddonBaseUrl.TrimEnd('/')
    $body = @{
        deviceId = $DeviceId
        proxyPort = $ProxyPort
        allowUnsafeStart = $true
        enableSocks = $false
        waitForTraffic = $false
        waitForTargetTraffic = $false
    }

    $result = [ordered]@{ responseSummary = $null; warning = $null; errorReason = $null }
    try {
        $resp = Invoke-QidianJson -Method POST -Uri $uri -Body $body -TimeoutSec $TimeoutSec
        $result.responseSummary = $resp | ConvertTo-Json -Compress
    }
    catch {
        $msg = $_.Exception.Message
        $result.responseSummary = $msg
        if ($msg -match 'EADDRINUSE') {
            $result.warning = 'eaddrinuse-existing-session-possible'
        }
        elseif ($msg -match 'Failed to connect to admin server at http://127\.0\.0\.1:45456') {
            $result.errorReason = 'official-admin-server-unreachable'
        }
        else {
            $result.errorReason = $msg
        }
    }

    return [pscustomobject]$result
}

function Restart-QidianHtkAndroidApp {
    param(
        [string]$AddonBaseUrl,
        [string]$DeviceId,
        [string]$HtkPackage = 'tech.httptoolkit.android.v1',
        [int]$ProxyPort = 8000,
        [int]$TimeoutSec = 5
    )

    $result = [ordered]@{
        forceStopAttempted = $false
        forceStopOk = $false
        forceStopSummary = $null
        startHeadlessResponseSummary = $null
        warning = $null
        errorReason = $null
    }

    try {
        $result.forceStopAttempted = $true
        $output = (& adb -s $DeviceId shell am force-stop $HtkPackage 2>&1)
        $result.forceStopSummary = (($output -join "`n").Trim())
        $result.forceStopOk = $true
    }
    catch {
        $result.errorReason = "adb-force-stop-failed: $($_.Exception.Message)"
        return [pscustomobject]$result
    }

    Start-Sleep -Seconds 3
    $startResult = Invoke-QidianStartHeadlessOnce -AddonBaseUrl $AddonBaseUrl -DeviceId $DeviceId -ProxyPort $ProxyPort -TimeoutSec $TimeoutSec
    $result.startHeadlessResponseSummary = $startResult.responseSummary
    if ($startResult.warning) { $result.warning = $startResult.warning }
    if ($startResult.errorReason) { $result.errorReason = $startResult.errorReason }
    return [pscustomobject]$result
}

function Write-QidianRepairLog {
    param([string]$LogPath, [object]$Result)
    New-QidianCaptureRuntimeDir -Path $LogPath
    $line = "[{0}] verdict={1} repairNeeded={2} repairAttempted={3} proxyBefore={4} proxyAfter={5} reason={6} warning={7} failed={8}" -f `
        $Result.checkedAt, $Result.verdict, $Result.repairNeeded, $Result.repairAttempted, $Result.proxyPortOpenBefore, $Result.proxyPortOpenAfter, $Result.repairReason, $Result.repairWarning, $Result.repairFailedReason
    Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
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


function Get-QidianTargetHitsSinceOffset {
    param(
        [Parameter(Mandatory = $true)][string]$JsonlPath,
        [Parameter(Mandatory = $true)][int64]$OffsetBytes,
        [string]$Pattern = 'qidian.com|druidv6.if.qidian.com',
        [int]$MaxSamples = 10
    )

    if (-not (Test-Path -LiteralPath $JsonlPath)) {
        return [pscustomobject]@{ matched = $false; sampleUrls = @(); sampleLines = @(); appendedLineCount = 0 }
    }

    $sampleUrls = New-Object System.Collections.Generic.List[string]
    $sampleLines = New-Object System.Collections.Generic.List[string]
    $appendedLineCount = 0

    $fileStream = $null
    $reader = $null
    try {
        $fileStream = [System.IO.File]::Open($JsonlPath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
        $safeOffset = [Math]::Max(0, [Math]::Min($OffsetBytes, $fileStream.Length))
        $fileStream.Seek($safeOffset, [System.IO.SeekOrigin]::Begin) | Out-Null
        $reader = [System.IO.StreamReader]::new($fileStream, [System.Text.UTF8Encoding]::new($false), $true, 4096, $true)

        while (-not $reader.EndOfStream) {
            $line = $reader.ReadLine()
            if ($null -eq $line) { continue }
            $appendedLineCount++
            if ($line -notmatch $Pattern) { continue }

            $sampleLines.Add((Format-QidianShortLine -Line $line)) | Out-Null
            try {
                $obj = $line | ConvertFrom-Json -ErrorAction Stop
                if ($obj.url) {
                    $sampleUrls.Add([string]$obj.url) | Out-Null
                } else {
                    $sampleUrls.Add((Format-QidianShortLine -Line $line)) | Out-Null
                }
            }
            catch {
                $sampleUrls.Add((Format-QidianShortLine -Line $line)) | Out-Null
            }

            if ($sampleUrls.Count -ge $MaxSamples) { break }
        }
    }
    finally {
        if ($reader) { $reader.Dispose() }
        if ($fileStream) { $fileStream.Dispose() }
    }

    return [pscustomobject]@{
        matched = $sampleUrls.Count -gt 0
        sampleUrls = @($sampleUrls | Select-Object -First $MaxSamples)
        sampleLines = @($sampleLines | Select-Object -First $MaxSamples)
        appendedLineCount = $appendedLineCount
    }
}
