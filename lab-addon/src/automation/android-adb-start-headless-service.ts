import { AndroidNetworkSafetyApi } from '../android/android-network-safety';
import { ExportFileSink } from '../export/export-file-sink';
import { matchQidianTraffic } from '../qidian/qidian-traffic-matcher';
import { LatestSessionState, ObservedTrafficSignal, SessionManager, TargetTrafficSignal } from '../session/session-manager';
import { AutomationHealthStore } from './automation-health-store';
import { AndroidActivationClient } from './android-activation-client';
import { StartHeadlessRequest, StartHeadlessResponse } from './android-activation-types';

const DEFAULT_PROXY_PORT = 8000;

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

const TRAFFIC_WAIT_TIMEOUT_MS = 10_000;
const TRAFFIC_WAIT_POLL_MS = 500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface AndroidAdbStartHeadlessServiceOptions {
    androidNetworkSafety: AndroidNetworkSafetyApi;
    sessionManager?: SessionManagerLike;
    activationClient: AndroidActivationClient;
    healthStore: AutomationHealthStore;
    exportFileSink?: Pick<ExportFileSink, 'getOutputStatus' | 'readRecordsForTests' | 'readRecordsSinceOffsetForTests'>;
    matchTargetTraffic?: (url: string) => boolean;
}

export class AndroidAdbStartHeadlessService {
    private readonly androidNetworkSafety: AndroidNetworkSafetyApi;
    private readonly sessionManager: SessionManagerLike;
    private readonly activationClient: AndroidActivationClient;
    private readonly healthStore: AutomationHealthStore;
    private readonly exportFileSink: Pick<ExportFileSink, 'getOutputStatus' | 'readRecordsForTests' | 'readRecordsSinceOffsetForTests'>;
    private readonly matchTargetTraffic: (url: string) => boolean;

    constructor(options: AndroidAdbStartHeadlessServiceOptions) {
        this.androidNetworkSafety = options.androidNetworkSafety;
        this.sessionManager = options.sessionManager ?? new SessionManager();
        this.activationClient = options.activationClient;
        this.healthStore = options.healthStore;
        this.exportFileSink = options.exportFileSink ?? new ExportFileSink();
        this.matchTargetTraffic = options.matchTargetTraffic ?? ((url: string) => matchQidianTraffic(url).matched);
    }

    async startHeadless(input: StartHeadlessRequest): Promise<StartHeadlessResponse> {
        const deviceId = typeof input.deviceId === 'string' && input.deviceId.trim().length > 0
            ? input.deviceId
            : undefined;
        const allowUnsafeStart = input.allowUnsafeStart === true;
        const enableSocks = input.enableSocks === true;
        const requestedProxyPort = typeof input.proxyPort === 'number' && Number.isInteger(input.proxyPort) && input.proxyPort > 0
            ? input.proxyPort
            : DEFAULT_PROXY_PORT;

        if (!deviceId) {
            return this.buildFailure({
                proxyPort: 0,
                deviceId: undefined,
                errors: [{ code: 'missing-device-id', message: 'Request body must include deviceId.' }],
                activationResult: {},
                networkInspection: undefined
            });
        }

        const networkInspection = await this.androidNetworkSafety.inspectNetwork({ deviceId });
        const hasWarnings = (networkInspection.warnings?.length ?? 0) > 0;

        if (hasWarnings && !allowUnsafeStart) {
            return this.buildFailure({
                proxyPort: requestedProxyPort,
                deviceId,
                errors: [{
                    code: 'network-baseline-polluted',
                    message: 'Android network baseline contains warnings; set allowUnsafeStart=true to continue.',
                    details: {
                        warnings: networkInspection.warnings,
                        deviceId
                    }
                }],
                activationResult: {
                    blocked: true,
                    reason: 'network-baseline-polluted'
                },
                networkInspection
            });
        }

        const beforeOutputSize = this.exportFileSink.getOutputStatus().sizeBytes;
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

        const proxyPort = typeof bridgeResponse?.proxyPort === 'number'
            ? bridgeResponse.proxyPort
            : localSession?.proxyPort ?? requestedProxyPort;

        const shouldWaitForTraffic = input.waitForTraffic === true;
        const shouldWaitForTargetTraffic = input.waitForTargetTraffic === true;
        const shouldPollOutputWindow = shouldWaitForTraffic || shouldWaitForTargetTraffic;

        let jsonlGrowthObserved = false;
        let qidianTrafficObserved = false;
        const evaluateOutputWindow = () => {
            const outputStatus = this.exportFileSink.getOutputStatus();
            jsonlGrowthObserved = jsonlGrowthObserved || outputStatus.sizeBytes > beforeOutputSize;
            const newRecords = this.exportFileSink.readRecordsSinceOffsetForTests(beforeOutputSize);
            qidianTrafficObserved = qidianTrafficObserved || newRecords
                .some((record) => typeof record.url === 'string' && this.matchTargetTraffic(record.url));
        };

        evaluateOutputWindow();
        if (shouldPollOutputWindow && (!jsonlGrowthObserved || !qidianTrafficObserved)) {
            const deadline = Date.now() + TRAFFIC_WAIT_TIMEOUT_MS;
            while (Date.now() < deadline && (!jsonlGrowthObserved || !qidianTrafficObserved)) {
                await sleep(TRAFFIC_WAIT_POLL_MS);
                evaluateOutputWindow();
            }
        }

        const observedSignal = shouldWaitForTraffic
            ? await this.sessionManager.getObservedTrafficSignal({ waitMs: 250, pollIntervalMs: 100 })
            : { observed: false } as ObservedTrafficSignal;
        const targetSignal = shouldWaitForTargetTraffic
            ? await this.sessionManager.getTargetTrafficSignal({ waitMs: 250, pollIntervalMs: 100 })
            : { observed: false } as TargetTrafficSignal;

        const dataPlaneObserved = activationResult.dataPlaneObserved === true || observedSignal.observed || jsonlGrowthObserved;
        const targetTrafficObserved = activationResult.targetTrafficObserved === true || targetSignal.observed || qidianTrafficObserved;
        const trafficValidated = dataPlaneObserved || targetTrafficObserved;

        const observedStates = Array.isArray(activationDetails.observedStates) ? activationDetails.observedStates : [];
        const observedStateText = observedStates.join(' ').toLowerCase();
        const dumpsysVpnAvailable = !observedStateText.includes('dumpsys-vpn-unavailable');
        const activityMentionsHttpToolkit = observedStateText.includes('activity-app-visible');
        const proxyVpnRunnableSeen = observedStateText.includes('proxyvpnrunnable') || observedStateText.includes('proxy-vpn-runnable');
        const vpnEvidence = {
            dumpsysVpnAvailable,
            dumpsysVpnMentionsHttpToolkit: observedStateText.includes('vpn-owner-signal'),
            activityMentionsHttpToolkit,
            proxyVpnRunnableSeen,
            activeNetworkMentionsVpn: networkInspection.vpn.activeNetworkMentionsVpn === true,
            bridgeControlPlaneSuccess,
            qidianTrafficObserved,
            jsonlGrowthObserved
        };
        const vpnLikelyActive =
            (vpnEvidence.bridgeControlPlaneSuccess && vpnEvidence.proxyVpnRunnableSeen) ||
            (vpnEvidence.bridgeControlPlaneSuccess && vpnEvidence.activityMentionsHttpToolkit && vpnEvidence.qidianTrafficObserved) ||
            (vpnEvidence.bridgeControlPlaneSuccess && vpnEvidence.jsonlGrowthObserved) ||
            (vpnEvidence.activeNetworkMentionsVpn && vpnEvidence.qidianTrafficObserved);

        const warningStrings = [
            ...(activationResult.errors ?? []),
            ...((Array.isArray(bridgeResponse?.errors) ? bridgeResponse?.errors : []) as string[]),
            JSON.stringify(activationDetails)
        ];
        const warningCodes = Array.from(new Set(warningStrings.map((entry) => toWarningCode(entry)).filter((entry): entry is string => Boolean(entry))));

        const controlPlaneSuccess = bridgeControlPlaneSuccess || (activationResult.success === true && !usedOfficialBridge);
        const success = controlPlaneSuccess && ((input.waitForTraffic === true) ? (trafficValidated || vpnLikelyActive) : true);
        if (!success && localSession) {
            await this.sessionManager.stopLatestSession();
        }

        const activationMode = bridgeControlPlaneSuccess
            ? 'adb-activation'
            : resolveActivationMode(activationResult);

        const startResult = {
            success,
            controlPlaneSuccess,
            dataPlaneObserved,
            targetTrafficObserved,
            trafficValidated,
            allowUnsafeStart,
            proxyPort,
            bridgeResponse,
            errors: activationResult.errors ?? [],
            warnings: warningCodes,
            observedAt: new Date().toISOString()
        };

        const health = this.healthStore.patch({
            lastRoute: 'POST /automation/android-adb/start-headless',
            lastDeviceId: deviceId,
            lastStartHeadless: startResult,
            ...(success ? { lastSuccessfulStartHeadless: startResult } : { lastFailure: startResult }),
            lastNetworkInspection: networkInspection,
            activationMode
        });

        return {
            success,
            deviceId,
            proxyPort,
            session: {
                active: success,
                source: 'addon',
                details: bridgeControlPlaneSuccess
                    ? { source: 'official-bridge', proxyPort }
                    : {
                        created: localSession?.created,
                        sessionUrl: localSession?.sessionUrl
                    }
            },
            controlPlaneSuccess,
            dataPlaneObserved,
            targetTrafficObserved,
            trafficValidated,
            activationResult: bridgeControlPlaneSuccess
                ? {
                    implemented: true,
                    activationMode: 'official-bridge',
                    bridgeResponse
                }
                : (activationResult.details ?? { success: activationResult.success }),
            warnings: warningCodes,
            vpnEvidence,
            vpnLikelyActive,
            health,
            errors: success
                ? []
                : [{
                    code: 'activation-failed',
                    message: 'Activation did not produce usable success evidence.',
                    details: {
                        errors: activationResult.errors ?? []
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
        proxyPort: number,
        deviceId: string | undefined,
        errors: Array<unknown>,
        activationResult: unknown,
        networkInspection: unknown
    }): StartHeadlessResponse {
        const failedAttempt = {
            success: false,
            controlPlaneSuccess: false,
            proxyPort: options.proxyPort,
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
            deviceId: options.deviceId,
            proxyPort: options.proxyPort,
            session: {
                active: false,
                source: 'addon',
                details: {}
            },
            controlPlaneSuccess: false,
            dataPlaneObserved: false,
            targetTrafficObserved: false,
            trafficValidated: false,
            activationResult: options.activationResult,
            health,
            errors: options.errors
        };
    }
}
