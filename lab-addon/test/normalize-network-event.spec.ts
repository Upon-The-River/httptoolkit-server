import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { normalizeNetworkEvent } from '../src/export/normalize-network-event';
import { normalizeNetworkJsonl } from '../src/export/normalize-network-jsonl';

const tempDirs: string[] = [];
afterEach(async () => {
    await Promise.all(tempDirs.splice(0, tempDirs.length).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('normalizeNetworkEvent', () => {
    it('extracts host/path/query and metadata', () => {
        const event = normalizeNetworkEvent({ method: 'get', ingestedAt: '2026-05-01T00:00:00.000Z', url: 'https://druidv6.if.qidian.com/argus/api/v1/booklevel/detail?bookId=1&roleId=2', statusCode: 200, contentType: 'application/json' });
        assert.equal(event.host, 'druidv6.if.qidian.com');
        assert.equal(event.path, '/argus/api/v1/booklevel/detail');
        assert.equal(event.query.bookId, '1');
        assert.equal(event.qidian.endpointKey, 'druidv6.argus.booklevel.detail');
        assert.equal(event.eventTimeForSorting, '2026-05-01T00:00:00.000Z');
    });
    it('does not use 1970 observedAt for sorting and marks invalid', () => {
        const event = normalizeNetworkEvent({ observedAt: '1970-01-01T00:21:36.922Z', ingestedAt: '2026-05-01T01:00:00.000Z', sourceObservedAt: '1970-01-01T00:21:36.922Z', url: 'https://www.qidian.com' });
        assert.equal(event.observedAt, '1970-01-01T00:21:36.922Z');
        assert.equal(event.observedAtWallClockInvalid, true);
        assert.equal(event.sourceObservedAt, '1970-01-01T00:21:36.922Z');
        assert.equal(event.eventTimeForSorting, '2026-05-01T01:00:00.000Z');
    });

    it('detects mojibake and emits warning when repair unavailable', () => {
        const event = normalizeNetworkEvent({ url: 'https://www.qidian.com', body: { inline: '{"name":"涔﹀弸"}', encoding: 'utf8' } }, true);
        assert.equal(event.body.mojibakeLikely, true);
        assert.equal(event.body.repairApplied, false);
        assert.equal(event.warnings.includes('gbk-repair-requires-iconv-lite-or-external-decoder'), true);
        assert.equal(event.body.parseJsonOk, true);
    });

    it('does not emit giant body text, only sample/hash metadata', () => {
        const inline = `{"long":"${'a'.repeat(3000)}"}`;
        const event = normalizeNetworkEvent({ url: 'https://www.qidian.com', body: { inline } }, true);
        assert.equal(event.body.sha256.length, 64);
        assert.equal((event.body.repairedTextSample ?? '').length <= 500, true);
    });
});

describe('normalizeNetworkJsonl', () => {
    it('tolerates malformed lines and writes qidian output with endpoint counts', async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'normalize-jsonl-'));
        tempDirs.push(root);
        const inputPath = path.join(root, 'session_hits.jsonl');
        const outputPath = path.join(root, 'normalized_network_events.jsonl');
        const qidianOutputPath = path.join(root, 'qidian_endpoint_events.jsonl');

        const lines = [
            JSON.stringify({ recordId: '1', method: 'GET', url: 'https://druidv6.if.qidian.com/argus/api/v1/booklevel/detail?bookId=1041637443', body: { inline: '{"a":1}' } }),
            JSON.stringify({ recordId: '2', method: 'GET', url: 'https://druidv6.if.qidian.com/argus/api/v1/popup/getlistv3?bookId=1041637443&roleId=81952238930550507', body: { inline: '{"b":"涔﹀弸"}' } }),
            JSON.stringify({ recordId: '3', method: 'GET', url: 'https://druidv6.if.qidian.com/argus/api/v1/bookrole/starinfo?bookId=1041637443&roleId=81952238930550507', body: { inline: '{"c":true}' } }),
            JSON.stringify({ recordId: '4', method: 'GET', url: 'https://druidv6.if.qidian.com/argus/api/v1/bookrole/v2/getroledetails?bookId=1041637443&roleId=81952238930550507', body: { inline: '{"d":[]}' } }),
            '{bad json'
        ];
        await fs.writeFile(inputPath, `${lines.join('\n')}\n`, 'utf8');

        const summary = await normalizeNetworkJsonl({ inputPath, outputPath, qidianOutputPath, includeSamples: true });
        assert.equal(summary.recordsRead, 5);
        assert.equal(summary.recordsWritten, 4);
        assert.equal(summary.qidianRecordsWritten, 4);
        assert.equal(summary.malformedLines, 1);
        assert.equal(summary.endpointCounts['druidv6.argus.booklevel.detail'], 1);
        assert.equal(summary.endpointCounts['druidv6.argus.popup.getlistv3'], 1);
        assert.equal(summary.endpointCounts['druidv6.argus.bookrole.starinfo'], 1);
        assert.equal(summary.endpointCounts['druidv6.argus.bookrole.v2.getroledetails'], 1);
    });
});
