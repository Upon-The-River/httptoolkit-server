import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ProcessRunRequest, ProcessRunResult, ProcessRunner } from './headless-types';

const execFileAsync = promisify(execFile);

export class NodeProcessRunner implements ProcessRunner {
    async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
        try {
            const result = await execFileAsync(request.command, request.args, {
                timeout: request.timeoutMs ?? 30000,
                windowsHide: true,
                maxBuffer: 1024 * 1024
            });

            return {
                exitCode: 0,
                stdout: result.stdout ?? '',
                stderr: result.stderr ?? ''
            };
        } catch (error) {
            const typed = error as NodeJS.ErrnoException & {
                code?: number | string;
                stdout?: string;
                stderr?: string;
            };

            const exitCode = typeof typed.code === 'number' ? typed.code : 1;
            return {
                exitCode,
                stdout: typed.stdout ?? '',
                stderr: typed.stderr ?? typed.message
            };
        }
    }
}
