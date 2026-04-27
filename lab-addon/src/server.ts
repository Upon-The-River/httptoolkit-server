import express, { Express, NextFunction, Request, Response } from 'express';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';

import { AndroidNetworkSafetyApi, AndroidNetworkSafetyService } from './android/android-network-safety';
import { AndroidAdbStartHeadlessService } from './automation/android-adb-start-headless-service';
import { AutomationHealthStore } from './automation/automation-health-store';
import { AndroidActivationClient, SafeStubAndroidActivationClient } from './automation/android-activation-client';
import { matchQidianTraffic, QidianTrafficMatchResult } from './qidian/qidian-traffic-matcher';
import { HeadlessControlService } from './headless/headless-control-service';
import { HeadlessHealthService } from './headless/headless-health-service';
import { HeadlessControlApi } from './headless/headless-types';
import { buildMigrationStatusRegistry } from './migration/migration-status-registry';
import { getExportCapabilities } from './export/export-capabilities';
import { matchExportEvent } from './export/export-event-matcher';
import { ExportIngestService } from './export/export-ingest-service';
import { ExportFileSink } from './export/export-file-sink';
import { loadExportTargetsConfig } from './export/export-targets';
import { SyntheticHttpEvent } from './export/export-types';
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
    getObservedTrafficSignal(options?: { waitMs?: number, pollIntervalMs?: number }): Promise<{
        observed: boolean,
        bootstrapOnly?: boolean,
        source: 'none' | 'observed-session-traffic',
        totalSeenRequests: number,
        ignoredBootstrapRequests: number,
        matchingRequests: number,
        sampleUrl?: string
    }>;
    getTargetTrafficSignal(options?: { waitMs?: number, pollIntervalMs?: number }): Promise<TargetTrafficSignal>;
}

export interface CreateAppOptions {
    sessionManager?: SessionManagerLike;
    matchTraffic?: (url: string) => QidianTrafficMatchResult;
    androidNetworkSafety?: AndroidNetworkSafetyApi;
    headlessControl?: HeadlessControlApi;
    headlessHealth?: HeadlessHealthService;
    exportIngestService?: ExportIngestService;
    exportFileSink?: ExportFileSink;
    exportTargetsLoader?: typeof loadExportTargetsConfig;
    automationService?: AndroidAdbStartHeadlessService;
    automationActivationClient?: AndroidActivationClient;
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
    const automationActivationClient = options.automationActivationClient ?? new SafeStubAndroidActivationClient();
    const automationService = options.automationService ?? new AndroidAdbStartHeadlessService(
        androidNetworkSafety,
        sessionManager,
        automationActivationClient,
        new AutomationHealthStore()
    );
    const headlessControl = options.headlessControl ?? new HeadlessControlService();
    const headlessHealth = options.headlessHealth ?? new HeadlessHealthService({
        getCapabilities: () => headlessControl.getCapabilities(),
        getLatestProcess: () => headlessControl.getLatestProcess?.()
    });
    const exportTargetsLoader = options.exportTargetsLoader ?? loadExportTargetsConfig;
    let exportIngestService = options.exportIngestService;
    let exportFileSink = options.exportFileSink;

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

    app.post('/android/network/rescue', asyncHandler(async (req: Request, res: Response) => {
        const result = await androidNetworkSafety.rescueNetwork({
            deviceId: typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined,
            dryRun: typeof req.body?.dryRun === 'boolean' ? req.body.dryRun : undefined,
            clearHttpProxy: typeof req.body?.clearHttpProxy === 'boolean' ? req.body.clearHttpProxy : undefined,
            clearPrivateDns: typeof req.body?.clearPrivateDns === 'boolean' ? req.body.clearPrivateDns : undefined,
            clearAlwaysOnVpn: typeof req.body?.clearAlwaysOnVpn === 'boolean' ? req.body.clearAlwaysOnVpn : undefined,
            includeAfterInspection: typeof req.body?.includeAfterInspection === 'boolean' ? req.body.includeAfterInspection : undefined
        });
        res.json(result);
    }));

    app.get('/android/network/capabilities', (_req, res: Response) => {
        res.json(androidNetworkSafety.getCapabilities());
    });

    app.post('/automation/android-adb/start-headless', asyncHandler(async (req: Request, res: Response) => {
        const result = await automationService.startHeadless({
            deviceId: typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined,
            allowUnsafeStart: req.body?.allowUnsafeStart === true,
            enableSocks: req.body?.enableSocks === true,
            waitForTraffic: req.body?.waitForTraffic === true,
            waitForTargetTraffic: req.body?.waitForTargetTraffic === true
        });

        const statusCode = result.success ? 200 : 409;
        res.status(statusCode).json(result);
    }));

    app.post('/automation/android-adb/stop-headless', asyncHandler(async (req: Request, res: Response) => {
        const result = await automationService.stopHeadless({
            deviceId: typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined
        });
        res.json(result);
    }));

    app.post('/automation/android-adb/recover-headless', asyncHandler(async (req: Request, res: Response) => {
        const result = await automationService.recoverHeadless({
            deviceId: typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined
        });
        res.json(result);
    }));

    app.get('/automation/health', (_req, res: Response) => {
        const health = automationService.getHealth();
        res.json({
            success: true,
            health
        });
    });

    app.get('/headless/health', (_req, res: Response) => {
        res.json(headlessHealth.getHealth());
    });

    app.post('/headless/start', asyncHandler(async (req: Request, res: Response) => {
        const hasOverrides =
            req.body?.backend !== undefined ||
            req.body?.command !== undefined ||
            req.body?.args !== undefined ||
            req.body?.workingDir !== undefined ||
            req.body?.env !== undefined ||
            req.body?.dryRun !== undefined;

        const deviceId = typeof req.body?.deviceId === 'string' ? req.body.deviceId : undefined;
        const result = await headlessControl.start({
            deviceId,
            backend: req.body?.backend === 'local-process' || req.body?.backend === 'safe-stub' ? req.body.backend : undefined,
            command: typeof req.body?.command === 'string' ? req.body.command : undefined,
            args: Array.isArray(req.body?.args)
                ? req.body.args.filter((value: unknown): value is string => typeof value === 'string')
                : (typeof req.body?.args === 'string' ? req.body.args : undefined),
            workingDir: typeof req.body?.workingDir === 'string' ? req.body.workingDir : undefined,
            env: req.body?.env && typeof req.body.env === 'object' && !Array.isArray(req.body.env)
                ? Object.fromEntries(Object.entries(req.body.env).filter(([, value]) => typeof value === 'string')) as Record<string, string>
                : undefined,
            dryRun: typeof req.body?.dryRun === 'boolean' ? req.body.dryRun : (hasOverrides ? true : undefined)
        });
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

    app.get('/export/capabilities', (_req, res: Response) => {
        res.json(getExportCapabilities());
    });

    app.get('/export/targets', asyncHandler(async (_req: Request, res: Response) => {
        const config = await exportTargetsLoader();
        res.json(config);
    }));

    app.post('/export/match', asyncHandler(async (req: Request, res: Response) => {
        const syntheticEvent = req.body?.event as SyntheticHttpEvent;
        if (!syntheticEvent || typeof syntheticEvent.url !== 'string' || typeof syntheticEvent.method !== 'string' || typeof syntheticEvent.statusCode !== 'number') {
            res.status(400).json({
                ok: false,
                error: 'Expected JSON body: { "event": { "method": "GET", "url": "https://...", "statusCode": 200 } }'
            });
            return;
        }

        const config = await exportTargetsLoader();
        const result = matchExportEvent(syntheticEvent, config.enabled ? config.targets : []);

        res.json({ ok: true, result });
    }));

    app.post('/export/ingest', asyncHandler(async (req: Request, res: Response) => {
        const syntheticEvent = req.body?.event as SyntheticHttpEvent;
        const persist = req.body?.persist === true;

        if (!syntheticEvent || typeof syntheticEvent.url !== 'string' || typeof syntheticEvent.method !== 'string' || typeof syntheticEvent.statusCode !== 'number') {
            res.status(400).json({
                ok: false,
                error: 'Expected JSON body: { "event": { "method": "GET", "url": "https://...", "statusCode": 200 }, "persist": true? }'
            });
            return;
        }

        if (persist && !exportFileSink) {
            exportFileSink = new ExportFileSink();
        }

        if (!exportIngestService || (persist && !exportIngestService.canPersist())) {
            const config = await exportTargetsLoader();
            exportIngestService = new ExportIngestService(config.enabled ? config.targets : [], exportFileSink);
        }

        const ingestResult = exportIngestService.ingest(syntheticEvent, { persist });
        res.json({ ok: true, ...ingestResult });
    }));

    app.get('/export/output-status', (_req: Request, res: Response) => {
        if (!exportFileSink) {
            exportFileSink = new ExportFileSink();
        }

        res.json(exportFileSink.getOutputStatus());
    });

    app.get('/export/stream', (_req: Request, res: Response) => {
        res.status(501).json({
            ok: false,
            implemented: false,
            status: 'requires-core-hook',
            reason: 'Live stream export requires a minimal official HTTP Toolkit core hook.'
        });
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
