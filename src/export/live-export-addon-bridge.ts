import fetch from 'node-fetch';
import type { CompletedRequest, CompletedResponse, Headers } from 'mockttp';

const DEFAULT_BASE_URL = 'http://127.0.0.1:45457';
const DEFAULT_TIMEOUT_MS = 1000;

const isTruthy = (value: string | undefined, defaultValue = false): boolean => {
    if (value === undefined) return defaultValue;

    const normalized = value.trim().toLowerCase();
    return normalized === '1' || normalized === 'true';
};

const isTextLikeContentType = (contentType: string | undefined): boolean => {
    if (!contentType) return false;

    const normalized = contentType.toLowerCase();
    return normalized.startsWith('text/') ||
        normalized.includes('json') ||
        normalized.includes('xml') ||
        normalized.includes('javascript') ||
        normalized.includes('x-www-form-urlencoded');
};

const normalizeHeaders = (headers: Headers | undefined): Record<string, string> => {
    const normalizedHeaders: Record<string, string> = {};

    Object.entries(headers ?? {}).forEach(([key, value]) => {
        if (typeof value === 'string') {
            normalizedHeaders[key] = value;
        } else if (Array.isArray(value)) {
            normalizedHeaders[key] = value.join(', ');
        } else if (typeof value === 'number') {
            normalizedHeaders[key] = `${value}`;
        }
    });

    return normalizedHeaders;
};

const readBody = async (
    response: CompletedResponse,
    contentType: string | undefined
): Promise<{ bodyText?: string, bodyBase64?: string }> => {
    try {
        if (isTextLikeContentType(contentType)) {
            const bodyText = await response.body.getText();
            return bodyText === undefined ? {} : { bodyText };
        }

        const responseBuffer = await response.body.getDecodedBuffer();
        return responseBuffer?.byteLength
            ? { bodyBase64: responseBuffer.toString('base64') }
            : {};
    } catch {
        return {};
    }
};

export interface LiveExportBridgeEvent {
    observedAt: string;
    method: string;
    url: string;
    statusCode: number;
    contentType?: string;
    requestHeaders: Record<string, string>;
    responseHeaders: Record<string, string>;
    bodyText?: string;
    bodyBase64?: string;
    source: 'official-core-hook';
}

export interface LiveExportBridgeConfig {
    enabled: boolean;
    baseUrl: string;
    persist: boolean;
    timeoutMs: number;
}

export interface LiveExportBridgePostOptions {
    timeoutMs: number;
    signal: AbortSignal;
}

export type LiveExportBridgePoster = (
    url: string,
    body: { persist: boolean, event: LiveExportBridgeEvent },
    options: LiveExportBridgePostOptions
) => Promise<void>;

export interface LiveExportHookTarget {
    on(event: 'request', callback: (request: CompletedRequest) => void): unknown;
    on(event: 'response', callback: (response: CompletedResponse) => void): unknown;
}

const defaultPoster: LiveExportBridgePoster = async (url, body, options) => {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify(body),
        signal: options.signal as any
    });

    if (!response.ok) {
        throw new Error(`Addon export ingest failed with ${response.status}`);
    }
};

export class LiveExportAddonBridge {

    static fromEnvironment(env: NodeJS.ProcessEnv = process.env): LiveExportAddonBridge {
        const timeoutOverride = Number.parseInt(env.HTK_LAB_ADDON_EXPORT_TIMEOUT_MS ?? '', 10);

        return new LiveExportAddonBridge({
            enabled: isTruthy(env.HTK_LAB_ADDON_EXPORT_ENABLED, false),
            baseUrl: env.HTK_LAB_ADDON_BASE_URL || DEFAULT_BASE_URL,
            persist: isTruthy(env.HTK_LAB_ADDON_EXPORT_PERSIST, true),
            timeoutMs: Number.isFinite(timeoutOverride) && timeoutOverride > 0
                ? timeoutOverride
                : DEFAULT_TIMEOUT_MS
        });
    }

    private readonly requestsById = new Map<string, CompletedRequest>();

    constructor(
        private readonly config: LiveExportBridgeConfig,
        private readonly postEvent: LiveExportBridgePoster = defaultPoster
    ) {}

    isEnabled(): boolean {
        return this.config.enabled;
    }

    trackRequest(request: CompletedRequest): void {
        if (!this.config.enabled) return;
        this.requestsById.set(request.id, request);
    }

    trackResponse(response: CompletedResponse): void {
        if (!this.config.enabled) return;

        const request = this.requestsById.get(response.id);
        this.requestsById.delete(response.id);

        if (!request) return;

        void this.forwardExchange(request, response).catch((error: Error) => {
            console.warn(`Live export addon bridge failed: ${error.message}`);
        });
    }

    async forwardExchange(request: CompletedRequest, response: CompletedResponse): Promise<void> {
        if (!this.config.enabled) return;

        const responseHeaders = normalizeHeaders(response.headers);
        const contentType = Object.entries(responseHeaders)
            .find(([headerName]) => headerName.toLowerCase() === 'content-type')?.[1];

        const body = await readBody(response, contentType);

        const event: LiveExportBridgeEvent = {
            observedAt: new Date(request.timingEvents.startTimestamp).toISOString(),
            method: request.method,
            url: request.url,
            statusCode: response.statusCode,
            contentType,
            requestHeaders: normalizeHeaders(request.headers),
            responseHeaders,
            source: 'official-core-hook',
            ...body
        };

        const timeoutController = new AbortController();
        const timeout = setTimeout(() => timeoutController.abort(), this.config.timeoutMs);
        timeout.unref();

        try {
            await this.postEvent(
                `${this.config.baseUrl.replace(/\/$/, '')}/export/ingest`,
                { persist: this.config.persist, event },
                { timeoutMs: this.config.timeoutMs, signal: timeoutController.signal }
            );
        } finally {
            clearTimeout(timeout);
        }
    }
}

export const setupLiveExportHook = (
    liveExportAddonBridge: LiveExportAddonBridge,
    mockServer: LiveExportHookTarget | undefined
): boolean => {
    if (!liveExportAddonBridge.isEnabled()) return false;
    if (!mockServer) {
        console.warn('Live export hook setup skipped: missing HTTP mock server');
        return false;
    }

    try {
        void mockServer.on('request', (request) => {
            liveExportAddonBridge.trackRequest(request);
        });

        void mockServer.on('response', (response) => {
            liveExportAddonBridge.trackResponse(response);
        });

        return true;
    } catch (error: any) {
        console.warn(`Live export hook setup failed: ${error?.message || error}`);
        return false;
    }
};
