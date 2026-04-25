import { expect } from 'chai';

import { SessionManager } from '../../src/automation/session-manager';

describe('SessionManager observed traffic detection', () => {
    it('ignores bootstrap-only requests', async () => {
        const seenRequests = [
            { url: 'http://android.httptoolkit.tech/config' },
            { url: 'http://amiusing.httptoolkit.tech/certificate' }
        ];
        const manager = buildSessionManagerWithSeenRequests(seenRequests);

        await manager.startSessionIfNeeded();
        await manager.ensurePassThroughFallbackRule();

        const signal = await manager.getObservedTrafficSignal({
            waitMs: 1,
            pollIntervalMs: 1
        });

        expect(signal.observed).to.equal(false);
        expect(signal.source).to.equal('none');
        expect(signal.ignoredBootstrapRequests).to.equal(2);
        expect(signal.matchingRequests).to.equal(0);
    });

    it('returns observed-session-traffic when non-bootstrap requests are seen', async () => {
        const seenRequests = [
            { url: 'http://android.httptoolkit.tech/config' },
            { url: 'https://druidv6.if.qidian.com/l7/book/list' }
        ];
        const manager = buildSessionManagerWithSeenRequests(seenRequests);

        await manager.startSessionIfNeeded();
        await manager.ensurePassThroughFallbackRule();

        const signal = await manager.getObservedTrafficSignal({
            waitMs: 1,
            pollIntervalMs: 1
        });

        expect(signal.observed).to.equal(true);
        expect(signal.source).to.equal('observed-session-traffic');
        expect(signal.matchingRequests).to.equal(1);
        expect(signal.sampleUrl).to.equal('https://druidv6.if.qidian.com/l7/book/list');
    });

    it('returns none when no session fallback rule is configured', async () => {
        const manager = new SessionManager(() => ({
            start: async () => undefined,
            stop: async () => undefined,
            port: 12345,
            url: 'http://127.0.0.1:12345'
        } as any));

        const signal = await manager.getObservedTrafficSignal({
            waitMs: 1,
            pollIntervalMs: 1
        });

        expect(signal.observed).to.equal(false);
        expect(signal.totalSeenRequests).to.equal(0);
    });
});

function buildSessionManagerWithSeenRequests(requests: Array<{ url: string }>) {
    const fallbackRule = {
        getSeenRequests: async () => requests as any
    };

    const remoteSession = {
        start: async () => undefined,
        stop: async () => undefined,
        port: 12345,
        url: 'http://127.0.0.1:12345',
        forAnyRequest: () => ({
            thenPassThrough: async () => fallbackRule
        })
    };

    return new SessionManager(() => remoteSession as any);
}
