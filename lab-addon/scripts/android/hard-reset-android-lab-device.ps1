param(
  [Parameter(Mandatory = $true)]
  [string]$DeviceId,
  [switch]$ClearQidianData,
  [switch]$ClearWebViewData,
  [switch]$ClearChromeData,
  [switch]$ClearToolkitData,
  [switch]$Reboot
)

if (-not $PSBoundParameters.ContainsKey('ClearWebViewData')) { $ClearWebViewData = $true }
if (-not $PSBoundParameters.ContainsKey('ClearChromeData')) { $ClearChromeData = $true }
if (-not $PSBoundParameters.ContainsKey('ClearToolkitData')) { $ClearToolkitData = $true }
if (-not $PSBoundParameters.ContainsKey('Reboot')) { $Reboot = $true }

$ErrorActionPreference = 'Continue'

$timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$outputDir = Join-Path (Join-Path $PSScriptRoot '..\exports') "android_hard_reset_$timestamp"
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null

$actions = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()
$toolkitPackagesCleared = @()
$qidianDataCleared = $false
$webViewDataCleared = $false

function Invoke-Adb {
  param(
    [string[]]$AdbArgs,
    [switch]$AllowFailure
  )

  $output = (& adb -s $DeviceId @AdbArgs 2>&1 | Out-String)
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0 -and -not $AllowFailure) {
    throw "adb failed: adb -s $DeviceId $($AdbArgs -join ' ')`n$output"
  }

  return [PSCustomObject]@{
    Output = $output.Trim()
    ExitCode = $exitCode
  }
}

function Save-Diagnostic {
  param(
    [string]$FileName,
    [string[]]$AdbArgs
  )

  try {
    $result = Invoke-Adb -AdbArgs $AdbArgs -AllowFailure
    Set-Content -Path (Join-Path $outputDir $FileName) -Value $result.Output -Encoding utf8
  } catch {
    Set-Content -Path (Join-Path $outputDir $FileName) -Value ("ERROR: " + $_.Exception.Message) -Encoding utf8
    $warnings.Add("failed to capture $FileName") | Out-Null
  }
}

$stopHeadlessUrl = 'http://127.0.0.1:45457/automation/android-adb/stop-headless'
try {
  $null = Invoke-RestMethod -Method Post -Uri $stopHeadlessUrl -Headers @{ Origin = 'https://app.httptoolkit.tech' } -Body (@{ deviceId = $DeviceId; aggressive = $true } | ConvertTo-Json) -ContentType 'application/json' -TimeoutSec 8
  $actions.Add('stop-headless-api-called') | Out-Null
} catch {
  $warnings.Add("stop-headless API unavailable: $($_.Exception.Message)") | Out-Null
}

Save-Diagnostic -FileName 'identity.txt' -AdbArgs @('shell', 'id')
Save-Diagnostic -FileName 'settings_before.txt' -AdbArgs @('shell', 'settings', 'list', 'global')
Save-Diagnostic -FileName 'route_before.txt' -AdbArgs @('shell', 'ip', 'route')
Save-Diagnostic -FileName 'ip_rule_before.txt' -AdbArgs @('shell', 'ip', 'rule')

$suId = Invoke-Adb -AdbArgs @('shell', 'su', '-c', 'id') -AllowFailure
$hasRootSu = $suId.Output -match 'uid=0'
if (-not $hasRootSu) {
  $warnings.Add('su is unavailable or not root (uid=0 not detected), privileged cleanup may be partial') | Out-Null
}

if ($hasRootSu) {
  $iptables = Invoke-Adb -AdbArgs @('shell', 'su', '-c', 'iptables -S') -AllowFailure
  Set-Content -Path (Join-Path $outputDir 'iptables_before.txt') -Value $iptables.Output -Encoding utf8
} else {
  Set-Content -Path (Join-Path $outputDir 'iptables_before.txt') -Value 'WARNING: no root su, iptables snapshot unavailable' -Encoding utf8
}

foreach ($pkg in @(
  'tech.httptoolkit.android.v1',
  'tech.httptoolkit.android',
  'com.qidian.QDReader',
  'com.android.chrome',
  'com.google.android.webview'
)) {
  $null = Invoke-Adb -AdbArgs @('shell', 'am', 'force-stop', $pkg) -AllowFailure
  $actions.Add("force-stop:$pkg") | Out-Null
}

foreach ($settingOp in @(
  @('delete', 'global', 'http_proxy'),
  @('delete', 'global', 'global_http_proxy_host'),
  @('delete', 'global', 'global_http_proxy_port'),
  @('delete', 'global', 'global_http_proxy_exclusion_list'),
  @('put', 'global', 'http_proxy', ':0'),
  @('put', 'global', 'private_dns_mode', 'off'),
  @('delete', 'global', 'private_dns_specifier'),
  @('delete', 'secure', 'always_on_vpn_app'),
  @('put', 'secure', 'lockdown_vpn', '0')
)) {
  $null = Invoke-Adb -AdbArgs (@('shell', 'settings') + $settingOp) -AllowFailure
  $actions.Add("settings:$($settingOp -join ' ')") | Out-Null
}

$null = Invoke-Adb -AdbArgs @('reverse', '--remove-all') -AllowFailure
$actions.Add('adb-reverse-remove-all') | Out-Null

if ($ClearToolkitData) {
  $listOutput = Invoke-Adb -AdbArgs @('shell', 'pm', 'list', 'packages') -AllowFailure
  $toolkitPackages = @($listOutput.Output -split "`r?`n" | Where-Object { $_ -match 'httptoolkit' } | ForEach-Object { ($_ -replace '^package:', '').Trim() } | Where-Object { $_ })
  foreach ($pkg in $toolkitPackages) {
    $null = Invoke-Adb -AdbArgs @('shell', 'am', 'force-stop', $pkg) -AllowFailure
    $null = Invoke-Adb -AdbArgs @('shell', 'pm', 'clear', $pkg) -AllowFailure
    $toolkitPackagesCleared += $pkg
    $actions.Add("toolkit-clear:$pkg") | Out-Null
  }
}

if ($ClearChromeData) {
  $null = Invoke-Adb -AdbArgs @('shell', 'pm', 'clear', 'com.android.chrome') -AllowFailure
  $actions.Add('pm-clear:com.android.chrome') | Out-Null
}

if ($ClearWebViewData) {
  $null = Invoke-Adb -AdbArgs @('shell', 'pm', 'clear', 'com.google.android.webview') -AllowFailure
  $webViewDataCleared = $true
  $actions.Add('pm-clear:com.google.android.webview') | Out-Null
}

if ($ClearQidianData) {
  $null = Invoke-Adb -AdbArgs @('shell', 'pm', 'clear', 'com.qidian.QDReader') -AllowFailure
  $qidianDataCleared = $true
  $actions.Add('pm-clear:com.qidian.QDReader') | Out-Null
} else {
  foreach ($dirPath in @(
    '/data/data/com.qidian.QDReader/app_webview',
    '/data/data/com.qidian.QDReader/cache',
    '/data/data/com.qidian.QDReader/code_cache'
  )) {
    if ($hasRootSu) {
      $null = Invoke-Adb -AdbArgs @('shell', 'su', '-c', "rm -rf $dirPath") -AllowFailure
      $actions.Add("qidian-rm:$dirPath") | Out-Null
    } else {
      $null = Invoke-Adb -AdbArgs @('shell', 'rm', '-rf', $dirPath) -AllowFailure
      $warnings.Add("no root su for qidian path cleanup: $dirPath") | Out-Null
    }
  }
}

if ($hasRootSu) {
  foreach ($cleanupCommand in @(
    'iptables -F',
    'iptables -X',
    'iptables -t nat -F',
    'iptables -t nat -X',
    'iptables -t mangle -F',
    'iptables -t mangle -X',
    'ip6tables -F',
    'ip6tables -X',
    'ip6tables -t nat -F',
    'ip6tables -t nat -X',
    'ip6tables -t mangle -F',
    'ip6tables -t mangle -X'
  )) {
    $cleanupResult = Invoke-Adb -AdbArgs @('shell', 'su', '-c', $cleanupCommand) -AllowFailure
    if ($cleanupResult.ExitCode -eq 0) {
      $actions.Add("netfilter-clean:$cleanupCommand") | Out-Null
    } else {
      $warnings.Add("netfilter cleanup command failed (non-fatal): $cleanupCommand :: $($cleanupResult.Output)") | Out-Null
    }
  }
} else {
  $warnings.Add('iptables cleanup skipped because su is not root') | Out-Null
}

$null = Invoke-Adb -AdbArgs @('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable') -AllowFailure
$null = Invoke-Adb -AdbArgs @('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable') -AllowFailure
$actions.Add('airplane-mode-toggle') | Out-Null

$null = Invoke-Adb -AdbArgs @('shell', 'svc', 'wifi', 'disable') -AllowFailure
$null = Invoke-Adb -AdbArgs @('shell', 'svc', 'wifi', 'enable') -AllowFailure
$actions.Add('wifi-toggle') | Out-Null

$null = Invoke-Adb -AdbArgs @('shell', 'svc', 'data', 'disable') -AllowFailure
$null = Invoke-Adb -AdbArgs @('shell', 'svc', 'data', 'enable') -AllowFailure
$actions.Add('data-toggle') | Out-Null

if ($Reboot) {
  $null = Invoke-Adb -AdbArgs @('reboot') -AllowFailure
  $actions.Add('reboot') | Out-Null
}

[PSCustomObject]@{
  deviceId = $DeviceId
  actions = @($actions)
  warnings = @($warnings)
  rebootRequested = [bool]$Reboot
  qidianDataCleared = $qidianDataCleared
  webViewDataCleared = $webViewDataCleared
  toolkitPackagesCleared = @($toolkitPackagesCleared)
} | ConvertTo-Json -Depth 6
