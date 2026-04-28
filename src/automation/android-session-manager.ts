import { getRemote, Mockttp } from 'mockttp';

import { ApiModel } from '../api/api-model';

const DEFAULT_ADMIN_BASE_URL = 'http://127.0.0.1:45456';
const DEFAULT_ORIGIN = 'https://app.httptoolkit.tech';

export type AndroidProxySessionSource =
    | 'existing-config'
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
            const existingSession = await createRemoteSession(options.proxyPort, 'existing');
            if (existingSession) {
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

            const recoveredSession = await createRemoteSession(options.proxyPort, 'start');
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

        const session = await createRemoteSession(options.proxyPort, 'start');
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
