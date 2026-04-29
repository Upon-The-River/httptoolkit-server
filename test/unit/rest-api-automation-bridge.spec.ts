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
            const port = (server.address() as any).port;
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
        const port = ((bridge!.address() as any).port);

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

    it('prepares bootstrap rules before activating android-adb interceptor', async () => {
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED = 'true';
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT = '0';

        const callOrder: string[] = [];
        const bridge = await startAndroidActivationBridgeServer({
            apiModel: {
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async () => {
                    callOrder.push('activate-interceptor');
                    return { success: true, metadata: { activated: true } };
                }
            } as any,
            prepareProxySession: async () => ({
                success: true,
                proxyPort: 9000,
                source: 'existing-config',
                configAvailable: true,
                certificateAvailable: true,
                staleExistingConfig: false,
                ruleSessionHandleAvailable: true,
                certificateContent: 'mock-cert-content',
                session: {
                    forGet: (url: string) => ({
                        thenJson: async () => {
                            callOrder.push(`rule-json:${url}`);
                        },
                        thenReply: async () => {
                            callOrder.push(`rule-reply:${url}`);
                        }
                    }),
                    forAnyRequest: () => ({
                        thenPassThrough: async () => {
                            callOrder.push('rule-pass-through');
                        }
                    })
                } as any,
                errors: [],
                warnings: []
            })
        });

        const port = ((bridge!.address() as any).port);

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
            expect(body.proxySessionPrepared).to.equal(true);
            expect(body.proxySessionSource).to.equal('existing-config');
            expect(body.staleExistingConfig).to.equal(false);
            expect(body.ruleSessionHandleAvailable).to.equal(true);
            expect(body.controlPlaneSuccess).to.equal(true);
            expect(body.bootstrapRulesApplied).to.equal(true);
            expect(body.warning).to.equal('VPN/data-plane success must be verified separately.');
            expect(body.dataPlaneObserved).to.equal(false);
            expect(callOrder).to.deep.equal([
                'rule-json:http://android.httptoolkit.tech/config',
                'rule-reply:http://amiusing.httptoolkit.tech/certificate',
                'rule-pass-through',
                'activate-interceptor'
            ]);
        } finally {
            await new Promise<void>((resolve, reject) => bridge!.close((err) => err ? reject(err) : resolve()));
        }
    });

    it('activateInterceptor is not called when session preparation fails', async () => {
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED = 'true';
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT = '0';

        let activationCalled = false;
        const bridge = await startAndroidActivationBridgeServer({
            apiModel: {
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async () => {
                    activationCalled = true;
                    return { success: true, metadata: {} };
                }
            } as any,
            prepareProxySession: async () => ({
                success: false,
                proxyPort: 8000,
                source: 'mockttp-remote-start',
                configAvailable: false,
                certificateAvailable: false,
                staleExistingConfig: false,
                ruleSessionHandleAvailable: false,
                errors: ['proxy-config-unavailable'],
                warnings: []
            })
        });

        const port = ((bridge!.address() as any).port);

        try {
            const response = await fetch(`http://127.0.0.1:${port}/automation/android-adb/start-headless`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ deviceId: 'device-1', proxyPort: 8000 })
            });
            const body = await response.json();

            expect(response.status).to.equal(500);
            expect(body.success).to.equal(false);
            expect(body.controlPlaneSuccess).to.equal(false);
            expect(body.bootstrapRulesApplied).to.equal(false);
            expect(body.errors).to.deep.equal(['proxy-config-unavailable']);
            expect(activationCalled).to.equal(false);
        } finally {
            await new Promise<void>((resolve, reject) => bridge!.close((err) => err ? reject(err) : resolve()));
        }
    });

    it('does not activate interceptor when stale existing-config recovery fails', async () => {
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED = 'true';
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT = '0';

        let activationCalled = false;
        const bridge = await startAndroidActivationBridgeServer({
            apiModel: {
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async () => {
                    activationCalled = true;
                    return { success: true, metadata: {} };
                }
            } as any,
            prepareProxySession: async () => ({
                success: false,
                proxyPort: 8000,
                source: 'unavailable',
                configAvailable: true,
                certificateAvailable: true,
                staleExistingConfig: true,
                ruleSessionHandleAvailable: false,
                errors: ['stale-existing-config-without-proxy-session'],
                warnings: ['existing-config-without-rule-session-handle']
            })
        });

        const port = ((bridge!.address() as any).port);

        try {
            const response = await fetch(`http://127.0.0.1:${port}/automation/android-adb/start-headless`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ deviceId: 'device-1', proxyPort: 8000 })
            });
            const body = await response.json();

            expect(response.status).to.equal(500);
            expect(body.errors).to.deep.equal(['stale-existing-config-without-proxy-session']);
            expect(body.staleExistingConfig).to.equal(true);
            expect(body.ruleSessionHandleAvailable).to.equal(false);
            expect(activationCalled).to.equal(false);
        } finally {
            await new Promise<void>((resolve, reject) => bridge!.close((err) => err ? reject(err) : resolve()));
        }
    });

    it('returns structured failure if bootstrap setup fails', async () => {
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED = 'true';
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT = '0';

        let activationCalled = false;
        const bridge = await startAndroidActivationBridgeServer({
            apiModel: {
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async () => {
                    activationCalled = true;
                    return { success: true, metadata: {} };
                }
            } as any,
            prepareProxySession: async () => ({
                success: true,
                proxyPort: 9000,
                source: 'existing-config',
                configAvailable: true,
                certificateAvailable: true,
                staleExistingConfig: false,
                ruleSessionHandleAvailable: true,
                certificateContent: 'cert-data',
                session: {
                    forGet: () => ({
                        thenJson: async () => {
                            throw new Error('forced-bootstrap-rules-failure');
                        },
                        thenReply: async () => undefined
                    }),
                    forAnyRequest: () => ({
                        thenPassThrough: async () => undefined
                    })
                } as any,
                errors: [],
                warnings: []
            })
        });

        const port = ((bridge!.address() as any).port);

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
            expect(body.bootstrapRulesApplied).to.equal(false);
            expect(body.errors).to.deep.equal(['activation-bridge-internal-error']);
            expect(activationCalled).to.equal(false);
        } finally {
            await new Promise<void>((resolve, reject) => bridge!.close((err) => err ? reject(err) : resolve()));
        }
    });


    it('does not stop proxy session after successful start-headless', async () => {
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED = 'true';
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT = '0';

        let stopCalled = false;
        const bridge = await startAndroidActivationBridgeServer({
            apiModel: {
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async () => ({ success: true, metadata: {} })
            } as any,
            prepareProxySession: async () => ({
                success: true,
                proxyPort: 9000,
                source: 'mockttp-remote-start',
                configAvailable: true,
                certificateAvailable: true,
                staleExistingConfig: false,
                ruleSessionHandleAvailable: true,
                certificateContent: 'cert-data',
                session: {
                    stop: async () => {
                        stopCalled = true;
                    },
                    forGet: () => ({
                        thenJson: async () => undefined,
                        thenReply: async () => undefined
                    }),
                    forAnyRequest: () => ({
                        thenPassThrough: async () => undefined
                    })
                } as any,
                errors: [],
                warnings: []
            })
        });

        const port = ((bridge!.address() as any).port);

        try {
            const response = await fetch(`http://127.0.0.1:${port}/automation/android-adb/start-headless`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ deviceId: 'device-1', proxyPort: 9000 })
            });

            expect(response.status).to.equal(200);
            expect(stopCalled).to.equal(false);
        } finally {
            await new Promise<void>((resolve, reject) => bridge!.close((err) => err ? reject(err) : resolve()));
        }
    });

    it('does not activate interceptor when no usable rule session exists', async () => {
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED = 'true';
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT = '0';

        let activationCalled = false;
        const bridge = await startAndroidActivationBridgeServer({
            apiModel: {
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async () => {
                    activationCalled = true;
                    return { success: true, metadata: {} };
                }
            } as any,
            prepareProxySession: async () => ({
                success: true,
                proxyPort: 9000,
                source: 'existing-config',
                configAvailable: true,
                certificateAvailable: true,
                staleExistingConfig: false,
                ruleSessionHandleAvailable: false,
                certificateContent: 'cert-data',
                errors: [],
                warnings: []
            })
        });

        const port = ((bridge!.address() as any).port);

        try {
            const response = await fetch(`http://127.0.0.1:${port}/automation/android-adb/start-headless`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ deviceId: 'device-1', proxyPort: 9000 })
            });
            const body = await response.json();

            expect(response.status).to.equal(500);
            expect(body.errors).to.deep.equal(['proxy-rule-session-unavailable']);
            expect(activationCalled).to.equal(false);
        } finally {
            await new Promise<void>((resolve, reject) => bridge!.close((err) => err ? reject(err) : resolve()));
        }
    });

    it('applies bootstrap to recovered stale-existing-config session before activation', async () => {
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED = 'true';
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT = '0';

        const callOrder: string[] = [];
        const bridge = await startAndroidActivationBridgeServer({
            apiModel: {
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async () => {
                    callOrder.push('activate-interceptor');
                    return { success: true, metadata: { activated: true } };
                }
            } as any,
            prepareProxySession: async () => ({
                success: true,
                proxyPort: 9000,
                source: 'stale-existing-config-recovered-by-remote-start',
                configAvailable: true,
                certificateAvailable: true,
                staleExistingConfig: true,
                ruleSessionHandleAvailable: true,
                certificateContent: 'recovered-cert',
                session: {
                    forGet: (url: string) => ({
                        thenJson: async () => {
                            callOrder.push(`rule-json:${url}`);
                        },
                        thenReply: async () => {
                            callOrder.push(`rule-reply:${url}`);
                        }
                    }),
                    forAnyRequest: () => ({
                        thenPassThrough: async () => {
                            callOrder.push('rule-pass-through');
                        }
                    })
                } as any,
                errors: [],
                warnings: []
            })
        });

        const port = ((bridge!.address() as any).port);

        try {
            const response = await fetch(`http://127.0.0.1:${port}/automation/android-adb/start-headless`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ deviceId: 'device-1', proxyPort: 9000 })
            });
            const body = await response.json();

            expect(response.status).to.equal(200);
            expect(body.proxySessionSource).to.equal('stale-existing-config-recovered-by-remote-start');
            expect(body.staleExistingConfig).to.equal(true);
            expect(body.ruleSessionHandleAvailable).to.equal(true);
            expect(callOrder).to.deep.equal([
                'rule-json:http://android.httptoolkit.tech/config',
                'rule-reply:http://amiusing.httptoolkit.tech/certificate',
                'rule-pass-through',
                'activate-interceptor'
            ]);
        } finally {
            await new Promise<void>((resolve, reject) => bridge!.close((err) => err ? reject(err) : resolve()));
        }
    });

    it('supports repeated calls on same proxyPort with registry source and no fallback port switch', async () => {
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED = 'true';
        process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT = '0';

        const seenPorts: number[] = [];
        let prepareCalls = 0;
        const bridge = await startAndroidActivationBridgeServer({
            apiModel: {
                getInterceptorMetadata: async () => ({ deviceIds: ['device-1'] }),
                activateInterceptor: async (_name: string, proxyPort: number) => {
                    seenPorts.push(proxyPort);
                    return { success: true, metadata: {} };
                }
            } as any,
            prepareProxySession: async () => {
                prepareCalls += 1;
                return {
                    success: true,
                    proxyPort: 8000,
                    source: prepareCalls === 1 ? 'mockttp-remote-start' : 'existing-active-session-registry',
                    configAvailable: true,
                    certificateAvailable: true,
                    staleExistingConfig: false,
                    ruleSessionHandleAvailable: true,
                    certificateContent: 'cert-data',
                    session: {
                        forGet: () => ({ thenJson: async () => undefined, thenReply: async () => undefined }),
                        forAnyRequest: () => ({ thenPassThrough: async () => undefined })
                    } as any,
                    errors: [],
                    warnings: []
                };
            }
        });
        const port = ((bridge!.address() as any).port);
        try {
            const first = await fetch(`http://127.0.0.1:${port}/automation/android-adb/start-headless`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: 'device-1', proxyPort: 8000 })
            });
            const firstBody = await first.json();
            const second = await fetch(`http://127.0.0.1:${port}/automation/android-adb/start-headless`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deviceId: 'device-1', proxyPort: 8000 })
            });
            const secondBody = await second.json();

            expect(first.status).to.equal(200);
            expect(second.status).to.equal(200);
            expect(secondBody.proxySessionSource).to.equal('existing-active-session-registry');
            expect(firstBody.proxyPort).to.equal(8000);
            expect(secondBody.proxyPort).to.equal(8000);
            expect(seenPorts).to.deep.equal([8000, 8000]);
        } finally {
            await new Promise<void>((resolve, reject) => bridge!.close((err) => err ? reject(err) : resolve()));
        }
    });

    it('contains no qidian-specific logic', () => {
        const bridgeSource = fs.readFileSync('src/automation/android-activation-bridge-server.ts', 'utf8').toLowerCase();
        expect(bridgeSource).to.not.contain('qidian');
    });
});
