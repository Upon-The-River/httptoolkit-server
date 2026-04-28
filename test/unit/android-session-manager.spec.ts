import * as fs from 'fs';
import { expect } from 'chai';

import { prepareAndroidProxySession } from '../../src/automation/android-session-manager';

describe('prepareAndroidProxySession', () => {
    it('reuses existing config with certificate and does not call start mode', async () => {
        let getConfigCalls = 0;
        const modes: string[] = [];

        const sharedSession = {
            forGet: () => ({ thenJson: async () => undefined, thenReply: async () => undefined }),
            forAnyRequest: () => ({ thenPassThrough: async () => undefined })
        } as any;

        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => {
                    getConfigCalls += 1;
                    return { certificateContent: 'cert-data' };
                }
            } as any,
            proxyPort: 8000,
            createRemoteSession: async (_proxyPort, mode) => {
                modes.push(mode);
                return mode === 'existing' ? sharedSession : undefined;
            }
        });

        expect(result.success).to.equal(true);
        expect(result.source).to.equal('existing-config');
        expect(result.certificateAvailable).to.equal(true);
        expect(result.certificateContent).to.equal('cert-data');
        expect(result.session).to.equal(sharedSession);
        expect(getConfigCalls).to.equal(1);
        expect(modes).to.deep.equal(['existing']);
    });

    it('returns structured failure for existing config without a safe rule session handle', async () => {
        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => ({ certificateContent: 'cert-data' })
            } as any,
            proxyPort: 8000,
            createRemoteSession: async () => undefined
        });

        expect(result.success).to.equal(false);
        expect(result.source).to.equal('existing-config');
        expect(result.errors).to.deep.equal(['existing-config-without-rule-session-handle']);
    });

    it('starts remote session exactly once and checks config after start', async () => {
        let getConfigCalls = 0;
        const modes: string[] = [];

        const sharedSession = {
            forGet: () => ({ thenJson: async () => undefined, thenReply: async () => undefined }),
            forAnyRequest: () => ({ thenPassThrough: async () => undefined })
        } as any;

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
            createRemoteSession: async (_proxyPort, mode) => {
                modes.push(mode);
                return mode === 'start' ? sharedSession : undefined;
            }
        });

        expect(result.success).to.equal(true);
        expect(result.source).to.equal('mockttp-remote-start');
        expect(result.session).to.equal(sharedSession);
        expect(getConfigCalls).to.equal(2);
        expect(modes).to.deep.equal(['start']);
    });

    it('fails when config remains unavailable after remote start', async () => {
        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => undefined
            } as any,
            proxyPort: 8000,
            createRemoteSession: async () => ({
                forGet: () => ({ thenJson: async () => undefined, thenReply: async () => undefined }),
                forAnyRequest: () => ({ thenPassThrough: async () => undefined })
            } as any)
        });

        expect(result.success).to.equal(false);
        expect(result.source).to.equal('unavailable');
        expect(result.errors).to.deep.equal(['proxy-config-unavailable']);
    });

    it('fails when config exists but certificate is missing after remote start', async () => {
        let getConfigCalls = 0;
        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => {
                    getConfigCalls += 1;
                    return getConfigCalls === 1 ? undefined : { certificateContent: '' };
                }
            } as any,
            proxyPort: 8000,
            createRemoteSession: async () => ({
                forGet: () => ({ thenJson: async () => undefined, thenReply: async () => undefined }),
                forAnyRequest: () => ({ thenPassThrough: async () => undefined })
            } as any)
        });

        expect(result.success).to.equal(false);
        expect(result.source).to.equal('mockttp-remote-start');
        expect(result.configAvailable).to.equal(true);
        expect(result.certificateAvailable).to.equal(false);
        expect(result.errors).to.deep.equal(['proxy-certificate-unavailable']);
    });

    it('returns structured failure when start cannot provide a rule session handle', async () => {
        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => undefined
            } as any,
            proxyPort: 8001,
            createRemoteSession: async () => undefined
        });

        expect(result.success).to.equal(false);
        expect(result.source).to.equal('mockttp-remote-start');
        expect(result.errors).to.deep.equal(['proxy-rule-session-unavailable']);
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
