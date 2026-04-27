[CmdletBinding()]
param(
    [string]$AddonBaseUrl = "http://127.0.0.1:45457",
    [string]$OfficialRoot = "",
    [switch]$SkipNpm,
    [switch]$SkipTests,
    [switch]$IncludeAndroid,
    [string]$DeviceId = "",
    [switch]$IncludeHeadless,
    [string]$HeadlessCommand = "",
    [string[]]$HeadlessArgs = @(),
    [string]$HeadlessWorkingDir = "",
    [switch]$ExecuteHeadlessStart,
    [switch]$ExecuteAndroidRescue,
    [switch]$PersistExportTest,
    [switch]$IncludeSessionStart,
    [string]$ReportPath = "",
    [switch]$WriteMarkdownReport,
    [switch]$WriteJsonReport,
    [switch]$FailFast
)

$ErrorActionPreference = 'Stop'

$script:Results = New-Object System.Collections.Generic.List[object]
$script:RequiredFailure = $false
$script:ExportOutputStatus = $null
$script:OfficialGitSummary = $null
$script:ReportWrittenPath = ''
$script:FinalRecommendation = ''
$script:SafeToProceedToCoreHook = $false
$script:CoreHookReasons = @()
$script:MigrationStatus = $null

$RequiredGateNames = @(
    'addon server reachable',
    'GET /health',
    'GET /migration/status',
    'POST /qidian/match',
    'GET /session/latest',
    'POST /export/match',
    'POST /export/ingest',
    'GET /export/output-status',
    'GET /export/stream (expects requires-core-hook; HTTP 501 is PASS pre-core-hook)'
)

if ($IncludeSessionStart) {
    $RequiredGateNames += 'POST /session/start'
}

$ForbiddenOfficialDirtyPatterns = @(
    'src/',
    'package.json',
    'package-lock.json',
    'bin/',
    '.github/',
    'nss/',
    'overrides/',
    'test/',
    'custom-typings/'
)

function Format-Snippet {
    param([object]$Snippet)

    if ($null -eq $Snippet) {
        return ''
    }

    try {
        return ($Snippet | ConvertTo-Json -Depth 10 -Compress)
    }
    catch {
        return [string]$Snippet
    }
}

function Add-Result {
    param(
        [string]$Name,
        [ValidateSet('PASS', 'FAIL', 'SKIP', 'WARN')]
        [string]$Status,
        [string]$Summary,
        [bool]$Required = $true,
        [object]$Snippet = $null
    )

    $entry = [pscustomobject]@{
        Name     = $Name
        Status   = $Status
        Required = $Required
        Summary  = $Summary
        Snippet  = $Snippet
    }

    $script:Results.Add($entry) | Out-Null

    if ($Required -and $Status -eq 'FAIL') {
        $script:RequiredFailure = $true
    }
}

function Get-StatusCounts {
    return [pscustomobject]@{
        PASS = @($script:Results | Where-Object { $_.Status -eq 'PASS' }).Count
        FAIL = @($script:Results | Where-Object { $_.Status -eq 'FAIL' }).Count
        WARN = @($script:Results | Where-Object { $_.Status -eq 'WARN' }).Count
        SKIP = @($script:Results | Where-Object { $_.Status -eq 'SKIP' }).Count
    }
}

function Invoke-Check {
    param(
        [string]$Name,
        [scriptblock]$Action,
        [bool]$Required = $true,
        [switch]$Skip,
        [string]$SkipReason = ''
    )

    if ($Skip) {
        Add-Result -Name $Name -Status 'SKIP' -Summary $SkipReason -Required $Required
        return $null
    }

    try {
        $result = & $Action
        Add-Result -Name $Name -Status 'PASS' -Summary 'OK' -Required $Required -Snippet $result
        return $result
    }
    catch {
        Add-Result -Name $Name -Status 'FAIL' -Summary $_.Exception.Message -Required $Required -Snippet @{ error = $_.Exception.Message }
        if ($FailFast) {
            Write-Summary
            exit 1
        }
        return $null
    }
}

function Invoke-JsonRequest {
    param(
        [ValidateSet('Get', 'Post')]
        [string]$Method,
        [string]$Path,
        [object]$Body = $null
    )

    $uri = "{0}{1}" -f $AddonBaseUrl.TrimEnd('/'), $Path

    try {
        if ($Method -eq 'Get') {
            $respBody = Invoke-RestMethod -Method Get -Uri $uri
        }
        else {
            $json = $Body | ConvertTo-Json -Depth 20
            $respBody = Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body $json
        }

        return [pscustomobject]@{
            statusCode = 200
            body       = $respBody
        }
    }
    catch {
        $statusCode = $null
        $text = ''
        $errorDetailsMessage = $null

        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $errorDetailsMessage = [string]$_.ErrorDetails.Message
            $text = $errorDetailsMessage
        }

        $resp = $_.Exception.Response
        if ($null -ne $resp) {
            try {
                $statusCode = [int]$resp.StatusCode
            }
            catch {
                $statusCode = $null
            }

            try {
                $stream = $resp.GetResponseStream()
                if ($null -ne $stream) {
                    $reader = New-Object System.IO.StreamReader($stream)
                    $responseText = $reader.ReadToEnd()
                    $reader.Close()
                    if (-not [string]::IsNullOrWhiteSpace($responseText)) {
                        $text = $responseText
                    }
                }
            }
            catch {
                # Preserve error details fallback when response stream is unavailable.
            }
        }

        $parsed = $null
        if (-not [string]::IsNullOrWhiteSpace($text)) {
            try { $parsed = $text | ConvertFrom-Json } catch { }
        }

        if ($null -eq $statusCode) {
            throw
        }

        return [pscustomobject]@{
            statusCode = $statusCode
            bodyText   = $text
            body       = $parsed
            errorDetailsMessage = $errorDetailsMessage
        }
    }
}

function Invoke-JsonGet {
    param([string]$Path)

    return Invoke-JsonRequest -Method Get -Path $Path
}

function Invoke-JsonPost {
    param(
        [string]$Path,
        [object]$Body
    )

    return Invoke-JsonRequest -Method Post -Path $Path -Body $Body
}

function Test-ResponseRequiresCoreHook {
    param([object]$Response)

    if ($null -eq $Response) {
        return $false
    }

    $tokens = New-Object System.Collections.Generic.List[string]

    foreach ($propertyName in @('status', 'reason', 'message')) {
        if ($Response.PSObject.Properties.Name -contains $propertyName) {
            $value = $Response.$propertyName
            if ($null -ne $value) {
                $tokens.Add([string]$value) | Out-Null
            }
        }
    }

    foreach ($token in $tokens) {
        if ($token -match 'requires-core-hook') {
            return $true
        }
    }

    if (
        ($Response.PSObject.Properties.Name -contains 'implemented') -and
        ($Response.PSObject.Properties.Name -contains 'requiresCoreHook') -and
        $Response.implemented -eq $false -and
        $Response.requiresCoreHook -eq $true
    ) {
        return $true
    }

    return $false
}

function Test-MigrationRegistryRequiresCoreHook {
    param([object]$MigrationStatusBody)

    if ($null -eq $MigrationStatusBody) {
        return $false
    }

    if ($MigrationStatusBody.capabilities) {
        foreach ($capability in $MigrationStatusBody.capabilities) {
            if (
                $capability -and
                $capability.method -eq 'GET' -and
                $capability.path -eq '/export/stream' -and
                $capability.status -eq 'requires-core-hook'
            ) {
                return $true
            }
        }
    }

    if ($MigrationStatusBody.pendingRoutes) {
        foreach ($pendingRoute in $MigrationStatusBody.pendingRoutes) {
            if ($pendingRoute -eq 'GET /export/stream') {
                return $true
            }
        }
    }

    return $false
}

function Get-DirtyPathFromStatusLine {
    param([string]$Line)

    if ([string]::IsNullOrWhiteSpace($Line)) {
        return ''
    }

    $rawPath = $Line.Substring([Math]::Min(3, $Line.Length)).Trim()
    if ($rawPath -match '->') {
        $parts = $rawPath -split '->'
        if ($parts.Count -gt 1) {
            $rawPath = $parts[$parts.Count - 1].Trim()
        }
    }

    return $rawPath
}

function Test-ForbiddenOfficialPath {
    param([string]$Path)

    foreach ($prefix in $ForbiddenOfficialDirtyPatterns) {
        if ($prefix.EndsWith('/')) {
            if ($Path.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                return $true
            }
        }
        elseif ($Path -ieq $prefix) {
            return $true
        }
    }

    return $false
}

function Resolve-ReportFormat {
    if (-not $ReportPath) {
        return ''
    }

    if ($WriteJsonReport -and $WriteMarkdownReport) {
        throw 'Choose only one report format switch: -WriteJsonReport or -WriteMarkdownReport.'
    }

    if ($WriteJsonReport) {
        return 'json'
    }

    if ($WriteMarkdownReport) {
        return 'markdown'
    }

    $extension = [System.IO.Path]::GetExtension($ReportPath)
    if ($extension -ieq '.md') {
        return 'markdown'
    }

    if ($extension -ieq '.json') {
        return 'json'
    }

    return 'json'
}

function Get-ValidationReportObject {
    $counts = Get-StatusCounts
    $checksRun = @($script:Results | Where-Object { $_.Status -ne 'SKIP' } | ForEach-Object { $_.Name })
    $checksSkipped = @($script:Results | Where-Object { $_.Status -eq 'SKIP' } | ForEach-Object { $_.Name })

    $checkEntries = @()
    foreach ($item in $script:Results) {
        $checkEntries += [pscustomobject]@{
            name = $item.Name
            status = $item.Status
            required = [bool]$item.Required
            summary = $item.Summary
            snippet = if ($null -ne $item.Snippet) { $item.Snippet } else { $null }
        }
    }

    return [pscustomobject]@{
        timestamp = (Get-Date).ToString('o')
        addonBaseUrl = $AddonBaseUrl
        officialRoot = $OfficialRoot
        scriptPath = $MyInvocation.MyCommand.Path
        checksRun = $checksRun
        checksSkipped = $checksSkipped
        passedCount = $counts.PASS
        failedCount = $counts.FAIL
        warnedCount = $counts.WARN
        skippedCount = $counts.SKIP
        checks = $checkEntries
        exportOutputStatus = $script:ExportOutputStatus
        officialGitStatusSummary = $script:OfficialGitSummary
        finalRecommendation = [pscustomobject]@{
            safeToProceedToCoreHook = [bool]$script:SafeToProceedToCoreHook
            reasons = $script:CoreHookReasons
            summary = $script:FinalRecommendation
        }
    }
}

function Write-ValidationReport {
    if (-not $ReportPath) {
        return
    }

    $format = Resolve-ReportFormat
    $resolvedReportPath = $ReportPath
    if (-not [System.IO.Path]::IsPathRooted($resolvedReportPath)) {
        $resolvedReportPath = Join-Path (Get-Location) $resolvedReportPath
    }

    $reportDir = Split-Path -Parent $resolvedReportPath
    if ($reportDir -and -not (Test-Path -LiteralPath $reportDir)) {
        New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
    }

    $reportObject = Get-ValidationReportObject

    if ($format -eq 'markdown') {
        $lines = @()
        $lines += '# lab-addon validation report'
        $lines += ''
        $lines += "- Timestamp: $($reportObject.timestamp)"
        $lines += "- Addon base URL: $($reportObject.addonBaseUrl)"
        $lines += "- Official root: $($reportObject.officialRoot)"
        $lines += "- Script path: $($reportObject.scriptPath)"
        $lines += ''
        $lines += '## Summary counts'
        $lines += ''
        $lines += "- PASS: $($reportObject.passedCount)"
        $lines += "- FAIL: $($reportObject.failedCount)"
        $lines += "- WARN: $($reportObject.warnedCount)"
        $lines += "- SKIP: $($reportObject.skippedCount)"
        $lines += ''
        $lines += '## Checks'
        $lines += ''
        $lines += '| Name | Status | Required | Summary |'
        $lines += '|---|---|---|---|'
        foreach ($check in $reportObject.checks) {
            $summary = [string]$check.summary
            $summary = $summary.Replace('|', '\|')
            $lines += "| $($check.name) | $($check.status) | $($check.required) | $summary |"
        }

        $lines += ''
        $lines += '## Check snippets'
        $lines += ''
        foreach ($check in $reportObject.checks) {
            if ($null -ne $check.snippet) {
                $lines += "### $($check.name)"
                $lines += '```json'
                try {
                    $lines += ($check.snippet | ConvertTo-Json -Depth 10)
                }
                catch {
                    $lines += [string]$check.snippet
                }
                $lines += '```'
                $lines += ''
            }
        }

        if ($null -ne $reportObject.exportOutputStatus) {
            $lines += '## Export output status'
            $lines += '```json'
            $lines += ($reportObject.exportOutputStatus | ConvertTo-Json -Depth 10)
            $lines += '```'
            $lines += ''
        }

        if ($null -ne $reportObject.officialGitStatusSummary) {
            $lines += '## Official git status summary'
            $lines += '```json'
            $lines += ($reportObject.officialGitStatusSummary | ConvertTo-Json -Depth 10)
            $lines += '```'
            $lines += ''
        }

        $lines += '## Final recommendation'
        $lines += ''
        $lines += "- safe-to-proceed-to-core-hook: $($reportObject.finalRecommendation.safeToProceedToCoreHook)"
        $lines += "- summary: $($reportObject.finalRecommendation.summary)"
        if ($reportObject.finalRecommendation.reasons) {
            foreach ($reason in $reportObject.finalRecommendation.reasons) {
                $lines += "- reason: $reason"
            }
        }

        Set-Content -LiteralPath $resolvedReportPath -Value $lines -Encoding UTF8
    }
    else {
        $reportObject | ConvertTo-Json -Depth 15 | Set-Content -LiteralPath $resolvedReportPath -Encoding UTF8
    }

    $script:ReportWrittenPath = $resolvedReportPath
}

function Write-Summary {
    $counts = Get-StatusCounts

    Write-Host ''
    Write-Host '=== lab-addon validation summary ==='
    Write-Host ("PASS: {0}" -f $counts.PASS)
    Write-Host ("FAIL: {0}" -f $counts.FAIL)
    Write-Host ("WARN: {0}" -f $counts.WARN)
    Write-Host ("SKIP: {0}" -f $counts.SKIP)

    if ($script:ReportWrittenPath) {
        Write-Host ("Report path: {0}" -f $script:ReportWrittenPath)
    }

    Write-Host ''
    $script:Results |
        Select-Object Name, Status, Required, Summary |
        Format-Table -AutoSize |
        Out-String |
        Write-Host

    $snippets = $script:Results | Where-Object { $null -ne $_.Snippet }
    if ($snippets.Count -gt 0) {
        Write-Host 'Endpoint/result snippets:'
        foreach ($item in $snippets) {
            Write-Host ("- {0}: {1}" -f $item.Name, (Format-Snippet -Snippet $item.Snippet))
        }
    }

    Write-Host ''
    Write-Host ("Final recommendation: {0}" -f $script:FinalRecommendation)
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$labAddonRoot = Resolve-Path (Join-Path $scriptRoot '..')

Write-Host "Script root: $scriptRoot"
Write-Host "Lab addon root: $labAddonRoot"
Write-Host "Addon base URL: $AddonBaseUrl"

Push-Location $labAddonRoot
try {
    Invoke-Check -Name 'npm install' -Required $false -Skip:$SkipNpm -SkipReason 'Skipped by -SkipNpm' -Action {
        & npm install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed with exit code $LASTEXITCODE"
        }
        return @{ exitCode = $LASTEXITCODE }
    } | Out-Null

    Invoke-Check -Name 'npm run typecheck' -Required $false -Skip:$SkipNpm -SkipReason 'Skipped by -SkipNpm' -Action {
        & npm run typecheck
        if ($LASTEXITCODE -ne 0) {
            throw "npm run typecheck failed with exit code $LASTEXITCODE"
        }
        return @{ exitCode = $LASTEXITCODE }
    } | Out-Null

    Invoke-Check -Name 'npm test' -Required $false -Skip:$SkipTests -SkipReason 'Skipped by -SkipTests' -Action {
        & npm test
        if ($LASTEXITCODE -ne 0) {
            throw "npm test failed with exit code $LASTEXITCODE"
        }
        return @{ exitCode = $LASTEXITCODE }
    } | Out-Null
}
finally {
    Pop-Location
}

Invoke-Check -Name 'addon server reachable' -Required $true -Action {
    $uri = [System.Uri]$AddonBaseUrl
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $client.Connect($uri.Host, $uri.Port)
        if (-not $client.Connected) {
            throw 'TCP connect did not report connected state.'
        }
    }
    finally {
        $client.Close()
    }

    return @{ host = $uri.Host; port = $uri.Port; reachable = $true }
} | Out-Null

$health = Invoke-Check -Name 'GET /health' -Required $true -Action {
    $resp = Invoke-JsonGet -Path '/health'
    if ($resp.statusCode -ne 200) {
        throw "Unexpected status code: $($resp.statusCode)"
    }
    return $resp.body
}

if ($null -eq $health) {
    Write-Host "Server may be unreachable. Start the addon with: cd $labAddonRoot; npm run start"
}

$script:MigrationStatus = Invoke-Check -Name 'GET /migration/status' -Required $true -Action {
    $resp = Invoke-JsonGet -Path '/migration/status'
    if ($resp.statusCode -ne 200) {
        throw "Unexpected status code: $($resp.statusCode)"
    }
    return $resp.body
} | Out-Null

Invoke-Check -Name 'POST /qidian/match' -Required $true -Action {
    $resp = Invoke-JsonPost -Path '/qidian/match' -Body @{ url = 'https://www.qidian.com/chapter/1234567890/' }
    if ($resp.statusCode -ne 200) {
        throw "Unexpected status code: $($resp.statusCode)"
    }
    return $resp.body
} | Out-Null

if ($IncludeSessionStart) {
    Invoke-Check -Name 'POST /session/start' -Required $true -Action {
        $resp = Invoke-JsonPost -Path '/session/start' -Body @{ target = 'validation-smoke' }
        if ($resp.statusCode -ne 200) {
            throw "Unexpected status code: $($resp.statusCode)"
        }
        return $resp.body
    } | Out-Null
}
else {
    Add-Result -Name 'POST /session/start' -Status 'SKIP' -Summary 'Skipped by default. Use -IncludeSessionStart when full session backend conditions are available.' -Required $false -Snippet @{
        includeSessionStart = $false
        note = '/session/start may require full official/mockttp session backend conditions and is optional for addon-only smoke validation.'
    }
}

Invoke-Check -Name 'GET /session/latest' -Required $true -Action {
    $resp = Invoke-JsonGet -Path '/session/latest'
    if ($resp.statusCode -ne 200) {
        throw "Unexpected status code: $($resp.statusCode)"
    }
    return $resp.body
} | Out-Null

if ($IncludeAndroid) {
    Invoke-Check -Name 'POST /android/network/inspect' -Required $false -Action {
        $body = @{}
        if ($DeviceId) { $body.deviceId = $DeviceId }
        $resp = Invoke-JsonPost -Path '/android/network/inspect' -Body $body
        if ($resp.statusCode -ne 200) {
            throw "Unexpected status code: $($resp.statusCode)"
        }
        return $resp.body
    } | Out-Null

    Invoke-Check -Name 'POST /android/network/rescue' -Required $false -Action {
        $rescueBody = @{ dryRun = $true; clearHttpProxy = $true }
        if ($DeviceId) { $rescueBody.deviceId = $DeviceId }

        if ($ExecuteAndroidRescue) {
            $rescueBody.dryRun = $false
        }

        $resp = Invoke-JsonPost -Path '/android/network/rescue' -Body $rescueBody
        if ($resp.statusCode -ne 200) {
            throw "Unexpected status code: $($resp.statusCode)"
        }
        return $resp.body
    } | Out-Null

    Invoke-Check -Name 'GET /android/network/capabilities' -Required $false -Action {
        $resp = Invoke-JsonGet -Path '/android/network/capabilities'
        if ($resp.statusCode -ne 200) {
            throw "Unexpected status code: $($resp.statusCode)"
        }
        return $resp.body
    } | Out-Null
}
else {
    Add-Result -Name 'POST /android/network/inspect' -Status 'SKIP' -Summary 'Skipped by default. Use -IncludeAndroid.' -Required $false
    Add-Result -Name 'POST /android/network/rescue' -Status 'SKIP' -Summary 'Skipped by default. Use -IncludeAndroid.' -Required $false
    Add-Result -Name 'GET /android/network/capabilities' -Status 'SKIP' -Summary 'Skipped by default. Use -IncludeAndroid.' -Required $false
}

if ($IncludeHeadless) {
    Invoke-Check -Name 'GET /headless/capabilities' -Required $false -Action {
        $resp = Invoke-JsonGet -Path '/headless/capabilities'
        if ($resp.statusCode -ne 200) {
            throw "Unexpected status code: $($resp.statusCode)"
        }
        return $resp.body
    } | Out-Null

    Invoke-Check -Name 'POST /headless/start' -Required $false -Action {
        $body = @{
            dryRun = -not $ExecuteHeadlessStart
        }

        if ($HeadlessCommand) { $body.command = $HeadlessCommand }
        if ($HeadlessArgs -and $HeadlessArgs.Count -gt 0) { $body.args = $HeadlessArgs }
        if ($HeadlessWorkingDir) { $body.workingDir = $HeadlessWorkingDir }

        $resp = Invoke-JsonPost -Path '/headless/start' -Body $body
        if ($resp.statusCode -ne 200) {
            throw "Unexpected status code: $($resp.statusCode)"
        }
        return $resp.body
    } | Out-Null
}
else {
    Add-Result -Name 'GET /headless/capabilities' -Status 'SKIP' -Summary 'Skipped by default. Use -IncludeHeadless.' -Required $false
    Add-Result -Name 'POST /headless/start' -Status 'SKIP' -Summary 'Skipped by default. Use -IncludeHeadless.' -Required $false
}

Invoke-Check -Name 'POST /export/match' -Required $true -Action {
    $resp = Invoke-JsonPost -Path '/export/match' -Body @{
        event = @{
            method = 'GET'
            url = 'https://example.com/api/books'
            statusCode = 200
        }
    }
    if ($resp.statusCode -ne 200) {
        throw "Unexpected status code: $($resp.statusCode)"
    }
    return $resp.body
} | Out-Null

$exportIngest = Invoke-Check -Name 'POST /export/ingest' -Required $true -Action {
    $resp = Invoke-JsonPost -Path '/export/ingest' -Body @{
        persist = [bool]$PersistExportTest
        event = @{
            timestamp = '2026-01-02T03:04:05.000Z'
            method = 'GET'
            url = 'https://example.com/api/books'
            statusCode = 200
            responseHeaders = @{ 'content-type' = 'application/json' }
            responseBody = '{"ok":true}'
        }
    }
    if ($resp.statusCode -ne 200) {
        throw "Unexpected status code: $($resp.statusCode)"
    }
    return $resp.body
}

$script:ExportOutputStatus = Invoke-Check -Name 'GET /export/output-status' -Required $true -Action {
    $resp = Invoke-JsonGet -Path '/export/output-status'
    if ($resp.statusCode -ne 200) {
        throw "Unexpected status code: $($resp.statusCode)"
    }
    return $resp.body
}

if ($PersistExportTest) {
    Invoke-Check -Name 'export persistence verification (persist=true)' -Required $true -Action {
        if ($null -eq $script:ExportOutputStatus) {
            throw 'Missing /export/output-status response for persistence verification.'
        }

        $exists = [bool]$script:ExportOutputStatus.exists
        $sizeBytes = 0
        if ($null -ne $script:ExportOutputStatus.sizeBytes) {
            $sizeBytes = [int64]$script:ExportOutputStatus.sizeBytes
        }

        if (-not $exists -or $sizeBytes -le 0) {
            throw ("Expected persisted JSONL output. exists={0}; sizeBytes={1}; jsonlPath={2}" -f $exists, $sizeBytes, $script:ExportOutputStatus.jsonlPath)
        }

        return @{
            exists = $exists
            sizeBytes = $sizeBytes
            jsonlPath = $script:ExportOutputStatus.jsonlPath
        }
    } | Out-Null
}
else {
    Add-Result -Name 'export persistence verification (persist=true)' -Status 'SKIP' -Summary 'Skipped. Use -PersistExportTest to require JSONL persistence validation.' -Required $false -Snippet @{ persist = $false }
}

Invoke-Check -Name 'GET /export/stream (expects requires-core-hook; HTTP 501 is PASS pre-core-hook)' -Required $true -Action {
    $resp = Invoke-JsonGet -Path '/export/stream'
    $statusCode = [int]$resp.statusCode

    $requiresCoreHook = $false
    if ($resp.body) {
        $requiresCoreHook = Test-ResponseRequiresCoreHook -Response $resp.body
    }

    if (-not $requiresCoreHook -and $resp.bodyText -and ($resp.bodyText -match 'requires-core-hook')) {
        $requiresCoreHook = $true
    }

    $migrationRegistryConfirms = Test-MigrationRegistryRequiresCoreHook -MigrationStatusBody $script:MigrationStatus

    if ($statusCode -eq 501 -and $requiresCoreHook) {
        return @{ statusCode = $statusCode; response = $resp.body; responseText = $resp.bodyText; validation = 'expected-501-requires-core-hook' }
    }

    if ($statusCode -eq 501 -and $migrationRegistryConfirms) {
        return @{
            statusCode = $statusCode
            response = $resp.body
            responseText = $resp.bodyText
            migrationStatusConfirmed = $true
            validation = 'expected-501-requires-core-hook-from-migration-status'
            note = '501 accepted because /migration/status marks GET /export/stream as requires-core-hook.'
        }
    }

    if ($statusCode -eq 200 -and $requiresCoreHook) {
        return @{ statusCode = $statusCode; response = $resp.body; responseText = $resp.bodyText; validation = 'allowed-200-requires-core-hook' }
    }

    if ($statusCode -eq 501) {
        throw "Expected requires-core-hook indicator for 501 response (body or /migration/status fallback). statusCode=$statusCode"
    }

    throw "Expected requires-core-hook stub with HTTP 501 (or 200 compatibility). statusCode=$statusCode"
} | Out-Null

if ($OfficialRoot) {
    if (-not (Test-Path -LiteralPath $OfficialRoot)) {
        Add-Result -Name 'official-core-cleanliness' -Status 'WARN' -Summary "OfficialRoot does not exist: $OfficialRoot" -Required $false
        $script:OfficialGitSummary = @{ officialRoot = $OfficialRoot; status = 'missing-path' }
    }
    else {
        $gitRoot = $null
        & git -C $OfficialRoot rev-parse --show-toplevel 2>$null | ForEach-Object { $gitRoot = $_ }
        if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($gitRoot)) {
            Add-Result -Name 'official-core-cleanliness' -Status 'WARN' -Summary 'OfficialRoot is not a git repository; cleanliness gate not evaluated.' -Required $false -Snippet @{ officialRoot = $OfficialRoot }
            $script:OfficialGitSummary = @{ officialRoot = $OfficialRoot; status = 'not-a-git-repo' }
        }
        else {
            $statusLines = & git -C $OfficialRoot status --short
            if ($LASTEXITCODE -ne 0) {
                Add-Result -Name 'official-core-cleanliness' -Status 'WARN' -Summary "git status --short failed with exit code $LASTEXITCODE" -Required $false -Snippet @{ officialRoot = $OfficialRoot }
                $script:OfficialGitSummary = @{ officialRoot = $OfficialRoot; status = 'git-status-failed'; exitCode = $LASTEXITCODE }
            }
            else {
                $dirtyPaths = @()
                foreach ($line in $statusLines) {
                    $path = Get-DirtyPathFromStatusLine -Line $line
                    if ($path) {
                        $dirtyPaths += $path
                    }
                }

                $forbiddenDirtyPaths = @()
                foreach ($path in $dirtyPaths) {
                    if (Test-ForbiddenOfficialPath -Path $path) {
                        $forbiddenDirtyPaths += $path
                    }
                }

                $script:OfficialGitSummary = @{
                    officialRoot = $OfficialRoot
                    gitRoot = $gitRoot.Trim()
                    dirty = [bool]($dirtyPaths.Count -gt 0)
                    dirtyPathCount = $dirtyPaths.Count
                    dirtyPaths = $dirtyPaths
                    forbiddenDirtyPaths = $forbiddenDirtyPaths
                    rawStatus = $statusLines
                }

                if ($forbiddenDirtyPaths.Count -gt 0) {
                    Add-Result -Name 'official-core-cleanliness' -Status 'FAIL' -Summary ("Forbidden dirty official-core paths detected: {0}" -f ($forbiddenDirtyPaths -join ', ')) -Required $false -Snippet $script:OfficialGitSummary
                }
                elseif ($dirtyPaths.Count -gt 0) {
                    Add-Result -Name 'official-core-cleanliness' -Status 'WARN' -Summary ("Official repo has non-core dirty paths: {0}" -f ($dirtyPaths -join ', ')) -Required $false -Snippet $script:OfficialGitSummary
                }
                else {
                    Add-Result -Name 'official-core-cleanliness' -Status 'PASS' -Summary 'Official repo is clean (git status --short empty).' -Required $false -Snippet $script:OfficialGitSummary
                }
            }
        }
    }
}
else {
    Add-Result -Name 'official-core-cleanliness' -Status 'SKIP' -Summary 'Skipped. Provide -OfficialRoot to evaluate official core cleanliness.' -Required $false
}

$requiredGateFailures = @()
foreach ($gate in $RequiredGateNames) {
    $gateResult = $script:Results | Where-Object { $_.Name -eq $gate } | Select-Object -Last 1
    if ($null -eq $gateResult -or $gateResult.Status -ne 'PASS') {
        $requiredGateFailures += $gate
    }
}

$officialCoreCleanlinessResult = $script:Results | Where-Object { $_.Name -eq 'official-core-cleanliness' } | Select-Object -Last 1
$officialCoreCleanlinessFailed = ($null -ne $officialCoreCleanlinessResult -and $officialCoreCleanlinessResult.Status -eq 'FAIL')

$exportIngestPassed = ($null -ne ($script:Results | Where-Object { $_.Name -eq 'POST /export/ingest' -and $_.Status -eq 'PASS' } | Select-Object -First 1))
$exportPersistencePassed = ($null -ne ($script:Results | Where-Object { $_.Name -eq 'export persistence verification (persist=true)' -and $_.Status -eq 'PASS' } | Select-Object -First 1))

$coreHookReasons = @()
if ($requiredGateFailures.Count -gt 0) {
    $coreHookReasons += ("Required gate(s) did not pass: {0}" -f ($requiredGateFailures -join ', '))
}
if ($officialCoreCleanlinessFailed) {
    $coreHookReasons += 'official-core-cleanliness failed.'
}
if (-not $exportIngestPassed) {
    $coreHookReasons += 'POST /export/ingest did not pass.'
}
if ($PersistExportTest -and -not $exportPersistencePassed) {
    $coreHookReasons += 'Persist export verification failed while -PersistExportTest was requested.'
}
if (-not $OfficialRoot) {
    $coreHookReasons += 'Official core cleanliness was not evaluated because -OfficialRoot was not provided.'
}
$officialRootMissingPath = ($null -ne $officialCoreCleanlinessResult -and $officialCoreCleanlinessResult.Status -eq 'WARN' -and $officialCoreCleanlinessResult.Summary -like 'OfficialRoot does not exist:*')
if ($officialRootMissingPath) {
    $coreHookReasons += 'OfficialRoot path was missing. Create the clean official repo path or omit -OfficialRoot.'
}

$script:SafeToProceedToCoreHook = ($requiredGateFailures.Count -eq 0) -and (-not $officialCoreCleanlinessFailed) -and $exportIngestPassed -and ((-not $PersistExportTest) -or $exportPersistencePassed)
$script:CoreHookReasons = $coreHookReasons

if (@($script:Results | Where-Object { $_.Status -eq 'FAIL' }).Count -gt 0) {
    $script:FinalRecommendation = 'Do not proceed; fix failed checks first'
}
elseif ($script:SafeToProceedToCoreHook) {
    $script:FinalRecommendation = 'Ready to consider minimal core hook'
}
else {
    $script:FinalRecommendation = 'Ready for addon-only real validation'
}

Write-ValidationReport
Write-Summary

if (@($script:Results | Where-Object { $_.Status -eq 'FAIL' -and $_.Required }).Count -gt 0) {
    exit 1
}

exit 0
