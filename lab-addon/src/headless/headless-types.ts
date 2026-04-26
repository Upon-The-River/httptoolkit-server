export interface ProcessRunRequest {
    command: string;
    args: string[];
    timeoutMs?: number;
}

export interface ProcessRunResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface ProcessRunner {
    run(request: ProcessRunRequest): Promise<ProcessRunResult>;
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
}

export interface HeadlessActionResult {
    ok: boolean;
    implemented: boolean;
    action: 'start' | 'stop' | 'recover';
    reason?: string;
    command?: {
        command: string;
        args: string[];
    };
    output?: {
        stdout: string;
        stderr: string;
        exitCode: number;
    };
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
