import * as fs from 'fs';
import * as http from 'http';
import express from 'express';
import { expect } from 'chai';

import { exposeRestAPI } from '../../src/api/rest-api';

describe('REST API automation bridge', () => {
    const startServer = async (options: {
        apiModel?: any,
        ensureProxyPort?: (requestedProxyPort?: number) => Promise<{ proxyPort: number, session: { created: boolean, source: 'requested' | 'created' } }>
    } = {}) => {
        const app = express();
        app.use(express.json());

        const apiModel = options.apiModel ?? {
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
        };

        exposeRestAPI(app, apiModel, {
            ensureProxyPort: options.ensureProxyPort ?? (async (requestedProxyPort?: number) => ({
                proxyPort: requestedProxyPort ?? 8000,
                session: { created: !requestedProxyPort, source: requestedProxyPort ? 'requested' : 'created' }
            }))
        });

        const server = await new Promise<http.Server>((resolve) => {
            const started = app.listen(0, '127.0.0.1', () => resolve(started));
        });

        const port = (server.address() as any).port as number;
        return {
            baseUrl: `http://127.0.0.1:${port}`,
            close: () => new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()))
        };
    };

    it('GET /automation/health returns bridge availability', async () => {
        const server = await startServer();
        try {
            const response = await fetch(`${server.baseUrl}/automation/health`);
            const body = await response.json();

            expect(response.status).to.equal(200);
            expect(body.success).to.equal(true);
            expect(body.bridge.available).to.equal(true);
        } finally {
            await server.close();
        }
    });

    it('POST /automation/android-adb/start-headless returns structured success payload', async () => {
        const activateCalls: any[] = [];
        const server = await startServer({
            apiModel: {
                getVersion: () => 'test-version',
                updateServer: () => undefined,
                shutdownServer: () => undefined,
                getConfig: async () => ({}),
                getNetworkInterfaces: () => ({}),
                getInterceptors: async () => ([]),
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async (_id: string, proxyPort: number, opts: unknown) => {
                    activateCalls.push({ proxyPort, opts });
                    return { success: true, metadata: { activated: true } };
                },
                sendRequest: async () => {
                    throw new Error('not used in this test');
                }
            }
        });

        try {
            const response = await fetch(`${server.baseUrl}/automation/android-adb/start-headless`, {
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
            expect(body.controlPlaneSuccess).to.equal(true);
            expect(body.proxyPort).to.equal(9000);
            expect(body.deviceId).to.equal('device-1');
            expect(body.session.created).to.equal(false);
            expect(activateCalls).to.deep.equal([
                { proxyPort: 9000, opts: { deviceId: 'device-1', enableSocks: false } }
            ]);
        } finally {
            await server.close();
        }
    });

    it('bridge activation failure returns structured failure and does not crash', async () => {
        const server = await startServer({
            apiModel: {
                getVersion: () => 'test-version',
                updateServer: () => undefined,
                shutdownServer: () => undefined,
                getConfig: async () => ({}),
                getNetworkInterfaces: () => ({}),
                getInterceptors: async () => ([]),
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async () => ({ success: false, metadata: { reason: 'mock-failure' } }),
                sendRequest: async () => {
                    throw new Error('not used in this test');
                }
            }
        });

        try {
            const response = await fetch(`${server.baseUrl}/automation/android-adb/start-headless`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ deviceId: 'device-1', proxyPort: 9000 })
            });
            const body = await response.json();

            expect(response.status).to.equal(200);
            expect(body.success).to.equal(false);
            expect(body.controlPlaneSuccess).to.equal(false);
            expect(body.activationResult.success).to.equal(false);
        } finally {
            await server.close();
        }
    });

    it('contains no qidian-specific logic', () => {
        const source = fs.readFileSync('src/api/rest-api.ts', 'utf8').toLowerCase();
        expect(source).to.not.contain('qidian');
    });
});
