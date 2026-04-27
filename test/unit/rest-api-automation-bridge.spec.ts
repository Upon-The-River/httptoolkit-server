import * as fs from 'fs';
import * as http from 'http';
import express from 'express';
import { expect } from 'chai';

import { exposeRestAPI } from '../../src/api/rest-api';
import { startAndroidActivationBridgeServer } from '../../src/automation/android-activation-bridge-server';

const OLD_BRIDGE_ENABLED = process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED;
const OLD_BRIDGE_PORT = process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT;

describe('Android activation bridge server', () => {
    afterEach(() => {
        if (OLD_BRIDGE_ENABLED === undefined) delete process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED;
        else process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED = OLD_BRIDGE_ENABLED;

        if (OLD_BRIDGE_PORT === undefined) delete process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT;
        else process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT = OLD_BRIDGE_PORT;
    });

    it('bridge server is disabled by default', async () => {
        delete process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED;
        const server = await startAndroidActivationBridgeServer({
            apiModel: {
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async () => ({ success: true, metadata: {} })
            } as any
        });

        expect(server).to.equal(undefined);
    });

    it('REST API does not expose bridge routes', async () => {
        const app = express();
        app.use(express.json());
        exposeRestAPI(app, {
            getVersion: () => 'test-version',
            updateServer: () => undefined,
            shutdownServer: () => undefined,
            getConfig: async () => ({}),
            getNetworkInterfaces: () => ({}),
            getInterceptors: async () => ([]),
            getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
            activateInterceptor: async () => ({ success: true, metadata: { source: 'mock' } }),
            sendRequest: async () => {
                throw new Error('not used in this test');
            }
        } as any);

        const server = await new Promise<http.Server>((resolve) => {
            const started = app.listen(0, '127.0.0.1', () => resolve(started));
        });

        try {
            const port = server.address().port;
            const healthResponse = await fetch(`http://127.0.0.1:${port}/automation/health`);
            expect(healthResponse.status).to.equal(404);
        } finally {
            await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
        }
    });

    it('GET /automation/health returns bridge availability when enabled', async () => {
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED = 'true';
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT = '0';

        const bridge = await startAndroidActivationBridgeServer({
            apiModel: {
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async () => ({ success: true, metadata: {} })
            } as any
        });

        expect(bridge).to.not.equal(undefined);
        const port = (bridge!.address() as any).port;

        try {
            const response = await fetch(`http://127.0.0.1:${port}/automation/health`);
            const body = await response.json();

            expect(response.status).to.equal(200);
            expect(body.success).to.equal(true);
            expect(body.bridge.available).to.equal(true);
            expect((bridge!.address() as any).address).to.equal('127.0.0.1');
        } finally {
            await new Promise<void>((resolve, reject) => bridge!.close((err) => err ? reject(err) : resolve()));
        }
    });

    it('POST /automation/android-adb/start-headless activates android-adb interceptor', async () => {
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED = 'true';
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT = '0';

        const activateCalls: any[] = [];
        const bridge = await startAndroidActivationBridgeServer({
            apiModel: {
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async (id: string, proxyPort: number, options: unknown) => {
                    activateCalls.push({ id, proxyPort, options });
                    return { success: true, metadata: { activated: true } };
                }
            } as any,
            ensureProxyPort: async (requestedProxyPort?: number) => ({
                proxyPort: requestedProxyPort ?? 9000,
                session: {
                    created: !requestedProxyPort,
                    source: requestedProxyPort ? 'requested' as const : 'created' as const
                }
            })
        });

        const port = (bridge!.address() as any).port;

        try {
            const response = await fetch(`http://127.0.0.1:${port}/automation/android-adb/start-headless`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    deviceId: 'device-1',
                    proxyPort: 9000,
                    enableSocks: false
                })
            });

            const body = await response.json();
            expect(response.status).to.equal(200);
            expect(body.success).to.equal(true);
            expect(activateCalls).to.deep.equal([
                {
                    id: 'android-adb',
                    proxyPort: 9000,
                    options: { deviceId: 'device-1', enableSocks: false }
                }
            ]);
        } finally {
            await new Promise<void>((resolve, reject) => bridge!.close((err) => err ? reject(err) : resolve()));
        }
    });

    it('activation failures are returned structurally', async () => {
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED = 'true';
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT = '0';

        const bridge = await startAndroidActivationBridgeServer({
            apiModel: {
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async () => {
                    throw new Error('activation-exploded');
                }
            } as any,
            ensureProxyPort: async () => ({
                proxyPort: 9000,
                session: { created: false, source: 'requested' as const }
            })
        });

        const port = (bridge!.address() as any).port;

        try {
            const response = await fetch(`http://127.0.0.1:${port}/automation/android-adb/start-headless`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ deviceId: 'device-1', proxyPort: 9000 })
            });
            const body = await response.json();

            expect(response.status).to.equal(500);
            expect(body.success).to.equal(false);
            expect(body.controlPlaneSuccess).to.equal(false);
            expect(body.errors).to.deep.equal(['activation-bridge-internal-error']);
        } finally {
            await new Promise<void>((resolve, reject) => bridge!.close((err) => err ? reject(err) : resolve()));
        }
    });

    it('contains no qidian-specific logic', () => {
        const source = fs.readFileSync('src/automation/android-activation-bridge-server.ts', 'utf8').toLowerCase();
        expect(source).to.not.contain('qidian');
    });
});
