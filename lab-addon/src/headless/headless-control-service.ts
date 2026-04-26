import * as path from 'path';

import {
    HeadlessActionResult,
    HeadlessCapabilities,
    HeadlessControlApi,
    ProcessRunner
} from './headless-types';
import { NodeProcessRunner } from './headless-process-service';

export interface HeadlessControlServiceOptions {
    processRunner?: ProcessRunner;
    scriptsRoot?: string;
    powershellCommand?: string;
}

export class HeadlessControlService implements HeadlessControlApi {
    private readonly processRunner: ProcessRunner;
    private readonly scriptsRoot: string;
    private readonly powershellCommand: string;

    constructor(options: HeadlessControlServiceOptions = {}) {
        this.processRunner = options.processRunner ?? new NodeProcessRunner();
        this.scriptsRoot = options.scriptsRoot ?? path.resolve(__dirname, '../../scripts/android');
        this.powershellCommand = options.powershellCommand ?? 'powershell';
    }

    async start(): Promise<HeadlessActionResult> {
        return {
            ok: false,
            implemented: false,
            action: 'start',
            reason: 'Addon headless start orchestration is not fully migrated yet.'
        };
    }

    async stop(options: { deviceId?: string } = {}): Promise<HeadlessActionResult> {
        return this.runScriptAction('stop', 'stop-headless.ps1', options);
    }

    async recover(options: { deviceId?: string } = {}): Promise<HeadlessActionResult> {
        return this.runScriptAction('recover', 'recover-headless.ps1', options);
    }

    getCapabilities(): HeadlessCapabilities {
        return {
            health: { implemented: true, mutatesDeviceState: false },
            start: {
                implemented: false,
                mutatesDeviceState: false,
                reason: 'Addon headless start orchestration is not fully migrated yet.'
            },
            stop: { implemented: true, mutatesDeviceState: true },
            recover: { implemented: true, mutatesDeviceState: true }
        };
    }

    private async runScriptAction(
        action: 'stop' | 'recover',
        scriptFile: string,
        options: { deviceId?: string }
    ): Promise<HeadlessActionResult> {
        const scriptPath = path.join(this.scriptsRoot, scriptFile);
        const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-UseAddonServer'];

        if (options.deviceId) {
            args.push('-DeviceId', options.deviceId);
        }

        const output = await this.processRunner.run({
            command: this.powershellCommand,
            args,
            timeoutMs: 120000
        });

        return {
            ok: output.exitCode === 0,
            implemented: true,
            action,
            command: {
                command: this.powershellCommand,
                args
            },
            output
        };
    }
}
