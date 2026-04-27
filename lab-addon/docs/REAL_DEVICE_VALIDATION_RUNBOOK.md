# Real Device Validation Runbook (Addon-Only, Pre-Core-Hook)

## A. Purpose

This runbook validates `lab-addon` in a real local environment (with optional Android device checks) **before any official core hook work**.

Goals:

- Validate `lab-addon` against a local official HTTP Toolkit repository.
- Confirm official HTTP Toolkit core files remain unchanged.
- Confirm migrated addon endpoints are functioning.
- Produce a reusable validation evidence report (Markdown or JSON).
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
- `/session/start` is optional in default smoke validation (`-IncludeSessionStart` enables it as a required gate).
- `/export/stream` is expected to remain `requires-core-hook` before core-hook work (commonly HTTP `501`), and this counts as a validation PASS.
- Do **not** run `clearPrivateDns` or `clearAlwaysOnVpn` unless explicitly understood and approved.
- Validation scripts do **not** reboot devices, uninstall apps, disable VPN packages, or kill arbitrary external processes.
- Failed `official-core-cleanliness` must block core-hook work.

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

### 2) Run automated validation with report output (safe baseline)

```powershell
.\scripts\validate-lab-addon.ps1 `
  -SkipNpm `
  -PersistExportTest `
  -OfficialRoot "C:\path\to\official" `
  -ReportPath ".\runtime\validation\addon-smoke.md" `
  -WriteMarkdownReport
```

Optional full-session gate (only when full official/mockttp session backend conditions are available):

```powershell
.\scripts\validate-lab-addon.ps1 `
  -SkipNpm `
  -IncludeSessionStart `
  -ReportPath ".\runtime\validation\addon-smoke-with-session-start.md" `
  -WriteMarkdownReport
```

### 3) Run automated validation with Android checks (optional)

```powershell
.\scripts\validate-lab-addon.ps1 `
  -SkipNpm `
  -IncludeAndroid `
  -DeviceId "<device-id>" `
  -PersistExportTest `
  -ReportPath ".\runtime\validation\addon-android-smoke.md" `
  -WriteMarkdownReport
```

Review the generated report before any core-hook work. If `official-core-cleanliness` is `FAIL`, do not proceed to core-hook planning.

### 4) Optional manual endpoint checks

```powershell
curl http://127.0.0.1:45457/health
curl http://127.0.0.1:45457/migration/status
curl http://127.0.0.1:45457/export/output-status
curl http://127.0.0.1:45457/export/stream
```

`/export/stream` is expected to return a structured `requires-core-hook` response/stub at this stage, most commonly via HTTP `501`. The validation script treats this as PASS when either the response indicates `requires-core-hook` or `/migration/status` confirms `GET /export/stream` is `requires-core-hook`.

## E. Expected Results

- Required endpoint gates pass (`/health`, `/migration/status`, `/qidian/match`, `/session/latest`, export endpoints).
- `POST /session/start` is optional by default and only required when `-IncludeSessionStart` is used.
- `POST /export/ingest` succeeds.
- If `-PersistExportTest` is used, `/export/output-status` confirms `exists=true` and `sizeBytes>0`.
- `GET /export/stream` returns a `requires-core-hook`/stub response (HTTP `501` is a normal expected pre-core-hook PASS).
- Official core cleanliness is reviewed when `-OfficialRoot` is provided.
- Report file is written and attached to migration evidence.

Additional expectations:

- Official core files remain unchanged.
- JSONL output is created only under `lab-addon/runtime/exports` when `persist=true` is used.

## F. Failure Interpretation

| Symptom | Likely cause | Recommended action |
|---|---|---|
| Addon server not reachable | Addon not running/wrong port | Run `npm run start` in `lab-addon`; verify `AddonBaseUrl`. |
| Required gate fails | Endpoint regression or startup issue | Fix endpoint behavior before core-hook discussion. |
| `POST /session/start` fails when enabled | Full official/mockttp session backend conditions unavailable | Re-run default addon-only smoke (without `-IncludeSessionStart`) or provide full session backend and retry. |
| `/export/stream` returns HTTP 501 with `requires-core-hook` | Expected pre-core-hook behavior | Treat as pass for addon-only smoke; proceed with remaining gates/evidence. |
| `/export/output-status` has `exists=false` after `persist=true` ingest | Persistence not writing JSONL | Investigate export persistence and rerun with `-PersistExportTest`. |
| `official-core-cleanliness` fails | Forbidden official paths are dirty | Clean forbidden official paths before core-hook planning. |
| ADB not found | `adb` missing in `PATH` | Install Android platform tools and retry Android checks. |
| No Android device | No connected device/emulator | Mark Android checks skipped with explicit reason. |

## G. Completion Criteria

Validation is complete when:

- `npm run typecheck` passes (or is intentionally skipped with reason).
- `npm test` passes (or is intentionally skipped with reason).
- Required endpoint gates pass.
- `/session/start` is optional unless explicitly enabled with `-IncludeSessionStart`.
- `/export/ingest` with `persist=true` is verified when `-PersistExportTest` is requested.
- `/export/stream` still reports `requires-core-hook`.
- Official-core cleanliness is reviewed and does not fail for forbidden paths.
- A validation report is generated and reviewed before any core-hook work.
