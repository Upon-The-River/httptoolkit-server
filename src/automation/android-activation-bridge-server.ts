import * as http from 'http';
import express from 'express';

import { ApiModel } from '../api/api-model';
import { AndroidBootstrapResult, prepareAndroidBootstrapRules } from './android-bootstrap-rules';
import { AndroidProxySessionResult, prepareAndroidProxySession } from './android-session-manager';

const DEFAULT_BRIDGE_HOST = '127.0.0.1';
const DEFAULT_BRIDGE_PORT = 45458;
const TRUSTED_MOCKTTP_ORIGIN = 'https://app.httptoolkit.tech';
const DEFAULT_PROXY_PORT = 8000;

const parseBridgePort = (rawPort: string | undefined): number => {
    const parsed = Number(rawPort);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_BRIDGE_PORT;
};

const isBridgeEnabled = (value: string | undefined): boolean => value === 'true';

const resolveDeviceId = (requestedDeviceId: string | undefined, availableDeviceIds: string[]): {
    deviceId: string | undefined,
    errors: string[]
} => {
    const errors: string[] = [];

    let deviceId = requestedDeviceId;
    if (!deviceId && availableDeviceIds.length === 1) {
        deviceId = availableDeviceIds[0];
    }

    if (!deviceId) {
        errors.push(
            availableDeviceIds.length > 1
                ? 'multiple-devices-connected-specify-deviceid'
                : 'no-android-devices-connected'
        );
    } else if (!availableDeviceIds.includes(deviceId)) {
        errors.push('unknown-deviceid');
    }

    return { deviceId, errors };
};

const emptyBootstrapResult = (proxyPort: number): AndroidBootstrapResult => ({
    applied: false,
    proxyPort,
    rules: [],
    certificateAvailable: false,
    warnings: []
});

export async function startAndroidActivationBridgeServer(options: {
    apiModel: ApiModel,
    prepareProxySession?: (requestedProxyPort: number) => Promise<AndroidProxySessionResult>
}): Promise<http.Server | undefined> {
    if (!isBridgeEnabled(process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED)) return;

    const prepareProxySession = options.prepareProxySession ?? ((requestedProxyPort) => prepareAndroidProxySession({
        apiModel: options.apiModel,
        proxyPort: requestedProxyPort,
        adminBaseUrl: 'http://127.0.0.1:45456',
        origin: TRUSTED_MOCKTTP_ORIGIN
    }));

    const bridgePort = parseBridgePort(process.env.HTK_ANDROID_ACTIVATION_BRIDGE_PORT);

    const app = express();
    app.disable('x-powered-by');
    app.use(express.json());

    app.get('/automation/health', (_req, res) => {
        res.send({
            success: true,
            bridge: {
                available: true,
                routes: [
                    'GET /automation/health',
                    'POST /automation/android-adb/start-headless'
                ]
            }
        });
    });

    app.post('/automation/android-adb/start-headless', async (req, res) => {
        const requestedDeviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined;
        const requestedProxyPort = typeof req.body?.proxyPort === 'number'
            ? req.body.proxyPort
            : DEFAULT_PROXY_PORT;
        const enableSocks = req.body?.enableSocks === true;

        const metadata = await options.apiModel.getInterceptorMetadata('android-adb', 'detailed') as
            | { deviceIds?: string[] }
            | undefined;
        const availableDeviceIds = metadata?.deviceIds ?? [];

        const { deviceId, errors } = resolveDeviceId(requestedDeviceId, availableDeviceIds);
        if (errors.length) {
            res.status(409).send({
                success: false,
                deviceId,
                proxyPort: requestedProxyPort,
                proxySessionPrepared: false,
                proxySessionSource: 'unavailable',
                configAvailable: false,
                certificateAvailable: false,
                staleExistingConfig: false,
                ruleSessionHandleAvailable: false,
                controlPlaneSuccess: false,
                bootstrapRulesApplied: false,
                bootstrapResult: emptyBootstrapResult(requestedProxyPort),
                activationResult: {
                    success: false,
                    metadata: {
                        availableDeviceIds
                    }
                },
                warning: 'VPN/data-plane success must be verified separately.',
                dataPlaneObserved: false,
                errors
            });
            return;
        }

        try {
            const proxySessionPreparation = await prepareProxySession(requestedProxyPort);
            if (!proxySessionPreparation.success || !proxySessionPreparation.ruleSessionHandleAvailable || !proxySessionPreparation.session) {
                const preparationErrors = proxySessionPreparation.success
                    ? ['proxy-rule-session-unavailable']
                    : proxySessionPreparation.errors;

                res.status(500).send({
                    success: false,
                    deviceId,
                    proxyPort: proxySessionPreparation.proxyPort,
                    proxySessionPrepared: false,
                    proxySessionSource: proxySessionPreparation.source,
                    configAvailable: proxySessionPreparation.configAvailable,
                    certificateAvailable: proxySessionPreparation.certificateAvailable,
                    staleExistingConfig: proxySessionPreparation.staleExistingConfig,
                    ruleSessionHandleAvailable: proxySessionPreparation.ruleSessionHandleAvailable,
                    controlPlaneSuccess: false,
                    bootstrapRulesApplied: false,
                    bootstrapResult: emptyBootstrapResult(proxySessionPreparation.proxyPort),
                    activationResult: {
                        success: false,
                        metadata: {
                            proxySessionPreparation
                        }
                    },
                    warning: 'VPN/data-plane success must be verified separately.',
                    dataPlaneObserved: false,
                    errors: preparationErrors
                });
                return;
            }

            const bootstrapResult = await prepareAndroidBootstrapRules(
                options.apiModel,
                proxySessionPreparation.proxyPort,
                {
                    session: proxySessionPreparation.session,
                    certificateContent: proxySessionPreparation.certificateContent
                }
            );
            const bootstrapRulesSource = proxySessionPreparation.source.startsWith('existing-active-session-registry')
                ? 'registry-reused'
                : 'session-rules-applied';

            if (!bootstrapResult.applied) {
                res.status(500).send({
                    success: false,
                    deviceId,
                    proxyPort: proxySessionPreparation.proxyPort,
                    proxySessionPrepared: true,
                    proxySessionSource: proxySessionPreparation.source,
                    configAvailable: proxySessionPreparation.configAvailable,
                    certificateAvailable: proxySessionPreparation.certificateAvailable,
                    staleExistingConfig: proxySessionPreparation.staleExistingConfig,
                    ruleSessionHandleAvailable: proxySessionPreparation.ruleSessionHandleAvailable,
                    bootstrapRulesApplied: false,
                    bootstrapRulesSource,
                    bootstrapResult,
                    controlPlaneSuccess: false,
                    activationResult: {
                        success: false,
                        metadata: {
                            bootstrapWarnings: bootstrapResult.warnings
                        }
                    },
                    warning: 'VPN/data-plane success must be verified separately.',
                    dataPlaneObserved: false,
                    errors: ['android-bootstrap-rules-failed']
                });
                return;
            }

            const activationResult = await options.apiModel.activateInterceptor(
                'android-adb',
                proxySessionPreparation.proxyPort,
                { deviceId, enableSocks }
            ) as { success: boolean, metadata?: unknown };

            const controlPlaneSuccess = activationResult.success === true
                && proxySessionPreparation.success
                && proxySessionPreparation.ruleSessionHandleAvailable
                && proxySessionPreparation.certificateAvailable
                && bootstrapResult.applied;

            res.send({
                success: controlPlaneSuccess,
                deviceId,
                proxyPort: proxySessionPreparation.proxyPort,
                proxySessionPrepared: true,
                proxySessionSource: proxySessionPreparation.source,
                configAvailable: proxySessionPreparation.configAvailable,
                certificateAvailable: proxySessionPreparation.certificateAvailable,
                staleExistingConfig: proxySessionPreparation.staleExistingConfig,
                ruleSessionHandleAvailable: proxySessionPreparation.ruleSessionHandleAvailable,
                bootstrapRulesApplied: bootstrapResult.applied,
                bootstrapRulesSource,
                bootstrapResult,
                controlPlaneSuccess,
                activationResult,
                warning: 'VPN/data-plane success must be verified separately.',
                dataPlaneObserved: false,
                errors
            });
        } catch (error) {
            res.status(500).send({
                success: false,
                deviceId,
                proxyPort: requestedProxyPort,
                proxySessionPrepared: false,
                proxySessionSource: 'unavailable',
                configAvailable: false,
                certificateAvailable: false,
                staleExistingConfig: false,
                ruleSessionHandleAvailable: false,
                controlPlaneSuccess: false,
                bootstrapRulesApplied: false,
                bootstrapResult: emptyBootstrapResult(requestedProxyPort),
                activationResult: {
                    success: false,
                    metadata: {
                        error: error instanceof Error ? error.message : String(error)
                    }
                },
                warning: 'VPN/data-plane success must be verified separately.',
                dataPlaneObserved: false,
                errors: [
                    'activation-bridge-internal-error'
                ]
            });
        }
    });

    return new Promise<http.Server>((resolve, reject) => {
        const server = app.listen(bridgePort, DEFAULT_BRIDGE_HOST, () => resolve(server));
        server.once('error', reject);
    });
}
