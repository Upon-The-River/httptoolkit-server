export type ProofTimestampSource = 'timestamp_ms' | 'ts_ms' | 'time_ms' | 'timestamp' | 'observedAt' | 'sourceObservedAt' | 'ingestedAt' | 'readAt';

export interface ProofTimestampResolution {
    epochMs: number | null;
    source: ProofTimestampSource | null;
    wallClockValid: boolean;
    reason?: string;
}

export interface ResolveProofTimestampOptions {
    allowReadAt?: boolean;
    minObservedAtEpochMs?: number;
}

const DEFAULT_MIN_OBSERVED_AT_EPOCH_MS = Date.UTC(2020, 0, 1);

const parsePositiveNumericTimestamp = (value: unknown): number | null => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
    return value;
};

const parseTimestampField = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        if (value > 1e12) return Math.floor(value);
        if (value >= 1e9) return Math.floor(value * 1000);
        return null;
    }

    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isNaN(parsed) ? null : parsed;
    }

    return null;
};

const parseIsoTimestamp = (value: unknown): number | null => {
    if (typeof value !== 'string') return null;
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
};

export const resolveRecordProofTimestamp = (
    record: Record<string, unknown>,
    options: ResolveProofTimestampOptions = {}
): ProofTimestampResolution => {
    for (const field of ['timestamp_ms', 'ts_ms', 'time_ms'] as const) {
        const epochMs = parsePositiveNumericTimestamp(record[field]);
        if (epochMs !== null) {
            return { epochMs, source: field, wallClockValid: true };
        }
    }

    const timestampEpochMs = parseTimestampField(record.timestamp);
    if (timestampEpochMs !== null) {
        return { epochMs: timestampEpochMs, source: 'timestamp', wallClockValid: true };
    }

    const observedAtWallClockInvalid = record.observedAtWallClockInvalid === true;
    if (!observedAtWallClockInvalid) {
        const minObservedAtEpochMs = options.minObservedAtEpochMs ?? DEFAULT_MIN_OBSERVED_AT_EPOCH_MS;

        for (const field of ['observedAt', 'sourceObservedAt'] as const) {
            const epochMs = parseIsoTimestamp(record[field]);
            if (epochMs !== null && epochMs >= minObservedAtEpochMs) {
                return { epochMs, source: field, wallClockValid: true };
            }
        }
    }

    const ingestedAtEpochMs = parseIsoTimestamp(record.ingestedAt);
    if (ingestedAtEpochMs !== null) {
        return { epochMs: ingestedAtEpochMs, source: 'ingestedAt', wallClockValid: true };
    }

    if (options.allowReadAt) {
        const readAtEpochMs = parseIsoTimestamp(record.__readAt) ?? parseIsoTimestamp(record.readAt);
        if (readAtEpochMs !== null) {
            return { epochMs: readAtEpochMs, source: 'readAt', wallClockValid: true, reason: 'proof_time_is_read_time_not_ingest_time' };
        }
    }

    if (observedAtWallClockInvalid) {
        return {
            epochMs: null,
            source: null,
            wallClockValid: false,
            reason: 'source-observed-at-wall-clock-invalid;no-usable-proof-timestamp'
        };
    }

    return { epochMs: null, source: null, wallClockValid: false, reason: 'no-usable-proof-timestamp' };
};
