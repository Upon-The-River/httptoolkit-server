import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';

import { AndroidNetworkSafetyApi } from '../src/android/android-network-safety';
import { createApp, SessionManagerLike, startServer } from '../src/server';
import { HeadlessControlApi } from '../src/headless/headless-types';
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

const baseHeadlessControl: HeadlessControlApi = {
    start: async () => ({
        ok: false,
        implemented: false,
        action: 'start',
        reason: 'Addon headless start orchestration is not fully migrated yet.'
    }),
    stop: async () => ({
        ok: false,
        implemented: false,
        action: 'stop',
        reason: 'Stop is intentionally stubbed to avoid recursive addon-server script calls.'
    }),
    recover: async () => ({
        ok: false,
        implemented: false,
        action: 'recover',
        reason: 'Recover is intentionally stubbed to avoid recursive addon-server script calls.'
    }),
    getCapabilities: () => ({
        health: { implemented: true, mutatesDeviceState: false },
        start: { implemented: false, mutatesDeviceState: false, reason: 'Addon headless start orchestration is not fully migrated yet.' },
        stop: { implemented: false, mutatesDeviceState: false, reason: 'Stop is intentionally stubbed to avoid recursive addon-server script calls.' },
        recover: { implemented: false, mutatesDeviceState: false, reason: 'Recover is intentionally stubbed to avoid recursive addon-server script calls.' }
    })
};

const baseAndroidSafety: AndroidNetworkSafetyApi = {
    inspectNetwork: async () => ({
        ok: true,
        inspectedAt: '2026-01-01T00:00:00.000Z',
        deviceId: 'device-1',
        inspectMode: 'read-only',
        proxy: {
            globalHttpProxy: null,
            globalHttpProxyHost: null,
            globalHttpProxyPort: null,
            globalHttpProxyExclusionList: null
        },
        privateDns: {
            mode: null,
            specifier: null
        },
        vpn: {
            alwaysOnVpnApp: null,
            lockdownVpn: null,
            vpnSummary: '',
            connectivitySummary: '',
            activeNetworkMentionsVpn: false
        },
        warnings: []
    }),
    rescueNetwork: async () => ({ ok: false, implemented: false, reason: 'rescue migration pending' }),
    getCapabilities: () => ({
        inspect: { implemented: true, mutatesDeviceState: false },
        rescue: { implemented: false, mutatesDeviceState: false, reason: 'rescue migration pending' }
    })
};

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

    it('returns stable error JSON when /session/start fails', async () => {
        const mockedSessionManager: SessionManagerLike = {
            startSessionIfNeeded: async () => {
                throw new Error('start failed');
            },
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
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { ok: false, error: 'start failed' });
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

    it('returns stable error JSON when /session/stop fails', async () => {
        const mockedSessionManager: SessionManagerLike = {
            startSessionIfNeeded: async () => ({
                created: false,
                proxyPort: 9010,
                sessionUrl: 'http://127.0.0.1:9010'
            }),
            getLatestSession: () => ({ active: true, proxyPort: 9010, sessionUrl: 'http://127.0.0.1:9010' }),
            stopLatestSession: async () => {
                throw new Error('stop failed');
            },
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
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { ok: false, error: 'stop failed' });
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

    it('returns inspect report at /android/network/inspect', async () => {
        const inspectSafety: AndroidNetworkSafetyApi = {
            ...baseAndroidSafety,
            inspectNetwork: async ({ deviceId } = {}) => ({
                ...(await baseAndroidSafety.inspectNetwork()),
                deviceId: deviceId ?? 'device-1'
            })
        };
        const { baseUrl } = await startTestServer(createApp({ androidNetworkSafety: inspectSafety }));

        const response = await fetch(`${baseUrl}/android/network/inspect`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deviceId: 'emulator-5554' })
        });

        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.ok, true);
        assert.equal(body.deviceId, 'emulator-5554');
        assert.equal(body.inspectMode, 'read-only');
    });

    it('returns rescue stub at /android/network/rescue', async () => {
        const { baseUrl } = await startTestServer(createApp({ androidNetworkSafety: baseAndroidSafety }));

        const response = await fetch(`${baseUrl}/android/network/rescue`, { method: 'POST' });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            ok: false,
            implemented: false,
            reason: 'rescue migration pending'
        });
    });

    it('returns capabilities at /android/network/capabilities', async () => {
        const { baseUrl } = await startTestServer(createApp({ androidNetworkSafety: baseAndroidSafety }));

        const response = await fetch(`${baseUrl}/android/network/capabilities`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            inspect: { implemented: true, mutatesDeviceState: false },
            rescue: { implemented: false, mutatesDeviceState: false, reason: 'rescue migration pending' }
        });
    });


    it('returns addon headless health at /headless/health', async () => {
        const { baseUrl } = await startTestServer(createApp({ headlessControl: baseHeadlessControl }));

        const response = await fetch(`${baseUrl}/headless/health`);
        assert.equal(response.status, 200);

        const body = await response.json();
        assert.equal(body.ok, true);
        assert.equal(body.service, 'headless-control');
        assert.equal(body.startImplemented, false);
        assert.equal(body.stopImplemented, false);
        assert.equal(body.recoverImplemented, false);
    });

    it('returns safe start stub at /headless/start', async () => {
        const { baseUrl } = await startTestServer(createApp({ headlessControl: baseHeadlessControl }));

        const response = await fetch(`${baseUrl}/headless/start`, { method: 'POST' });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            ok: false,
            implemented: false,
            action: 'start',
            reason: 'Addon headless start orchestration is not fully migrated yet.'
        });
    });

    it('returns safe stop stub at /headless/stop without recursive addon-server script call', async () => {
        const { baseUrl } = await startTestServer(createApp({ headlessControl: baseHeadlessControl }));

        const response = await fetch(`${baseUrl}/headless/stop`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ deviceId: 'emulator-5554' })
        });

        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.ok, false);
        assert.equal(body.action, 'stop');
        assert.equal(body.implemented, false);
        assert.equal(body.reason, 'Stop is intentionally stubbed to avoid recursive addon-server script calls.');
    });

    it('returns recover action result at /headless/recover', async () => {
        const { baseUrl } = await startTestServer(createApp({ headlessControl: baseHeadlessControl }));

        const response = await fetch(`${baseUrl}/headless/recover`, { method: 'POST' });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.action, 'recover');
        assert.equal(body.implemented, false);
        assert.equal(body.ok, false);
        assert.equal(body.reason, 'Recover is intentionally stubbed to avoid recursive addon-server script calls.');
    });

    it('returns headless capabilities at /headless/capabilities', async () => {
        const { baseUrl } = await startTestServer(createApp({ headlessControl: baseHeadlessControl }));

        const response = await fetch(`${baseUrl}/headless/capabilities`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            health: { implemented: true, mutatesDeviceState: false },
            start: { implemented: false, mutatesDeviceState: false, reason: 'Addon headless start orchestration is not fully migrated yet.' },
            stop: { implemented: false, mutatesDeviceState: false, reason: 'Stop is intentionally stubbed to avoid recursive addon-server script calls.' },
            recover: { implemented: false, mutatesDeviceState: false, reason: 'Recover is intentionally stubbed to avoid recursive addon-server script calls.' }
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
