# Android Headless Network Safety

## Windows prerequisites (every new PowerShell window)

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Get-ChildItem .\scripts -Recurse -Include *.ps1,*.cmd | Unblock-File
```

Use embedded Node 22.20.0 scripts (`scripts/node22.cmd`, `scripts/npm22.cmd`, `scripts/npx22.cmd`) instead of system Node.

When calling local automation APIs from PowerShell, include:

```powershell
$Headers = @{ Origin = 'https://app.httptoolkit.tech' }
```

Otherwise CORS validation can fail with `Invalid CORS headers`.

## Clean definition (strict)

`pollutionState=clean` requires all checks below:

- `canPingIp=true`
- `canResolveDomain=true`
- `canHttpConnect=true`
- `httpProbeUnavailable=false`
- `globalHttpProxy` is `:0` or empty/null (no residual proxy)
- `privateDnsMode=off` (or no risk condition)
- `alwaysOnVpnApp=null`
- `lockdownVpn=0`

## pollutionState taxonomy

- `clean`
- `unknown`
- `proxy-residual`
- `private-dns-risk`
- `vpn-lockdown-risk`
- `route-broken`
- `dns-broken`
- `partial-connectivity`
- `http-broken`

## Hard-risk states

The following are **hard risk** and must fail doctor/rescue success conditions:

- `proxy-residual`
- `private-dns-risk`
- `vpn-lockdown-risk`
- `route-broken`
- `dns-broken`
- `partial-connectivity`
- `http-broken`

## `-AllowUnverifiedHttp` boundary

`-AllowUnverifiedHttp` only bypasses `httpProbeUnavailable=true` when no hard risk exists.

It **cannot** bypass:

- `route-broken`
- `dns-broken`
- `partial-connectivity`
- proxy residual risk
- VPN/lockdown risk
- Private DNS risk

## HTTP probe fallback (Pixel 6a / no toybox wget)

Some devices (e.g. Pixel 6a) do not provide `toybox wget`. `doctor-phone-network.ps1` must try fallback probes in order (toybox wget/curl/wget/nc) and use `nc` when available.

Do not mark HTTP probe unavailable immediately after toybox wget failure.

## stop-headless post-check requirements

After `stop-headless` or recovery cleanup:

1. Verify API result includes `networkRiskCleared=true`.
2. Run `scripts/doctor-phone-network.ps1` and verify `pollutionState=clean`.

Only then proceed to next Android headless/QDReader workflow.
