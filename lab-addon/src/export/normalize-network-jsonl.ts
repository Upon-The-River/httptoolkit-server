import * as fs from 'node:fs';
import * as readline from 'node:readline';

import { normalizeNetworkEvent } from './normalize-network-event';

export interface NormalizeNetworkJsonlOptions {
    inputPath: string;
    outputPath: string;
    qidianOutputPath?: string;
    maxRecords?: number;
    append?: boolean;
    sinceBytes?: number;
    includeSamples?: boolean;
}

export async function normalizeNetworkJsonl(options: NormalizeNetworkJsonlOptions) {
    const warnings: string[] = [];
    const endpointCounts: Record<string, number> = {};
    const summary = {
        inputPath: options.inputPath,
        outputPath: options.outputPath,
        qidianOutputPath: options.qidianOutputPath,
        recordsRead: 0,
        recordsWritten: 0,
        qidianRecordsWritten: 0,
        malformedLines: 0,
        mojibakeLikelyCount: 0,
        repairAppliedCount: 0,
        parseJsonOkCount: 0,
        repairedJsonOkCount: 0,
        endpointCounts,
        warnings
    };

    fs.mkdirSync(require('node:path').dirname(options.outputPath), { recursive: true });
    if (options.qidianOutputPath) fs.mkdirSync(require('node:path').dirname(options.qidianOutputPath), { recursive: true });

    const outStream = fs.createWriteStream(options.outputPath, { flags: options.append ? 'a' : 'w' });
    const qidianStream = options.qidianOutputPath
        ? fs.createWriteStream(options.qidianOutputPath, { flags: options.append ? 'a' : 'w' })
        : undefined;

    const input = fs.createReadStream(options.inputPath, options.sinceBytes ? { start: options.sinceBytes } : undefined);
    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    for await (const line of rl) {
        if (options.maxRecords && summary.recordsRead >= options.maxRecords) break;
        if (!line.trim()) continue;
        summary.recordsRead += 1;

        try {
            const parsed = JSON.parse(line);
            const normalized = normalizeNetworkEvent(parsed, options.includeSamples);
            outStream.write(`${JSON.stringify(normalized)}\n`);
            summary.recordsWritten += 1;
            endpointCounts[normalized.qidian.endpointKey] = (endpointCounts[normalized.qidian.endpointKey] ?? 0) + 1;
            if (normalized.body.mojibakeLikely) summary.mojibakeLikelyCount += 1;
            if (normalized.body.repairApplied) summary.repairAppliedCount += 1;
            if (normalized.body.parseJsonOk) summary.parseJsonOkCount += 1;
            if (normalized.body.repairedJsonOk) summary.repairedJsonOkCount += 1;
            if (normalized.qidian.isQidian && qidianStream) {
                qidianStream.write(`${JSON.stringify(normalized)}\n`);
                summary.qidianRecordsWritten += 1;
            }
            if (normalized.warnings.length) warnings.push(...normalized.warnings);
        } catch {
            summary.malformedLines += 1;
        }
    }

    outStream.end();
    qidianStream?.end();
    summary.warnings = Array.from(new Set(warnings));
    return summary;
}
