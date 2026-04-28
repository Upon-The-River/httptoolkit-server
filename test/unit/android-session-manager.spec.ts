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
        expect(result.staleExistingConfig).to.equal(false);
        expect(result.ruleSessionHandleAvailable).to.equal(true);
        expect(result.certificateAvailable).to.equal(true);
        expect(result.certificateContent).to.equal('cert-data');
        expect(result.session).to.equal(sharedSession);
        expect(getConfigCalls).to.equal(1);
        expect(modes).to.deep.equal(['existing']);
    });

    it('recovers stale existing config by starting exactly once and re-reading config', async () => {
        const modes: string[] = [];
        let getConfigCalls = 0;
        const recoveredSession = {
            forGet: () => ({ thenJson: async () => undefined, thenReply: async () => undefined }),
            forAnyRequest: () => ({ thenPassThrough: async () => undefined })
        } as any;

        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => {
                    getConfigCalls += 1;
                    return getConfigCalls === 1
                        ? { certificateContent: 'stale-cert-data' }
                        : { certificateContent: 'fresh-cert-data' };
                }
            } as any,
            proxyPort: 8000,
            createRemoteSession: async (_proxyPort, mode) => {
                modes.push(mode);
                return mode === 'start' ? recoveredSession : undefined;
            }
        });

        expect(result.success).to.equal(true);
        expect(result.source).to.equal('stale-existing-config-recovered-by-remote-start');
        expect(result.staleExistingConfig).to.equal(true);
        expect(result.ruleSessionHandleAvailable).to.equal(true);
        expect(result.certificateContent).to.equal('fresh-cert-data');
        expect(result.warnings).to.deep.equal(['existing-config-without-rule-session-handle']);
        expect(getConfigCalls).to.equal(2);
        expect(modes).to.deep.equal(['existing', 'start']);
    });

    it('fails stale existing config recovery when fresh session cannot be started', async () => {
        const modes: string[] = [];

        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => ({ certificateContent: 'cert-data' })
            } as any,
            proxyPort: 8000,
            createRemoteSession: async (_proxyPort, mode) => {
                modes.push(mode);
                return undefined;
            }
        });

        expect(result.success).to.equal(false);
        expect(result.source).to.equal('unavailable');
        expect(result.staleExistingConfig).to.equal(true);
        expect(result.ruleSessionHandleAvailable).to.equal(false);
        expect(result.errors).to.deep.equal(['stale-existing-config-without-proxy-session']);
        expect(modes).to.deep.equal(['existing', 'start']);
    });

    it('fails stale existing config recovery when refreshed config is unavailable', async () => {
        let getConfigCalls = 0;
        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => {
                    getConfigCalls += 1;
                    return getConfigCalls === 1 ? { certificateContent: 'cert-data' } : undefined;
                }
            } as any,
            proxyPort: 8000,
            createRemoteSession: async (_proxyPort, mode) => mode === 'start'
                ? ({
                    forGet: () => ({ thenJson: async () => undefined, thenReply: async () => undefined }),
                    forAnyRequest: () => ({ thenPassThrough: async () => undefined })
                } as any)
                : undefined
        });

        expect(result.success).to.equal(false);
        expect(result.staleExistingConfig).to.equal(true);
        expect(result.errors).to.deep.equal(['stale-existing-config-recovery-config-unavailable']);
    });

    it('fails stale existing config recovery when refreshed certificate is unavailable', async () => {
        let getConfigCalls = 0;
        const result = await prepareAndroidProxySession({
            apiModel: {
                getConfig: async () => {
                    getConfigCalls += 1;
                    return getConfigCalls === 1
                        ? { certificateContent: 'cert-data' }
                        : { certificateContent: '' };
                }
            } as any,
            proxyPort: 8000,
            createRemoteSession: async (_proxyPort, mode) => mode === 'start'
                ? ({
                    forGet: () => ({ thenJson: async () => undefined, thenReply: async () => undefined }),
                    forAnyRequest: () => ({ thenPassThrough: async () => undefined })
                } as any)
                : undefined
        });

        expect(result.success).to.equal(false);
        expect(result.source).to.equal('stale-existing-config-recovered-by-remote-start');
        expect(result.staleExistingConfig).to.equal(true);
        expect(result.errors).to.deep.equal(['stale-existing-config-recovery-certificate-unavailable']);
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
        expect(result.staleExistingConfig).to.equal(false);
        expect(result.ruleSessionHandleAvailable).to.equal(true);
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
        expect(result.ruleSessionHandleAvailable).to.equal(true);
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
        expect(result.ruleSessionHandleAvailable).to.equal(true);
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
        expect(result.ruleSessionHandleAvailable).to.equal(false);
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
