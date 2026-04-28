import * as fs from 'fs';
import { expect } from 'chai';

import {
    LiveExportAddonBridge,
    LiveExportBridgeEvent,
    setupLiveExportHook
} from '../../src/export/live-export-addon-bridge';

const createRequest = () => ({
    id: 'request-1',
    method: 'GET',
    url: 'https://example.com/test',
    headers: {
        'x-request-id': 'abc-123'
    },
    timingEvents: {
        startTimestamp: Date.parse('2026-04-27T00:00:00.000Z')
    }
}) as any;

const createResponse = (overrides: any = {}) => ({
    id: 'request-1',
    statusCode: 200,
    headers: {
        'content-type': 'application/json; charset=utf-8'
    },
    body: {
        getText: async () => '{"ok":true}',
        getDecodedBuffer: async () => Buffer.from('{"ok":true}', 'utf8')
    },
    ...overrides
}) as any;

describe('LiveExportAddonBridge', () => {
    it('is disabled by default', async () => {
        const bridge = LiveExportAddonBridge.fromEnvironment({});

        bridge.trackRequest(createRequest());
        bridge.trackResponse(createResponse());

        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(bridge.isEnabled()).to.equal(false);
    });

    it('posts to addon ingest when enabled', async () => {
        const posted: Array<{ url: string, body: { persist: boolean, event: LiveExportBridgeEvent } }> = [];

        const bridge = new LiveExportAddonBridge({
            enabled: true,
            baseUrl: 'http://127.0.0.1:45457',
            persist: true,
            timeoutMs: 1000
        }, async (url, body) => {
            posted.push({ url, body });
        });

        bridge.trackRequest(createRequest());
        bridge.trackResponse(createResponse());

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(posted.length).to.equal(1);
        expect(posted[0].url).to.equal('http://127.0.0.1:45457/export/ingest');
        expect(posted[0].body.persist).to.equal(true);
        expect(posted[0].body.event.source).to.equal('official-core-hook');
        expect(posted[0].body.event.method).to.equal('GET');
        expect(posted[0].body.event.url).to.equal('https://example.com/test');
        expect(posted[0].body.event.statusCode).to.equal(200);
        expect(posted[0].body.event.bodyText).to.equal('{"ok":true}');
    });

    it('does not throw when posting fails', async () => {
        const bridge = new LiveExportAddonBridge({
            enabled: true,
            baseUrl: 'http://127.0.0.1:45457',
            persist: true,
            timeoutMs: 1000
        }, async () => {
            throw new Error('expected failure');
        });

        expect(() => {
            bridge.trackRequest(createRequest());
            bridge.trackResponse(createResponse());
        }).not.to.throw();

        await new Promise((resolve) => setTimeout(resolve, 10));
    });

    it('does not register hook handlers when disabled', () => {
        let onCalls = 0;
        const hookTarget = {
            on: () => {
                onCalls += 1;
            }
        } as any;

        const bridge = new LiveExportAddonBridge({
            enabled: false,
            baseUrl: 'http://127.0.0.1:45457',
            persist: true,
            timeoutMs: 1000
        });

        const hookRegistered = setupLiveExportHook(bridge, hookTarget);

        expect(hookRegistered).to.equal(false);
        expect(onCalls).to.equal(0);
    });

    it('swallows hook registration failures', () => {
        const bridge = new LiveExportAddonBridge({
            enabled: true,
            baseUrl: 'http://127.0.0.1:45457',
            persist: true,
            timeoutMs: 1000
        });

        const failingHookTarget = {
            on: () => {
                throw new Error('hook-failure');
            }
        } as any;

        let result: boolean | undefined;
        expect(() => {
            result = setupLiveExportHook(bridge, failingHookTarget);
        }).not.to.throw();
        expect(result).to.equal(false);
    });

    it('respects timeout via abort signal', async () => {
        let aborted = false;

        const bridge = new LiveExportAddonBridge({
            enabled: true,
            baseUrl: 'http://127.0.0.1:45457',
            persist: true,
            timeoutMs: 20
        }, async (_url, _body, options) => {
            await new Promise<void>((resolve, reject) => {
                options.signal.addEventListener('abort', () => {
                    aborted = true;
                    reject(new Error('aborted'));
                });
            });
        });

        bridge.trackRequest(createRequest());
        bridge.trackResponse(createResponse());

        await new Promise((resolve) => setTimeout(resolve, 40));
        expect(aborted).to.equal(true);
    });

    it('accepts metadata-only events when body is unavailable', async () => {
        let postedBody: { persist: boolean, event: LiveExportBridgeEvent } | undefined;

        const bridge = new LiveExportAddonBridge({
            enabled: true,
            baseUrl: 'http://127.0.0.1:45457',
            persist: false,
            timeoutMs: 1000
        }, async (_url, body) => {
            postedBody = body;
        });

        bridge.trackRequest(createRequest());
        bridge.trackResponse(createResponse({
            headers: {},
            body: {
                getText: async () => undefined,
                getDecodedBuffer: async () => undefined
            }
        }));

        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(postedBody).to.not.equal(undefined);
        expect(postedBody!.event.bodyText).to.equal(undefined);
        expect(postedBody!.event.bodyBase64).to.equal(undefined);
        expect(postedBody!.event.contentType).to.equal(undefined);
    });

    it('contains no qidian-specific logic', () => {
        const source = fs.readFileSync('src/export/live-export-addon-bridge.ts', 'utf8').toLowerCase();
        expect(source).to.not.contain('qidian');
    });
});
