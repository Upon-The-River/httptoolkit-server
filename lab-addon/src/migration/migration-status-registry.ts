import {
    MigrationCapability,
    MigrationStatusRegistryResponse,
    MigrationStatusSummary
} from './migration-status-types';

export const MIGRATION_CAPABILITIES: MigrationCapability[] = [
    {
        id: 'addon-health',
        method: 'GET',
        path: '/health',
        domain: 'core-bridge',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Addon liveness endpoint.',
        notes: 'Used by operators and tests to confirm lab-addon is available.'
    },
    {
        id: 'qidian-match',
        method: 'POST',
        path: '/qidian/match',
        domain: 'qidian',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Checks whether an observed URL matches Qidian target traffic.',
        notes: 'Read-only matcher endpoint.'
    },
    {
        id: 'session-latest',
        method: 'GET',
        path: '/session/latest',
        domain: 'session',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Returns the latest local session status.',
        notes: 'No side effects.'
    },
    {
        id: 'session-start',
        method: 'POST',
        path: '/session/start',
        domain: 'session',
        status: 'implemented',
        mutatesDeviceState: true,
        description: 'Starts or reuses a session.',
        notes: 'May open a proxy session.'
    },
    {
        id: 'session-stop',
        method: 'POST',
        path: '/session/stop',
        domain: 'session',
        status: 'implemented',
        mutatesDeviceState: true,
        description: 'Stops the latest session.',
        notes: 'May close an active proxy session.'
    },
    {
        id: 'session-target-signal',
        method: 'POST',
        path: '/session/target-signal',
        domain: 'session',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Inspects seen traffic for target signal detection.',
        notes: 'Read-only signal observation.'
    },
    {
        id: 'android-network-inspect',
        method: 'POST',
        path: '/android/network/inspect',
        domain: 'android-network',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Collects Android network diagnostics in read-only mode.',
        notes: 'No network settings are changed.'
    },
    {
        id: 'android-network-rescue',
        method: 'POST',
        path: '/android/network/rescue',
        domain: 'android-network',
        status: 'safe-stub',
        mutatesDeviceState: false,
        description: 'Reserved rescue endpoint for Android network recovery.',
        notes: 'Intentional safe no-op until recovery workflow migration is approved.'
    },
    {
        id: 'android-network-capabilities',
        method: 'GET',
        path: '/android/network/capabilities',
        domain: 'android-network',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Reports Android network capability flags.',
        notes: 'Describes inspect/rescue support without side effects.'
    },
    {
        id: 'headless-health',
        method: 'GET',
        path: '/headless/health',
        domain: 'headless',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Reports addon headless subsystem health.',
        notes: 'Read-only status endpoint.'
    },
    {
        id: 'headless-start',
        method: 'POST',
        path: '/headless/start',
        domain: 'headless',
        status: 'safe-stub',
        mutatesDeviceState: false,
        description: 'Placeholder for future headless startup orchestration.',
        notes: 'Intentional safe no-op until full migration approval.'
    },
    {
        id: 'headless-stop',
        method: 'POST',
        path: '/headless/stop',
        domain: 'headless',
        status: 'safe-stub',
        mutatesDeviceState: false,
        description: 'Placeholder for future headless shutdown orchestration.',
        notes: 'Intentional safe no-op to avoid recursive script calls.'
    },
    {
        id: 'headless-recover',
        method: 'POST',
        path: '/headless/recover',
        domain: 'headless',
        status: 'safe-stub',
        mutatesDeviceState: false,
        description: 'Placeholder for future headless recovery orchestration.',
        notes: 'Intentional safe no-op to avoid recursive script calls.'
    },
    {
        id: 'headless-capabilities',
        method: 'GET',
        path: '/headless/capabilities',
        domain: 'headless',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Returns supported headless actions and implementation flags.',
        notes: 'Read-only capability report.'
    },
    {
        id: 'export-stream',
        method: 'GET',
        path: '/export/stream',
        domain: 'export',
        status: 'requires-core-hook',
        mutatesDeviceState: false,
        description: 'Planned live export stream bridge endpoint.',
        notes: 'Requires official core integration hook before addon can fully expose streaming export.'
    }
];

export const buildMigrationStatusRegistry = (): MigrationStatusRegistryResponse => {
    const summary = MIGRATION_CAPABILITIES.reduce<MigrationStatusSummary>((acc, capability) => {
        switch (capability.status) {
            case 'implemented':
                acc.implemented += 1;
                break;
            case 'safe-stub':
                acc.safeStub += 1;
                break;
            case 'pending':
                acc.pending += 1;
                break;
            case 'requires-core-hook':
                acc.requiresCoreHook += 1;
                break;
        }

        return acc;
    }, {
        implemented: 0,
        safeStub: 0,
        pending: 0,
        requiresCoreHook: 0
    });

    const pendingRoutes = MIGRATION_CAPABILITIES
        .filter((capability) => capability.status !== 'implemented')
        .map((capability) => `${capability.method} ${capability.path}`);

    return {
        pendingRoutes,
        capabilities: MIGRATION_CAPABILITIES,
        summary
    };
};
