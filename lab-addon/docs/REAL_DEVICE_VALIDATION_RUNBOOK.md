# Real Device Validation Runbook (Addon-Only, Pre-Core-Hook)

## A. Purpose

This runbook validates `lab-addon` in a real local environment (with optional Android device checks) **before any official core hook work**.

Goals:

- Validate `lab-addon` against a local official HTTP Toolkit repository.
- Confirm official HTTP Toolkit core files remain unchanged.
- Confirm migrated addon endpoints are functioning.
- Identify remaining gaps (especially `/export/stream`) before proposing minimal core-hook work.

## B. Prerequisites

- Windows PowerShell (recommended for all commands below).
- Node.js + npm available in `PATH`.
- Optional: `adb` available in `PATH` for Android checks.
- Local official HTTP Toolkit repo path (for read-only `git status` verification).
- Local `lab-addon` directory.
- Optional Android device connected and authorized.
- **No requirement to modify official core files.**

## C. Safety Notes

- Default validation is read-only or dry-run.
- `/android/network/rescue` defaults to `dryRun=true`.
- `/headless/start` uses dry-run mode by default in validation.
- `/headless/stop` and `/headless/recover` stay conservative (not executed by default in smoke validation).
- `/export/stream` is expected to remain `requires-core-hook`.
- Do **not** run `clearPrivateDns` or `clearAlwaysOnVpn` unless explicitly understood and approved.
- Validation scripts do **not** reboot devices, uninstall apps, disable VPN packages, or kill arbitrary external processes.

## D. Step-by-Step Manual Validation (PowerShell)

> Default addon URL used below: `http://127.0.0.1:45457`

### 1) Prepare addon

```powershell
cd lab-addon
npm install
npm run typecheck
npm test
npm run start
```

### 2) Core health and migration checks

```powershell
curl http://127.0.0.1:45457/health
curl http://127.0.0.1:45457/migration/status
```

### 3) Qidian/session checks

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/qidian/match `
  -ContentType 'application/json' `
  -Body '{"url":"https://www.qidian.com/chapter/1234567890/"}'

curl -Method POST -Uri http://127.0.0.1:45457/session/start `
  -ContentType 'application/json' `
  -Body '{"target":"local-validation"}'

curl http://127.0.0.1:45457/session/latest
```

### 4) Android checks (optional)

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/android/network/inspect `
  -ContentType 'application/json' `
  -Body '{}'

curl -Method POST -Uri http://127.0.0.1:45457/android/network/rescue `
  -ContentType 'application/json' `
  -Body '{"dryRun":true,"clearHttpProxy":true}'

curl http://127.0.0.1:45457/android/network/capabilities
```

### 5) Headless checks (dry-run only by default)

```powershell
curl http://127.0.0.1:45457/headless/capabilities

curl -Method POST -Uri http://127.0.0.1:45457/headless/start `
  -ContentType 'application/json' `
  -Body '{"backend":"local-process","command":"node","args":["./bin/run","start"],"workingDir":"C:/path/to/official/httptoolkit-server","dryRun":true}'
```

### 6) Export checks

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/export/ingest `
  -ContentType 'application/json' `
  -Body '{"persist":true,"event":{"timestamp":"2026-01-02T03:04:05.000Z","method":"GET","url":"https://example.com/api/books","statusCode":200,"responseHeaders":{"content-type":"application/json"},"responseBody":"{\"ok\":true}"}}'

curl http://127.0.0.1:45457/export/output-status
curl http://127.0.0.1:45457/export/stream
```

`/export/stream` is expected to return a structured `requires-core-hook` response/stub at this stage.

## E. Expected Results

- `GET /health`: `ok=true` style health payload.
- `GET /migration/status`: structured capability/status report.
- `POST /qidian/match`: structured match result.
- `POST /session/start`: structured session-start response.
- `GET /session/latest`: latest session state object.
- `POST /android/network/inspect`: implemented read/report response (may be empty if no/unauthorized device).
- `POST /android/network/rescue` with `dryRun=true`: conservative plan/report, no live mutation.
- `GET /android/network/capabilities`: structured Android capability flags.
- `GET /headless/capabilities`: structured headless capability flags.
- `POST /headless/start` with `dryRun=true`: structured dry-run plan; should not spawn process.
- `POST /export/ingest` with `persist=true`: success response and JSONL append.
- `GET /export/output-status`: reports runtime output metadata/path.
- `GET /export/stream`: expected `requires-core-hook`/stub response.

Additional expectations:

- Official core files remain unchanged.
- JSONL output is created only under `lab-addon/runtime/exports` when `persist=true` is used.

## F. Failure Interpretation

| Symptom | Likely cause | Recommended action |
|---|---|---|
| Addon server not reachable | Addon not running/wrong port | Run `npm run start` in `lab-addon`; verify `AddonBaseUrl`. |
| `npm install` fails | Node/npm/runtime/network issue | Fix local runtime/dependency/network setup, then rerun. |
| `npm run typecheck` fails | Type or config regression | Resolve type errors before validation sign-off. |
| `npm test` fails | Behavior regression | Investigate failing tests before core-hook proposal. |
| ADB not found | `adb` missing in `PATH` | Install Android platform tools and retry Android checks. |
| No Android device | No connected device/emulator | Connect device or skip Android with explicit reason. |
| Device unauthorized | Device not authorized for ADB | Reconnect, accept ADB auth prompt, rerun inspect. |
| `/android/network/inspect` returns empty report | Device inaccessible/limited probe | Treat as skipped-with-reason unless Android validation required. |
| `/headless/start` dry-run resolves no command | No configured command/backend | Provide `command`/`args`/`workingDir` or env-based config. |
| `/export/output-status` shows no file | `persist=true` not used yet | Rerun `/export/ingest` with `persist=true`. |
| `/export/stream` returns requires-core-hook | Expected pre-hook behavior | Record as expected gap for minimal core-hook proposal. |

## G. Completion Criteria

Validation is complete when:

- `npm run typecheck` passes.
- `npm test` passes.
- `/health` responds.
- `/migration/status` responds.
- `/android/network/inspect` succeeds **or** is skipped with explicit reason.
- `/android/network/rescue` dry-run succeeds **or** is skipped with explicit reason.
- `/export/ingest` with `persist=true` writes JSONL output.
- Official core files remain unchanged.
- No core patches are applied.

