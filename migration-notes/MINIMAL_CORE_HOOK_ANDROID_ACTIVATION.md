# Minimal core hook: Android activation bridge

## Why addon-only was insufficient

`lab-addon` can send Android ACTIVATE intents, but addon-only mode cannot prove official interceptor/session readiness without an official bridge endpoint.

## Port split

- `45456` = Mockttp admin API. It will not host `/automation/*` routes.
- `45457` = official REST/GraphQL API + `lab-addon` compatibility routes.
- `45458` = dedicated official Android activation bridge (local-only, opt-in).

Using a dedicated bridge port avoids the previous route/port confusion where `/automation/*` logic was added to `src/api/rest-api.ts` even though consumers were checking `45456`.

## Official files changed

- `src/api/rest-api.ts`
  - Removed `/automation/*` bridge routes from the REST API surface.
- `src/automation/android-activation-bridge-server.ts`
  - Added dedicated bridge server on `127.0.0.1`.
  - Routes:
    - `GET /automation/health`
    - `POST /automation/android-adb/start-headless`
  - Uses `apiModel.getInterceptorMetadata()` and `apiModel.activateInterceptor('android-adb', ...)`.
  - Ensures/creates proxy port via Mockttp admin (`45456`) only when needed.
- `src/api/api-server.ts`
  - Exposes `getApiModel()` for minimal bridge startup wiring.
- `src/index.ts`
  - Starts bridge only when `HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED=true`.
  - Port controlled by `HTK_ANDROID_ACTIVATION_BRIDGE_PORT` (default `45458`).
  - Server continues unchanged when disabled.
- `test/unit/rest-api-automation-bridge.spec.ts`
  - Tests disabled-by-default behavior, enabled health route, activation call path, localhost binding, failure structure, and no-Qidian guard.

## Addon files changed

- `lab-addon/src/automation/adb-android-activation-client.ts`
  - Default official bridge URL changed to `http://127.0.0.1:45458`.
  - `LAB_ADDON_OFFICIAL_ADMIN_BASE_URL` still overrides.
- `lab-addon/test/adb-android-activation-client.spec.ts`
  - Updated defaults and assertions so client does not call `45456` or `45457` by default.
- `lab-addon/README.md`
  - Updated port mapping and bridge validation examples.

## Bridge env vars

- `HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED=true` (required to start the bridge)
- `HTK_ANDROID_ACTIVATION_BRIDGE_PORT` (optional, default `45458`)
- `LAB_ADDON_OFFICIAL_ADMIN_BASE_URL` (addon override for bridge base URL)

## Validation commands

```bash
curl http://127.0.0.1:45458/automation/health
curl -X POST http://127.0.0.1:45457/automation/android-adb/start-headless \
  -H 'content-type: application/json' \
  -d '{"deviceId":"<id>","proxyPort":8000,"enableSocks":false,"allowUnsafeStart":true}'
```


## Real-device bootstrap validation issue (April 27, 2026)

Observed real-device behavior before this fix:

1. `lab-addon` called the official bridge successfully.
2. Android app received the ACTIVATE URL.
3. Proxy validation probes failed (`10.0.2.2`, `10.0.3.2`, LAN timeout; `127.0.0.1:8000` returned `503`).
4. Local check confirmed plain proxy response was `503` without Android bootstrap rules.

Fix implemented in official bridge flow:

- Added `src/automation/android-bootstrap-rules.ts`.
- Before `apiModel.activateInterceptor('android-adb', ...)`, bridge now prepares minimal Android bootstrap rules:
  - `http://android.httptoolkit.tech/config` -> JSON certificate payload.
  - `http://amiusing.httptoolkit.tech/certificate` -> PEM certificate response.
  - minimal pass-through fallback rule.
- Bridge response now includes:
  - `bootstrapRulesApplied`
  - `bootstrapResult`
  - warning: `VPN/data-plane success must be verified separately.`

If bootstrap preparation fails, bridge returns structured failure with error code:

- `android-bootstrap-rules-failed`

PowerShell validation command:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000
```

Expected outcome after bootstrap preparation: Android bootstrap/certificate validation path should be handled by configured rules (not a raw default `503`).

Control-plane success still does **not** prove VPN/data-plane success; verify Android traffic separately.

## Mockttp admin 403 during bridge session preparation (April 27, 2026)

Observed bridge failure after introducing dedicated bridge port `45458`:

- Bridge route responded from `45458` correctly.
- Internal session preparation attempted `http://127.0.0.1:45456/start?port=8000`.
- Mockttp admin returned HTTP `403`.
- Bridge reported:
  - `controlPlaneSuccess=false`
  - `bootstrapRulesApplied=false`
  - `certificateAvailable=false`
  - `errors=["activation-bridge-internal-error"]`

### Root cause

The bridge used `mockttp.getRemote({ adminServerUrl: "http://127.0.0.1:45456" })` without the trusted browser-style `Origin` header required by Mockttp admin CORS-gate policy.

### Fix

- Updated bridge session preparation to create remote Mockttp clients with:
  - `Origin: https://app.httptoolkit.tech`
- Updated bootstrap fallback session creation with the same trusted Origin.
- Added explicit bridge status fields:
  - `proxySessionPrepared` (true/false)
  - structured `proxySessionError` details (`code`, `message`, `statusCode`) when session preparation fails.
- Added explicit failure code:
  - `errors=["proxy-session-preparation-failed"]`
- Bridge now avoids activation attempts when proxy session preparation or bootstrap setup fails.

### Validation command

The raw admin endpoint can be checked directly (expected `403` without trusted Origin, success with trusted Origin):

```bash
curl -i -X POST "http://127.0.0.1:45456/start?port=8000"
curl -i -X POST "http://127.0.0.1:45456/start?port=8000" \
  -H "origin: https://app.httptoolkit.tech"
```

## Session-preparation alignment with old working-fork (April 28, 2026)

### Why pure addon mode was still insufficient

Addon-only activation could trigger control endpoints, but it could not guarantee that official core state for `proxyPort` was actually prepared (config + certificate + bootstrap rules on the same proxy session).

### Why `45456/start` HTTP `200` is not enough

A successful `POST /start` on Mockttp admin (`45456`) only confirms a start request response. It does **not** guarantee Android activation readiness. The bridge must still verify official config/certificate availability through `apiModel.getConfig(proxyPort)` before attempting interceptor activation.

### Minimal behavior restored from old implementation

A focused official helper (`src/automation/android-session-manager.ts`) now restores the minimum old `startSessionIfNeeded` readiness pattern:

1. Try `apiModel.getConfig(proxyPort)` first (reuse path).
2. If unavailable, call `POST http://127.0.0.1:45456/start?port=<proxyPort>` with `Origin: https://app.httptoolkit.tech`.
3. Re-check `apiModel.getConfig(proxyPort)`.
4. Require certificate content before continuing.
5. Return structured readiness diagnostics (`source`, `configAvailable`, `certificateAvailable`, `errors`, `warnings`).

Bridge ordering is now explicit and strict:

1. Prepare/reuse proxy session config.
2. Apply Android bootstrap rules to that proxy port.
3. Activate `android-adb` interceptor.
4. Report control-plane success only when both bootstrap and activation succeed.
5. Keep `dataPlaneObserved=false` unless real traffic is observed.

### What is still intentionally not restored

- No wholesale restore of old `src/api/rest-api.ts` automation block.
- No Qidian-specific behavior in official core bridge/session helper.
- No JSONL/live-export persistence introduced into Android activation path.
- No real-device dependency in unit tests.

### Validation commands

```bash
npm run build:src
npm run test:unit
cd lab-addon
npm run typecheck
npm test
```

## Android bridge session lifecycle fix (April 28, 2026)

Issue observed in the April 27 package:

1. Session preparation called Mockttp admin `POST /start?port=<proxyPort>`.
2. Bridge then created a second remote session and called `session.start(proxyPort)` again.
3. Duplicate start could trigger `EADDRINUSE` and unstable setup.
4. Bridge finally block stopped the managed session immediately after bootstrap rules, which could tear down proxy readiness before Android validation finished.

Lifecycle fix applied:

1. Bridge now prepares proxy readiness and rule session in one step (`prepareAndroidProxySession`).
2. Start path uses one coherent lifecycle: `getRemote(...).start(proxyPort)` exactly once, then verifies `apiModel.getConfig(proxyPort)` and certificate availability.
3. Existing-config path does not call start; if a safe rule-session handle is unavailable, bridge returns `existing-config-without-rule-session-handle` and stops.
4. Bootstrap rules are applied to the exact session returned by preparation (no separate fallback session in the successful bridge path).
5. Bridge no longer stops the session in `start-headless`; proxy stays alive for Android app bootstrap and validation.
6. `controlPlaneSuccess=true` only when session prep succeeded, certificate was available, bootstrap rules were applied, and `activateInterceptor('android-adb', ...)` succeeded.

Raw admin `POST /start` remains documented as an experimental check, but it is not used in the successful bridge session path unless a future design can safely return the exact same rule-session handle without a second start.

## Stale existing-config recovery for Android activation bridge (April 28, 2026)

### Real failure observed

Bridge `start-headless` could return:

- `proxySessionSource="existing-config"`
- `configAvailable=true`
- `certificateAvailable=true`
- `errors=["existing-config-without-rule-session-handle"]`

This happened when `apiModel.getConfig(proxyPort)` still returned config/certificate data, but the actual proxy listener/rule-session handle for that port no longer existed.

### Root cause

Official config/certificate state can outlive the active Mockttp rule-session handle. Existing-config reuse was incorrectly treated as fully usable even when no session handle was available for Android bootstrap rule attachment.

### Recovery behavior now implemented

1. Detect stale existing config if:
   - initial config exists,
   - initial certificate exists,
   - existing rule session handle is unavailable.
2. Mark `staleExistingConfig=true`.
3. Run exactly one fresh remote start attempt (`getRemote().start(proxyPort)` via session helper start mode).
4. Re-read `apiModel.getConfig(proxyPort)` after successful start.
5. Require refreshed certificate content before continuing.
6. Apply Android bootstrap rules to the recovered fresh session handle.
7. Activate `android-adb` only after bootstrap succeeds.

### Structured failure outcomes

- Fresh start cannot provide a handle:
  - `errors=["stale-existing-config-without-proxy-session"]`
- Fresh start succeeds but config missing on re-read:
  - `errors=["stale-existing-config-recovery-config-unavailable"]`
- Fresh start succeeds but certificate missing on re-read:
  - `errors=["stale-existing-config-recovery-certificate-unavailable"]`

## Addon wrapper/health/data-plane alignment after core bridge success (April 28, 2026)

Real-device runs now confirm the official core bridge control-plane path is healthy on `45458` with:

- `success=true`
- `controlPlaneSuccess=true`
- `proxyPort=8000`
- `proxySessionSource="stale-existing-config-recovered-by-remote-start"`
- `bootstrapRulesApplied=true`
- `ruleSessionHandleAvailable=true`
- `errors=[]`

### What was fixed in addon wrapper behavior

1. Addon `POST /automation/android-adb/start-headless` now treats official bridge success as authoritative control-plane success.
2. Wrapper preserves bridge proxy port (e.g. `8000`) and avoids addon-side second-start allocation on `8001`.
3. Health now keeps both:
   - `lastStartHeadless` (latest attempt)
   - `lastSuccessfulStartHeadless` (last known good control-plane result)
4. Later failed/redundant attempts no longer erase the last successful bridge state.

## Android start-headless idempotency fix on repeated proxyPort (April 29, 2026)

### Real run result captured

- First `POST /automation/android-adb/start-headless` on `proxyPort=8000` succeeded with:
  - `controlPlaneSuccess=true`
  - `proxySessionSource="stale-existing-config-recovered-by-remote-start"`
  - `ruleSessionHandleAvailable=true`
  - `bootstrapRulesApplied=true`
- Repeated call on `proxyPort=8000` failed with raw `EADDRINUSE`.

### Minimal core behavior update

1. Added an in-memory active Android proxy session registry keyed by `proxyPort`.
2. Registry entries persist:
   - session handle
   - certificate content
   - config/certificate availability
   - timestamps and source
3. On repeated start-headless for same port, bridge now reuses active registry session when config/certificate are still present:
   - `proxySessionSource="existing-active-session-registry"`
   - no second Mockttp start on `8000`
4. If stale path attempts start and receives `EADDRINUSE`, bridge/session manager now:
   - re-check registry and reuse handle when available via `existing-active-session-registry-after-eaddrinuse`
   - otherwise return structured error `proxy-port-in-use-without-session-handle`
5. `EADDRINUSE` is treated as a stale/session-handle recovery condition, not as a trigger to move to `8001`.

This preserves the existing success matrix and keeps repeated calls on `8000` idempotent in control-plane behavior.

### VPN recognition evidence hierarchy

## Start-headless state/evidence semantic follow-up (April 28, 2026)

Two addon-side semantics were tightened without changing the official core bridge contract:

1. **No-wait evidence no longer infers data-plane from historical JSONL bytes**
   - Addon now always captures current JSONL size as baseline before activation.
   - When neither `waitForTraffic` nor `waitForTargetTraffic` is requested, output polling is skipped.
   - No-wait responses explicitly report:
     - `jsonlAfterBytes = jsonlBaselineBytes`
     - `jsonlGrowthObserved = false`
     - `newRecordsObserved = false`
     - `newTargetRecordsObserved = false`
     - `dataPlaneObserved = false`
     - `targetTrafficObserved = false`
   - `overallSuccess` remains control-plane driven in no-wait mode.

2. **`session.active` now reflects control-plane activation, not validation completion**
   - `session.active` is now set from `controlPlaneSuccess`.
   - Validation outcomes remain exposed at response top-level (`overallSuccess`, `failurePhase`) and are also attached in `session.details.validation`:
     - `overallSuccess`
     - `trafficValidated`
     - `targetValidated`
     - `failurePhase`

This preserves the explicit matrix semantics:

`overallSuccess = controlPlaneSuccess && trafficValidated && targetValidated`

Some devices return `Can't find service: vpn` for `dumpsys vpn` even while capture is active. Addon now treats that as warning evidence (`dumpsys-vpn-unavailable`) and computes `vpnLikelyActive` from combined signals, including:

- bridge control-plane success,
- HTTP Toolkit activity/runnable signals when available,
- connectivity VPN mentions,
- JSONL growth and target traffic observations.

### Data-plane validation improvement

Addon now uses export output status and persisted JSONL records as strong data-plane evidence:

- output-size growth across activation window,
- target traffic matcher hits in persisted records.

On this device, real Qidian JSONL growth is stronger proof of active capture than `dumpsys vpn` availability.

### Warning-only noise patterns

These log patterns are now classified as warnings and do not force control-plane failure by themselves:

- `docker-unavailable`
- `unsupported-su-root-syntax`
- `non-tls-client-on-tls-path`
- `upstream-dns-failure`
- `upstream-socket-hangup`
- `vpn-ipv6-packet-warning`

## Addon start-headless state-machine contract (April 28, 2026)

The addon wrapper now uses an explicit start-headless attempt model and success matrix to avoid semantic regressions:

- `attemptId`, `requestedProxyPort`, `effectiveProxyPort`
- `controlPlaneSuccess`, `vpnLikelyActive`
- `dataPlaneObserved`, `targetTrafficObserved`
- `trafficValidated`, `targetValidated`, `overallSuccess`
- `failurePhase` (`control-plane`, `traffic-wait-timeout`, `target-wait-timeout`)
- `evidence` payload including bridge evidence + JSONL baseline/after offsets and post-baseline record flags.

Contract highlights:

1. **Port/session safety:** when bridge returns `controlPlaneSuccess=true`, addon does not run local `startSessionIfNeeded` and preserves bridge proxy port.
2. **No stale JSONL evidence:** any data-plane/target evidence comes only from records read with `readRecordsSinceOffset(jsonlBaselineBytes)` where baseline is captured before activation.
3. **Polling scope:** addon polls JSONL evidence only when `waitForTraffic` and/or `waitForTargetTraffic` are set; timeout is 10s with 500ms interval.
4. **Validation formula:** `overallSuccess = controlPlaneSuccess && trafficValidated && targetValidated`.
5. **VPN evidence role:** VPN evidence is supporting only; it does not satisfy traffic or target validation waits by itself.
6. **Health durability:**
   - `lastStartHeadless`: latest attempt.
   - `lastSuccessfulStartHeadless`: latest `overallSuccess=true`.
   - `lastControlPlaneSuccessfulStartHeadless`: latest `controlPlaneSuccess=true`.
   - `lastFailure`: latest failed attempt.

This keeps evidence of successful core activation even if a later target wait times out.

## 2026-04-29 post-device follow-up

Verified real-device status before this patch:
- First `start-headless` on `proxyPort=8000` succeeded end-to-end.
- Repeated same-port `start-headless` was failing with raw `EADDRINUSE`.
- After manual Qidian activity, JSONL grew from `0` to `174396` with real `druidv6.if.qidian.com` URLs.

Final contract after this patch:
- `POST /automation/android-adb/start-headless` is for activation/control-plane session setup.
- `POST /automation/android-adb/wait-for-target-traffic` is for post-start JSONL observation from a caller-provided (or current) baseline offset.
- Repeated same-port activation reuses the active session registry and returns reuse diagnostics instead of retrying with alternate ports.
- Socket/TLS/Docker/su noise remains non-fatal warning telemetry when Qidian JSONL capture is present.

Known downstream issue (not solved here):
- Some JSONL body text may still show mojibake. This needs a later normalization/encoding pass.

## Qidian capture operator wrapper flow (April 30, 2026)

Recommended daily flow:

```powershell
cd lab-addon
powershell -ExecutionPolicy Bypass -File .\scripts\qidian-capture-once.ps1 -DeviceId 23091JEGR04484 -ProxyPort 8000 -TimeoutSeconds 90 -SkipSmoke
```

Contract:

- `start-headless` is a one-shot activation command.
- Do not repeatedly invoke `start-headless` for connection detection.
- If `EADDRINUSE` appears after a previous successful start, treat it as a possible active `8000` session and validate via JSONL growth + target URL hit.
- Final success requires both:
  - `session_hits.jsonl` size growth after baseline.
  - Recent appended lines containing `qidian.com` or `druidv6.if.qidian.com`.

Known limitations:

- `body.inline` Chinese text can still appear mojibake; this is a downstream normalization/encoding task.
- If JSONL does not grow, restart services or re-activate HTTP Toolkit on the phone.
- `dumpsys vpn` is not the final success criterion for capture readiness.


## Qidian capture wrapper operational notes (April 30, 2026)

- `lab-addon/scripts/qidian-capture-*.ps1` are operational wrappers around existing addon/core APIs; they do not change official core activation behavior.
- Wrapper final success is evaluated as both:
  - post-baseline JSONL growth (`sizeBytes` delta), and
  - post-baseline target URL hit (`qidian.com|druidv6.if.qidian.com`) from appended JSONL content only.
- `start-headless` remains single-shot. If response indicates `EADDRINUSE`, wrapper records warning `start-headless-eaddrinuse-existing-session-possible`, persists state, and exits `0` for follow-up watch.
- Wrapper does not retry `start-headless`, loop starts, or kill proxy port `8000`.

## JSONL normalization layer for downstream consumers (April 30, 2026)

To keep capture and control-plane behavior unchanged while making exported traffic more stable for analysis, addon-only normalization is added as a derived pipeline:

- Raw capture artifact (unchanged): `lab-addon/runtime/exports/session_hits.jsonl`
- Derived normalized artifact: `lab-addon/runtime/exports/normalized_network_events.jsonl`
- Derived Qidian-filtered artifact: `lab-addon/runtime/exports/qidian_endpoint_events.jsonl`

Notes:

- `session_hits.jsonl` remains immutable capture evidence.
- Normalization is best-effort, line-by-line, and tolerant of malformed/partial JSONL lines.
- Qidian endpoint routing is based on host + path (not a single hardcoded endpoint).
- Mojibake repair is auditable and conservative in v1:
  - detect and flag likely mojibake patterns
  - keep warnings when robust GBK decode is unavailable without external dependency
  - preserve raw original text in raw capture only
- Normalized records store metadata/hash/sample fields for body analysis and avoid dumping large body payloads by default.

## Normalization validation and flush hardening (April 30, 2026)

- `lab-addon` default `npm test` now includes normalization specs:
  - `test/normalize-network-event.spec.ts`
  - `test/qidian-endpoint-router.spec.ts`
- `lab-addon` `npm run typecheck` now includes `src/export/**/*.ts`, so normalization modules are checked even when they are not imported by `src/server.ts`.
- `normalizeNetworkJsonl` now waits for output stream completion before returning summary:
  - waits for `normalized_network_events.jsonl` stream finish
  - waits for optional `qidian_endpoint_events.jsonl` stream finish

Behavior preserved:
- raw `session_hits.jsonl` remains input-only and unchanged.
- mojibake strategy remains detect-only with warning `gbk-repair-requires-iconv-lite-or-external-decoder` and no new dependency.

## Lab-addon export output directory configuration (April 30, 2026)

To avoid polluting the `httptoolkit-server-main` working tree, lab-addon export output now supports env-configured external paths while keeping backward-compatible defaults.

Default-compatible behavior remains:

- runtime root defaults to `lab-addon/runtime`
- export directory defaults to `lab-addon/runtime/exports`
- raw JSONL defaults to `lab-addon/runtime/exports/session_hits.jsonl`

Recommended production setup:

- set `HTK_LAB_ADDON_EXPORT_DIR` before starting lab-addon
- example: `C:\Users\Card\Desktop\DataBase\httptoolkit_exports\qidian`

With that env set:

- raw output goes to: `...\qidian\session_hits.jsonl`
- normalized output should go to:
  - `...\qidian\normalized_network_events.jsonl`
  - `...\qidian\qidian_endpoint_events.jsonl`

Notes:

- qidian capture wrappers rely on `/export/output-status` for live jsonl path discovery (no hardcoded runtime export path for capture state).
- This is addon-only behavior; official core Android activation/interceptor flows are unchanged.

## Qidian long-running capture reliability notes (May 1, 2026)

- Source `observedAt` values from captured payloads may be relative timing converted to epoch-like values (for example `1970-01-01T00:21:36.922Z`) and must not be treated as wall-clock freshness.
- Export ingest now writes PC-side `ingestedAt` wall-clock timestamps and flags `observedAtWallClockInvalid=true` when source `observedAt` is missing/invalid or has year `< 2001`.
- Normalization should use `eventTimeForSorting` for freshness/sorting. Priority order is `ingestedAt`, then `capturedAt`, then valid wall-clock `observedAt`.
- Watchdog mode uses JSONL growth + appended-hit inspection and can auto-attempt one light `start-headless` activation after no-growth threshold.
- Auto-activation is cooldown-limited; repeated no-growth does not spam calls inside cooldown.
- `EADDRINUSE` during auto-activation is treated as `existing-session-possible` warning, not fatal.
- Phone-network (`adb shell ping 223.5.5.5`) failures are surfaced separately and should not trigger endless activation retries.
- No-growth alone can still be idle app behavior; in capture-active mode this is treated as a lightweight recovery signal.
