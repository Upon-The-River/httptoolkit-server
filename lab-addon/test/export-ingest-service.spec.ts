import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ExportIngestService } from '../src/export/export-ingest-service';

describe('export ingest service', () => {
    it('normalizes synthetic events into stable JSONL-compatible records', () => {
        const ingestService = new ExportIngestService([
            {
                name: 'example-target',
                methods: ['GET'],
                urlIncludes: ['example.com'],
                statusCodes: [200]
            }
        ]);

        const record = ingestService.ingest({
            timestamp: '2026-01-02T03:04:05.000Z',
            method: 'GET',
            url: 'https://example.com/api/books',
            statusCode: 200,
            responseHeaders: { 'content-type': 'application/json; charset=utf-8' },
            responseBody: '{"ok":true}'
        });

        assert.equal(record.schemaVersion, 1);
        assert.equal(record.observedAt, '2026-01-02T03:04:05.000Z');
        assert.equal(record.matchedTarget, 'example-target');
        assert.equal(record.contentType, 'application/json; charset=utf-8');
        assert.equal(record.body.encoding, 'utf8');
        assert.equal(typeof record.recordId, 'string');
        assert.equal(record.recordId.length, 16);
    });
});
