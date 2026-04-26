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
- `GET /migration/pending-routes`
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
  - Implemented through addon PowerShell script runner (`-UseAddonServer`).
- `POST /headless/recover`
  - Implemented through addon PowerShell script runner (`-UseAddonServer`).
- `GET /headless/capabilities`
  - Lists implemented vs pending headless actions.

## Implemented vs stubbed actions

- Implemented:
  - `GET /headless/health`
  - `POST /headless/stop`
  - `POST /headless/recover`
  - `GET /headless/capabilities`
- Stubbed:
  - `POST /headless/start`

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

Scripts in addon-server mode:

```powershell
./scripts/android/stop-headless.ps1 -UseAddonServer -DeviceId emulator-5554
./scripts/android/recover-headless.ps1 -UseAddonServer -DeviceId emulator-5554
```
