import { HeadlessActionResult, HeadlessCapabilities, HeadlessHealthState } from './headless-types';

export class HeadlessHealthService {
    private lastAction: HeadlessHealthState['lastAction'];

    constructor(private readonly capabilities: HeadlessCapabilities) {}

    getHealth(): HeadlessHealthState {
        const hasFailedImplementedAction = this.lastAction?.implemented === true && this.lastAction.ok === false;
        return {
            ok: true,
            service: 'headless-control',
            state: hasFailedImplementedAction ? 'degraded' : 'idle',
            startImplemented: this.capabilities.start.implemented,
            stopImplemented: this.capabilities.stop.implemented,
            recoverImplemented: this.capabilities.recover.implemented,
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
