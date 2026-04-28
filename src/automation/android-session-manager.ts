import { ApiModel } from '../api/api-model';

const DEFAULT_ADMIN_BASE_URL = 'http://127.0.0.1:45456';
const DEFAULT_ORIGIN = 'https://app.httptoolkit.tech';

export type AndroidProxySessionSource =
    | 'existing-config'
    | 'mockttp-admin-start'
    | 'old-session-manager'
    | 'unavailable';

export interface AndroidProxySessionResult {
    success: boolean;
    proxyPort: number;
    source: AndroidProxySessionSource;
    configAvailable: boolean;
    certificateAvailable: boolean;
    certificateContent?: string;
    errors: string[];
    warnings: string[];
}

export async function prepareAndroidProxySession(options: {
    apiModel: Pick<ApiModel, 'getConfig'>;
    proxyPort: number;
    adminBaseUrl?: string;
    origin?: string;
    fetchImpl?: typeof fetch;
}): Promise<AndroidProxySessionResult> {
    const adminBaseUrl = options.adminBaseUrl ?? DEFAULT_ADMIN_BASE_URL;
    const origin = options.origin ?? DEFAULT_ORIGIN;
    const fetchImpl = options.fetchImpl ?? fetch;

    try {
        const initialConfig = await options.apiModel.getConfig(options.proxyPort);
        const initialCertificate = readCertificateContent(initialConfig);

        if (initialConfig && initialCertificate) {
            return {
                success: true,
                proxyPort: options.proxyPort,
                source: 'existing-config',
                configAvailable: true,
                certificateAvailable: true,
                certificateContent: initialCertificate,
                errors: [],
                warnings: []
            };
        }

        if (initialConfig && !initialCertificate) {
            return {
                success: false,
                proxyPort: options.proxyPort,
                source: 'existing-config',
                configAvailable: true,
                certificateAvailable: false,
                errors: ['proxy-certificate-unavailable'],
                warnings: []
            };
        }

        const startUrl = new URL('/start', adminBaseUrl);
        startUrl.searchParams.set('port', String(options.proxyPort));

        const startResponse = await fetchImpl(startUrl.toString(), {
            method: 'POST',
            headers: {
                Origin: origin
            }
        });

        if (!startResponse.ok) {
            return {
                success: false,
                proxyPort: options.proxyPort,
                source: 'mockttp-admin-start',
                configAvailable: false,
                certificateAvailable: false,
                errors: [`mockttp-admin-start-failed:${startResponse.status}`],
                warnings: []
            };
        }

        const startedConfig = await options.apiModel.getConfig(options.proxyPort);
        const startedCertificate = readCertificateContent(startedConfig);

        return {
            success: !!(startedConfig && startedCertificate),
            proxyPort: options.proxyPort,
            source: startedConfig ? 'mockttp-admin-start' : 'unavailable',
            configAvailable: !!startedConfig,
            certificateAvailable: !!startedCertificate,
            certificateContent: startedCertificate,
            errors: startedConfig
                ? (startedCertificate ? [] : ['proxy-certificate-unavailable'])
                : ['proxy-config-unavailable'],
            warnings: []
        };
    } catch (error) {
        return {
            success: false,
            proxyPort: options.proxyPort,
            source: 'unavailable',
            configAvailable: false,
            certificateAvailable: false,
            errors: [error instanceof Error ? error.message : String(error)],
            warnings: []
        };
    }
}

function readCertificateContent(config: unknown): string | undefined {
    if (!config || typeof config !== 'object') return;

    const rawCertificate = (config as { certificateContent?: unknown }).certificateContent;
    if (typeof rawCertificate !== 'string') return;

    const certificateContent = rawCertificate.trim();
    return certificateContent.length > 0 ? certificateContent : undefined;
}
