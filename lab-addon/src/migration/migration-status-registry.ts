import { loadHeadlessConfig } from '../headless/headless-config';
import {
    MigrationCapability,
    MigrationStatusRegistryResponse,
    MigrationStatusSummary
} from './migration-status-types';

const headlessConfig = loadHeadlessConfig();
const headlessUsesLocalProcess = headlessConfig.backend === 'local-process';
const headlessStartImplementedInRegistry = headlessUsesLocalProcess && Boolean(headlessConfig.startCommand) && headlessConfig.validationErrors.length === 0;

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
        mutatesDeviceState: false,
        description: 'Starts or reuses a session.',
        notes: 'May mutate addon-side session/proxy state, but does not directly mutate Android device state.'
    },
    {
        id: 'session-stop',
        method: 'POST',
        path: '/session/stop',
        domain: 'session',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Stops the latest session.',
        notes: 'May mutate addon-side session/proxy state, but does not directly mutate Android device state.'
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
        status: 'implemented',
        mutatesDeviceState: true,
        description: 'Runs explicit conservative Android network rescue actions.',
        notes: 'Defaults to dry-run and only executes explicitly enabled conservative low/medium risk actions.'
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
        status: headlessStartImplementedInRegistry ? 'implemented' : 'safe-stub',
        mutatesDeviceState: false,
        description: 'Placeholder for future headless startup orchestration.',
        notes: headlessStartImplementedInRegistry
            ? 'Implemented via optional local-process backend when explicitly configured.'
            : 'Intentional safe no-op unless local-process is explicitly configured. Runtime /headless/capabilities is the source of truth for env/request-body start availability.'
    },
    {
        id: 'headless-stop',
        method: 'POST',
        path: '/headless/stop',
        domain: 'headless',
        status: 'safe-stub',
        mutatesDeviceState: false,
        description: 'Placeholder for future headless shutdown orchestration.',
        notes: 'Intentional safe no-op in static registry. Runtime /headless/capabilities is the source of truth for backend-specific stop availability.'
    },
    {
        id: 'headless-recover',
        method: 'POST',
        path: '/headless/recover',
        domain: 'headless',
        status: 'safe-stub',
        mutatesDeviceState: false,
        description: 'Placeholder for future headless recovery orchestration.',
        notes: 'Intentional safe no-op in static registry. Runtime /headless/capabilities is the source of truth for backend-specific recover availability.'
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
    },
    {
        id: 'export-capabilities',
        method: 'GET',
        path: '/export/capabilities',
        domain: 'export',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Describes addon-side export support and core-hook dependencies.',
        notes: 'Read-only capability metadata endpoint.'
    },
    {
        id: 'export-targets',
        method: 'GET',
        path: '/export/targets',
        domain: 'export',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Returns loaded live export target configuration.',
        notes: 'Read-only target rules from addon config.'
    },
    {
        id: 'export-match',
        method: 'POST',
        path: '/export/match',
        domain: 'export',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Matches synthetic export events against addon target rules.',
        notes: 'Used for validation/testing without core traffic hooks.'
    },

    {
        id: 'export-output-status',
        method: 'GET',
        path: '/export/output-status',
        domain: 'export',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Reports addon runtime export output file status for JSONL persistence.',
        notes: 'Read-only runtime artifact metadata endpoint.'
    },
    {
        id: 'export-ingest',
        method: 'POST',
        path: '/export/ingest',
        domain: 'export',
        status: 'implemented',
        mutatesDeviceState: false,
        description: 'Normalizes synthetic export events into stable JSONL-compatible records.',
        notes: 'Addon-only ingestion/testing endpoint.'
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
