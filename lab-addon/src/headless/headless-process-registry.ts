export type HeadlessProcessStatus = 'starting' | 'running' | 'stopped' | 'failed' | 'unknown';

export interface HeadlessProcessRecord {
    processId?: number;
    command: string;
    args: string[];
    startedAt: string;
    status: HeadlessProcessStatus;
    lastError?: string;
    metadata?: Record<string, unknown>;
}

export class HeadlessProcessRegistry {
    private latest?: HeadlessProcessRecord;

    getLatest(): HeadlessProcessRecord | undefined {
        return this.latest ? { ...this.latest, args: [...this.latest.args] } : undefined;
    }

    recordStarted(input: {
        processId?: number;
        command: string;
        args: string[];
        status?: HeadlessProcessStatus;
        metadata?: Record<string, unknown>;
    }): HeadlessProcessRecord {
        this.latest = {
            processId: input.processId,
            command: input.command,
            args: [...input.args],
            startedAt: new Date().toISOString(),
            status: input.status ?? 'running',
            metadata: {
                owner: 'lab-addon-headless',
                ...(input.metadata ?? {})
            }
        };

        return this.getLatest()!;
    }

    recordStopped(input?: { metadata?: Record<string, unknown> }): HeadlessProcessRecord | undefined {
        if (!this.latest) {
            return undefined;
        }

        this.latest = {
            ...this.latest,
            status: 'stopped',
            metadata: {
                ...(this.latest.metadata ?? {}),
                ...(input?.metadata ?? {})
            }
        };

        return this.getLatest();
    }

    recordFailed(error: string): HeadlessProcessRecord | undefined {
        if (!this.latest) {
            return undefined;
        }

        this.latest = {
            ...this.latest,
            status: 'failed',
            lastError: error
        };

        return this.getLatest();
    }

    clear() {
        this.latest = undefined;
    }

    toJSON() {
        return {
            latest: this.getLatest()
        };
    }
}
