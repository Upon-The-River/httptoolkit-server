# httptoolkit-lab-addon

This is a migration-stage external addon for local Android/headless/Qidian tooling that was previously embedded inside a modified HTTP Toolkit server fork.

## Service slice status

`lab-addon` runs as a standalone HTTP service and keeps the official HTTP Toolkit core unchanged.

- ✅ Official core files are not modified by this addon slice.
- ✅ Headless control API is exposed from addon-owned routes only.
- ✅ Migration assets under `migration-assets/` are still reference-only.

## Available endpoints

### Generic addon endpoints

- `GET /health`
- `GET /migration/pending-routes` (backward-compatible structured response)
- `GET /migration/status` (full migration status registry)
- `POST /qidian/match`
- `GET /session/latest`
- `POST /session/start`
- `POST /session/stop`
- `POST /session/target-signal`

### Android network safety endpoints

- `POST /android/network/inspect` (implemented, read-only)
- `POST /android/network/rescue` (implemented, explicit conservative rescue)
- `GET /android/network/capabilities` (implemented)

`/android/network/rescue` defaults to `dryRun: true`, so a blank request only returns a plan and does not execute adb writes.
Execution requires explicit `dryRun: false` (or `-Execute` in the PowerShell helper script).

Rescue limitations in this slice:

- no reboot
- no app uninstall
- no VPN app disable
- high-risk actions are skipped
- `clearPrivateDns` and `clearAlwaysOnVpn` are opt-in


### Android ADB start-headless activation (real addon implementation)

`POST /automation/android-adb/start-headless` now uses a conservative ADB activation client by default (not the SafeStub route-only fallback).

Behavior summary:

- Tries official bridge activation first:
  - `POST ${LAB_ADDON_OFFICIAL_ADMIN_BASE_URL:-http://127.0.0.1:45456}/automation/android-adb/start-headless`
  - If default `45456` route is missing (`404`), addon also attempts `http://127.0.0.1:45457/automation/android-adb/start-headless` for compatibility.
- Verifies the requested `deviceId` is online in `adb devices` output.
- Collects basic device info (`ro.product.model`, `ro.build.version.release`).
- Sends HTTP Toolkit Android ACTIVATE intent via ADB shell:
  - `am start -a tech.httptoolkit.android.ACTIVATE -d https://android.httptoolkit.tech/connect/?data=... -p tech.httptoolkit.android.v1`
- Reads conservative connection signals (`dumpsys activity`, `logcat`, `dumpsys vpn`).
- Returns structured activation result fields including:
  - `implemented`
  - `partial`
  - `activationMode` (`adb-activation` or `partial`)
  - `reason` and `errors` when activation is not fully confirmed.

Current limitations:

- If the official bridge returns structured failure, addon surfaces that failure in `activationResult`.
- If no official bridge route exists, addon falls back to conservative ADB-intent mode and can return a structured partial failure (`success=false`, `implemented=true`, `partial=true`).
- No reboot, uninstall, VPN-app-disable, or arbitrary process-kill behavior is used.

Official bridge base URL environment variable:

- `LAB_ADDON_OFFICIAL_ADMIN_BASE_URL`
  - default: `http://127.0.0.1:45456`
  - set this to override where addon sends official bridge activation requests.

Expected PowerShell request:

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/automation/android-adb/start-headless `
  -ContentType 'application/json' `
  -Body '{"deviceId":"emulator-5554","enableSocks":false}'
```

Check automation health (includes `activationMode`):

```powershell
curl http://127.0.0.1:45457/automation/health
```

Validate official bridge directly (PowerShell):

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:45457/automation/android-adb/start-headless" -ContentType "application/json" -Body '{"deviceId":"<id>","proxyPort":8000,"enableSocks":false,"allowUnsafeStart":true}'
```

### Headless backend strategy

Headless control uses an explicit backend strategy model:

- `safe-stub` (default): conservative no-op mode for start/stop/recover.
- `local-process`: optional backend enabled only when `LAB_ADDON_HEADLESS_BACKEND=local-process` and `LAB_ADDON_HEADLESS_START_COMMAND` are set.
- `external-official-cli`: documented future backend option.
- `core-hook-required`: documented fallback when addon-only integration is insufficient.

Default behavior remains `safe-stub` unless explicitly configured.

Local-process startup configuration environment variables:

- `LAB_ADDON_HEADLESS_BACKEND` (`local-process` to opt in)
- `LAB_ADDON_HEADLESS_START_COMMAND` (required for execute mode)
- `LAB_ADDON_HEADLESS_START_ARGS` (JSON array string like `["./bin/run","start"]` or conservative plain string tokenization)
- `LAB_ADDON_HEADLESS_WORKING_DIR` (optional start working directory)
- `LAB_ADDON_HEADLESS_ENV_JSON` (optional JSON object of string values)

Invalid JSON in `LAB_ADDON_HEADLESS_START_ARGS` or `LAB_ADDON_HEADLESS_ENV_JSON` does not crash module import; it appears as validation errors in `/headless/start` and `/headless/capabilities`.

Important semantics:

- Backend strategy availability (`local-process`) does **not** imply every action is implemented.
- Local-process `start` can be implemented while `stop`/`recover` remain conservative.
- The production `NodeProcessRunner` currently does **not** implement safe cross-platform process kill.
- `stop`/`recover` remain non-action stubs unless the configured process runner explicitly reports kill support.
- `GET /headless/capabilities` is the runtime source of truth for action-level availability.

Safety guarantees:

- The addon process registry tracks **only addon-started processes**.
- The addon does **not** inspect, claim ownership of, or kill arbitrary external processes.
- Start process tracking applies only to addon-started processes created by this addon start flow.
- `stop`/`recover` do not kill arbitrary external processes; they remain conservative unless runner kill support is explicitly implemented.
- Server internals do **not** call client scripts with `-UseAddonServer`.
- `/headless/*` endpoints do not recursively invoke other `/headless/*` endpoints.

### Headless control endpoints (addon standalone slice)

- `GET /headless/health`
  - Returns addon-side headless service health summary.
- `POST /headless/start`
  - Default safe stub unless local-process backend + start command are configured.
  - Request body overrides are supported (`backend`, `command`, `args`, `workingDir`, `env`, `dryRun`).
  - Request-body mode defaults to `dryRun: true` unless `dryRun: false` is explicitly sent.
  - `dryRun: true` returns a resolved start plan and does not spawn or register a process.
  - Execute mode (`dryRun: false`) always spawns `command + args` directly (no shell command interpolation).
  - Can return `implemented: true` independently of stop/recover support.
- `POST /headless/stop`
  - Safe explicit no-op by default.
  - Requires a runner that explicitly reports kill capability as implemented.
  - Local-process backend alone is insufficient to mark stop as implemented.
- `POST /headless/recover`
  - Safe explicit no-op by default.
  - Implemented only when both start and stop are implemented.
  - If stop is unavailable, recover returns a structured non-action result.
- `GET /headless/capabilities`
  - Runtime source of truth for implemented vs pending headless actions.

### Live export endpoints (addon-owned skeleton)

- `GET /export/capabilities`
  - Reports addon-side export features implemented today and explicit `requires-core-hook` items.
- `GET /export/targets`
  - Returns the loaded `config/live-export-targets.json` target rules.
- `POST /export/match`
  - Matches a synthetic HTTP event against target rules.
- `POST /export/ingest`
  - Ingests a synthetic HTTP event and returns a normalized JSONL-compatible export record.
  - Optional `{ "persist": true }` is **target-gated**: only events that match configured export targets are appended to runtime JSONL output.
  - Unmatched events are still normalized and returned, but default behavior is `persisted=false` with `skippedPersistenceReason="no-target-matched"`.
- `GET /export/output-status`
  - Returns runtime export output metadata (`runtimeRoot`, `exportDir`, `jsonlPath`, `exists`, `sizeBytes`).
- `GET /export/stream`
  - Explicit safe stub (`501`) with `requires-core-hook` status until official core provides live traffic event hook.

## Migration status registry

`GET /migration/status` returns a structured status document:

- `pendingRoutes`: backward-compatible `METHOD /path` strings for all non-implemented capabilities (`safe-stub`, `pending`, and `requires-core-hook`).
- `capabilities`: full capability entries with `id`, `method`, `path`, `domain`, `status`, `mutatesDeviceState`, `description`, and `notes`.
- `summary`: aggregate counts for `implemented`, `safeStub`, `pending`, and `requiresCoreHook`.

`GET /migration/pending-routes` now returns the same structured payload to preserve compatibility while exposing richer migration metadata.

### Status meanings

- `implemented`: endpoint behavior is migrated and active.
- `safe-stub`: intentionally non-mutating no-op behavior until full migration approval.
- `pending`: planned addon migration item not yet implemented.
- `requires-core-hook`: addon can document the capability, but complete implementation needs official core integration.
- `mutatesDeviceState`: indicates Android/device-state mutation specifically, not addon-local session/proxy state changes.

## Live export synthetic event examples

Match only:

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/export/match `
  -ContentType 'application/json' `
  -Body '{\"event\":{\"method\":\"GET\",\"url\":\"https://example.com/api/books\",\"statusCode\":200}}'
```

Ingest normalized record (non-persistent by default):

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/export/ingest `
  -ContentType 'application/json' `
  -Body '{\"event\":{\"timestamp\":\"2026-01-02T03:04:05.000Z\",\"method\":\"GET\",\"url\":\"https://example.com/api/books\",\"statusCode\":200,\"responseHeaders\":{\"content-type\":\"application/json\"},\"responseBody\":\"{\\\"ok\\\":true}\"}}'
```


Ingest and persist to runtime JSONL:

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/export/ingest `
  -ContentType 'application/json' `
  -Body '{"persist":true,"event":{"timestamp":"2026-01-02T03:04:05.000Z","method":"GET","url":"https://example.com/api/books","statusCode":200,"responseHeaders":{"content-type":"application/json"},"responseBody":"{\"ok\":true}"}}'
```

`POST /export/ingest` response includes:

- `ok`
- `record`
- `match`
- `persisted`
- `outputPath` (only when persisted)
- `skippedPersistenceReason` (for example `no-target-matched` when `persist=true` but no target matched)

Check runtime output status:

```powershell
curl http://127.0.0.1:45457/export/output-status
```

Default JSONL output path:

- `lab-addon/runtime/exports/session_hits.jsonl`

Runtime files under `lab-addon/runtime/` are local artifacts and should not be committed.

Stream status stub:

```powershell
curl http://127.0.0.1:45457/export/stream
```

This returns a clear JSON stub indicating that live streaming still requires a future minimal official core hook. No official HTTP Toolkit core files were modified for this addon export skeleton.

When using the official-core live export hook, core may forward generic observed events with `persist=true`. Persistence remains addon-owned and target-gated, which prevents accidental full-traffic JSONL logging by default.

## Run locally

```powershell
cd httptoolkit-lab-addon
npm install
npm run typecheck
npm test
npm run start
```

Default bind: `http://127.0.0.1:45457`

## PowerShell examples

Android inspect (read-only):

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/android/network/inspect `
  -ContentType 'application/json' `
  -Body '{"deviceId":"emulator-5554"}'
```

Android rescue dry-run (default behavior):

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/android/network/rescue `
  -ContentType 'application/json' `
  -Body '{"deviceId":"emulator-5554"}'
```

Android rescue execute proxy clear only:

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/android/network/rescue `
  -ContentType 'application/json' `
  -Body '{"deviceId":"emulator-5554","dryRun":false,"clearHttpProxy":true,"clearPrivateDns":false,"clearAlwaysOnVpn":false}'
```

> Warning: rescue can mutate Android network settings only when `dryRun` is `false` (or when script mode uses `-Execute`). This slice does **not** reboot, uninstall apps, or disable VPN apps.

Health:

```powershell
curl http://127.0.0.1:45457/headless/health
```

Start (default safe-stub):

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/headless/start
```

Start dry-run with request-body override (default dry-run behavior for body-based start):

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/headless/start `
  -ContentType 'application/json' `
  -Body '{"backend":"local-process","command":"node","args":["./bin/run","start"],"workingDir":"C:/path/to/httptoolkit-server-official","env":{"NODE_ENV":"production"}}'
```

Start execute mode (`dryRun:false`) with explicit command:

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/headless/start `
  -ContentType 'application/json' `
  -Body '{"backend":"local-process","command":"node","args":["./bin/run","start"],"workingDir":"C:/path/to/httptoolkit-server-official","dryRun":false}'
```

Recommended official server start tuple:

- `command`: `node`
- `args`: `["./bin/run", "start"]`
- `workingDir`: path to the official `httptoolkit-server` repository

Stop:

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/headless/stop `
  -ContentType 'application/json' `
  -Body '{"deviceId":"emulator-5554"}'
```

Recover:

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/headless/recover `
  -ContentType 'application/json' `
  -Body '{"deviceId":"emulator-5554"}'
```

Capabilities:

```powershell
curl http://127.0.0.1:45457/headless/capabilities
```

Start (default safe-stub):

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/headless/start
```

Stop (default safe-stub unless local-process backend is configured):

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/headless/stop
```

PowerShell client entrypoints (operator-invoked scripts):

```powershell
./scripts/android/rescue-phone-network.ps1 -UseAddonServer -DeviceId emulator-5554
./scripts/android/rescue-phone-network.ps1 -UseAddonServer -DeviceId emulator-5554 -Execute -ClearHttpProxy
./scripts/android/stop-headless.ps1 -UseAddonServer -DeviceId emulator-5554
./scripts/android/recover-headless.ps1 -UseAddonServer -DeviceId emulator-5554
```


## Recursion safety note

The PowerShell scripts under `scripts/android/` are client entrypoints. They may call addon endpoints when `-UseAddonServer` is provided by the operator.

Addon endpoints **must not** invoke those scripts in `-UseAddonServer` mode, because that creates recursive self-calls (endpoint -> script -> endpoint). Until a non-recursive implementation is available, `/headless/start`, `/headless/stop`, and `/headless/recover` remain explicit safe stubs.


## Future headless implementation options

- Local process backend hardening (safer cross-platform stop semantics).
- External official CLI backend integration (non-recursive).
- Minimal core hook, only when addon-only backend is proven insufficient and explicitly approved.

## Real environment validation

Before any official core-hook proposal, run addon-only real-environment validation and generate a report artifact:

- Runbook: [`docs/REAL_DEVICE_VALIDATION_RUNBOOK.md`](./docs/REAL_DEVICE_VALIDATION_RUNBOOK.md)
- Validation script: [`scripts/validate-lab-addon.ps1`](./scripts/validate-lab-addon.ps1)
- Evidence template: [`../migration-notes/VALIDATION_EVIDENCE_TEMPLATE.md`](../migration-notes/VALIDATION_EVIDENCE_TEMPLATE.md)

Recommended order:

1. `npm run typecheck`
2. `npm test`
3. Start addon server (`npm run start`)
4. Run `validate-lab-addon.ps1` with `-PersistExportTest`
5. Review the generated report (`-ReportPath` + markdown/json output)
6. Only then consider a minimal `/export/stream` core-hook proposal

This validation path is safe by default:

- Android checks are skipped unless `-IncludeAndroid` is provided.
- Android rescue stays dry-run unless `-ExecuteAndroidRescue` is provided.
- Headless checks are skipped unless `-IncludeHeadless` is provided.
- Headless start stays dry-run unless `-ExecuteHeadlessStart` is provided.
- `/session/start` is skipped unless `-IncludeSessionStart` is provided (it may require full official/mockttp session backend conditions).
- `/export/stream` is checked as a `requires-core-hook` stub (HTTP `501` expected pre-core-hook and treated as PASS).
- Validation accepts `501` when response fields/body indicate `requires-core-hook` or when `/migration/status` confirms `GET /export/stream` is `requires-core-hook`.

Example report commands:

```powershell
.\scripts\validate-lab-addon.ps1 `
  -SkipNpm `
  -PersistExportTest `
  -OfficialRoot "C:\path\to\official" `
  -ReportPath ".\runtime\validation\addon-smoke.md" `
  -WriteMarkdownReport

.\scripts\validate-lab-addon.ps1 `
  -SkipNpm `
  -PersistExportTest `
  -ReportPath ".\runtime\validation\addon-smoke.json" `
  -WriteJsonReport

.\scripts\validate-lab-addon.ps1 `
  -SkipNpm `
  -IncludeSessionStart `
  -ReportPath ".\runtime\validation\addon-smoke-with-session-start.md" `
  -WriteMarkdownReport
```

## PowerShell Android automation compatibility

This addon restores compatibility for the old working-fork PowerShell/start automation route without patching official core files.

New addon-compatible routes:

- `POST /automation/android-adb/start-headless`
- `POST /automation/android-adb/stop-headless`
- `POST /automation/android-adb/recover-headless`
- `GET /automation/health`

PowerShell command:

```powershell
.\scripts\android\start-headless.ps1 -DeviceId <id> -AllowUnsafeStart
```

Compatibility notes & current limitations:

- Official HTTP Toolkit core remains unchanged.
- Start-headless route returns a legacy-compatible automation response shape from addon.
- Activation behavior may be partial unless an explicit activation bridge/client is configured (default is conservative safe stub).
- Stop/recover are conservative safe-stub flows unless explicitly implemented with a safe activation client.
