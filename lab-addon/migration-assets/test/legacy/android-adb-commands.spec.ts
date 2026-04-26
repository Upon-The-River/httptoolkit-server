import { expect } from 'chai';
import { Readable } from 'stream';

import {
    bringPackageToFront,
    diagnoseAdbTunnelError,
    inspectAndroidVpnState,
    runStatelessAndroidCleanup,
    waitForAndroidToolkitConnected
} from '../../src/interceptors/android/adb-commands';

type ShellHandler = (command: string[]) => string | Error;

function mockDeviceClient(handler: ShellHandler) {
    const commands: string[][] = [];

    return {
        client: {
            shell: async (command: string[]) => {
                commands.push(command);

                const result = handler(command);
                if (result instanceof Error) throw result;

                return Readable.from([Buffer.from(result, 'utf8')]);
            }
        } as any,
        commands
    };
}

describe('Android ADB commands', () => {
    it('uses the resolved launcher activity when available', async () => {
        const { client, commands } = mockDeviceClient((command) => {
            if (command.slice(0, 3).join(' ') === 'cmd package resolve-activity') {
                return 'tech.httptoolkit.android.v1/tech.httptoolkit.android.main.MainActivity\n';
            }

            return '';
        });

        await bringPackageToFront(client, 'tech.httptoolkit.android.v1');

        expect(commands).to.deep.include([
            'am', 'start', '--activity-single-top',
            'tech.httptoolkit.android.v1/tech.httptoolkit.android.main.MainActivity'
        ]);
        expect(commands.some((command) => command[0] === 'monkey')).to.equal(false);
    });

    it('fails when launcher activity cannot be resolved and monkey fallback fails', async () => {
        const { client, commands } = mockDeviceClient((command) => {
            if (
                command.slice(0, 3).join(' ') === 'cmd package resolve-activity' ||
                command.slice(0, 2).join(' ') === 'pm resolve-activity'
            ) {
                return 'No activity found\n';
            }

            if (command[0] === 'monkey') {
                return new Error('monkey launch failed');
            }

            return '';
        });

        let error: Error | undefined;

        try {
            await bringPackageToFront(client, 'tech.httptoolkit.android.v1');
        } catch (e) {
            error = e as Error;
        }

        expect(error?.message).to.equal('monkey launch failed');

        expect(commands).to.deep.include([
            'monkey', '-p', 'tech.httptoolkit.android.v1', '-c', 'android.intent.category.LAUNCHER', '1'
        ]);
    });

    it('returns connected=false when activation verification times out', async () => {
        const { client } = mockDeviceClient(() => 'no vpn');

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 50,
            pollIntervalMs: 10
        });

        expect(result.connected).to.equal(false);
        expect(result.reason).to.contain('timeout_waiting_for_vpn_connected');
    });

    it('does not treat generic connectivity connected output as VPN connected', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'dumpsys' && command[1] === 'connectivity') {
                return 'NetworkAgentInfo [WIFI () - 100] CONNECTED';
            }
            return '';
        });

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 50,
            pollIntervalMs: 10
        });

        expect(result.connected).to.equal(false);
        expect(result.reason).to.contain('generic-connected-text-present');
    });

    it('does not treat ordinary app network activity as VPN connected', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'dumpsys' && command[1] === 'activity') {
                return 'Running activities: tech.httptoolkit.android.v1/.RemoteControlMainActivity';
            }
            if (command[0] === 'logcat') {
                return 'I/HttpToolkit: Sending request to https://example.com';
            }
            return '';
        });

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 50,
            pollIntervalMs: 10
        });

        expect(result.connected).to.equal(false);
        expect(result.reason).to.contain('app-running-without-explicit-vpn-state');
    });

    it('returns connected=false for real-style dump with vpn service unavailable and NOT_VPN wifi active', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'dumpsys' && command[1] === 'vpn') {
                return `Can't find service: vpn`;
            }
            if (command[0] === 'dumpsys' && command[1] === 'connectivity') {
                return `
                    Active default network: WIFI
                    NetworkCapabilities: INTERNET&NOT_RESTRICTED&TRUSTED&NOT_VPN
                    NetworkRequest [ REQUEST id=77, [ Capabilities: INTERNET ] ] for tech.httptoolkit.android.v1
                `;
            }
            if (command[0] === 'dumpsys' && command[1] === 'activity') {
                return 'Running activities: tech.httptoolkit.android.v1/.RemoteControlMainActivity';
            }
            return '';
        });

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 50,
            pollIntervalMs: 10
        });

        expect(result.connected).to.equal(false);
        expect(result.reason).to.contain('vpn-service-unavailable');
        expect(result.reason).to.contain('active-network-wifi');
        expect(result.reason).to.contain('default-network-not-vpn');
        expect(result.reason).to.contain('app-networkrequest-without-vpn');
    });

    it('does not treat app in foreground activity alone as connected', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'dumpsys' && command[1] === 'activity') {
                return `
                    mResumedActivity: ActivityRecord{abc u0 tech.httptoolkit.android.v1/.RemoteControlMainActivity}
                    topResumedActivity=tech.httptoolkit.android.v1/.main.MainActivity
                `;
            }
            return '';
        });

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 50,
            pollIntervalMs: 10
        });

        expect(result.connected).to.equal(false);
        expect(result.reason).to.contain('app-running-without-explicit-vpn-state');
    });

    it('does not return connected=true based on VPN owner signal without explicit app state', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'dumpsys' && command[1] === 'vpn') {
                return 'Active VPN: tech.httptoolkit.android.v1 state=CONNECTED';
            }

            return '';
        });

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 50,
            pollIntervalMs: 10
        });

        expect(result.connected).to.equal(false);
        expect(result.reason).to.contain('vpn-owner-signal-observed-without-app-state');
    });

    it('returns connected=true when explicit app state reports connected', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'dumpsys' && command[1] === 'activity') {
                return 'tech.httptoolkit.android.v1 HTK-ANDROID-STATE state=activate_received\ntech.httptoolkit.android.v1 HTK-ANDROID-STATE state=connected';
            }
            return '';
        });

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 50,
            pollIntervalMs: 10
        });

        expect(result).to.deep.equal({ connected: true, signal: 'app-state' });
    });

    it('classifies adb tunnel offline failures as transport loss', () => {
        const diagnosis = diagnoseAdbTunnelError("Failure: 'device offline'");
        expect(diagnosis).to.equal('device_offline:adb_transport_lost');
    });

    it('classifies adb tunnel missing-device failures as serial missing', () => {
        const diagnosis = diagnoseAdbTunnelError("Failure: 'device 23091JEGR04484 not found'");
        expect(diagnosis).to.equal('device_not_found:adb_serial_missing');
    });

    it('returns connected=true when structured state is present in logcat', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'logcat') {
                return 'I/HTK-ANDROID-STATE: ACTIVATE_RECEIVED\nI/HTK-ANDROID-STATE: CONNECTED';
            }
            return '';
        });

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 50,
            pollIntervalMs: 10
        });

        expect(result).to.deep.equal({ connected: true, signal: 'app-log' });
    });

    it('does not accept connected app-log state without ACTIVATE_RECEIVED marker by default', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'logcat') {
                return 'I/HTK-ANDROID-STATE: CONNECTED';
            }
            return '';
        });

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 50,
            pollIntervalMs: 10
        });

        expect(result.connected).to.equal(false);
        expect(result.reason).to.contain('connected-without-activate-received');
    });

    it('can accept connected app-log state without ACTIVATE_RECEIVED marker when explicitly disabled', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'logcat') {
                return 'I/HTK-ANDROID-STATE: CONNECTED';
            }
            return '';
        });

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 50,
            pollIntervalMs: 10,
            requireActivationStartSignal: false
        });

        expect(result).to.deep.equal({ connected: true, signal: 'app-log' });
    });

    it('returns connected=false immediately with machine-readable connect-failed reason from app logcat', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'logcat') {
                return 'I/HTK-ANDROID-STATE: ACTIVATE_RECEIVED\nI/HTK-ANDROID-STATE: CONNECT_FAILED:vpn-start-failed';
            }
            return '';
        });

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 1000,
            pollIntervalMs: 10
        });

        expect(result).to.deep.equal({
            connected: false,
            reason: 'app_connect_failed:vpn-start-failed'
        });
    });

    it('returns connected=false immediately when app reports vpn permission required', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'logcat') {
                return 'I/HTK-ANDROID-STATE: ACTIVATE_RECEIVED\nI/HTK-ANDROID-STATE: VPN_PERMISSION_REQUIRED';
            }
            return '';
        });

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 1000,
            pollIntervalMs: 10
        });

        expect(result).to.deep.equal({
            connected: false,
            reason: 'app_connect_failed:vpn-permission-required'
        });
    });

    it('returns connected=false immediately when app reports desktop unreachable in structured logs', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'logcat') {
                return 'I/HTK-ANDROID-STATE: ACTIVATE_RECEIVED\nI/HTK-ANDROID-STATE: DESKTOP_REACHABLE:false reason=desktop-unreachable';
            }
            return '';
        });

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 1000,
            pollIntervalMs: 10
        });

        expect(result).to.deep.equal({
            connected: false,
            reason: 'app_connect_failed:desktop-unreachable'
        });
    });

    it('returns connected=false immediately when dumpsys activity exposes explicit app connect failure', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'dumpsys' && command[1] === 'activity') {
                return 'tech.httptoolkit.android.v1 HTK-ANDROID-STATE state=connect-failed lastErrorReason=handshake-failed';
            }
            return '';
        });

        const result = await waitForAndroidToolkitConnected(client, {
            timeoutMs: 1000,
            pollIntervalMs: 10
        });

        expect(result).to.deep.equal({
            connected: false,
            reason: 'app_connect_failed:handshake-failed'
        });
    });

    it('runStatelessAndroidCleanup clears reverse tunnels via host adb and never via adb shell', async () => {
        const shellCommands: string[][] = [];
        const adbClient = {
            listDevices: async () => [{ id: 'device-1', type: 'device' }],
            getDevice: () => ({
                shell: async (command: string[]) => {
                    shellCommands.push(command);
                    if (command[0] === 'dumpsys') {
                        return Readable.from([Buffer.from('Active VPN: none', 'utf8')]);
                    }
                    return Readable.from([Buffer.from('', 'utf8')]);
                }
            })
        } as any;
        const hostCommands: Array<{ deviceId: string, args: string[] }> = [];

        await runStatelessAndroidCleanup({
            adbClient,
            includeDiagnostics: false,
            runHostAdb: async (deviceId, args) => {
                hostCommands.push({ deviceId, args });
                return {
                    success: true,
                    command: ['adb', '-s', deviceId, ...args],
                    stdout: '',
                    stderr: '',
                    exitCode: 0
                };
            }
        });

        expect(shellCommands.some((command) => command.join(' ') === 'reverse --remove-all')).to.equal(false);
        expect(hostCommands).to.deep.equal([
            { deviceId: 'device-1', args: ['reverse', '--remove-all'] }
        ]);
    });

    it('inspectAndroidVpnState reports vpnActive=true from dumpsys and app state logs', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'dumpsys' && command[1] === 'vpn') {
                return 'Active VPN package: tech.httptoolkit.android.v1 state=CONNECTED';
            }
            if (command[0] === 'dumpsys' && command[1] === 'connectivity') {
                return 'NetworkAgentInfo VPN tun0 for tech.httptoolkit.android.v1';
            }
            if (command[0] === 'logcat') {
                return 'I/HTK-ANDROID-STATE: CONNECTED';
            }
            return '';
        });
        const adbClient = {
            getDevice: () => client
        } as any;

        const result = await inspectAndroidVpnState(adbClient, 'device-1');
        expect(result.vpnActive).to.equal(true);
        expect(result.vpnPackage).to.equal('tech.httptoolkit.android.v1');
    });

    it('inspectAndroidVpnState ignores stale CONNECTED logcat when dumpsys has no HTTP Toolkit VPN', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'dumpsys') return 'Active VPN package: none';
            if (command[0] === 'logcat') return 'I/HTK-ANDROID-STATE: CONNECTED';
            return '';
        });
        const adbClient = { getDevice: () => client } as any;

        const result = await inspectAndroidVpnState(adbClient, 'device-1');
        expect(result.vpnActive).to.equal(false);
        expect(result.vpnStateHint).to.equal('stale-log-connected');
        expect(result.warnings?.join('\n')).to.contain('ignored');
    });

    it('inspectAndroidVpnState does not report active when dumpsys commands fail but logcat says CONNECTED', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'dumpsys') return new Error('dumpsys unavailable');
            if (command[0] === 'logcat') return 'I/HTK-ANDROID-STATE: CONNECTED';
            return '';
        });
        const adbClient = { getDevice: () => client } as any;

        const result = await inspectAndroidVpnState(adbClient, 'device-1');
        expect(result.vpnActive).to.equal(false);
        expect(result.vpnStateHint).to.equal('diagnostic-incomplete');
        expect(result.errors.length).to.be.greaterThan(0);
    });

    it('inspectAndroidVpnState reports inactive when logcat says DISCONNECTED and dumpsys has no package', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'dumpsys') return 'Active VPN package: none';
            if (command[0] === 'logcat') return 'I/HTK-ANDROID-STATE: DISCONNECTED';
            return '';
        });
        const adbClient = { getDevice: () => client } as any;

        const result = await inspectAndroidVpnState(adbClient, 'device-1');
        expect(result.vpnActive).to.equal(false);
        expect(result.vpnStateHint).to.equal('stopped');
    });

    it('inspectAndroidVpnState keeps vpnActive=false for VpnNetworkProvider signal alone', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'dumpsys' && command[1] === 'vpn') return 'VpnNetworkProvider:0';
            if (command[0] === 'dumpsys' && command[1] === 'connectivity') return 'Transports: VPN';
            return '';
        });
        const adbClient = { getDevice: () => client } as any;
        const result = await inspectAndroidVpnState(adbClient, 'device-1');
        expect(result.vpnActive).to.equal(false);
    });

    it('inspectAndroidVpnState keeps vpnActive=false for ActivityManager force-stop logs alone', async () => {
        const { client } = mockDeviceClient((command) => {
            if (command[0] === 'dumpsys') return 'Active VPN package: none';
            if (command[0] === 'logcat') return 'ActivityManager Force stopping tech.httptoolkit.android.v1 appid=';
            return '';
        });
        const adbClient = { getDevice: () => client } as any;
        const result = await inspectAndroidVpnState(adbClient, 'device-1');
        expect(result.vpnActive).to.equal(false);
    });

    it('runStatelessAndroidCleanup listDevices failure returns type-complete result with overallSuccess=false', async () => {
        const result = await runStatelessAndroidCleanup({
            adbClient: {
                listDevices: async () => {
                    throw new Error('adb daemon not running');
                }
            } as any
        });

        expect(result.success).to.equal(false);
        expect(result.overallSuccess).to.equal(false);
        expect(result.vpnCleanupSucceeded).to.equal(false);
        expect(result.reverseCleanupSucceeded).to.equal(false);
        expect(result.errors[0]).to.contain('Failed to list adb devices');
    });

    it('runStatelessAndroidCleanup keeps vpnActiveAfter=false for VpnNetworkProvider-only diagnostics', async () => {
        const adbClient = {
            listDevices: async () => [{ id: 'device-1', type: 'device' }],
            getDevice: () => ({
                shell: async (command: string[]) => {
                    if (command[0] === 'dumpsys' && command[1] === 'vpn') {
                        return Readable.from([Buffer.from('VpnNetworkProvider:0', 'utf8')]);
                    }
                    if (command[0] === 'dumpsys' && command[1] === 'connectivity') {
                        return Readable.from([Buffer.from('NetworkRequest Transports: VPN', 'utf8')]);
                    }
                    if (command[0] === 'logcat') {
                        return Readable.from([Buffer.from('ActivityManager Force stopping tech.httptoolkit.android.v1', 'utf8')]);
                    }
                    return Readable.from([Buffer.from('', 'utf8')]);
                }
            })
        } as any;

        const result = await runStatelessAndroidCleanup({
            adbClient,
            runHostAdb: async () => ({ success: true, command: [], stdout: '', stderr: '', exitCode: 0 }) as any
        });

        expect(result.devices[0].vpnActiveAfter).to.equal(false);
    });

    it('runStatelessAndroidCleanup reports vpnActiveAfter=true for active HTTP Toolkit VPN evidence', async () => {
        const adbClient = {
            listDevices: async () => [{ id: 'device-1', type: 'device' }],
            getDevice: () => ({
                shell: async (command: string[]) => {
                    if (command[0] === 'dumpsys' && command[1] === 'vpn') {
                        return Readable.from([Buffer.from('Active VPN package: tech.httptoolkit.android.v1 state=CONNECTED', 'utf8')]);
                    }
                    if (command[0] === 'dumpsys' && command[1] === 'connectivity') {
                        return Readable.from([Buffer.from('NetworkAgentInfo VPN tun0 for tech.httptoolkit.android.v1', 'utf8')]);
                    }
                    if (command[0] === 'logcat') {
                        return Readable.from([Buffer.from('I/HTK-ANDROID-STATE: CONNECTED', 'utf8')]);
                    }
                    return Readable.from([Buffer.from('', 'utf8')]);
                }
            })
        } as any;

        const result = await runStatelessAndroidCleanup({
            adbClient,
            runHostAdb: async () => ({ success: true, command: [], stdout: '', stderr: '', exitCode: 0 }) as any
        });

        expect(result.devices[0].vpnActiveAfter).to.equal(true);
    });
});
