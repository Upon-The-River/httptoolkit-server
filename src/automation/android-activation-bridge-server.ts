import * as http from 'http';
import express from 'express';
import { getRemote } from 'mockttp';

import { ApiModel } from '../api/api-model';

const DEFAULT_BRIDGE_HOST = '127.0.0.1';
const DEFAULT_BRIDGE_PORT = 45458;

type BridgeSession = { created: boolean, source: 'requested' | 'created' };

const parseBridgePort = (rawPort: string | undefined): number => {
    const parsed = Number(rawPort);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_BRIDGE_PORT;
};

const isBridgeEnabled = (value: string | undefined): boolean => value === 'true';

async function defaultEnsureProxyPort(requestedProxyPort?: number): Promise<{
    proxyPort: number,
    session: BridgeSession
}> {
    if (requestedProxyPort) {
        return {
            proxyPort: requestedProxyPort,
            session: { created: false, source: 'requested' }
        };
    }

    const session = getRemote({ adminServerUrl: 'http://127.0.0.1:45456' });
    await session.start();

    return {
        proxyPort: session.port,
        session: { created: true, source: 'created' }
    };
}

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

export async function startAndroidActivationBridgeServer(options: {
    apiModel: ApiModel,
    ensureProxyPort?: (requestedProxyPort?: number) => Promise<{
        proxyPort: number,
        session: BridgeSession
    }>
}): Promise<http.Server | undefined> {
    if (!isBridgeEnabled(process.env.HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED)) return;

    const ensureProxyPort = options.ensureProxyPort ?? defaultEnsureProxyPort;
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
            : undefined;
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
                proxyPort: requestedProxyPort ?? 0,
                controlPlaneSuccess: false,
                session: {
                    active: false,
                    created: false,
                    source: 'requested'
                },
                activationResult: {
                    success: false,
                    metadata: {
                        availableDeviceIds
                    }
                },
                errors
            });
            return;
        }

        try {
            const session = await ensureProxyPort(requestedProxyPort);
            const activationResult = await options.apiModel.activateInterceptor(
                'android-adb',
                session.proxyPort,
                { deviceId, enableSocks }
            ) as { success: boolean, metadata?: unknown };

            const controlPlaneSuccess = activationResult.success === true;
            res.send({
                success: controlPlaneSuccess,
                deviceId,
                proxyPort: session.proxyPort,
                controlPlaneSuccess,
                session: {
                    active: controlPlaneSuccess,
                    created: session.session.created,
                    source: session.session.source
                },
                activationResult,
                errors
            });
        } catch (error) {
            res.status(500).send({
                success: false,
                deviceId,
                proxyPort: requestedProxyPort ?? 0,
                controlPlaneSuccess: false,
                session: {
                    active: false,
                    created: false,
                    source: requestedProxyPort ? 'requested' : 'created'
                },
                activationResult: {
                    success: false,
                    metadata: {
                        error: error instanceof Error ? error.message : String(error)
                    }
                },
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
