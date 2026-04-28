import { AndroidNetworkSafetyApi } from '../android/android-network-safety';
import { ExportFileSink } from '../export/export-file-sink';
import { matchQidianTraffic } from '../qidian/qidian-traffic-matcher';
import { LatestSessionState, ObservedTrafficSignal, SessionManager, TargetTrafficSignal } from '../session/session-manager';
import { AutomationHealthStore } from './automation-health-store';
import { AndroidActivationClient } from './android-activation-client';
import { StartHeadlessEvidence, StartHeadlessFailurePhase, StartHeadlessRequest, StartHeadlessResponse } from './android-activation-types';

const DEFAULT_PROXY_PORT = 8000;
const TRAFFIC_WAIT_TIMEOUT_MS = 10_000;
const TRAFFIC_WAIT_POLL_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const resolveActivationMode = (activationResult: { success: boolean, details?: Record<string, unknown> }): 'safe-stub' | 'adb-activation' | 'partial' => {
    const explicitMode = activationResult.details?.activationMode;
    if (explicitMode === 'safe-stub' || explicitMode === 'adb-activation' || explicitMode === 'partial') {
        return explicitMode;
    }

    if (activationResult.success) return 'adb-activation';
    return activationResult.details?.safeStub === true ? 'safe-stub' : 'partial';
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    return value as Record<string, unknown>;
};

const toWarningCode = (raw: string): string | undefined => {
    const lower = raw.toLowerCase();
    if (lower.includes("can't find service: vpn")) return 'dumpsys-vpn-unavailable';
    if (lower.includes('docker') && lower.includes('enoent') && lower.includes('docker_engine')) return 'docker-unavailable';
    if (lower.includes('su root') && lower.includes('timeout')) return 'unsupported-su-root-syntax';
    if (lower.includes('wrong version number') || lower.includes('tls client hello unavailable')) return 'non-tls-client-on-tls-path';
    if (lower.includes('enotfound') && lower.includes('status-ipv6.jpush.cn')) return 'upstream-dns-failure';
    if (lower.includes('socket hang up')) return 'upstream-socket-hangup';
    if (lower.includes('invalid ipv4 header') && lower.includes('was 6')) return 'vpn-ipv6-packet-warning';
    return;
};

interface SessionManagerLike {
    startSessionIfNeeded(options?: { proxyPort?: number }): Promise<{
        created: boolean,
        proxyPort: number,
        sessionUrl: string
    }>;
    getLatestSession(): LatestSessionState;
    stopLatestSession(): Promise<{ stopped: boolean }>;
    getObservedTrafficSignal(options?: { waitMs?: number, pollIntervalMs?: number }): Promise<ObservedTrafficSignal>;
    getTargetTrafficSignal(options?: { waitMs?: number, pollIntervalMs?: number }): Promise<TargetTrafficSignal>;
}

export interface AndroidAdbStartHeadlessServiceOptions {
    androidNetworkSafety: AndroidNetworkSafetyApi;
    sessionManager?: SessionManagerLike;
    activationClient: AndroidActivationClient;
    healthStore: AutomationHealthStore;
    exportFileSink?: Pick<ExportFileSink, 'getOutputStatus' | 'readRecordsForTests' | 'readRecordsSinceOffset'>;
    matchTargetTraffic?: (url: string) => boolean;
}

type TrafficEvidence = {
    jsonlAfterBytes: number,
    jsonlGrowthObserved: boolean,
    newRecordsObserved: boolean,
    newTargetRecordsObserved: boolean,
    dataPlaneObserved: boolean,
    targetTrafficObserved: boolean
};

type VpnEvidenceInput = {
    bridgeControlPlaneSuccess: boolean,
    observedStates: string[],
    activeNetworkMentionsVpn: boolean
};

type VpnEvidence = Pick<StartHeadlessEvidence,
    'proxyVpnRunnableSeen' |
    'activityMentionsHttpToolkit' |
    'dumpsysVpnAvailable' |
    'dumpsysVpnMentionsHttpToolkit' |
    'activeNetworkMentionsVpn' |
    'bridgeControlPlaneSuccess'> & {
        vpnLikelyActive: boolean
    };

const evaluateVpnEvidence = (input: VpnEvidenceInput): VpnEvidence => {
    const observedStateText = input.observedStates.join(' ').toLowerCase();
    const proxyVpnRunnableSeen = observedStateText.includes('proxyvpnrunnable') || observedStateText.includes('proxy-vpn-runnable');
    const activityMentionsHttpToolkit = observedStateText.includes('activity-app-visible');
    const dumpsysVpnMentionsHttpToolkit = observedStateText.includes('vpn-owner-signal');

    const evidence: VpnEvidence = {
        bridgeControlPlaneSuccess: input.bridgeControlPlaneSuccess,
        proxyVpnRunnableSeen,
        activityMentionsHttpToolkit,
        dumpsysVpnAvailable: !observedStateText.includes('dumpsys-vpn-unavailable'),
        dumpsysVpnMentionsHttpToolkit,
        activeNetworkMentionsVpn: input.activeNetworkMentionsVpn,
        vpnLikelyActive:
            (input.bridgeControlPlaneSuccess && proxyVpnRunnableSeen) ||
            (input.bridgeControlPlaneSuccess && activityMentionsHttpToolkit) ||
            dumpsysVpnMentionsHttpToolkit ||
            (input.activeNetworkMentionsVpn && (proxyVpnRunnableSeen || activityMentionsHttpToolkit || dumpsysVpnMentionsHttpToolkit))
    };

    return evidence;
};

const evaluateStartHeadlessOutcome = (input: {
    controlPlaneSuccess: boolean,
    shouldWaitForTraffic: boolean,
    shouldWaitForTargetTraffic: boolean,
    dataPlaneObserved: boolean,
    targetTrafficObserved: boolean
}): {
    trafficValidated: boolean,
    targetValidated: boolean,
    overallSuccess: boolean,
    failurePhase?: StartHeadlessFailurePhase
} => {
    const trafficValidated = !input.shouldWaitForTraffic || input.dataPlaneObserved;
    const targetValidated = !input.shouldWaitForTargetTraffic || input.targetTrafficObserved;
    const overallSuccess = input.controlPlaneSuccess && trafficValidated && targetValidated;

    let failurePhase: StartHeadlessFailurePhase | undefined;
    if (!overallSuccess) {
        if (!input.controlPlaneSuccess) {
            failurePhase = 'control-plane';
        } else if (input.shouldWaitForTraffic && !input.dataPlaneObserved) {
            failurePhase = 'traffic-wait-timeout';
        } else if (input.shouldWaitForTargetTraffic && !input.targetTrafficObserved) {
            failurePhase = 'target-wait-timeout';
        }
    }

    return { trafficValidated, targetValidated, overallSuccess, failurePhase };
};

export class AndroidAdbStartHeadlessService {
    private readonly androidNetworkSafety: AndroidNetworkSafetyApi;
    private readonly sessionManager: SessionManagerLike;
    private readonly activationClient: AndroidActivationClient;
    private readonly healthStore: AutomationHealthStore;
    private readonly exportFileSink: Pick<ExportFileSink, 'getOutputStatus' | 'readRecordsForTests' | 'readRecordsSinceOffset'>;
    private readonly matchTargetTraffic: (url: string) => boolean;

    constructor(options: AndroidAdbStartHeadlessServiceOptions) {
        this.androidNetworkSafety = options.androidNetworkSafety;
        this.sessionManager = options.sessionManager ?? new SessionManager();
        this.activationClient = options.activationClient;
        this.healthStore = options.healthStore;
        this.exportFileSink = options.exportFileSink ?? new ExportFileSink();
        this.matchTargetTraffic = options.matchTargetTraffic ?? ((url: string) => matchQidianTraffic(url).matched);
    }

    private async pollOutputWindow(options: {
        shouldWaitForTraffic: boolean,
        shouldWaitForTargetTraffic: boolean,
        baselineBytes: number
    }): Promise<TrafficEvidence> {
        if (!(options.shouldWaitForTraffic || options.shouldWaitForTargetTraffic)) {
            return {
                jsonlAfterBytes: options.baselineBytes,
                jsonlGrowthObserved: false,
                newRecordsObserved: false,
                newTargetRecordsObserved: false,
                dataPlaneObserved: false,
                targetTrafficObserved: false
            };
        }

        let snapshot: TrafficEvidence = {
            jsonlAfterBytes: this.exportFileSink.getOutputStatus().sizeBytes,
            jsonlGrowthObserved: false,
            newRecordsObserved: false,
            newTargetRecordsObserved: false,
            dataPlaneObserved: false,
            targetTrafficObserved: false
        };

        const evaluateTrafficEvidence = (): TrafficEvidence => {
            const outputStatus = this.exportFileSink.getOutputStatus();
            const newRecords = this.exportFileSink.readRecordsSinceOffset(options.baselineBytes);
            const newTargetRecordsObserved = newRecords.some((record) => typeof record.url === 'string' && this.matchTargetTraffic(record.url));

            return {
                jsonlAfterBytes: outputStatus.sizeBytes,
                jsonlGrowthObserved: outputStatus.sizeBytes > options.baselineBytes,
                newRecordsObserved: newRecords.length > 0,
                newTargetRecordsObserved,
                dataPlaneObserved: outputStatus.sizeBytes > options.baselineBytes || newRecords.length > 0,
                targetTrafficObserved: newTargetRecordsObserved
            };
        };

        snapshot = evaluateTrafficEvidence();
        const satisfied = () =>
            (!options.shouldWaitForTraffic || snapshot.dataPlaneObserved) &&
            (!options.shouldWaitForTargetTraffic || snapshot.targetTrafficObserved);

        if (satisfied()) {
            return snapshot;
        }

        const deadline = Date.now() + TRAFFIC_WAIT_TIMEOUT_MS;
        while (Date.now() < deadline && !satisfied()) {
            await sleep(TRAFFIC_WAIT_POLL_MS);
            snapshot = evaluateTrafficEvidence();
        }

        return snapshot;
    }

    async startHeadless(input: StartHeadlessRequest): Promise<StartHeadlessResponse> {
        const attemptId = `start-headless-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const deviceId = typeof input.deviceId === 'string' && input.deviceId.trim().length > 0 ? input.deviceId : undefined;
        const allowUnsafeStart = input.allowUnsafeStart === true;
        const enableSocks = input.enableSocks === true;
        const requestedProxyPort = typeof input.proxyPort === 'number' && Number.isInteger(input.proxyPort) && input.proxyPort > 0
            ? input.proxyPort
            : DEFAULT_PROXY_PORT;

        if (!deviceId) {
            return this.buildFailure({
                attemptId,
                requestedProxyPort,
                effectiveProxyPort: 0,
                deviceId: undefined,
                errors: [{ code: 'missing-device-id', message: 'Request body must include deviceId.' }],
                activationResult: {},
                networkInspection: undefined,
                failurePhase: 'control-plane'
            });
        }

        const networkInspection = await this.androidNetworkSafety.inspectNetwork({ deviceId });
        if ((networkInspection.warnings?.length ?? 0) > 0 && !allowUnsafeStart) {
            return this.buildFailure({
                attemptId,
                requestedProxyPort,
                effectiveProxyPort: requestedProxyPort,
                deviceId,
                errors: [{
                    code: 'network-baseline-polluted',
                    message: 'Android network baseline contains warnings; set allowUnsafeStart=true to continue.',
                    details: { warnings: networkInspection.warnings, deviceId }
                }],
                activationResult: { blocked: true, reason: 'network-baseline-polluted' },
                networkInspection,
                failurePhase: 'control-plane'
            });
        }

        const shouldWaitForTraffic = input.waitForTraffic === true;
        const shouldWaitForTargetTraffic = input.waitForTargetTraffic === true;
        const jsonlBaselineBytes = this.exportFileSink.getOutputStatus().sizeBytes;

        const activationResult = await this.activationClient.activateDeviceCapture({
            deviceId,
            proxyPort: requestedProxyPort,
            enableSocks
        });

        const activationDetails = asRecord(activationResult.details) ?? {};
        const bridgeResponse = asRecord(activationDetails.bridgeResponse);
        const bridgeControlPlaneSuccess = bridgeResponse?.controlPlaneSuccess === true;
        const usedOfficialBridge = bridgeResponse !== undefined;

        let localSession: Awaited<ReturnType<SessionManagerLike['startSessionIfNeeded']>> | undefined;
        if (!bridgeControlPlaneSuccess) {
            localSession = await this.sessionManager.startSessionIfNeeded({ proxyPort: requestedProxyPort });
        }

        const effectiveProxyPort = bridgeControlPlaneSuccess && typeof bridgeResponse?.proxyPort === 'number'
            ? bridgeResponse.proxyPort
            : localSession?.proxyPort ?? requestedProxyPort;

        const trafficEvidence = await this.pollOutputWindow({
            shouldWaitForTraffic,
            shouldWaitForTargetTraffic,
            baselineBytes: jsonlBaselineBytes
        });

        const dataPlaneObserved = trafficEvidence.dataPlaneObserved;
        const targetTrafficObserved = trafficEvidence.targetTrafficObserved;
        const controlPlaneSuccess = bridgeControlPlaneSuccess || (activationResult.success === true && !usedOfficialBridge);

        const observedStates = Array.isArray(activationDetails.observedStates)
            ? activationDetails.observedStates.map((entry) => String(entry))
            : [];

        const vpnEvidence = evaluateVpnEvidence({
            bridgeControlPlaneSuccess,
            observedStates,
            activeNetworkMentionsVpn: networkInspection.vpn.activeNetworkMentionsVpn === true
        });

        const outcome = evaluateStartHeadlessOutcome({
            controlPlaneSuccess,
            shouldWaitForTraffic,
            shouldWaitForTargetTraffic,
            dataPlaneObserved,
            targetTrafficObserved
        });

        if (!outcome.overallSuccess && localSession) {
            await this.sessionManager.stopLatestSession();
        }

        const warningStrings = [
            ...(activationResult.errors ?? []),
            ...((Array.isArray(bridgeResponse?.errors) ? bridgeResponse.errors : []) as string[]),
            JSON.stringify(activationDetails)
        ];
        const warningCodes = Array.from(new Set(warningStrings
            .map((entry) => toWarningCode(entry))
            .filter((entry): entry is string => Boolean(entry))));

        const evidence: StartHeadlessEvidence = {
            bridgeControlPlaneSuccess,
            bridgeProxyPort: typeof bridgeResponse?.proxyPort === 'number' ? bridgeResponse.proxyPort : undefined,
            proxyVpnRunnableSeen: vpnEvidence.proxyVpnRunnableSeen,
            activityMentionsHttpToolkit: vpnEvidence.activityMentionsHttpToolkit,
            dumpsysVpnAvailable: vpnEvidence.dumpsysVpnAvailable,
            dumpsysVpnMentionsHttpToolkit: vpnEvidence.dumpsysVpnMentionsHttpToolkit,
            activeNetworkMentionsVpn: vpnEvidence.activeNetworkMentionsVpn,
            jsonlBaselineBytes,
            jsonlAfterBytes: trafficEvidence.jsonlAfterBytes,
            jsonlGrowthObserved: trafficEvidence.jsonlGrowthObserved,
            newRecordsObserved: trafficEvidence.newRecordsObserved,
            newTargetRecordsObserved: trafficEvidence.newTargetRecordsObserved
        };

        const activationMode = bridgeControlPlaneSuccess ? 'adb-activation' : resolveActivationMode(activationResult);
        const startResult = {
            attemptId,
            requestedProxyPort,
            effectiveProxyPort,
            controlPlaneSuccess,
            vpnLikelyActive: vpnEvidence.vpnLikelyActive,
            dataPlaneObserved,
            targetTrafficObserved,
            trafficValidated: outcome.trafficValidated,
            targetValidated: outcome.targetValidated,
            overallSuccess: outcome.overallSuccess,
            failurePhase: outcome.failurePhase,
            evidence,
            warnings: warningCodes,
            errors: activationResult.errors ?? [],
            observedAt: new Date().toISOString()
        };

        const health = this.healthStore.patch({
            lastRoute: 'POST /automation/android-adb/start-headless',
            lastDeviceId: deviceId,
            lastStartHeadless: startResult,
            ...(outcome.overallSuccess ? { lastSuccessfulStartHeadless: startResult } : { lastFailure: startResult }),
            ...(controlPlaneSuccess ? { lastControlPlaneSuccessfulStartHeadless: startResult } : {}),
            lastNetworkInspection: networkInspection,
            activationMode
        });

        return {
            success: outcome.overallSuccess,
            overallSuccess: outcome.overallSuccess,
            attemptId,
            deviceId,
            requestedProxyPort,
            effectiveProxyPort,
            proxyPort: effectiveProxyPort,
            session: {
                active: controlPlaneSuccess,
                source: 'addon',
                details: bridgeControlPlaneSuccess
                    ? {
                        source: 'official-bridge',
                        proxyPort: effectiveProxyPort,
                        validation: {
                            overallSuccess: outcome.overallSuccess,
                            trafficValidated: outcome.trafficValidated,
                            targetValidated: outcome.targetValidated,
                            failurePhase: outcome.failurePhase
                        }
                    }
                    : {
                        created: localSession?.created,
                        sessionUrl: localSession?.sessionUrl,
                        validation: {
                            overallSuccess: outcome.overallSuccess,
                            trafficValidated: outcome.trafficValidated,
                            targetValidated: outcome.targetValidated,
                            failurePhase: outcome.failurePhase
                        }
                    }
            },
            controlPlaneSuccess,
            vpnLikelyActive: vpnEvidence.vpnLikelyActive,
            dataPlaneObserved,
            targetTrafficObserved,
            trafficValidated: outcome.trafficValidated,
            targetValidated: outcome.targetValidated,
            failurePhase: outcome.failurePhase,
            evidence,
            activationResult: bridgeControlPlaneSuccess
                ? { implemented: true, activationMode: 'official-bridge', bridgeResponse }
                : (activationResult.details ?? { success: activationResult.success }),
            warnings: warningCodes,
            health,
            errors: outcome.overallSuccess
                ? []
                : [{
                    code: 'activation-failed',
                    message: 'Activation did not satisfy start-headless validation contract.',
                    details: {
                        failurePhase: outcome.failurePhase,
                        activationErrors: activationResult.errors ?? []
                    }
                }]
        };
    }

    async stopHeadless(input: { deviceId?: string }): Promise<unknown> {
        const result = await this.activationClient.stopDeviceCapture({ deviceId: input.deviceId });
        const health = this.healthStore.patch({
            lastRoute: 'POST /automation/android-adb/stop-headless',
            lastDeviceId: input.deviceId,
            lastStopHeadless: result
        });

        return {
            success: result.success,
            safeStub: result.safeStub,
            implemented: result.implemented,
            action: 'stop-headless',
            deviceId: input.deviceId,
            errors: result.errors ?? [],
            details: result.details ?? {},
            health
        };
    }

    async recoverHeadless(input: { deviceId?: string }): Promise<unknown> {
        const result = await this.activationClient.recoverDeviceCapture({ deviceId: input.deviceId });
        const health = this.healthStore.patch({
            lastRoute: 'POST /automation/android-adb/recover-headless',
            lastDeviceId: input.deviceId,
            lastRecoverHeadless: result
        });

        return {
            success: result.success,
            safeStub: result.safeStub,
            implemented: result.implemented,
            action: 'recover-headless',
            deviceId: input.deviceId,
            errors: result.errors ?? [],
            details: result.details ?? {},
            health
        };
    }

    getHealth(): unknown {
        return this.healthStore.getSnapshot();
    }

    private buildFailure(options: {
        attemptId: string,
        requestedProxyPort: number,
        effectiveProxyPort: number,
        proxyPort?: number,
        deviceId: string | undefined,
        errors: Array<unknown>,
        activationResult: unknown,
        networkInspection: unknown,
        failurePhase: StartHeadlessFailurePhase
    }): StartHeadlessResponse {
        const evidence: StartHeadlessEvidence = {
            bridgeControlPlaneSuccess: false,
            bridgeProxyPort: undefined,
            proxyVpnRunnableSeen: false,
            activityMentionsHttpToolkit: false,
            dumpsysVpnAvailable: true,
            dumpsysVpnMentionsHttpToolkit: false,
            activeNetworkMentionsVpn: false,
            jsonlBaselineBytes: 0,
            jsonlAfterBytes: 0,
            jsonlGrowthObserved: false,
            newRecordsObserved: false,
            newTargetRecordsObserved: false
        };

        const failedAttempt = {
            attemptId: options.attemptId,
            requestedProxyPort: options.requestedProxyPort,
            effectiveProxyPort: options.effectiveProxyPort,
            controlPlaneSuccess: false,
            vpnLikelyActive: false,
            dataPlaneObserved: false,
            targetTrafficObserved: false,
            trafficValidated: false,
            targetValidated: false,
            overallSuccess: false,
            failurePhase: options.failurePhase,
            evidence,
            warnings: [],
            errors: options.errors,
            observedAt: new Date().toISOString()
        };

        const health = this.healthStore.patch({
            lastRoute: 'POST /automation/android-adb/start-headless',
            lastDeviceId: options.deviceId,
            lastStartHeadless: failedAttempt,
            lastFailure: failedAttempt,
            ...(options.networkInspection ? { lastNetworkInspection: options.networkInspection } : {}),
            activationMode: 'partial'
        });

        return {
            success: false,
            overallSuccess: false,
            attemptId: options.attemptId,
            deviceId: options.deviceId,
            requestedProxyPort: options.requestedProxyPort,
            effectiveProxyPort: options.effectiveProxyPort,
            proxyPort: options.proxyPort ?? options.effectiveProxyPort,
            session: {
                active: false,
                source: 'addon',
                details: {}
            },
            controlPlaneSuccess: false,
            vpnLikelyActive: false,
            dataPlaneObserved: false,
            targetTrafficObserved: false,
            trafficValidated: false,
            targetValidated: false,
            failurePhase: options.failurePhase,
            evidence,
            activationResult: options.activationResult,
            warnings: [],
            health,
            errors: options.errors
        };
    }
}

export { TRAFFIC_WAIT_POLL_MS, TRAFFIC_WAIT_TIMEOUT_MS };
