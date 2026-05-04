import * as fs from 'node:fs';

import { AutomationHealthSnapshot } from './automation-health-store';
import { ExportOutputStatus } from '../export/export-file-sink';

export type ConnectionState = 'active' | 'idle' | 'stale' | 'degraded' | 'unknown' | 'disconnected';

export interface ConnectionHealthSnapshot {
    ok: boolean;
    connectionState: ConnectionState;
    observedAt: string;
    lastHeartbeatAt: string;
    controlPlaneAlive: boolean | null;
    deviceLikelyConnected: boolean | null;
    passiveDataPlaneObserved: boolean;
    dataPlaneIdle: boolean;
    targetTrafficAlive: boolean;
    activeProbeSupported: boolean;
    lastActiveProbeAt: string | null;
    lastActiveProbeOk: boolean | null;
    lastControlPlaneOkAt: string | null;
    lastDeviceEvidenceAt: string | null;
    lastDataPlaneObservedAt: string | null;
    lastTargetTrafficObservedAt: string | null;
    jsonlPath: string | null;
    jsonlExists: boolean;
    jsonlSizeBytes: number;
    jsonlLastSizeBytes: number;
    jsonlGrowthBytes: number;
    disconnectEvidence: string[];
    nonFatalEvidence: string[];
    warnings: string[];
    staleReason: string | null;
}

interface Thresholds { dataPlaneRecentMs:number; controlPlaneStaleMs:number; deviceStaleMs:number; disconnectedMs:number; bridgeTimeoutMs:number }

const parseMs = (name: string, fallback: number, warnings: string[]): number => {
    const raw = process.env[name];
    if (!raw) return fallback;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        warnings.push(`invalid-env:${name}`);
        return fallback;
    }
    return parsed;
};

export class ConnectionHealthService {
    private firstStrongFailureObservedAt: string | null = null;
    private lastStrongFailureObservedAt: string | null = null;
    private lastJsonlSizeBytes: number | null = null;
    private lastDataPlaneObservedAt: string | null = null;
    private lastTargetTrafficObservedAt: string | null = null;
    private lastActiveProbeAt: string | null = null;
    private lastActiveProbeOk: boolean | null = null;
    private lastControlPlaneOkAt: string | null = null;
    private lastDeviceEvidenceAt: string | null = null;

    private readonly thresholdsBaseWarnings: string[] = [];
    private readonly t: Thresholds;

    constructor(private readonly deps: {
        getAutomationHealth: () => Partial<AutomationHealthSnapshot>,
        getExportOutputStatus: () => ExportOutputStatus,
        bridgeHealthCheck?: () => Promise<boolean | null>,
        getDeviceLikelyConnected?: () => Promise<boolean | null>
    }) {
        this.t = {
            dataPlaneRecentMs: parseMs('LAB_ADDON_CONNECTION_HEALTH_DATA_PLANE_RECENT_MS', 5 * 60 * 1000, this.thresholdsBaseWarnings),
            controlPlaneStaleMs: parseMs('LAB_ADDON_CONNECTION_HEALTH_CONTROL_PLANE_STALE_MS', 10 * 60 * 1000, this.thresholdsBaseWarnings),
            deviceStaleMs: parseMs('LAB_ADDON_CONNECTION_HEALTH_DEVICE_STALE_MS', 10 * 60 * 1000, this.thresholdsBaseWarnings),
            disconnectedMs: parseMs('LAB_ADDON_CONNECTION_HEALTH_DISCONNECTED_MS', 30 * 60 * 1000, this.thresholdsBaseWarnings),
            bridgeTimeoutMs: parseMs('LAB_ADDON_CONNECTION_HEALTH_BRIDGE_TIMEOUT_MS', 500, this.thresholdsBaseWarnings)
        };
    }

    noteIngestEvent(info: { persisted?: boolean, targetMatched?: boolean }): void {
        const now = new Date().toISOString();
        if (info.persisted) this.lastDataPlaneObservedAt = now;
        if (info.targetMatched) this.lastTargetTrafficObservedAt = now;
    }

    async getConnectionHealth(): Promise<ConnectionHealthSnapshot> {
        const warnings = [...this.thresholdsBaseWarnings];
        const nonFatalEvidence: string[] = [];
        const disconnectEvidence: string[] = [];
        const now = new Date();
        const observedAt = now.toISOString();

        const output = this.deps.getExportOutputStatus();
        const prevSize = this.lastJsonlSizeBytes;
        const growth = prevSize === null ? 0 : (output.sizeBytes - prevSize);
        const positiveGrowth = prevSize !== null && growth > 0;
        if (positiveGrowth) this.lastDataPlaneObservedAt = observedAt;

        const automation = this.deps.getAutomationHealth();
        let controlPlaneAlive: boolean | null = null;
        try {
            controlPlaneAlive = this.deps.bridgeHealthCheck ? await this.deps.bridgeHealthCheck() : null;
        } catch {
            controlPlaneAlive = false;
            warnings.push('bridge-check-failed');
        }
        if (controlPlaneAlive) this.lastControlPlaneOkAt = observedAt;

        let deviceLikelyConnected: boolean | null = null;
        try {
            deviceLikelyConnected = this.deps.getDeviceLikelyConnected ? await this.deps.getDeviceLikelyConnected() : null;
        } catch {
            warnings.push('device-evidence-unavailable');
        }
        if (deviceLikelyConnected === null) warnings.push('vpn-evidence-unavailable');
        if (deviceLikelyConnected) this.lastDeviceEvidenceAt = observedAt;

        const targetRecent = this.lastTargetTrafficObservedAt && (now.getTime() - Date.parse(this.lastTargetTrafficObservedAt) <= this.t.dataPlaneRecentMs);
        const dataPlaneRecent = this.lastDataPlaneObservedAt && (now.getTime() - Date.parse(this.lastDataPlaneObservedAt) <= this.t.dataPlaneRecentMs);

        const updatedAtTs = Date.parse(automation.updatedAt ?? new Date(0).toISOString());
        const staleControlPlane = Number.isFinite(updatedAtTs) ? (now.getTime() - updatedAtTs > this.t.controlPlaneStaleMs) : true;
        let staleReason: string | null = null;

        if (staleControlPlane && (Boolean(dataPlaneRecent) || Boolean(targetRecent))) {
            nonFatalEvidence.push('control-plane-stale-but-data-plane-active');
        }

        if (controlPlaneAlive === false) nonFatalEvidence.push('bridge-unreachable');
        if (deviceLikelyConnected === false) {
            nonFatalEvidence.push('device-offline');
            disconnectEvidence.push('device-offline');
        }
        if (this.lastActiveProbeOk === false) disconnectEvidence.push('active-probe-failed');
        if (automation.lastStopHeadless) disconnectEvidence.push('session-stopped');

        const hasStrongFailure = disconnectEvidence.length > 0;
        if (hasStrongFailure) {
            if (!this.firstStrongFailureObservedAt) this.firstStrongFailureObservedAt = observedAt;
            this.lastStrongFailureObservedAt = observedAt;
        } else {
            this.firstStrongFailureObservedAt = null;
            this.lastStrongFailureObservedAt = null;
        }
        const enoughTime = this.firstStrongFailureObservedAt
            ? (now.getTime() - Date.parse(this.firstStrongFailureObservedAt) > this.t.disconnectedMs)
            : false;

        let state: ConnectionState = 'unknown';
        if (hasStrongFailure && enoughTime) {
            state = 'disconnected';
        } else if (positiveGrowth || targetRecent || dataPlaneRecent || this.lastActiveProbeOk === true || (controlPlaneAlive && deviceLikelyConnected !== false && !hasStrongFailure)) {
            state = staleControlPlane && (positiveGrowth || targetRecent || dataPlaneRecent) ? 'degraded' : 'active';
        } else if (!staleControlPlane && (controlPlaneAlive !== false) && (deviceLikelyConnected !== false) && this.lastActiveProbeOk !== false) {
            state = 'idle';
        } else if (staleControlPlane && !hasStrongFailure) {
            state = controlPlaneAlive === false ? 'degraded' : 'stale';
            staleReason = 'control-plane-stale';
        } else if (!hasStrongFailure) {
            state = 'unknown';
        }

        const passiveDataPlaneObserved = positiveGrowth;
        const dataPlaneIdle = !positiveGrowth && !Boolean(targetRecent) && !Boolean(dataPlaneRecent);
        if (state === 'disconnected' && (passiveDataPlaneObserved || targetRecent || dataPlaneRecent)) {
            state = 'degraded';
        }

        this.lastJsonlSizeBytes = output.sizeBytes;

        return {
            ok: true,
            connectionState: state,
            observedAt,
            lastHeartbeatAt: observedAt,
            controlPlaneAlive,
            deviceLikelyConnected,
            passiveDataPlaneObserved,
            dataPlaneIdle,
            targetTrafficAlive: Boolean(targetRecent),
            activeProbeSupported: false,
            lastActiveProbeAt: this.lastActiveProbeAt,
            lastActiveProbeOk: this.lastActiveProbeOk,
            lastControlPlaneOkAt: this.lastControlPlaneOkAt,
            lastDeviceEvidenceAt: this.lastDeviceEvidenceAt,
            lastDataPlaneObservedAt: this.lastDataPlaneObservedAt,
            lastTargetTrafficObservedAt: this.lastTargetTrafficObservedAt,
            jsonlPath: output.jsonlPath,
            jsonlExists: output.exists,
            jsonlSizeBytes: output.sizeBytes,
            jsonlLastSizeBytes: prevSize ?? output.sizeBytes,
            jsonlGrowthBytes: growth,
            disconnectEvidence: state === 'disconnected' ? disconnectEvidence : [],
            nonFatalEvidence,
            warnings,
            staleReason
        };
    }
}
