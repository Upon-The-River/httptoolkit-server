import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AndroidAdbStartHeadlessService } from '../src/automation/android-adb-start-headless-service';
import { AutomationHealthStore } from '../src/automation/automation-health-store';
import { AndroidActivationClient } from '../src/automation/android-activation-client';
import { AndroidNetworkSafetyApi } from '../src/android/android-network-safety';

const safeNetwork: AndroidNetworkSafetyApi = {
    inspectNetwork: async () => ({
        success: true,
        safe: true,
        warnings: [],
        diagnostics: {
            httpProxy: { configured: false },
            privateDns: { mode: 'off' },
            vpn: { active: false },
            alwaysOnVpn: { configured: false }
        }
    }),
    rescueNetwork: async () => ({
        success: true,
        safe: true,
        dryRun: true,
        actions: []
    }),
    getCapabilities: () => ({
        inspect: { implemented: true, mutatesDeviceState: false },
        rescue: {
            implemented: true,
            mutatesDeviceState: true,
            defaultDryRun: true,
            limitations: []
        }
    })
};

const activationClient: AndroidActivationClient = {
    activateDeviceCapture: async () => ({ success: true, details: { activationMode: 'adb-activation' } }),
    stopDeviceCapture: async () => ({ success: false, implemented: false, safeStub: true, details: {}, errors: [] }),
    recoverDeviceCapture: async () => ({ success: false, implemented: false, safeStub: true, details: {}, errors: [] })
};

describe('AndroidAdbStartHeadlessService', () => {
    it('constructs with options object and defaults session manager when omitted', async () => {
        const service = new AndroidAdbStartHeadlessService({
            androidNetworkSafety: safeNetwork,
            activationClient,
            healthStore: new AutomationHealthStore()
        });

        const result = await service.startHeadless({
            deviceId: undefined,
            allowUnsafeStart: false,
            enableSocks: false,
            waitForTraffic: false,
            waitForTargetTraffic: false
        });

        assert.equal(result.success, false);
        assert.equal((result.errors?.[0] as any)?.code, 'missing-device-id');
    });
});
