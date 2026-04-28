import { getRemote, Mockttp } from 'mockttp';

import { ApiModel } from '../api/api-model';

const TRUSTED_MOCKTTP_ORIGIN = 'https://app.httptoolkit.tech';

export interface AndroidBootstrapResult {
    applied: boolean;
    proxyPort: number;
    rules: string[];
    certificateAvailable: boolean;
    warnings: string[];
}

export async function prepareAndroidBootstrapRules(
    apiModel: Pick<ApiModel, 'getConfig'>,
    proxyPort: number,
    options: {
        session?: Pick<Mockttp, 'forGet' | 'forAnyRequest'>;
        ensurePassThroughFallback?: boolean;
        certificateContent?: string;
    } = {}
): Promise<AndroidBootstrapResult> {
    const warnings: string[] = [];
    const rules: string[] = [];

    const config = options.certificateContent === undefined
        ? await apiModel.getConfig(proxyPort)
        : undefined;
    const certificateContent = options.certificateContent ?? config?.certificateContent;
    const certificateAvailable = typeof certificateContent === 'string' && certificateContent.length > 0;

    if (!certificateAvailable) {
        warnings.push('certificate-content-unavailable');
    }

    const session = options.session ?? await startManagedSession(proxyPort);

    if (certificateAvailable) {
        await session.forGet('http://android.httptoolkit.tech/config').thenJson(200, {
            certificate: certificateContent
        });
        rules.push('android-config-certificate-json');

        await session.forGet('http://amiusing.httptoolkit.tech/certificate').thenReply(
            200,
            certificateContent,
            { 'content-type': 'application/x-pem-file; charset=utf-8' }
        );
        rules.push('android-certificate-pem');
    }

    if (options.ensurePassThroughFallback !== false) {
        await session.forAnyRequest().thenPassThrough();
        rules.push('pass-through-fallback');
    }

    return {
        applied: rules.length > 0,
        proxyPort,
        rules,
        certificateAvailable,
        warnings
    };
}

async function startManagedSession(proxyPort: number): Promise<Pick<Mockttp, 'forGet' | 'forAnyRequest'>> {
    const session = getRemote({
        adminServerUrl: 'http://127.0.0.1:45456',
        client: {
            headers: {
                origin: TRUSTED_MOCKTTP_ORIGIN
            }
        }
    });
    await session.start(proxyPort);
    return session;
}
