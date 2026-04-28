import * as fs from 'fs';
import { expect } from 'chai';

import { prepareAndroidProxySession } from '../../src/automation/android-session-manager';

describe('prepareAndroidProxySession', () => {
    it('reuses existing config with certificate and does not call admin start', async () => {
        let fetchCalled = false;
        let getConfigCalls = 0;

        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => {
                    getConfigCalls += 1;
                    return { certificateContent: 'cert-data' };
                }
            } as any,
            proxyPort: 8000,
            fetchImpl: async () => {
                fetchCalled = true;
                throw new Error('should not be called');
            }
        });

        expect(result.success).to.equal(true);
        expect(result.source).to.equal('existing-config');
        expect(result.certificateAvailable).to.equal(true);
        expect(result.certificateContent).to.equal('cert-data');
        expect(getConfigCalls).to.equal(1);
        expect(fetchCalled).to.equal(false);
    });

    it('calls admin start with POST + Origin and then rechecks getConfig', async () => {
        const calls: Array<{ url: string, method?: string, origin?: string | null }> = [];
        let getConfigCalls = 0;

        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => {
                    getConfigCalls += 1;
                    return getConfigCalls === 1
                        ? undefined
                        : { certificateContent: 'cert-data' };
                }
            } as any,
            proxyPort: 8000,
            adminBaseUrl: 'http://127.0.0.1:45456',
            origin: 'https://app.httptoolkit.tech',
            fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
                const url = typeof input === 'string' ? input : input.toString();
                const originHeader = (init?.headers as Record<string, string> | undefined)?.Origin ?? null;
                calls.push({ url, method: init?.method, origin: originHeader });

                return {
                    ok: true,
                    status: 200
                } as Response;
            }
        });

        expect(result.success).to.equal(true);
        expect(result.source).to.equal('mockttp-admin-start');
        expect(getConfigCalls).to.equal(2);
        expect(calls).to.have.length(1);
        expect(calls[0].method).to.equal('POST');
        expect(calls[0].url).to.equal('http://127.0.0.1:45456/start?port=8000');
        expect(calls[0].origin).to.equal('https://app.httptoolkit.tech');
    });

    it('fails when admin start returns 200 but config remains unavailable', async () => {
        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => undefined
            } as any,
            proxyPort: 8000,
            fetchImpl: async () => ({ ok: true, status: 200 } as Response)
        });

        expect(result.success).to.equal(false);
        expect(result.source).to.equal('unavailable');
        expect(result.errors).to.deep.equal(['proxy-config-unavailable']);
    });

    it('fails when config exists but certificate is missing', async () => {
        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => ({ certificateContent: '' })
            } as any,
            proxyPort: 8000,
            fetchImpl: async () => ({ ok: true, status: 200 } as Response)
        });

        expect(result.success).to.equal(false);
        expect(result.configAvailable).to.equal(true);
        expect(result.certificateAvailable).to.equal(false);
        expect(result.errors).to.deep.equal(['proxy-certificate-unavailable']);
    });

    it('does not call GET /start and does not omit Origin header', async () => {
        const calls: Array<{ method?: string, origin?: string | null }> = [];

        await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => undefined
            } as any,
            proxyPort: 8001,
            fetchImpl: async (_input: RequestInfo | URL, init?: RequestInit) => {
                const originHeader = (init?.headers as Record<string, string> | undefined)?.Origin ?? null;
                calls.push({ method: init?.method, origin: originHeader });
                return { ok: false, status: 403 } as Response;
            }
        });

        expect(calls).to.have.length(1);
        expect(calls[0].method).to.equal('POST');
        expect(calls[0].origin).to.equal('https://app.httptoolkit.tech');
    });

    it('returns structured errors instead of throwing', async () => {
        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => {
                    throw new Error('boom');
                }
            } as any,
            proxyPort: 8000
        });

        expect(result.success).to.equal(false);
        expect(result.errors).to.deep.equal(['boom']);
    });

    it('contains no qidian or export/jsonl logic', () => {
        const source = fs.readFileSync('src/automation/android-session-manager.ts', 'utf8').toLowerCase();
        expect(source).to.not.contain('qidian');
        expect(source).to.not.contain('jsonl');
        expect(source).to.not.contain('/export');
    });
});
