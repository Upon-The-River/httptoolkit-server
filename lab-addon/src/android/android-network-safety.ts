import { AdbExecutor, parseAndroidSetting, SystemAdbExecutor } from './adb-executor';
import {
    AndroidNetworkCapabilities,
    AndroidNetworkRescueAction,
    AndroidNetworkRescueOptions,
    AndroidNetworkRescueReport,
    AndroidNetworkSafetyReport
} from './android-network-types';

export interface AndroidNetworkSafetyApi {
    inspectNetwork(options?: { deviceId?: string }): Promise<AndroidNetworkSafetyReport>;
    rescueNetwork(options?: AndroidNetworkRescueOptions): Promise<AndroidNetworkRescueReport>;
    getCapabilities(): AndroidNetworkCapabilities;
}

interface PlannedActionInput {
    id: string;
    description: string;
    riskLevel: 'low' | 'medium' | 'high';
    command?: string[];
    skipReason?: string;
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

    async rescueNetwork(options: AndroidNetworkRescueOptions = {}): Promise<AndroidNetworkRescueReport> {
        const resolvedOptions = {
            deviceId: options.deviceId,
            dryRun: options.dryRun ?? true,
            clearHttpProxy: options.clearHttpProxy ?? true,
            clearPrivateDns: options.clearPrivateDns ?? false,
            clearAlwaysOnVpn: options.clearAlwaysOnVpn ?? false,
            includeAfterInspection: options.includeAfterInspection ?? true
        };

        const before = await this.inspectNetwork({ deviceId: resolvedOptions.deviceId });
        const warnings = [
            'Rescue is explicit and conservative: no reboot, no app uninstall, no VPN app disable.',
            'High-risk actions are skipped unless a future explicit force option is implemented.'
        ];

        const planned = this.planActions(before, resolvedOptions);
        const actions: AndroidNetworkRescueAction[] = [];

        for (const candidate of planned) {
            const commandText = candidate.command?.join(' ');
            const forceSkipped = candidate.riskLevel === 'high'
                ? 'High-risk actions are disabled in this rescue slice.'
                : candidate.skipReason;

            if (resolvedOptions.dryRun) {
                actions.push({
                    id: candidate.id,
                    description: candidate.description,
                    riskLevel: candidate.riskLevel,
                    command: commandText,
                    executed: false,
                    skipped: true,
                    reason: forceSkipped ?? 'dry-run'
                });
                continue;
            }

            if (forceSkipped) {
                actions.push({
                    id: candidate.id,
                    description: candidate.description,
                    riskLevel: candidate.riskLevel,
                    command: commandText,
                    executed: false,
                    skipped: true,
                    reason: forceSkipped
                });
                continue;
            }

            if (!candidate.command) {
                actions.push({
                    id: candidate.id,
                    description: candidate.description,
                    riskLevel: candidate.riskLevel,
                    executed: false,
                    skipped: true,
                    reason: 'No executable command generated.'
                });
                continue;
            }

            const stdout = await this.safeShell(before.deviceId, candidate.command);
            actions.push({
                id: candidate.id,
                description: candidate.description,
                riskLevel: candidate.riskLevel,
                command: commandText,
                executed: true,
                skipped: false,
                stdout
            });
        }

        const after = resolvedOptions.includeAfterInspection
            ? await this.inspectNetwork({ deviceId: before.deviceId })
            : undefined;

        const skippedHighRisk = actions.some((action) => action.riskLevel === 'high' && action.skipped);
        if (skippedHighRisk) {
            warnings.push('At least one requested action was high-risk and intentionally skipped.');
        }

        return {
            ok: true,
            implemented: true,
            deviceId: before.deviceId,
            dryRun: resolvedOptions.dryRun,
            actions,
            warnings,
            before,
            after
        };
    }

    getCapabilities(): AndroidNetworkCapabilities {
        return {
            inspect: {
                implemented: true,
                mutatesDeviceState: false
            },
            rescue: {
                implemented: true,
                mutatesDeviceState: true,
                defaultDryRun: true,
                limitations: [
                    'no reboot',
                    'no app uninstall',
                    'no VPN app disable',
                    'high-risk actions skipped'
                ]
            }
        };
    }

    private planActions(before: AndroidNetworkSafetyReport, options: Required<AndroidNetworkRescueOptions>): PlannedActionInput[] {
        const actions: PlannedActionInput[] = [];

        if (options.clearHttpProxy) {
            actions.push(
                {
                    id: 'clear-http-proxy-primary',
                    description: 'Clear global HTTP proxy setting.',
                    riskLevel: 'low',
                    command: ['settings', 'delete', 'global', 'http_proxy']
                },
                {
                    id: 'clear-http-proxy-host',
                    description: 'Clear global HTTP proxy host setting.',
                    riskLevel: 'low',
                    command: ['settings', 'delete', 'global', 'global_http_proxy_host']
                },
                {
                    id: 'clear-http-proxy-port',
                    description: 'Clear global HTTP proxy port setting.',
                    riskLevel: 'low',
                    command: ['settings', 'delete', 'global', 'global_http_proxy_port']
                },
                {
                    id: 'clear-http-proxy-exclusion-list',
                    description: 'Clear global HTTP proxy exclusion list.',
                    riskLevel: 'low',
                    command: ['settings', 'delete', 'global', 'global_http_proxy_exclusion_list']
                }
            );
        }

        if (options.clearPrivateDns) {
            actions.push(
                {
                    id: 'set-private-dns-opportunistic',
                    description: 'Reset private DNS mode to opportunistic for conservative recovery.',
                    riskLevel: 'medium',
                    command: ['settings', 'put', 'global', 'private_dns_mode', 'opportunistic']
                },
                {
                    id: 'clear-private-dns-specifier',
                    description: 'Clear private DNS hostname specifier.',
                    riskLevel: 'medium',
                    command: ['settings', 'delete', 'global', 'private_dns_specifier']
                }
            );
        }

        if (options.clearAlwaysOnVpn) {
            if (before.vpn.alwaysOnVpnApp || before.vpn.lockdownVpn === '1') {
                actions.push({
                    id: 'clear-always-on-vpn',
                    description: 'Clear always-on VPN settings (requires explicit high-risk override, currently disabled).',
                    riskLevel: 'high',
                    command: ['settings', 'delete', 'secure', 'always_on_vpn_app'],
                    skipReason: 'High-risk always-on VPN changes require a future explicit override option.'
                });
            } else {
                actions.push({
                    id: 'clear-always-on-vpn',
                    description: 'No always-on VPN settings detected to clear.',
                    riskLevel: 'high',
                    skipReason: 'No clearly identified always-on VPN setting found.'
                });
            }
        }

        if (actions.length === 0) {
            actions.push({
                id: 'no-op',
                description: 'No rescue actions were enabled.',
                riskLevel: 'low',
                skipReason: 'All rescue options were disabled.'
            });
        }

        return actions;
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
