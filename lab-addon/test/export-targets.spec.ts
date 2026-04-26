import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

import { loadExportTargetsConfig } from '../src/export/export-targets';

describe('export targets config loading', () => {
    it('loads and normalizes target configuration from JSON file', async () => {
        const tempDir = await mkdtemp(path.join(tmpdir(), 'lab-addon-export-targets-'));
        const configPath = path.join(tempDir, 'live-export-targets.json');

        await writeFile(configPath, JSON.stringify({
            enabled: true,
            targets: [
                {
                    name: 'sample-target',
                    methods: ['get', 'post'],
                    urlIncludes: ['example.com'],
                    statusCodes: [200]
                }
            ]
        }));

        const loaded = await loadExportTargetsConfig(configPath);
        assert.equal(loaded.enabled, true);
        assert.equal(loaded.targets.length, 1);
        assert.deepEqual(loaded.targets[0].methods, ['GET', 'POST']);
        assert.equal(loaded.targets[0].name, 'sample-target');
    });
});
