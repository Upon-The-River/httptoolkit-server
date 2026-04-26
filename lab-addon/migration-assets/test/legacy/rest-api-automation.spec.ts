import * as http from 'http';
import { expect } from 'chai';
import express from 'express';

import { exposeRestAPI } from '../../src/api/rest-api';

describe('REST API android-adb automation', () => {
    async function withTestServer(
        options: {
            latestActiveProxyPort?: number,
            metadataDeviceIds?: string[],
            activationResult?: unknown,
            activationResults?: unknown[],
            sessionState?: { active: boolean, proxyPort?: number, sessionUrl?: string },
            sessionStartResult?: { created: boolean, proxyPort: number, sessionUrl: string },
            observedTrafficSignal?: unknown,
            targetTrafficSignal?: unknown,
            targetTrafficSignals?: unknown[],
            cleanupResult?: any,
            checkPort?: (port: number) => Promise<boolean>,
            adbDevices?: Array<{ id: string, type: string }>,
            inspectVpnState?: (deviceId: string) => Promise<any>,
            inspectNetworkSafety?: (deviceId: string) => Promise<any>,
            rescueNetwork?: (deviceId: string) => Promise<any>,
            restoreNetworkBaseline?: (deviceId: string, baseline?: unknown, restoreOptions?: unknown) => Promise<any>,
            loadNetworkBaseline?: (deviceId: string) => Promise<any>,
            captureNetworkBaseline?: (deviceId: string) => Promise<any>,
            ensureAndroidBootstrapRulesError?: string
        },
        test: (baseUrl: string, calls: {
            activateCalls: Array<{ id: string, proxyPort: number, interceptorOptions: unknown }>,
            sessionStartCalls: number,
            sessionStopCalls: number,
            ensureAndroidBootstrapRulesCalls: string[],
            ensurePassThroughFallbackRuleCalls: number,
            observedTrafficSignalCalls: number,
            targetTrafficSignalCalls: number,
            cleanupCalls: number,
            inspectVpnCalls: string[],
            inspectNetworkSafetyCalls: string[]
        }) => Promise<void>
    ) {
        let latestActiveProxyPort = options.latestActiveProxyPort;
        let sessionState = options.sessionState ?? { active: false };
        const calls = {
            activateCalls: [] as Array<{ id: string, proxyPort: number, interceptorOptions: unknown }>,
            sessionStartCalls: 0,
            sessionStopCalls: 0,
            ensureAndroidBootstrapRulesCalls: [] as string[],
            ensurePassThroughFallbackRuleCalls: 0,
            observedTrafficSignalCalls: 0,
            targetTrafficSignalCalls: 0,
            cleanupCalls: 0,
            inspectVpnCalls: [] as string[],
            inspectNetworkSafetyCalls: [] as string[]
        };
        const queuedActivationResults = [ ...(options.activationResults ?? []) ];
        const queuedTargetTrafficSignals = [ ...(options.targetTrafficSignals ?? []) ];

        const sessionManager = {
            startSessionIfNeeded: async () => {
                calls.sessionStartCalls += 1;
                const startResult = options.sessionStartResult ?? {
                    created: true,
                    proxyPort: 8123,
                    sessionUrl: 'http://127.0.0.1:8123'
                };
                sessionState = { active: true, proxyPort: startResult.proxyPort, sessionUrl: startResult.sessionUrl };
                return startResult;
            },
            getLatestSession: () => sessionState,
            stopLatestSession: async () => {
                calls.sessionStopCalls += 1;
                const stopped = sessionState.active;
                sessionState = { active: false };
                return { stopped };
            },
            ensureAndroidBootstrapRules: async (certContent: string) => {
                if (options.ensureAndroidBootstrapRulesError) {
                    throw new Error(options.ensureAndroidBootstrapRulesError);
                }
                calls.ensureAndroidBootstrapRulesCalls.push(certContent);
            },
            ensurePassThroughFallbackRule: async () => {
                calls.ensurePassThroughFallbackRuleCalls += 1;
            },
            getObservedTrafficSignal: async () => {
                calls.observedTrafficSignalCalls += 1;
                return options.observedTrafficSignal ?? {
                    observed: false,
                    source: 'none',
                    totalSeenRequests: 0,
                    ignoredBootstrapRequests: 0,
                    matchingRequests: 0
                };
            },
            getTargetTrafficSignal: async () => {
                calls.targetTrafficSignalCalls += 1;
                if (queuedTargetTrafficSignals.length) {
                    return queuedTargetTrafficSignals.shift();
                }
                return options.targetTrafficSignal ?? {
                    observed: false,
                    source: 'none',
                    totalSeenRequests: 0,
                    ignoredBootstrapRequests: 0,
                    matchingRequests: 0
                };
            }
        } as any;

        const app = express();
        app.use(express.json());
        exposeRestAPI(app, {
            getVersion: () => 'test',
            updateServer: () => undefined,
            shutdownServer: () => undefined,
            getConfig: async () => ({ certificateContent: 'mock-cert-content' }),
            getNetworkInterfaces: () => ({}),
            getInterceptors: async () => ({}),
            getInterceptorMetadata: async () => ({ deviceIds: options.metadataDeviceIds ?? [] }),
            activateInterceptor: async (id: string, proxyPort: number, interceptorOptions: unknown) => {
                calls.activateCalls.push({ id, proxyPort, interceptorOptions });
                if (queuedActivationResults.length) {
                    return queuedActivationResults.shift();
                }
                return options.activationResult ?? { success: true };
            },
            sendRequest: async () => { throw new Error('unused'); }
        } as any, undefined, () => latestActiveProxyPort, sessionManager, {
            runCleanup: async () => {
                calls.cleanupCalls += 1;
                return options.cleanupResult ?? {
                    success: true,
                    overallSuccess: true,
                    vpnCleanupSucceeded: true,
                    reverseCleanupSucceeded: true,
                    aggressive: false,
                    adbAvailable: true,
                    adbPath: 'adb',
                    adbVersion: 'unknown',
                    deviceCount: 1,
                    devices: [{
                        deviceId: 'default-device',
                        adbState: 'device',
                        cleanupActions: ['deactivate-intent', 'force-stop'],
                        vpnActiveBefore: false,
                        vpnActiveAfter: false,
                        vpnCleanupSucceeded: true,
                        reverseCleanupSucceeded: true,
                        overallSuccess: true,
                        dumpsysVpn: '',
                        dumpsysConnectivity: '',
                        logcatSample: '',
                        errors: []
                    }],
                    skippedDevices: [],
                    errors: [],
                    timestamp: new Date().toISOString()
                };
            },
            checkPort: options.checkPort ?? (async () => true),
            listAdbDevices: async () => options.adbDevices ?? [],
            inspectVpnState: async (_adbClient, deviceId) => {
                calls.inspectVpnCalls.push(deviceId);
                return options.inspectVpnState
                    ? options.inspectVpnState(deviceId)
                    : {
                        deviceId,
                        vpnActive: false,
                        vpnPackage: null,
                        lastHtkState: null,
                        errors: []
                    };
            },
            inspectNetworkSafety: async (deviceId, _opts) => {
                calls.inspectNetworkSafetyCalls.push(deviceId);
                return options.inspectNetworkSafety
                    ? options.inspectNetworkSafety(deviceId)
                    : {
                        deviceId,
                        globalHttpProxy: null,
                        privateDnsMode: 'off',
                        privateDnsSpecifier: null,
                        alwaysOnVpnApp: null,
                        lockdownVpn: '0',
                        activeNetworkIsVpn: false,
                        activeNetworkHasNotVpnCapability: true,
                        httpToolkitPackageRunning: false,
                        canPingIp: true,
                        canResolveDomain: true,
                        canHttpConnect: true,
                        httpProbeStatus: 'success',
                        httpProbeError: null,
                        httpProbeUnavailable: false,
                        pollutionState: 'clean',
                        warnings: [],
                        errors: [],
                        diagnostics: {}
                    };
            },
            rescueNetwork: async (deviceId) => {
                if (options.rescueNetwork) return options.rescueNetwork(deviceId);
                return {
                    deviceId,
                    success: true,
                    networkRiskCleared: true,
                    pollutionState: 'clean',
                    actions: [],
                    remainingIssues: [],
                    diagnostics: {}
                };
            },
            loadNetworkBaseline: async (deviceId) => {
                if (options.loadNetworkBaseline) return options.loadNetworkBaseline(deviceId);
                return undefined;
            },
            restoreNetworkBaseline: async (deviceId, baseline, restoreOptions) => {
                if (options.restoreNetworkBaseline) return options.restoreNetworkBaseline(deviceId, baseline, restoreOptions);
                return {
                    deviceId,
                    success: true,
                    usedBaseline: !!baseline,
                    actions: [],
                    errors: []
                };
            },
            captureNetworkBaseline: async (deviceId) => {
                if (options.captureNetworkBaseline) return options.captureNetworkBaseline(deviceId);
                return {
                    deviceId,
                    capturedAt: new Date().toISOString(),
                    timestamp: new Date().toISOString(),
                    baselinePollutionState: 'clean',
                    baselineTrusted: true,
                    globalHttpProxy: null,
                    globalHttpProxyHost: null,
                    globalHttpProxyPort: null,
                    globalHttpProxyExclusionList: null,
                    privateDnsMode: 'off',
                    privateDnsSpecifier: null,
                    alwaysOnVpnApp: null,
                    lockdownVpn: '0',
                    connectivitySummary: ''
                };
            }
        });

        const server = await new Promise<http.Server>((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });

        const port = (server.address() as any).port;
        const baseUrl = `http://127.0.0.1:${port}`;

        try {
            await test(baseUrl, calls);
        } finally {
            latestActiveProxyPort = undefined;
            await new Promise((resolve) => server.close(resolve));
        }
    }

    it('returns an explicit error when there is no active session', async () => {
        await withTestServer(
            { metadataDeviceIds: ['emulator-5554'] },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/activate-latest`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });

                expect(response.status).to.equal(409);
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.error.message).to.contain('No active mock session');
            }
        );
    });

    it('auto-selects the only connected Android device', async () => {
        await withTestServer(
            {
                latestActiveProxyPort: 9000,
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true, metadata: { ok: true } }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/activate-latest`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });

                expect(response.status).to.equal(200);
                const body = await response.json();
                expect(body.success).to.equal(true);
                expect(body.proxyPort).to.equal(9000);
                expect(body.deviceId).to.equal('emulator-5554');
                expect(body.activationResult).to.deep.equal({ success: true, metadata: { ok: true } });
                expect(calls.activateCalls).to.deep.equal([{
                    id: 'android-adb',
                    proxyPort: 9000,
                    interceptorOptions: { deviceId: 'emulator-5554', enableSocks: false }
                }]);
            }
        );
    });

    it('requires deviceId when multiple devices are connected', async () => {
        await withTestServer(
            {
                latestActiveProxyPort: 9000,
                metadataDeviceIds: ['emulator-5554', 'device-2']
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/activate-latest`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });

                expect(response.status).to.equal(409);
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.error.availableDeviceIds).to.deep.equal(['emulator-5554', 'device-2']);
                expect(calls.activateCalls).to.deep.equal([]);
            }
        );
    });

    it('returns 400 for unknown deviceId', async () => {
        await withTestServer(
            {
                latestActiveProxyPort: 9000,
                metadataDeviceIds: ['emulator-5554', 'device-2']
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/activate-latest`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ deviceId: 'unknown-device' })
                });

                expect(response.status).to.equal(400);
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.proxyPort).to.equal(9000);
                expect(body.error.message).to.equal("Unknown deviceId 'unknown-device'");
                expect(body.error.availableDeviceIds).to.deep.equal(['emulator-5554', 'device-2']);
                expect(calls.activateCalls).to.deep.equal([]);
            }
        );
    });

    it('activates the selected device for the latest proxy session', async () => {
        await withTestServer(
            {
                latestActiveProxyPort: 9100,
                metadataDeviceIds: ['emulator-5554', 'device-2'],
                activationResult: { success: true, metadata: { activated: true } }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/activate-latest`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ deviceId: 'device-2', enableSocks: true })
                });

                expect(response.status).to.equal(200);
                const body = await response.json();
                expect(body.success).to.equal(true);
                expect(body.proxyPort).to.equal(9100);
                expect(body.deviceId).to.equal('device-2');
                expect(body.activationResult).to.deep.equal({ success: true, metadata: { activated: true } });
                expect(calls.activateCalls).to.deep.equal([{
                    id: 'android-adb',
                    proxyPort: 9100,
                    interceptorOptions: { deviceId: 'device-2', enableSocks: true }
                }]);
            }
        );
    });

    it('returns top-level success=false when activationResult.success=false', async () => {
        const activationResult = { success: false, metadata: { reason: 'adb_not_ready' } };
        await withTestServer(
            {
                latestActiveProxyPort: 9100,
                metadataDeviceIds: ['emulator-5554'],
                activationResult
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/activate-latest`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });

                expect(response.status).to.equal(200);
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.success).to.equal(activationResult.success);
                expect(body.proxyPort).to.equal(9100);
                expect(body.deviceId).to.equal('emulator-5554');
                expect(body.activationResult).to.deep.equal(activationResult);
                expect(calls.activateCalls).to.deep.equal([{
                    id: 'android-adb',
                    proxyPort: 9100,
                    interceptorOptions: { deviceId: 'emulator-5554', enableSocks: false }
                }]);
            }
        );
    });

    it('session/start creates a session when none exists', async () => {
        await withTestServer(
            {
                sessionState: { active: false },
                sessionStartResult: { created: true, proxyPort: 45400, sessionUrl: 'http://127.0.0.1:45400' }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/session/start`, { method: 'POST' });

                expect(response.status).to.equal(200);
                const body = await response.json();
                expect(body.success).to.equal(true);
                expect(body.created).to.equal(true);
                expect(body.proxyPort).to.equal(45400);
                expect(body.sessionUrl).to.equal('http://127.0.0.1:45400');
                expect(calls.sessionStartCalls).to.equal(1);
            }
        );
    });

    it('session/start does not create again when a session exists', async () => {
        await withTestServer(
            {
                sessionState: { active: true, proxyPort: 45500, sessionUrl: 'http://127.0.0.1:45500' },
                sessionStartResult: { created: false, proxyPort: 45500, sessionUrl: 'http://127.0.0.1:45500' }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/session/start`, { method: 'POST' });

                expect(response.status).to.equal(200);
                const body = await response.json();
                expect(body.success).to.equal(true);
                expect(body.created).to.equal(false);
                expect(body.proxyPort).to.equal(45500);
                expect(body.sessionUrl).to.equal('http://127.0.0.1:45500');
                expect(calls.sessionStartCalls).to.equal(1);
            }
        );
    });

    it('session/stop-latest clears session state', async () => {
        await withTestServer(
            { sessionState: { active: true, proxyPort: 45500, sessionUrl: 'http://127.0.0.1:45500' } },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/session/stop-latest`, { method: 'POST' });

                expect(response.status).to.equal(200);
                const body = await response.json();
                expect(body.success).to.equal(true);
                expect(body.sessionStopResult.stopped).to.equal(true);
                expect(body.session).to.deep.equal({ active: false });
                expect(calls.sessionStopCalls).to.equal(1);
            }
        );
    });

    it('android-adb/start-headless auto starts session and activates for single device', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true, metadata: { ok: true } },
                sessionStartResult: { created: true, proxyPort: 46600, sessionUrl: 'http://127.0.0.1:46600' }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });

                expect(response.status).to.equal(200);
                const body = await response.json();
                expect(body.success).to.equal(true);
                expect(body.trafficValidated).to.equal(false);
                expect(body.session).to.deep.equal({
                    created: true,
                    proxyPort: 46600,
                    sessionUrl: 'http://127.0.0.1:46600'
                });
                expect(body.proxyPort).to.equal(46600);
                expect(body.deviceId).to.equal('emulator-5554');
                expect(body.controlPlaneSuccess).to.equal(true);
                expect(body.dataPlaneObserved).to.equal(false);
                expect(body.targetTrafficObserved).to.equal(false);
                expect(body.finalSuccess).to.equal(true);
                expect(calls.activateCalls).to.deep.equal([{
                    id: 'android-adb',
                    proxyPort: 46600,
                    interceptorOptions: { deviceId: 'emulator-5554', enableSocks: false }
                }]);
                expect(calls.observedTrafficSignalCalls).to.equal(1);
                expect(calls.ensureAndroidBootstrapRulesCalls).to.deep.equal(['mock-cert-content']);
                expect(calls.ensurePassThroughFallbackRuleCalls).to.equal(1);
            }
        );
    });

    it('android-adb/start-headless propagates activation failure in top-level success', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: false, metadata: { reason: 'adb_not_ready' } },
                sessionStartResult: { created: false, proxyPort: 46601, sessionUrl: 'http://127.0.0.1:46601' }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });

                expect(response.status).to.equal(200);
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.session.created).to.equal(false);
                expect(body.proxyPort).to.equal(46601);
                expect(body.activationResult).to.deep.equal({
                    success: false,
                    metadata: { reason: 'adb_not_ready' }
                });
                expect(calls.observedTrafficSignalCalls).to.equal(1);
                expect(calls.ensureAndroidBootstrapRulesCalls).to.deep.equal(['mock-cert-content']);
                expect(calls.ensurePassThroughFallbackRuleCalls).to.equal(1);
            }
        );
    });

    it('android-adb/start-headless rejects polluted baseline by default', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                inspectNetworkSafety: async () => ({
                    deviceId: 'emulator-5554',
                    globalHttpProxy: '127.0.0.1:8080',
                    privateDnsMode: 'off',
                    privateDnsSpecifier: null,
                    alwaysOnVpnApp: null,
                    lockdownVpn: '0',
                    activeNetworkIsVpn: false,
                    activeNetworkHasNotVpnCapability: true,
                    httpToolkitPackageRunning: false,
                    canPingIp: true,
                    canResolveDomain: true,
                    canHttpConnect: true,
                    httpProbeStatus: 'success',
                    httpProbeError: null,
                    httpProbeUnavailable: false,
                    pollutionState: 'proxy-residual',
                    warnings: [],
                    errors: [],
                    diagnostics: {}
                })
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const body = await response.json();
                expect(response.status).to.equal(409);
                expect(body.success).to.equal(false);
                expect(body.error).to.equal('network-baseline-polluted');
                expect(body.baselineTrusted).to.equal(false);
                expect(calls.activateCalls).to.have.length(0);
            }
        );
    });

    it('android-adb/start-headless allows polluted baseline when allowUnsafeStart=true', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true, metadata: { ok: true } },
                inspectNetworkSafety: async () => ({
                    deviceId: 'emulator-5554',
                    globalHttpProxy: null,
                    privateDnsMode: 'hostname',
                    privateDnsSpecifier: 'bad.example',
                    alwaysOnVpnApp: null,
                    lockdownVpn: '0',
                    activeNetworkIsVpn: false,
                    activeNetworkHasNotVpnCapability: true,
                    httpToolkitPackageRunning: false,
                    canPingIp: true,
                    canResolveDomain: false,
                    canHttpConnect: false,
                    httpProbeStatus: 'failed',
                    httpProbeError: 'dns-fail',
                    httpProbeUnavailable: false,
                    pollutionState: 'private-dns-risk',
                    warnings: [],
                    errors: [],
                    diagnostics: {}
                })
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ allowUnsafeStart: true })
                });
                const body = await response.json();
                expect(response.status).to.equal(200);
                expect(body.success).to.equal(true);
                expect(body.trafficValidated).to.equal(false);
                expect(calls.activateCalls).to.have.length(1);
            }
        );
    });

    it('android-adb/start-headless does not treat bootstrap-only traffic as success', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: {
                    success: false,
                    metadata: { reason: 'timeout_waiting_for_vpn_connected:app-running-without-explicit-vpn-state' }
                },
                observedTrafficSignal: {
                    observed: false,
                    source: 'none',
                    totalSeenRequests: 2,
                    ignoredBootstrapRequests: 2,
                    matchingRequests: 0
                },
                sessionStartResult: { created: false, proxyPort: 46602, sessionUrl: 'http://127.0.0.1:46602' }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });

                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.activationResult.success).to.equal(false);
                expect(calls.observedTrafficSignalCalls).to.equal(3);
            }
        );
    });

    it('android-adb/start-headless returns degraded success for observed non-bootstrap traffic', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: {
                    success: false,
                    metadata: { reason: 'timeout_waiting_for_vpn_connected:no-explicit-vpn-signal' }
                },
                observedTrafficSignal: {
                    observed: true,
                    source: 'observed-session-traffic',
                    totalSeenRequests: 3,
                    ignoredBootstrapRequests: 2,
                    matchingRequests: 1,
                    sampleUrl: 'https://druidv6.if.qidian.com/api/v1/example'
                },
                sessionStartResult: { created: false, proxyPort: 46603, sessionUrl: 'http://127.0.0.1:46603' }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });

                const body = await response.json();
                expect(body.success).to.equal(true);
                expect(body.activationResult.success).to.equal(true);
                expect(body.activationResult.metadata.connectedStateSource).to.equal('observed-session-traffic');
                expect(body.activationResult.metadata.degraded).to.equal(true);
                expect(body.activationResult.metadata.reason).to.equal('data-plane-active-without-explicit-vpn-state');
                expect(body.activationResult.metadata.observedTraffic.sampleUrl)
                    .to.equal('https://druidv6.if.qidian.com/api/v1/example');
                expect(calls.observedTrafficSignalCalls).to.equal(1);
            }
        );
    });

    it('android-adb/start-headless reports degraded success when observed traffic includes payload evidence', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: {
                    success: false,
                    metadata: { reason: 'timeout_waiting_for_vpn_connected:vpn-service-unavailable' }
                },
                observedTrafficSignal: {
                    observed: true,
                    source: 'observed-session-traffic',
                    totalSeenRequests: 1,
                    ignoredBootstrapRequests: 0,
                    matchingRequests: 1,
                    sampleUrl: 'https://druidv6.if.qidian.com/l7/book/list',
                    payloadPath: 'payloads/171234_abc123.json',
                    statusCode: 200
                },
                sessionStartResult: { created: false, proxyPort: 46604, sessionUrl: 'http://127.0.0.1:46604' }
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });

                const body = await response.json();
                expect(body.success).to.equal(true);
                expect(body.activationResult.success).to.equal(true);
                expect(body.activationResult.metadata.observedTraffic.payloadPath)
                    .to.equal('payloads/171234_abc123.json');
                expect(body.activationResult.metadata.observedTraffic.statusCode).to.equal(200);
            }
        );
    });

    it('android-adb/start-headless remains failure with no vpn state and no real traffic', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: {
                    success: false,
                    metadata: { reason: 'timeout_waiting_for_vpn_connected:no-explicit-vpn-signal' }
                },
                observedTrafficSignal: {
                    observed: false,
                    source: 'none',
                    totalSeenRequests: 0,
                    ignoredBootstrapRequests: 0,
                    matchingRequests: 0
                },
                sessionStartResult: { created: false, proxyPort: 46605, sessionUrl: 'http://127.0.0.1:46605' }
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });

                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.activationResult.success).to.equal(false);
                expect(body.activationResult.metadata.reason)
                    .to.equal('timeout_waiting_for_vpn_connected:no-explicit-vpn-signal');
            }
        );
    });

    it('android-adb/start-headless does not report success for generic connected text without traffic', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: {
                    success: false,
                    metadata: {
                        reason: 'timeout_waiting_for_vpn_connected:app-running-without-explicit-vpn-state,vpn-service-unavailable,default-network-not-vpn,app-networkrequest-without-vpn,generic-connected-text-present'
                    }
                },
                observedTrafficSignal: {
                    observed: false,
                    source: 'none',
                    totalSeenRequests: 0,
                    ignoredBootstrapRequests: 0,
                    matchingRequests: 0
                },
                sessionStartResult: { created: false, proxyPort: 46606, sessionUrl: 'http://127.0.0.1:46606' }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });

                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.activationResult.success).to.equal(false);
                expect(body.activationResult.metadata.reason)
                    .to.include('timeout_waiting_for_vpn_connected');
                expect(calls.observedTrafficSignalCalls).to.equal(3);
            }
        );
    });

    it('android-adb/start-headless retries once after vpn timeout-like failures', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResults: [
                    {
                        success: false,
                        metadata: {
                            reason: 'timeout_waiting_for_vpn_connected:no-explicit-vpn-signal'
                        }
                    },
                    {
                        success: true,
                        metadata: { connectedStateSource: 'vpn-manager' }
                    }
                ],
                sessionStartResult: { created: true, proxyPort: 46607, sessionUrl: 'http://127.0.0.1:46607' }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });

                const body = await response.json();
                expect(body.success).to.equal(true);
                expect(body.activationResult.success).to.equal(true);
                expect(body.controlPlaneSuccess).to.equal(true);
                expect(body.finalSuccess).to.equal(true);
                expect(body.trafficValidated).to.equal(false);
                expect(calls.activateCalls).to.have.length(2);
                expect(calls.observedTrafficSignalCalls).to.equal(2);
            }
        );
    });

    it('session/stop-latest routes through stateless cleanup before stopping session', async () => {
        await withTestServer(
            { sessionState: { active: true, proxyPort: 45500, sessionUrl: 'http://127.0.0.1:45500' } },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/session/stop-latest`, { method: 'POST' });
                expect(response.status).to.equal(200);
                expect(calls.cleanupCalls).to.equal(1);
                expect(calls.sessionStopCalls).to.equal(1);
            }
        );
    });

    it('stop-headless response includes success and network risk fields', async () => {
        await withTestServer(
            {
                cleanupResult: {
                    success: false,
                    aggressive: false,
                    overallSuccess: false,
                    vpnCleanupSucceeded: true,
                    reverseCleanupSucceeded: false,
                    adbAvailable: true,
                    adbPath: 'adb',
                    adbVersion: 'unknown',
                    deviceCount: 1,
                    devices: [{
                        deviceId: 'device-1',
                        adbState: 'device',
                        cleanupActions: ['deactivate-intent', 'force-stop'],
                        vpnActiveBefore: true,
                        vpnActiveAfter: false,
                        vpnCleanupSucceeded: true,
                        reverseCleanupSucceeded: false,
                        overallSuccess: false,
                        dumpsysVpn: '',
                        dumpsysConnectivity: '',
                        logcatSample: '',
                        errors: ['remove-reverse-tunnels failed']
                    }],
                    skippedDevices: [],
                    errors: ['reverse cleanup failed'],
                    timestamp: new Date().toISOString()
                }
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/stop-headless`, { method: 'POST' });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.stopSuccess).to.equal(false);
                expect(body.networkRiskCleared).to.equal(true);
                expect(body.vpnCleanupSucceeded).to.equal(true);
                expect(body.reverseCleanupSucceeded).to.equal(false);
                expect(body.warnings.join('\n')).to.contain('network risk cleared');
            }
        );
    });

    it('stop-headless reports networkRiskCleared=false when VPN remains active', async () => {
        await withTestServer(
            {
                cleanupResult: {
                    success: false,
                    aggressive: true,
                    overallSuccess: false,
                    vpnCleanupSucceeded: true,
                    reverseCleanupSucceeded: true,
                    adbAvailable: true,
                    adbPath: 'adb',
                    adbVersion: 'unknown',
                    deviceCount: 1,
                    devices: [{
                        deviceId: 'device-1',
                        adbState: 'device',
                        cleanupActions: ['deactivate-intent', 'force-stop'],
                        vpnActiveBefore: true,
                        vpnActiveAfter: true,
                        vpnCleanupSucceeded: true,
                        reverseCleanupSucceeded: true,
                        overallSuccess: false,
                        dumpsysVpn: '',
                        dumpsysConnectivity: '',
                        logcatSample: '',
                        errors: []
                    }],
                    skippedDevices: [],
                    errors: ['VPN appears active after cleanup on devices: device-1'],
                    timestamp: new Date().toISOString()
                }
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/stop-headless`, { method: 'POST' });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.networkRiskCleared).to.equal(false);
            }
        );
    });

    it('stop-headless keeps success=false when cleanup succeeds but network safety is polluted', async () => {
        await withTestServer(
            {
                cleanupResult: {
                    success: true,
                    aggressive: false,
                    overallSuccess: true,
                    vpnCleanupSucceeded: true,
                    reverseCleanupSucceeded: true,
                    adbAvailable: true,
                    adbPath: 'adb',
                    adbVersion: 'unknown',
                    deviceCount: 1,
                    devices: [{
                        deviceId: 'device-1',
                        adbState: 'device',
                        cleanupActions: ['deactivate-intent', 'force-stop'],
                        vpnActiveBefore: true,
                        vpnActiveAfter: false,
                        vpnCleanupSucceeded: true,
                        reverseCleanupSucceeded: true,
                        overallSuccess: true,
                        dumpsysVpn: '',
                        dumpsysConnectivity: '',
                        logcatSample: '',
                        errors: []
                    }],
                    skippedDevices: [],
                    errors: [],
                    timestamp: new Date().toISOString()
                },
                inspectNetworkSafety: async () => ({
                    deviceId: 'device-1',
                    globalHttpProxy: '127.0.0.1:8000',
                    privateDnsMode: 'off',
                    privateDnsSpecifier: null,
                    alwaysOnVpnApp: null,
                    lockdownVpn: '0',
                    activeNetworkIsVpn: false,
                    activeNetworkHasNotVpnCapability: true,
                    httpToolkitPackageRunning: false,
                    canPingIp: true,
                    canResolveDomain: true,
                    canHttpConnect: true,
                    httpProbeStatus: 'success',
                    httpProbeError: null,
                    httpProbeUnavailable: false,
                    pollutionState: 'proxy-residual',
                    warnings: [],
                    errors: [],
                    diagnostics: {}
                })
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/stop-headless`, { method: 'POST' });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.networkRiskCleared).to.equal(false);
            }
        );
    });

    it('stop-headless fails when there are no online cleanup targets', async () => {
        await withTestServer(
            {
                adbDevices: [
                    { id: 'offline-1', type: 'offline' },
                    { id: 'unauth-1', type: 'unauthorized' }
                ],
                cleanupResult: {
                    success: true,
                    aggressive: false,
                    overallSuccess: true,
                    vpnCleanupSucceeded: true,
                    reverseCleanupSucceeded: true,
                    adbAvailable: true,
                    adbPath: 'adb',
                    adbVersion: 'unknown',
                    deviceCount: 2,
                    devices: [
                        {
                            deviceId: 'offline-1',
                            adbState: 'offline',
                            cleanupActions: [],
                            vpnActiveBefore: false,
                            vpnActiveAfter: false,
                            vpnCleanupSucceeded: true,
                            reverseCleanupSucceeded: true,
                            overallSuccess: true,
                            dumpsysVpn: '',
                            dumpsysConnectivity: '',
                            logcatSample: '',
                            errors: []
                        },
                        {
                            deviceId: 'unauth-1',
                            adbState: 'unauthorized',
                            cleanupActions: [],
                            vpnActiveBefore: false,
                            vpnActiveAfter: false,
                            vpnCleanupSucceeded: true,
                            reverseCleanupSucceeded: true,
                            overallSuccess: true,
                            dumpsysVpn: '',
                            dumpsysConnectivity: '',
                            logcatSample: '',
                            errors: []
                        }
                    ],
                    skippedDevices: [
                        { deviceId: 'offline-1', reason: 'offline' },
                        { deviceId: 'unauth-1', reason: 'unauthorized' }
                    ],
                    errors: [],
                    timestamp: new Date().toISOString()
                }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/stop-headless`, { method: 'POST' });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.networkRiskCleared).to.equal(false);
                expect(body.error).to.equal('no-online-cleanup-target');
                expect(body.cleanedDeviceCount).to.equal(0);
                expect(body.onlineCleanupTargetCount).to.equal(0);
                expect(body.checkedNetworkSafetyDeviceCount).to.equal(0);
                expect(body.warnings).to.include('no-device-cleaned');
                expect(calls.inspectNetworkSafetyCalls).to.deep.equal([]);

                const healthResponse = await fetch(`${baseUrl}/automation/health`);
                const health = await healthResponse.json();
                expect(health.state).to.equal('ERROR');
                expect(health.lastCleanupHadNoOnlineTarget).to.equal(true);
                expect(health.lastNetworkRiskCleared).to.equal(false);
                expect(health.lastCleanupUnverified).to.equal(true);
                expect(health.lastError).to.equal('no-online-cleanup-target');
                expect(health.skippedDevices).to.deep.equal([
                    { deviceId: 'offline-1', adbState: 'offline', reason: 'offline' },
                    { deviceId: 'unauth-1', adbState: 'unauthorized', reason: 'unauthorized' }
                ]);
            }
        );
    });

    it('session/stop-latest does not bypass networkRiskCleared=false', async () => {
        await withTestServer(
            {
                cleanupResult: {
                    success: true,
                    aggressive: false,
                    overallSuccess: true,
                    vpnCleanupSucceeded: true,
                    reverseCleanupSucceeded: true,
                    adbAvailable: true,
                    adbPath: 'adb',
                    adbVersion: 'unknown',
                    deviceCount: 1,
                    devices: [{
                        deviceId: 'device-1',
                        adbState: 'device',
                        cleanupActions: ['deactivate-intent', 'force-stop'],
                        vpnActiveBefore: true,
                        vpnActiveAfter: false,
                        vpnCleanupSucceeded: true,
                        reverseCleanupSucceeded: true,
                        overallSuccess: true,
                        dumpsysVpn: '',
                        dumpsysConnectivity: '',
                        logcatSample: '',
                        errors: []
                    }],
                    skippedDevices: [],
                    errors: [],
                    timestamp: new Date().toISOString()
                },
                inspectNetworkSafety: async () => ({
                    deviceId: 'device-1',
                    globalHttpProxy: null,
                    privateDnsMode: 'hostname',
                    privateDnsSpecifier: 'bad.dns',
                    alwaysOnVpnApp: null,
                    lockdownVpn: '0',
                    activeNetworkIsVpn: false,
                    activeNetworkHasNotVpnCapability: true,
                    httpToolkitPackageRunning: false,
                    canPingIp: true,
                    canResolveDomain: false,
                    canHttpConnect: false,
                    httpProbeStatus: 'failed',
                    httpProbeError: 'timeout',
                    httpProbeUnavailable: false,
                    pollutionState: 'dns-broken',
                    warnings: [],
                    errors: [],
                    diagnostics: {}
                })
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/session/stop-latest`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.networkRiskCleared).to.equal(false);
            }
        );
    });

    it('session/stop-latest inherits no-online-cleanup-target semantics', async () => {
        await withTestServer(
            {
                cleanupResult: {
                    success: true,
                    aggressive: false,
                    overallSuccess: true,
                    vpnCleanupSucceeded: true,
                    reverseCleanupSucceeded: true,
                    adbAvailable: true,
                    adbPath: 'adb',
                    adbVersion: 'unknown',
                    deviceCount: 0,
                    devices: [],
                    skippedDevices: [
                        { deviceId: 'offline-1', reason: 'offline' }
                    ],
                    errors: [],
                    timestamp: new Date().toISOString()
                }
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/session/stop-latest`, { method: 'POST' });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.networkRiskCleared).to.equal(false);
                expect(body.error).to.equal('no-online-cleanup-target');
            }
        );
    });

    it('stop-headless fails as unverified when cleanup returns devices=[]', async () => {
        await withTestServer(
            {
                cleanupResult: {
                    success: true,
                    aggressive: false,
                    overallSuccess: true,
                    vpnCleanupSucceeded: true,
                    reverseCleanupSucceeded: true,
                    adbAvailable: true,
                    adbPath: 'adb',
                    adbVersion: 'unknown',
                    deviceCount: 1,
                    devices: [],
                    skippedDevices: [],
                    errors: [],
                    timestamp: new Date().toISOString()
                }
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/stop-headless`, { method: 'POST' });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.networkRiskCleared).to.equal(false);
                expect(body.error).to.equal('no-online-cleanup-target');
                expect(body.onlineCleanupTargetCount).to.equal(0);
                expect(body.checkedNetworkSafetyDeviceCount).to.equal(0);
            }
        );
    });

    it('stop-headless fails when adb is unavailable even if cleanup reports success', async () => {
        await withTestServer(
            {
                cleanupResult: {
                    success: true,
                    aggressive: false,
                    overallSuccess: true,
                    vpnCleanupSucceeded: true,
                    reverseCleanupSucceeded: true,
                    adbAvailable: false,
                    adbPath: 'adb',
                    adbVersion: 'unknown',
                    deviceCount: 1,
                    devices: [{
                        deviceId: 'device-1',
                        adbState: 'device',
                        cleanupActions: ['deactivate-intent'],
                        vpnActiveBefore: false,
                        vpnActiveAfter: false,
                        vpnCleanupSucceeded: true,
                        reverseCleanupSucceeded: true,
                        overallSuccess: true,
                        dumpsysVpn: '',
                        dumpsysConnectivity: '',
                        logcatSample: '',
                        errors: []
                    }],
                    skippedDevices: [],
                    errors: [],
                    timestamp: new Date().toISOString()
                }
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/stop-headless`, { method: 'POST' });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.networkRiskCleared).to.equal(false);
                expect(body.error).to.equal('no-online-cleanup-target');
                expect(body.warnings).to.include('adb-unavailable-network-state-unverified');
            }
        );
    });

    it('stop-headless returns no-online-target-device when requested device is not online', async () => {
        await withTestServer(
            {
                cleanupResult: {
                    success: true,
                    aggressive: false,
                    overallSuccess: true,
                    vpnCleanupSucceeded: true,
                    reverseCleanupSucceeded: true,
                    adbAvailable: true,
                    adbPath: 'adb',
                    adbVersion: 'unknown',
                    deviceCount: 2,
                    devices: [
                        {
                            deviceId: 'device-1',
                            adbState: 'device',
                            cleanupActions: ['deactivate-intent', 'force-stop'],
                            vpnActiveBefore: true,
                            vpnActiveAfter: false,
                            vpnCleanupSucceeded: true,
                            reverseCleanupSucceeded: true,
                            overallSuccess: true,
                            dumpsysVpn: '',
                            dumpsysConnectivity: '',
                            logcatSample: '',
                            errors: []
                        },
                        {
                            deviceId: 'offline-1',
                            adbState: 'offline',
                            cleanupActions: [],
                            vpnActiveBefore: false,
                            vpnActiveAfter: false,
                            vpnCleanupSucceeded: true,
                            reverseCleanupSucceeded: true,
                            overallSuccess: true,
                            dumpsysVpn: '',
                            dumpsysConnectivity: '',
                            logcatSample: '',
                            errors: []
                        }
                    ],
                    skippedDevices: [{ deviceId: 'offline-1', reason: 'offline' }],
                    errors: [],
                    timestamp: new Date().toISOString()
                }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/stop-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ deviceId: 'missing-device' })
                });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.networkRiskCleared).to.equal(false);
                expect(body.error).to.equal('no-online-target-device');
                expect(body.cleanedDeviceCount).to.equal(0);
                expect(calls.inspectNetworkSafetyCalls).to.deep.equal([]);
            }
        );
    });

    it('stop-headless passes restoreUnsafeBaseline=false by default for untrusted baseline', async () => {
        let capturedRestoreOptions: any = undefined;
        await withTestServer(
            {
                cleanupResult: {
                    success: true,
                    aggressive: false,
                    overallSuccess: true,
                    vpnCleanupSucceeded: true,
                    reverseCleanupSucceeded: true,
                    adbAvailable: true,
                    adbPath: 'adb',
                    adbVersion: 'unknown',
                    deviceCount: 1,
                    devices: [{
                        deviceId: 'device-1',
                        adbState: 'device',
                        cleanupActions: ['deactivate-intent', 'force-stop'],
                        vpnActiveBefore: true,
                        vpnActiveAfter: false,
                        vpnCleanupSucceeded: true,
                        reverseCleanupSucceeded: true,
                        overallSuccess: true,
                        dumpsysVpn: '',
                        dumpsysConnectivity: '',
                        logcatSample: '',
                        errors: []
                    }],
                    skippedDevices: [],
                    errors: [],
                    timestamp: new Date().toISOString()
                },
                loadNetworkBaseline: async () => ({
                    deviceId: 'device-1',
                    capturedAt: new Date().toISOString(),
                    baselineTrusted: false
                }),
                restoreNetworkBaseline: async (_deviceId, _baseline, restoreOptions) => {
                    capturedRestoreOptions = restoreOptions;
                    return { deviceId: 'device-1', success: true, usedBaseline: false, actions: ['skip-untrusted-baseline'], errors: [] };
                }
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/stop-headless`, { method: 'POST' });
                const body = await response.json();
                expect(body.success).to.equal(true);
                expect(capturedRestoreOptions.restoreUnsafeBaseline).to.equal(false);
            }
        );
    });

    it('health keeps cleanup residual marker when VPN remains active after cleanup', async () => {
        await withTestServer(
            {
                sessionState: { active: true, proxyPort: 45500, sessionUrl: 'http://127.0.0.1:45500' },
                cleanupResult: {
                    success: false,
                    aggressive: true,
                    overallSuccess: false,
                    vpnCleanupSucceeded: true,
                    reverseCleanupSucceeded: false,
                    adbAvailable: true,
                    adbPath: 'adb',
                    adbVersion: 'unknown',
                    deviceCount: 1,
                    devices: [{
                        deviceId: 'device-1',
                        adbState: 'device',
                        cleanupActions: ['deactivate-intent', 'force-stop'],
                        vpnActiveBefore: true,
                        vpnActiveAfter: true,
                        vpnCleanupSucceeded: true,
                        reverseCleanupSucceeded: false,
                        overallSuccess: false,
                        dumpsysVpn: '',
                        dumpsysConnectivity: '',
                        logcatSample: '',
                        errors: ['remove-reverse-tunnels failed']
                    }],
                    skippedDevices: [],
                    errors: ['VPN appears active after cleanup on devices: device-1'],
                    timestamp: new Date().toISOString()
                }
            },
            async (baseUrl) => {
                await fetch(`${baseUrl}/automation/session/stop-latest`, { method: 'POST' });
                const healthResponse = await fetch(`${baseUrl}/automation/health`);
                const health = await healthResponse.json();
                expect(health.lastCleanupHadVpnResidual).to.equal(true);
                expect(['ERROR', 'DEGRADED']).to.include(health.state);
            }
        );
    });

    it('recover-headless reuses the saved device profile', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true },
                targetTrafficSignal: { observed: true, matchingRequests: 1, source: 'target-session-traffic', totalSeenRequests: 1, ignoredBootstrapRequests: 0 }
            },
            async (baseUrl, calls) => {
                await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ deviceId: 'emulator-5554' })
                });
                const response = await fetch(`${baseUrl}/automation/android-adb/recover-headless`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
                const body = await response.json();
                expect(response.status).to.equal(200);
                expect(body.success).to.equal(true);
                expect(calls.activateCalls[calls.activateCalls.length - 1].interceptorOptions).to.deep.equal({
                    deviceId: 'emulator-5554',
                    enableSocks: false
                });
            }
        );
    });

    it('recover-headless fails clearly when there is no saved profile and no request deviceId', async () => {
        await withTestServer(
            { metadataDeviceIds: ['device-a', 'device-b'] },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/recover-headless`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.error).to.contain('requires deviceId');
                expect(body.consecutiveRecoveryFailures).to.equal(1);
                expect(body.nextRecoveryAllowedAt).to.be.a('string');

                const healthResponse = await fetch(`${baseUrl}/automation/health`);
                const health = await healthResponse.json();
                expect(['DEGRADED', 'ERROR']).to.include(health.state);
                expect(health.lastError).to.contain('requires deviceId');
                expect(health.consecutiveRecoveryFailures).to.equal(1);
            }
        );
    });

    it('recover-headless does not report success without target traffic', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true },
                targetTrafficSignal: { observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 }
            },
            async (baseUrl) => {
                await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ deviceId: 'emulator-5554' })
                });
                const response = await fetch(`${baseUrl}/automation/android-adb/recover-headless`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.consecutiveRecoveryFailures).to.equal(1);
                expect(body.nextRecoveryAllowedAt).to.be.a('string');
                const healthResponse = await fetch(`${baseUrl}/automation/health`);
                const health = await healthResponse.json();
                expect(health.state).to.not.equal('RUNNING');
                expect(health.consecutiveRecoveryFailures).to.equal(1);
                expect(health.nextRecoveryAllowedAt).to.be.a('string');
            }
        );
    });

    it('recover-headless success resets failures after a prior failure', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true },
                targetTrafficSignals: [
                    { observed: true, source: 'target-session-traffic', totalSeenRequests: 1, ignoredBootstrapRequests: 0, matchingRequests: 1 },
                    { observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 },
                    { observed: true, source: 'target-session-traffic', totalSeenRequests: 2, ignoredBootstrapRequests: 0, matchingRequests: 2 }
                ]
            },
            async (baseUrl) => {
                await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ deviceId: 'emulator-5554' })
                });

                const failedRecover = await fetch(`${baseUrl}/automation/android-adb/recover-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const failedRecoverBody = await failedRecover.json();
                expect(failedRecoverBody.success).to.equal(false);
                expect(failedRecoverBody.consecutiveRecoveryFailures).to.equal(1);

                const successfulRecover = await fetch(`${baseUrl}/automation/android-adb/recover-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const successfulRecoverBody = await successfulRecover.json();
                expect(successfulRecoverBody.success).to.equal(true);
                expect(successfulRecoverBody.targetTrafficObserved).to.equal(true);
                expect(successfulRecoverBody.consecutiveRecoveryFailures).to.equal(0);
                expect(successfulRecoverBody.nextRecoveryAllowedAt).to.equal(undefined);

                const healthResponse = await fetch(`${baseUrl}/automation/health`);
                const health = await healthResponse.json();
                expect(health.consecutiveRecoveryFailures).to.equal(0);
                expect(health.nextRecoveryAllowedAt).to.equal(undefined);
                expect(['RUNNING', 'IDLE']).to.include(health.state);
            }
        );
    });

    it('recover-headless records failure when stop-headless leaves network risk uncleared', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                cleanupResult: {
                    success: false,
                    aggressive: true,
                    overallSuccess: false,
                    vpnCleanupSucceeded: false,
                    reverseCleanupSucceeded: false,
                    adbAvailable: true,
                    adbPath: 'adb',
                    adbVersion: 'unknown',
                    deviceCount: 1,
                    devices: [{
                        deviceId: 'emulator-5554',
                        adbState: 'device',
                        cleanupActions: ['deactivate-intent', 'force-stop'],
                        vpnActiveBefore: true,
                        vpnActiveAfter: true,
                        vpnCleanupSucceeded: false,
                        reverseCleanupSucceeded: false,
                        overallSuccess: false,
                        dumpsysVpn: '',
                        dumpsysConnectivity: '',
                        logcatSample: '',
                        errors: ['force-stop failed']
                    }],
                    skippedDevices: [],
                    errors: ['VPN appears active after cleanup on devices: emulator-5554'],
                    timestamp: new Date().toISOString()
                }
            },
            async (baseUrl) => {
                await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ deviceId: 'emulator-5554' })
                });
                const response = await fetch(`${baseUrl}/automation/android-adb/recover-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.networkRiskCleared).to.equal(false);
                expect(body.consecutiveRecoveryFailures).to.equal(1);
                expect(body.nextRecoveryAllowedAt).to.be.a('string');

                const healthResponse = await fetch(`${baseUrl}/automation/health`);
                const health = await healthResponse.json();
                expect(health.consecutiveRecoveryFailures).to.equal(1);
                expect(health.nextRecoveryAllowedAt).to.be.a('string');
                expect(health.lastError).to.contain('network risk');
            }
        );
    });

    it('start-headless returns success with trafficValidated=false when control plane is ready but no observed traffic yet', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true, metadata: { connectedStateSource: 'vpn-manager' } },
                targetTrafficSignal: { observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 }
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const body = await response.json();
                expect(body.controlPlaneSuccess).to.equal(true);
                expect(body.dataPlaneObserved).to.equal(false);
                expect(body.targetTrafficObserved).to.equal(false);
                expect(body.finalSuccess).to.equal(true);
                expect(body.trafficValidated).to.equal(false);
                expect(body.success).to.equal(true);
            }
        );
    });

    it('start-headless returns success when activation succeeds and non-bootstrap observed traffic is detected', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true, metadata: { connectedStateSource: 'vpn-manager' } },
                observedTrafficSignal: {
                    observed: true,
                    bootstrapOnly: false,
                    source: 'observed-session-traffic',
                    totalSeenRequests: 4,
                    ignoredBootstrapRequests: 2,
                    matchingRequests: 2
                },
                targetTrafficSignal: { observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const body = await response.json();
                expect(body.controlPlaneSuccess).to.equal(true);
                expect(body.dataPlaneObserved).to.equal(true);
                expect(body.targetTrafficObserved).to.equal(false);
                expect(body.finalSuccess).to.equal(true);
                expect(body.success).to.equal(true);
                expect(calls.observedTrafficSignalCalls).to.equal(1);
            }
        );
    });

    it('start-headless keeps failure when activation succeeds but traffic is bootstrap-only', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true, metadata: { connectedStateSource: 'vpn-manager' } },
                observedTrafficSignal: {
                    observed: true,
                    bootstrapOnly: true,
                    source: 'bootstrap-only',
                    totalSeenRequests: 2,
                    ignoredBootstrapRequests: 2,
                    matchingRequests: 0
                },
                targetTrafficSignal: { observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 }
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const body = await response.json();
                expect(body.controlPlaneSuccess).to.equal(true);
                expect(body.dataPlaneObserved).to.equal(false);
                expect(body.targetTrafficObserved).to.equal(false);
                expect(body.finalSuccess).to.equal(true);
                expect(body.trafficValidated).to.equal(false);
                expect(body.success).to.equal(true);
            }
        );
    });

    it('start-headless calls getObservedTrafficSignal when activation metadata has no observedTraffic', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true, metadata: { connectedStateSource: 'vpn-manager' } }
            },
            async (baseUrl, calls) => {
                await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                expect(calls.observedTrafficSignalCalls).to.equal(1);
            }
        );
    });

    it('start-headless does not require a second observed traffic poll when activation metadata already has observedTraffic', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: {
                    success: true,
                    metadata: {
                        connectedStateSource: 'vpn-manager',
                        observedTraffic: {
                            observed: true,
                            bootstrapOnly: false,
                            source: 'activation-metadata',
                            totalSeenRequests: 1,
                            ignoredBootstrapRequests: 0,
                            matchingRequests: 1
                        }
                    }
                }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const body = await response.json();
                expect(body.success).to.equal(true);
                expect(body.dataPlaneObserved).to.equal(true);
                expect(calls.observedTrafficSignalCalls).to.equal(0);
            }
        );
    });

    it('start-headless returns success when target traffic is observed even without data-plane observed signal', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true, metadata: { connectedStateSource: 'vpn-manager' } },
                observedTrafficSignal: { observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 },
                targetTrafficSignal: { observed: true, source: 'target-session-traffic', totalSeenRequests: 1, ignoredBootstrapRequests: 0, matchingRequests: 1, sampleUrl: 'https://druidv6.if.qidian.com/api/v1/example' }
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const body = await response.json();
                expect(body.dataPlaneObserved).to.equal(false);
                expect(body.targetTrafficObserved).to.equal(true);
                expect(body.finalSuccess).to.equal(true);
                expect(body.success).to.equal(true);
            }
        );
    });



    it('start-headless allows current clean inspect even if previously saved baseline is untrusted', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                loadNetworkBaseline: async () => ({ deviceId: 'emulator-5554', capturedAt: new Date().toISOString(), baselineTrusted: false, baselinePollutionState: 'route-broken' }),
                inspectNetworkSafety: async () => ({
                    deviceId: 'emulator-5554',
                    globalHttpProxy: null,
                    privateDnsMode: 'off',
                    privateDnsSpecifier: null,
                    alwaysOnVpnApp: null,
                    lockdownVpn: '0',
                    activeNetworkIsVpn: false,
                    activeNetworkHasNotVpnCapability: true,
                    httpToolkitPackageRunning: false,
                    canPingIp: true,
                    canResolveDomain: true,
                    canHttpConnect: true,
                    httpProbeStatus: 'success',
                    httpProbeError: null,
                    httpProbeUnavailable: false,
                    pollutionState: 'clean',
                    warnings: [],
                    errors: [],
                    diagnostics: {}
                }),
                activationResult: { success: true, metadata: { connectedStateSource: 'vpn-manager' } }
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const body = await response.json();
                expect(response.status).to.equal(200);
                expect(body.success).to.equal(true);
                expect(body.finalSuccess).to.equal(true);
            }
        );
    });

    it('start-headless polluted reject does not leave latestSessionActive=true', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                inspectNetworkSafety: async () => ({ pollutionState: 'route-broken' })
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const body = await response.json();
                expect(response.status).to.equal(409);
                expect(body.error).to.equal('network-baseline-polluted');
                expect(calls.sessionStartCalls).to.equal(0);

                const latest = await fetch(`${baseUrl}/automation/session/latest`);
                const latestBody = await latest.json();
                expect(latestBody.session.active).to.equal(false);
            }
        );
    });

    it('start-headless timeout path can succeed when connectivity evidence shows VPN connected', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: {
                    success: false,
                    metadata: {
                        reason: 'timeout_waiting_for_vpn_connected',
                        connectivityEvidence: 'VPN CONNECTED extra: VPN:tech.httptoolkit.android.v1 tun0 HttpProxy [127.0.0.1] 8080 VpnTransportInfo sessionId=HTTP Toolkit'
                    }
                }
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const body = await response.json();
                expect(body.success).to.equal(true);
                expect(body.activationResult.success).to.equal(true);
                expect(body.activationResult.metadata.connectedStateSource).to.equal('dumpsys-connectivity');
            }
        );
    });

    it('start-headless activation failure cleans up created session state', async () => {
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                sessionStartResult: { created: true, proxyPort: 46610, sessionUrl: 'http://127.0.0.1:46610' },
                activationResult: { success: false, metadata: { reason: 'adb_not_ready' } }
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(calls.sessionStopCalls).to.equal(1);

                const latest = await fetch(`${baseUrl}/automation/session/latest`);
                const latestBody = await latest.json();
                expect(latestBody.session.active).to.equal(false);
            }
        );
    });

    it('health reports active-but-proxy-dead when vpn is active on a connected device', async () => {
        await withTestServer(
            {
                adbDevices: [{ id: 'device-1', type: 'device' }],
                inspectVpnState: async () => ({
                    deviceId: 'device-1',
                    vpnActive: true,
                    vpnPackage: 'tech.httptoolkit.android.v1',
                    lastHtkState: 'connected',
                    errors: []
                }),
                sessionState: { active: true, proxyPort: 45500, sessionUrl: 'http://127.0.0.1:45500' },
                checkPort: async (port) => port === 45456
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/health`);
                const body = await response.json();
                expect(body.androidDevices[0].vpnActive).to.equal(true);
                expect(body.androidVpnState).to.equal('active-but-proxy-dead');
            }
        );
    });

    it('health skips offline devices without dumpsys inspection', async () => {
        await withTestServer(
            {
                adbDevices: [
                    { id: 'device-1', type: 'offline' },
                    { id: 'device-2', type: 'unauthorized' }
                ]
            },
            async (baseUrl, calls) => {
                const response = await fetch(`${baseUrl}/automation/health`);
                const body = await response.json();
                expect(body.skippedDevices).to.deep.equal([
                    { deviceId: 'device-1', adbState: 'offline', reason: 'offline' },
                    { deviceId: 'device-2', adbState: 'unauthorized', reason: 'unauthorized' }
                ]);
                expect(calls.inspectVpnCalls).to.deep.equal([]);
            }
        );
    });

    it('watchdog runs stop-headless cleanup before any recover when vpn is active but proxy is dead', async function () {
        this.timeout(8000);
        await withTestServer(
            {
                sessionState: { active: true, proxyPort: 45500, sessionUrl: 'http://127.0.0.1:45500' },
                adbDevices: [{ id: 'device-1', type: 'device' }],
                inspectVpnState: async () => ({
                    deviceId: 'device-1',
                    vpnActive: true,
                    vpnPackage: 'tech.httptoolkit.android.v1',
                    lastHtkState: 'connected',
                    errors: []
                }),
                checkPort: async (port) => port === 45456
            },
            async (_baseUrl, calls) => {
                await new Promise((resolve) => setTimeout(resolve, 3600));
                expect(calls.cleanupCalls).to.be.greaterThan(0);
                expect(calls.targetTrafficSignalCalls).to.equal(0);
            }
        );
    });

    it('watchdog does not reset failures when recover returns success=false', async function () {
        this.timeout(12000);
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true },
                observedTrafficSignal: {
                    observed: true,
                    bootstrapOnly: false,
                    source: 'observed-session-traffic',
                    totalSeenRequests: 1,
                    ignoredBootstrapRequests: 0,
                    matchingRequests: 1
                },
                targetTrafficSignal: { observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 },
                adbDevices: [{ id: 'emulator-5554', type: 'device' }],
                checkPort: async (port) => port === 45456
            },
            async (baseUrl) => {
                await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ deviceId: 'emulator-5554' })
                });
                await new Promise((resolve) => setTimeout(resolve, 3600));
                const healthResponse = await fetch(`${baseUrl}/automation/health`);
                const health = await healthResponse.json();
                expect(health.consecutiveRecoveryFailures).to.be.greaterThan(0);
                expect(health.nextRecoveryAllowedAt).to.be.a('string');
            }
        );
    });

    it('watchdog clears failures only after recover success=true', async function () {
        this.timeout(18000);
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true },
                observedTrafficSignal: {
                    observed: true,
                    bootstrapOnly: false,
                    source: 'observed-session-traffic',
                    totalSeenRequests: 1,
                    ignoredBootstrapRequests: 0,
                    matchingRequests: 1
                },
                targetTrafficSignals: [
                    { observed: false, source: 'none', totalSeenRequests: 0, ignoredBootstrapRequests: 0, matchingRequests: 0 },
                    { observed: true, source: 'target-session-traffic', totalSeenRequests: 1, ignoredBootstrapRequests: 0, matchingRequests: 1 }
                ],
                targetTrafficSignal: { observed: true, source: 'target-session-traffic', totalSeenRequests: 1, ignoredBootstrapRequests: 0, matchingRequests: 1 },
                adbDevices: [{ id: 'emulator-5554', type: 'device' }],
                checkPort: async (port) => port === 45456
            },
            async (baseUrl) => {
                await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ deviceId: 'emulator-5554' })
                });
                await fetch(`${baseUrl}/automation/android-adb/recover-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });

                await new Promise((resolve) => setTimeout(resolve, 9000));
                const healthResponse = await fetch(`${baseUrl}/automation/health`);
                const health = await healthResponse.json();
                expect(health.consecutiveRecoveryFailures).to.equal(0);
                expect(health.nextRecoveryAllowedAt).to.equal(undefined);
                expect(health.state).to.equal('RUNNING');
            }
        );
    });

    it('watchdog records failure/backoff when recover throws', async function () {
        this.timeout(12000);
        await withTestServer(
            {
                metadataDeviceIds: ['emulator-5554'],
                activationResult: { success: true },
                targetTrafficSignal: { observed: true, source: 'target-session-traffic', totalSeenRequests: 1, ignoredBootstrapRequests: 0, matchingRequests: 1 },
                adbDevices: [{ id: 'emulator-5554', type: 'device' }],
                checkPort: async (port) => port === 45456,
                ensureAndroidBootstrapRulesError: 'forced-bootstrap-rules-failure'
            },
            async (baseUrl) => {
                await fetch(`${baseUrl}/automation/android-adb/start-headless`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ deviceId: 'emulator-5554' })
                });

                await new Promise((resolve) => setTimeout(resolve, 9000));
                const healthResponse = await fetch(`${baseUrl}/automation/health`);
                const health = await healthResponse.json();
                expect(health.consecutiveRecoveryFailures).to.be.greaterThan(0);
                expect(health.nextRecoveryAllowedAt).to.be.a('string');
                expect(['DEGRADED', 'ERROR']).to.include(health.state);
            }
        );
    });

    it('exposes rescue-network endpoint', async () => {
        await withTestServer(
            {
                adbDevices: [{ id: 'device-1', type: 'device' }]
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/rescue-network`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ deviceId: 'device-1' })
                });

                expect(response.status).to.equal(200);
                const body = await response.json();
                expect(body.success).to.be.a('boolean');
                expect(body.results).to.be.an('array');
            }
        );
    });

    it('rescue-network returns failure when requested device is not online', async () => {
        await withTestServer(
            {
                adbDevices: [{ id: 'device-1', type: 'offline' }]
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/rescue-network`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ deviceId: 'missing-device' })
                });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.error).to.equal('no-online-target-device');
                expect(body.networkRiskCleared).to.equal(false);
                expect(body.selectedDeviceCount).to.equal(0);
            }
        );
    });

    it('rescue-network returns failure when no online adb devices are available', async () => {
        await withTestServer(
            {
                adbDevices: [{ id: 'device-1', type: 'unauthorized' }]
            },
            async (baseUrl) => {
                const response = await fetch(`${baseUrl}/automation/android-adb/rescue-network`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({})
                });
                const body = await response.json();
                expect(body.success).to.equal(false);
                expect(body.error).to.equal('no-online-adb-devices');
                expect(body.selectedDeviceCount).to.equal(0);
            }
        );
    });
});
