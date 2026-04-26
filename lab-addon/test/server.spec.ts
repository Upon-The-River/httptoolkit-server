import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';

import { createApp, SessionManagerLike, startServer } from '../src/server';
import { SessionManager } from '../src/session/session-manager';

const openServers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
    while (openServers.length > 0) {
        await openServers.pop()?.close();
    }
});

async function startTestServer(app = createApp()) {
    const server = await new Promise<import('node:http').Server>((resolve) => {
        const runningServer = app.listen(0, '127.0.0.1', () => resolve(runningServer));
    });

    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    openServers.push({
        close: () => new Promise<void>((resolve, reject) => {
            server.close((error) => error ? reject(error) : resolve());
        })
    });

    return { baseUrl };
}

describe('lab addon service endpoints', () => {
    it('returns addon health at /health', async () => {
        const { baseUrl } = await startTestServer();

        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            ok: true,
            service: 'httptoolkit-lab-addon'
        });
    });

    it('matches Qidian URLs at /qidian/match', async () => {
        const { baseUrl } = await startTestServer();

        const response = await fetch(`${baseUrl}/qidian/match`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ url: 'https://www.qidian.com/book/1010868264/' })
        });

        assert.equal(response.status, 200);

        const body = await response.json();
        assert.equal(body.url, 'https://www.qidian.com/book/1010868264/');
        assert.equal(body.result.matched, true);
        assert.equal(body.result.reason, 'host-match');
    });

    it('returns latest session state at /session/latest', async () => {
        const mockedSessionManager: SessionManagerLike = {
            startSessionIfNeeded: async () => ({
                created: false,
                proxyPort: 9001,
                sessionUrl: 'http://127.0.0.1:9001'
            }),
            getLatestSession: () => ({
                active: true,
                proxyPort: 9001,
                sessionUrl: 'http://127.0.0.1:9001'
            }),
            stopLatestSession: async () => ({ stopped: true }),
            getTargetTrafficSignal: async () => ({
                observed: false,
                source: 'none',
                totalSeenRequests: 0,
                ignoredBootstrapRequests: 0,
                matchingRequests: 0
            })
        };

        const { baseUrl } = await startTestServer(createApp({ sessionManager: mockedSessionManager }));

        const response = await fetch(`${baseUrl}/session/latest`);
        assert.equal(response.status, 200);

        assert.deepEqual(await response.json(), {
            active: true,
            proxyPort: 9001,
            sessionUrl: 'http://127.0.0.1:9001'
        });
    });

    it('starts session at /session/start using mocked session manager', async () => {
        const mockedSessionManager: SessionManagerLike = {
            startSessionIfNeeded: async () => ({
                created: true,
                proxyPort: 9010,
                sessionUrl: 'http://127.0.0.1:9010'
            }),
            getLatestSession: () => ({ active: false }),
            stopLatestSession: async () => ({ stopped: false }),
            getTargetTrafficSignal: async () => ({
                observed: false,
                source: 'none',
                totalSeenRequests: 0,
                ignoredBootstrapRequests: 0,
                matchingRequests: 0
            })
        };

        const { baseUrl } = await startTestServer(createApp({ sessionManager: mockedSessionManager }));

        const response = await fetch(`${baseUrl}/session/start`, { method: 'POST' });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            created: true,
            proxyPort: 9010,
            sessionUrl: 'http://127.0.0.1:9010'
        });
    });

    it('stops session at /session/stop using mocked session manager', async () => {
        const mockedSessionManager: SessionManagerLike = {
            startSessionIfNeeded: async () => ({
                created: false,
                proxyPort: 9010,
                sessionUrl: 'http://127.0.0.1:9010'
            }),
            getLatestSession: () => ({ active: true, proxyPort: 9010, sessionUrl: 'http://127.0.0.1:9010' }),
            stopLatestSession: async () => ({ stopped: true }),
            getTargetTrafficSignal: async () => ({
                observed: false,
                source: 'none',
                totalSeenRequests: 0,
                ignoredBootstrapRequests: 0,
                matchingRequests: 0
            })
        };

        const { baseUrl } = await startTestServer(createApp({ sessionManager: mockedSessionManager }));

        const response = await fetch(`${baseUrl}/session/stop`, { method: 'POST' });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { stopped: true });
    });

    it('returns target signal at /session/target-signal using mocked session manager rule state', async () => {
        const sessionManager = new SessionManager(undefined, (url) => url.includes('target-host'));
        (sessionManager as any).passThroughFallbackRule = {
            getSeenRequests: async () => [
                { url: 'http://android.httptoolkit.tech/config' },
                { url: 'https://target-host.example/chapter/list' }
            ]
        };

        const { baseUrl } = await startTestServer(createApp({ sessionManager }));

        const response = await fetch(`${baseUrl}/session/target-signal`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ waitMs: 0, pollIntervalMs: 0 })
        });

        assert.equal(response.status, 200);

        assert.deepEqual(await response.json(), {
            observed: true,
            source: 'target-session-traffic',
            totalSeenRequests: 2,
            ignoredBootstrapRequests: 1,
            matchingRequests: 1,
            sampleUrl: 'https://target-host.example/chapter/list'
        });
    });

    it('rejects startServer on listen error (EADDRINUSE)', async () => {
        const first = await startServer({ host: '127.0.0.1', port: 0 });

        openServers.push({
            close: () => new Promise<void>((resolve, reject) => {
                first.server.close((error) => error ? reject(error) : resolve());
            })
        });

        await assert.rejects(
            startServer({ host: '127.0.0.1', port: first.port }),
            (error: NodeJS.ErrnoException) => error?.code === 'EADDRINUSE'
        );
    });
});
