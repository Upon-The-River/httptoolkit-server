import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { SessionManager } from '../src/session/session-manager';

describe('SessionManager target matcher injection', () => {
    it('uses the injected matcher to detect target traffic', async () => {
        const matcherCalls: string[] = [];
        const injectedMatcher = (url: string) => {
            matcherCalls.push(url);
            return url.includes('custom-target-host');
        };
        const manager = new SessionManager(undefined, injectedMatcher);

        (manager as any).passThroughFallbackRule = {
            getSeenRequests: async () => [
                { url: 'https://unrelated.example/path' },
                { url: 'https://custom-target-host.example/path' }
            ]
        };

        const result = await manager.getTargetTrafficSignal({ waitMs: 0, pollIntervalMs: 0 });

        assert.equal(result.observed, true);
        assert.equal(result.source, 'target-session-traffic');
        assert.equal(result.matchingRequests, 1);
        assert.equal(result.sampleUrl, 'https://custom-target-host.example/path');
        assert.deepEqual(matcherCalls, [
            'https://unrelated.example/path',
            'https://custom-target-host.example/path'
        ]);
    });

    it('does not pass bootstrap requests to the injected matcher', async () => {
        let invocationCount = 0;
        const injectedMatcher = () => {
            invocationCount += 1;
            return true;
        };
        const manager = new SessionManager(undefined, injectedMatcher);

        (manager as any).passThroughFallbackRule = {
            getSeenRequests: async () => [
                { url: 'http://android.httptoolkit.tech/config' },
                { url: 'http://amiusing.httptoolkit.tech/certificate' }
            ]
        };

        const result = await manager.getTargetTrafficSignal({ waitMs: 0, pollIntervalMs: 0 });

        assert.equal(result.observed, false);
        assert.equal(result.source, 'none');
        assert.equal(result.ignoredBootstrapRequests, 2);
        assert.equal(result.matchingRequests, 0);
        assert.equal(invocationCount, 0);
    });
});
