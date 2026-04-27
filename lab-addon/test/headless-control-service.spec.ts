import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    localProcessStrategy,
    safeStubStrategy
} from '../src/headless/headless-backend-strategy';
import { HeadlessConfig, loadHeadlessConfig } from '../src/headless/headless-config';
import { HeadlessControlService } from '../src/headless/headless-control-service';
import { NodeProcessRunner } from '../src/headless/headless-process-service';
import { HeadlessProcessRegistry } from '../src/headless/headless-process-registry';
import {
    DetachedSpawnRequest,
    DetachedSpawnResult,
    ProcessRunnerCapabilities,
    ProcessKillResult,
    ProcessRunner
} from '../src/headless/headless-types';

class FakeProcessRunner implements ProcessRunner {
    public spawnCalls: DetachedSpawnRequest[] = [];
    public killCalls: number[] = [];

    constructor(
        private readonly spawnResult: DetachedSpawnResult = { ok: true, processId: 4321 },
        private readonly killResult: ProcessKillResult = { ok: true, implemented: true },
        private readonly capabilities: ProcessRunnerCapabilities = {
            spawnDetached: { implemented: true },
            kill: { implemented: true }
        }
    ) {}

    async spawnDetached(request: DetachedSpawnRequest): Promise<DetachedSpawnResult> {
        this.spawnCalls.push(request);
        return this.spawnResult;
    }

    async kill(processId: number): Promise<ProcessKillResult> {
        this.killCalls.push(processId);
        return this.killResult;
    }

    getCapabilities(): ProcessRunnerCapabilities {
        return this.capabilities;
    }
}

class SpawnOnlyRunner implements ProcessRunner {
    public spawnCalls: DetachedSpawnRequest[] = [];

    async spawnDetached(request: DetachedSpawnRequest): Promise<DetachedSpawnResult> {
        this.spawnCalls.push(request);
        return { ok: true, processId: 111 };
    }
}

const localConfig: HeadlessConfig = {
    backend: 'local-process',
    startCommand: 'node',
    startArgs: ['./bin/run', 'start'],
    workingDir: '/tmp/official-server',
    startEnv: { NODE_ENV: 'production' },
    validationErrors: []
};

describe('headless config parsing', () => {
    it('parses LAB_ADDON_HEADLESS_START_ARGS JSON array', () => {
        const config = loadHeadlessConfig({
            LAB_ADDON_HEADLESS_BACKEND: 'local-process',
            LAB_ADDON_HEADLESS_START_COMMAND: 'node',
            LAB_ADDON_HEADLESS_START_ARGS: '["./bin/run","start"]'
        });

        assert.deepEqual(config.startArgs, ['./bin/run', 'start']);
        assert.equal(config.validationErrors.length, 0);
    });

    it('parses LAB_ADDON_HEADLESS_START_ARGS simple text conservatively', () => {
        const config = loadHeadlessConfig({
            LAB_ADDON_HEADLESS_BACKEND: 'local-process',
            LAB_ADDON_HEADLESS_START_COMMAND: 'node',
            LAB_ADDON_HEADLESS_START_ARGS: './bin/run start --flag "quoted value"'
        });

        assert.deepEqual(config.startArgs, ['./bin/run', 'start', '--flag', 'quoted value']);
    });

    it('invalid LAB_ADDON_HEADLESS_ENV_JSON is a validation error and does not crash import', () => {
        const config = loadHeadlessConfig({
            LAB_ADDON_HEADLESS_BACKEND: 'local-process',
            LAB_ADDON_HEADLESS_START_COMMAND: 'node',
            LAB_ADDON_HEADLESS_ENV_JSON: '{invalid'
        });

        assert.equal(config.validationErrors.length, 1);
        assert.equal(config.validationErrors[0].includes('LAB_ADDON_HEADLESS_ENV_JSON'), true);
    });
});

describe('headless backend strategies', () => {
    it('safeStubStrategy is the default non-mutating backend', () => {
        assert.equal(safeStubStrategy.kind, 'safe-stub');
        assert.equal(safeStubStrategy.mutatesHostProcessState, false);
        assert.equal(safeStubStrategy.mutatesAndroidDeviceState, false);
        assert.equal(safeStubStrategy.implemented, true);
    });

    it('localProcessStrategy is documented but not default without explicit config', () => {
        assert.equal(localProcessStrategy.kind, 'local-process');
        assert.equal(localProcessStrategy.mutatesHostProcessState, true);
        assert.equal(localProcessStrategy.mutatesAndroidDeviceState, false);

        const service = new HeadlessControlService();
        assert.equal(service.getCapabilities().backend.active, 'safe-stub');
    });
});

describe('HeadlessProcessRegistry', () => {
    it('records started process entries for addon-started processes', () => {
        const registry = new HeadlessProcessRegistry();
        const started = registry.recordStarted({ command: 'node', args: ['script.js'], processId: 123 });

        assert.equal(started.processId, 123);
        assert.equal(started.status, 'running');
        assert.equal(started.command, 'node');
        assert.deepEqual(started.args, ['script.js']);
        assert.equal((started.metadata ?? {}).owner, 'lab-addon-headless');
    });

    it('records stopped process status', () => {
        const registry = new HeadlessProcessRegistry();
        registry.recordStarted({ command: 'node', args: ['script.js'], processId: 123 });
        const stopped = registry.recordStopped();

        assert.equal(stopped?.status, 'stopped');
        assert.equal(registry.getLatest()?.status, 'stopped');
    });

    it('records failed process status', () => {
        const registry = new HeadlessProcessRegistry();
        registry.recordStarted({ command: 'node', args: ['script.js'], processId: 123 });
        const failed = registry.recordFailed('kill failed');

        assert.equal(failed?.status, 'failed');
        assert.equal(failed?.lastError, 'kill failed');
    });

    it('does not imply ownership of arbitrary external processes', () => {
        const registry = new HeadlessProcessRegistry();
        assert.equal(registry.getLatest(), undefined);
        assert.deepEqual(registry.toJSON(), { latest: undefined });
    });
});

describe('HeadlessControlService', () => {
    it('NodeProcessRunner declares kill as not implemented', () => {
        const runner = new NodeProcessRunner();
        const capabilities = runner.getCapabilities();

        assert.ok(capabilities);
        assert.equal(capabilities.kill.implemented, false);
        assert.equal(
            capabilities.kill.reason,
            'Safe cross-platform process termination is not implemented in NodeProcessRunner yet.'
        );
    });

    it('start returns safe-stub by default', async () => {
        const service = new HeadlessControlService();

        const result = await service.start();
        assert.equal(result.action, 'start');
        assert.equal(result.ok, false);
        assert.equal(result.implemented, false);
        assert.equal(result.backend.kind, 'safe-stub');
    });

    it('start with request-body dryRun=true does not spawn and does not record process', async () => {
        const runner = new FakeProcessRunner({ ok: true, processId: 9876 });
        const registry = new HeadlessProcessRegistry();
        const service = new HeadlessControlService({ config: localConfig, processRunner: runner, processRegistry: registry });

        const result = await service.start({
            backend: 'local-process',
            command: 'node',
            args: ['./bin/run', 'start'],
            dryRun: true
        });

        assert.equal(result.ok, true);
        assert.equal(result.implemented, true);
        assert.equal(result.dryRun, true);
        assert.equal(result.startPlan?.command, 'node');
        assert.equal(runner.spawnCalls.length, 0);
        assert.equal(registry.getLatest(), undefined);
    });

    it('start with request body dryRun=false uses fake runner and records process', async () => {
        const runner = new FakeProcessRunner({ ok: true, processId: 9876 });
        const registry = new HeadlessProcessRegistry();
        const service = new HeadlessControlService({ config: localConfig, processRunner: runner, processRegistry: registry });

        const result = await service.start({
            backend: 'local-process',
            command: 'node',
            args: ['./bin/run', 'start'],
            dryRun: false
        });

        assert.equal(result.ok, true);
        assert.equal(result.implemented, true);
        assert.equal(result.backend.kind, 'local-process');
        assert.equal(result.process?.processId, 9876);
        assert.equal(registry.getLatest()?.processId, 9876);
        assert.equal(runner.spawnCalls.length, 1);
    });

    it('start with env local-process config uses fake runner', async () => {
        const runner = new FakeProcessRunner({ ok: true, processId: 3333 });
        const registry = new HeadlessProcessRegistry();
        const service = new HeadlessControlService({ config: localConfig, processRunner: runner, processRegistry: registry });

        const result = await service.start();

        assert.equal(result.ok, true);
        assert.equal(runner.spawnCalls.length, 1);
        assert.equal(registry.getLatest()?.processId, 3333);
    });

    it('start with invalid config returns validation error', async () => {
        const runner = new FakeProcessRunner();
        const service = new HeadlessControlService({
            processRunner: runner,
            config: {
                ...localConfig,
                validationErrors: ['LAB_ADDON_HEADLESS_ENV_JSON contains invalid JSON.']
            },
            processRegistry: new HeadlessProcessRegistry()
        });

        const result = await service.start();
        assert.equal(result.ok, false);
        assert.equal(result.implemented, false);
        assert.equal(result.validationErrors?.length, 1);
        assert.equal(runner.spawnCalls.length, 0);
    });

    it('ProcessRunner receives cwd and env overrides', async () => {
        const runner = new FakeProcessRunner({ ok: true, processId: 7777 });
        const service = new HeadlessControlService({
            config: localConfig,
            processRunner: runner,
            processRegistry: new HeadlessProcessRegistry()
        });

        await service.start({
            backend: 'local-process',
            command: 'node',
            args: ['./bin/run', 'start'],
            workingDir: 'C:/repo/official',
            env: { NODE_ENV: 'production', CUSTOM_FLAG: '1' },
            dryRun: false
        });

        assert.equal(runner.spawnCalls.length, 1);
        assert.equal(runner.spawnCalls[0].cwd, 'C:/repo/official');
        assert.deepEqual(runner.spawnCalls[0].env, { NODE_ENV: 'production', CUSTOM_FLAG: '1' });
    });

    it('stop with no registered addon process returns safe non-action', async () => {
        const service = new HeadlessControlService({
            config: localConfig,
            processRunner: new FakeProcessRunner(),
            processRegistry: new HeadlessProcessRegistry()
        });

        const result = await service.stop();
        assert.equal(result.action, 'stop');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'No addon-started headless process is registered.');
    });

    it('stop does not invoke addon-server scripts and can kill registered process via fake runner', async () => {
        const runner = new FakeProcessRunner({ ok: true, processId: 2222 }, { ok: true, implemented: true });
        const registry = new HeadlessProcessRegistry();
        const service = new HeadlessControlService({ config: localConfig, processRunner: runner, processRegistry: registry });

        await service.start();
        const result = await service.stop();

        assert.equal(result.ok, true);
        assert.equal(runner.killCalls.length, 1);
        assert.equal(runner.spawnCalls.length, 1);
        assert.equal(JSON.stringify(runner.spawnCalls).includes('-UseAddonServer'), false);
    });

    it('recover does not call HTTP endpoints or addon-server scripts', async () => {
        const runner = new FakeProcessRunner({ ok: true, processId: 3333 }, { ok: true, implemented: true });
        const service = new HeadlessControlService({
            config: localConfig,
            processRunner: runner,
            processRegistry: new HeadlessProcessRegistry()
        });

        const result = await service.recover();

        assert.equal(result.action, 'recover');
        assert.equal(result.ok, true);
        assert.equal(runner.spawnCalls.length, 1);
        assert.equal(JSON.stringify(runner.spawnCalls).includes('/headless/start'), false);
        assert.equal(JSON.stringify(runner.spawnCalls).includes('-UseAddonServer'), false);
    });

    it('local-process capabilities with default NodeProcessRunner only implement start', () => {
        const service = new HeadlessControlService({
            config: localConfig,
            processRunner: new NodeProcessRunner(),
            processRegistry: new HeadlessProcessRegistry()
        });

        const capabilities = service.getCapabilities();
        assert.equal(capabilities.start.implemented, true);
        assert.equal(capabilities.stop.implemented, false);
        assert.equal(capabilities.recover.implemented, false);
    });

    it('local-process capabilities with kill-capable fake runner implement start/stop/recover', () => {
        const service = new HeadlessControlService({
            config: localConfig,
            processRunner: new FakeProcessRunner(),
            processRegistry: new HeadlessProcessRegistry()
        });

        const capabilities = service.getCapabilities();
        assert.equal(capabilities.start.implemented, true);
        assert.equal(capabilities.stop.implemented, true);
        assert.equal(capabilities.recover.implemented, true);
    });

    it('stop/recover remain conservative with NodeProcessRunner kill capability false', () => {
        const service = new HeadlessControlService({
            config: localConfig,
            processRunner: new NodeProcessRunner(),
            processRegistry: new HeadlessProcessRegistry()
        });

        const capabilities = service.getCapabilities();
        assert.equal(capabilities.stop.implemented, false);
        assert.equal(capabilities.recover.implemented, false);
        assert.equal(capabilities.backend.canExecuteStart, true);
    });

    it('stop does not call kill when runner capability reports kill as not implemented', async () => {
        const runner = new FakeProcessRunner(
            { ok: true, processId: 4444 },
            { ok: true, implemented: true },
            {
                spawnDetached: { implemented: true },
                kill: { implemented: false, reason: 'kill intentionally unavailable in this runner' }
            }
        );
        const service = new HeadlessControlService({
            config: localConfig,
            processRunner: runner,
            processRegistry: new HeadlessProcessRegistry()
        });

        await service.start();
        const result = await service.stop();

        assert.equal(result.ok, false);
        assert.equal(result.implemented, false);
        assert.equal(result.reason, 'kill intentionally unavailable in this runner');
        assert.equal(runner.killCalls.length, 0);
    });

    it('recover does not call stop/start when stop is unavailable', async () => {
        const runner = new FakeProcessRunner(
            { ok: true, processId: 5555 },
            { ok: true, implemented: true },
            {
                spawnDetached: { implemented: true },
                kill: { implemented: false, reason: 'kill unavailable for recovery' }
            }
        );
        const service = new HeadlessControlService({
            config: localConfig,
            processRunner: runner,
            processRegistry: new HeadlessProcessRegistry()
        });

        const result = await service.recover();

        assert.equal(result.ok, false);
        assert.equal(result.implemented, false);
        assert.equal(result.reason?.includes('stop is not implemented'), true);
        assert.equal(runner.spawnCalls.length, 0);
        assert.equal(runner.killCalls.length, 0);
    });

    it('capabilities include backend strategy information', () => {
        const service = new HeadlessControlService();
        const capabilities = service.getCapabilities();

        assert.equal(capabilities.backend.active, 'safe-stub');
        assert.equal(Array.isArray(capabilities.backend.strategies), true);
        assert.equal(capabilities.backend.strategies.some((strategy) => strategy.kind === 'local-process'), true);
        assert.equal(capabilities.backend.canDryRunStart, true);
    });

    it('regression: no -UseAddonServer appears in any process runner call from HeadlessControlService', async () => {
        const runner = new SpawnOnlyRunner();
        const service = new HeadlessControlService({
            config: localConfig,
            processRunner: runner,
            processRegistry: new HeadlessProcessRegistry()
        });

        await service.start();
        await service.recover();

        const allCallsText = JSON.stringify(runner.spawnCalls);
        assert.equal(allCallsText.includes('-UseAddonServer'), false);
    });
});
