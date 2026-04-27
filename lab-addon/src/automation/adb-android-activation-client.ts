import { AdbExecutor, SystemAdbExecutor } from '../android/adb-executor';
import {
    AndroidActivationRequest,
    AndroidActivationResult,
    AndroidRecoverResult,
    AndroidStopResult
} from './android-activation-types';
import { AndroidActivationClient } from './android-activation-client';

const HTTP_TOOLKIT_ANDROID_PACKAGE = 'tech.httptoolkit.android.v1';
const ACTIVATE_ACTION = 'tech.httptoolkit.android.ACTIVATE';

type CommandRecord = {
    command: string[];
    ok: boolean;
    output?: string;
    error?: string;
};

const encodeUrlSafeBase64 = (value: string) => {
    return Buffer.from(value, 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
};

const parseConnectedState = (activityDump: string, logcatDump: string, vpnDump: string): {
    connected: boolean,
    observedStates: string[]
} => {
    const observedStates: string[] = [];
    const normalizedActivity = activityDump.toLowerCase();
    const normalizedLogcat = logcatDump.toLowerCase();
    const normalizedVpn = vpnDump.toLowerCase();

    if (normalizedActivity.includes(HTTP_TOOLKIT_ANDROID_PACKAGE)) {
        observedStates.push('activity-app-visible');
    }

    if (normalizedLogcat.includes('activate_received')) {
        observedStates.push('log-activate-received');
    }

    if (normalizedLogcat.includes('state=connected') || /\bconnected\b/.test(normalizedLogcat)) {
        observedStates.push('log-connected');
    }

    if (normalizedVpn.includes(HTTP_TOOLKIT_ANDROID_PACKAGE) && /\b(active vpn|connected|tun\d+)\b/.test(normalizedVpn)) {
        observedStates.push('vpn-owner-signal');
    }

    const connected = observedStates.includes('log-connected') || observedStates.includes('vpn-owner-signal');
    return { connected, observedStates };
};

export class AdbAndroidActivationClient implements AndroidActivationClient {
    constructor(
        private readonly adbExecutor: AdbExecutor = new SystemAdbExecutor()
    ) {}

    async activateDeviceCapture(options: AndroidActivationRequest): Promise<AndroidActivationResult> {
        const errors: string[] = [];
        const commandRecords: CommandRecord[] = [];

        const onlineDevices = await this.adbExecutor.listOnlineDevices().catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`adb-list-devices-failed:${message}`);
            return [];
        });

        if (!onlineDevices.includes(options.deviceId)) {
            return {
                success: false,
                details: {
                    implemented: true,
                    partial: false,
                    safeStub: false,
                    activationMode: 'adb-activation',
                    reason: 'target-device-not-online',
                    onlineDevices
                },
                errors: errors.concat('device-not-online')
            };
        }

        const run = async (command: string[], timeoutMs = 10000) => {
            try {
                const output = await this.adbExecutor.shell(command, { deviceId: options.deviceId, timeoutMs });
                commandRecords.push({ command, ok: true, output });
                return output;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                commandRecords.push({ command, ok: false, error: message });
                errors.push(`adb-shell-failed:${command.join(' ')}:${message}`);
                return '';
            }
        };

        const model = await run(['getprop', 'ro.product.model']);
        const release = await run(['getprop', 'ro.build.version.release']);
        await run(['logcat', '-c'], 5000);

        const activationPayload = {
            addresses: ['127.0.0.1'],
            port: options.proxyPort,
            localTunnelPort: options.proxyPort,
            enableSocks: options.enableSocks === true
        };
        const intentData = encodeUrlSafeBase64(JSON.stringify(activationPayload));
        const activationUrl = `https://android.httptoolkit.tech/connect/?data=${intentData}`;

        await run(['am', 'start', '-a', ACTIVATE_ACTION, '-d', activationUrl, '-p', HTTP_TOOLKIT_ANDROID_PACKAGE], 15000);

        const activityDump = await run(['dumpsys', 'activity', 'activities'], 10000);
        const logcatDump = await run(['logcat', '-d', '-t', '120', '-s', 'HTK-ANDROID-STATE:*', 'HttpToolkit:*'], 10000);
        const vpnDump = await run(['dumpsys', 'vpn'], 10000);

        const connectedState = parseConnectedState(activityDump, logcatDump, vpnDump);

        if (connectedState.connected) {
            return {
                success: true,
                dataPlaneObserved: false,
                targetTrafficObserved: false,
                details: {
                    implemented: true,
                    partial: false,
                    safeStub: false,
                    activationMode: 'adb-activation',
                    device: {
                        id: options.deviceId,
                        model: model.trim() || 'unknown',
                        androidVersion: release.trim() || 'unknown'
                    },
                    observedStates: connectedState.observedStates,
                    commands: commandRecords.map((record) => record.command)
                },
                errors
            };
        }

        return {
            success: false,
            details: {
                implemented: true,
                partial: true,
                safeStub: false,
                activationMode: 'partial',
                reason: 'missing-official-activation-bridge',
                message: 'ADB activation intent was sent, but full official bridge signals (reverse tunnel/certificate/session handshake) are unavailable in addon-only mode.',
                device: {
                    id: options.deviceId,
                    model: model.trim() || 'unknown',
                    androidVersion: release.trim() || 'unknown'
                },
                observedStates: connectedState.observedStates,
                commands: commandRecords.map((record) => record.command)
            },
            errors: errors.concat('activation-not-confirmed')
        };
    }

    async stopDeviceCapture(options: { deviceId?: string }): Promise<AndroidStopResult> {
        return {
            success: false,
            implemented: false,
            safeStub: true,
            details: {
                reason: 'Stop-headless is conservative safe-stub in addon by default.',
                deviceId: options.deviceId
            },
            errors: ['safe-stub-stop-not-implemented']
        };
    }

    async recoverDeviceCapture(options: { deviceId?: string }): Promise<AndroidRecoverResult> {
        return {
            success: false,
            implemented: false,
            safeStub: true,
            details: {
                reason: 'Recover-headless is conservative safe-stub in addon by default.',
                deviceId: options.deviceId
            },
            errors: ['safe-stub-recover-not-implemented']
        };
    }
}
