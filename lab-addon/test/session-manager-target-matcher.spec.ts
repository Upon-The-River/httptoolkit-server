import { describe, expect, it, vi } from 'vitest';

import { SessionManager } from '../src/session/session-manager';

describe('SessionManager target matcher injection', () => {
    it('uses the injected matcher to detect target traffic', async () => {
        const injectedMatcher = vi.fn((url: string) => url.includes('custom-target-host'));
        const manager = new SessionManager(undefined, injectedMatcher);

        (manager as any).passThroughFallbackRule = {
            getSeenRequests: async () => [
                { url: 'https://unrelated.example/path' },
                { url: 'https://custom-target-host.example/path' }
            ]
        };

        const result = await manager.getTargetTrafficSignal({ waitMs: 0, pollIntervalMs: 0 });

        expect(result.observed).toBe(true);
        expect(result.source).toBe('target-session-traffic');
        expect(result.matchingRequests).toBe(1);
        expect(result.sampleUrl).toBe('https://custom-target-host.example/path');
        expect(injectedMatcher).toHaveBeenCalledWith('https://unrelated.example/path');
        expect(injectedMatcher).toHaveBeenCalledWith('https://custom-target-host.example/path');
    });

    it('does not pass bootstrap requests to the injected matcher', async () => {
        const injectedMatcher = vi.fn(() => true);
        const manager = new SessionManager(undefined, injectedMatcher);

        (manager as any).passThroughFallbackRule = {
            getSeenRequests: async () => [
                { url: 'http://android.httptoolkit.tech/config' },
                { url: 'http://amiusing.httptoolkit.tech/certificate' }
            ]
        };

        const result = await manager.getTargetTrafficSignal({ waitMs: 0, pollIntervalMs: 0 });

        expect(result.observed).toBe(false);
        expect(result.source).toBe('none');
        expect(result.ignoredBootstrapRequests).toBe(2);
        expect(result.matchingRequests).toBe(0);
        expect(injectedMatcher).not.toHaveBeenCalled();
    });
});
