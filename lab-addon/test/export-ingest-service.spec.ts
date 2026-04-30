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
        assert.equal(ingestResult.match.matched, true);
        assert.equal(ingestResult.match.targetName, 'example-target');
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
        assert.equal(ingestResult.match.matched, false);
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

    it('export-file-sink readRecordsSinceOffset tolerates malformed trailing JSONL line', async () => {
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

        await fs.appendFile(sink.paths.jsonlPath, '{"broken":', 'utf8');

        const records = sink.readRecordsSinceOffset(0);
        assert.equal(records.length, 1);
        assert.equal(records[0].recordId, 'record-1');
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
        assert.equal(ingestResult.match.matched, true);
        assert.equal(ingestResult.skippedPersistenceReason, undefined);

        const records = sink.readRecordsForTests();
        assert.equal(records.length, 1);
        assert.equal(records[0].url, 'https://example.com/api/books');
    });

    it('does not persist unmatched events when persist=true and returns skip reason', async () => {
        const runtimeRoot = await createTempRuntimeRoot();
        const sink = new ExportFileSink({ runtimeRoot });
        const ingestService = new ExportIngestService([
            {
                name: 'example-target',
                methods: ['GET'],
                urlIncludes: ['example.com/api/books'],
                statusCodes: [200]
            }
        ], sink);

        const ingestResult = ingestService.ingest({
            observedAt: '2026-04-27T00:00:00.000Z',
            method: 'GET',
            url: 'https://example.com/api/other',
            statusCode: 200,
            source: 'official-core-hook'
        }, { persist: true });

        assert.equal(ingestResult.match.matched, false);
        assert.equal(ingestResult.persisted, false);
        assert.equal(ingestResult.skippedPersistenceReason, 'no-target-matched');
        assert.deepEqual(sink.readRecordsForTests(), []);
    });

    it('supports official-core-hook-shaped matched events persisting to JSONL', async () => {
        const runtimeRoot = await createTempRuntimeRoot();
        const sink = new ExportFileSink({ runtimeRoot });
        const ingestService = new ExportIngestService([
            {
                name: 'core-hook-target',
                methods: ['POST'],
                urlIncludes: ['example.com/live'],
                statusCodes: [201]
            }
        ], sink);

        const ingestResult = ingestService.ingest({
            observedAt: '2026-04-27T00:00:00.000Z',
            method: 'post',
            url: 'https://example.com/live',
            statusCode: 201,
            contentType: 'application/json',
            bodyText: '{"ok":true}',
            source: 'official-core-hook'
        }, { persist: true });

        assert.equal(ingestResult.match.matched, true);
        assert.equal(ingestResult.persisted, true);
        assert.equal(ingestResult.record.matchedTarget, 'core-hook-target');
        assert.equal(sink.readRecordsForTests().length, 1);
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
        assert.equal(omittedResult.match.matched, false);
        assert.equal(falseResult.match.matched, false);

        assert.deepEqual(sink.readRecordsForTests(), []);
    });
});


describe('export runtime path env resolution', () => {
    const addonRoot = path.resolve(__dirname, '..');

    const withEnv = <T>(env: Record<string, string | undefined>, run: () => T): T => {
        const previous = {
            HTK_LAB_ADDON_RUNTIME_ROOT: process.env.HTK_LAB_ADDON_RUNTIME_ROOT,
            HTK_LAB_ADDON_EXPORT_DIR: process.env.HTK_LAB_ADDON_EXPORT_DIR,
            HTK_LAB_ADDON_EXPORT_JSONL_PATH: process.env.HTK_LAB_ADDON_EXPORT_JSONL_PATH
        };

        const apply = (key: keyof typeof previous, value: string | undefined) => {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        };

        apply('HTK_LAB_ADDON_RUNTIME_ROOT', env.HTK_LAB_ADDON_RUNTIME_ROOT);
        apply('HTK_LAB_ADDON_EXPORT_DIR', env.HTK_LAB_ADDON_EXPORT_DIR);
        apply('HTK_LAB_ADDON_EXPORT_JSONL_PATH', env.HTK_LAB_ADDON_EXPORT_JSONL_PATH);

        try {
            return run();
        } finally {
            apply('HTK_LAB_ADDON_RUNTIME_ROOT', previous.HTK_LAB_ADDON_RUNTIME_ROOT);
            apply('HTK_LAB_ADDON_EXPORT_DIR', previous.HTK_LAB_ADDON_EXPORT_DIR);
            apply('HTK_LAB_ADDON_EXPORT_JSONL_PATH', previous.HTK_LAB_ADDON_EXPORT_JSONL_PATH);
        }
    };

    it('uses env runtime root when no override is provided', () => {
        const resolved = withEnv({
            HTK_LAB_ADDON_RUNTIME_ROOT: 'runtime-from-env',
            HTK_LAB_ADDON_EXPORT_DIR: undefined,
            HTK_LAB_ADDON_EXPORT_JSONL_PATH: undefined
        }, () => resolveExportRuntimePaths());

        assert.equal(resolved.runtimeRoot, path.resolve(addonRoot, 'runtime-from-env'));
        assert.equal(resolved.exportDir, path.resolve(addonRoot, 'runtime-from-env', 'exports'));
        assert.equal(resolved.jsonlPath, path.resolve(addonRoot, 'runtime-from-env', 'exports', 'session_hits.jsonl'));
    });

    it('explicit constructor override beats env values', () => {
        const resolved = withEnv({
            HTK_LAB_ADDON_RUNTIME_ROOT: 'runtime-from-env',
            HTK_LAB_ADDON_EXPORT_DIR: 'exports-from-env',
            HTK_LAB_ADDON_EXPORT_JSONL_PATH: 'jsonl-from-env/session_hits.jsonl'
        }, () => resolveExportRuntimePaths({ runtimeRoot: 'runtime-from-override' }));

        assert.equal(resolved.runtimeRoot, path.resolve(addonRoot, 'runtime-from-override'));
    });

    it('export dir env produces jsonlPath under export dir when jsonl env is absent', () => {
        const resolved = withEnv({
            HTK_LAB_ADDON_RUNTIME_ROOT: undefined,
            HTK_LAB_ADDON_EXPORT_DIR: 'exports-from-env',
            HTK_LAB_ADDON_EXPORT_JSONL_PATH: undefined
        }, () => resolveExportRuntimePaths());

        assert.equal(resolved.exportDir, path.resolve(addonRoot, 'exports-from-env'));
        assert.equal(resolved.jsonlPath, path.resolve(addonRoot, 'exports-from-env', 'session_hits.jsonl'));
    });

    it('jsonl path env beats export dir env', () => {
        const resolved = withEnv({
            HTK_LAB_ADDON_RUNTIME_ROOT: undefined,
            HTK_LAB_ADDON_EXPORT_DIR: 'exports-from-env',
            HTK_LAB_ADDON_EXPORT_JSONL_PATH: 'records-from-env/capture.jsonl'
        }, () => resolveExportRuntimePaths());

        assert.equal(resolved.exportDir, path.resolve(addonRoot, 'exports-from-env'));
        assert.equal(resolved.jsonlPath, path.resolve(addonRoot, 'records-from-env', 'capture.jsonl'));
    });
});
