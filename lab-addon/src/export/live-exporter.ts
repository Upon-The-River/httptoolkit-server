import * as path from 'path';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import type { CompletedResponse, InitiatedRequest, Mockttp } from 'mockttp';

import {
    appendOrCreateFile,
    checkAccess,
    ensureDirectoryExists,
    readFile,
    writeFile
} from '../util/fs';

export interface LiveExportTargetRule {
    name?: string;
    methods?: string[];
    urlIncludes?: string[];
    urlRegex?: string;
    statusCodes?: number[];
}

interface LiveExportTargetsConfig {
    enabled?: boolean;
    targets?: LiveExportTargetRule[];
}

export interface LiveExportHit {
    timestamp: string;
    method: string;
    url: string;
    status: number;
    contentType: string;
    payloadPath: string;
    matchedRule?: string;
}

export interface LiveExportStreamHit extends LiveExportHit {
    bodyInline: string;
    bodyEncoding: 'utf8' | 'base64';
}

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), 'config', 'live-export-targets.json');
const ENABLE_RESPONSE_BODY_DATA_EVENTS = false; // Extension point for chunk-level streaming

export class LiveResponseExporter {

    private targets: LiveExportTargetRule[] = [];
    private emitter = new EventEmitter();

    constructor(
        private configPath: string,
        private exportRootPath: string
    ) {}

    async initialize() {
        await ensureDirectoryExists(this.exportRootPath);
        await ensureDirectoryExists(path.join(this.exportRootPath, 'payloads'));

        const config = await this.loadTargetsConfig();
        this.targets = config.enabled === false
            ? []
            : (config.targets ?? []);
    }

    async attachToMockServer(mockServer: Mockttp) {
        const requestMetadata = new Map<string, Pick<InitiatedRequest, 'method' | 'url'>>();

        await mockServer.on('request-initiated', (request: InitiatedRequest) => {
            requestMetadata.set(request.id, {
                method: request.method,
                url: request.url
            });
        });

        await mockServer.on('response', (response: CompletedResponse) => {
            this.handleCompletedResponse(response, requestMetadata)
                .catch((error) => {
                    console.warn('Live export failed:', error.message ?? error);
                })
                .finally(() => requestMetadata.delete(response.id));
        });

        if (ENABLE_RESPONSE_BODY_DATA_EVENTS) {
            await mockServer.on('response-body-data', (_chunkData) => {
                // Extension point for future chunk-level real-time export.
            });
        }
    }

    subscribe(listener: (hit: LiveExportStreamHit) => void): () => void {
        this.emitter.on('hit', listener);
        return () => this.emitter.off('hit', listener);
    }

    emitHit(hit: LiveExportStreamHit) {
        this.emitter.emit('hit', hit);
    }

    private async handleCompletedResponse(
        response: CompletedResponse,
        requestMetadata: Map<string, Pick<InitiatedRequest, 'method' | 'url'>>
    ) {
        const request = requestMetadata.get(response.id);
        if (!request) return;

        const matchedRule = this.findMatchingRule(request.method, request.url, response.statusCode);
        if (!matchedRule) return;

        const timestampMs = Date.now();
        const timestampIso = new Date(timestampMs).toISOString();
        const responseBuffer = response.body.buffer;
        const decodedResponseBuffer = (await response.body.getDecodedBuffer()) ?? responseBuffer;
        const contentType = this.getContentType(response.headers['content-type']);

        const hash = createHash('sha256')
            .update(`${timestampIso}:${request.method}:${request.url}:${response.statusCode}`)
            .digest('hex')
            .slice(0, 12);

        const payloadFilename = `${timestampMs}_${hash}${this.getPayloadExtension(contentType)}`;
        const payloadPath = path.posix.join('payloads', payloadFilename);
        const payloadFilePath = path.join(this.exportRootPath, 'payloads', payloadFilename);

        await writeFile(payloadFilePath, decodedResponseBuffer);

        const persistedHit: LiveExportHit = {
            timestamp: timestampIso,
            method: request.method,
            url: request.url,
            status: response.statusCode,
            contentType,
            payloadPath,
            matchedRule: matchedRule.name
        };

        const streamedHit: LiveExportStreamHit = {
            ...persistedHit,
            ...this.formatStreamBody(contentType, decodedResponseBuffer)
        };

        await appendOrCreateFile(
            path.join(this.exportRootPath, 'session_hits.jsonl'),
            `${JSON.stringify(persistedHit)}\n`
        );

        this.emitHit(streamedHit);
    }

    private getContentType(contentTypeHeader: string | string[] | undefined): string {
        const headerValue = Array.isArray(contentTypeHeader)
            ? contentTypeHeader[0]
            : contentTypeHeader;

        return (headerValue ?? '').trim() || 'application/octet-stream';
    }

    private getPayloadExtension(contentType: string): string {
        const mimeType = contentType.split(';', 1)[0].trim().toLowerCase();
        if (mimeType === 'text/plain') return '.txt';
        if (mimeType === 'application/xml') return '.xml';
        if (mimeType === 'application/javascript') return '.js';
        if (mimeType === 'application/json') return '.json';
        return '.bin';
    }

    private formatStreamBody(contentType: string, decodedBodyBuffer: Buffer): Pick<LiveExportStreamHit, 'bodyInline' | 'bodyEncoding'> {
        if (this.isTextContentType(contentType)) {
            return {
                bodyEncoding: 'utf8',
                bodyInline: decodedBodyBuffer.toString('utf8')
            };
        }

        return {
            bodyEncoding: 'base64',
            bodyInline: decodedBodyBuffer.toString('base64')
        };
    }

    private isTextContentType(contentType: string): boolean {
        const mimeType = contentType.split(';', 1)[0].trim().toLowerCase();
        return mimeType.startsWith('text/') ||
            mimeType === 'application/json' ||
            mimeType === 'application/javascript' ||
            mimeType === 'application/xml';
    }

    private findMatchingRule(method: string, url: string, statusCode: number) {
        return this.targets.find((rule) => {
            if (rule.methods?.length && !rule.methods.includes(method)) return false;
            if (rule.statusCodes?.length && !rule.statusCodes.includes(statusCode)) return false;
            if (rule.urlIncludes?.length && !rule.urlIncludes.some((piece) => url.includes(piece))) return false;
            if (rule.urlRegex && !(new RegExp(rule.urlRegex).test(url))) return false;
            return true;
        });
    }

    private async loadTargetsConfig(): Promise<LiveExportTargetsConfig> {
        const selectedPath = await this.resolveConfigPath();
        try {
            const rawConfig = await readFile(selectedPath, 'utf8');
            return JSON.parse(rawConfig) as LiveExportTargetsConfig;
        } catch (error) {
            console.warn(`Failed to parse live export targets from ${selectedPath}:`, error);
            return { targets: [] };
        }
    }

    private async resolveConfigPath() {
        await checkAccess(this.configPath).then(() => undefined).catch(() => {
            this.configPath = DEFAULT_CONFIG_PATH;
        });
        return this.configPath;
    }
}
