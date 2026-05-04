import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConnectionHealthService } from '../src/automation/connection-health-service';

describe('connection health service', () => {
    const baseHealth = { updatedAt: new Date().toISOString() };

    it('marks passive data plane observed when JSONL grows', async () => {
        let size = 100;
        const svc = new ConnectionHealthService({
            getAutomationHealth: () => baseHealth,
            getExportOutputStatus: () => ({ jsonlPath: '/tmp/a', exportDir: '/tmp', runtimeRoot: '/tmp', exists: true, sizeBytes: size })
        });
        await svc.getConnectionHealth();
        size = 200;
        const result = await svc.getConnectionHealth();
        assert.equal(result.passiveDataPlaneObserved, true);
        assert.equal(result.dataPlaneIdle, false);
        assert.equal(result.jsonlGrowthBytes, 100);
        assert.notEqual(result.connectionState, 'disconnected');
    });

    it('is idle when JSONL not growing with good control/device evidence', async () => {
        const svc = new ConnectionHealthService({
            getAutomationHealth: () => ({ updatedAt: new Date().toISOString() }),
            getExportOutputStatus: () => ({ jsonlPath: '/tmp/a', exportDir: '/tmp', runtimeRoot: '/tmp', exists: true, sizeBytes: 100 }),
            bridgeHealthCheck: async () => true,
            getDeviceLikelyConnected: async () => true
        });
        await svc.getConnectionHealth();
        const result = await svc.getConnectionHealth();
        assert.equal(result.dataPlaneIdle, true);
        assert.equal(result.passiveDataPlaneObserved, false);
        assert.ok(['idle', 'active'].includes(result.connectionState));
        assert.notEqual(result.connectionState, 'disconnected');
    });

    it('control-plane stale but data-plane active is not disconnected', async () => {
        let size = 100;
        const svc = new ConnectionHealthService({
            getAutomationHealth: () => ({ updatedAt: new Date(0).toISOString() }),
            getExportOutputStatus: () => ({ jsonlPath: '/tmp/a', exportDir: '/tmp', runtimeRoot: '/tmp', exists: true, sizeBytes: size })
        });
        await svc.getConnectionHealth();
        size = 130;
        const result = await svc.getConnectionHealth();
        assert.ok(['active', 'degraded'].includes(result.connectionState));
        assert.equal(result.nonFatalEvidence.includes('control-plane-stale-but-data-plane-active'), true);
        assert.notEqual(result.connectionState, 'disconnected');
    });

    it('stale control-plane without failures is not disconnected', async () => {
        const svc = new ConnectionHealthService({
            getAutomationHealth: () => ({ updatedAt: new Date(0).toISOString() }),
            getExportOutputStatus: () => ({ jsonlPath: '/tmp/a', exportDir: '/tmp', runtimeRoot: '/tmp', exists: true, sizeBytes: 100 })
        });
        const result = await svc.getConnectionHealth();
        assert.ok(['stale', 'degraded', 'unknown'].includes(result.connectionState));
        assert.notEqual(result.connectionState, 'disconnected');
    });

    it('target traffic evidence keeps non-disconnected state', async () => {
        const svc = new ConnectionHealthService({
            getAutomationHealth: () => ({ updatedAt: new Date(0).toISOString() }),
            getExportOutputStatus: () => ({ jsonlPath: '/tmp/a', exportDir: '/tmp', runtimeRoot: '/tmp', exists: true, sizeBytes: 0 })
        });
        svc.noteIngestEvent({ targetMatched: true });
        const result = await svc.getConnectionHealth();
        assert.equal(result.targetTrafficAlive, true);
        assert.equal(typeof result.lastTargetTrafficObservedAt, 'string');
        assert.notEqual(result.connectionState, 'disconnected');
    });

    it('device evidence unavailable only adds warning/non-fatal signal', async () => {
        const svc = new ConnectionHealthService({
            getAutomationHealth: () => ({ updatedAt: new Date().toISOString() }),
            getExportOutputStatus: () => ({ jsonlPath: '/tmp/a', exportDir: '/tmp', runtimeRoot: '/tmp', exists: true, sizeBytes: 0 }),
            getDeviceLikelyConnected: async () => null
        });
        const result = await svc.getConnectionHealth();
        assert.equal(result.warnings.includes('vpn-evidence-unavailable'), true);
        assert.notEqual(result.connectionState, 'disconnected');
    });

    it('strong failure evidence over threshold can become disconnected', async () => {
        process.env.LAB_ADDON_CONNECTION_HEALTH_DISCONNECTED_MS = '1';
        const svc = new ConnectionHealthService({
            getAutomationHealth: () => ({ updatedAt: new Date(0).toISOString() }),
            getExportOutputStatus: () => ({ jsonlPath: '/tmp/a', exportDir: '/tmp', runtimeRoot: '/tmp', exists: true, sizeBytes: 0 }),
            bridgeHealthCheck: async () => false,
            getDeviceLikelyConnected: async () => false
        });
        await svc.getConnectionHealth();
        await new Promise((r) => setTimeout(r, 5));
        const result = await svc.getConnectionHealth();
        assert.equal(result.connectionState, 'disconnected');
        assert.equal(result.disconnectEvidence.includes('device-offline'), true);
        assert.equal(result.nonFatalEvidence.includes('bridge-unreachable'), true);
        assert.equal(result.disconnectEvidence.some((x) => x.includes('jsonl')), false);
        delete process.env.LAB_ADDON_CONNECTION_HEALTH_DISCONNECTED_MS;
    });

    it('bridge-unreachable alone never forces disconnected after threshold', async () => {
        process.env.LAB_ADDON_CONNECTION_HEALTH_DISCONNECTED_MS = '1';
        const svc = new ConnectionHealthService({
            getAutomationHealth: () => ({ updatedAt: new Date(0).toISOString() }),
            getExportOutputStatus: () => ({ jsonlPath: '/tmp/a', exportDir: '/tmp', runtimeRoot: '/tmp', exists: true, sizeBytes: 100 }),
            bridgeHealthCheck: async () => false,
            getDeviceLikelyConnected: async () => null
        });
        await svc.getConnectionHealth();
        await new Promise((r) => setTimeout(r, 5));
        const result = await svc.getConnectionHealth();
        assert.notEqual(result.connectionState, 'disconnected');
        assert.equal(result.nonFatalEvidence.includes('bridge-unreachable'), true);
        assert.equal(result.disconnectEvidence.includes('bridge-unreachable'), false);
        delete process.env.LAB_ADDON_CONNECTION_HEALTH_DISCONNECTED_MS;
    });

    it('first JSONL sample builds baseline and does not imply passive data plane activity', async () => {
        let size = 100;
        const svc = new ConnectionHealthService({
            getAutomationHealth: () => ({ updatedAt: new Date().toISOString() }),
            getExportOutputStatus: () => ({ jsonlPath: '/tmp/a', exportDir: '/tmp', runtimeRoot: '/tmp', exists: true, sizeBytes: size })
        });

        const first = await svc.getConnectionHealth();
        assert.equal(first.passiveDataPlaneObserved, false);
        assert.equal(first.jsonlGrowthBytes, 0);

        const second = await svc.getConnectionHealth();
        assert.equal(second.passiveDataPlaneObserved, false);
        assert.equal(second.dataPlaneIdle, true);

        size = 130;
        const third = await svc.getConnectionHealth();
        assert.equal(third.passiveDataPlaneObserved, true);
        assert.equal(third.jsonlGrowthBytes, 30);
    });

    it('under disconnected threshold remains non-disconnected', async () => {
        process.env.LAB_ADDON_CONNECTION_HEALTH_DISCONNECTED_MS = '600000';
        const svc = new ConnectionHealthService({
            getAutomationHealth: () => ({ updatedAt: new Date(0).toISOString() }),
            getExportOutputStatus: () => ({ jsonlPath: '/tmp/a', exportDir: '/tmp', runtimeRoot: '/tmp', exists: true, sizeBytes: 0 }),
            bridgeHealthCheck: async () => false
        });
        const result = await svc.getConnectionHealth();
        assert.ok(['stale', 'degraded', 'unknown'].includes(result.connectionState));
        assert.notEqual(result.connectionState, 'disconnected');
        delete process.env.LAB_ADDON_CONNECTION_HEALTH_DISCONNECTED_MS;
    });

    it('invalid bridge timeout env adds warning without crashing', async () => {
        process.env.LAB_ADDON_CONNECTION_HEALTH_BRIDGE_TIMEOUT_MS = 'abc';
        const svc = new ConnectionHealthService({
            getAutomationHealth: () => ({ updatedAt: new Date().toISOString() }),
            getExportOutputStatus: () => ({ jsonlPath: '/tmp/a', exportDir: '/tmp', runtimeRoot: '/tmp', exists: true, sizeBytes: 0 })
        });

        const result = await svc.getConnectionHealth();
        assert.equal(result.warnings.includes('invalid-env:LAB_ADDON_CONNECTION_HEALTH_BRIDGE_TIMEOUT_MS'), true);

        delete process.env.LAB_ADDON_CONNECTION_HEALTH_BRIDGE_TIMEOUT_MS;
    });
});
