import { expect } from 'chai';
import { Readable } from 'stream';

import {
    captureAndroidNetworkBaseline,
    inspectAndroidNetworkSafety,
    rescueAndroidNetwork,
    restoreAndroidNetworkBaseline
} from '../../src/interceptors/android/android-network-safety';

describe('Android network safety', () => {
    const createAdbClient = (handler: (command: string[]) => string | Error) => ({
        getDevice: () => ({
            shell: async (command: string[]) => {
                const result = handler(command);
                if (result instanceof Error) throw result;
                return Readable.from([Buffer.from(result, 'utf8')]);
            }
        })
    }) as any;

    it('capture baseline reads all required settings', async () => {
        const commands: string[][] = [];
        const adbClient = createAdbClient((command) => {
            commands.push(command);
            return 'value';
        });

        const baseline = await captureAndroidNetworkBaseline('device-1', { adbClient });
        expect(baseline.deviceId).to.equal('device-1');
        expect(commands.map((c) => c.join(' '))).to.include.members([
            'settings get global http_proxy',
            'settings get global global_http_proxy_host',
            'settings get global global_http_proxy_port',
            'settings get global global_http_proxy_exclusion_list',
            'settings get global private_dns_mode',
            'settings get global private_dns_specifier',
            'settings get secure always_on_vpn_app',
            'settings get secure lockdown_vpn',
            'dumpsys connectivity'
        ]);
    });

    it('restore baseline clears proxy and vpn app when baseline values are null', async () => {
        const commands: string[][] = [];
        const adbClient = createAdbClient((command) => {
            commands.push(command);
            return '';
        });

        await restoreAndroidNetworkBaseline('device-1', {
            deviceId: 'device-1',
            capturedAt: new Date().toISOString(),
            timestamp: new Date().toISOString(),
            baselinePollutionState: 'clean',
            baselineTrusted: true,
            globalHttpProxy: null,
            globalHttpProxyHost: null,
            globalHttpProxyPort: null,
            globalHttpProxyExclusionList: null,
            privateDnsMode: 'automatic',
            privateDnsSpecifier: null,
            alwaysOnVpnApp: null,
            lockdownVpn: null,
            connectivitySummary: ''
        }, { adbClient });

        expect(commands.map((c) => c.join(' '))).to.include.members([
            'settings delete global http_proxy',
            'settings put global private_dns_mode automatic',
            'settings delete secure always_on_vpn_app',
            'settings delete secure lockdown_vpn'
        ]);
    });

    it('rescue network executes force rescue block and toggles airplane mode + wifi', async function () {
        this.timeout(10000);
        const commands: string[][] = [];
        const adbClient = createAdbClient((command) => {
            commands.push(command);
            if (command.join(' ') === 'ping -c 1 -W 2 8.8.8.8') return '1 received';
            if (command.join(' ') === 'ping -c 1 -W 2 baidu.com') return '1 received';
            return '';
        });

        await rescueAndroidNetwork('device-1', {
            adbClient,
            runHostAdb: async () => ({ success: true } as any)
        });

        expect(commands.map((c) => c.join(' '))).to.include.members([
            'am start -a tech.httptoolkit.android.DEACTIVATE -p tech.httptoolkit.android.v1',
            'am force-stop tech.httptoolkit.android.v1',
            'pm clear tech.httptoolkit.android.v1',
            'settings delete global http_proxy',
            'settings put global private_dns_mode off',
            'settings delete secure always_on_vpn_app',
            'settings put secure lockdown_vpn 0',
            'cmd connectivity airplane-mode enable',
            'cmd connectivity airplane-mode disable',
            'svc wifi disable',
            'svc wifi enable'
        ]);
    });

    it('inspect network safety identifies proxy and dns risks', async () => {
        const adbClient = createAdbClient((command) => {
            const joined = command.join(' ');
            if (joined === 'settings get global http_proxy') return '127.0.0.1:8000';
            if (joined === 'settings get global private_dns_mode') return 'hostname';
            if (joined === 'settings get global private_dns_specifier') return 'bad.dns.example';
            if (joined === 'settings get secure always_on_vpn_app') return 'null';
            if (joined === 'settings get secure lockdown_vpn') return '0';
            if (joined === 'ping -c 1 -W 2 8.8.8.8') return '1 received';
            if (joined === 'ping -c 1 -W 2 baidu.com') return '0 received';
            if (joined === 'cmd -l') return 'connectivity';
            if (joined.includes('toybox wget')) return '';
            return '';
        });

        const status = await inspectAndroidNetworkSafety('device-1', { adbClient });
        expect(status.pollutionState).to.equal('proxy-residual');
    });

    it('inspect network safety returns dns-broken when ping IP works but domain resolve fails', async () => {
        const adbClient = createAdbClient((command) => {
            const joined = command.join(' ');
            if (joined === 'settings get global http_proxy') return 'null';
            if (joined === 'settings get global private_dns_mode') return 'hostname';
            if (joined === 'settings get global private_dns_specifier') return 'bad.dns.example';
            if (joined === 'settings get secure always_on_vpn_app') return 'null';
            if (joined === 'settings get secure lockdown_vpn') return '0';
            if (joined === 'ping -c 1 -W 2 8.8.8.8') return '1 received';
            if (joined === 'ping -c 1 -W 2 baidu.com') return '0 received';
            if (joined === 'cmd -l') return 'connectivity';
            if (joined.includes('toybox wget')) throw new Error('http failed');
            return '';
        });
        const status = await inspectAndroidNetworkSafety('device-1', { adbClient });
        expect(status.pollutionState).to.equal('dns-broken');
    });

    it('inspect network safety marks partial-connectivity when HTTP probe fails despite ping+dns success', async () => {
        const adbClient = createAdbClient((command) => {
            const joined = command.join(' ');
            if (joined.startsWith('settings get')) return 'null';
            if (joined === 'settings get secure lockdown_vpn') return '0';
            if (joined === 'ping -c 1 -W 2 8.8.8.8') return '1 received';
            if (joined === 'ping -c 1 -W 2 baidu.com') return '1 received';
            if (joined === 'cmd -l') return 'connectivity';
            if (joined.includes('toybox wget')) throw new Error('timed out');
            return '';
        });
        const status = await inspectAndroidNetworkSafety('device-1', { adbClient });
        expect(status.canHttpConnect).to.equal(false);
        expect(status.httpProbeStatus).to.equal('failed');
        expect(status.pollutionState).to.equal('partial-connectivity');
    });

    it('inspect network safety reports unknown when toybox exists but wget applet is unavailable', async () => {
        const adbClient = createAdbClient((command) => {
            const joined = command.join(' ');
            if (joined.startsWith('settings get')) return 'null';
            if (joined === 'settings get secure lockdown_vpn') return '0';
            if (joined === 'ping -c 1 -W 2 8.8.8.8') return '1 received';
            if (joined === 'ping -c 1 -W 2 baidu.com') return '1 received';
            if (joined === 'cmd -l') return '';
            if (joined.includes('toybox wget')) throw new Error('toybox: Unknown command wget');
            return '';
        });
        const status = await inspectAndroidNetworkSafety('device-1', { adbClient });
        expect(status.canHttpConnect).to.equal(null);
        expect(status.httpProbeUnavailable).to.equal(true);
        expect(status.httpProbeStatus).to.equal('unavailable');
        expect(status.pollutionState).to.equal('unknown');
        expect(status.warnings.join('\n')).to.contain('HTTP probe unavailable');
    });

    it('inspect network safety uses nc fallback when toybox wget is unavailable', async () => {
        const adbClient = createAdbClient((command) => {
            const joined = command.join(' ');
            if (joined.startsWith('settings get')) return 'null';
            if (joined === 'settings get secure lockdown_vpn') return '0';
            if (joined === 'ping -c 1 -W 2 8.8.8.8') return '1 received';
            if (joined === 'ping -c 1 -W 2 baidu.com') return '1 received';
            if (joined.includes('toybox wget')) throw new Error('toybox: Unknown command wget');
            if (joined === 'which nc') return '/system/bin/nc';
            if (joined.includes('nc connectivitycheck.gstatic.com 80')) return 'HTTP/1.1 204 No Content';
            return '';
        });
        const status = await inspectAndroidNetworkSafety('device-1', { adbClient });
        expect(status.canHttpConnect).to.equal(true);
        expect(status.httpProbeMethod).to.equal('nc');
        expect(status.httpProbeUnavailable).to.equal(false);
        expect(status.pollutionState).to.equal('clean');
    });

    it('inspect network safety keeps unknown when toybox wget unavailable and nc is missing', async () => {
        const adbClient = createAdbClient((command) => {
            const joined = command.join(' ');
            if (joined.startsWith('settings get')) return 'null';
            if (joined === 'settings get secure lockdown_vpn') return '0';
            if (joined === 'ping -c 1 -W 2 8.8.8.8') return '1 received';
            if (joined === 'ping -c 1 -W 2 baidu.com') return '1 received';
            if (joined.includes('toybox wget')) throw new Error('toybox: Unknown command wget');
            if (joined === 'which nc') return '';
            return '';
        });
        const status = await inspectAndroidNetworkSafety('device-1', { adbClient });
        expect(status.canHttpConnect).to.equal(null);
        expect(status.httpProbeUnavailable).to.equal(true);
        expect(status.httpProbeMethod).to.equal(null);
        expect(status.pollutionState).to.not.equal('clean');
    });

    it('inspect network safety marks partial-connectivity when toybox wget is unavailable and nc probe fails', async () => {
        const adbClient = createAdbClient((command) => {
            const joined = command.join(' ');
            if (joined.startsWith('settings get')) return 'null';
            if (joined === 'settings get secure lockdown_vpn') return '0';
            if (joined === 'ping -c 1 -W 2 8.8.8.8') return '1 received';
            if (joined === 'ping -c 1 -W 2 baidu.com') return '1 received';
            if (joined.includes('toybox wget')) throw new Error('toybox: Unknown command wget');
            if (joined === 'which nc') return '/system/bin/nc';
            if (joined.includes('nc connectivitycheck.gstatic.com 80')) throw new Error('nc: connection timed out');
            if (joined.includes('nc www.baidu.com 80')) throw new Error('nc: connection timed out');
            return '';
        });
        const status = await inspectAndroidNetworkSafety('device-1', { adbClient });
        expect(status.httpProbeMethod).to.equal('nc');
        expect(status.canHttpConnect).to.equal(false);
        expect(status.httpProbeUnavailable).to.equal(false);
        expect(status.httpProbeStatus).to.equal('failed');
        expect(status.pollutionState).to.equal('partial-connectivity');
    });

    it('inspect network safety keeps unknown when NOT_VPN is present but HTTP probe is unavailable', async () => {
        const adbClient = createAdbClient((command) => {
            const joined = command.join(' ');
            if (joined.startsWith('settings get')) return 'null';
            if (joined === 'settings get secure lockdown_vpn') return '0';
            if (joined === 'dumpsys connectivity') return 'NetworkAgentInfo [WIFI () - CONNECTED] capabilities: INTERNET&NOT_VPN';
            if (joined === 'ping -c 1 -W 2 8.8.8.8') return '1 received';
            if (joined === 'ping -c 1 -W 2 baidu.com') return '1 received';
            if (joined === 'cmd -l') return '';
            if (joined.includes('toybox wget')) throw new Error('toybox: Unknown command wget');
            return '';
        });
        const status = await inspectAndroidNetworkSafety('device-1', { adbClient });
        expect(status.httpProbeUnavailable).to.equal(true);
        expect(status.pollutionState).to.not.equal('clean');
        expect(status.pollutionState).to.equal('unknown');
        expect(status.warnings.join('\n')).to.contain('HTTP probe unavailable');
        expect(status.warnings.join('\n')).to.contain('NOT_VPN, but HTTP connectivity was not verified');
    });

    it('inspect network safety never marks clean when NOT_VPN is present but HTTP probe fails', async () => {
        const adbClient = createAdbClient((command) => {
            const joined = command.join(' ');
            if (joined.startsWith('settings get')) return 'null';
            if (joined === 'settings get secure lockdown_vpn') return '0';
            if (joined === 'dumpsys connectivity') return 'NetworkAgentInfo [WIFI () - CONNECTED] capabilities: INTERNET&NOT_VPN';
            if (joined === 'ping -c 1 -W 2 8.8.8.8') return '1 received';
            if (joined === 'ping -c 1 -W 2 baidu.com') return '1 received';
            if (joined === 'cmd -l') return '';
            if (joined.includes('toybox wget')) throw new Error('timed out');
            return '';
        });
        const status = await inspectAndroidNetworkSafety('device-1', { adbClient });
        expect(status.canHttpConnect).to.equal(false);
        expect(status.pollutionState).to.equal('partial-connectivity');
    });

    it('inspect network safety keeps higher-priority proxy/privateDns/vpn risks over HTTP probe status', async () => {
        const adbClient = createAdbClient((command) => {
            const joined = command.join(' ');
            if (joined === 'settings get global http_proxy') return '127.0.0.1:8000';
            if (joined === 'settings get global private_dns_mode') return 'hostname';
            if (joined === 'settings get global private_dns_specifier') return '';
            if (joined === 'settings get secure always_on_vpn_app') return 'tech.httptoolkit.android.v1';
            if (joined === 'settings get secure lockdown_vpn') return '1';
            if (joined === 'ping -c 1 -W 2 8.8.8.8') return '1 received';
            if (joined === 'ping -c 1 -W 2 baidu.com') return '1 received';
            if (joined === 'cmd -l') return '';
            if (joined.includes('toybox wget')) throw new Error('toybox: Unknown command wget');
            return '';
        });
        const status = await inspectAndroidNetworkSafety('device-1', { adbClient });
        expect(status.pollutionState).to.equal('proxy-residual');
    });

    it('inspect network safety is clean only when ping, dns and HTTP probe all succeed', async () => {
        const adbClient = createAdbClient((command) => {
            const joined = command.join(' ');
            if (joined.startsWith('settings get')) return 'null';
            if (joined === 'settings get secure lockdown_vpn') return '0';
            if (joined === 'ping -c 1 -W 2 8.8.8.8') return '1 received';
            if (joined === 'ping -c 1 -W 2 baidu.com') return '1 received';
            if (joined.includes('toybox wget')) return '';
            return '';
        });
        const status = await inspectAndroidNetworkSafety('device-1', { adbClient });
        expect(status.canHttpConnect).to.equal(true);
        expect(status.pollutionState).to.equal('clean');
    });
});
