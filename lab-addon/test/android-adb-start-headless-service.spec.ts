import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AndroidNetworkSafetyApi } from '../src/android/android-network-safety';
import { AndroidActivationClient } from '../src/automation/android-activation-client';
import { AndroidAdbStartHeadlessService } from '../src/automation/android-adb-start-headless-service';
import { AutomationHealthStore } from '../src/automation/automation-health-store';

const safeNetwork: AndroidNetworkSafetyApi = {
    inspectNetwork: async () => ({
        ok: true,
        inspectedAt: new Date().toISOString(),
        deviceId: 'device-1',
        inspectMode: 'read-only',
        proxy: {
            globalHttpProxy: null,
            globalHttpProxyHost: null,
            globalHttpProxyPort: null,
            globalHttpProxyExclusionList: null
        },
        privateDns: { mode: null, specifier: null },
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
        before: await safeNetwork.inspectNetwork({ deviceId: 'device-1' })
    }),
    getCapabilities: () => ({
        inspect: { implemented: true, mutatesDeviceState: false },
        rescue: { implemented: true, mutatesDeviceState: true, defaultDryRun: true, limitations: [] }
    })
};

type ServiceFactoryOptions = {
    activationResult?: Awaited<ReturnType<AndroidActivationClient['activateDeviceCapture']>>,
    outputSizes?: number[],
    recordsTimeline?: string[][],
    sessionObserved?: boolean,
    sessionTargetObserved?: boolean
};

const makeService = (options: ServiceFactoryOptions = {}) => {
    let startCalls = 0;
    const outputSizes = options.outputSizes ?? [0, 0, 0];
    const recordsTimeline = options.recordsTimeline ?? [[], [], []];
    let statusRead = 0;
    let recordsRead = 0;

    const service = new AndroidAdbStartHeadlessService({
        androidNetworkSafety: safeNetwork,
        healthStore: new AutomationHealthStore(),
        activationClient: {
            activateDeviceCapture: async () => options.activationResult ?? {
                success: true,
                details: {
                    bridgeResponse: { success: true, controlPlaneSuccess: true, proxyPort: 8000 }
                }
            },
            stopDeviceCapture: async () => ({ success: true, implemented: true, safeStub: false, details: {}, errors: [] }),
            recoverDeviceCapture: async () => ({ success: true, implemented: true, safeStub: false, details: {}, errors: [] })
        },
        sessionManager: {
            startSessionIfNeeded: async () => {
                startCalls += 1;
                return { created: true, proxyPort: 8001, sessionUrl: 'http://127.0.0.1:8001' };
            },
            getLatestSession: () => ({ active: false }),
            stopLatestSession: async () => ({ stopped: true }),
            getObservedTrafficSignal: async () => ({
                observed: options.sessionObserved ?? false,
                source: 'none',
                totalSeenRequests: 0,
                ignoredBootstrapRequests: 0,
                matchingRequests: 0
            }),
            getTargetTrafficSignal: async () => ({
                observed: options.sessionTargetObserved ?? false,
                source: 'none',
                totalSeenRequests: 0,
                ignoredBootstrapRequests: 0,
                matchingRequests: 0
            })
        },
        exportFileSink: {
            getOutputStatus: () => ({
                exists: true,
                sizeBytes: outputSizes[Math.min(statusRead++, outputSizes.length - 1)],
                exportDir: '',
                targetConfigPath: '',
                jsonlPath: ''
            }),
            readRecordsForTests: () => [],
            readRecordsSinceOffset: () => {
                const urls = recordsTimeline[Math.min(recordsRead++, recordsTimeline.length - 1)];
                return urls.map((url, index) => ({
                    schemaVersion: 1,
                    recordId: String(index),
                    observedAt: new Date().toISOString(),
                    method: 'GET',
                    url,
                    statusCode: 200,
                    body: { inline: '', encoding: 'utf8' as const }
                }));
            }
        }
    });

    return { service, getStartCalls: () => startCalls };
};

describe('AndroidAdbStartHeadlessService matrix', () => {
    it('A: no wait flags succeeds on control-plane only, does not use historical JSONL as evidence, and never starts local 8001 session', async () => {
        const { service, getStartCalls } = makeService({ outputSizes: [250, 250], recordsTimeline: [[], []] });
        const result = await service.startHeadless({ deviceId: 'device-1', proxyPort: 8000 });

        assert.equal(result.overallSuccess, true);
        assert.equal(result.controlPlaneSuccess, true);
        assert.equal(result.dataPlaneObserved, false);
        assert.equal(result.trafficValidated, true);
        assert.equal(result.targetValidated, true);
        assert.equal(result.evidence.jsonlBaselineBytes, 250);
        assert.equal(result.evidence.jsonlAfterBytes, 250);
        assert.equal(result.evidence.jsonlGrowthObserved, false);
        assert.equal(result.effectiveProxyPort, 8000);
        assert.equal(getStartCalls(), 0);
    });

    it('B: waitForTraffic=true succeeds only when post-baseline data-plane appears', async () => {
        const { service } = makeService({ outputSizes: [100, 150], recordsTimeline: [[], []] });
        const result = await service.startHeadless({ deviceId: 'device-1', waitForTraffic: true });

        assert.equal(result.dataPlaneObserved, true);
        assert.equal(result.trafficValidated, true);
        assert.equal(result.overallSuccess, true);
        assert.equal(result.targetValidated, true);
    });

    it('B: waitForTraffic=true fails with traffic-wait-timeout when no growth/new records', async () => {
        const { service } = makeService({ outputSizes: [100, 100, 100], recordsTimeline: [[], [], []] });
        const result = await service.startHeadless({ deviceId: 'device-1', waitForTraffic: true });

        assert.equal(result.dataPlaneObserved, false);
        assert.equal(result.overallSuccess, false);
        assert.equal(result.failurePhase, 'traffic-wait-timeout');
    });

    it('B: stale pre-baseline records do not satisfy waitForTraffic', async () => {
        const { service } = makeService({ outputSizes: [500, 500], recordsTimeline: [[], []] });
        const result = await service.startHeadless({ deviceId: 'device-1', waitForTraffic: true });

        assert.equal(result.evidence.jsonlBaselineBytes, 500);
        assert.equal(result.evidence.newRecordsObserved, false);
        assert.equal(result.overallSuccess, false);
    });

    it('C: waitForTargetTraffic=true succeeds only with new post-baseline target records', async () => {
        const { service } = makeService({
            outputSizes: [120, 120, 120],
            recordsTimeline: [[], ['https://druidv6.if.qidian.com/argus/api/v3/bookdetail/get']]
        });
        const result = await service.startHeadless({ deviceId: 'device-1', waitForTargetTraffic: true });

        assert.equal(result.targetTrafficObserved, true);
        assert.equal(result.targetValidated, true);
        assert.equal(result.overallSuccess, true);
    });

    it('C: stale-only historical target does not satisfy waitForTargetTraffic', async () => {
        const { service } = makeService({ outputSizes: [120, 120], recordsTimeline: [[], []] });
        const result = await service.startHeadless({ deviceId: 'device-1', waitForTargetTraffic: true });

        assert.equal(result.targetTrafficObserved, false);
        assert.equal(result.overallSuccess, false);
        assert.equal(result.failurePhase, 'target-wait-timeout');
        assert.equal(result.session.active, true);
        assert.deepEqual(result.session.details.validation, {
            overallSuccess: false,
            trafficValidated: true,
            targetValidated: false,
            failurePhase: 'target-wait-timeout'
        });
    });

    it('C: non-target growth alone fails target wait', async () => {
        const { service } = makeService({
            outputSizes: [120, 160],
            recordsTimeline: [['https://example.com/health']]
        });
        const result = await service.startHeadless({ deviceId: 'device-1', waitForTargetTraffic: true });

        assert.equal(result.dataPlaneObserved, true);
        assert.equal(result.targetTrafficObserved, false);
        assert.equal(result.overallSuccess, false);
    });

    it('D: both flags require both data-plane and target evidence', async () => {
        const nonTarget = makeService({ outputSizes: [100, 140], recordsTimeline: [['https://example.com/a']] });
        const nonTargetResult = await nonTarget.service.startHeadless({ deviceId: 'device-1', waitForTraffic: true, waitForTargetTraffic: true });
        assert.equal(nonTargetResult.dataPlaneObserved, true);
        assert.equal(nonTargetResult.targetTrafficObserved, false);
        assert.equal(nonTargetResult.overallSuccess, false);

        const target = makeService({
            outputSizes: [100, 140],
            recordsTimeline: [['https://druidv6.if.qidian.com/argus/api/v3/bookdetail/get']]
        });
        const targetResult = await target.service.startHeadless({ deviceId: 'device-1', waitForTraffic: true, waitForTargetTraffic: true });
        assert.equal(targetResult.dataPlaneObserved, true);
        assert.equal(targetResult.targetTrafficObserved, true);
        assert.equal(targetResult.overallSuccess, true);
    });

    it('E: vpn evidence uses non-fatal warnings and does not satisfy traffic waits by itself', async () => {
        const { service } = makeService({
            activationResult: {
                success: true,
                details: {
                    observedStates: ['dumpsys-vpn-unavailable', 'proxyvpnrunnable'],
                    bridgeResponse: { success: true, controlPlaneSuccess: true, proxyPort: 8000 }
                },
                errors: ["Can't find service: vpn"]
            },
            outputSizes: [100, 100, 100],
            recordsTimeline: [[], [], []]
        });

        const result = await service.startHeadless({ deviceId: 'device-1', waitForTraffic: true, waitForTargetTraffic: true });
        assert.equal(result.vpnLikelyActive, true);
        assert.equal((result.warnings as string[]).includes('dumpsys-vpn-unavailable'), true);
        assert.equal(result.overallSuccess, false);
        assert.equal(result.failurePhase, 'traffic-wait-timeout');
    });

    it('F: noisy operational errors are warnings only and do not force failure', async () => {
        const { service } = makeService({
            activationResult: {
                success: true,
                details: { bridgeResponse: { success: true, controlPlaneSuccess: true, proxyPort: 8000 } },
                errors: [
                    'connect ENOENT //./pipe/docker_engine',
                    'su root timeout but su -c succeeded',
                    'tls wrong version number',
                    'getaddrinfo ENOTFOUND status-ipv6.jpush.cn',
                    'socket hang up',
                    'Invalid IPv4 header. IP version should be 4 but was 6'
                ]
            }
        });

        const result = await service.startHeadless({ deviceId: 'device-1' });
        assert.equal(result.overallSuccess, true);
        const warnings = result.warnings as string[];
        assert.equal(warnings.includes('docker-unavailable'), true);
        assert.equal(warnings.includes('unsupported-su-root-syntax'), true);
        assert.equal(warnings.includes('non-tls-client-on-tls-path'), true);
        assert.equal(warnings.includes('upstream-dns-failure'), true);
        assert.equal(warnings.includes('upstream-socket-hangup'), true);
        assert.equal(warnings.includes('vpn-ipv6-packet-warning'), true);
    });

    it('G: health preserves success snapshot and later failure separately', async () => {
        let count = 0;
        const { service } = makeService({
            activationResult: {
                success: true,
                details: { bridgeResponse: { success: true, controlPlaneSuccess: true, proxyPort: 8000 } }
            }
        });

        (service as any).activationClient.activateDeviceCapture = async () => {
            count += 1;
            if (count === 1) {
                return { success: true, details: { bridgeResponse: { success: true, controlPlaneSuccess: true, proxyPort: 8000 } } };
            }
            return { success: true, details: { bridgeResponse: { success: true, controlPlaneSuccess: true, proxyPort: 8000 } } };
        };

        await service.startHeadless({ deviceId: 'device-1' });
        await service.startHeadless({ deviceId: 'device-1', waitForTargetTraffic: true });

        const health = service.getHealth() as any;
        assert.equal(health.lastSuccessfulStartHeadless.overallSuccess, true);
        assert.equal(health.lastControlPlaneSuccessfulStartHeadless.controlPlaneSuccess, true);
        assert.equal(health.lastFailure.failurePhase, 'target-wait-timeout');
    });

    it('H: falls back to local session only when bridge control-plane is not successful', async () => {
        const { service, getStartCalls } = makeService({
            activationResult: {
                success: false,
                details: {
                    activationMode: 'partial',
                    bridgeResponse: { success: true, controlPlaneSuccess: false, proxyPort: 8000 }
                },
                errors: ['official-bridge-failed']
            }
        });

        const result = await service.startHeadless({ deviceId: 'device-1' });
        assert.equal(getStartCalls(), 1);
        assert.equal(result.effectiveProxyPort, 8001);
    });

    it('H: does not start local session when bridge control-plane succeeds on 8001-adjacent environment', async () => {
        const { service, getStartCalls } = makeService({
            activationResult: {
                success: true,
                details: {
                    activationMode: 'adb-activation',
                    bridgeResponse: { success: true, controlPlaneSuccess: true, proxyPort: 8000 }
                },
                errors: []
            }
        });

        const result = await service.startHeadless({ deviceId: 'device-1', proxyPort: 8000 });
        assert.equal(result.controlPlaneSuccess, true);
        assert.equal(result.effectiveProxyPort, 8000);
        assert.equal(getStartCalls(), 0);
    });

    it('waitForTargetTraffic: observes only post-baseline target traffic', async () => {
        const { service } = makeService({
            outputSizes: [100, 120],
            recordsTimeline: [['https://druidv6.if.qidian.com/argus/api/v1/popup/getlistv3']]
        });
        const result = await service.waitForTargetTraffic({
            baselineBytes: 100,
            waitForTraffic: true,
            waitForTargetTraffic: true,
            timeoutMs: 10,
            pollIntervalMs: 1
        });
        assert.equal(result.success, true);
        assert.equal(result.dataPlaneObserved, true);
        assert.equal(result.targetTrafficObserved, true);
        assert.equal(result.newTargetRecordCount, 1);
    });

    it('waitForTargetTraffic: times out with empty post-baseline stream', async () => {
        const { service } = makeService({ outputSizes: [100, 100], recordsTimeline: [[], []] });
        const result = await service.waitForTargetTraffic({
            baselineBytes: 100,
            waitForTraffic: true,
            waitForTargetTraffic: true,
            timeoutMs: 5,
            pollIntervalMs: 1
        });
        assert.equal(result.success, false);
        assert.equal(result.failurePhase, 'traffic-wait-timeout');
    });

    it('stopHeadless: writes observedAt into lastStopHeadless and preserves stop result fields', async () => {
        const { service } = makeService();

        const result = await service.stopHeadless({ deviceId: 'device-1' }) as any;
        const health = service.getHealth() as any;
        const stop = health.lastStopHeadless as any;

        assert.equal(typeof stop.observedAt, 'string');
        assert.equal(Number.isNaN(Date.parse(stop.observedAt)), false);
        assert.equal(stop.success, true);
        assert.equal(stop.implemented, true);
        assert.equal(stop.safeStub, false);
        assert.deepEqual(stop.details, {});
        assert.deepEqual(stop.errors, []);

        assert.equal(result.success, true);
    });
});
