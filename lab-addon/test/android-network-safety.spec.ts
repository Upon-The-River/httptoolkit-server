import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AdbExecutor } from '../src/android/adb-executor';
import { AndroidNetworkSafetyService } from '../src/android/android-network-safety';

class FakeAdbExecutor implements AdbExecutor {
    public readonly shellCalls: Array<{ deviceId?: string, command: string[] }> = [];

    constructor(
        private readonly onlineDevices: string[],
        private readonly commandResults: Record<string, string>
    ) {}

    async shell(command: string[], options: { deviceId?: string } = {}): Promise<string> {
        this.shellCalls.push({ deviceId: options.deviceId, command: [...command] });
        const key = `${options.deviceId ?? 'none'}::${command.join(' ')}`;
        return this.commandResults[key] ?? '';
    }

    async listOnlineDevices(): Promise<string[]> {
        return this.onlineDevices;
    }
}

const baseDeviceResults: Record<string, string> = {
    'device-123::settings get global http_proxy': '10.0.2.2:8080',
    'device-123::settings get global global_http_proxy_host': '10.0.2.2',
    'device-123::settings get global global_http_proxy_port': '8080',
    'device-123::settings get global global_http_proxy_exclusion_list': 'localhost',
    'device-123::settings get global private_dns_mode': 'hostname',
    'device-123::settings get global private_dns_specifier': 'dns.example',
    'device-123::settings get secure always_on_vpn_app': 'tech.httptoolkit.android.v1',
    'device-123::settings get secure lockdown_vpn': '1',
    'device-123::dumpsys vpn': 'VPN running: tech.httptoolkit.android.v1',
    'device-123::dumpsys connectivity': 'Active network: tun0 VPN',
    'device-123::settings delete global http_proxy': '',
    'device-123::settings delete global global_http_proxy_host': '',
    'device-123::settings delete global global_http_proxy_port': '',
    'device-123::settings delete global global_http_proxy_exclusion_list': '',
    'device-123::settings put global private_dns_mode opportunistic': '',
    'device-123::settings delete global private_dns_specifier': ''
};

describe('AndroidNetworkSafetyService', () => {
    it('builds a structured non-mutating inspection report from adb settings and dumpsys output', async () => {
        const fakeExecutor = new FakeAdbExecutor(['device-123'], baseDeviceResults);

        const service = new AndroidNetworkSafetyService(fakeExecutor);
        const report = await service.inspectNetwork();

        assert.equal(report.ok, true);
        assert.equal(report.inspectMode, 'read-only');
        assert.equal(report.deviceId, 'device-123');
        assert.equal(report.proxy.globalHttpProxy, '10.0.2.2:8080');
        assert.equal(report.privateDns.mode, 'hostname');
        assert.equal(report.vpn.alwaysOnVpnApp, 'tech.httptoolkit.android.v1');
        assert.equal(report.vpn.activeNetworkMentionsVpn, true);
        assert.equal(report.warnings.length, 3);
    });

    it('uses explicit device id when provided', async () => {
        const fakeExecutor = new FakeAdbExecutor(
            ['device-a', 'device-b'],
            {
                'device-b::settings get global http_proxy': 'null'
            }
        );

        const service = new AndroidNetworkSafetyService(fakeExecutor);
        const report = await service.inspectNetwork({ deviceId: 'device-b' });

        assert.equal(report.deviceId, 'device-b');
        assert.equal(report.proxy.globalHttpProxy, null);
    });

    it('rescue dryRun plans proxy clear actions but does not execute commands', async () => {
        const fakeExecutor = new FakeAdbExecutor(['device-123'], baseDeviceResults);
        const service = new AndroidNetworkSafetyService(fakeExecutor);

        const report = await service.rescueNetwork();

        assert.equal(report.implemented, true);
        assert.equal(report.dryRun, true);
        assert.equal(report.actions.some((action) => action.id === 'clear-http-proxy-primary'), true);
        assert.equal(report.actions.every((action) => action.executed === false), true);
        const writeCalls = fakeExecutor.shellCalls.filter((call) => call.command[0] === 'settings' && ['put', 'delete'].includes(call.command[1]));
        assert.equal(writeCalls.length, 0);
    });

    it('rescue dryRun=false executes low/medium risk proxy clear commands', async () => {
        const fakeExecutor = new FakeAdbExecutor(['device-123'], baseDeviceResults);
        const service = new AndroidNetworkSafetyService(fakeExecutor);

        const report = await service.rescueNetwork({ dryRun: false });

        assert.equal(report.actions.filter((action) => action.executed).length, 4);
        assert.equal(fakeExecutor.shellCalls.some((call) => call.command.join(' ') === 'settings delete global http_proxy'), true);
        assert.equal(fakeExecutor.shellCalls.some((call) => call.command.join(' ') === 'settings delete global global_http_proxy_host'), true);
        assert.equal(fakeExecutor.shellCalls.some((call) => call.command.join(' ') === 'settings delete global global_http_proxy_port'), true);
        assert.equal(fakeExecutor.shellCalls.some((call) => call.command.join(' ') === 'settings delete global global_http_proxy_exclusion_list'), true);
    });

    it('rescue does not clear private DNS by default', async () => {
        const fakeExecutor = new FakeAdbExecutor(['device-123'], baseDeviceResults);
        const service = new AndroidNetworkSafetyService(fakeExecutor);

        const report = await service.rescueNetwork({ dryRun: false });

        assert.equal(report.actions.some((action) => action.id.includes('private-dns')), false);
        const privateDnsWrites = fakeExecutor.shellCalls.filter((call) => {
            const cmd = call.command.join(' ');
            return /^settings (put|delete) .*private_dns/.test(cmd);
        });
        assert.equal(privateDnsWrites.length, 0);
    });

    it('rescue clearPrivateDns=true plans and executes private DNS reset', async () => {
        const fakeExecutor = new FakeAdbExecutor(['device-123'], baseDeviceResults);
        const service = new AndroidNetworkSafetyService(fakeExecutor);

        const report = await service.rescueNetwork({ dryRun: false, clearPrivateDns: true });

        const modeAction = report.actions.find((action) => action.id === 'set-private-dns-opportunistic');
        const specifierAction = report.actions.find((action) => action.id === 'clear-private-dns-specifier');

        assert.ok(modeAction);
        assert.ok(specifierAction);
        assert.equal(modeAction.executed, true);
        assert.equal(specifierAction.executed, true);
        assert.equal(fakeExecutor.shellCalls.some((call) => call.command.join(' ') === 'settings put global private_dns_mode opportunistic'), true);
        assert.equal(fakeExecutor.shellCalls.some((call) => call.command.join(' ') === 'settings delete global private_dns_specifier'), true);
    });

    it('rescue clearAlwaysOnVpn=true skips high-risk actions safely', async () => {
        const fakeExecutor = new FakeAdbExecutor(['device-123'], baseDeviceResults);
        const service = new AndroidNetworkSafetyService(fakeExecutor);

        const report = await service.rescueNetwork({ dryRun: false, clearAlwaysOnVpn: true });

        const vpnAction = report.actions.find((action) => action.id === 'clear-always-on-vpn');
        assert.ok(vpnAction);
        assert.equal(vpnAction.riskLevel, 'high');
        assert.equal(vpnAction.executed, false);
        assert.equal(vpnAction.skipped, true);
        assert.equal(fakeExecutor.shellCalls.some((call) => call.command.join(' ') === 'settings delete secure always_on_vpn_app'), false);
    });

    it('rescue performs before and after inspection when includeAfterInspection=true', async () => {
        const fakeExecutor = new FakeAdbExecutor(['device-123'], baseDeviceResults);
        const service = new AndroidNetworkSafetyService(fakeExecutor);

        const report = await service.rescueNetwork({ dryRun: true, includeAfterInspection: true });

        assert.ok(report.before);
        assert.ok(report.after);
        const inspectSettingReads = fakeExecutor.shellCalls.filter((call) => call.command.join(' ') === 'settings get global http_proxy');
        assert.equal(inspectSettingReads.length, 2);
    });

    it('rescue never schedules reboot/uninstall/disable-app commands', async () => {
        const fakeExecutor = new FakeAdbExecutor(['device-123'], baseDeviceResults);
        const service = new AndroidNetworkSafetyService(fakeExecutor);

        const report = await service.rescueNetwork({
            dryRun: false,
            clearPrivateDns: true,
            clearAlwaysOnVpn: true
        });

        const commandText = report.actions.map((action) => action.command ?? '').join('\n');
        assert.equal(/\breboot\b/i.test(commandText), false);
        assert.equal(/\bpm\s+uninstall\b/i.test(commandText), false);
        assert.equal(/\bpm\s+disable\b/i.test(commandText), false);
    });
});
