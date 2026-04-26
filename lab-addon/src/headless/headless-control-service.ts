import {
    HeadlessActionResult,
    HeadlessCapabilities,
    HeadlessControlApi,
    ProcessRunner
} from './headless-types';

export interface HeadlessControlServiceOptions {
    processRunner?: ProcessRunner;
    scriptsRoot?: string;
    powershellCommand?: string;
}

const START_STUB_REASON = 'Addon headless start orchestration is not fully migrated yet.';
const STOP_STUB_REASON = 'Stop is intentionally stubbed to avoid recursive addon-server script calls.';
const RECOVER_STUB_REASON = 'Recover is intentionally stubbed to avoid recursive addon-server script calls.';

export class HeadlessControlService implements HeadlessControlApi {
    constructor(_options: HeadlessControlServiceOptions = {}) {}

    async start(): Promise<HeadlessActionResult> {
        return {
            ok: false,
            implemented: false,
            action: 'start',
            reason: START_STUB_REASON
        };
    }

    async stop(_options: { deviceId?: string } = {}): Promise<HeadlessActionResult> {
        return {
            ok: false,
            implemented: false,
            action: 'stop',
            reason: STOP_STUB_REASON
        };
    }

    async recover(_options: { deviceId?: string } = {}): Promise<HeadlessActionResult> {
        return {
            ok: false,
            implemented: false,
            action: 'recover',
            reason: RECOVER_STUB_REASON
        };
    }

    getCapabilities(): HeadlessCapabilities {
        return {
            health: { implemented: true, mutatesDeviceState: false },
            start: {
                implemented: false,
                mutatesDeviceState: false,
                reason: START_STUB_REASON
            },
            stop: {
                implemented: false,
                mutatesDeviceState: false,
                reason: STOP_STUB_REASON
            },
            recover: {
                implemented: false,
                mutatesDeviceState: false,
                reason: RECOVER_STUB_REASON
            }
        };
    }
}
