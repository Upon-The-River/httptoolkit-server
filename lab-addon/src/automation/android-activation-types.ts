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
    allowUnsafeStart?: boolean;
    enableSocks?: boolean;
    waitForTraffic?: boolean;
    waitForTargetTraffic?: boolean;
}

export interface StartHeadlessResponse {
    success: boolean;
    deviceId?: string;
    proxyPort: number;
    session: {
        active: boolean;
        source: 'addon';
        details: Record<string, unknown>;
    };
    controlPlaneSuccess: boolean;
    dataPlaneObserved: boolean;
    targetTrafficObserved: boolean;
    trafficValidated: boolean;
    activationResult: unknown;
    health: unknown;
    errors: Array<unknown>;
}
