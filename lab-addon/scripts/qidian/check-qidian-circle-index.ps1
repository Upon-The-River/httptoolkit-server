param(
  [Parameter(Mandatory = $true)]
  [string]$DeviceId,
  [int]$ObserveSeconds = 30,
  [switch]$RequireCleanNetwork,
  [string]$OutputDir
)

if (-not $PSBoundParameters.ContainsKey('RequireCleanNetwork')) { $RequireCleanNetwork = $true }
if (-not $OutputDir) {
  $timestamp = Get-Date -Format 'yyyyMMdd_HHmmss'
  $OutputDir = Join-Path (Join-Path $PSScriptRoot '..\exports') "circle_index_diagnostics_$timestamp"
}

$ErrorActionPreference = 'Continue'
New-Item -Path $OutputDir -ItemType Directory -Force | Out-Null

function Invoke-Adb {
  param([string[]]$AdbArgs)
  return (& adb -s $DeviceId @AdbArgs 2>&1 | Out-String)
}

$doctorRaw = (& "$PSScriptRoot/doctor-phone-network.ps1" -DeviceId $DeviceId 2>&1 | Out-String)
$doctorJson = $null
try {
  $doctorJson = $doctorRaw | ConvertFrom-Json
} catch {
  $doctorJson = $null
}

$networkSafety = if ($doctorJson -is [System.Array]) { $doctorJson[0] } else { $doctorJson }
$pollutionState = if ($networkSafety) { $networkSafety.pollutionState } else { 'unknown' }

$status = 'qdreader_webview_context'
$probableCause = ''
$observeStartedAt = $null
$observeEndedAt = $null
$observeStartedAtIso = $null
$observeEndedAtIso = $null

if ($RequireCleanNetwork -and $pollutionState -ne 'clean') {
  $status = 'network_not_clean_skip_circle_diagnosis'
  $probableCause = "doctor pollutionState=$pollutionState"

  [PSCustomObject]@{
    status = $status
    probableCause = $probableCause
    networkSafety = $networkSafety
    foregroundActivity = $null
    openedByChrome = $false
    openedByQDReader = $false
    isQDBrowserActivity = $false
    webViewPresent = $false
    browserTitleEmpty = $true
    visibleTextEmpty = $true
    dataApiObserved = $false
    candidateRequests = @()
    observeStartedAt = $observeStartedAtIso
    observeSeconds = [int]$ObserveSeconds
    observeEndedAt = $observeEndedAtIso
    logcatPath = $null
    windowXmlPath = $null
  } | ConvertTo-Json -Depth 8
  exit 0
}

$activityDump = Invoke-Adb -AdbArgs @('shell', 'dumpsys', 'activity', 'activities')
$activityPath = Join-Path $OutputDir 'activity.txt'
Set-Content -Path $activityPath -Value $activityDump -Encoding utf8

$foregroundActivityLine = @($activityDump -split "`r?`n" | Where-Object {
  $_ -match 'topResumedActivity|mResumedActivity|ResumedActivity'
} | Select-Object -First 1)
$foregroundActivity = if ($foregroundActivityLine) { ($foregroundActivityLine -join '').Trim() } else { '' }

$openedByChrome = $foregroundActivity -match 'com\.android\.chrome'
$openedByQDReader = $foregroundActivity -match 'com\.qidian\.QDReader'
$isQDBrowserActivity = $foregroundActivity -match 'com\.qidian\.QDReader/.ui\.activity\.QDBrowserActivity'

$null = Invoke-Adb -AdbArgs @('shell', 'uiautomator', 'dump', '/sdcard/window.xml')
$windowXmlPath = Join-Path $OutputDir 'window.xml'
$null = & adb -s $DeviceId pull /sdcard/window.xml $windowXmlPath 2>&1

$windowXml = ''
if (Test-Path $windowXmlPath) {
  $windowXml = Get-Content -Path $windowXmlPath -Raw -Encoding utf8
}

$webViewPresent = $windowXml -match 'WebView|webview|android\.webkit|com\.tencent\.smtt'
$browserTitleText = $null
$browserTitleNodePattern = 'resource-id="[^"]*browser_title[^"]*"[^>]*'
$browserTitleNodeMatch = [Regex]::Match($windowXml, $browserTitleNodePattern)
$browserTitleFound = $browserTitleNodeMatch.Success
if ($browserTitleFound) {
  $browserTitleTextMatch = [Regex]::Match($browserTitleNodeMatch.Value, 'text="([^"]*)"')
  if ($browserTitleTextMatch.Success) {
    $browserTitleText = $browserTitleTextMatch.Groups[1].Value
  } else {
    $browserTitleText = ''
  }
}
$browserTitleEmpty = if ($browserTitleFound) { [string]::IsNullOrWhiteSpace($browserTitleText) } else { $true }

$visibleTexts = @()
$visibleTextMatches = [Regex]::Matches($windowXml, 'text="([^"]+)"')
foreach ($match in $visibleTextMatches) {
  $textValue = $match.Groups[1].Value
  if (-not [string]::IsNullOrWhiteSpace($textValue)) {
    $visibleTexts += $textValue
  }
}
$visibleTextEmpty = $visibleTexts.Count -eq 0

$sessionHitsPath = Join-Path (Join-Path $PSScriptRoot '..\exports') 'session_hits.jsonl'
if (-not (Test-Path $sessionHitsPath)) {
  $sessionHitsPath = Join-Path (Join-Path $PSScriptRoot '..\runtime\headless') 'session_hits.jsonl'
}

$keywords = @(
  'circleIndex', 'circle', 'index', 'score', 'rank', 'booklevel', 'level', 'hot', 'out',
  'h5.if.qidian', 'qdfepccdn', 'imgservices', 'argus', 'api'
)
$keywordRegex = [string]::Join('|', ($keywords | ForEach-Object { [Regex]::Escape($_) }))

$candidateRequests = @()
$observeStartedAt = (Get-Date).ToUniversalTime()
$observeStartedAtIso = $observeStartedAt.ToString('o')
$null = Invoke-Adb -AdbArgs @('shell', 'logcat', '-c')
if ($ObserveSeconds -gt 0) {
  Start-Sleep -Seconds $ObserveSeconds
}
$observeEndedAt = (Get-Date).ToUniversalTime()
$observeEndedAtIso = $observeEndedAt.ToString('o')
$logcatRaw = Invoke-Adb -AdbArgs @('shell', 'logcat', '-d', '-v', 'time')

if (Test-Path $sessionHitsPath) {
  $lines = Get-Content -Path $sessionHitsPath -Encoding utf8
  foreach ($line in $lines) {
    if (-not $line) { continue }
    try {
      $item = $line | ConvertFrom-Json

      $rawTs = $null
      if ($item.PSObject.Properties.Name -contains 'timestamp') {
        $rawTs = $item.timestamp
      } elseif ($item.PSObject.Properties.Name -contains 'time') {
        $rawTs = $item.time
      } elseif ($item.PSObject.Properties.Name -contains 'createdAt') {
        $rawTs = $item.createdAt
      }

      $ts = $null
      if ($rawTs) {
        try {
          $ts = [DateTime]::Parse($rawTs).ToUniversalTime()
        } catch {
          $ts = $null
        }
      }
      if (-not $ts) { continue }
      if ($ts -lt $observeStartedAt) { continue }

      $text = $line.ToLowerInvariant()
      if ($text -match $keywordRegex.ToLowerInvariant()) {
        $candidateRequests += $line
      }
    } catch {
      continue
    }
  }
}

$logcatLines = @($logcatRaw -split "`r?`n" | Where-Object {
  $_ -match 'QDBrowser|QDReader|WebView|Chromium|cr_|circleIndex|h5\.if\.qidian|qdfepccdn|ERR_|net::|SSL|CERT|Console|JS|WhiteScreen|getEncryptSign|bridge|borgus|SDKSign|Aegis|render|renderer|blank'
})
$logcatPath = Join-Path $OutputDir 'logcat.filtered.txt'
Set-Content -Path $logcatPath -Value ($logcatLines -join "`n") -Encoding utf8

$dataApiObserved = $candidateRequests.Count -gt 0

if ($openedByChrome) {
  $status = 'external_chrome_context'
  $probableCause = 'circleIndex opened in external Chrome shell context'
} elseif ($isQDBrowserActivity -and $webViewPresent -and $browserTitleEmpty -and $visibleTextEmpty -and -not $dataApiObserved) {
  $status = 'circleIndex_h5_webview_blank'
  $probableCause = 'QDBrowserActivity WebView is blank without data API requests in observation window'
} elseif ($isQDBrowserActivity -and $dataApiObserved) {
  $status = 'data_api_observed'
  $probableCause = 'Qidian circleIndex related requests observed'
} elseif ($isQDBrowserActivity -and -not $dataApiObserved -and -not $visibleTextEmpty) {
  $status = 'data_api_missing_or_h5_runtime_stuck'
  $probableCause = 'QDBrowserActivity has visible UI but no circleIndex candidate request'
} elseif ($openedByQDReader) {
  $status = 'qdreader_webview_context'
  $probableCause = 'QDReader context observed, continue targeted checks'
} else {
  $status = 'h5_shell_loaded'
  $probableCause = 'page shell loaded but no decisive QDBrowser/data API evidence'
}

[PSCustomObject]@{
  status = $status
  probableCause = $probableCause
  networkSafety = $networkSafety
  foregroundActivity = $foregroundActivity
  openedByChrome = [bool]$openedByChrome
  openedByQDReader = [bool]$openedByQDReader
  isQDBrowserActivity = [bool]$isQDBrowserActivity
  webViewPresent = [bool]$webViewPresent
  browserTitleEmpty = [bool]$browserTitleEmpty
  visibleTextEmpty = [bool]$visibleTextEmpty
  dataApiObserved = [bool]$dataApiObserved
  candidateRequests = @($candidateRequests)
  observeStartedAt = $observeStartedAtIso
  observeSeconds = [int]$ObserveSeconds
  observeEndedAt = $observeEndedAtIso
  logcatPath = $logcatPath
  windowXmlPath = $windowXmlPath
} | ConvertTo-Json -Depth 8
