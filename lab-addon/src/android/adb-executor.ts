import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const normalizeValue = (value: string) => {
    const normalized = value.trim();
    return normalized.length === 0 ? null : normalized;
};

export interface AdbExecutor {
    shell(command: string[], options?: { deviceId?: string, timeoutMs?: number }): Promise<string>;
    listOnlineDevices(): Promise<string[]>;
}

export class SystemAdbExecutor implements AdbExecutor {
    constructor(private readonly adbBinary = 'adb') {}

    async shell(command: string[], options: { deviceId?: string, timeoutMs?: number } = {}): Promise<string> {
        const args = [
            ...(options.deviceId ? ['-s', options.deviceId] : []),
            'shell',
            ...command
        ];

        const { stdout, stderr } = await execFileAsync(this.adbBinary, args, {
            timeout: options.timeoutMs ?? 10000,
            windowsHide: true,
            maxBuffer: 1024 * 1024
        });

        const combinedOutput = `${stdout ?? ''}${stderr ?? ''}`.trim();
        return combinedOutput;
    }

    async listOnlineDevices(): Promise<string[]> {
        const { stdout } = await execFileAsync(this.adbBinary, ['devices'], {
            timeout: 10000,
            windowsHide: true,
            maxBuffer: 1024 * 1024
        });

        return stdout
            .split(/\r?\n/)
            .slice(1)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => line.split(/\s+/))
            .filter((parts) => parts.length >= 2 && parts[1] === 'device')
            .map((parts) => parts[0]);
    }
}

export function parseAndroidSetting(value: string): string | null {
    if (normalizeValue(value) === null) return null;
    if (value.trim() === 'null') return null;
    return value.trim();
}
