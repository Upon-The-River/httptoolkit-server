# Android Recovery Playbook (Windows PowerShell)

> Each **new** PowerShell window must run:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Get-ChildItem .\scripts -Recurse -Include *.ps1,*.cmd | Unblock-File
```

## L1 - Normal rescue

```powershell
$DeviceId = "23091JEGR04484"
.\scripts\rescue-phone-network.ps1 -DeviceId $DeviceId
.\scripts\doctor-phone-network.ps1 -DeviceId $DeviceId
```

Use this first for proxy/DNS/VPN/network residue cleanup.

## L2 - HTTP probe unavailable, but manual network confidence exists

```powershell
$DeviceId = "23091JEGR04484"
.\scripts\rescue-phone-network.ps1 -DeviceId $DeviceId -AllowUnverifiedHttp
.\scripts\doctor-phone-network.ps1 -DeviceId $DeviceId
```

Only allowed for `httpProbeUnavailable=true` with **no hard risk**.

Do **not** use this to bypass:

- `route-broken`
- `dns-broken`
- `partial-connectivity`
- proxy/VPN/Private DNS hard risks

## L3 - WebView/H5/QDReader runtime recovery

```powershell
$DeviceId = "23091JEGR04484"
adb -s $DeviceId shell am force-stop com.qidian.QDReader
adb -s $DeviceId shell am force-stop com.android.chrome
adb -s $DeviceId shell am force-stop com.google.android.webview
adb -s $DeviceId shell pm clear com.android.chrome
adb -s $DeviceId shell pm clear com.google.android.webview
# optional
adb -s $DeviceId shell pm clear com.qidian.QDReader
adb -s $DeviceId reboot
```

## L4 - Lab hard reset (no-data experiment device)

```powershell
$DeviceId = "23091JEGR04484"
.\scripts\hard-reset-android-lab-device.ps1 -DeviceId $DeviceId -ClearQidianData -Reboot
```

The hard reset flow includes:

- stop-headless API attempt
- Toolkit/Chrome/WebView/QDReader force-stop and cleanup
- clear global proxy / Private DNS / always-on VPN / lockdown
- `adb reverse --remove-all`
- reboot

After reboot, always run doctor first:

```powershell
.\scripts\doctor-phone-network.ps1 -DeviceId $DeviceId
```

Proceed to QDReader/circleIndex test only after `pollutionState=clean`.
