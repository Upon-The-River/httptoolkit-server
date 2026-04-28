import * as fs from 'fs';

import { NormalizedExportRecord } from './export-types';
import { ExportRuntimePathOverrides, ExportRuntimePaths, resolveExportRuntimePaths } from './export-runtime-paths';

export interface ExportOutputStatus extends ExportRuntimePaths {
    exists: boolean;
    sizeBytes: number;
}

export interface ExportFileSinkOptions {
    truncateExisting?: boolean;
}

export class ExportFileSink {
    readonly paths: ExportRuntimePaths;

    constructor(pathOverrides: ExportRuntimePathOverrides = {}, options: ExportFileSinkOptions = {}) {
        this.paths = resolveExportRuntimePaths(pathOverrides);

        if (options.truncateExisting) {
            fs.mkdirSync(this.paths.exportDir, { recursive: true });
            fs.writeFileSync(this.paths.jsonlPath, '', 'utf8');
        }
    }

    append(record: NormalizedExportRecord): string {
        fs.mkdirSync(this.paths.exportDir, { recursive: true });
        fs.appendFileSync(this.paths.jsonlPath, `${JSON.stringify(record)}\n`, 'utf8');
        return this.paths.jsonlPath;
    }

    getOutputStatus(): ExportOutputStatus {
        const stats = fs.existsSync(this.paths.jsonlPath)
            ? fs.statSync(this.paths.jsonlPath)
            : undefined;

        return {
            ...this.paths,
            exists: Boolean(stats),
            sizeBytes: stats?.size ?? 0
        };
    }

    readRecordsForTests(): NormalizedExportRecord[] {
        return this.readRecordsSinceOffsetForTests(0);
    }

    readRecordsSinceOffsetForTests(startOffsetBytes: number): NormalizedExportRecord[] {
        if (!fs.existsSync(this.paths.jsonlPath)) return [];

        const stats = fs.statSync(this.paths.jsonlPath);
        const boundedStart = Math.max(0, Math.min(startOffsetBytes, stats.size));
        const content = fs.readFileSync(this.paths.jsonlPath).subarray(boundedStart).toString('utf8');
        return content
            .split(/\r?\n/)
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line) as NormalizedExportRecord);
    }
}
