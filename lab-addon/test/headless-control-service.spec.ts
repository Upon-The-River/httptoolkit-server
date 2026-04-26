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

    it('runs stop script with addon mode through injected process runner', async () => {
        const runner = new FakeProcessRunner({ exitCode: 0, stdout: 'stopped', stderr: '' });
        const service = new HeadlessControlService({
            processRunner: runner,
            scriptsRoot: '/tmp/scripts/android',
            powershellCommand: 'pwsh'
        });

        const result = await service.stop({ deviceId: 'emulator-5554' });

        assert.equal(runner.calls.length, 1);
        assert.equal(runner.calls[0].command, 'pwsh');
        assert.deepEqual(runner.calls[0].args, [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            '/tmp/scripts/android/stop-headless.ps1',
            '-UseAddonServer',
            '-DeviceId',
            'emulator-5554'
        ]);
        assert.equal(result.ok, true);
        assert.equal(result.implemented, true);
    });

    it('returns failed action output when process exits non-zero', async () => {
        const runner = new FakeProcessRunner({ exitCode: 1, stdout: '', stderr: 'failed' });
        const service = new HeadlessControlService({
            processRunner: runner,
            scriptsRoot: '/tmp/scripts/android'
        });

        const result = await service.recover();
        assert.equal(result.ok, false);
        assert.equal(result.action, 'recover');
        assert.equal(result.output?.stderr, 'failed');
    });
});
