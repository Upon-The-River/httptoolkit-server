import { expect } from 'chai';
import { readFileSync } from 'fs';
import { join } from 'path';

const repoRoot = process.cwd();

describe('embedded runtime node scripts', () => {
    it('bin/run.cmd requires embedded runtime and never falls back to PATH node', () => {
        const content = readFileSync(join(repoRoot, 'bin/run.cmd'), 'utf8');
        expect(content).to.include('runtime\\node\\win32-x64\\node.exe');
        expect(content).to.not.match(/%PATH%/i);
    });

    it('bin/run enforces exact startup node version', () => {
        const content = readFileSync(join(repoRoot, 'bin/run'), 'utf8');
        expect(content).to.include("const EXPECTED_NODE_VERSION = 'v22.20.0';");
        expect(content).to.include('process.version !== EXPECTED_NODE_VERSION');
    });

    it('all runtime wrappers point to runtime/node/win32-x64', () => {
        const nodeCmd = readFileSync(join(repoRoot, 'scripts/node22.cmd'), 'utf8');
        const npmCmd = readFileSync(join(repoRoot, 'scripts/npm22.cmd'), 'utf8');
        const runServer = readFileSync(join(repoRoot, 'scripts/run-server.ps1'), 'utf8');
        const doctor = readFileSync(join(repoRoot, 'scripts/doctor-runtime.ps1'), 'utf8');

        expect(nodeCmd).to.include('runtime\\node\\win32-x64');
        expect(npmCmd).to.include('runtime\\node\\win32-x64');
        expect(runServer).to.include('runtime/node/win32-x64/node.exe');
        expect(doctor).to.include('runtime/node/win32-x64/node.exe');
        expect(nodeCmd).to.not.include('.local\\node');
        expect(npmCmd).to.not.include('.local\\node');
    });

    it('bootstrap-node installs complete node+npm runtime content', () => {
        const content = readFileSync(join(repoRoot, 'scripts/bootstrap-node.ps1'), 'utf8');
        expect(content).to.include('npm.cmd missing after install');
        expect(content).to.include('npx.cmd missing after install');
        expect(content).to.include('node_modules/npm/bin/npm-cli.js');
    });

    it('shutdown flow includes stateless cleanup before session/server stop', () => {
        const content = readFileSync(join(repoRoot, 'src/index.ts'), 'utf8');
        expect(content).to.include('runFastAndroidCleanup()');
        expect(content).to.include('inspectAllAndroidVpnStates()');
        expect(content).to.not.include('runStatelessAndroidCleanup({ includeDiagnostics: true })');
        expect(content).to.include('await sessionManager.stopLatestSession()');
        expect(content).to.include('await standalone.stop()');
    });

    it('shutdown fast cleanup timeout is at least 15 seconds and awaited before exit', () => {
        const content = readFileSync(join(repoRoot, 'src/index.ts'), 'utf8');
        expect(content).to.include('runFastAndroidCleanup()');
        expect(content).to.include('delay(15000)');
    });

    it('stop-headless fallback delegates to rescue-phone-network script', () => {
        const content = readFileSync(join(repoRoot, 'scripts/stop-headless.ps1'), 'utf8');
        expect(content).to.include('rescue-phone-network.ps1');
        expect(content).to.include('stop-headless API unavailable');
        expect(content).to.include('Origin = "https://app.httptoolkit.tech"');
        expect(content).to.include('-Headers $Headers');
        expect(content).to.include('$result.success -eq $true -and $result.networkRiskCleared -eq $true');
        expect(content).to.include('exit $LASTEXITCODE');
    });

    it('rescue-phone-network logs per-step adb results and exits non-zero on risk', () => {
        const content = readFileSync(join(repoRoot, 'scripts/rescue-phone-network.ps1'), 'utf8');
        expect(content).to.include('function Invoke-AdbStep');
        expect(content).to.include('action = $Action');
        expect(content).to.include('exitCode = $exitCode');
        expect(content).to.include('success = $success');
        expect(content).to.include('criticalFailures');
        expect(content).to.include('ConvertTo-Json -Depth 8');
    });
});
