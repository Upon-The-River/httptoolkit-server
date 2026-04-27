import { HeadlessActionResult, HeadlessCapabilities, HeadlessHealthState } from './headless-types';

export interface HeadlessHealthServiceOptions {
    getCapabilities: () => HeadlessCapabilities;
    getLatestProcess?: () => HeadlessHealthState['latestProcess'];
}

export class HeadlessHealthService {
    private lastAction: HeadlessHealthState['lastAction'];
    private readonly getCapabilitiesFn: () => HeadlessCapabilities;
    private readonly getLatestProcessFn: () => HeadlessHealthState['latestProcess'];

    constructor(options: HeadlessCapabilities | HeadlessHealthServiceOptions) {
        if ('backend' in options) {
            this.getCapabilitiesFn = () => options;
            this.getLatestProcessFn = () => undefined;
            return;
        }

        this.getCapabilitiesFn = options.getCapabilities;
        this.getLatestProcessFn = options.getLatestProcess ?? (() => undefined);
    }

    getHealth(): HeadlessHealthState {
        const capabilities = this.getCapabilitiesFn();
        const latestProcess = this.getLatestProcessFn();
        const hasFailedImplementedAction = this.lastAction?.implemented === true && this.lastAction.ok === false;

        return {
            ok: true,
            service: 'headless-control',
            state: hasFailedImplementedAction ? 'degraded' : 'idle',
            startImplemented: capabilities.start.implemented,
            stopImplemented: capabilities.stop.implemented,
            recoverImplemented: capabilities.recover.implemented,
            backend: capabilities.backend.active,
            configuredStartAvailable: capabilities.backend.startCommandConfigured,
            ...(latestProcess ? { latestProcess } : {}),
            ...(this.lastAction ? { lastAction: this.lastAction } : {})
        };
    }

    trackAction(result: HeadlessActionResult) {
        this.lastAction = {
            action: result.action,
            ok: result.ok,
            implemented: result.implemented,
            timestamp: new Date().toISOString()
        };
    }
}
