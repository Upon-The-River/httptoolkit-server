import { getRemote, MockedEndpoint, Mockttp, CompletedRequest } from 'mockttp';
import { matchQidianTraffic } from '../qidian/qidian-traffic-matcher';

export interface ActiveSessionResult {
    created: boolean;
    proxyPort: number;
    sessionUrl: string;
}

export interface LatestSessionState {
    active: boolean;
    proxyPort?: number;
    sessionUrl?: string;
}

export interface ObservedTrafficSignal {
    observed: boolean;
    bootstrapOnly?: boolean;
    source: 'none' | 'observed-session-traffic';
    totalSeenRequests: number;
    ignoredBootstrapRequests: number;
    matchingRequests: number;
    sampleUrl?: string;
}

export interface TargetTrafficSignal {
    observed: boolean;
    source: 'none' | 'target-session-traffic';
    totalSeenRequests: number;
    ignoredBootstrapRequests: number;
    matchingRequests: number;
    sampleUrl?: string;
}

export class SessionManager {
    private latestSession: Mockttp | undefined;
    private latestSessionState: LatestSessionState = { active: false };
    private androidBootstrapConfiguredForPort: number | undefined;
    private passThroughFallbackConfiguredForPort: number | undefined;
    private passThroughFallbackRule: MockedEndpoint | undefined;

    constructor(
        private buildRemoteSession: () => Mockttp = () => getRemote({
            adminServerUrl: 'http://127.0.0.1:45456',
            client: {
                headers: { origin: 'https://app.httptoolkit.tech' }
            }
        }),
        private matchTargetTraffic: (url: string) => boolean = (url: string) => matchQidianTraffic(url).matched
    ) {}

    async startSessionIfNeeded(): Promise<ActiveSessionResult> {
        if (this.latestSessionState.active && this.latestSession) {
            return {
                created: false,
                proxyPort: this.latestSession.port,
                sessionUrl: this.latestSession.url
            };
        }

        const remoteSession = this.buildRemoteSession();
        await remoteSession.start();

        this.latestSession = remoteSession;
        this.latestSessionState = {
            active: true,
            proxyPort: remoteSession.port,
            sessionUrl: remoteSession.url
        };

        return {
            created: true,
            proxyPort: remoteSession.port,
            sessionUrl: remoteSession.url
        };
    }

    getLatestSession(): LatestSessionState {
        return this.latestSessionState;
    }

    async stopLatestSession(): Promise<{ stopped: boolean }> {
        if (!this.latestSession) {
            this.latestSessionState = { active: false };
            this.androidBootstrapConfiguredForPort = undefined;
            this.passThroughFallbackConfiguredForPort = undefined;
            return { stopped: false };
        }

        await this.latestSession.stop();
        this.clearLatestSession();

        return { stopped: true };
    }

    clearLatestSession() {
        this.latestSession = undefined;
        this.latestSessionState = { active: false };
        this.androidBootstrapConfiguredForPort = undefined;
        this.passThroughFallbackConfiguredForPort = undefined;
        this.passThroughFallbackRule = undefined;
    }

    async ensureAndroidBootstrapRules(certContent: string): Promise<void> {
        if (!this.latestSession || !this.latestSessionState.active || !this.latestSessionState.proxyPort) {
            throw new Error('No active mock session found to configure Android bootstrap rules');
        }

        const proxyPort = this.latestSessionState.proxyPort;
        if (this.androidBootstrapConfiguredForPort === proxyPort) return;

        await this.latestSession.forGet('http://android.httptoolkit.tech/config').thenJson(200, {
            certificate: certContent
        });
        await this.latestSession.forGet('http://amiusing.httptoolkit.tech/certificate').thenReply(
            200,
            certContent,
            { 'content-type': 'application/x-pem-file; charset=utf-8' }
        );

        this.androidBootstrapConfiguredForPort = proxyPort;
    }

    async ensurePassThroughFallbackRule(): Promise<void> {
        if (!this.latestSession || !this.latestSessionState.active || !this.latestSessionState.proxyPort) {
            throw new Error('No active mock session found to configure pass-through fallback');
        }

        const proxyPort = this.latestSessionState.proxyPort;
        if (this.passThroughFallbackConfiguredForPort === proxyPort) return;

        this.passThroughFallbackRule = await this.latestSession.forAnyRequest().thenPassThrough();
        this.passThroughFallbackConfiguredForPort = proxyPort;
    }

    async getObservedTrafficSignal(options: {
        waitMs?: number,
        pollIntervalMs?: number
    } = {}): Promise<ObservedTrafficSignal> {
        if (!this.passThroughFallbackRule) {
            return {
                observed: false,
                bootstrapOnly: false,
                source: 'none',
                totalSeenRequests: 0,
                ignoredBootstrapRequests: 0,
                matchingRequests: 0
            };
        }

        const waitMs = options.waitMs ?? 4000;
        const pollIntervalMs = options.pollIntervalMs ?? 500;
        const deadline = Date.now() + waitMs;

        let totalSeenRequests = 0;
        let ignoredBootstrapRequests = 0;
        let sampleUrl: string | undefined;

        do {
            const seenRequests = await this.passThroughFallbackRule.getSeenRequests();
            const matchingRequests = this.getNonBootstrapRequests(seenRequests);
            const bootstrapRequests = this.getBootstrapRequests(seenRequests);

            totalSeenRequests = seenRequests.length;
            ignoredBootstrapRequests = bootstrapRequests.length;
            sampleUrl = matchingRequests[0]?.url;

            if (matchingRequests.length > 0) {
                return {
                    observed: true,
                    bootstrapOnly: false,
                    source: 'observed-session-traffic',
                    totalSeenRequests,
                    ignoredBootstrapRequests,
                    matchingRequests: matchingRequests.length,
                    sampleUrl
                };
            }

            if (Date.now() >= deadline) break;
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        } while (Date.now() < deadline);

        return {
            observed: false,
            bootstrapOnly: totalSeenRequests > 0 && ignoredBootstrapRequests === totalSeenRequests,
            source: 'none',
            totalSeenRequests,
            ignoredBootstrapRequests,
            matchingRequests: 0,
            sampleUrl
        };
    }

    async getTargetTrafficSignal(options: {
        waitMs?: number,
        pollIntervalMs?: number
    } = {}): Promise<TargetTrafficSignal> {
        if (!this.passThroughFallbackRule) {
            return {
                observed: false,
                source: 'none',
                totalSeenRequests: 0,
                ignoredBootstrapRequests: 0,
                matchingRequests: 0
            };
        }

        const waitMs = options.waitMs ?? 12000;
        const pollIntervalMs = options.pollIntervalMs ?? 500;
        const deadline = Date.now() + waitMs;

        let totalSeenRequests = 0;
        let ignoredBootstrapRequests = 0;
        let sampleUrl: string | undefined;

        do {
            const seenRequests = await this.passThroughFallbackRule.getSeenRequests();
            const matchingRequests = seenRequests.filter((request) => this.isTargetBusinessRequest(request));
            const bootstrapRequests = this.getBootstrapRequests(seenRequests);

            totalSeenRequests = seenRequests.length;
            ignoredBootstrapRequests = bootstrapRequests.length;
            sampleUrl = matchingRequests[0]?.url;

            if (matchingRequests.length > 0) {
                return {
                    observed: true,
                    source: 'target-session-traffic',
                    totalSeenRequests,
                    ignoredBootstrapRequests,
                    matchingRequests: matchingRequests.length,
                    sampleUrl
                };
            }

            if (Date.now() >= deadline) break;
            await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        } while (Date.now() < deadline);

        return {
            observed: false,
            source: 'none',
            totalSeenRequests,
            ignoredBootstrapRequests,
            matchingRequests: 0,
            sampleUrl
        };
    }

    private getBootstrapRequests(requests: CompletedRequest[]) {
        return requests.filter((request) => this.isBootstrapRequest(request));
    }

    private getNonBootstrapRequests(requests: CompletedRequest[]) {
        return requests.filter((request) => !this.isBootstrapRequest(request));
    }

    private isBootstrapRequest(request: Pick<CompletedRequest, 'url' | 'path'>): boolean {
        const parsedUrl = this.tryParseRequestUrl(request);
        if (!parsedUrl) return false;

        const hostname = parsedUrl.hostname.toLowerCase();
        const pathname = parsedUrl.pathname;

        return (
            (hostname === 'android.httptoolkit.tech' && pathname === '/config') ||
            (hostname === 'amiusing.httptoolkit.tech' && pathname === '/certificate')
        );
    }

    private isTargetBusinessRequest(request: Pick<CompletedRequest, 'url' | 'path'>): boolean {
        const requestUrl = request.url || request.path || '';
        if (!requestUrl || this.isBootstrapRequest(request)) return false;
        return this.matchTargetTraffic(requestUrl);
    }

    private tryParseRequestUrl(request: Pick<CompletedRequest, 'url' | 'path'>): URL | undefined {
        const requestUrl = request.url || request.path;
        if (!requestUrl) return;

        try {
            return new URL(requestUrl);
        } catch {
            try {
                return new URL(`http://${requestUrl}`);
            } catch {
                return;
            }
        }
    }
}
