import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AdbExecutor } from '../src/android/adb-executor';
import { AndroidNetworkSafetyService } from '../src/android/android-network-safety';

class FakeAdbExecutor implements AdbExecutor {
    constructor(
        private readonly onlineDevices: string[],
        private readonly commandResults: Record<string, string>
    ) {}

    async shell(command: string[], options: { deviceId?: string } = {}): Promise<string> {
        const key = `${options.deviceId ?? 'none'}::${command.join(' ')}`;
        return this.commandResults[key] ?? '';
    }

    async listOnlineDevices(): Promise<string[]> {
        return this.onlineDevices;
    }
}

describe('AndroidNetworkSafetyService', () => {
    it('builds a structured non-mutating inspection report from adb settings and dumpsys output', async () => {
        const fakeExecutor = new FakeAdbExecutor(
            ['device-123'],
            {
                'device-123::settings get global http_proxy': '10.0.2.2:8080',
                'device-123::settings get global global_http_proxy_host': '10.0.2.2',
                'device-123::settings get global global_http_proxy_port': '8080',
                'device-123::settings get global global_http_proxy_exclusion_list': 'localhost',
                'device-123::settings get global private_dns_mode': 'hostname',
                'device-123::settings get global private_dns_specifier': 'dns.example',
                'device-123::settings get secure always_on_vpn_app': 'tech.httptoolkit.android.v1',
                'device-123::settings get secure lockdown_vpn': '1',
                'device-123::dumpsys vpn': 'VPN running: tech.httptoolkit.android.v1',
                'device-123::dumpsys connectivity': 'Active network: tun0 VPN'
            }
        );

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

    it('returns rescue stub response', async () => {
        const service = new AndroidNetworkSafetyService(new FakeAdbExecutor([], {}));
        assert.deepEqual(await service.rescueNetwork(), {
            ok: false,
            implemented: false,
            reason: 'rescue migration pending'
        });
    });
});
