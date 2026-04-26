export interface ExportTargetRule {
    name: string;
    methods?: string[];
    urlIncludes?: string[];
    urlRegex?: string;
    statusCodes?: number[];
}

export interface ExportTargetsConfig {
    enabled: boolean;
    targets: ExportTargetRule[];
}

export interface SyntheticHttpEvent {
    timestamp?: string;
    method: string;
    url: string;
    statusCode: number;
    responseHeaders?: Record<string, string>;
    responseBody?: string;
    responseBodyEncoding?: 'utf8' | 'base64';
}

export interface ExportMatchResult {
    matched: boolean;
    targetName?: string;
    reasons: string[];
}

export interface NormalizedExportRecord {
    schemaVersion: 1;
    recordId: string;
    observedAt: string;
    method: string;
    url: string;
    statusCode: number;
    contentType: string;
    body: {
        inline: string;
        encoding: 'utf8' | 'base64';
    };
    matchedTarget?: string;
}

export interface ExportCapabilities {
    configTargets: { implemented: boolean };
    matcher: { implemented: boolean };
    ingest: { implemented: boolean };
    stream: {
        implemented: false;
        status: 'requires-core-hook';
        reason: string;
    };
    notes: string;
}
