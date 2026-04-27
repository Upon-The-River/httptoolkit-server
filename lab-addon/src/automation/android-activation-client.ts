import {
    AndroidActivationRequest,
    AndroidActivationResult,
    AndroidRecoverResult,
    AndroidStopResult
} from './android-activation-types';

export interface AndroidActivationClient {
    activateDeviceCapture(options: AndroidActivationRequest): Promise<AndroidActivationResult>;
    stopDeviceCapture(options: { deviceId?: string }): Promise<AndroidStopResult>;
    recoverDeviceCapture(options: { deviceId?: string }): Promise<AndroidRecoverResult>;
}

export class SafeStubAndroidActivationClient implements AndroidActivationClient {
    async activateDeviceCapture(options: AndroidActivationRequest): Promise<AndroidActivationResult> {
        return {
            success: false,
            details: {
                implemented: false,
                safeStub: true,
                reason: 'Activation bridge is not configured in lab-addon runtime.',
                deviceId: options.deviceId,
                proxyPort: options.proxyPort,
                enableSocks: options.enableSocks
            },
            errors: ['activation-client-not-configured']
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
