import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AdbExecutor } from '../src/android/adb-executor';
import { AdbAndroidActivationClient } from '../src/automation/adb-android-activation-client';

class FakeAdbExecutor implements AdbExecutor {
    public readonly shellCalls: Array<{ command: string[], deviceId?: string }> = [];

    constructor(
        private readonly devices: string[],
        private readonly shellResponder: (command: string[]) => string
    ) {}

    async listOnlineDevices(): Promise<string[]> {
        return this.devices;
    }

    async shell(command: string[], options: { deviceId?: string } = {}): Promise<string> {
        this.shellCalls.push({ command, deviceId: options.deviceId });
        return this.shellResponder(command);
    }
}

describe('AdbAndroidActivationClient', () => {
    it('calls official bridge first and returns success when bridge succeeds', async () => {
        const fakeAdb = new FakeAdbExecutor(['device-1'], () => '');
        const fetchCalls: string[] = [];
        const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
            fetchCalls.push(String(url));
            return new Response(JSON.stringify({
                success: true,
                controlPlaneSuccess: true
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }) as typeof fetch;
        const client = new AdbAndroidActivationClient(fakeAdb, fakeFetch);

        const result = await client.activateDeviceCapture({
            deviceId: 'device-1',
            proxyPort: 9001,
            enableSocks: true
        });

        assert.equal(result.success, true);
        assert.equal((result.details as any).activationMode, 'official-bridge');
        assert.equal(fetchCalls[0], 'http://127.0.0.1:45458/automation/android-adb/start-headless');
        assert.equal(fakeAdb.shellCalls.length, 0);
    });

    it('treats bridge success=false when controlPlaneSuccess is false', async () => {
        const fakeAdb = new FakeAdbExecutor(['device-1'], () => '');
        const fakeFetch: typeof fetch = (async () => new Response(JSON.stringify({
            success: true,
            controlPlaneSuccess: false
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        })) as typeof fetch;
        const client = new AdbAndroidActivationClient(fakeAdb, fakeFetch);

        const result = await client.activateDeviceCapture({
            deviceId: 'device-1',
            proxyPort: 8000,
            enableSocks: false
        });

        assert.equal(result.success, false);
        assert.equal((result.details as any).activationMode, 'partial');
        assert.equal(result.errors?.includes('official-bridge-failed'), true);
    });

    it('official bridge 404 falls back to partial adb intent mode', async () => {
        const fakeAdb = new FakeAdbExecutor(['device-1'], (command) => {
            if (command[0] === 'getprop') return 'Pixel 8';
            if (command[0] === 'dumpsys' && command[1] === 'activity') return 'tech.httptoolkit.android.v1/.RemoteControlMainActivity';
            return '';
        });
        const fakeFetch: typeof fetch = (async () =>
            new Response('missing', { status: 404 })) as typeof fetch;
        const client = new AdbAndroidActivationClient(fakeAdb, fakeFetch);

        const result = await client.activateDeviceCapture({
            deviceId: 'device-1',
            proxyPort: 9001,
            enableSocks: false
        });

        assert.equal(result.success, false);
        assert.equal((result.details as any).activationMode, 'partial');
        assert.equal((result.details as any).reason, 'missing-official-activation-bridge');
    });

    it('official bridge unreachable falls back to partial adb intent mode', async () => {
        const fakeAdb = new FakeAdbExecutor(['device-1'], (command) => {
            if (command[0] === 'getprop') return 'Pixel 8';
            if (command[0] === 'dumpsys' && command[1] === 'activity') return 'tech.httptoolkit.android.v1/.RemoteControlMainActivity';
            return '';
        });
        const fakeFetch: typeof fetch = (async () => {
            throw new Error('ECONNREFUSED');
        }) as typeof fetch;
        const client = new AdbAndroidActivationClient(fakeAdb, fakeFetch);

        const result = await client.activateDeviceCapture({
            deviceId: 'device-1',
            proxyPort: 9001,
            enableSocks: false
        });

        assert.equal(result.success, false);
        assert.equal((result.details as any).activationMode, 'partial');
        assert.equal((result.details as any).reason, 'missing-official-activation-bridge');
    });

    it('official bridge structured failure returns bridge error details', async () => {
        const fakeAdb = new FakeAdbExecutor(['device-1'], () => '');
        const fakeFetch: typeof fetch = (async () =>
            new Response(JSON.stringify({
                success: false,
                errors: ['activation-failed']
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })) as typeof fetch;
        const client = new AdbAndroidActivationClient(fakeAdb, fakeFetch);

        const result = await client.activateDeviceCapture({
            deviceId: 'device-1',
            proxyPort: 9001,
            enableSocks: false
        });

        assert.equal(result.success, false);
        assert.equal(result.errors?.includes('official-bridge-failed'), true);
        assert.equal(Boolean((result.details as any).bridgeResponse), true);
        assert.equal(fakeAdb.shellCalls.length, 0);
    });

    it('admin base URL is configurable', async () => {
        const fakeAdb = new FakeAdbExecutor(['device-1'], () => '');
        const fetchCalls: string[] = [];
        const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
            fetchCalls.push(String(url));
            return new Response(JSON.stringify({ success: true, controlPlaneSuccess: true }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            });
        }) as typeof fetch;
        const client = new AdbAndroidActivationClient(fakeAdb, fakeFetch, 'http://127.0.0.1:55555');

        const result = await client.activateDeviceCapture({
            deviceId: 'device-1',
            proxyPort: 9001,
            enableSocks: false
        });

        assert.equal(result.success, true);
        assert.equal(fetchCalls[0], 'http://127.0.0.1:55555/automation/android-adb/start-headless');
    });

    it('does not call 45456 or fallback to addon 45457 when default official bridge is unavailable', async () => {
        const fakeAdb = new FakeAdbExecutor([], () => '');
        const fetchCalls: string[] = [];
        const fakeFetch: typeof fetch = (async (url: string | URL | Request) => {
            fetchCalls.push(String(url));
            return new Response('missing', { status: 404 });
        }) as typeof fetch;
        const client = new AdbAndroidActivationClient(fakeAdb, fakeFetch);

        await client.activateDeviceCapture({
            deviceId: 'missing-device',
            proxyPort: 9001,
            enableSocks: false
        });

        assert.equal(fetchCalls.length, 1);
        assert.equal(fetchCalls[0], 'http://127.0.0.1:45458/automation/android-adb/start-headless');
        assert.equal(fetchCalls.some((url) => url.includes('45456')), false);
        assert.equal(fetchCalls.some((url) => url.includes('45457')), false);
    });

    it('activation verifies device with fake ADB and builds expected commands', async () => {
        const fakeAdb = new FakeAdbExecutor(['device-1'], (command) => {
            if (command[0] === 'getprop') return 'Pixel 8';
            if (command[0] === 'logcat' && command[1] === '-d') return 'I/HTK-ANDROID-STATE: ACTIVATE_RECEIVED\nI/HTK-ANDROID-STATE: state=connected';
            if (command[0] === 'dumpsys' && command[1] === 'vpn') return 'Active VPN: tech.httptoolkit.android.v1 state=CONNECTED';
            if (command[0] === 'dumpsys' && command[1] === 'activity') return 'tech.httptoolkit.android.v1/.RemoteControlMainActivity';
            return '';
        });
        const fakeFetch: typeof fetch = (async () => new Response('missing', { status: 404 })) as typeof fetch;
        const client = new AdbAndroidActivationClient(fakeAdb, fakeFetch);

        const result = await client.activateDeviceCapture({
            deviceId: 'device-1',
            proxyPort: 9001,
            enableSocks: true
        });

        assert.equal(result.success, true);
        assert.equal((result.details as any).activationMode, 'adb-activation');

        const commands = fakeAdb.shellCalls.map((call) => call.command.join(' '));
        assert.equal(commands.some((command) => command.startsWith('am start -a tech.httptoolkit.android.ACTIVATE')), true);
        assert.equal(commands.some((command) => command === 'logcat -c'), true);
    });

    it('activation failure returns structured errors when device is missing', async () => {
        const fakeAdb = new FakeAdbExecutor([], () => '');
        const fakeFetch: typeof fetch = (async () => new Response('missing', { status: 404 })) as typeof fetch;
        const client = new AdbAndroidActivationClient(fakeAdb, fakeFetch);

        const result = await client.activateDeviceCapture({
            deviceId: 'missing-device',
            proxyPort: 9001,
            enableSocks: false
        });

        assert.equal(result.success, false);
        assert.equal((result.details as any).implemented, true);
        assert.equal((result.details as any).reason, 'target-device-not-online');
        assert.equal(result.errors?.includes('device-not-online'), true);
    });

    it('does not issue reboot/uninstall/disable-vpn commands', async () => {
        const fakeAdb = new FakeAdbExecutor(['device-1'], (command) => {
            if (command[0] === 'logcat' && command[1] === '-d') return 'I/HTK-ANDROID-STATE: activate_received';
            return '';
        });
        const fakeFetch: typeof fetch = (async () => new Response('missing', { status: 404 })) as typeof fetch;
        const client = new AdbAndroidActivationClient(fakeAdb, fakeFetch);

        await client.activateDeviceCapture({
            deviceId: 'device-1',
            proxyPort: 8000,
            enableSocks: false
        });

        const issued = fakeAdb.shellCalls.map((call) => call.command.join(' ')).join('\n');
        assert.equal(issued.includes('reboot'), false);
        assert.equal(issued.includes('uninstall'), false);
        assert.equal(issued.includes('pm disable'), false);
        assert.equal(issued.includes('force-stop'), false);
        assert.equal(issued.includes('reverse --remove-all'), false);
    });
});
