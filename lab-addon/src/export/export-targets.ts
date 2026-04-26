import path from 'node:path';
import { readFile } from 'node:fs/promises';

import { ExportTargetsConfig, ExportTargetRule } from './export-types';

const DEFAULT_TARGETS_PATH = path.resolve(__dirname, '..', '..', 'config', 'live-export-targets.json');

const normalizeRule = (rawRule: Partial<ExportTargetRule>, index: number): ExportTargetRule => ({
    name: rawRule.name?.trim() || `target-${index + 1}`,
    methods: rawRule.methods?.map((method) => method.toUpperCase()),
    urlIncludes: rawRule.urlIncludes,
    urlRegex: rawRule.urlRegex,
    statusCodes: rawRule.statusCodes
});

export async function loadExportTargetsConfig(configPath = DEFAULT_TARGETS_PATH): Promise<ExportTargetsConfig> {
    const rawJson = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(rawJson) as Partial<ExportTargetsConfig>;

    const enabled = parsed.enabled !== false;
    const targets = Array.isArray(parsed.targets)
        ? parsed.targets.map((rule, index) => normalizeRule(rule, index))
        : [];

    return { enabled, targets };
}
