import { spawn } from 'node:child_process';

import {
    DetachedSpawnRequest,
    DetachedSpawnResult,
    ProcessRunnerCapabilities,
    ProcessKillResult,
    ProcessRunner
} from './headless-types';

export class NodeProcessRunner implements ProcessRunner {
    getCapabilities(): ProcessRunnerCapabilities {
        return {
            spawnDetached: { implemented: true },
            kill: {
                implemented: false,
                reason: 'Safe cross-platform process termination is not implemented in NodeProcessRunner yet.'
            }
        };
    }

    async spawnDetached(request: DetachedSpawnRequest): Promise<DetachedSpawnResult> {
        return new Promise((resolve) => {
            try {
                const child = spawn(request.command, request.args, {
                    detached: true,
                    stdio: 'ignore',
                    windowsHide: true,
                    cwd: request.cwd,
                    env: {
                        ...process.env,
                        ...(request.env ?? {})
                    }
                });

                child.once('error', (error) => {
                    resolve({
                        ok: false,
                        reason: error.message
                    });
                });

                child.once('spawn', () => {
                    child.unref();
                    resolve({
                        ok: true,
                        processId: child.pid
                    });
                });
            } catch (error) {
                const typed = error as Error;
                resolve({
                    ok: false,
                    reason: typed.message
                });
            }
        });
    }

    async kill(_processId: number): Promise<ProcessKillResult> {
        return {
            ok: false,
            implemented: false,
            reason: this.getCapabilities().kill.reason
        };
    }
}
