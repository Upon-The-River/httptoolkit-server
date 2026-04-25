import * as fs from 'fs/promises';
import * as net from 'net';
import * as path from 'path';

export type HeadlessHealthState = 'IDLE' | 'STARTING' | 'RUNNING' | 'DEGRADED' | 'RECOVERING' | 'CLEANING' | 'ERROR';
export type AndroidAdbState = 'device' | 'offline' | 'unauthorized' | 'no permissions' | 'unknown';

export interface AndroidDeviceHealth {
    deviceId: string;
    adbState: AndroidAdbState;
    vpnActive: boolean;
    vpnPackage?: string | null;
    lastHtkState: string | null;
    proxyReachable: boolean;
    errors?: string[];
}

export interface HeadlessHealth {
    state: HeadlessHealthState;
    nodePath: string;
    nodeVersion: string;
    expectedNodeVersion: string;
    mockttpAdminReachable: boolean;
    latestSessionActive: boolean;
    proxyPort?: number;
    adbDevices: string[];
    skippedDevices: Array<{ deviceId: string, adbState: string, reason: string }>;
    androidDevices: AndroidDeviceHealth[];
    androidVpnState: string;
    lastObservedTrafficAt?: string;
    lastTargetHitAt?: string;
    lastError?: string;
    recoveryCount: number;
    recoveryInProgress?: boolean;
    consecutiveRecoveryFailures?: number;
    lastRecoveryAt?: string;
    nextRecoveryAllowedAt?: string;
    lastCleanupResult?: unknown;
    lastCleanupAt?: string;
    lastCleanupHadNoOnlineTarget?: boolean;
    lastCleanupHadVpnResidual?: boolean;
    lastCleanupHadNetworkResidual?: boolean;
    lastCleanupUnverified?: boolean;
    lastNetworkRestoreResult?: unknown;
    lastNetworkSafetyStatus?: unknown;
    lastNetworkRiskCleared?: boolean;
    lastShutdownCleanup?: {
        cleanupStartedAt: string;
        cleanupFinishedAt: string;
        cleanupTimedOut: boolean;
        cleanupResult: unknown;
        diagnosticResult?: unknown;
    };
    networkSafety?: {
        devices: Array<{
            deviceId: string;
            globalHttpProxy: string | null;
            privateDnsMode: string | null;
            privateDnsSpecifier: string | null;
            alwaysOnVpnApp: string | null;
            lockdownVpn: string | null;
            activeNetworkIsVpn: boolean;
            activeNetworkHasNotVpnCapability: boolean;
            httpToolkitPackageRunning: boolean;
            canPingIp: boolean;
            canResolveDomain: boolean;
            canHttpConnect: boolean | null;
            httpProbeStatus?: string;
            httpProbeError?: string | null;
            httpProbeUnavailable?: boolean;
            pollutionState: string;
            warnings: string[];
            errors: string[];
        }>;
        lastBaselineAt?: string;
        lastRestoreAt?: string;
        lastRescueAt?: string;
        lastRescueResult?: unknown;
        baselinePollutionState?: string;
        baselineTrusted?: boolean;
        warning?: string;
    };
}

export class HeadlessHealthStore {
    private health: HeadlessHealth = {
        state: 'IDLE',
        nodePath: process.execPath,
        nodeVersion: process.version,
        expectedNodeVersion: 'v22.20.0',
        mockttpAdminReachable: false,
        latestSessionActive: false,
        adbDevices: [],
        skippedDevices: [],
        androidDevices: [],
        androidVpnState: 'unknown',
        recoveryCount: 0
    };

    constructor(private outputPath = path.resolve(__dirname, '../../runtime/headless/health.json')) {}

    get() {
        return { ...this.health };
    }

    async patch(update: Partial<HeadlessHealth>) {
        this.health = { ...this.health, ...update };
        await this.write();
    }

    async markError(error: unknown) {
        await this.patch({
            state: 'ERROR',
            lastError: error instanceof Error ? error.message : String(error)
        });
    }

    async incrementRecoveryCount() {
        await this.patch({ recoveryCount: this.health.recoveryCount + 1 });
    }

    private async write() {
        await fs.mkdir(path.dirname(this.outputPath), { recursive: true });
        await fs.writeFile(this.outputPath, JSON.stringify(this.health, null, 2));
    }
}

export async function isTcpPortReachable(port: number, host = '127.0.0.1', timeoutMs = 800): Promise<boolean> {
    return await new Promise((resolve) => {
        const socket = net.createConnection({ host, port });
        const done = (value: boolean) => {
            socket.destroy();
            resolve(value);
        };

        socket.setTimeout(timeoutMs);
        socket.once('connect', () => done(true));
        socket.once('timeout', () => done(false));
        socket.once('error', () => done(false));
    });
}
