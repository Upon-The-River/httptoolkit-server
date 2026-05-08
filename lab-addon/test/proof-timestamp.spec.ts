import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveRecordProofTimestamp } from '../src/export/proof-timestamp';

describe('resolveRecordProofTimestamp', () => {
    it('uses ingestedAt when observedAt fields are marked invalid', () => {
        const record = {
            observedAt: '1970-01-01T00:00:48.322Z',
            sourceObservedAt: '1970-01-01T00:00:48.322Z',
            observedAtWallClockInvalid: true,
            ingestedAt: '2026-05-08T10:16:41.185Z'
        };

        const resolved = resolveRecordProofTimestamp(record);
        assert.equal(resolved.epochMs, Date.parse(record.ingestedAt));
        assert.equal(resolved.source, 'ingestedAt');
        assert.equal(resolved.wallClockValid, true);
    });

    it('forbids observedAt/sourceObservedAt when observedAtWallClockInvalid=true and no ingestedAt', () => {
        const resolved = resolveRecordProofTimestamp({
            observedAt: '1970-01-01T00:00:48.322Z',
            sourceObservedAt: '1970-01-01T00:00:48.322Z',
            observedAtWallClockInvalid: true
        });

        assert.equal(resolved.epochMs, null);
        assert.equal(resolved.wallClockValid, false);
        assert.match(resolved.reason ?? '', /source-observed-at-wall-clock-invalid|no-usable-proof-timestamp/);
    });

    it('uses valid observedAt when not explicitly marked invalid', () => {
        const observedAt = '2026-05-08T10:16:41.185Z';
        const resolved = resolveRecordProofTimestamp({ observedAt });

        assert.equal(resolved.epochMs, Date.parse(observedAt));
        assert.equal(resolved.source, 'observedAt');
    });

    it('prioritizes timestamp_ms over ingestedAt', () => {
        const resolved = resolveRecordProofTimestamp({
            timestamp_ms: 1710000000123,
            ingestedAt: '2026-05-08T10:16:41.185Z'
        });

        assert.equal(resolved.epochMs, 1710000000123);
        assert.equal(resolved.source, 'timestamp_ms');
    });

    it('uses readAt fallback only when enabled', () => {
        const record = { __readAt: '2026-05-08T10:16:41.185Z' };
        const strict = resolveRecordProofTimestamp(record, { allowReadAt: false });
        assert.equal(strict.epochMs, null);

        const fallback = resolveRecordProofTimestamp(record, { allowReadAt: true });
        assert.equal(fallback.epochMs, Date.parse(String(record.__readAt)));
        assert.equal(fallback.source, 'readAt');
    });
});
