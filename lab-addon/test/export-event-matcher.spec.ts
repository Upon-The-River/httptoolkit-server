import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { matchExportEvent } from '../src/export/export-event-matcher';

describe('export event matcher', () => {
    it('matches synthetic event with configured rules', () => {
        const result = matchExportEvent({
            method: 'GET',
            url: 'https://example.com/api/books',
            statusCode: 200
        }, [
            {
                name: 'example-target',
                methods: ['GET'],
                urlIncludes: ['example.com'],
                statusCodes: [200]
            }
        ]);

        assert.equal(result.matched, true);
        assert.equal(result.targetName, 'example-target');
    });

    it('reports non-match when rules do not fit', () => {
        const result = matchExportEvent({
            method: 'POST',
            url: 'https://example.com/api/books',
            statusCode: 500
        }, [
            {
                name: 'example-target',
                methods: ['GET'],
                statusCodes: [200]
            }
        ]);

        assert.equal(result.matched, false);
        assert.deepEqual(result.reasons, ['no-target-matched']);
    });
});
