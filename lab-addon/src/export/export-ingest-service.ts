import { createHash } from 'node:crypto';

import { matchExportEvent } from './export-event-matcher';
import { ExportMatchResult, ExportTargetRule, NormalizedExportRecord, SyntheticHttpEvent } from './export-types';

const getContentType = (headers: Record<string, string> | undefined): string => {
    const contentTypeHeader = Object.entries(headers ?? {})
        .find(([headerName]) => headerName.toLowerCase() === 'content-type');

    return contentTypeHeader?.[1]?.trim() || 'application/octet-stream';
};

const getStableRecordId = (event: SyntheticHttpEvent, observedAt: string): string => {
    return createHash('sha256')
        .update(`${observedAt}|${event.method.toUpperCase()}|${event.url}|${event.statusCode}|${event.responseBody ?? ''}`)
        .digest('hex')
        .slice(0, 16);
};

export class ExportIngestService {

    constructor(private readonly targets: ExportTargetRule[]) {}

    match(event: SyntheticHttpEvent): ExportMatchResult {
        return matchExportEvent(event, this.targets);
    }

    ingest(event: SyntheticHttpEvent): NormalizedExportRecord {
        const observedAt = event.timestamp ?? new Date().toISOString();
        const matchResult = this.match(event);

        return {
            schemaVersion: 1,
            recordId: getStableRecordId(event, observedAt),
            observedAt,
            method: event.method.toUpperCase(),
            url: event.url,
            statusCode: event.statusCode,
            contentType: getContentType(event.responseHeaders),
            body: {
                inline: event.responseBody ?? '',
                encoding: event.responseBodyEncoding ?? 'utf8'
            },
            matchedTarget: matchResult.targetName
        };
    }
}
