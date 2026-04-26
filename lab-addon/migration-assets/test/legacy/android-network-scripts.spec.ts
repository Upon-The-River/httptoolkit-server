import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

describe('Android network PowerShell scripts', () => {
    const doctorScriptPath = path.resolve(__dirname, '../../scripts/doctor-phone-network.ps1');
    const rescueScriptPath = path.resolve(__dirname, '../../scripts/rescue-phone-network.ps1');
    const doctor = fs.readFileSync(doctorScriptPath, 'utf8');
    const rescue = fs.readFileSync(rescueScriptPath, 'utf8');

    const hardResetScriptPath = path.resolve(__dirname, '../../scripts/hard-reset-android-lab-device.ps1');
    const circleIndexScriptPath = path.resolve(__dirname, '../../scripts/check-qidian-circle-index.ps1');
    const hardReset = fs.readFileSync(hardResetScriptPath, 'utf8');
    const circleIndex = fs.readFileSync(circleIndexScriptPath, 'utf8');

    it('doctor uses toybox wget HTTP probes and does not rely on which toybox', () => {
        expect(doctor).to.contain('toybox');
        expect(doctor).to.contain('wget');
        expect(doctor).to.contain('connectivitycheck.gstatic.com/generate_204');
        expect(doctor).to.contain('connectivitycheck.android.com/generate_204');
        expect(doctor).to.contain('https://www.baidu.com');
        expect(doctor).to.not.contain('which toybox');
        expect(doctor).to.contain("Test-AdbBinaryExists -Device $Device -Binary 'nc'");
        expect(doctor).to.contain("httpProbeMethod = $httpProbe.httpProbeMethod");
    });

    it('doctor marks partial connectivity when ping and DNS succeed but HTTP probe fails', () => {
        expect(doctor).to.contain("elseif ($canPingIp -and $canResolveDomain -and $httpProbe.canHttpConnect -eq $false)");
        expect(doctor).to.contain("$pollutionState = 'partial-connectivity'");
    });

    it('doctor pollution-state order keeps route-broken before dns/http checks', () => {
        expect(doctor).to.contain(`if ($proxyResidual) {
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
    $pollutionState = 'unknown'`);
    });

    it('doctor does not swallow route-broken with duplicate empty canPingIp branch', () => {
        expect(doctor).to.not.match(/elseif \(-not \$canPingIp\) \{\s*\}\s*elseif \(-not \$canPingIp\) \{/);
        expect(doctor).to.contain("elseif (-not $canPingIp) {\n    $pollutionState = 'route-broken'");
    });

    it('doctor keeps route-broken as a hard risk and exits non-zero for ping failures', () => {
        expect(doctor).to.contain("if ($pollutionState -ne 'clean') { $riskFound = $true }");
        expect(doctor).to.contain("elseif (-not $canPingIp) {\n    $pollutionState = 'route-broken'");
        expect(doctor).to.contain('if ($riskFound) { exit 1 }');
    });

    it('doctor treats unavailable HTTP probe as non-clean unknown state', () => {
        expect(doctor).to.contain("$pollutionState = 'unknown'");
        expect(doctor).to.contain('HTTP probe unavailable; network cannot be verified as clean');
        expect(doctor).to.contain('httpProbeUnavailable');
        expect(doctor).to.contain('httpProbeMethod');
    });

    it('rescue defaults to failing when HTTP probe is unavailable unless -AllowUnverifiedHttp is set', () => {
        expect(rescue).to.contain("'partial-connectivity'");
        expect(rescue).to.contain('[switch]$AllowUnverifiedHttp');
        expect(rescue).to.contain('Set -AllowUnverifiedHttp to bypass this unverified HTTP status');
        expect(rescue).to.contain('$onlyHttpUnverified = $httpProbeUnavailable -and $hardRisks.Count -eq 0');
        expect(rescue).to.contain('$doctorSucceeded = $allowUnverifiedBypass');
    });

    it('rescue allow-unverified bypass only applies to unavailable HTTP probe, not hard risks', () => {
        expect(rescue).to.contain("$hardRiskStates = @('proxy-residual', 'private-dns-risk', 'vpn-lockdown-risk', 'vpn-active-proxy-dead', 'dns-broken', 'route-broken', 'partial-connectivity', 'http-broken')");
        expect(rescue).to.contain('HTTP probe unavailable; treating network as unverified-safe because -AllowUnverifiedHttp was provided.');
        expect(rescue).to.contain('-AllowUnverifiedHttp only bypasses unavailable HTTP probe, not actual network risks.');
        expect(rescue).to.contain('httpProbeUnavailable');
        expect(rescue).to.contain('$allowUnverifiedBypass = $AllowUnverifiedHttp -and $onlyHttpUnverified');
        expect(rescue).to.contain("$routeBrokenDetected = @($doctorReports | Where-Object { $_.pollutionState -eq 'route-broken' }).Count -gt 0");
        expect(rescue).to.contain('if ($routeBrokenDetected) {');
    });

    it('rescue exits non-zero when doctor reports route-broken', () => {
        expect(rescue).to.contain('finalPollutionState = $finalPollutionState');
        expect(rescue).to.contain("$warnings += 'Route connectivity failure detected; rescue cannot mark success.'");
        expect(rescue).to.contain('if ($routeBrokenDetected) {');
        expect(rescue).to.contain('$doctorSucceeded = $false');
        expect(rescue).to.contain('if ($result.success) { exit 0 }');
        expect(rescue).to.contain('exit 1');
    });


    it('route-broken is still fatal even when -AllowUnverifiedHttp is provided', () => {
        expect(rescue).to.contain('if ($AllowUnverifiedHttp -and $hardRisks.Count -gt 0) {');
        expect(rescue).to.contain('-AllowUnverifiedHttp only bypasses unavailable HTTP probe, not actual network risks.');
        expect(rescue).to.contain("$hardRiskStates = @('proxy-residual', 'private-dns-risk', 'vpn-lockdown-risk', 'vpn-active-proxy-dead', 'dns-broken', 'route-broken', 'partial-connectivity', 'http-broken')");
    });

    it('rescue summary includes hard-risk and allow-unverified fields', () => {
        expect(rescue).to.contain('finalPollutionState');
        expect(rescue).to.contain('canHttpConnect');
        expect(rescue).to.contain('httpProbeUnavailable');
        expect(rescue).to.contain('hardRiskCount');
        expect(rescue).to.contain('allowUnverifiedBypass');
        expect(rescue).to.contain('allowUnverifiedHttp');
        expect(rescue).to.contain('doctorExitCode');
    });

    it('rescue Invoke-AdbStep uses explicit AdbArgs and validates invalid invocations', () => {
        expect(rescue).to.contain('[string[]]$AdbArgs');
        expect(rescue).to.contain('& adb -s $DeviceId @AdbArgs');
        expect(rescue).to.contain("error = 'missing-adb-args'");
        expect(rescue).to.contain("$errorCode = 'invalid-adb-invocation'");
        expect(rescue).to.contain("if ($null -eq $AdbArgs -or $AdbArgs.Count -eq 0)");
        expect(rescue).to.contain('Test-IsAdbHelpOutput');
        expect(rescue).to.contain("$Action -notmatch '(^|[-_])(adb-version|help)([-_]|$)'");
        expect(rescue).to.not.contain('-Args');
        expect(rescue).to.not.contain('[string[]]$Args');
        expect(rescue).to.not.contain('$args');
    });

    it('rescue step commands include full shell/reverse/settings adb arguments', () => {
        expect(rescue).to.contain("command = \"adb -s $DeviceId $($AdbArgs -join ' ')\"");
        expect(rescue).to.contain("-Action 'deactivate-intent' -AdbArgs @('shell', 'am', 'start'");
        expect(rescue).to.contain("-Action 'force-stop' -AdbArgs @('shell', 'am', 'force-stop'");
        expect(rescue).to.contain("-Action 'pm-clear' -AdbArgs @('shell', 'pm', 'clear'");
        expect(rescue).to.contain("-Action 'reverse-remove-all' -AdbArgs @('reverse', '--remove-all')");
        expect(rescue).to.contain("-Action 'delete-http-proxy' -AdbArgs @('shell', 'settings', 'delete', 'global', 'http_proxy')");
        expect(rescue).to.contain("-Action 'put-http-proxy-zero' -AdbArgs @('shell', 'settings', 'put', 'global', 'http_proxy', ':0')");
    });

    it('doctor includes nc fallback and probe status fields in final report', () => {
        expect(doctor).to.contain("Test-AdbBinaryExists -Device $Device -Binary 'nc'");
        expect(doctor).to.contain("httpProbeMethod = 'nc'");
        expect(doctor).to.contain("httpProbeStatus = 'failed'");
        expect(doctor).to.contain("httpProbeStatus = 'unavailable'");
        expect(doctor).to.contain('httpProbeMethod = $httpProbe.httpProbeMethod');
        expect(doctor).to.contain('httpProbeStatus = $httpProbe.httpProbeStatus');
        expect(doctor).to.contain('httpProbeError = $httpProbe.httpProbeError');
        expect(doctor).to.contain('httpProbeUnavailable = $httpProbe.httpProbeUnavailable');
    });

    it('hard reset checks real root su before privileged iptables cleanup', () => {
        expect(hardReset).to.contain("$suId = Invoke-Adb -AdbArgs @('shell', 'su', '-c', 'id') -AllowFailure");
        expect(hardReset).to.contain("$hasRootSu = $suId.Output -match 'uid=0'");
        expect(hardReset).to.contain('iptables cleanup skipped because su is not root');
    });

    it('hard reset keeps QDReader selective cleanup when ClearQidianData is false', () => {
        expect(hardReset).to.contain("if ($ClearQidianData) {");
        expect(hardReset).to.contain("pm', 'clear', 'com.qidian.QDReader'");
        expect(hardReset).to.contain('/data/data/com.qidian.QDReader/app_webview');
        expect(hardReset).to.contain('/data/data/com.qidian.QDReader/cache');
        expect(hardReset).to.contain('/data/data/com.qidian.QDReader/code_cache');
    });

    it('hard reset summary includes required fields and stop-headless API warning fallback', () => {
        expect(hardReset).to.contain('stop-headless API unavailable');
        expect(hardReset).to.contain('qidianDataCleared');
        expect(hardReset).to.contain('webViewDataCleared');
        expect(hardReset).to.contain('toolkitPackagesCleared');
    });

    it('circle index checker skips diagnosis when network is not clean', () => {
        expect(circleIndex).to.contain("status = 'network_not_clean_skip_circle_diagnosis'");
        expect(circleIndex).to.contain("if ($RequireCleanNetwork -and $pollutionState -ne 'clean')");
    });

    it('circle index checker detects Chrome context and blank webview case', () => {
        expect(circleIndex).to.contain("$status = 'external_chrome_context'");
        expect(circleIndex).to.contain("$status = 'circleIndex_h5_webview_blank'");
        expect(circleIndex).to.contain("$status = 'data_api_observed'");
    });

    it('circle index keywords avoid discuss/community/forum/openDiscussArea bias', () => {
        expect(circleIndex).to.contain("'circleIndex', 'circle', 'index', 'score', 'rank', 'booklevel'");
        expect(circleIndex).to.not.contain('openDiscussArea');
        expect(circleIndex).to.not.contain('community');
        expect(circleIndex).to.not.contain('forum');
    });

    it('circle index output includes key JSON summary fields', () => {
        expect(circleIndex).to.contain('status = $status');
        expect(circleIndex).to.contain('probableCause = $probableCause');
        expect(circleIndex).to.contain('windowXmlPath = $windowXmlPath');
        expect(circleIndex).to.contain('logcatPath = $logcatPath');
        expect(circleIndex).to.contain('candidateRequests = @($candidateRequests)');
        expect(circleIndex).to.contain('observeStartedAt = $observeStartedAtIso');
        expect(circleIndex).to.contain('observeSeconds = [int]$ObserveSeconds');
        expect(circleIndex).to.contain('observeEndedAt = $observeEndedAtIso');
    });

    it('circle index checker stays compatible with Windows PowerShell 5.1 (no null-coalescing operator)', () => {
        expect(circleIndex).to.not.contain('??');
        expect(circleIndex).to.contain("if ($item.PSObject.Properties.Name -contains 'timestamp')");
        expect(circleIndex).to.contain("elseif ($item.PSObject.Properties.Name -contains 'time')");
        expect(circleIndex).to.contain("elseif ($item.PSObject.Properties.Name -contains 'createdAt')");
    });

    it('circle index checker uses a real observe window and logcat capture ordering', () => {
        expect(circleIndex).to.contain("Start-Sleep -Seconds $ObserveSeconds");
        expect(circleIndex).to.contain("$null = Invoke-Adb -AdbArgs @('shell', 'logcat', '-c')");
        expect(circleIndex).to.contain("$logcatRaw = Invoke-Adb -AdbArgs @('shell', 'logcat', '-d', '-v', 'time')");
        expect(circleIndex.indexOf("logcat', '-c'")).to.be.lessThan(circleIndex.indexOf("logcat', '-d', '-v', 'time'"));
    });

    it('circle index checker treats browser_title text empty as browserTitleEmpty=true via node text parsing', () => {
        const browserTitleNodePattern = /resource-id="[^"]*browser_title[^"]*"[^>]*text="([^"]*)"/;
        const emptyTitleXml = '<node resource-id="com.qidian.QDReader:id/browser_title" text="" />';
        const nonEmptyTitleXml = '<node resource-id="com.qidian.QDReader:id/browser_title" text="出圈指数" />';
        const emptyMatch = emptyTitleXml.match(browserTitleNodePattern);
        const nonEmptyMatch = nonEmptyTitleXml.match(browserTitleNodePattern);

        expect(emptyMatch?.[1] ?? '').to.equal('');
        expect((emptyMatch?.[1] ?? '').trim().length === 0).to.equal(true);
        expect(nonEmptyMatch?.[1]).to.equal('出圈指数');
        expect((nonEmptyMatch?.[1] ?? '').trim().length === 0).to.equal(false);
        expect(circleIndex).to.contain("$browserTitleNodePattern = 'resource-id=\"[^\"]*browser_title[^\"]*\"[^>]*'");
        expect(circleIndex).to.contain("$browserTitleEmpty = if ($browserTitleFound) { [string]::IsNullOrWhiteSpace($browserTitleText) } else { $true }");
    });

    it('circle index checker blank webview verdict requires QDBrowserActivity + WebView + empty title + empty visible text + no candidate request', () => {
        expect(circleIndex).to.contain("} elseif ($isQDBrowserActivity -and $webViewPresent -and $browserTitleEmpty -and $visibleTextEmpty -and -not $dataApiObserved) {");
        expect(circleIndex).to.contain("$status = 'circleIndex_h5_webview_blank'");
    });

    it('hard reset includes full iptables/ip6tables nat/mangle cleanup commands and connectivity toggles', () => {
        expect(hardReset).to.contain("'iptables -F'");
        expect(hardReset).to.contain("'iptables -X'");
        expect(hardReset).to.contain("'iptables -t nat -F'");
        expect(hardReset).to.contain("'iptables -t nat -X'");
        expect(hardReset).to.contain("'iptables -t mangle -F'");
        expect(hardReset).to.contain("'iptables -t mangle -X'");
        expect(hardReset).to.contain("'ip6tables -F'");
        expect(hardReset).to.contain("'ip6tables -X'");
        expect(hardReset).to.contain("'ip6tables -t nat -F'");
        expect(hardReset).to.contain("'ip6tables -t nat -X'");
        expect(hardReset).to.contain("'ip6tables -t mangle -F'");
        expect(hardReset).to.contain("'ip6tables -t mangle -X'");
        expect(hardReset).to.contain("cmd', 'connectivity', 'airplane-mode', 'enable'");
        expect(hardReset).to.contain("cmd', 'connectivity', 'airplane-mode', 'disable'");
        expect(hardReset).to.contain("svc', 'data', 'disable'");
        expect(hardReset).to.contain("svc', 'data', 'enable'");
    });

    it('hard reset warns on non-root su cleanup path and does not mark cleanup as successful', () => {
        expect(hardReset).to.contain("if ($hasRootSu) {");
        expect(hardReset).to.contain("$actions.Add(\"netfilter-clean:$cleanupCommand\") | Out-Null");
        expect(hardReset).to.contain("$warnings.Add('iptables cleanup skipped because su is not root') | Out-Null");
        expect(hardReset).to.not.contain("$actions.Add('iptables cleanup skipped because su is not root') | Out-Null");
    });

});
