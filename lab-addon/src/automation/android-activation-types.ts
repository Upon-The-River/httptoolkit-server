export interface AndroidActivationRequest {
    deviceId: string;
    proxyPort: number;
    enableSocks: boolean;
}

export interface AndroidActivationResult {
    success: boolean;
    details?: Record<string, unknown>;
    dataPlaneObserved?: boolean;
    targetTrafficObserved?: boolean;
    errors?: string[];
}

export interface AndroidStopResult {
    success: boolean;
    implemented: boolean;
    safeStub: boolean;
    details?: Record<string, unknown>;
    errors?: string[];
}

export interface AndroidRecoverResult {
    success: boolean;
    implemented: boolean;
    safeStub: boolean;
    details?: Record<string, unknown>;
    errors?: string[];
}

export interface StartHeadlessRequest {
    deviceId?: string;
    proxyPort?: number;
    allowUnsafeStart?: boolean;
    enableSocks?: boolean;
    waitForTraffic?: boolean;
    waitForTargetTraffic?: boolean;
}

export type StartHeadlessFailurePhase = 'control-plane' | 'traffic-wait-timeout' | 'target-wait-timeout';

export interface StartHeadlessEvidence {
    bridgeControlPlaneSuccess: boolean;
    bridgeProxyPort?: number;
    proxyVpnRunnableSeen: boolean;
    activityMentionsHttpToolkit: boolean;
    dumpsysVpnAvailable: boolean;
    dumpsysVpnMentionsHttpToolkit: boolean;
    activeNetworkMentionsVpn: boolean;
    jsonlBaselineBytes: number;
    jsonlAfterBytes: number;
    jsonlGrowthObserved: boolean;
    newRecordsObserved: boolean;
    newTargetRecordsObserved: boolean;
}

export interface StartHeadlessResponse {
    success: boolean;
    overallSuccess: boolean;
    attemptId: string;
    deviceId?: string;
    requestedProxyPort: number;
    effectiveProxyPort: number;
    proxyPort: number;
    controlPlaneSuccess: boolean;
    vpnLikelyActive: boolean;
    dataPlaneObserved: boolean;
    targetTrafficObserved: boolean;
    trafficValidated: boolean;
    targetValidated: boolean;
    failurePhase?: StartHeadlessFailurePhase;
    evidence: StartHeadlessEvidence;
    session: {
        active: boolean;
        source: 'addon';
        details: Record<string, unknown> & {
            validation?: {
                overallSuccess: boolean;
                trafficValidated: boolean;
                targetValidated: boolean;
                failurePhase?: StartHeadlessFailurePhase;
            };
        };
    };
    activationResult: unknown;
    warnings?: Array<unknown>;
    health: unknown;
    errors: Array<unknown>;
}
