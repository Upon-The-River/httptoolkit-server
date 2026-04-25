import * as fs from 'fs/promises';
import * as path from 'path';

import * as Adb from '@devicefarmer/adbkit';
import { delay, isErrorLike } from '@httptoolkit/util';

import { createAdbClient, runHostAdbCommand, runAdbShellCommand } from './adb-commands';

const HTK_PACKAGE = 'tech.httptoolkit.android.v1';
const HTTP_PROBE_UNAVAILABLE_PATTERNS = [
    /unknown command\s+wget/i,
    /wget: not found/i,
    /not found/i,
    /no such file or directory/i,
    /applet not found/i,
    /invalid command/i
];

function isHttpProbeUnavailableError(errorText: string) {
    return HTTP_PROBE_UNAVAILABLE_PATTERNS.some((pattern) => pattern.test(errorText));
}

export type AndroidPollutionState =
    | 'clean'
    | 'unknown-safe'
    | 'proxy-residual'
    | 'private-dns-risk'
    | 'vpn-lockdown-risk'
    | 'vpn-active-proxy-dead'
    | 'dns-broken'
    | 'route-broken'
    | 'http-broken'
    | 'partial-connectivity'
    | 'unknown';

export interface AndroidNetworkBaseline {
    deviceId: string;
    capturedAt: string;
    timestamp?: string;
    baselinePollutionState: AndroidPollutionState;
    baselineTrusted: boolean;
    globalHttpProxy: string | null;
    globalHttpProxyHost: string | null;
    globalHttpProxyPort: string | null;
    globalHttpProxyExclusionList: string | null;
    privateDnsMode: string | null;
    privateDnsSpecifier: string | null;
    alwaysOnVpnApp: string | null;
    lockdownVpn: string | null;
    connectivitySummary: string;
    wifiSsid?: string | null;
}

export interface AndroidNetworkSafetyStatus {
    deviceId: string;
    globalHttpProxy: string | null;
    privateDnsMode: string | null;
    privateDnsSpecifier: string | null;
    alwaysOnVpnApp: string | null;
    lockdownVpn: string | null;
    activeNetworkIsVpn: boolean;
    activeNetworkHasNotVpnCapability: boolean;
    httpToolkitPackageRunning: boolean;
    canPingIp: boolean;
    canResolveDomain: boolean;
    canHttpConnect: boolean | null;
    httpProbeMethod: 'toybox-wget' | 'nc' | null;
    httpProbeStatus: 'success' | 'failed' | 'unavailable';
    httpProbeError: string | null;
    httpProbeUnavailable: boolean;
    pollutionState: AndroidPollutionState;
    warnings: string[];
    errors: string[];
    diagnostics: Record<string, unknown>;
}

export interface AndroidNetworkRestoreResult {
    deviceId: string;
    success: boolean;
    usedBaseline: boolean;
    actions: string[];
    errors: string[];
}

export interface AndroidNetworkRescueResult {
    deviceId: string;
    success: boolean;
    networkRiskCleared: boolean;
    pollutionState: AndroidPollutionState;
    actions: string[];
    remainingIssues: string[];
    diagnostics: AndroidNetworkSafetyStatus;
}

const baselineDir = path.resolve(__dirname, '../../../runtime/headless');

const normalizeValue = (raw: string | null | undefined) => {
    if (raw === undefined || raw === null) return null;
    const value = raw.trim();
    if (!value || value === 'null') return null;
    return value;
};

async function readSetting(device: Adb.DeviceClient, namespace: 'global' | 'secure', key: string): Promise<string | null> {
    const value = await runAdbShellCommand(device, ['settings', 'get', namespace, key], { timeout: 7000, skipLogging: true })
        .catch(() => '');
    return normalizeValue(value);
}

async function setOrDeleteSetting(
    device: Adb.DeviceClient,
    namespace: 'global' | 'secure',
    key: string,
    value: string | null,
    actions: string[],
    errors: string[]
) {
    try {
        if (!value) {
            await runAdbShellCommand(device, ['settings', 'delete', namespace, key], { timeout: 10000, skipLogging: true });
            actions.push(`settings delete ${namespace} ${key}`);
        } else {
            await runAdbShellCommand(device, ['settings', 'put', namespace, key, value], { timeout: 10000, skipLogging: true });
            actions.push(`settings put ${namespace} ${key} ${value}`);
        }
    } catch (error) {
        errors.push(`${namespace}.${key}: ${isErrorLike(error) ? error.message ?? String(error) : String(error)}`);
    }
}

export function getAndroidNetworkBaselinePath(deviceId: string) {
    const safeDeviceId = deviceId.replace(/[^a-zA-Z0-9._-]/g, '_');
    return path.join(baselineDir, `network-baseline-${safeDeviceId}.json`);
}

export async function loadAndroidNetworkBaseline(deviceId: string): Promise<AndroidNetworkBaseline | undefined> {
    try {
        const content = await fs.readFile(getAndroidNetworkBaselinePath(deviceId), 'utf8');
        return JSON.parse(content) as AndroidNetworkBaseline;
    } catch {
        return undefined;
    }
}

export async function saveAndroidNetworkBaseline(baseline: AndroidNetworkBaseline): Promise<void> {
    await fs.mkdir(path.dirname(getAndroidNetworkBaselinePath(baseline.deviceId)), { recursive: true });
    await fs.writeFile(getAndroidNetworkBaselinePath(baseline.deviceId), JSON.stringify(baseline, null, 2), 'utf8');
}

export async function captureAndroidNetworkBaseline(
    deviceId: string,
    options: { adbClient?: Adb.Client } = {}
): Promise<AndroidNetworkBaseline> {
    const adbClient = options.adbClient ?? createAdbClient();
    const device = adbClient.getDevice(deviceId);

    const [
        globalHttpProxy,
        globalHttpProxyHost,
        globalHttpProxyPort,
        globalHttpProxyExclusionList,
        privateDnsMode,
        privateDnsSpecifier,
        alwaysOnVpnApp,
        lockdownVpn,
        connectivity,
        wifiSsid
    ] = await Promise.all([
        readSetting(device, 'global', 'http_proxy'),
        readSetting(device, 'global', 'global_http_proxy_host'),
        readSetting(device, 'global', 'global_http_proxy_port'),
        readSetting(device, 'global', 'global_http_proxy_exclusion_list'),
        readSetting(device, 'global', 'private_dns_mode'),
        readSetting(device, 'global', 'private_dns_specifier'),
        readSetting(device, 'secure', 'always_on_vpn_app'),
        readSetting(device, 'secure', 'lockdown_vpn'),
        runAdbShellCommand(device, ['dumpsys', 'connectivity'], { timeout: 10000, skipLogging: true }).catch(() => ''),
        runAdbShellCommand(device, ['cmd', 'wifi', 'status'], { timeout: 5000, skipLogging: true }).catch(() => '')
    ]);

    const capturedAt = new Date().toISOString();
    const baseline: AndroidNetworkBaseline = {
        deviceId,
        capturedAt,
        // Retained for compatibility with older readers/tests:
        timestamp: capturedAt,
        baselinePollutionState: 'unknown-safe',
        baselineTrusted: true,
        globalHttpProxy,
        globalHttpProxyHost,
        globalHttpProxyPort,
        globalHttpProxyExclusionList,
        privateDnsMode,
        privateDnsSpecifier,
        alwaysOnVpnApp,
        lockdownVpn,
        connectivitySummary: connectivity.slice(0, 3000),
        wifiSsid: normalizeValue((wifiSsid.match(/SSID:\s*(.*)/)?.[1] ?? '').trim())
    };

    await saveAndroidNetworkBaseline(baseline);

    return baseline;
}

export async function inspectAndroidNetworkSafety(
    deviceId: string,
    options: { adbClient?: Adb.Client, proxyReachable?: boolean } = {}
): Promise<AndroidNetworkSafetyStatus> {
    const adbClient = options.adbClient ?? createAdbClient();
    const device = adbClient.getDevice(deviceId);
    const errors: string[] = [];
    const warnings: string[] = [];

    const safeShell = async (command: string[], fallback = '') => {
        try {
            return await runAdbShellCommand(device, command, { timeout: 10000, skipLogging: true });
        } catch (error) {
            errors.push(`${command.join(' ')} failed: ${isErrorLike(error) ? error.message ?? String(error) : String(error)}`);
            return fallback;
        }
    };

    const [
        globalHttpProxy,
        privateDnsMode,
        privateDnsSpecifier,
        alwaysOnVpnApp,
        lockdownVpn,
        connectivity,
        dumpsysVpn,
        pingIp,
        pingDomain,
        pidofHtk,
        hasCmdConnectivity
    ] = await Promise.all([
        readSetting(device, 'global', 'http_proxy'),
        readSetting(device, 'global', 'private_dns_mode'),
        readSetting(device, 'global', 'private_dns_specifier'),
        readSetting(device, 'secure', 'always_on_vpn_app'),
        readSetting(device, 'secure', 'lockdown_vpn'),
        safeShell(['dumpsys', 'connectivity']),
        safeShell(['dumpsys', 'vpn']),
        safeShell(['ping', '-c', '1', '-W', '2', '8.8.8.8']),
        safeShell(['ping', '-c', '1', '-W', '2', 'baidu.com']),
        safeShell(['pidof', HTK_PACKAGE]),
        safeShell(['cmd', '-l'])
    ]);

    const connLower = connectivity.toLowerCase();
    const vpnLower = dumpsysVpn.toLowerCase();
    const activeNetworkIsVpn = /active.*(vpn|tun)|default.*(vpn|tun)/i.test(connectivity) &&
        /(tech\.httptoolkit\.android\.v1)/i.test(`${connectivity}\n${dumpsysVpn}`);
    const activeNetworkHasNotVpnCapability = /capabilities.*not_vpn|not_vpn/i.test(connLower);
    const canPingIp = /(1 received|bytes from|ttl=)/i.test(pingIp);
    const canResolveDomain = /(1 received|bytes from|ttl=)/i.test(pingDomain);
    const supportsConnectivityCmd = /\bconnectivity\b/i.test(hasCmdConnectivity);
    let canHttpConnect: boolean | null = null;
    let httpProbeMethod: 'toybox-wget' | 'nc' | null = null;
    let httpProbeStatus: 'success' | 'failed' | 'unavailable' = 'unavailable';
    let httpProbeError: string | null = null;
    let httpProbeUnavailable: boolean = false;
    const httpToolkitPackageRunning = !!normalizeValue(pidofHtk);

    const runHttpProbe = async () => {
        const probes: Array<{ command: string[], expectBody?: string }> = [
            { command: ['toybox', 'wget', '-q', '-O', '-', 'http://connectivitycheck.gstatic.com/generate_204'] },
            { command: ['toybox', 'wget', '-q', '-O', '-', 'http://connectivitycheck.android.com/generate_204'] },
            { command: ['toybox', 'wget', '-q', '-O', '-', 'https://www.baidu.com'], expectBody: '<html' }
        ];
        const ncHttpResponsePattern = /(HTTP\/1\.[01]|(^|\s)(204|200|301|302)(\s|$)|Location:|Server:)/i;
        let lastProbeError: string | null = null;
        let unavailableProbeError: string | null = null;
        let sawUnavailableError = false;
        for (const probe of probes) {
            try {
                const output = await runAdbShellCommand(device, probe.command, { timeout: 12000, skipLogging: true });
                if (!probe.expectBody || output.toLowerCase().includes(probe.expectBody)) {
                    canHttpConnect = true;
                    httpProbeMethod = 'toybox-wget';
                    httpProbeStatus = 'success';
                    return;
                }
                canHttpConnect = true;
                httpProbeMethod = 'toybox-wget';
                httpProbeStatus = 'success';
                return;
            } catch (error) {
                const errorText = isErrorLike(error) ? error.message ?? String(error) : String(error);
                lastProbeError = errorText;
                if (isHttpProbeUnavailableError(errorText)) {
                    sawUnavailableError = true;
                    unavailableProbeError = errorText;
                }
            }
        }

        if (sawUnavailableError) {
            try {
                const ncPath = await runAdbShellCommand(device, ['which', 'nc'], { timeout: 7000, skipLogging: true });
                if (normalizeValue(ncPath)) {
                    const ncProbes = [
                        `printf 'GET /generate_204 HTTP/1.1\\r\\nHost: connectivitycheck.gstatic.com\\r\\nConnection: close\\r\\n\\r\\n' | nc connectivitycheck.gstatic.com 80`,
                        `printf 'GET / HTTP/1.1\\r\\nHost: www.baidu.com\\r\\nConnection: close\\r\\n\\r\\n' | nc www.baidu.com 80`
                    ];
                    for (const ncProbe of ncProbes) {
                        try {
                            const output = await runAdbShellCommand(device, [ncProbe], { timeout: 12000, skipLogging: true });
                            if (ncHttpResponsePattern.test(output)) {
                                canHttpConnect = true;
                                httpProbeMethod = 'nc';
                                httpProbeStatus = 'success';
                                httpProbeUnavailable = false;
                                httpProbeError = null;
                                return;
                            }
                            lastProbeError = output;
                        } catch (error) {
                            lastProbeError = isErrorLike(error) ? error.message ?? String(error) : String(error);
                        }
                    }

                    canHttpConnect = false;
                    httpProbeMethod = 'nc';
                    httpProbeStatus = 'failed';
                    httpProbeUnavailable = false;
                    httpProbeError = lastProbeError ?? 'nc-http-probe-failed';
                    return;
                }
            } catch (error) {
                lastProbeError = isErrorLike(error) ? error.message ?? String(error) : String(error);
            }

            canHttpConnect = null;
            httpProbeMethod = null;
            httpProbeStatus = 'unavailable';
            httpProbeUnavailable = true;
            httpProbeError = unavailableProbeError ?? lastProbeError ?? 'http-probe-command-unavailable';
            warnings.push('HTTP probe unavailable: wget and nc commands are not available on this device');
            return;
        }

        canHttpConnect = false;
        httpProbeMethod = 'toybox-wget';
        httpProbeStatus = 'failed';
        httpProbeError = lastProbeError ?? 'unknown-http-probe-error';

        if (supportsConnectivityCmd) {
            const captivePortalState = await safeShell(['cmd', 'connectivity', 'diag']);
            if (/validated|captive/i.test(captivePortalState)) {
                warnings.push('Connectivity diag indicates portal state, but direct HTTP probe failed');
            }
        }
    };
    await runHttpProbe();

    let pollutionState: AndroidPollutionState = 'clean';
    if (globalHttpProxy && globalHttpProxy !== ':0') {
        pollutionState = 'proxy-residual';
        warnings.push(`Global HTTP proxy still set: ${globalHttpProxy}`);
    } else if ((alwaysOnVpnApp === HTK_PACKAGE) || lockdownVpn === '1') {
        pollutionState = 'vpn-lockdown-risk';
    } else if ((privateDnsMode === 'hostname' && !!privateDnsSpecifier && !canResolveDomain) || (!canResolveDomain && canPingIp)) {
        pollutionState = 'dns-broken';
    } else if (!canPingIp) {
        pollutionState = 'route-broken';
    } else if (privateDnsMode === 'hostname' && !privateDnsSpecifier) {
        pollutionState = 'private-dns-risk';
    } else if (activeNetworkIsVpn && options.proxyReachable === false) {
        pollutionState = 'vpn-active-proxy-dead';
    } else if (canPingIp && canResolveDomain && canHttpConnect === false) {
        pollutionState = 'partial-connectivity';
    } else if (canHttpConnect === null && httpProbeUnavailable) {
        pollutionState = 'unknown';
        warnings.push('HTTP probe unavailable; network cannot be verified as clean');
    } else if (canPingIp && canHttpConnect === false) {
        pollutionState = 'partial-connectivity';
    } else if (errors.length > 0) {
        pollutionState = 'unknown';
    }

    const hasProxyResidual = !!globalHttpProxy && globalHttpProxy !== ':0';
    const hasPrivateDnsRisk = privateDnsMode === 'hostname' && !privateDnsSpecifier;
    const hasVpnLockdownRisk = (alwaysOnVpnApp === HTK_PACKAGE) || lockdownVpn === '1';
    const hasVpnActiveProxyDeadRisk = activeNetworkIsVpn && options.proxyReachable === false;
    const isHttpProbeUnavailable = httpProbeUnavailable;
    const eligibleForClean = (
        !hasProxyResidual &&
        !hasPrivateDnsRisk &&
        !hasVpnLockdownRisk &&
        !hasVpnActiveProxyDeadRisk &&
        canPingIp === true &&
        canResolveDomain === true &&
        canHttpConnect === true &&
        !isHttpProbeUnavailable &&
        activeNetworkIsVpn !== true
    );

    if (!eligibleForClean && pollutionState === 'clean') {
        pollutionState = 'unknown';
    }

    if (!activeNetworkIsVpn && activeNetworkHasNotVpnCapability && httpProbeUnavailable) {
        warnings.push('Default network is NOT_VPN, but HTTP connectivity was not verified');
    }

    return {
        deviceId,
        globalHttpProxy,
        privateDnsMode,
        privateDnsSpecifier,
        alwaysOnVpnApp,
        lockdownVpn,
        activeNetworkIsVpn,
        activeNetworkHasNotVpnCapability,
        httpToolkitPackageRunning,
        canPingIp,
        canResolveDomain,
        canHttpConnect,
        httpProbeMethod,
        httpProbeStatus,
        httpProbeError,
        httpProbeUnavailable,
        pollutionState,
        warnings,
        errors,
        diagnostics: {
            dumpsysConnectivity: connectivity.slice(0, 3000),
            dumpsysVpn: dumpsysVpn.slice(0, 3000),
            pingIp: pingIp.slice(0, 200),
            pingDomain: pingDomain.slice(0, 200),
            httpProbeStatus,
            httpProbeError
        }
    };
}

export async function restoreAndroidNetworkBaseline(
    deviceId: string,
    baseline: AndroidNetworkBaseline | undefined,
    options: { adbClient?: Adb.Client, restoreUnsafeBaseline?: boolean } = {}
): Promise<AndroidNetworkRestoreResult> {
    const adbClient = options.adbClient ?? createAdbClient();
    const device = adbClient.getDevice(deviceId);
    const actions: string[] = [];
    const errors: string[] = [];

    const source = baseline ?? await loadAndroidNetworkBaseline(deviceId);
    const canUseBaseline = !!source && (source.baselineTrusted !== false || options.restoreUnsafeBaseline === true);

    if (canUseBaseline && source) {
        await setOrDeleteSetting(device, 'global', 'http_proxy', source.globalHttpProxy, actions, errors);
        await setOrDeleteSetting(device, 'global', 'global_http_proxy_host', source.globalHttpProxyHost, actions, errors);
        await setOrDeleteSetting(device, 'global', 'global_http_proxy_port', source.globalHttpProxyPort, actions, errors);
        await setOrDeleteSetting(device, 'global', 'global_http_proxy_exclusion_list', source.globalHttpProxyExclusionList, actions, errors);
        await setOrDeleteSetting(device, 'global', 'private_dns_mode', source.privateDnsMode, actions, errors);
        await setOrDeleteSetting(device, 'global', 'private_dns_specifier', source.privateDnsSpecifier, actions, errors);
        await setOrDeleteSetting(device, 'secure', 'always_on_vpn_app', source.alwaysOnVpnApp, actions, errors);
        if ((source.lockdownVpn ?? '0') === '1') {
            // Safety first: never enforce lockdown when restoring by default.
            await setOrDeleteSetting(device, 'secure', 'lockdown_vpn', '0', actions, errors);
        } else {
            await setOrDeleteSetting(device, 'secure', 'lockdown_vpn', source.lockdownVpn, actions, errors);
        }
    } else {
        if (source && source.baselineTrusted === false && options.restoreUnsafeBaseline !== true) {
            actions.push('skip-untrusted-baseline');
        }
        await setOrDeleteSetting(device, 'global', 'http_proxy', null, actions, errors);
        await setOrDeleteSetting(device, 'global', 'global_http_proxy_host', null, actions, errors);
        await setOrDeleteSetting(device, 'global', 'global_http_proxy_port', null, actions, errors);
        await setOrDeleteSetting(device, 'global', 'global_http_proxy_exclusion_list', null, actions, errors);
        await setOrDeleteSetting(device, 'global', 'http_proxy', ':0', actions, errors);
        await setOrDeleteSetting(device, 'global', 'private_dns_mode', 'off', actions, errors);
        await setOrDeleteSetting(device, 'global', 'private_dns_specifier', null, actions, errors);
        await setOrDeleteSetting(device, 'secure', 'always_on_vpn_app', null, actions, errors);
        await setOrDeleteSetting(device, 'secure', 'lockdown_vpn', '0', actions, errors);
    }

    return {
        deviceId,
        success: errors.length === 0,
        usedBaseline: canUseBaseline,
        actions,
        errors
    };
}

export async function rescueAndroidNetwork(
    deviceId: string,
    options: {
        adbClient?: Adb.Client,
        runHostAdb?: typeof runHostAdbCommand,
        proxyReachable?: boolean
    } = {}
): Promise<AndroidNetworkRescueResult> {
    const adbClient = options.adbClient ?? createAdbClient();
    const runHostAdb = options.runHostAdb ?? runHostAdbCommand;
    const device = adbClient.getDevice(deviceId);
    const actions: string[] = [];
    const remainingIssues: string[] = [];

    const safeShell = async (command: string[], actionName: string, timeout = 12000) => {
        try {
            await runAdbShellCommand(device, command, { timeout, skipLogging: true });
            actions.push(actionName);
        } catch (error) {
            remainingIssues.push(`${actionName}: ${isErrorLike(error) ? error.message ?? String(error) : String(error)}`);
        }
    };

    await safeShell(['am', 'start', '-a', 'tech.httptoolkit.android.DEACTIVATE', '-p', HTK_PACKAGE], 'deactivate-intent');
    await safeShell(['am', 'force-stop', HTK_PACKAGE], 'force-stop');
    await safeShell(['pm', 'clear', HTK_PACKAGE], 'pm-clear');

    const reverseResult = await runHostAdb(deviceId, ['reverse', '--remove-all'], { timeout: 10000 });
    if (reverseResult.success) {
        actions.push('remove-reverse-tunnels');
    } else {
        remainingIssues.push(`remove-reverse-tunnels: ${reverseResult.error ?? reverseResult.stderr ?? 'unknown error'}`);
    }

    await safeShell(['settings', 'delete', 'global', 'http_proxy'], 'delete-http-proxy');
    await safeShell(['settings', 'delete', 'global', 'global_http_proxy_host'], 'delete-proxy-host');
    await safeShell(['settings', 'delete', 'global', 'global_http_proxy_port'], 'delete-proxy-port');
    await safeShell(['settings', 'delete', 'global', 'global_http_proxy_exclusion_list'], 'delete-proxy-exclusion');
    await safeShell(['settings', 'put', 'global', 'http_proxy', ':0'], 'put-http-proxy-zero');
    await safeShell(['settings', 'put', 'global', 'private_dns_mode', 'off'], 'disable-private-dns');
    await safeShell(['settings', 'delete', 'global', 'private_dns_specifier'], 'delete-private-dns-specifier');
    await safeShell(['settings', 'delete', 'secure', 'always_on_vpn_app'], 'delete-always-on-vpn');
    await safeShell(['settings', 'put', 'secure', 'lockdown_vpn', '0'], 'disable-lockdown-vpn');

    await safeShell(['cmd', 'connectivity', 'airplane-mode', 'enable'], 'airplane-enable');
    await delay(3000);
    await safeShell(['cmd', 'connectivity', 'airplane-mode', 'disable'], 'airplane-disable');
    await safeShell(['svc', 'wifi', 'disable'], 'wifi-disable');
    await delay(3000);
    await safeShell(['svc', 'wifi', 'enable'], 'wifi-enable');

    const diagnostics = await inspectAndroidNetworkSafety(deviceId, {
        adbClient,
        proxyReachable: options.proxyReachable
    });

    if (diagnostics.pollutionState !== 'clean') {
        remainingIssues.push(`pollutionState=${diagnostics.pollutionState}`);
    }

    return {
        deviceId,
        success: remainingIssues.length === 0,
        networkRiskCleared: diagnostics.pollutionState === 'clean',
        pollutionState: diagnostics.pollutionState,
        actions,
        remainingIssues,
        diagnostics
    };
}
