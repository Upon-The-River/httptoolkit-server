import { getRemote, Mockttp } from 'mockttp';

import { ApiModel } from '../api/api-model';

const DEFAULT_ADMIN_BASE_URL = 'http://127.0.0.1:45456';
const DEFAULT_ORIGIN = 'https://app.httptoolkit.tech';

export type AndroidProxySessionSource =
    | 'existing-config'
    | 'existing-active-session-registry'
    | 'existing-active-session-registry-after-eaddrinuse'
    | 'stale-existing-config-recovered-by-remote-start'
    | 'mockttp-remote-start'
    | 'unavailable';

export interface AndroidProxySessionResult {
    success: boolean;
    proxyPort: number;
    source: AndroidProxySessionSource;
    configAvailable: boolean;
    certificateAvailable: boolean;
    staleExistingConfig: boolean;
    ruleSessionHandleAvailable: boolean;
    certificateContent?: string;
    session?: Pick<Mockttp, 'forGet' | 'forAnyRequest'>;
    errors: string[];
    warnings: string[];
}

export async function prepareAndroidProxySession(options: {
    apiModel: Pick<ApiModel, 'getConfig'>;
    proxyPort: number;
    adminBaseUrl?: string;
    origin?: string;
    createRemoteSession?: (proxyPort: number, mode: 'start' | 'existing') => Promise<Pick<Mockttp, 'forGet' | 'forAnyRequest'> | undefined>;
}): Promise<AndroidProxySessionResult> {
    const adminBaseUrl = options.adminBaseUrl ?? DEFAULT_ADMIN_BASE_URL;
    const origin = options.origin ?? DEFAULT_ORIGIN;
    const createRemoteSession = options.createRemoteSession ?? createDefaultRemoteSession(adminBaseUrl, origin);

    try {
        const initialConfig = await options.apiModel.getConfig(options.proxyPort);
        const initialCertificate = readCertificateContent(initialConfig);

        if (initialConfig && !initialCertificate) {
            return {
                success: false,
                proxyPort: options.proxyPort,
                source: 'existing-config',
                configAvailable: true,
                certificateAvailable: false,
                staleExistingConfig: false,
                ruleSessionHandleAvailable: false,
                errors: ['proxy-certificate-unavailable'],
                warnings: []
            };
        }

        if (initialConfig && initialCertificate) {
            const registrySession = getRegistryEntry(options.proxyPort, initialCertificate);
            if (registrySession) {
                return {
                    success: true,
                    proxyPort: options.proxyPort,
                    source: 'existing-active-session-registry',
                    configAvailable: true,
                    certificateAvailable: true,
                    staleExistingConfig: false,
                    ruleSessionHandleAvailable: true,
                    certificateContent: initialCertificate,
                    session: registrySession.session,
                    errors: [],
                    warnings: []
                };
            }

            const existingSession = await createRemoteSession(options.proxyPort, 'existing');
            if (existingSession) {
                upsertRegistryEntry({
                    proxyPort: options.proxyPort,
                    session: existingSession,
                    certificateContent: initialCertificate,
                    configAvailable: true,
                    certificateAvailable: true,
                    source: 'existing-config'
                });
                return {
                    success: true,
                    proxyPort: options.proxyPort,
                    source: 'existing-config',
                    configAvailable: true,
                    certificateAvailable: true,
                    staleExistingConfig: false,
                    ruleSessionHandleAvailable: true,
                    certificateContent: initialCertificate,
                    session: existingSession,
                    errors: [],
                    warnings: []
                };
            }

            let recoveredSession: Pick<Mockttp, 'forGet' | 'forAnyRequest'> | undefined;
            try {
                recoveredSession = await createRemoteSession(options.proxyPort, 'start');
            } catch (error) {
                if (isAddrInUseError(error)) {
                    const fallbackRegistrySession = getRegistryEntry(options.proxyPort, initialCertificate);
                    if (fallbackRegistrySession) {
                        return {
                            success: true,
                            proxyPort: options.proxyPort,
                            source: 'existing-active-session-registry-after-eaddrinuse',
                            configAvailable: true,
                            certificateAvailable: true,
                            staleExistingConfig: false,
                            ruleSessionHandleAvailable: true,
                            certificateContent: initialCertificate,
                            session: fallbackRegistrySession.session,
                            errors: [],
                            warnings: ['mockttp-start-eaddrinuse-registry-reused']
                        };
                    }
                    return {
                        success: false,
                        proxyPort: options.proxyPort,
                        source: 'unavailable',
                        configAvailable: true,
                        certificateAvailable: true,
                        staleExistingConfig: true,
                        ruleSessionHandleAvailable: false,
                        certificateContent: initialCertificate,
                        errors: ['proxy-port-in-use-without-session-handle'],
                        warnings: ['existing-config-without-rule-session-handle']
                    };
                }
                throw error;
            }
            if (!recoveredSession) {
                return {
                    success: false,
                    proxyPort: options.proxyPort,
                    source: 'unavailable',
                    configAvailable: true,
                    certificateAvailable: true,
                    staleExistingConfig: true,
                    ruleSessionHandleAvailable: false,
                    certificateContent: initialCertificate,
                    errors: ['stale-existing-config-without-proxy-session'],
                    warnings: ['existing-config-without-rule-session-handle']
                };
            }

            const recoveredConfig = await options.apiModel.getConfig(options.proxyPort);
            if (!recoveredConfig) {
                return {
                    success: false,
                    proxyPort: options.proxyPort,
                    source: 'unavailable',
                    configAvailable: false,
                    certificateAvailable: false,
                    staleExistingConfig: true,
                    ruleSessionHandleAvailable: true,
                    errors: ['stale-existing-config-recovery-config-unavailable'],
                    warnings: ['existing-config-without-rule-session-handle']
                };
            }

            const recoveredCertificate = readCertificateContent(recoveredConfig);
            if (!recoveredCertificate) {
                return {
                    success: false,
                    proxyPort: options.proxyPort,
                    source: 'stale-existing-config-recovered-by-remote-start',
                    configAvailable: true,
                    certificateAvailable: false,
                    staleExistingConfig: true,
                    ruleSessionHandleAvailable: true,
                    errors: ['stale-existing-config-recovery-certificate-unavailable'],
                    warnings: ['existing-config-without-rule-session-handle']
                };
            }
            upsertRegistryEntry({
                proxyPort: options.proxyPort,
                session: recoveredSession,
                certificateContent: recoveredCertificate,
                configAvailable: true,
                certificateAvailable: true,
                source: 'stale-existing-config-recovered-by-remote-start'
            });

            return {
                success: true,
                proxyPort: options.proxyPort,
                source: 'stale-existing-config-recovered-by-remote-start',
                configAvailable: true,
                certificateAvailable: true,
                staleExistingConfig: true,
                ruleSessionHandleAvailable: true,
                certificateContent: recoveredCertificate,
                session: recoveredSession,
                errors: [],
                warnings: ['existing-config-without-rule-session-handle']
            };
        }

        let session: Pick<Mockttp, 'forGet' | 'forAnyRequest'> | undefined;
        try {
            session = await createRemoteSession(options.proxyPort, 'start');
        } catch (error) {
            if (isAddrInUseError(error)) {
                const registrySession = getRegistryEntry(options.proxyPort);
                if (registrySession) {
                    return {
                        success: true,
                        proxyPort: options.proxyPort,
                        source: 'existing-active-session-registry-after-eaddrinuse',
                        configAvailable: registrySession.configAvailable,
                        certificateAvailable: registrySession.certificateAvailable,
                        staleExistingConfig: false,
                        ruleSessionHandleAvailable: true,
                        certificateContent: registrySession.certificateContent,
                        session: registrySession.session,
                        errors: [],
                        warnings: ['mockttp-start-eaddrinuse-registry-reused']
                    };
                }
                return {
                    success: false,
                    proxyPort: options.proxyPort,
                    source: 'unavailable',
                    configAvailable: false,
                    certificateAvailable: false,
                    staleExistingConfig: false,
                    ruleSessionHandleAvailable: false,
                    errors: ['proxy-port-in-use-without-session-handle'],
                    warnings: []
                };
            }
            throw error;
        }
        if (!session) {
            return {
                success: false,
                proxyPort: options.proxyPort,
                source: 'mockttp-remote-start',
                configAvailable: false,
                certificateAvailable: false,
                staleExistingConfig: false,
                ruleSessionHandleAvailable: false,
                errors: ['proxy-rule-session-unavailable'],
                warnings: []
            };
        }

        const startedConfig = await options.apiModel.getConfig(options.proxyPort);
        const startedCertificate = readCertificateContent(startedConfig);

        if (!startedConfig) {
            return {
                success: false,
                proxyPort: options.proxyPort,
                source: 'unavailable',
                configAvailable: false,
                certificateAvailable: false,
                staleExistingConfig: false,
                ruleSessionHandleAvailable: true,
                errors: ['proxy-config-unavailable'],
                warnings: []
            };
        }

        if (!startedCertificate) {
            return {
                success: false,
                proxyPort: options.proxyPort,
                source: 'mockttp-remote-start',
                configAvailable: true,
                certificateAvailable: false,
                staleExistingConfig: false,
                ruleSessionHandleAvailable: true,
                errors: ['proxy-certificate-unavailable'],
                warnings: []
            };
        }
        upsertRegistryEntry({
            proxyPort: options.proxyPort,
            session,
            certificateContent: startedCertificate,
            configAvailable: true,
            certificateAvailable: true,
            source: 'mockttp-remote-start'
        });

        return {
            success: true,
            proxyPort: options.proxyPort,
            source: 'mockttp-remote-start',
            configAvailable: true,
            certificateAvailable: true,
            staleExistingConfig: false,
            ruleSessionHandleAvailable: true,
            certificateContent: startedCertificate,
            session,
            errors: [],
            warnings: []
        };
    } catch (error) {
        return {
            success: false,
            proxyPort: options.proxyPort,
            source: 'unavailable',
            configAvailable: false,
            certificateAvailable: false,
            staleExistingConfig: false,
            ruleSessionHandleAvailable: false,
            errors: [error instanceof Error ? error.message : String(error)],
            warnings: []
        };
    }
}

type AndroidSessionRegistryEntry = {
    proxyPort: number;
    session: Pick<Mockttp, 'forGet' | 'forAnyRequest'>;
    certificateContent?: string;
    configAvailable: boolean;
    certificateAvailable: boolean;
    bootstrapRulesApplied?: boolean;
    createdAt: number;
    lastUsedAt: number;
    source: AndroidProxySessionSource;
};

const activeSessionRegistry = new Map<number, AndroidSessionRegistryEntry>();

function upsertRegistryEntry(entry: Omit<AndroidSessionRegistryEntry, 'createdAt' | 'lastUsedAt'>) {
    const now = Date.now();
    const existing = activeSessionRegistry.get(entry.proxyPort);
    activeSessionRegistry.set(entry.proxyPort, {
        ...entry,
        createdAt: existing?.createdAt ?? now,
        lastUsedAt: now,
        bootstrapRulesApplied: existing?.bootstrapRulesApplied
    });
}

function getRegistryEntry(proxyPort: number, certificateContent?: string): AndroidSessionRegistryEntry | undefined {
    const entry = activeSessionRegistry.get(proxyPort);
    if (!entry) return;
    if (certificateContent !== undefined && entry.certificateContent !== certificateContent) return;
    entry.lastUsedAt = Date.now();
    return entry;
}

function isAddrInUseError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.toLowerCase().includes('eaddrinuse');
}

export function __resetAndroidSessionRegistryForTests() {
    activeSessionRegistry.clear();
}

const createDefaultRemoteSession = (adminBaseUrl: string, origin: string) => {
    return async (proxyPort: number, mode: 'start' | 'existing') => {
        if (mode !== 'start') return undefined;

        const session = getRemote({
            adminServerUrl: adminBaseUrl,
            client: {
                headers: {
                    origin
                }
            }
        });

        await session.start(proxyPort);
        return session;
    };
};

function readCertificateContent(config: unknown): string | undefined {
    if (!config || typeof config !== 'object') return;

    const rawCertificate = (config as { certificateContent?: unknown }).certificateContent;
    if (typeof rawCertificate !== 'string') return;

    const certificateContent = rawCertificate.trim();
    return certificateContent.length > 0 ? certificateContent : undefined;
}
