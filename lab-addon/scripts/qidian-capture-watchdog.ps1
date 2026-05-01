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
    try { $adbOk = ((& adb get-state 2>$null) -match 'device') } catch {}
    $phonePingIpOk = $true; $phonePingDnsOk = $true
    if ($CheckPhoneNetwork) {
      try { $phonePingIpOk = ((& adb shell ping -c 1 223.5.5.5 2>$null) -match '1 received|1 packets received') } catch { $phonePingIpOk = $false }
      if ($CheckDns) {
        try { $phonePingDnsOk = ((& adb shell ping -c 1 qidian.com 2>$null) -match '1 received|1 packets received') } catch { $phonePingDnsOk = $false }
      }
    }

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
    $shouldActivate = $AutoActivate -and $secondsSinceGrowth -ge $NoGrowthActivateSeconds -and (-not $lastActivateAt -or $secondsSinceActivate -ge $ActivationCooldownSeconds)

    if ($shouldActivate) {
      if (-not $phonePingIpOk) { $lastAlert = 'phone-network-down' }
      elseif (-not $addonHealthOk -or -not $bridgeHealthOk) { $lastAlert = 'service-down' }
      elseif (-not $adbOk) { $lastAlert = 'adb-not-ready' }
      else {
        $lastActivateAt = $checkedAt
        try {
          $resp = Invoke-QidianJson -Method POST -Uri ("{0}/automation/android-adb/start-headless" -f $BridgeBaseUrl.TrimEnd('/')) -Body @{
            deviceId = $DeviceId; proxyPort = $ProxyPort; allowUnsafeStart = $true; enableSocks = $false; waitForTraffic = $false; waitForTargetTraffic = $false
          }
          $lastActivationResult = ($resp | ConvertTo-Json -Compress)
          if ($resp.success -eq $true) { $lastAlert = 'activation-attempt-ok' } else { $lastAlert = 'activation-attempt-failed' }
        } catch {
          $msg = $_.Exception.Message
          if ($msg -match 'EADDRINUSE') { $lastActivationResult = 'warning-existing-session-possible(EADDRINUSE)'; $lastAlert = 'activation-warning-eaddrinuse' }
          else { $lastActivationResult = "error: $msg"; $lastAlert = 'activation-attempt-error' }
        }
      }
      if ($lastAlert) {
        "[$($checkedAt.ToString('o'))] $lastAlert" | Add-Content -Path $AlertLogPath -Encoding utf8
        if ($Beep) { [console]::beep(900, 150) }
      }
    }

    $statusObj = [ordered]@{
      checkedAt = $checkedAt.ToString('o'); ports = $ports; addonHealthOk = $addonHealthOk; bridgeHealthOk = $bridgeHealthOk; exportStatusOk = $exportStatusOk;
      jsonlPath = $jsonlPath; jsonlSizeBytes = $jsonlSizeBytes; lastGrowthAt = $lastGrowthAt.ToString('o'); secondsSinceGrowth = $secondsSinceGrowth;
      lastTargetHitAt = if ($lastTargetHitAt) { $lastTargetHitAt.ToString('o') } else { $null };
      secondsSinceTargetHit = if ($lastTargetHitAt) { [int](($checkedAt - $lastTargetHitAt).TotalSeconds) } else { $null };
      lastActivateAt = if ($lastActivateAt) { $lastActivateAt.ToString('o') } else { $null };
      secondsSinceActivate = $secondsSinceActivate; adbOk = $adbOk; phonePingIpOk = $phonePingIpOk; phonePingDnsOk = $phonePingDnsOk;
      autoActivateEnabled = $AutoActivate; lastActivationResult = $lastActivationResult; lastAlert = $lastAlert
    }
    $statusObj | ConvertTo-Json -Depth 6 | Set-Content -Path $StatusPath -Encoding utf8
    Start-Sleep -Seconds $PollSeconds
}
