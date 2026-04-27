import { HeadlessBackendKind, HeadlessBackendStrategy } from './headless-backend-strategy';
import { HeadlessProcessRecord } from './headless-process-registry';

export interface DetachedSpawnRequest {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
}

export interface DetachedSpawnResult {
    ok: boolean;
    processId?: number;
    reason?: string;
}

export interface ProcessKillResult {
    ok: boolean;
    implemented: boolean;
    reason?: string;
}

export interface ProcessRunnerCapabilities {
    spawnDetached: { implemented: boolean };
    kill: { implemented: boolean; reason?: string };
}

export interface ProcessRunner {
    spawnDetached(request: DetachedSpawnRequest): Promise<DetachedSpawnResult>;
    kill?(processId: number): Promise<ProcessKillResult>;
    getCapabilities?(): ProcessRunnerCapabilities;
}

export interface HeadlessActionCapability {
    implemented: boolean;
    mutatesDeviceState: boolean;
    reason?: string;
}

export interface HeadlessCapabilities {
    health: HeadlessActionCapability;
    start: HeadlessActionCapability;
    stop: HeadlessActionCapability;
    recover: HeadlessActionCapability;
    backend: {
        active: HeadlessBackendKind;
        strategies: HeadlessBackendStrategy[];
        startCommandConfigured: boolean;
        canDryRunStart: boolean;
        canExecuteStart: boolean;
        validationErrors?: string[];
    };
}

export interface HeadlessStartPlan {
    command: string;
    args: string[];
    workingDir?: string;
    envKeys: string[];
}

export interface HeadlessActionResult {
    ok: boolean;
    implemented: boolean;
    action: 'start' | 'stop' | 'recover';
    backend: HeadlessBackendStrategy;
    reason?: string;
    process?: HeadlessProcessRecord;
    dryRun?: boolean;
    startPlan?: HeadlessStartPlan;
    validationErrors?: string[];
}

export interface HeadlessHealthState {
    ok: true;
    service: 'headless-control';
    state: 'idle' | 'running' | 'degraded';
    startImplemented: boolean;
    stopImplemented: boolean;
    recoverImplemented: boolean;
    backend: HeadlessBackendKind;
    configuredStartAvailable: boolean;
    latestProcess?: HeadlessProcessRecord;
    lastAction?: {
        action: 'start' | 'stop' | 'recover';
        ok: boolean;
        implemented: boolean;
        timestamp: string;
    };
}

export interface HeadlessStartOptions {
    deviceId?: string;
    backend?: HeadlessBackendKind;
    command?: string;
    args?: string[] | string;
    workingDir?: string;
    env?: Record<string, string>;
    dryRun?: boolean;
}

export interface HeadlessControlApi {
    start(options?: HeadlessStartOptions): Promise<HeadlessActionResult>;
    stop(options?: { deviceId?: string }): Promise<HeadlessActionResult>;
    recover(options?: { deviceId?: string }): Promise<HeadlessActionResult>;
    getCapabilities(): HeadlessCapabilities;
    getLatestProcess?(): HeadlessProcessRecord | undefined;
}
