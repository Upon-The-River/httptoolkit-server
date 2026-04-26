import express, { Express, NextFunction, Request, Response } from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';

import { AndroidNetworkSafetyApi, AndroidNetworkSafetyService } from './android/android-network-safety';
import { matchQidianTraffic, QidianTrafficMatchResult } from './qidian/qidian-traffic-matcher';
import { HeadlessControlService } from './headless/headless-control-service';
import { HeadlessHealthService } from './headless/headless-health-service';
import { HeadlessControlApi } from './headless/headless-types';
import { buildMigrationStatusRegistry } from './migration/migration-status-registry';
import {
    LatestSessionState,
    SessionManager,
    TargetTrafficSignal
} from './session/session-manager';

export interface SessionManagerLike {
    startSessionIfNeeded(): Promise<{
        created: boolean,
        proxyPort: number,
        sessionUrl: string
    }>;
    getLatestSession(): LatestSessionState;
    stopLatestSession(): Promise<{ stopped: boolean }>;
    getTargetTrafficSignal(options?: { waitMs?: number, pollIntervalMs?: number }): Promise<TargetTrafficSignal>;
}

export interface CreateAppOptions {
    sessionManager?: SessionManagerLike;
    matchTraffic?: (url: string) => QidianTrafficMatchResult;
    androidNetworkSafety?: AndroidNetworkSafetyApi;
    headlessControl?: HeadlessControlApi;
    headlessHealth?: HeadlessHealthService;
}


const asyncHandler = (handler: (req: Request, res: Response, next: NextFunction) => Promise<void>) => {
    return (req: Request, res: Response, next: NextFunction) => {
        void handler(req, res, next).catch(next);
    };
};

export function createApp(options: CreateAppOptions = {}): Express {
    const app = express();
    const sessionManager = options.sessionManager ?? new SessionManager();
    const matchTraffic = options.matchTraffic ?? matchQidianTraffic;
    const androidNetworkSafety = options.androidNetworkSafety ?? new AndroidNetworkSafetyService();
    const headlessControl = options.headlessControl ?? new HeadlessControlService();
    const headlessHealth = options.headlessHealth ?? new HeadlessHealthService(headlessControl.getCapabilities());

    app.use(express.json({ limit: '5mb' }));

    app.get('/health', (_req, res) => {
        res.json({ ok: true, service: 'httptoolkit-lab-addon' });
    });

    app.get('/migration/pending-routes', (_req, res) => {
        res.json(buildMigrationStatusRegistry());
    });

    app.get('/migration/status', (_req, res) => {
        res.json(buildMigrationStatusRegistry());
    });

    app.post('/qidian/match', (req: Request, res: Response) => {
        const inputUrl = req.body?.url;
        if (typeof inputUrl !== 'string' || inputUrl.trim().length === 0) {
            return res.status(400).json({
                ok: false,
                error: 'Expected JSON body: { "url": "https://..." }'
            });
        }

        return res.json({
            url: inputUrl,
            result: matchTraffic(inputUrl)
        });
    });

    app.get('/session/latest', (_req, res) => {
        res.json(sessionManager.getLatestSession());
    });

    app.post('/session/start', asyncHandler(async (_req, res: Response) => {
        const result = await sessionManager.startSessionIfNeeded();
        res.json(result);
    }));

    app.post('/session/stop', asyncHandler(async (_req, res: Response) => {
        const result = await sessionManager.stopLatestSession();
        res.json(result);
    }));

    app.post('/session/target-signal', asyncHandler(async (req: Request, res: Response) => {
        const waitMs = typeof req.body?.waitMs === 'number' ? req.body.waitMs : undefined;
        const pollIntervalMs = typeof req.body?.pollIntervalMs === 'number' ? req.body.pollIntervalMs : undefined;

        const signal = await sessionManager.getTargetTrafficSignal({ waitMs, pollIntervalMs });
        res.json(signal);
    }));

    app.post('/android/network/inspect', asyncHandler(async (req: Request, res: Response) => {
        const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined;
        const report = await androidNetworkSafety.inspectNetwork({ deviceId });
        res.json(report);
    }));

    app.post('/android/network/rescue', asyncHandler(async (_req, res: Response) => {
        const result = await androidNetworkSafety.rescueNetwork();
        res.json(result);
    }));

    app.get('/android/network/capabilities', (_req, res: Response) => {
        res.json(androidNetworkSafety.getCapabilities());
    });

    app.get('/headless/health', (_req, res: Response) => {
        res.json(headlessHealth.getHealth());
    });

    app.post('/headless/start', asyncHandler(async (req: Request, res: Response) => {
        const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined;
        const result = await headlessControl.start({ deviceId });
        headlessHealth.trackAction(result);
        res.json(result);
    }));

    app.post('/headless/stop', asyncHandler(async (req: Request, res: Response) => {
        const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined;
        const result = await headlessControl.stop({ deviceId });
        headlessHealth.trackAction(result);
        res.json(result);
    }));

    app.post('/headless/recover', asyncHandler(async (req: Request, res: Response) => {
        const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined;
        const result = await headlessControl.recover({ deviceId });
        headlessHealth.trackAction(result);
        res.json(result);
    }));

    app.get('/headless/capabilities', (_req, res: Response) => {
        res.json(headlessControl.getCapabilities());
    });

    app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({
            ok: false,
            error: message
        });
    });

    return app;
}

export async function startServer(options: CreateAppOptions & {
    port?: number,
    host?: string
} = {}): Promise<{ app: Express, server: Server, port: number, host: string }> {
    const app = createApp(options);
    const host = options.host ?? '127.0.0.1';
    const port = options.port ?? Number(process.env.HTK_LAB_ADDON_PORT ?? 45457);

    const server = await new Promise<Server>((resolve, reject) => {
        const runningServer = app.listen(port, host, () => resolve(runningServer));
        runningServer.once('error', reject);
    });

    const boundPort = (server.address() as AddressInfo).port;
    console.log(`httptoolkit-lab-addon listening on http://${host}:${boundPort}`);

    return { app, server, port: boundPort, host };
}

if (require.main === module) {
    startServer().catch((error) => {
        console.error('Failed to start httptoolkit-lab-addon:', error);
        process.exit(1);
    });
}
