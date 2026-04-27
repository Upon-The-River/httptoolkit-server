import { HeadlessBackendKind, HeadlessBackendStrategy } from './headless-backend-strategy';
import { HeadlessProcessRecord } from './headless-process-registry';

export interface DetachedSpawnRequest {
    command: string;
    args: string[];
    cwd?: string;
    env?: NodeJS.ProcessEnv;
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

export interface ProcessRunner {
    spawnDetached(request: DetachedSpawnRequest): Promise<DetachedSpawnResult>;
    kill?(processId: number): Promise<ProcessKillResult>;
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
    };
}

export interface HeadlessActionResult {
    ok: boolean;
    implemented: boolean;
    action: 'start' | 'stop' | 'recover';
    backend: HeadlessBackendStrategy;
    reason?: string;
    process?: HeadlessProcessRecord;
}

export interface HeadlessHealthState {
    ok: true;
    service: 'headless-control';
    state: 'idle' | 'running' | 'degraded';
    startImplemented: boolean;
    stopImplemented: boolean;
    recoverImplemented: boolean;
    lastAction?: {
        action: 'start' | 'stop' | 'recover';
        ok: boolean;
        implemented: boolean;
        timestamp: string;
    };
}

export interface HeadlessControlApi {
    start(options?: { deviceId?: string }): Promise<HeadlessActionResult>;
    stop(options?: { deviceId?: string }): Promise<HeadlessActionResult>;
    recover(options?: { deviceId?: string }): Promise<HeadlessActionResult>;
    getCapabilities(): HeadlessCapabilities;
}
