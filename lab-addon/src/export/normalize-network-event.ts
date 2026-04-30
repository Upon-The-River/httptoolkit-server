import { createHash } from 'node:crypto';

import { routeQidianEndpoint } from './qidian-endpoint-router';

export interface RawCapturedRecord {
    schemaVersion?: number;
    recordId?: string;
    observedAt?: string;
    method?: string;
    url?: string;
    statusCode?: number;
    contentType?: string;
    body?: {
        inline?: string;
        encoding?: string;
    };
    matchedTarget?: string;
}

const MOJIBAKE_MARKERS = ['涓', '涔', '鎴', '绾', '鐨', '鍙', '鏄', '浣', '妯', '闂', '锛', '銆', '€', '�'];

const getTopLevelKeys = (value: unknown): string[] | undefined =>
    value && typeof value === 'object' && !Array.isArray(value)
        ? Object.keys(value as Record<string, unknown>).slice(0, 30)
        : undefined;

const scoreMojibake = (input: string): number => MOJIBAKE_MARKERS.reduce((acc, marker) => acc + ((input.match(new RegExp(marker, 'g'))?.length) ?? 0), 0);

export function repairMojibakeText(input: string): {
    repairedText: string;
    applied: boolean;
    strategy?: string;
    scoreBefore: number;
    scoreAfter: number;
    warnings: string[];
} {
    const scoreBefore = scoreMojibake(input);
    const warnings: string[] = [];
    const scoreAfter = scoreBefore;
    if (scoreBefore <= 0) {
        return { repairedText: input, applied: false, scoreBefore, scoreAfter, warnings };
    }

    warnings.push('gbk-repair-requires-iconv-lite-or-external-decoder');
    return {
        repairedText: input,
        applied: false,
        strategy: 'detect-only-no-gbk-decoder',
        scoreBefore,
        scoreAfter,
        warnings
    };
}

export function normalizeNetworkEvent(record: RawCapturedRecord, includeSamples = false) {
    const method = (record.method ?? 'GET').toUpperCase();
    const observedAt = record.observedAt ?? new Date(0).toISOString();
    const url = record.url ?? '';
    const routed = routeQidianEndpoint(url);
    const bodyInline = typeof record.body?.inline === 'string' ? record.body.inline : undefined;
    const warnings: string[] = [];

    let parseJsonOk = false;
    let parseJsonError: string | undefined;
    let looksJson = false;
    let repairedJsonOk: boolean | undefined;
    let repairedJsonTopLevelKeys: string[] | undefined;

    if (bodyInline !== undefined) {
        const trimmed = bodyInline.trim();
        looksJson = trimmed.startsWith('{') || trimmed.startsWith('[');
        if (looksJson) {
            try {
                const parsed = JSON.parse(bodyInline);
                parseJsonOk = true;
                void getTopLevelKeys(parsed);
            } catch (error) {
                parseJsonError = error instanceof Error ? error.message : 'unknown-json-parse-error';
            }
        }
    }

    const repair = repairMojibakeText(bodyInline ?? '');
    warnings.push(...repair.warnings);

    if (bodyInline !== undefined && repair.repairedText !== bodyInline) {
        try {
            const parsed = JSON.parse(repair.repairedText);
            repairedJsonOk = true;
            repairedJsonTopLevelKeys = getTopLevelKeys(parsed);
        } catch {
            repairedJsonOk = false;
        }
    }

    return {
        schemaVersion: 1,
        sourceRecordId: record.recordId ?? '',
        observedAt,
        method,
        url,
        host: routed.host,
        path: routed.path,
        query: routed.query,
        statusCode: record.statusCode,
        contentType: record.contentType,
        matchedTarget: record.matchedTarget,
        qidian: {
            isQidian: routed.isQidian,
            endpointKey: routed.endpointKey,
            bookId: routed.ids.bookId,
            chapterId: routed.ids.chapterId,
            roleId: routed.ids.roleId,
            circleId: routed.ids.circleId,
            otherIds: Object.fromEntries(Object.entries(routed.ids).filter(([key]) => !['bookId', 'chapterId', 'roleId', 'circleId'].includes(key)))
        },
        body: {
            present: record.body !== undefined,
            inlinePresent: bodyInline !== undefined,
            originalEncoding: record.body?.encoding,
            byteLengthApprox: bodyInline ? Buffer.byteLength(bodyInline, 'utf8') : 0,
            sha256: createHash('sha256').update(bodyInline ?? '').digest('hex'),
            looksJson,
            parseJsonOk,
            parseJsonError,
            mojibakeLikely: repair.scoreBefore > 0,
            repairApplied: repair.applied,
            repairStrategy: repair.strategy,
            repairedTextSample: includeSamples ? repair.repairedText.slice(0, 500) : undefined,
            repairedJsonOk,
            repairedJsonTopLevelKeys
        },
        warnings
    };
}
