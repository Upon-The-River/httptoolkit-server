import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, it } from 'node:test';

import { AndroidNetworkSafetyApi } from '../src/android/android-network-safety';
import { ExportFileSink } from '../src/export/export-file-sink';
import { ExportIngestService } from '../src/export/export-ingest-service';
import { ExportTargetsConfig } from '../src/export/export-types';
import { createApp, SessionManagerLike, startServer } from '../src/server';
import { HeadlessControlApi } from '../src/headless/headless-types';
import { SessionManager } from '../src/session/session-manager';
import { safeStubStrategy } from '../src/headless/headless-backend-strategy';

const openServers: Array<{ close: () => Promise<void> }> = [];
const tempDirs: string[] = [];

const createTempRuntimeRoot = async (): Promise<string> => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-addon-server-export-'));
    tempDirs.push(tempRoot);
    return tempRoot;
};

afterEach(async () => {
    while (openServers.length > 0) {
        await openServers.pop()?.close();
    }

    await Promise.all(tempDirs.splice(0, tempDirs.length).map((tempDir) => fs.rm(tempDir, { recursive: true, force: true })));
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
        backend: safeStubStrategy,
        reason: 'Addon headless start orchestration is not fully migrated yet.'
    }),
    stop: async () => ({
        ok: false,
        implemented: false,
        action: 'stop',
        backend: safeStubStrategy,
        reason: 'Stop is intentionally stubbed to avoid recursive addon-server script calls.'
    }),
    recover: async () => ({
        ok: false,
        implemented: false,
        action: 'recover',
        backend: safeStubStrategy,
        reason: 'Recover is intentionally stubbed to avoid recursive addon-server script calls.'
    }),
    getCapabilities: () => ({
        health: { implemented: true, mutatesDeviceState: false },
        start: { implemented: false, mutatesDeviceState: false, reason: 'Addon headless start orchestration is not fully migrated yet.' },
        stop: { implemented: false, mutatesDeviceState: false, reason: 'Stop is intentionally stubbed to avoid recursive addon-server script calls.' },
        recover: { implemented: false, mutatesDeviceState: false, reason: 'Recover is intentionally stubbed to avoid recursive addon-server script calls.' },
        backend: {
            active: 'safe-stub',
            strategies: [safeStubStrategy],
            startCommandConfigured: false,
            canDryRunStart: true,
            canExecuteStart: false
        }
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
    rescueNetwork: async (options = {}) => ({
        ok: true,
        implemented: true,
        deviceId: options.deviceId ?? 'device-1',
        dryRun: options.dryRun ?? true,
        actions: [],
        warnings: [],
        before: await baseAndroidSafety.inspectNetwork({ deviceId: options.deviceId })
    }),
    getCapabilities: () => ({
        inspect: { implemented: true, mutatesDeviceState: false },
        rescue: {
            implemented: true,
            mutatesDeviceState: true,
            defaultDryRun: true,
            limitations: ['no reboot', 'no app uninstall', 'no VPN app disable', 'high-risk actions skipped']
        }
    })
};

describe('lab addon service endpoints', () => {
    const stubExportConfig: ExportTargetsConfig = {
        enabled: true,
        targets: [
            {
                name: 'target-a',
                methods: ['GET'],
                urlIncludes: ['example.com'],
                statusCodes: [200]
            }
        ]
    };

    it('returns addon health at /health', async () => {
        const { baseUrl } = await startTestServer();

        const response = await fetch(`${baseUrl}/health`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            ok: true,
            service: 'httptoolkit-lab-addon'
        });
    });


    it('returns full migration status at /migration/status', async () => {
        const { baseUrl } = await startTestServer();

        const response = await fetch(`${baseUrl}/migration/status`);
        assert.equal(response.status, 200);

        const body = await response.json();
        assert.equal(Array.isArray(body.pendingRoutes), true);
        assert.equal(Array.isArray(body.capabilities), true);
        assert.deepEqual(body.summary, {
            implemented: 16,
            safeStub: 3,
            pending: 0,
            requiresCoreHook: 1
        });

        assert.equal(body.capabilities.some((entry: { path: string, status: string }) => entry.path === '/qidian/match' && entry.status === 'implemented'), true);
    });

    it('keeps /migration/pending-routes backward compatible with pendingRoutes list plus richer status metadata', async () => {
        const { baseUrl } = await startTestServer();

        const response = await fetch(`${baseUrl}/migration/pending-routes`);
        assert.equal(response.status, 200);

        const body = await response.json();
        assert.equal(Array.isArray(body.pendingRoutes), true);
        assert.equal(body.pendingRoutes.includes('POST /headless/start'), true);
        assert.equal(body.pendingRoutes.includes('GET /export/stream'), true);
        assert.equal(Array.isArray(body.capabilities), true);
        assert.equal(typeof body.summary?.safeStub, 'number');
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

    it('POST /android/network/rescue default request returns dryRun=true and implemented=true', async () => {
        const { baseUrl } = await startTestServer(createApp({ androidNetworkSafety: baseAndroidSafety }));

        const response = await fetch(`${baseUrl}/android/network/rescue`, { method: 'POST' });
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.ok, true);
        assert.equal(body.implemented, true);
        assert.equal(body.dryRun, true);
    });

    it('POST /android/network/rescue dryRun=false executes through fake executor', async () => {
        const executingSafety: AndroidNetworkSafetyApi = {
            ...baseAndroidSafety,
            rescueNetwork: async (options = {}) => ({
                ok: true,
                implemented: true,
                deviceId: options.deviceId ?? 'device-1',
                dryRun: options.dryRun ?? true,
                actions: [{
                    id: 'clear-http-proxy-primary',
                    description: 'Clear global HTTP proxy setting.',
                    riskLevel: 'low',
                    command: 'settings delete global http_proxy',
                    executed: options.dryRun === false,
                    skipped: options.dryRun !== false
                }],
                warnings: [],
                before: await baseAndroidSafety.inspectNetwork({ deviceId: options.deviceId }),
                after: await baseAndroidSafety.inspectNetwork({ deviceId: options.deviceId })
            })
        };

        const { baseUrl } = await startTestServer(createApp({ androidNetworkSafety: executingSafety }));
        const response = await fetch(`${baseUrl}/android/network/rescue`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ dryRun: false })
        });

        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.dryRun, false);
        assert.equal(body.actions[0].executed, true);
    });

    it('GET /android/network/capabilities reflects rescue implemented and default dry-run', async () => {
        const { baseUrl } = await startTestServer(createApp({ androidNetworkSafety: baseAndroidSafety }));

        const response = await fetch(`${baseUrl}/android/network/capabilities`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            inspect: { implemented: true, mutatesDeviceState: false },
            rescue: {
                implemented: true,
                mutatesDeviceState: true,
                defaultDryRun: true,
                limitations: ['no reboot', 'no app uninstall', 'no VPN app disable', 'high-risk actions skipped']
            }
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
        assert.equal(body.backend, 'safe-stub');
        assert.equal(body.configuredStartAvailable, false);
    });

    it('returns safe start stub at /headless/start', async () => {
        const { baseUrl } = await startTestServer(createApp({ headlessControl: baseHeadlessControl }));

        const response = await fetch(`${baseUrl}/headless/start`, { method: 'POST' });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            ok: false,
            implemented: false,
            action: 'start',
            backend: safeStubStrategy,
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
            recover: { implemented: false, mutatesDeviceState: false, reason: 'Recover is intentionally stubbed to avoid recursive addon-server script calls.' },
            backend: {
                active: 'safe-stub',
                strategies: [safeStubStrategy],
                startCommandConfigured: false,
                canDryRunStart: true,
                canExecuteStart: false
            }
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

    it('returns export capabilities at /export/capabilities', async () => {
        const { baseUrl } = await startTestServer();

        const response = await fetch(`${baseUrl}/export/capabilities`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.configTargets.implemented, true);
        assert.equal(body.matcher.implemented, true);
        assert.equal(body.ingest.implemented, true);
        assert.equal(body.stream.status, 'requires-core-hook');
    });

    it('returns configured export targets at /export/targets', async () => {
        const { baseUrl } = await startTestServer(createApp({
            exportTargetsLoader: async () => stubExportConfig
        }));

        const response = await fetch(`${baseUrl}/export/targets`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), stubExportConfig);
    });

    it('matches synthetic events at /export/match', async () => {
        const { baseUrl } = await startTestServer(createApp({
            exportTargetsLoader: async () => stubExportConfig
        }));

        const response = await fetch(`${baseUrl}/export/match`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                event: {
                    method: 'GET',
                    url: 'https://example.com/api/books',
                    statusCode: 200
                }
            })
        });

        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.ok, true);
        assert.equal(body.result.matched, true);
        assert.equal(body.result.targetName, 'target-a');
    });

    it('ingests synthetic events at /export/ingest without persisting by default', async () => {
        const { baseUrl } = await startTestServer(createApp({
            exportIngestService: new ExportIngestService(stubExportConfig.targets)
        }));

        const response = await fetch(`${baseUrl}/export/ingest`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                event: {
                    timestamp: '2026-01-02T03:04:05.000Z',
                    method: 'GET',
                    url: 'https://example.com/api/books',
                    statusCode: 200,
                    responseHeaders: { 'content-type': 'application/json' },
                    responseBody: '{\"ok\":true}'
                }
            })
        });

        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.ok, true);
        assert.equal(body.record.schemaVersion, 1);
        assert.equal(body.record.matchedTarget, 'target-a');
        assert.equal(body.record.contentType, 'application/json');
        assert.equal(body.persisted, false);
        assert.equal(body.outputPath, undefined);
    });

    it('persists /export/ingest records when persist=true using runtime JSONL sink', async () => {
        const runtimeRoot = await createTempRuntimeRoot();
        const sink = new ExportFileSink({ runtimeRoot });

        const { baseUrl } = await startTestServer(createApp({
            exportIngestService: new ExportIngestService(stubExportConfig.targets, sink),
            exportFileSink: sink
        }));

        const response = await fetch(`${baseUrl}/export/ingest`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                persist: true,
                event: {
                    timestamp: '2026-01-02T03:04:05.000Z',
                    method: 'GET',
                    url: 'https://example.com/api/books',
                    statusCode: 200
                }
            })
        });

        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.ok, true);
        assert.equal(body.persisted, true);
        assert.equal(typeof body.outputPath, 'string');
        assert.equal(body.record.matchedTarget, 'target-a');

        const statusResponse = await fetch(`${baseUrl}/export/output-status`);
        assert.equal(statusResponse.status, 200);
        const statusBody = await statusResponse.json();
        assert.equal(statusBody.exists, true);
        assert.equal(statusBody.sizeBytes > 0, true);
        assert.equal(statusBody.jsonlPath, body.outputPath);
    });


    it('POST /headless/start with dryRun request returns plan and does not spawn', async () => {
        const calls: unknown[] = [];
        const headlessControl: HeadlessControlApi = {
            ...baseHeadlessControl,
            start: async (options) => {
                calls.push(options);
                return {
                    ok: true,
                    implemented: true,
                    action: 'start',
                    backend: {
                        ...safeStubStrategy,
                        kind: 'local-process',
                        implemented: true,
                        mutatesHostProcessState: true
                    },
                    dryRun: true,
                    startPlan: {
                        command: 'node',
                        args: ['./bin/run', 'start'],
                        workingDir: '/official/server',
                        envKeys: ['NODE_ENV']
                    }
                };
            }
        };

        const { baseUrl } = await startTestServer(createApp({ headlessControl }));
        const response = await fetch(`${baseUrl}/headless/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                backend: 'local-process',
                command: 'node',
                args: ['./bin/run', 'start'],
                env: { NODE_ENV: 'production' }
            })
        });

        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.dryRun, true);
        assert.equal(body.startPlan.command, 'node');
        assert.equal(calls.length, 1);
        assert.equal((calls[0] as { dryRun?: boolean }).dryRun, true);
    });

    it('POST /headless/start with dryRun=false can return process from injected control', async () => {
        const headlessControl: HeadlessControlApi = {
            ...baseHeadlessControl,
            start: async () => ({
                ok: true,
                implemented: true,
                action: 'start',
                backend: {
                    ...safeStubStrategy,
                    kind: 'local-process',
                    implemented: true,
                    mutatesHostProcessState: true
                },
                dryRun: false,
                process: {
                    processId: 1234,
                    command: 'node',
                    args: ['./bin/run', 'start'],
                    startedAt: '2026-01-01T00:00:00.000Z',
                    status: 'running',
                    metadata: { owner: 'lab-addon-headless' }
                }
            }),
            getLatestProcess: () => ({
                processId: 1234,
                command: 'node',
                args: ['./bin/run', 'start'],
                startedAt: '2026-01-01T00:00:00.000Z',
                status: 'running',
                metadata: { owner: 'lab-addon-headless' }
            }),
            getCapabilities: () => ({
                ...baseHeadlessControl.getCapabilities(),
                start: { implemented: true, mutatesDeviceState: false },
                backend: {
                    active: 'local-process',
                    strategies: [safeStubStrategy],
                    startCommandConfigured: true,
                    canDryRunStart: true,
                    canExecuteStart: true
                }
            })
        };

        const { baseUrl } = await startTestServer(createApp({ headlessControl }));
        const response = await fetch(`${baseUrl}/headless/start`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ backend: 'local-process', command: 'node', args: ['./bin/run', 'start'], dryRun: false })
        });

        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.dryRun, false);
        assert.equal(body.process.processId, 1234);

        const healthResponse = await fetch(`${baseUrl}/headless/health`);
        assert.equal(healthResponse.status, 200);
        const healthBody = await healthResponse.json();
        assert.equal(healthBody.latestProcess.processId, 1234);
        assert.equal(healthBody.backend, 'local-process');
        assert.equal(healthBody.configuredStartAvailable, true);
    });

    it('GET /headless/capabilities reports configured start availability', async () => {
        const headlessControl: HeadlessControlApi = {
            ...baseHeadlessControl,
            getCapabilities: () => ({
                ...baseHeadlessControl.getCapabilities(),
                backend: {
                    active: 'local-process',
                    strategies: [safeStubStrategy],
                    startCommandConfigured: true,
                    canDryRunStart: true,
                    canExecuteStart: true
                },
                start: { implemented: true, mutatesDeviceState: false }
            })
        };

        const { baseUrl } = await startTestServer(createApp({ headlessControl }));
        const response = await fetch(`${baseUrl}/headless/capabilities`);
        assert.equal(response.status, 200);

        const body = await response.json();
        assert.equal(body.backend.startCommandConfigured, true);
        assert.equal(body.backend.canDryRunStart, true);
        assert.equal(body.backend.canExecuteStart, true);
    });

    it('returns /export/output-status when output file does not yet exist', async () => {
        const runtimeRoot = await createTempRuntimeRoot();
        const sink = new ExportFileSink({ runtimeRoot });

        const { baseUrl } = await startTestServer(createApp({
            exportFileSink: sink
        }));

        const response = await fetch(`${baseUrl}/export/output-status`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.runtimeRoot, sink.paths.runtimeRoot);
        assert.equal(body.exportDir, sink.paths.exportDir);
        assert.equal(body.jsonlPath, sink.paths.jsonlPath);
        assert.equal(body.exists, false);
        assert.equal(body.sizeBytes, 0);
    });

    it('keeps /export/stream as requires-core-hook safe stub', async () => {
        const { baseUrl } = await startTestServer();

        const response = await fetch(`${baseUrl}/export/stream`);
        assert.equal(response.status, 501);
        const body = await response.json();
        assert.equal(body.ok, false);
        assert.equal(body.status, 'requires-core-hook');
    });
});
