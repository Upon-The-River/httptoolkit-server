import { createHash } from 'node:crypto';

import { matchExportEvent } from './export-event-matcher';
import { ExportMatchResult, ExportTargetRule, NormalizedExportRecord, SyntheticHttpEvent } from './export-types';
import { ExportFileSink } from './export-file-sink';

const getContentType = (headers: Record<string, string> | undefined, fallbackContentType?: string): string => {
    const contentTypeHeader = Object.entries(headers ?? {})
        .find(([headerName]) => headerName.toLowerCase() === 'content-type');

    return contentTypeHeader?.[1]?.trim() || fallbackContentType?.trim() || 'application/octet-stream';
};

const getEventBody = (event: SyntheticHttpEvent): { value: string, encoding: 'utf8' | 'base64' } => {
    if (typeof event.bodyBase64 === 'string') {
        return { value: event.bodyBase64, encoding: 'base64' };
    }

    if (typeof event.responseBody === 'string') {
        return { value: event.responseBody, encoding: event.responseBodyEncoding ?? 'utf8' };
    }

    if (typeof event.bodyText === 'string') {
        return { value: event.bodyText, encoding: 'utf8' };
    }

    return { value: '', encoding: event.responseBodyEncoding ?? 'utf8' };
};

const getStableRecordId = (event: SyntheticHttpEvent, observedAt: string): string => {
    const body = getEventBody(event);

    return createHash('sha256')
        .update(`${observedAt}|${event.method.toUpperCase()}|${event.url}|${event.statusCode}|${body.value}`)
        .digest('hex')
        .slice(0, 16);
};

export interface ExportIngestResult {
    record: NormalizedExportRecord;
    match: ExportMatchResult;
    persisted: boolean;
    outputPath?: string;
    skippedPersistenceReason?: 'no-target-matched';
}

export class ExportIngestService {

    constructor(
        private readonly targets: ExportTargetRule[],
        private readonly fileSink?: ExportFileSink
    ) {}

    match(event: SyntheticHttpEvent): ExportMatchResult {
        return matchExportEvent(event, this.targets);
    }

    canPersist(): boolean {
        return Boolean(this.fileSink);
    }

    normalize(event: SyntheticHttpEvent, matchResult: ExportMatchResult = this.match(event)): NormalizedExportRecord {
        const observedAt = event.observedAt ?? event.timestamp ?? new Date().toISOString();
        const body = getEventBody(event);

        return {
            schemaVersion: 1,
            recordId: getStableRecordId(event, observedAt),
            observedAt,
            method: event.method.toUpperCase(),
            url: event.url,
            statusCode: event.statusCode,
            contentType: getContentType(event.responseHeaders, event.contentType),
            body: {
                inline: body.value,
                encoding: body.encoding
            },
            matchedTarget: matchResult.targetName
        };
    }

    ingest(event: SyntheticHttpEvent, options: { persist?: boolean } = {}): ExportIngestResult {
        const match = this.match(event);
        const record = this.normalize(event, match);

        if (options.persist && this.fileSink && match.matched) {
            const outputPath = this.fileSink.append(record);
            return {
                record,
                match,
                persisted: true,
                outputPath
            };
        }

        if (options.persist && this.fileSink && !match.matched) {
            return {
                record,
                match,
                persisted: false,
                skippedPersistenceReason: 'no-target-matched'
            };
        }

        return {
            record,
            match,
            persisted: false
        };
    }
}
