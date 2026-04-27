import { AndroidNetworkSafetyApi } from '../android/android-network-safety';
import { LatestSessionState, ObservedTrafficSignal, SessionManager, TargetTrafficSignal } from '../session/session-manager';
import { AutomationHealthStore } from './automation-health-store';
import { AndroidActivationClient } from './android-activation-client';
import { StartHeadlessRequest, StartHeadlessResponse } from './android-activation-types';


const resolveActivationMode = (activationResult: { success: boolean, details?: Record<string, unknown> }): 'safe-stub' | 'adb-activation' | 'partial' => {
    const explicitMode = activationResult.details?.activationMode;
    if (explicitMode === 'safe-stub' || explicitMode === 'adb-activation' || explicitMode === 'partial') {
        return explicitMode;
    }

    if (activationResult.success) return 'adb-activation';
    return activationResult.details?.safeStub === true ? 'safe-stub' : 'partial';
};

interface SessionManagerLike {
    startSessionIfNeeded(): Promise<{
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
}

export class AndroidAdbStartHeadlessService {
    private readonly androidNetworkSafety: AndroidNetworkSafetyApi;
    private readonly sessionManager: SessionManagerLike;
    private readonly activationClient: AndroidActivationClient;
    private readonly healthStore: AutomationHealthStore;

    constructor(options: AndroidAdbStartHeadlessServiceOptions) {
        this.androidNetworkSafety = options.androidNetworkSafety;
        this.sessionManager = options.sessionManager ?? new SessionManager();
        this.activationClient = options.activationClient;
        this.healthStore = options.healthStore;
    }

    async startHeadless(input: StartHeadlessRequest): Promise<StartHeadlessResponse> {
        const deviceId = typeof input.deviceId === 'string' && input.deviceId.trim().length > 0
            ? input.deviceId
            : undefined;
        const allowUnsafeStart = input.allowUnsafeStart === true;
        const enableSocks = input.enableSocks === true;

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
                proxyPort: 0,
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

        const session = await this.sessionManager.startSessionIfNeeded();
        const activationResult = await this.activationClient.activateDeviceCapture({
            deviceId,
            proxyPort: session.proxyPort,
            enableSocks
        });

        const controlPlaneSuccess = activationResult.success === true;
        const activationMode = resolveActivationMode(activationResult);
        const dataPlaneObserved = activationResult.dataPlaneObserved === true ||
            ((input.waitForTraffic ?? true) ? (await this.sessionManager.getObservedTrafficSignal({ waitMs: 250, pollIntervalMs: 100 })).observed : false);
        const targetTrafficObserved = activationResult.targetTrafficObserved === true ||
            ((input.waitForTargetTraffic ?? true) ? (await this.sessionManager.getTargetTrafficSignal({ waitMs: 250, pollIntervalMs: 100 })).observed : false);
        const trafficValidated = dataPlaneObserved || targetTrafficObserved;
        const success = controlPlaneSuccess;

        if (!success) {
            await this.sessionManager.stopLatestSession();
        }

        const response: StartHeadlessResponse = {
            success,
            deviceId,
            proxyPort: session.proxyPort,
            session: {
                active: success,
                source: 'addon',
                details: {
                    created: session.created,
                    sessionUrl: session.sessionUrl
                }
            },
            controlPlaneSuccess,
            dataPlaneObserved,
            targetTrafficObserved,
            trafficValidated,
            activationResult: activationResult.details ?? { success: activationResult.success },
            health: this.healthStore.patch({
                lastRoute: 'POST /automation/android-adb/start-headless',
                lastDeviceId: deviceId,
                lastStartHeadless: {
                    success,
                    controlPlaneSuccess,
                    dataPlaneObserved,
                    targetTrafficObserved,
                    trafficValidated,
                    allowUnsafeStart,
                    proxyPort: session.proxyPort,
                    errors: activationResult.errors ?? []
                },
                lastNetworkInspection: networkInspection,
                activationMode
            }),
            errors: success
                ? []
                : [{
                    code: 'activation-failed',
                    message: 'Activation client returned success=false.',
                    details: {
                        errors: activationResult.errors ?? []
                    }
                }]
        };

        return response;
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
        const health = this.healthStore.patch({
            lastRoute: 'POST /automation/android-adb/start-headless',
            lastDeviceId: options.deviceId,
            lastStartHeadless: {
                success: false,
                controlPlaneSuccess: false,
                proxyPort: options.proxyPort,
                errors: options.errors
            },
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
