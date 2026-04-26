export type MigrationStatusDomain =
    | 'qidian'
    | 'session'
    | 'android-network'
    | 'headless'
    | 'export'
    | 'core-bridge';

export type MigrationStatusState =
    | 'implemented'
    | 'safe-stub'
    | 'pending'
    | 'requires-core-hook';

export interface MigrationCapability {
    id: string;
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    domain: MigrationStatusDomain;
    status: MigrationStatusState;
    mutatesDeviceState: boolean;
    description: string;
    notes: string;
}

export interface MigrationStatusSummary {
    implemented: number;
    safeStub: number;
    pending: number;
    requiresCoreHook: number;
}

export interface MigrationStatusRegistryResponse {
    pendingRoutes: string[];
    capabilities: MigrationCapability[];
    summary: MigrationStatusSummary;
}
