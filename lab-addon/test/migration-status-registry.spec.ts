import assert from 'node:assert/strict';
import path from 'node:path';
import { describe, it } from 'node:test';

import { buildMigrationStatusRegistry, MIGRATION_CAPABILITIES } from '../src/migration/migration-status-registry';

describe('migration status registry', () => {
    it('builds summary counts and pending route list from capability statuses', () => {
        const registry = buildMigrationStatusRegistry();

        assert.equal(registry.capabilities.length, MIGRATION_CAPABILITIES.length);
        assert.deepEqual(registry.summary, {
            implemented: 16,
            safeStub: 3,
            pending: 0,
            requiresCoreHook: 1
        });

        assert.deepEqual(registry.pendingRoutes, [
            'POST /headless/start',
            'POST /headless/stop',
            'POST /headless/recover',
            'GET /export/stream'
        ]);


        const exportOutputStatus = registry.capabilities.find((capability) => capability.path === '/export/output-status');
        assert.ok(exportOutputStatus);
        assert.equal(exportOutputStatus.status, 'implemented');

        const exportCapabilities = registry.capabilities.find((capability) => capability.path === '/export/capabilities');
        assert.ok(exportCapabilities);
        assert.equal(exportCapabilities.status, 'implemented');

        const sessionStart = registry.capabilities.find((capability) => capability.path === '/session/start');
        const sessionStop = registry.capabilities.find((capability) => capability.path === '/session/stop');

        assert.ok(sessionStart);
        assert.ok(sessionStop);
        assert.equal(sessionStart.mutatesDeviceState, false);
        assert.equal(sessionStop.mutatesDeviceState, false);

        const networkRescue = registry.capabilities.find((capability) => capability.path === '/android/network/rescue');
        assert.ok(networkRescue);
        assert.equal(networkRescue.status, 'implemented');
        assert.equal(networkRescue.mutatesDeviceState, true);
    });

    it('does not mark headless stop/recover implemented based only on local-process env', async () => {
        const originalEnv = {
            LAB_ADDON_HEADLESS_BACKEND: process.env.LAB_ADDON_HEADLESS_BACKEND,
            LAB_ADDON_HEADLESS_START_COMMAND: process.env.LAB_ADDON_HEADLESS_START_COMMAND
        };

        process.env.LAB_ADDON_HEADLESS_BACKEND = 'local-process';
        process.env.LAB_ADDON_HEADLESS_START_COMMAND = 'node';

        try {
            const modulePath = path.resolve(process.cwd(), 'src/migration/migration-status-registry.ts');
            delete require.cache[modulePath];
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const imported = require(modulePath) as typeof import('../src/migration/migration-status-registry');
            const registry = imported.buildMigrationStatusRegistry();
            const start = registry.capabilities.find((capability) => capability.path === '/headless/start');
            const stop = registry.capabilities.find((capability) => capability.path === '/headless/stop');
            const recover = registry.capabilities.find((capability) => capability.path === '/headless/recover');

            assert.ok(start);
            assert.ok(stop);
            assert.ok(recover);
            assert.equal(start.status, 'implemented');
            assert.equal(stop.status, 'safe-stub');
            assert.equal(recover.status, 'safe-stub');
            assert.equal(stop.notes.includes('/headless/capabilities'), true);
            assert.equal(recover.notes.includes('/headless/capabilities'), true);
        } finally {
            process.env.LAB_ADDON_HEADLESS_BACKEND = originalEnv.LAB_ADDON_HEADLESS_BACKEND;
            process.env.LAB_ADDON_HEADLESS_START_COMMAND = originalEnv.LAB_ADDON_HEADLESS_START_COMMAND;
        }
    });
});
