[CmdletBinding()]
param(
    [string]$AddonBaseUrl = 'http://127.0.0.1:45459',
    [string]$BridgeBaseUrl = 'http://127.0.0.1:45458',
    [string]$DeviceId = '23091JEGR04484',
    [int]$ProxyPort = 8000,
    [string]$ExportDir = $(if ($env:HTK_LAB_ADDON_EXPORT_DIR) { $env:HTK_LAB_ADDON_EXPORT_DIR } else { 'C:\Users\Card\Desktop\DataBase\httptoolkit_exports\qidian' }),
    [int]$PollSeconds = 30,
    [int]$NoGrowthActivateSeconds = 60,
    [int]$ActivationCooldownSeconds = 180,
    [int]$AlertCooldownSeconds = 180,
    [bool]$AutoActivate = $true,
    [bool]$CheckPhoneNetwork = $true,
    [bool]$CheckDns = $true,
    [bool]$Beep = $true,
    [string]$AlertLogPath,
    [string]$StatusPath
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/lib/qidian-capture-common.ps1"
Set-QidianCaptureUtf8
if (-not $AlertLogPath) { $AlertLogPath = Join-Path $ExportDir 'watchdog_alerts.log' }
if (-not $StatusPath) { $StatusPath = Join-Path $ExportDir 'watchdog_status.json' }
$jsonlPath = Join-Path $ExportDir 'session_hits.jsonl'
New-Item -ItemType Directory -Path $ExportDir -Force | Out-Null
$portsToCheck = @(45456,45457,45458,45459,8000)
$lastSize = if (Test-Path $jsonlPath) { (Get-Item $jsonlPath).Length } else { 0 }
$lastGrowthAt = Get-Date
$lastTargetHitAt = $null
$lastActivateAt = $null
$lastActivationResult = 'none'
$lastAlert = $null
$lastAlertsByKey = @{}

function Write-WatchdogAlert {
    param(
        [Parameter(Mandatory = $true)][datetime]$CheckedAt,
        [Parameter(Mandatory = $true)][string]$AlertKey,
        [string]$Message = $AlertKey
    )

    $lastAlertAt = $null
    if ($lastAlertsByKey.ContainsKey($AlertKey)) { $lastAlertAt = $lastAlertsByKey[$AlertKey] }
    $withinCooldown = $false
    if ($lastAlertAt) {
        $withinCooldown = (($CheckedAt - $lastAlertAt).TotalSeconds -lt $AlertCooldownSeconds)
    }
    if ($withinCooldown) { return $false }

    $script:lastAlertsByKey[$AlertKey] = $CheckedAt
    $script:lastAlert = $AlertKey
    "[$($CheckedAt.ToString('o'))] $AlertKey $Message" | Add-Content -Path $AlertLogPath -Encoding utf8
    if ($Beep) { [console]::beep(900, 150) }
    return $true
}

while ($true) {
    $checkedAt = Get-Date
    $ports = @{}
    foreach ($p in $portsToCheck) { $ports["$p"] = Test-QidianPort -Port $p }
    $addonHealthOk = $false; $bridgeHealthOk = $false; $exportStatusOk = $false; $status = $null
    try { $addonHealthOk = [bool](Invoke-QidianJson -Method GET -Uri ("{0}/health" -f $AddonBaseUrl.TrimEnd('/'))) } catch {}
    try { $bridgeHealthOk = [bool](Invoke-QidianJson -Method GET -Uri ("{0}/automation/health" -f $BridgeBaseUrl.TrimEnd('/'))) } catch {}
    try { $status = Get-QidianExportStatus -AddonBaseUrl $AddonBaseUrl; $exportStatusOk = $true } catch {}
    $jsonlSizeBytes = if ($status) { [int64]$status.sizeBytes } elseif (Test-Path $jsonlPath) { (Get-Item $jsonlPath).Length } else { 0 }
    $adbOk = $false
    try { $adbOk = ((& adb -s $DeviceId get-state 2>$null) -match 'device') } catch {}
    $phonePingIpOk = $true; $phonePingDnsOk = $true
    if ($CheckPhoneNetwork) {
      try { $phonePingIpOk = ((& adb -s $DeviceId shell "ping -c 1 -W 3 223.5.5.5" 2>$null) -match '1 received|1 packets received') } catch { $phonePingIpOk = $false }
      if ($CheckDns) {
        try { $phonePingDnsOk = ((& adb -s $DeviceId shell "ping -c 1 -W 3 qidian.com" 2>$null) -match '1 received|1 packets received') } catch { $phonePingDnsOk = $false }
      }
    }
    $proxyPortOpen = [bool]$ports['8000']
    $criticalPortsOk = [bool]$ports['45458'] -and [bool]$ports['45459']

    if (-not $addonHealthOk) { [void](Write-WatchdogAlert -CheckedAt $checkedAt -AlertKey 'addon-health-down' -Message 'Addon /health is not healthy') }
    if (-not $bridgeHealthOk) { [void](Write-WatchdogAlert -CheckedAt $checkedAt -AlertKey 'bridge-health-down' -Message 'Bridge /automation/health is not healthy') }
    if (-not $exportStatusOk) { [void](Write-WatchdogAlert -CheckedAt $checkedAt -AlertKey 'export-status-down' -Message 'Addon /export/output-status failed') }
    if (-not $adbOk) { [void](Write-WatchdogAlert -CheckedAt $checkedAt -AlertKey 'adb-not-ready' -Message "adb not ready for deviceId=$DeviceId") }
    if (-not $phonePingIpOk) { [void](Write-WatchdogAlert -CheckedAt $checkedAt -AlertKey 'phone-network-ip-down' -Message "Phone ping IP failed for deviceId=$DeviceId") }
    if ($CheckDns -and -not $phonePingDnsOk) { [void](Write-WatchdogAlert -CheckedAt $checkedAt -AlertKey 'phone-network-dns-down' -Message "Phone ping DNS failed for deviceId=$DeviceId") }
    if (-not $criticalPortsOk) { [void](Write-WatchdogAlert -CheckedAt $checkedAt -AlertKey 'critical-port-down' -Message 'Required local ports 45458/45459 are not both open') }
    if ($jsonlSizeBytes -gt $lastSize) {
      $lastGrowthAt = $checkedAt
      $hits = Get-QidianTargetHitsSinceOffset -JsonlPath $jsonlPath -OffsetBytes $lastSize -Pattern 'qidian.com|druidv6.if.qidian.com' -MaxSamples 5
      if ($hits.matched) {
        $lastTargetHitAt = $checkedAt
        Write-Host "[$($checkedAt.ToString('HH:mm:ss'))] sizeBytes=$jsonlSizeBytes appended HIT: $($hits.sampleUrls -join '; ')"
      } else {
        Write-Host "[$($checkedAt.ToString('HH:mm:ss'))] sizeBytes=$jsonlSizeBytes appended no target hit"
      }
      $lastSize = $jsonlSizeBytes
    } else {
      Write-Host "[$($checkedAt.ToString('HH:mm:ss'))] sizeBytes=$jsonlSizeBytes, no new response"
    }

    $secondsSinceGrowth = [int](($checkedAt - $lastGrowthAt).TotalSeconds)
    $secondsSinceActivate = if ($lastActivateAt) { [int](($checkedAt - $lastActivateAt).TotalSeconds) } else { $null }
    if (-not $proxyPortOpen -and $secondsSinceGrowth -ge $NoGrowthActivateSeconds) {
      [void](Write-WatchdogAlert -CheckedAt $checkedAt -AlertKey 'proxy-port-down-warning' -Message 'Proxy port 8000 is closed (warning-only; JSONL growth is source of truth)')
    }
    $activationPrereqsOk = $adbOk -and $phonePingIpOk -and $addonHealthOk -and $bridgeHealthOk
    $shouldActivate = $AutoActivate -and $activationPrereqsOk -and $secondsSinceGrowth -ge $NoGrowthActivateSeconds -and (-not $lastActivateAt -or $secondsSinceActivate -ge $ActivationCooldownSeconds)

    if ($shouldActivate) {
      $lastActivateAt = $checkedAt
      try {
        $resp = Invoke-QidianJson -Method POST -Uri ("{0}/automation/android-adb/start-headless" -f $AddonBaseUrl.TrimEnd('/')) -Body @{
          deviceId = $DeviceId; proxyPort = $ProxyPort; allowUnsafeStart = $true; enableSocks = $false; waitForTraffic = $false; waitForTargetTraffic = $false
        }
        $lastActivationResult = ($resp | ConvertTo-Json -Compress)
        if ($resp.success -eq $true) { [void](Write-WatchdogAlert -CheckedAt $checkedAt -AlertKey 'activation-attempt-ok' -Message 'Auto-activation succeeded') }
        else { [void](Write-WatchdogAlert -CheckedAt $checkedAt -AlertKey 'activation-attempt-failed' -Message 'Auto-activation response was not success=true') }
      } catch {
        $msg = $_.Exception.Message
        if ($msg -match 'EADDRINUSE') {
          $lastActivationResult = 'warning-existing-session-possible(EADDRINUSE)'
          [void](Write-WatchdogAlert -CheckedAt $checkedAt -AlertKey 'activation-warning-eaddrinuse' -Message 'Start-headless returned EADDRINUSE; existing session may still be active')
        }
        else {
          $lastActivationResult = "error: $msg"
          [void](Write-WatchdogAlert -CheckedAt $checkedAt -AlertKey 'activation-attempt-error' -Message $msg)
        }
      }
    }

    $statusObj = [ordered]@{
      checkedAt = $checkedAt.ToString('o'); ports = $ports; proxyPortOpen = $proxyPortOpen; addonHealthOk = $addonHealthOk; bridgeHealthOk = $bridgeHealthOk; exportStatusOk = $exportStatusOk;
      jsonlPath = $jsonlPath; jsonlSizeBytes = $jsonlSizeBytes; lastGrowthAt = $lastGrowthAt.ToString('o'); secondsSinceGrowth = $secondsSinceGrowth;
      lastTargetHitAt = if ($lastTargetHitAt) { $lastTargetHitAt.ToString('o') } else { $null };
      secondsSinceTargetHit = if ($lastTargetHitAt) { [int](($checkedAt - $lastTargetHitAt).TotalSeconds) } else { $null };
      lastActivateAt = if ($lastActivateAt) { $lastActivateAt.ToString('o') } else { $null };
      secondsSinceActivate = $secondsSinceActivate; adbOk = $adbOk; phonePingIpOk = $phonePingIpOk; phonePingDnsOk = $phonePingDnsOk;
      autoActivateEnabled = $AutoActivate; noGrowthActivateSeconds = $NoGrowthActivateSeconds; activationCooldownSeconds = $ActivationCooldownSeconds; alertCooldownSeconds = $AlertCooldownSeconds;
      lastActivationResult = $lastActivationResult; activeAlerts = @($lastAlertsByKey.Keys | Sort-Object); lastAlert = $lastAlert
    }
    $statusObj | ConvertTo-Json -Depth 6 | Set-Content -Path $StatusPath -Encoding utf8
    Start-Sleep -Seconds $PollSeconds
}
