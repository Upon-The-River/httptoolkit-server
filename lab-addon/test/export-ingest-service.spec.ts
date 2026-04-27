import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { ExportFileSink } from '../src/export/export-file-sink';
import { ExportIngestService } from '../src/export/export-ingest-service';
import { resolveExportRuntimePaths } from '../src/export/export-runtime-paths';

const tempDirs: string[] = [];

const createTempRuntimeRoot = async (): Promise<string> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-addon-export-'));
    tempDirs.push(tempRoot);
    return tempRoot;
};

afterEach(async () => {
    await Promise.all(tempDirs.splice(0, tempDirs.length).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
});

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

        const ingestResult = ingestService.ingest({
            timestamp: '2026-01-02T03:04:05.000Z',
            method: 'GET',
            url: 'https://example.com/api/books',
            statusCode: 200,
            responseHeaders: { 'content-type': 'application/json; charset=utf-8' },
            responseBody: '{"ok":true}'
        });

        const record = ingestResult.record;
        assert.equal(record.schemaVersion, 1);
        assert.equal(record.observedAt, '2026-01-02T03:04:05.000Z');
        assert.equal(record.matchedTarget, 'example-target');
        assert.equal(record.contentType, 'application/json; charset=utf-8');
        assert.equal(record.body.encoding, 'utf8');
        assert.equal(typeof record.recordId, 'string');
        assert.equal(record.recordId.length, 16);
        assert.equal(ingestResult.persisted, false);
    });


    it('supports official core hook event shape fields', () => {
        const ingestService = new ExportIngestService([]);

        const ingestResult = ingestService.ingest({
            observedAt: '2026-04-27T00:00:00.000Z',
            method: 'post',
            url: 'https://example.com/binary',
            statusCode: 201,
            contentType: 'application/octet-stream',
            bodyBase64: Buffer.from([0, 1, 2, 3]).toString('base64'),
            source: 'official-core-hook'
        });

        assert.equal(ingestResult.record.observedAt, '2026-04-27T00:00:00.000Z');
        assert.equal(ingestResult.record.method, 'POST');
        assert.equal(ingestResult.record.contentType, 'application/octet-stream');
        assert.equal(ingestResult.record.body.encoding, 'base64');
    });

    it('export-file-sink appends JSONL records without overwriting existing lines', async () => {
        const runtimeRoot = await createTempRuntimeRoot();
        const sink = new ExportFileSink({ runtimeRoot });

        sink.append({
            schemaVersion: 1,
            recordId: 'record-1',
            observedAt: '2026-01-01T00:00:00.000Z',
            method: 'GET',
            url: 'https://example.com/a',
            statusCode: 200,
            contentType: 'application/json',
            body: { inline: '{}', encoding: 'utf8' }
        });

        sink.append({
            schemaVersion: 1,
            recordId: 'record-2',
            observedAt: '2026-01-01T00:00:01.000Z',
            method: 'POST',
            url: 'https://example.com/b',
            statusCode: 201,
            contentType: 'application/json',
            body: { inline: '{"ok":true}', encoding: 'utf8' }
        });

        const records = sink.readRecordsForTests();
        assert.equal(records.length, 2);
        assert.equal(records[0].recordId, 'record-1');
        assert.equal(records[1].recordId, 'record-2');
    });

    it('export-file-sink creates missing runtime/export directories', async () => {
        const runtimeRoot = await createTempRuntimeRoot();
        const paths = resolveExportRuntimePaths({ runtimeRoot });
        await fs.rm(runtimeRoot, { recursive: true, force: true });

        const sink = new ExportFileSink({ runtimeRoot });
        sink.append({
            schemaVersion: 1,
            recordId: 'record-created',
            observedAt: '2026-01-01T00:00:00.000Z',
            method: 'GET',
            url: 'https://example.com/path',
            statusCode: 200,
            contentType: 'application/octet-stream',
            body: { inline: '', encoding: 'utf8' }
        });

        const stat = await fs.stat(paths.jsonlPath);
        assert.ok(stat.isFile());
    });

    it('persists to JSONL when persist=true and returns outputPath', async () => {
        const runtimeRoot = await createTempRuntimeRoot();
        const sink = new ExportFileSink({ runtimeRoot });
        const ingestService = new ExportIngestService([
            {
                name: 'example-target',
                methods: ['GET'],
                urlIncludes: ['example.com'],
                statusCodes: [200]
            }
        ], sink);

        const ingestResult = ingestService.ingest({
            method: 'GET',
            url: 'https://example.com/api/books',
            statusCode: 200
        }, { persist: true });

        assert.equal(ingestResult.persisted, true);
        assert.equal(typeof ingestResult.outputPath, 'string');

        const records = sink.readRecordsForTests();
        assert.equal(records.length, 1);
        assert.equal(records[0].url, 'https://example.com/api/books');
    });

    it('does not persist when persist=false or omitted', async () => {
        const runtimeRoot = await createTempRuntimeRoot();
        const sink = new ExportFileSink({ runtimeRoot });
        const ingestService = new ExportIngestService([], sink);

        const omittedResult = ingestService.ingest({
            method: 'GET',
            url: 'https://example.com/a',
            statusCode: 200
        });

        const falseResult = ingestService.ingest({
            method: 'GET',
            url: 'https://example.com/b',
            statusCode: 200
        }, { persist: false });

        assert.equal(omittedResult.persisted, false);
        assert.equal(falseResult.persisted, false);

        assert.deepEqual(sink.readRecordsForTests(), []);
    });
});
