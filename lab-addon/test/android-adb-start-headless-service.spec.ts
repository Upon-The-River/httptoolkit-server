import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AndroidNetworkSafetyApi } from '../src/android/android-network-safety';
import { AndroidAdbStartHeadlessService } from '../src/automation/android-adb-start-headless-service';
import { AndroidActivationClient } from '../src/automation/android-activation-client';
import { AutomationHealthStore } from '../src/automation/automation-health-store';

const safeNetwork: AndroidNetworkSafetyApi = {
    inspectNetwork: async () => ({
        ok: true,
        inspectedAt: '2026-01-01T00:00:00.000Z',
        deviceId: 'device-1',
        inspectMode: 'read-only',
        proxy: {
            globalHttpProxy: null,
            globalHttpProxyHost: null,
            globalHttpProxyPort: null,
            globalHttpProxyExclusionList: null
        },
        privateDns: {
            mode: null,
            specifier: null
        },
        vpn: {
            alwaysOnVpnApp: null,
            lockdownVpn: null,
            vpnSummary: '',
            connectivitySummary: '',
            activeNetworkMentionsVpn: false
        },
        warnings: []
    }),
    rescueNetwork: async () => ({
        ok: true,
        implemented: true,
        deviceId: 'device-1',
        dryRun: true,
        actions: [],
        warnings: [],
        before: await safeNetwork.inspectNetwork()
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

const makeService = (options: {
    activationClient: AndroidActivationClient,
    sessionManager?: any,
    outputSizes?: number[],
    urls?: string[]
}) => {
    const outputSizes = options.outputSizes ?? [0, 0];
    let statusCalls = 0;
    const fileSink = {
        getOutputStatus: () => ({ exists: true, sizeBytes: outputSizes[Math.min(statusCalls++, outputSizes.length - 1)], exportDir: '', targetConfigPath: '', jsonlPath: '' }),
        readRecordsForTests: () => (options.urls ?? []).map((url, index) => ({
            schemaVersion: 1,
            recordId: String(index),
            observedAt: new Date().toISOString(),
            method: 'GET',
            url,
            statusCode: 200,
            contentType: 'application/json',
            body: { inline: '', encoding: 'utf8' as const }
        }))
    };

    return new AndroidAdbStartHeadlessService({
        androidNetworkSafety: safeNetwork,
        activationClient: options.activationClient,
        healthStore: new AutomationHealthStore(),
        sessionManager: options.sessionManager,
        exportFileSink: fileSink
    });
};

describe('AndroidAdbStartHeadlessService', () => {
    it('official bridge success preserves proxyPort=8000 and skips local session start', async () => {
        let startCalls = 0;
        const service = makeService({
            activationClient: {
                activateDeviceCapture: async () => ({
                    success: true,
                    details: {
                        activationMode: 'official-bridge',
                        bridgeResponse: {
                            success: true,
                            controlPlaneSuccess: true,
                            proxyPort: 8000,
                            proxySessionSource: 'stale-existing-config-recovered-by-remote-start'
                        }
                    }
                }),
                stopDeviceCapture: async () => ({ success: false, implemented: false, safeStub: true, details: {}, errors: [] }),
                recoverDeviceCapture: async () => ({ success: false, implemented: false, safeStub: true, details: {}, errors: [] })
            },
            sessionManager: {
                startSessionIfNeeded: async () => {
                    startCalls += 1;
                    return { created: true, proxyPort: 8001, sessionUrl: 'http://127.0.0.1:8001' };
                },
                getLatestSession: () => ({ active: false }),
                stopLatestSession: async () => ({ stopped: true }),
                getObservedTrafficSignal: async () => ({ observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 }),
                getTargetTrafficSignal: async () => ({ observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 })
            }
        });

        const result = await service.startHeadless({ deviceId: 'device-1', proxyPort: 8000 });

        assert.equal(result.success, true);
        assert.equal(result.controlPlaneSuccess, true);
        assert.equal(result.proxyPort, 8000);
        assert.equal((result.activationResult as any).activationMode, 'official-bridge');
        assert.equal(startCalls, 0);
    });

    it('preserves last successful start when later attempt fails', async () => {
        let callCount = 0;
        const service = makeService({
            activationClient: {
                activateDeviceCapture: async () => {
                    callCount += 1;
                    if (callCount === 1) {
                        return {
                            success: true,
                            details: { bridgeResponse: { success: true, controlPlaneSuccess: true, proxyPort: 8000, proxySessionSource: 'existing-config' } }
                        };
                    }

                    return {
                        success: false,
                        details: { activationMode: 'partial' },
                        errors: ['official-bridge-failed']
                    };
                },
                stopDeviceCapture: async () => ({ success: false, implemented: false, safeStub: true, details: {}, errors: [] }),
                recoverDeviceCapture: async () => ({ success: false, implemented: false, safeStub: true, details: {}, errors: [] })
            },
            sessionManager: {
                startSessionIfNeeded: async () => ({ created: true, proxyPort: 8001, sessionUrl: 'http://127.0.0.1:8001' }),
                getLatestSession: () => ({ active: false }),
                stopLatestSession: async () => ({ stopped: true }),
                getObservedTrafficSignal: async () => ({ observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 }),
                getTargetTrafficSignal: async () => ({ observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 })
            }
        });

        await service.startHeadless({ deviceId: 'device-1', proxyPort: 8000 });
        await service.startHeadless({ deviceId: 'device-1', proxyPort: 8000, waitForTraffic: true });

        const health = service.getHealth() as any;
        assert.equal(health.lastStartHeadless.success, false);
        assert.equal(health.lastSuccessfulStartHeadless.success, true);
        assert.equal(health.lastSuccessfulStartHeadless.proxyPort, 8000);
        assert.equal(health.lastSuccessfulStartHeadless.bridgeResponse.proxySessionSource, 'existing-config');
    });

    it('dumpsys unavailable + bridge success + jsonl growth marks vpn likely active and traffic validated', async () => {
        const service = makeService({
            activationClient: {
                activateDeviceCapture: async () => ({
                    success: true,
                    details: {
                        observedStates: ['dumpsys-vpn-unavailable', 'activity-app-visible'],
                        bridgeResponse: { success: true, controlPlaneSuccess: true, proxyPort: 8000 }
                    },
                    errors: ["Can't find service: vpn"]
                }),
                stopDeviceCapture: async () => ({ success: false, implemented: false, safeStub: true, details: {}, errors: [] }),
                recoverDeviceCapture: async () => ({ success: false, implemented: false, safeStub: true, details: {}, errors: [] })
            },
            sessionManager: {
                startSessionIfNeeded: async () => ({ created: true, proxyPort: 8001, sessionUrl: 'http://127.0.0.1:8001' }),
                getLatestSession: () => ({ active: false }),
                stopLatestSession: async () => ({ stopped: true }),
                getObservedTrafficSignal: async () => ({ observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 }),
                getTargetTrafficSignal: async () => ({ observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 })
            },
            outputSizes: [280, 324794],
            urls: ['https://druidv6.if.qidian.com/argus/api/v3/bookdetail/get']
        });

        const result = await service.startHeadless({ deviceId: 'device-1', proxyPort: 8000 });

        assert.equal(result.vpnLikelyActive, true);
        assert.equal(result.trafficValidated, true);
        assert.equal(result.targetTrafficObserved, true);
        assert.equal((result.warnings as string[]).includes('dumpsys-vpn-unavailable'), true);
    });

    it('classifies noisy non-fatal log lines as warnings', async () => {
        const service = makeService({
            activationClient: {
                activateDeviceCapture: async () => ({
                    success: true,
                    details: {
                        bridgeResponse: { success: true, controlPlaneSuccess: true, proxyPort: 8000 }
                    },
                    errors: [
                        'connect ENOENT //./pipe/docker_engine',
                        'su root timeout but su -c succeeded',
                        'tls wrong version number',
                        'getaddrinfo ENOTFOUND status-ipv6.jpush.cn',
                        'socket hang up',
                        'Invalid IPv4 header. IP version should be 4 but was 6'
                    ]
                }),
                stopDeviceCapture: async () => ({ success: false, implemented: false, safeStub: true, details: {}, errors: [] }),
                recoverDeviceCapture: async () => ({ success: false, implemented: false, safeStub: true, details: {}, errors: [] })
            },
            sessionManager: {
                startSessionIfNeeded: async () => ({ created: true, proxyPort: 8001, sessionUrl: 'http://127.0.0.1:8001' }),
                getLatestSession: () => ({ active: false }),
                stopLatestSession: async () => ({ stopped: true }),
                getObservedTrafficSignal: async () => ({ observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 }),
                getTargetTrafficSignal: async () => ({ observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 })
            }
        });

        const result = await service.startHeadless({ deviceId: 'device-1', proxyPort: 8000, waitForTraffic: false, waitForTargetTraffic: false });
        const warnings = result.warnings as string[];

        assert.equal(warnings.includes('docker-unavailable'), true);
        assert.equal(warnings.includes('unsupported-su-root-syntax'), true);
        assert.equal(warnings.includes('non-tls-client-on-tls-path'), true);
        assert.equal(warnings.includes('upstream-dns-failure'), true);
        assert.equal(warnings.includes('upstream-socket-hangup'), true);
        assert.equal(warnings.includes('vpn-ipv6-packet-warning'), true);
    });

    it('constructs with options object and returns missing device errors', async () => {
        const service = new AndroidAdbStartHeadlessService({
            androidNetworkSafety: safeNetwork,
            activationClient: {
                activateDeviceCapture: async () => ({ success: true, details: { activationMode: 'adb-activation' } }),
                stopDeviceCapture: async () => ({ success: false, implemented: false, safeStub: true, details: {}, errors: [] }),
                recoverDeviceCapture: async () => ({ success: false, implemented: false, safeStub: true, details: {}, errors: [] })
            },
            healthStore: new AutomationHealthStore()
        });

        const result = await service.startHeadless({ deviceId: undefined });
        assert.equal(result.success, false);
        assert.equal((result.errors?.[0] as any)?.code, 'missing-device-id');
    });
});
