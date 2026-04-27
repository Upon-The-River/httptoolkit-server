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
    it('activation verifies device with fake ADB and builds expected commands', async () => {
        const fakeAdb = new FakeAdbExecutor(['device-1'], (command) => {
            if (command[0] === 'getprop') return 'Pixel 8';
            if (command[0] === 'logcat' && command[1] === '-d') return 'I/HTK-ANDROID-STATE: ACTIVATE_RECEIVED\nI/HTK-ANDROID-STATE: state=connected';
            if (command[0] === 'dumpsys' && command[1] === 'vpn') return 'Active VPN: tech.httptoolkit.android.v1 state=CONNECTED';
            if (command[0] === 'dumpsys' && command[1] === 'activity') return 'tech.httptoolkit.android.v1/.RemoteControlMainActivity';
            return '';
        });
        const client = new AdbAndroidActivationClient(fakeAdb);

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
        const client = new AdbAndroidActivationClient(fakeAdb);

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
        const client = new AdbAndroidActivationClient(fakeAdb);

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
