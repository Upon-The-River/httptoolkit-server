import {
    allHeadlessBackendStrategies,
    localProcessStrategy,
    safeStubStrategy
} from './headless-backend-strategy';
import { HeadlessConfig, loadHeadlessConfig } from './headless-config';
import { NodeProcessRunner } from './headless-process-service';
import { HeadlessProcessRegistry } from './headless-process-registry';
import {
    HeadlessActionResult,
    HeadlessCapabilities,
    HeadlessControlApi,
    ProcessRunner
} from './headless-types';

export interface HeadlessControlServiceOptions {
    processRunner?: ProcessRunner;
    config?: HeadlessConfig;
    processRegistry?: HeadlessProcessRegistry;
}

const START_STUB_REASON = 'Addon headless start orchestration is not fully migrated yet.';
const STOP_STUB_REASON = 'Stop is intentionally stubbed to avoid recursive addon-server script calls.';
const RECOVER_STUB_REASON = 'Recover is intentionally stubbed to avoid recursive addon-server script calls.';
const NO_REGISTERED_PROCESS_REASON = 'No addon-started headless process is registered.';

export class HeadlessControlService implements HeadlessControlApi {
    private readonly processRunner: ProcessRunner;
    private readonly config: HeadlessConfig;
    private readonly processRegistry: HeadlessProcessRegistry;

    constructor(options: HeadlessControlServiceOptions = {}) {
        this.processRunner = options.processRunner ?? new NodeProcessRunner();
        this.config = options.config ?? loadHeadlessConfig();
        this.processRegistry = options.processRegistry ?? new HeadlessProcessRegistry();
    }

    async start(): Promise<HeadlessActionResult> {
        if (this.config.backend !== 'local-process' || !this.config.startCommand) {
            return {
                ok: false,
                implemented: false,
                action: 'start',
                backend: safeStubStrategy,
                reason: START_STUB_REASON
            };
        }

        const spawnResult = await this.processRunner.spawnDetached({
            command: this.config.startCommand,
            args: this.config.startArgs
        });

        if (!spawnResult.ok) {
            const failedRecord = this.processRegistry.recordStarted({
                command: this.config.startCommand,
                args: this.config.startArgs,
                status: 'failed',
                metadata: { backend: 'local-process' }
            });
            this.processRegistry.recordFailed(spawnResult.reason ?? 'spawn failed');
            return {
                ok: false,
                implemented: true,
                action: 'start',
                backend: localProcessStrategy,
                reason: spawnResult.reason ?? 'Failed to start local process backend.',
                process: failedRecord
            };
        }

        const process = this.processRegistry.recordStarted({
            processId: spawnResult.processId,
            command: this.config.startCommand,
            args: this.config.startArgs,
            status: spawnResult.processId ? 'running' : 'unknown',
            metadata: { backend: 'local-process' }
        });

        return {
            ok: true,
            implemented: true,
            action: 'start',
            backend: localProcessStrategy,
            process
        };
    }

    async stop(): Promise<HeadlessActionResult> {
        if (this.config.backend !== 'local-process') {
            return {
                ok: false,
                implemented: false,
                action: 'stop',
                backend: safeStubStrategy,
                reason: STOP_STUB_REASON
            };
        }

        const latest = this.processRegistry.getLatest();
        if (!latest) {
            return {
                ok: false,
                implemented: true,
                action: 'stop',
                backend: localProcessStrategy,
                reason: NO_REGISTERED_PROCESS_REASON
            };
        }

        if (!latest.processId) {
            return {
                ok: false,
                implemented: true,
                action: 'stop',
                backend: localProcessStrategy,
                reason: 'Registered addon process has no processId; safe stop skipped.',
                process: latest
            };
        }

        if (!this.processRunner.kill) {
            return {
                ok: false,
                implemented: false,
                action: 'stop',
                backend: localProcessStrategy,
                reason: 'Process kill is not available in the configured process runner.',
                process: latest
            };
        }

        const killResult = await this.processRunner.kill(latest.processId);
        if (!killResult.ok) {
            this.processRegistry.recordFailed(killResult.reason ?? 'Kill failed.');
            return {
                ok: false,
                implemented: killResult.implemented,
                action: 'stop',
                backend: localProcessStrategy,
                reason: killResult.reason ?? 'Kill failed.',
                process: this.processRegistry.getLatest()
            };
        }

        const stopped = this.processRegistry.recordStopped({ metadata: { stoppedBy: 'headless-control-service' } });
        return {
            ok: true,
            implemented: true,
            action: 'stop',
            backend: localProcessStrategy,
            process: stopped
        };
    }

    async recover(): Promise<HeadlessActionResult> {
        if (this.config.backend !== 'local-process' || !this.config.startCommand) {
            return {
                ok: false,
                implemented: false,
                action: 'recover',
                backend: safeStubStrategy,
                reason: RECOVER_STUB_REASON
            };
        }

        const stopResult = await this.stop();
        if (!stopResult.ok && stopResult.reason !== NO_REGISTERED_PROCESS_REASON) {
            return {
                ok: false,
                implemented: stopResult.implemented,
                action: 'recover',
                backend: localProcessStrategy,
                reason: `Recover stop phase failed: ${stopResult.reason ?? 'unknown reason'}`,
                process: stopResult.process
            };
        }

        const startResult = await this.start();
        if (!startResult.ok) {
            return {
                ok: false,
                implemented: startResult.implemented,
                action: 'recover',
                backend: localProcessStrategy,
                reason: `Recover start phase failed: ${startResult.reason ?? 'unknown reason'}`,
                process: startResult.process
            };
        }

        return {
            ok: true,
            implemented: true,
            action: 'recover',
            backend: localProcessStrategy,
            process: startResult.process
        };
    }

    getCapabilities(): HeadlessCapabilities {
        const activeStrategy = this.config.backend === 'local-process' && this.config.startCommand
            ? localProcessStrategy
            : safeStubStrategy;

        const startImplemented = activeStrategy.kind === 'local-process';
        const stopImplemented = activeStrategy.kind === 'local-process' && Boolean(this.processRunner.kill);
        const recoverImplemented = startImplemented && stopImplemented;

        return {
            health: { implemented: true, mutatesDeviceState: false },
            start: {
                implemented: startImplemented,
                mutatesDeviceState: false,
                ...(startImplemented ? {} : { reason: START_STUB_REASON })
            },
            stop: {
                implemented: stopImplemented,
                mutatesDeviceState: false,
                ...(stopImplemented ? {} : { reason: STOP_STUB_REASON })
            },
            recover: {
                implemented: recoverImplemented,
                mutatesDeviceState: false,
                ...(recoverImplemented ? {} : { reason: RECOVER_STUB_REASON })
            },
            backend: {
                active: activeStrategy.kind,
                strategies: allHeadlessBackendStrategies,
                startCommandConfigured: Boolean(this.config.startCommand)
            }
        };
    }
}
