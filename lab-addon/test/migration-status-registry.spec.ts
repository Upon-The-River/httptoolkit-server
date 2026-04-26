import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildMigrationStatusRegistry, MIGRATION_CAPABILITIES } from '../src/migration/migration-status-registry';

describe('migration status registry', () => {
    it('builds summary counts and pending route list from capability statuses', () => {
        const registry = buildMigrationStatusRegistry();

        assert.equal(registry.capabilities.length, MIGRATION_CAPABILITIES.length);
        assert.deepEqual(registry.summary, {
            implemented: 14,
            safeStub: 4,
            pending: 0,
            requiresCoreHook: 1
        });

        assert.deepEqual(registry.pendingRoutes, [
            'POST /android/network/rescue',
            'POST /headless/start',
            'POST /headless/stop',
            'POST /headless/recover',
            'GET /export/stream'
        ]);

        const exportCapabilities = registry.capabilities.find((capability) => capability.path === '/export/capabilities');
        assert.ok(exportCapabilities);
        assert.equal(exportCapabilities.status, 'implemented');

        const sessionStart = registry.capabilities.find((capability) => capability.path === '/session/start');
        const sessionStop = registry.capabilities.find((capability) => capability.path === '/session/stop');

        assert.ok(sessionStart);
        assert.ok(sessionStop);
        assert.equal(sessionStart.mutatesDeviceState, false);
        assert.equal(sessionStop.mutatesDeviceState, false);
    });
});
