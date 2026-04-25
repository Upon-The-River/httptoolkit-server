param(
  [string]$DeviceId
)

$ErrorActionPreference = 'Continue'

function Get-OnlineDevices {
  param([string]$Selected)

  $adbDevicesOutput = (& adb devices 2>&1 | Out-String)
  if ($LASTEXITCODE -ne 0) {
    throw "adb devices failed: $adbDevicesOutput"
  }

  $rows = $adbDevicesOutput -split "`r?`n" | Select-Object -Skip 1 | Where-Object { $_ -match "\S+\s+\S+" }
  $devices = @()
  foreach ($row in $rows) {
    $parts = ($row -replace "^\s+|\s+$", "") -split "\s+"
    if ($parts.Count -lt 2) { continue }
    if ($parts[1] -eq 'device') {
      $devices += $parts[0]
    }
  }

  if ($Selected) {
    return $devices | Where-Object { $_ -eq $Selected }
  }

  return $devices
}

function Test-HttpProbeUnavailableError {
  param([string]$Text)

  if (-not $Text) { return $false }
  return (
    $Text -match 'Unknown command wget' -or
    $Text -match 'wget: not found' -or
    $Text -match 'curl: inaccessible or not found' -or
    $Text -match 'not found' -or
    $Text -match 'applet not found' -or
    $Text -match 'No such file or directory' -or
    $Text -match 'invalid command'
  )
}

function Test-IsHttpResponse {
  param([string]$Text)

  if (-not $Text) { return $false }
  return (
    $Text -match 'HTTP/1\.1' -or
    $Text -match 'HTTP/1\.0' -or
    $Text -match '(^|\s)204(\s|$)' -or
    $Text -match '(^|\s)200(\s|$)' -or
    $Text -match '(^|\s)301(\s|$)' -or
    $Text -match '(^|\s)302(\s|$)' -or
    $Text -match 'Location:' -or
    $Text -match 'Server:'
  )
}

function Test-AdbBinaryExists {
  param(
    [string]$Device,
    [string]$Binary
  )

  $output = (& adb -s $Device shell which $Binary 2>&1 | Out-String).Trim()
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) { return $false }
  return -not [string]::IsNullOrWhiteSpace($output)
}

function Invoke-HttpProbe {
  param([string]$Device)

  $lastError = $null
  $unavailableError = $null
  $sawUnavailable = $false

  $runProbeCommand = {
    param(
      [string]$Method,
      [string[]]$ProbeArgs
    )

    $output = (& adb -s $Device @ProbeArgs 2>&1 | Out-String)
    $exitCode = $LASTEXITCODE
    $trimmed = $output.Trim()

    if ($exitCode -eq 0 -and (($Method -eq 'nc' -and (Test-IsHttpResponse -Text $trimmed)) -or $Method -ne 'nc')) {
      return [PSCustomObject]@{
        complete = $true
        result = [PSCustomObject]@{
          canHttpConnect = $true
          httpProbeUnavailable = $false
          httpProbeMethod = $Method
          httpProbeStatus = 'ok'
          httpProbeError = $null
        }
      }
    }

    $script:lastError = if ($trimmed) { $trimmed } else { "http-probe-exit-$exitCode" }
    if (Test-HttpProbeUnavailableError -Text $script:lastError) {
      $script:sawUnavailable = $true
      $script:unavailableError = $script:lastError
    }

    return [PSCustomObject]@{ complete = $false; result = $null }
  }

  $toyboxProbes = @(
    @('shell', 'toybox', 'wget', '-q', '-O', '-', 'http://connectivitycheck.gstatic.com/generate_204'),
    @('shell', 'toybox', 'wget', '-q', '-O', '-', 'http://connectivitycheck.android.com/generate_204'),
    @('shell', 'toybox', 'wget', '-q', '-O', '-', 'https://www.baidu.com')
  )
  foreach ($probe in $toyboxProbes) {
    $attempt = & $runProbeCommand 'toybox-wget' $probe
    if ($attempt.complete) { return $attempt.result }
  }

  if (Test-AdbBinaryExists -Device $Device -Binary 'curl') {
    $curlProbes = @(
      @('shell', 'curl', '-I', '--max-time', '5', 'http://connectivitycheck.gstatic.com/generate_204'),
      @('shell', 'curl', '-I', '--max-time', '5', 'https://www.baidu.com')
    )
    foreach ($probe in $curlProbes) {
      $attempt = & $runProbeCommand 'curl' $probe
      if ($attempt.complete) { return $attempt.result }
    }
  }

  if (Test-AdbBinaryExists -Device $Device -Binary 'wget') {
    $wgetProbes = @(
      @('shell', 'wget', '-q', '-O', '-', 'http://connectivitycheck.gstatic.com/generate_204'),
      @('shell', 'wget', '-q', '-O', '-', 'https://www.baidu.com')
    )
    foreach ($probe in $wgetProbes) {
      $attempt = & $runProbeCommand 'wget' $probe
      if ($attempt.complete) { return $attempt.result }
    }
  }

  if (Test-AdbBinaryExists -Device $Device -Binary 'nc') {
    $ncProbes = @(
      @('shell', "printf 'GET /generate_204 HTTP/1.1\r\nHost: connectivitycheck.gstatic.com\r\nConnection: close\r\n\r\n' | nc connectivitycheck.gstatic.com 80"),
      @('shell', "printf 'GET / HTTP/1.1\r\nHost: www.baidu.com\r\nConnection: close\r\n\r\n' | nc www.baidu.com 80")
    )
    foreach ($probe in $ncProbes) {
      $attempt = & $runProbeCommand 'nc' $probe
      if ($attempt.complete) { return $attempt.result }
    }

    return [PSCustomObject]@{
      canHttpConnect = $false
      httpProbeUnavailable = $false
      httpProbeMethod = 'nc'
      httpProbeStatus = 'failed'
      httpProbeError = if ($lastError) { $lastError } else { 'nc-http-probe-failed' }
    }
  }

  if ($sawUnavailable) {
    return [PSCustomObject]@{
      canHttpConnect = $null
      httpProbeUnavailable = $true
      httpProbeMethod = $null
      httpProbeStatus = 'unavailable'
      httpProbeError = if ($unavailableError) { $unavailableError } else { 'http-probe-command-unavailable' }
    }
  }

  return [PSCustomObject]@{
    canHttpConnect = $null
    httpProbeUnavailable = $true
    httpProbeMethod = $null
    httpProbeStatus = 'unavailable'
    httpProbeError = if ($lastError) { $lastError } else { 'http-probe-command-unavailable' }
  }
}

$devices = Get-OnlineDevices -Selected $DeviceId
if ($devices.Count -eq 0) {
  Write-Error 'No online adb devices found'
  exit 1
}

$riskFound = $false
$reports = @()

foreach ($id in $devices) {
  $warnings = @()
  $httpProxy = (& adb -s $id shell settings get global http_proxy 2>&1 | Out-String).Trim()
  $privateDnsMode = (& adb -s $id shell settings get global private_dns_mode 2>&1 | Out-String).Trim()
  $privateDnsSpecifier = (& adb -s $id shell settings get global private_dns_specifier 2>&1 | Out-String).Trim()
  $alwaysOnVpn = (& adb -s $id shell settings get secure always_on_vpn_app 2>&1 | Out-String).Trim()
  $lockdownVpn = (& adb -s $id shell settings get secure lockdown_vpn 2>&1 | Out-String).Trim()
  $connectivity = (& adb -s $id shell dumpsys connectivity 2>&1 | Out-String)
  $vpnDump = (& adb -s $id shell dumpsys vpn 2>&1 | Out-String)
  $pingIp = (& adb -s $id shell ping -c 1 -W 2 8.8.8.8 2>&1 | Out-String)
  $pingDomain = (& adb -s $id shell ping -c 1 -W 2 baidu.com 2>&1 | Out-String)

  $canPingIp = ($pingIp -match '1 received|bytes from|ttl=')
  $canResolveDomain = ($pingDomain -match '1 received|bytes from|ttl=')
  $httpProbe = Invoke-HttpProbe -Device $id

  $proxyResidual = ($httpProxy -and $httpProxy -ne 'null' -and $httpProxy -ne ':0')
  $vpnRisk = ($alwaysOnVpn -eq 'tech.httptoolkit.android.v1') -or ($lockdownVpn -eq '1')
  $privateDnsRisk = ($privateDnsMode -eq 'hostname' -and -not [string]::IsNullOrWhiteSpace($privateDnsSpecifier) -and -not $canResolveDomain)

  $pollutionState = 'unknown'
  if ($proxyResidual) {
    $pollutionState = 'proxy-residual'
  } elseif ($vpnRisk) {
    $pollutionState = 'vpn-lockdown-risk'
  } elseif ($privateDnsRisk) {
    $pollutionState = 'private-dns-risk'
  } elseif (-not $canPingIp) {
    $pollutionState = 'route-broken'
  } elseif ($canPingIp -and -not $canResolveDomain) {
    $pollutionState = 'dns-broken'
  } elseif ($canPingIp -and $canResolveDomain -and $httpProbe.canHttpConnect -eq $false) {
    $pollutionState = 'partial-connectivity'
  } elseif ($httpProbe.httpProbeUnavailable) {
    $pollutionState = 'unknown'
    $warnings += 'HTTP probe unavailable; network cannot be verified as clean'
  } elseif ($canPingIp -and $canResolveDomain -and $httpProbe.canHttpConnect -eq $true -and -not $proxyResidual -and -not $privateDnsRisk -and -not $vpnRisk) {
    $pollutionState = 'clean'
  }

  if ($pollutionState -ne 'clean') { $riskFound = $true }

  $reports += [PSCustomObject]@{
    deviceId = $id
    globalHttpProxy = $httpProxy
    privateDnsMode = $privateDnsMode
    privateDnsSpecifier = $privateDnsSpecifier
    alwaysOnVpnApp = $alwaysOnVpn
    lockdownVpn = $lockdownVpn
    pollutionState = $pollutionState
    canPingIp = $canPingIp
    canResolveDomain = $canResolveDomain
    canHttpConnect = $httpProbe.canHttpConnect
    httpProbeMethod = $httpProbe.httpProbeMethod
    httpProbeUnavailable = $httpProbe.httpProbeUnavailable
    httpProbeStatus = $httpProbe.httpProbeStatus
    httpProbeError = $httpProbe.httpProbeError
    warnings = $warnings
    connectivitySummary = ($connectivity -split "`r?`n" | Select-Object -First 20) -join "`n"
    vpnSummary = ($vpnDump -split "`r?`n" | Select-Object -First 20) -join "`n"
  }
}

$reports | ConvertTo-Json -Depth 8
if ($riskFound) { exit 1 }
exit 0
