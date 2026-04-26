import { AdbExecutor, parseAndroidSetting, SystemAdbExecutor } from './adb-executor';
import {
    AndroidNetworkCapabilities,
    AndroidNetworkRescueStubResult,
    AndroidNetworkSafetyReport
} from './android-network-types';

export interface AndroidNetworkSafetyApi {
    inspectNetwork(options?: { deviceId?: string }): Promise<AndroidNetworkSafetyReport>;
    rescueNetwork(): Promise<AndroidNetworkRescueStubResult>;
    getCapabilities(): AndroidNetworkCapabilities;
}

export class AndroidNetworkSafetyService implements AndroidNetworkSafetyApi {
    constructor(private readonly adbExecutor: AdbExecutor = new SystemAdbExecutor()) {}

    async inspectNetwork(options: { deviceId?: string } = {}): Promise<AndroidNetworkSafetyReport> {
        const deviceId = options.deviceId ?? await this.resolveDeviceId();

        const [
            globalHttpProxy,
            globalHttpProxyHost,
            globalHttpProxyPort,
            globalHttpProxyExclusionList,
            privateDnsMode,
            privateDnsSpecifier,
            alwaysOnVpnApp,
            lockdownVpn,
            vpnSummary,
            connectivitySummary
        ] = await Promise.all([
            this.readSetting(deviceId, 'global', 'http_proxy'),
            this.readSetting(deviceId, 'global', 'global_http_proxy_host'),
            this.readSetting(deviceId, 'global', 'global_http_proxy_port'),
            this.readSetting(deviceId, 'global', 'global_http_proxy_exclusion_list'),
            this.readSetting(deviceId, 'global', 'private_dns_mode'),
            this.readSetting(deviceId, 'global', 'private_dns_specifier'),
            this.readSetting(deviceId, 'secure', 'always_on_vpn_app'),
            this.readSetting(deviceId, 'secure', 'lockdown_vpn'),
            this.safeShell(deviceId, ['dumpsys', 'vpn']),
            this.safeShell(deviceId, ['dumpsys', 'connectivity'])
        ]);

        const warnings: string[] = [];
        const hasProxy = !!globalHttpProxy || !!globalHttpProxyHost || !!globalHttpProxyPort;
        const hasPrivateDns = privateDnsMode === 'hostname' && !!privateDnsSpecifier;
        const hasVpnIndicators = !!alwaysOnVpnApp || lockdownVpn === '1' || /vpn|tun/i.test(`${vpnSummary}\n${connectivitySummary}`);

        if (hasProxy) warnings.push('Proxy settings are configured.');
        if (hasPrivateDns) warnings.push('Private DNS hostname mode is configured.');
        if (hasVpnIndicators) warnings.push('VPN-related indicators detected in settings or dumpsys output.');

        return {
            ok: true,
            inspectedAt: new Date().toISOString(),
            deviceId,
            inspectMode: 'read-only',
            proxy: {
                globalHttpProxy,
                globalHttpProxyHost,
                globalHttpProxyPort,
                globalHttpProxyExclusionList
            },
            privateDns: {
                mode: privateDnsMode,
                specifier: privateDnsSpecifier
            },
            vpn: {
                alwaysOnVpnApp,
                lockdownVpn,
                vpnSummary: this.trimSummary(vpnSummary),
                connectivitySummary: this.trimSummary(connectivitySummary),
                activeNetworkMentionsVpn: /vpn|tun/i.test(connectivitySummary)
            },
            warnings
        };
    }

    async rescueNetwork(): Promise<AndroidNetworkRescueStubResult> {
        return {
            ok: false,
            implemented: false,
            reason: 'rescue migration pending'
        };
    }

    getCapabilities(): AndroidNetworkCapabilities {
        return {
            inspect: {
                implemented: true,
                mutatesDeviceState: false
            },
            rescue: {
                implemented: false,
                mutatesDeviceState: false,
                reason: 'rescue migration pending'
            }
        };
    }

    private async resolveDeviceId(): Promise<string> {
        const devices = await this.adbExecutor.listOnlineDevices();
        if (devices.length === 0) {
            throw new Error('No online adb devices found');
        }

        return devices[0];
    }

    private async readSetting(deviceId: string, namespace: 'global' | 'secure', key: string): Promise<string | null> {
        const output = await this.safeShell(deviceId, ['settings', 'get', namespace, key]);
        return parseAndroidSetting(output);
    }

    private async safeShell(deviceId: string, command: string[]): Promise<string> {
        try {
            return await this.adbExecutor.shell(command, { deviceId, timeoutMs: 10000 });
        } catch {
            return '';
        }
    }

    private trimSummary(value: string): string {
        return value.split(/\r?\n/).slice(0, 20).join('\n').trim();
    }
}
