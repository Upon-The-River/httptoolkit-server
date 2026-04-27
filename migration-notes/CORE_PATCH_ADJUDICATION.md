# Core Patch Adjudication Report

## Executive summary

- Total patches reviewed: **13** (`core-patches/**/*.patch`).
- `replaced-by-addon`: **2**
- `keep-as-reference`: **1**
- `requires-runtime-verification`: **4**
- `requires-minimal-core-hook-proposal`: **1**
- `discard`: **5**
- Recommendation: **official core should remain untouched for now**. No patch should be applied directly at this stage.

Additional inventory notes:
- No `package-lock.json` patch was found under `core-patches/`.
- No extracted patch directly targeting `httptoolkit-android-main/**` was found.

## Decision table

| Patch | Target official file | Functional area | Decision | Reason | Risk | Next action |
|---|---|---|---|---|---|---|
| `core-patches/high-value-extract/src__api__rest-api.ts.patch` | `src/api/rest-api.ts` | automation/session/android rescue/live export API surface | `requires-minimal-core-hook-proposal` | Most automation routes were extracted to addon, but true live `/export/stream` still needs core-emitted traffic events | High | Keep patch as reference only; design minimal generic core event hook proposal |
| `core-patches/high-value-extract/src__interceptors__android__adb-commands.ts.patch` | `src/interceptors/android/adb-commands.ts` | Android ADB diagnostics/cleanup/activation reliability | `requires-runtime-verification` | Equivalent helper logic exists in addon, but device/vendor/runtime behavior must be reproduced before deciding any core changes | High | Validate on real devices (Windows + Node runtime matrix) before any core proposal |
| `core-patches/manual-review/src__api__api-server.ts.patch` | `src/api/api-server.ts` | API wiring for exporter/session | `replaced-by-addon` | Addon server now owns extracted session/export endpoints and migration behavior | Medium | Do not apply patch; keep core API wiring unchanged |
| `core-patches/manual-review/src__client__http-client.ts.patch` | `src/client/http-client.ts` | HTTP trailer parsing fallback | `keep-as-reference` | Useful bugfix context, but unrelated to required migration scope and not clearly required for addon integration | Medium | Track separately as upstream-safe bug candidate if reproduced |
| `core-patches/manual-review/src__index.ts.patch` | `src/index.ts` | boot wiring, session/live exporter integration, shutdown cleanup | `replaced-by-addon` | Startup/session/export orchestration moved into addon modules/services | High | Do not apply; preserve official bootstrap path |
| `core-patches/manual-review/src__interceptors__android__android-adb-interceptor.ts.patch` | `src/interceptors/android/android-adb-interceptor.ts` | Android activation reliability in interceptor | `requires-runtime-verification` | May fix real activation failures, but addon now has parallel control/recovery flows; core delta should require reproduced failure first | High | Reproduce activation failures and compare addon-only mitigation vs core patch behavior |
| `core-patches/manual-review/src__interceptors__chromium-based-interceptors.ts.patch` | `src/interceptors/chromium-based-interceptors.ts` | logging/noise only | `discard` | Cosmetic logging change only; not migration-critical | Low | Do not apply |
| `core-patches/manual-review/src__interceptors__electron.ts.patch` | `src/interceptors/electron.ts` | logging/noise only | `discard` | Cosmetic logging change only; not migration-critical | Low | Do not apply |
| `core-patches/manual-review/src__shutdown.ts.patch` | `src/shutdown.ts` | shutdown semantics/timeouts | `discard` | Removes global shutdown timeout guard and increases hang risk | High | Do not apply |
| `core-patches/runtime-compat/bin__run.patch` | `bin/run` | runtime guard (Node version pin) | `discard` | Hard exact Node pin (`v22.20.0`) is too brittle and conflicts with official runtime evolution | High | Do not apply |
| `core-patches/runtime-compat/bin__run.cmd.patch` | `bin/run.cmd` | Windows embedded runtime bootstrap | `requires-runtime-verification` | May solve local Windows runtime drift, but enforces non-official embedded runtime assumptions | Medium | Verify current official Windows launch path first; only propose minimal wrapper if reproducible issue exists |
| `core-patches/runtime-compat/package.json.patch` | `package.json` | dependency/runtime rollback + scripts | `discard` | Large invasive downgrade (runtime, deps, scripts) with high divergence from upstream | High | Do not apply |
| `core-patches/runtime-compat/src__util__fs.ts.patch` | `src/util/fs.ts` | filesystem delete compatibility | `requires-runtime-verification` | Could address legacy Windows `fs.rm` issues in old runtime setups, but not justified without repro on supported runtime | Medium | Reproduce on target Windows/Node combinations before any tiny compatibility proposal |

## Detailed decisions

### 1) `core-patches/high-value-extract/src__api__rest-api.ts.patch`
- Patch path: `core-patches/high-value-extract/src__api__rest-api.ts.patch`
- Target file: `src/api/rest-api.ts`
- What it appears to change:
  - Adds large automation surface for session lifecycle, Android headless start/stop/recover, network rescue, health snapshots.
  - Adds live exporter wiring and `/export/stream` endpoint logic.
- Why it existed in the working fork:
  - Consolidated lab automation controls directly in official REST API.
- Current lab-addon replacement:
  - Session API, Android inspect/rescue, headless strategy/start flows, export match/ingest/file-sink, migration status registry are implemented in addon.
- Residual gap:
  - True live `/export/stream` still depends on core-originated observed traffic signal.
- Decision: `requires-minimal-core-hook-proposal`
- Required next action:
  - Keep this patch unapplied; draft minimal generic core hook (event emission only) and keep all Qidian logic in addon.

### 2) `core-patches/high-value-extract/src__interceptors__android__adb-commands.ts.patch`
- Patch path: `core-patches/high-value-extract/src__interceptors__android__adb-commands.ts.patch`
- Target file: `src/interceptors/android/adb-commands.ts`
- What it appears to change:
  - Adds exported shell helpers, launcher resolution, package foregrounding, activation-state waiters, tunnel diagnostics, VPN inspection, stateless/fast cleanup.
- Why it existed in the working fork:
  - Improve Android activation reliability and recovery in unstable ADB/device environments.
- Current lab-addon replacement:
  - Addon includes extracted ADB executor, Android network safety and rescue flows, plus headless control services.
- Residual gap:
  - Need empirical evidence whether official interceptor path still fails in supported runtime/device combinations.
- Decision: `requires-runtime-verification`
- Required next action:
  - Run matrix validation (Windows + real devices + runtime variations) before any core delta consideration.

### 3) `core-patches/manual-review/src__api__api-server.ts.patch`
- Patch path: `core-patches/manual-review/src__api__api-server.ts.patch`
- Target file: `src/api/api-server.ts`
- What it appears to change:
  - Constructor signature and wiring to pass live exporter/session manager into REST API.
- Why it existed in the working fork:
  - Plumbed new fork-only REST automation/export capabilities through core server.
- Current lab-addon replacement:
  - Addon service/server now hosts extracted behavior.
- Residual gap:
  - None required for current addon-first architecture.
- Decision: `replaced-by-addon`
- Required next action:
  - Keep as historical wiring reference only; do not apply.

### 4) `core-patches/manual-review/src__client__http-client.ts.patch`
- Patch path: `core-patches/manual-review/src__client__http-client.ts.patch`
- Target file: `src/client/http-client.ts`
- What it appears to change:
  - Adds fallback trailer pairing from `response.trailers` when `rawTrailers` missing.
- Why it existed in the working fork:
  - Hardened response-trailer capture across runtime variations.
- Current lab-addon replacement:
  - No direct replacement needed for addon migration goals.
- Residual gap:
  - Possible generic bugfix opportunity, but independent from migration.
- Decision: `keep-as-reference`
- Required next action:
  - If issue is reproducible upstream, propose tiny standalone core bugfix separately.

### 5) `core-patches/manual-review/src__index.ts.patch`
- Patch path: `core-patches/manual-review/src__index.ts.patch`
- Target file: `src/index.ts`
- What it appears to change:
  - Injects live exporter/session manager startup wiring and shutdown Android cleanup logic.
- Why it existed in the working fork:
  - Unified fork-specific orchestration in core bootstrap.
- Current lab-addon replacement:
  - Addon headless backend strategy/local-process lifecycle and migration services now own this orchestration.
- Residual gap:
  - None requiring immediate core mutation.
- Decision: `replaced-by-addon`
- Required next action:
  - Keep official bootstrap unchanged.

### 6) `core-patches/manual-review/src__interceptors__android__android-adb-interceptor.ts.patch`
- Patch path: `core-patches/manual-review/src__interceptors__android__android-adb-interceptor.ts.patch`
- Target file: `src/interceptors/android/android-adb-interceptor.ts`
- What it appears to change:
  - Uses package-foreground helper, clears logcat buffer, waits for connected signal, surfaces tunnel diagnostics.
- Why it existed in the working fork:
  - Reduce false-positive activation success and improve troubleshooting.
- Current lab-addon replacement:
  - Addon recovery/inspection controls provide out-of-band mitigation.
- Residual gap:
  - Core interceptor activation path may still benefit if failures are proven in real workflows.
- Decision: `requires-runtime-verification`
- Required next action:
  - Reproduce activation failures and compare with addon-only operational recovery before proposing minimal core patch.

### 7) `core-patches/manual-review/src__interceptors__chromium-based-interceptors.ts.patch`
- Patch path: `core-patches/manual-review/src__interceptors__chromium-based-interceptors.ts.patch`
- Target file: `src/interceptors/chromium-based-interceptors.ts`
- What it appears to change:
  - Adds warning log in existing catch block.
- Why it existed in the working fork:
  - Extra diagnostics.
- Current lab-addon replacement:
  - Not relevant.
- Residual gap:
  - None.
- Decision: `discard`
- Required next action:
  - Do not apply.

### 8) `core-patches/manual-review/src__interceptors__electron.ts.patch`
- Patch path: `core-patches/manual-review/src__interceptors__electron.ts.patch`
- Target file: `src/interceptors/electron.ts`
- What it appears to change:
  - Adds warning log in debug client close catch block.
- Why it existed in the working fork:
  - Extra diagnostics.
- Current lab-addon replacement:
  - Not relevant.
- Residual gap:
  - None.
- Decision: `discard`
- Required next action:
  - Do not apply.

### 9) `core-patches/manual-review/src__shutdown.ts.patch`
- Patch path: `core-patches/manual-review/src__shutdown.ts.patch`
- Target file: `src/shutdown.ts`
- What it appears to change:
  - Replaces timeout-bounded parallel shutdown with sequential non-timeboxed shutdown.
- Why it existed in the working fork:
  - Sought fuller cleanup completion.
- Current lab-addon replacement:
  - Addon has its own conservative stop/recover behavior.
- Residual gap:
  - None that justifies increased hang risk in official core.
- Decision: `discard`
- Required next action:
  - Do not apply.

### 10) `core-patches/runtime-compat/bin__run.patch`
- Patch path: `core-patches/runtime-compat/bin__run.patch`
- Target file: `bin/run`
- What it appears to change:
  - Enforces exact Node version check (`v22.20.0`) and exits otherwise.
- Why it existed in the working fork:
  - Runtime drift prevention in fork deployment.
- Current lab-addon replacement:
  - Addon has runtime helper scripts without requiring core launcher edits.
- Residual gap:
  - None for upstream-clean core.
- Decision: `discard`
- Required next action:
  - Keep this out of core.

### 11) `core-patches/runtime-compat/bin__run.cmd.patch`
- Patch path: `core-patches/runtime-compat/bin__run.cmd.patch`
- Target file: `bin/run.cmd`
- What it appears to change:
  - Forces embedded runtime path and fails if missing.
- Why it existed in the working fork:
  - Stabilize Windows execution in controlled lab environment.
- Current lab-addon replacement:
  - Addon runtime scripts can manage local runtime bootstrapping externally.
- Residual gap:
  - Unknown for official Windows distribution path unless issue is reproduced.
- Decision: `requires-runtime-verification`
- Required next action:
  - Reproduce launch failures on target Windows environments before any minimal wrapper proposal.

### 12) `core-patches/runtime-compat/package.json.patch`
- Patch path: `core-patches/runtime-compat/package.json.patch`
- Target file: `package.json`
- What it appears to change:
  - Rolls back version/runtime, adjusts scripts, and downgrades multiple dependencies/types.
- Why it existed in the working fork:
  - Align entire fork toolchain to Node22-era local constraints.
- Current lab-addon replacement:
  - Addon keeps runtime/tooling constraints isolated in addon scripts.
- Residual gap:
  - None requiring official package manifest divergence.
- Decision: `discard`
- Required next action:
  - Do not apply.

### 13) `core-patches/runtime-compat/src__util__fs.ts.patch`
- Patch path: `core-patches/runtime-compat/src__util__fs.ts.patch`
- Target file: `src/util/fs.ts`
- What it appears to change:
  - Replaces `fs.promises.rm` with promisified `rimraf`.
- Why it existed in the working fork:
  - Legacy runtime compatibility for recursive folder deletion.
- Current lab-addon replacement:
  - Addon keeps runtime compatibility scripts out of core.
- Residual gap:
  - Unknown if needed on currently supported official runtime targets.
- Decision: `requires-runtime-verification`
- Required next action:
  - Verify current official Node/OS compatibility before considering any narrow fallback.

## Minimal core hook candidates

### Candidate 1: live observed traffic emission for addon `/export/stream`
- Capability:
  - Generic event emission of completed observed HTTP exchanges from core interception pipeline.
- Why addon-only is insufficient:
  - Addon cannot directly access authoritative live observed traffic generated inside core interceptors/sessions.
- Proposed minimal hook shape:
  - Register/unregister listener API (or emitter event) for normalized traffic events:
    - timestamp
    - request method/url
    - response status
    - headers/body metadata (bounded/safe)
  - No addon-domain logic in core.
- Why Qidian-specific logic must stay out of core:
  - Qidian rules are product-specific and should remain in addon matcher/config.
  - Core should expose only reusable transport-agnostic observability primitives.
- Recommended validation before applying:
  - Build addon-side integration test against mocked emitter first.
  - Validate bounded payload and backpressure behavior.
  - Smoke-test on real intercepted traffic with feature flag.

## Patches not to apply

The following should **not** be applied:
- `core-patches/runtime-compat/package.json.patch` (large runtime/dependency divergence from official core).
- `core-patches/runtime-compat/bin__run.patch` (hard exact runtime pin is brittle).
- `core-patches/manual-review/src__shutdown.ts.patch` (removes timeout guard; hang risk).
- `core-patches/manual-review/src__interceptors__chromium-based-interceptors.ts.patch` (non-essential logging).
- `core-patches/manual-review/src__interceptors__electron.ts.patch` (non-essential logging).

## Runtime verification checklist

Run these checks before deciding uncertain runtime/device patches (`requires-runtime-verification`):

1. **Windows runtime launch validation**
   - Confirm official `bin/run.cmd` behavior on clean Windows host (no embedded runtime hacks).
   - Validate startup with officially supported Node runtime(s).

2. **Filesystem delete compatibility**
   - Exercise recursive delete paths on Windows and Linux under official runtime target.
   - Confirm no `fs.rm` regressions requiring fallback.

3. **Android activation reliability matrix**
   - Devices: at least one rooted, one non-rooted, one OEM-customized device.
   - Validate activation success, tunnel stability, and cleanup success.
   - Compare core default behavior + addon rescue/inspection flows.

4. **Headless stop/recover safety checks**
   - Ensure conservative stop/recover in addon leaves no persistent VPN/network pollution.
   - Confirm recover path refuses unsafe baseline and records diagnostics.

5. **Evidence capture requirement**
   - For any candidate core change, require reproducible failure logs, exact environment, and minimal diff proposal before approval.
