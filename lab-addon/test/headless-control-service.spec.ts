import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { HeadlessControlService } from '../src/headless/headless-control-service';
import { ProcessRunRequest, ProcessRunResult, ProcessRunner } from '../src/headless/headless-types';

class FakeProcessRunner implements ProcessRunner {
    public calls: ProcessRunRequest[] = [];

    constructor(private readonly result: ProcessRunResult = { exitCode: 0, stdout: 'ok', stderr: '' }) {}

    async run(request: ProcessRunRequest): Promise<ProcessRunResult> {
        this.calls.push(request);
        return this.result;
    }
}

describe('HeadlessControlService', () => {
    it('returns explicit safe start stub', async () => {
        const service = new HeadlessControlService({ processRunner: new FakeProcessRunner() });

        const result = await service.start();
        assert.deepEqual(result, {
            ok: false,
            implemented: false,
            action: 'start',
            reason: 'Addon headless start orchestration is not fully migrated yet.'
        });
    });

    it('returns explicit safe stop/recover stubs by default', async () => {
        const service = new HeadlessControlService({ processRunner: new FakeProcessRunner() });

        const stopResult = await service.stop({ deviceId: 'emulator-5554' });
        const recoverResult = await service.recover({ deviceId: 'emulator-5554' });

        assert.deepEqual(stopResult, {
            ok: false,
            implemented: false,
            action: 'stop',
            reason: 'Stop is intentionally stubbed to avoid recursive addon-server script calls.'
        });

        assert.deepEqual(recoverResult, {
            ok: false,
            implemented: false,
            action: 'recover',
            reason: 'Recover is intentionally stubbed to avoid recursive addon-server script calls.'
        });
    });

    it('does not invoke ProcessRunner for stop/recover while stubs (no recursive addon-server script call)', async () => {
        const runner = new FakeProcessRunner({ exitCode: 0, stdout: 'unexpected', stderr: '' });
        const service = new HeadlessControlService({ processRunner: runner });

        await service.stop({ deviceId: 'emulator-5554' });
        await service.recover({ deviceId: 'emulator-5554' });

        assert.equal(runner.calls.length, 0);
    });

    it('reports stubbed capabilities for start/stop/recover and implemented health', () => {
        const service = new HeadlessControlService();

        assert.deepEqual(service.getCapabilities(), {
            health: { implemented: true, mutatesDeviceState: false },
            start: {
                implemented: false,
                mutatesDeviceState: false,
                reason: 'Addon headless start orchestration is not fully migrated yet.'
            },
            stop: {
                implemented: false,
                mutatesDeviceState: false,
                reason: 'Stop is intentionally stubbed to avoid recursive addon-server script calls.'
            },
            recover: {
                implemented: false,
                mutatesDeviceState: false,
                reason: 'Recover is intentionally stubbed to avoid recursive addon-server script calls.'
            }
        });
    });
});
