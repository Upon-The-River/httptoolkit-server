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
    [switch]$FailFast
)

$ErrorActionPreference = 'Stop'

$script:Results = New-Object System.Collections.Generic.List[object]
$script:RequiredFailure = $false

function Add-Result {
    param(
        [string]$Name,
        [ValidateSet('PASS', 'FAIL', 'SKIP', 'WARN')]
        [string]$Status,
        [string]$Details,
        [bool]$Required = $true,
        [object]$Snippet = $null
    )

    $entry = [pscustomobject]@{
        Name     = $Name
        Status   = $Status
        Required = $Required
        Details  = $Details
        Snippet  = if ($null -ne $Snippet) { ($Snippet | ConvertTo-Json -Depth 10 -Compress) } else { '' }
    }

    $script:Results.Add($entry) | Out-Null

    if ($Required -and $Status -eq 'FAIL') {
        $script:RequiredFailure = $true
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
        Add-Result -Name $Name -Status 'SKIP' -Details $SkipReason -Required $Required
        return $null
    }

    try {
        $result = & $Action
        Add-Result -Name $Name -Status 'PASS' -Details 'OK' -Required $Required -Snippet $result
        return $result
    }
    catch {
        Add-Result -Name $Name -Status 'FAIL' -Details $_.Exception.Message -Required $Required
        if ($FailFast) {
            Write-Summary
            exit 1
        }
        return $null
    }
}

function Invoke-JsonGet {
    param([string]$Path)

    $uri = "{0}{1}" -f $AddonBaseUrl.TrimEnd('/'), $Path

    try {
        $body = Invoke-RestMethod -Method Get -Uri $uri
        return [pscustomobject]@{
            statusCode = 200
            body       = $body
        }
    }
    catch {
        $resp = $_.Exception.Response
        if ($null -eq $resp) { throw }

        $statusCode = [int]$resp.StatusCode
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $text = $reader.ReadToEnd()
        $reader.Close()

        $parsed = $null
        try { $parsed = $text | ConvertFrom-Json } catch { }

        return [pscustomobject]@{
            statusCode = $statusCode
            bodyText   = $text
            body       = $parsed
        }
    }
}

function Invoke-JsonPost {
    param(
        [string]$Path,
        [object]$Body
    )

    $uri = "{0}{1}" -f $AddonBaseUrl.TrimEnd('/'), $Path
    $json = $Body | ConvertTo-Json -Depth 20

    try {
        $respBody = Invoke-RestMethod -Method Post -Uri $uri -ContentType 'application/json' -Body $json
        return [pscustomobject]@{
            statusCode = 200
            body       = $respBody
        }
    }
    catch {
        $resp = $_.Exception.Response
        if ($null -eq $resp) { throw }

        $statusCode = [int]$resp.StatusCode
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $text = $reader.ReadToEnd()
        $reader.Close()

        $parsed = $null
        try { $parsed = $text | ConvertFrom-Json } catch { }

        return [pscustomobject]@{
            statusCode = $statusCode
            bodyText   = $text
            body       = $parsed
        }
    }
}

function Write-Summary {
    $pass = @($script:Results | Where-Object { $_.Status -eq 'PASS' }).Count
    $fail = @($script:Results | Where-Object { $_.Status -eq 'FAIL' }).Count
    $skip = @($script:Results | Where-Object { $_.Status -eq 'SKIP' }).Count
    $warn = @($script:Results | Where-Object { $_.Status -eq 'WARN' }).Count

    Write-Host ''
    Write-Host '=== lab-addon validation summary ==='
    Write-Host ("Pass: {0}  Fail: {1}  Skip: {2}  Warn: {3}" -f $pass, $fail, $skip, $warn)
    Write-Host ''

    $script:Results |
        Select-Object Name, Status, Required, Details |
        Format-Table -AutoSize |
        Out-String |
        Write-Host

    $snippets = $script:Results | Where-Object { $_.Snippet -ne '' }
    if ($snippets.Count -gt 0) {
        Write-Host 'Endpoint/result snippets:'
        foreach ($item in $snippets) {
            Write-Host ("- {0}: {1}" -f $item.Name, $item.Snippet)
        }
    }

    Write-Host ''
    Write-Host 'Next actions:'
    if ($script:RequiredFailure) {
        Write-Host '- Resolve required failures shown above, then rerun this script.'
    }
    else {
        Write-Host '- Required checks passed.'
    }

    if (-not $IncludeAndroid) {
        Write-Host '- Android checks were skipped by default. Add -IncludeAndroid to validate device flows.'
    }

    if (-not $IncludeHeadless) {
        Write-Host '- Headless checks were skipped by default. Add -IncludeHeadless for headless validation.'
    }

    if (-not $PersistExportTest) {
        Write-Host '- Export persistence test ran with persist=false. Add -PersistExportTest to verify JSONL writes.'
    }
}

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$labAddonRoot = Resolve-Path (Join-Path $scriptRoot '..')

Write-Host "Script root: $scriptRoot"
Write-Host "Lab addon root: $labAddonRoot"
Write-Host "Addon base URL: $AddonBaseUrl"

Push-Location $labAddonRoot
try {
    Invoke-Check -Name 'npm install' -Required $true -Skip:$SkipNpm -SkipReason 'Skipped by -SkipNpm' -Action {
        & npm install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed with exit code $LASTEXITCODE"
        }
        return @{ exitCode = $LASTEXITCODE }
    } | Out-Null

    Invoke-Check -Name 'npm run typecheck' -Required $true -Skip:$SkipNpm -SkipReason 'Skipped by -SkipNpm' -Action {
        & npm run typecheck
        if ($LASTEXITCODE -ne 0) {
            throw "npm run typecheck failed with exit code $LASTEXITCODE"
        }
        return @{ exitCode = $LASTEXITCODE }
    } | Out-Null

    Invoke-Check -Name 'npm test' -Required $true -Skip:$SkipTests -SkipReason 'Skipped by -SkipTests' -Action {
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

Invoke-Check -Name 'GET /migration/status' -Required $true -Action {
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

Invoke-Check -Name 'POST /session/start' -Required $true -Action {
    $resp = Invoke-JsonPost -Path '/session/start' -Body @{ target = 'validation-smoke' }
    if ($resp.statusCode -ne 200) {
        throw "Unexpected status code: $($resp.statusCode)"
    }
    return $resp.body
} | Out-Null

Invoke-Check -Name 'GET /session/latest' -Required $true -Action {
    $resp = Invoke-JsonGet -Path '/session/latest'
    if ($resp.statusCode -ne 200) {
        throw "Unexpected status code: $($resp.statusCode)"
    }
    return $resp.body
} | Out-Null

if ($IncludeAndroid) {
    Invoke-Check -Name 'POST /android/network/inspect' -Required $true -Action {
        $body = @{}
        if ($DeviceId) { $body.deviceId = $DeviceId }
        $resp = Invoke-JsonPost -Path '/android/network/inspect' -Body $body
        if ($resp.statusCode -ne 200) {
            throw "Unexpected status code: $($resp.statusCode)"
        }
        return $resp.body
    } | Out-Null

    Invoke-Check -Name 'POST /android/network/rescue' -Required $true -Action {
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

    Invoke-Check -Name 'GET /android/network/capabilities' -Required $true -Action {
        $resp = Invoke-JsonGet -Path '/android/network/capabilities'
        if ($resp.statusCode -ne 200) {
            throw "Unexpected status code: $($resp.statusCode)"
        }
        return $resp.body
    } | Out-Null
}
else {
    Add-Result -Name 'POST /android/network/inspect' -Status 'SKIP' -Details 'Skipped by default. Use -IncludeAndroid.' -Required $false
    Add-Result -Name 'POST /android/network/rescue' -Status 'SKIP' -Details 'Skipped by default. Use -IncludeAndroid.' -Required $false
    Add-Result -Name 'GET /android/network/capabilities' -Status 'SKIP' -Details 'Skipped by default. Use -IncludeAndroid.' -Required $false
}

if ($IncludeHeadless) {
    Invoke-Check -Name 'GET /headless/capabilities' -Required $true -Action {
        $resp = Invoke-JsonGet -Path '/headless/capabilities'
        if ($resp.statusCode -ne 200) {
            throw "Unexpected status code: $($resp.statusCode)"
        }
        return $resp.body
    } | Out-Null

    Invoke-Check -Name 'POST /headless/start' -Required $true -Action {
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
    Add-Result -Name 'GET /headless/capabilities' -Status 'SKIP' -Details 'Skipped by default. Use -IncludeHeadless.' -Required $false
    Add-Result -Name 'POST /headless/start' -Status 'SKIP' -Details 'Skipped by default. Use -IncludeHeadless.' -Required $false
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

Invoke-Check -Name 'POST /export/ingest' -Required $true -Action {
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
} | Out-Null

Invoke-Check -Name 'GET /export/output-status' -Required $true -Action {
    $resp = Invoke-JsonGet -Path '/export/output-status'
    if ($resp.statusCode -ne 200) {
        throw "Unexpected status code: $($resp.statusCode)"
    }
    return $resp.body
} | Out-Null

Invoke-Check -Name 'GET /export/stream (expects requires-core-hook)' -Required $true -Action {
    $resp = Invoke-JsonGet -Path '/export/stream'
    $statusOk = $resp.statusCode -eq 501 -or $resp.statusCode -eq 200

    $requiresCoreHook = $false
    if ($resp.body) {
        if ($resp.body.status -eq 'requires-core-hook') { $requiresCoreHook = $true }
        if ($resp.body.implemented -eq $false -and $resp.body.requiresCoreHook -eq $true) { $requiresCoreHook = $true }
    }
    elseif ($resp.bodyText -and ($resp.bodyText -match 'requires-core-hook')) {
        $requiresCoreHook = $true
    }

    if (-not $statusOk -or -not $requiresCoreHook) {
        throw "Expected requires-core-hook stub. statusCode=$($resp.statusCode)"
    }

    return @{ statusCode = $resp.statusCode; response = $resp.body }
} | Out-Null

if ($OfficialRoot) {
    Invoke-Check -Name 'Official repo git status --short' -Required $true -Action {
        if (-not (Test-Path -LiteralPath $OfficialRoot)) {
            throw "OfficialRoot does not exist: $OfficialRoot"
        }

        $statusLines = & git -C $OfficialRoot status --short
        if ($LASTEXITCODE -ne 0) {
            throw "git status failed with exit code $LASTEXITCODE"
        }

        return @{
            officialRoot = $OfficialRoot
            dirty = [bool]($statusLines)
            status = $statusLines
        }
    } | Out-Null
}
else {
    Add-Result -Name 'Official repo git status --short' -Status 'SKIP' -Details 'Skipped. Provide -OfficialRoot to verify official repo cleanliness.' -Required $false
}

Write-Summary

if ($script:RequiredFailure) {
    exit 1
}

exit 0
