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
- `POST /android/network/rescue` (stub)
- `GET /android/network/capabilities` (implemented)

### Headless control endpoints (addon standalone slice)

- `GET /headless/health`
  - Returns addon-side headless service health summary.
- `POST /headless/start`
  - Safe explicit stub until full start orchestration is migrated.
  - Returns `implemented: false` with reason.
- `POST /headless/stop`
  - Safe explicit stub until non-recursive stop orchestration is implemented.
  - Returns `implemented: false` with reason.
- `POST /headless/recover`
  - Safe explicit stub until non-recursive recovery orchestration is implemented.
  - Returns `implemented: false` with reason.
- `GET /headless/capabilities`
  - Lists implemented vs pending headless actions.

### Live export endpoints (addon-owned skeleton)

- `GET /export/capabilities`
  - Reports addon-side export features implemented today and explicit `requires-core-hook` items.
- `GET /export/targets`
  - Returns the loaded `config/live-export-targets.json` target rules.
- `POST /export/match`
  - Matches a synthetic HTTP event against target rules.
- `POST /export/ingest`
  - Ingests a synthetic HTTP event and returns a normalized JSONL-compatible export record.
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

Ingest normalized record:

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/export/ingest `
  -ContentType 'application/json' `
  -Body '{\"event\":{\"timestamp\":\"2026-01-02T03:04:05.000Z\",\"method\":\"GET\",\"url\":\"https://example.com/api/books\",\"statusCode\":200,\"responseHeaders\":{\"content-type\":\"application/json\"},\"responseBody\":\"{\\\"ok\\\":true}\"}}'
```

Stream status stub:

```powershell
curl http://127.0.0.1:45457/export/stream
```

This returns a clear JSON stub indicating that live streaming requires a future minimal official core hook. No official HTTP Toolkit core files were modified for this addon export skeleton.

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

Health:

```powershell
curl http://127.0.0.1:45457/headless/health
```

Start (stub):

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/headless/start
```

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

PowerShell client entrypoints (operator-invoked scripts):

```powershell
./scripts/android/stop-headless.ps1 -UseAddonServer -DeviceId emulator-5554
./scripts/android/recover-headless.ps1 -UseAddonServer -DeviceId emulator-5554
```


## Recursion safety note

The PowerShell scripts under `scripts/android/` are client entrypoints. They may call addon endpoints when `-UseAddonServer` is provided by the operator.

Addon endpoints **must not** invoke those scripts in `-UseAddonServer` mode, because that creates recursive self-calls (endpoint -> script -> endpoint). Until a non-recursive implementation is available, `/headless/start`, `/headless/stop`, and `/headless/recover` remain explicit safe stubs.
