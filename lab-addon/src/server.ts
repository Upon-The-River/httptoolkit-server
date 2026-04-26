import express, { Express, Request, Response } from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';

import { matchQidianTraffic, QidianTrafficMatchResult } from './qidian/qidian-traffic-matcher';
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
    pendingRoutes?: string[];
}

export const DEFAULT_PENDING_ROUTE_GROUPS = [
    'POST /automation/session/start',
    'GET /automation/session/latest',
    'POST /automation/session/stop-latest',
    'POST /automation/android-adb/start-headless',
    'POST /automation/android-adb/stop-headless',
    'POST /automation/android-adb/recover-headless',
    'POST /automation/android-adb/rescue-network',
    'GET /automation/health',
    'GET /export/stream'
];

export function createApp(options: CreateAppOptions = {}): Express {
    const app = express();
    const sessionManager = options.sessionManager ?? new SessionManager();
    const matchTraffic = options.matchTraffic ?? matchQidianTraffic;
    const pendingRoutes = options.pendingRoutes ?? DEFAULT_PENDING_ROUTE_GROUPS;

    app.use(express.json({ limit: '5mb' }));

    app.get('/health', (_req, res) => {
        res.json({ ok: true, service: 'httptoolkit-lab-addon' });
    });

    app.get('/migration/pending-routes', (_req, res) => {
        res.json({ pendingRoutes });
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

    app.post('/session/start', async (_req, res: Response) => {
        const result = await sessionManager.startSessionIfNeeded();
        res.json(result);
    });

    app.post('/session/stop', async (_req, res: Response) => {
        const result = await sessionManager.stopLatestSession();
        res.json(result);
    });

    app.post('/session/target-signal', async (req: Request, res: Response) => {
        const waitMs = typeof req.body?.waitMs === 'number' ? req.body.waitMs : undefined;
        const pollIntervalMs = typeof req.body?.pollIntervalMs === 'number' ? req.body.pollIntervalMs : undefined;

        const signal = await sessionManager.getTargetTrafficSignal({ waitMs, pollIntervalMs });
        res.json(signal);
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
